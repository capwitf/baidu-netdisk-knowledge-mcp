import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BaiduNetdiskClient } from "../src/baiduClient.js";
import { downloadFileByFsId, uploadFile } from "../src/transfer.js";
import type { BaiduConfig } from "../src/config.js";
import type { TokenProvider } from "../src/auth.js";

const makeConfig = (localRoot: string): BaiduConfig => ({
  appKey: "app-key",
  secretKey: "secret-key",
  redirectUri: "oob",
  scope: "basic,netdisk",
  tokenStorePath: "tokens.json",
  operationLogPath: "operations.jsonl",
  selectionStorePath: "selections.json",
  cacheRoot: "cache",
  skillsDir: "skills",
  localRoot,
  userAgent: "pan.baidu.com",
  uploadChunkSizeBytes: 4,
  strictAppPaths: true
});

const tokenProvider: TokenProvider = {
  getAccessToken: async () => "token-123"
};

describe("file transfers", () => {
  it("uploads a local file through precreate, locateupload, superfile2, and create", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-upload-"));
    try {
      const localPath = join(dir, "hello.txt");
      await writeFile(localPath, "hello world");
      const calls: string[] = [];
      const config = makeConfig(dir);
      const client = new BaiduNetdiskClient({
        config,
        tokenProvider,
        fetch: async (input) => {
          const url = new URL(String(input));
          calls.push(`${url.hostname}${url.pathname}?${url.searchParams.get("method")}`);
          if (url.searchParams.get("method") === "precreate") {
            return Response.json({ errno: 0, uploadid: "upload-1", return_type: 1 });
          }
          if (url.searchParams.get("method") === "locateupload") {
            return Response.json({
              error_code: 0,
              servers: [{ server: "https://upload.example.com" }]
            });
          }
          if (url.searchParams.get("method") === "upload") {
            return Response.json({ errno: 0, md5: `cloud-md5-${url.searchParams.get("partseq")}` });
          }
          if (url.searchParams.get("method") === "create") {
            return Response.json({ errno: 0, fs_id: 99, path: "/apps/demo/hello.txt" });
          }
          return Response.json({ errno: 0 });
        }
      });

      const result = await uploadFile(client, {
        localPath,
        remotePath: "/apps/demo/hello.txt",
        rtype: 1
      });

      expect(result.path).toBe("/apps/demo/hello.txt");
      expect(calls).toEqual([
        "pan.baidu.com/rest/2.0/xpan/file?precreate",
        "d.pcs.baidu.com/rest/2.0/pcs/file?locateupload",
        "upload.example.com/rest/2.0/pcs/superfile2?upload",
        "upload.example.com/rest/2.0/pcs/superfile2?upload",
        "upload.example.com/rest/2.0/pcs/superfile2?upload",
        "pan.baidu.com/rest/2.0/xpan/file?create"
      ]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("retries transient chunk upload failures before abandoning the upload", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-upload-retry-"));
    try {
      const localPath = join(dir, "hello.txt");
      await writeFile(localPath, "hello");
      const config = makeConfig(dir);
      let firstChunkAttempts = 0;
      let createCalled = false;
      const client = new BaiduNetdiskClient({
        config,
        tokenProvider,
        fetch: async (input) => {
          const url = new URL(String(input));
          if (url.searchParams.get("method") === "precreate") {
            return Response.json({ errno: 0, uploadid: "upload-1" });
          }
          if (url.searchParams.get("method") === "locateupload") {
            return Response.json({
              error_code: 0,
              servers: [{ server: "https://upload.example.com" }]
            });
          }
          if (url.searchParams.get("method") === "upload") {
            if (url.searchParams.get("partseq") === "0") {
              firstChunkAttempts += 1;
              if (firstChunkAttempts === 1) {
                throw new Error("temporary network failure");
              }
            }
            return Response.json({ errno: 0, md5: `cloud-md5-${url.searchParams.get("partseq")}` });
          }
          if (url.searchParams.get("method") === "create") {
            createCalled = true;
            return Response.json({ errno: 0, fs_id: 99, path: "/apps/demo/hello.txt" });
          }
          return Response.json({ errno: 0 });
        }
      });

      await expect(uploadFile(client, {
        localPath,
        remotePath: "/apps/demo/hello.txt"
      })).resolves.toMatchObject({ path: "/apps/demo/hello.txt" });
      expect(firstChunkAttempts).toBe(2);
      expect(createCalled).toBe(true);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("downloads a file by fs_id using a dlink with access_token and no overwrite by default", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-download-"));
    try {
      const target = join(dir, "out.txt");
      const config = makeConfig(dir);
      const client = new BaiduNetdiskClient({
        config,
        tokenProvider,
        fetch: async (input, init) => {
          const url = new URL(String(input));
          if (url.searchParams.get("method") === "filemetas") {
            return Response.json({
              errno: 0,
              list: [{ fs_id: 7, server_filename: "out.txt", dlink: "https://d.pcs.baidu.com/file/abc" }]
            });
          }
          expect(url.href).toBe("https://d.pcs.baidu.com/file/abc?access_token=token-123");
          expect(new Headers(init?.headers).get("User-Agent")).toBe("pan.baidu.com");
          return new Response("downloaded");
        }
      });

      const result = await downloadFileByFsId(client, { fsId: 7, localPath: target });
      await expect(readFile(target, "utf8")).resolves.toBe("downloaded");
      await expect(downloadFileByFsId(client, { fsId: 7, localPath: target })).rejects.toThrow(/already exists/);
      expect(result.bytesWritten).toBe(10);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
