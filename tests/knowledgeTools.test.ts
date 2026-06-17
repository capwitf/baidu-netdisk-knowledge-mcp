import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileOperationLogger } from "../src/operationLog.js";
import { FileSelectionStore } from "../src/selection.js";
import { FileSkillRegistry } from "../src/skills.js";
import { registerBaiduTools } from "../src/tools.js";
import type { BaiduConfig } from "../src/config.js";

const makeConfig = (dir: string): BaiduConfig => ({
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
  transferMaxRetries: 3,
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

describe("knowledge-base MCP tools", () => {
  it("returns qrcode auth URLs with terminal and data URL renderings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-qrcode-tool-"));
    try {
      const cfg = makeConfig(dir);
      const tools = collectTools({ config: cfg } as any);

      const result = await tools.get("baidu_auth_qrcode")?.({ state: "abc" });

      expect(result.structuredContent.url).toContain("qrcode=1");
      expect(result.structuredContent.terminalQr).toContain("█");
      expect(result.structuredContent.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("creates a selection from search results and index expression", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-select-tool-"));
    try {
      const cfg = makeConfig(dir);
      const selectionStore = new FileSelectionStore(cfg.selectionStorePath);
      const tools = collectTools({
        config: cfg,
        selectionStore,
        client: {
          config: cfg,
          searchFiles: async () => ({
            list: [
              { fs_id: 11, path: "/apps/kb/a.md", server_filename: "a.md", size: 1, isdir: 0 },
              { fs_id: 12, path: "/apps/kb/b.md", server_filename: "b.md", size: 2, isdir: 0 },
              { fs_id: 13, path: "/apps/kb/c.pdf", server_filename: "c.pdf", size: 3, isdir: 0 }
            ]
          })
        } as any
      });

      const listed = await tools.get("baidu_search_selectable_files")?.({ key: "mcp" });
      const selected = await tools.get("baidu_select_files")?.({
        resultId: listed.structuredContent.resultId,
        select: "1,3"
      });

      expect(listed.structuredContent.items.map((item: any) => item.index)).toEqual([1, 2, 3]);
      expect(selected.structuredContent.selectionId).toMatch(/^sel_/);
      expect(selected.structuredContent.items.map((item: any) => item.filename)).toEqual(["a.md", "c.pdf"]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("returns recursive selectable listings with file type filters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-recursive-select-tool-"));
    try {
      const cfg = makeConfig(dir);
      let listAllArgs: any;
      const tools = collectTools({
        config: cfg,
        selectionStore: new FileSelectionStore(cfg.selectionStorePath),
        client: {
          config: cfg,
          listAllFiles: async (args: any) => {
            listAllArgs = args;
            return {
              list: [
                { fs_id: 21, path: "/apps/kb/a.md", server_filename: "a.md", isdir: 0 },
                { fs_id: 22, path: "/apps/kb/b.pdf", server_filename: "b.pdf", isdir: 0 },
                { fs_id: 23, path: "/apps/kb/folder", server_filename: "folder", isdir: 1 }
              ]
            };
          }
        } as any
      });

      const listed = await tools.get("baidu_list_selectable_files")?.({
        dir: "/apps/kb",
        recursive: true,
        fileTypes: ["md"],
        limit: 100
      });

      expect(listAllArgs).toMatchObject({
        path: "/apps/kb",
        recursion: true,
        limit: 100,
        web: true
      });
      expect(listed.structuredContent.items.map((item: any) => item.filename)).toEqual(["a.md"]);
      expect(listed.structuredContent.items[0]).toMatchObject({
        index: 1,
        path: "/apps/kb/a.md",
        fsId: "21"
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("reads selected cached files and runs a skill into notes plus a dry-run organize plan", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-knowledge-tool-"));
    try {
      const cfg = makeConfig(dir);
      const source = join(dir, "source.md");
      await writeFile(source, "# MCP\nModel Context Protocol connects tools to AI.\nTODO: build selector.");
      const selectionStore = new FileSelectionStore(cfg.selectionStorePath);
      const selection = await selectionStore.createSelection([
        {
          fsId: "42",
          path: "/apps/kb/source.md",
          filename: "source.md",
          size: 100,
          isdir: 0
        }
      ]);
      const tools = collectTools({
        config: cfg,
        selectionStore,
        skillRegistry: new FileSkillRegistry({
          userSkillsDir: cfg.skillsDir,
          builtInSkillsDir: join(process.cwd(), "skills")
        }),
        operationLogger: new FileOperationLogger(cfg.operationLogPath),
        client: {
          config: cfg,
          fileMetas: async () => ({
            list: [
              {
                fs_id: 42,
                path: "/apps/kb/source.md",
                server_filename: "source.md",
                dlink: "https://d.pcs.baidu.com/file/source"
              }
            ]
          }),
          downloadDlink: async () => new Response(await readFile(source))
        } as any
      });

      const read = await tools.get("baidu_read_selection")?.({
        selectionId: selection.selectionId,
        chunkSize: 80
      });
      const skill = await tools.get("baidu_run_skill")?.({
        skill: "knowledge-notes",
        selectionId: selection.selectionId
      });
      const plan = await tools.get("baidu_plan_organize_selection")?.({
        selectionId: selection.selectionId,
        targetRoot: "/apps/知识库"
      });

      expect(read.structuredContent.documents[0].text).toContain("Model Context Protocol");
      expect(skill.structuredContent.note).toMatchObject({
        title: "MCP",
        suggestedFolder: "/apps/知识库/AI/MCP"
      });
      expect(plan.structuredContent).toMatchObject({
        dryRun: true,
        operation: "organize_selection",
        itemCount: 1
      });
      expect(plan.structuredContent.moves[0]).toMatchObject({
        from: "/apps/kb/source.md",
        to: "/apps/知识库/AI/MCP/source.md"
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("rejects unsafe organize target roots before proposing moves", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-organize-safety-tool-"));
    try {
      const cfg = makeConfig(dir);
      const source = join(dir, "source.md");
      await writeFile(source, "# MCP\nModel Context Protocol connects tools to AI.");
      const selectionStore = new FileSelectionStore(cfg.selectionStorePath);
      const selection = await selectionStore.createSelection([
        {
          fsId: "42",
          path: "/apps/kb/source.md",
          filename: "source.md",
          isdir: 0
        }
      ]);
      const tools = collectTools({
        config: cfg,
        selectionStore,
        skillRegistry: new FileSkillRegistry({
          userSkillsDir: cfg.skillsDir,
          builtInSkillsDir: join(process.cwd(), "skills")
        }),
        client: {
          config: cfg,
          fileMetas: async () => ({
            list: [{ fs_id: 42, dlink: "https://d.pcs.baidu.com/file/source" }]
          }),
          downloadDlink: async () => new Response(await readFile(source))
        } as any
      });

      await expect(
        tools.get("baidu_plan_organize_selection")?.({
          selectionId: selection.selectionId,
          targetRoot: "/unsafe"
        })
      ).rejects.toThrow(/must be under \/apps/);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("resolves remote Baidu paths before reading a manual path selection", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-path-select-tool-"));
    try {
      const cfg = makeConfig(dir);
      const selectionStore = new FileSelectionStore(cfg.selectionStorePath);
      let listedDir: string | undefined;
      let metaFsids: Array<number | string> | undefined;
      const tools = collectTools({
        config: cfg,
        selectionStore,
        client: {
          config: cfg,
          listFiles: async (args: any) => {
            listedDir = args.dir;
            return {
              list: [
                {
                  fs_id: "9007199254740993",
                  path: "/apps/kb/manual.md",
                  server_filename: "manual.md",
                  isdir: 0
                }
              ]
            };
          },
          fileMetas: async (args: any) => {
            metaFsids = args.fsids;
            return {
              list: [
                {
                  fs_id: "9007199254740993",
                  dlink: "https://d.pcs.baidu.com/file/manual"
                }
              ]
            };
          },
          downloadDlink: async () => new Response("# Manual\nRemote path content.")
        } as any
      });

      const selected = await tools.get("baidu_select_files")?.({
        paths: ["/apps/kb/manual.md"]
      });
      const read = await tools.get("baidu_read_selection")?.({
        selectionId: selected.structuredContent.selectionId
      });

      expect(listedDir).toBe("/apps/kb");
      expect(metaFsids).toEqual(["9007199254740993"]);
      expect(read.structuredContent.documents[0]).toMatchObject({
        filename: "manual.md",
        path: "/apps/kb/manual.md",
        text: "# Manual\nRemote path content."
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("resolves fs_id selections to metadata before reading", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-fsid-select-tool-"));
    try {
      const cfg = makeConfig(dir);
      const selectionStore = new FileSelectionStore(cfg.selectionStorePath);
      let selectedMetaFsids: Array<number | string> | undefined;
      const tools = collectTools({
        config: cfg,
        selectionStore,
        client: {
          config: cfg,
          fileMetas: async (args: any) => {
            selectedMetaFsids = args.fsids;
            return {
              list: [
                {
                  fs_id: "9007199254740993",
                  path: "/apps/kb/by-id.md",
                  server_filename: "by-id.md",
                  isdir: 0,
                  dlink: "https://d.pcs.baidu.com/file/by-id"
                }
              ]
            };
          },
          downloadDlink: async () => new Response("# By ID\nfs_id selected content.")
        } as any
      });

      const selected = await tools.get("baidu_select_files")?.({
        fsids: ["9007199254740993"]
      });
      const read = await tools.get("baidu_read_selection")?.({
        selectionId: selected.structuredContent.selectionId
      });

      expect(selectedMetaFsids).toEqual(["9007199254740993"]);
      expect(selected.structuredContent.items[0]).toMatchObject({
        fsId: "9007199254740993",
        path: "/apps/kb/by-id.md",
        filename: "by-id.md"
      });
      expect(read.structuredContent.documents[0]).toMatchObject({
        filename: "by-id.md",
        path: "/apps/kb/by-id.md",
        text: "# By ID\nfs_id selected content."
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
