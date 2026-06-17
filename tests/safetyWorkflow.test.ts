import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { registerBaiduTools } from "../src/tools.js";
import { FileOperationLogger } from "../src/operationLog.js";
import type { BaiduConfig } from "../src/config.js";

const config = (dir: string): BaiduConfig => ({
  appKey: "app-key",
  secretKey: "secret-key",
  redirectUri: "oob",
  scope: "basic,netdisk",
  tokenStorePath: join(dir, "tokens.json"),
  operationLogPath: join(dir, "operations.jsonl"),
  selectionStorePath: join(dir, "selections.json"),
  cacheRoot: join(dir, "cache"),
  skillsDir: join(dir, "skills"),
  localRoot: dir,
  userAgent: "pan.baidu.com",
  uploadChunkSizeBytes: 4 * 1024 * 1024,
  strictAppPaths: true
});

function collectTools(deps: Parameters<typeof registerBaiduTools>[1]) {
  const handlers = new Map<string, (args: any) => Promise<any>>();
  registerBaiduTools(
    {
      registerTool: (name, _config, handler) => {
        handlers.set(name, handler);
      }
    },
    deps
  );
  return handlers;
}

describe("agent-safe workflow", () => {
  it("returns a delete dry-run plan without calling Baidu filemanager", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-safety-"));
    try {
      let called = false;
      const logger = new FileOperationLogger(config(dir).operationLogPath);
      const tools = collectTools({
        config: config(dir),
        operationLogger: logger,
        client: {
          config: config(dir),
          manageFile: async () => {
            called = true;
            return { errno: 0 };
          }
        } as any
      });

      const result = await tools.get("baidu_delete_file")?.({
        paths: ["/apps/demo/a.txt", "/apps/demo/b.txt"],
        dryRun: true
      });

      expect(called).toBe(false);
      expect(result?.structuredContent).toMatchObject({
        dryRun: true,
        operation: "delete",
        itemCount: 2,
        requiresConfirm: "DELETE"
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("writes an audit record after an executed rename", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-audit-"));
    try {
      const cfg = config(dir);
      const logger = new FileOperationLogger(cfg.operationLogPath);
      const tools = collectTools({
        config: cfg,
        operationLogger: logger,
        client: {
          config: cfg,
          manageFile: async () => ({ errno: 0, taskid: 123 })
        } as any
      });

      await tools.get("baidu_rename_file")?.({
        path: "/apps/demo/old.txt",
        newname: "new.txt"
      });

      const raw = await readFile(cfg.operationLogPath, "utf8");
      const entry = JSON.parse(raw.trim());
      expect(entry).toMatchObject({
        operation: "rename",
        paths: ["/apps/demo/old.txt"],
        status: "executed"
      });
      expect(entry.id).toMatch(/^op_/);
      expect(entry.timestamp).toEqual(expect.any(String));
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("exposes recent operation log entries as an MCP tool", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-log-tool-"));
    try {
      const cfg = config(dir);
      const logger = new FileOperationLogger(cfg.operationLogPath);
      await logger.record({
        operation: "delete",
        paths: ["/apps/demo/a.txt"],
        status: "executed",
        request: { confirm: "DELETE" },
        response: { errno: 0 }
      });
      const tools = collectTools({
        config: cfg,
        operationLogger: logger
      });

      const result = await tools.get("baidu_operation_log")?.({ limit: 5 });

      expect(result?.structuredContent).toMatchObject({
        entries: [
          {
            operation: "delete",
            paths: ["/apps/demo/a.txt"],
            status: "executed"
          }
        ]
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
