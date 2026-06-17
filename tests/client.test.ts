import { describe, expect, it } from "vitest";
import { BaiduApiError, BaiduNetdiskClient } from "../src/baiduClient.js";
import type { BaiduConfig } from "../src/config.js";
import type { TokenProvider } from "../src/auth.js";

const config: BaiduConfig = {
  appKey: "app-key",
  secretKey: "secret-key",
  redirectUri: "oob",
  scope: "basic,netdisk",
  tokenStorePath: "tokens.json",
  operationLogPath: "operations.jsonl",
  selectionStorePath: "selections.json",
  cacheRoot: "cache",
  skillsDir: "skills",
  localRoot: process.cwd(),
  userAgent: "pan.baidu.com",
  uploadChunkSizeBytes: 4 * 1024 * 1024,
  strictAppPaths: true
};

const tokenProvider: TokenProvider = {
  getAccessToken: async () => "token-123"
};

describe("BaiduNetdiskClient", () => {
  it("adds access_token and User-Agent to API requests", async () => {
    const seen: { url?: URL; userAgent?: string } = {};
    const client = new BaiduNetdiskClient({
      config,
      tokenProvider,
      fetch: async (input, init) => {
        seen.url = new URL(String(input));
        seen.userAgent = new Headers(init?.headers).get("User-Agent") ?? undefined;
        return Response.json({ errno: 0, list: [] });
      }
    });

    await client.listFiles({ dir: "/apps/demo", limit: 10, order: "time", desc: true });

    expect(seen.url?.origin).toBe("https://pan.baidu.com");
    expect(seen.url?.pathname).toBe("/rest/2.0/xpan/file");
    expect(seen.url?.searchParams.get("method")).toBe("list");
    expect(seen.url?.searchParams.get("access_token")).toBe("token-123");
    expect(seen.url?.searchParams.get("dir")).toBe("/apps/demo");
    expect(seen.url?.searchParams.get("limit")).toBe("10");
    expect(seen.userAgent).toBe("pan.baidu.com");
  });

  it("throws a BaiduApiError for non-zero errno or error_code responses", async () => {
    const client = new BaiduNetdiskClient({
      config,
      tokenProvider,
      fetch: async () => Response.json({ errno: -7, errmsg: "bad path" })
    });

    await expect(client.quota()).rejects.toMatchObject({
      name: "BaiduApiError",
      code: -7,
      message: "bad path"
    } satisfies Partial<BaiduApiError>);
  });

  it("encodes fsids as a JSON array when requesting dlinks", async () => {
    let url: URL | undefined;
    const client = new BaiduNetdiskClient({
      config,
      tokenProvider,
      fetch: async (input) => {
        url = new URL(String(input));
        return Response.json({ errno: 0, list: [] });
      }
    });

    await client.fileMetas({ fsids: [123, 456], dlink: true, thumb: true });

    expect(url?.pathname).toBe("/rest/2.0/xpan/multimedia");
    expect(url?.searchParams.get("method")).toBe("filemetas");
    expect(url?.searchParams.get("fsids")).toBe("[123,456]");
    expect(url?.searchParams.get("dlink")).toBe("1");
    expect(url?.searchParams.get("thumb")).toBe("1");
  });

  it("preserves uint64 fsids passed as strings without losing precision", async () => {
    let url: URL | undefined;
    const client = new BaiduNetdiskClient({
      config,
      tokenProvider,
      fetch: async (input) => {
        url = new URL(String(input));
        return Response.json({ errno: 0, list: [] });
      }
    });

    await client.fileMetas({
      fsids: ["9007199254740993", "18446744073709551615"],
      dlink: true
    });

    expect(url?.searchParams.get("fsids")).toBe(
      "[9007199254740993,18446744073709551615]"
    );
  });
});
