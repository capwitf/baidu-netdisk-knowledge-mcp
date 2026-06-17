import { z } from "zod";
import { buildAuthorizeUrl, TokenManager } from "./auth.js";
import type { BaiduConfig } from "./config.js";
import { assertWritableRemotePath } from "./paths.js";
import type { BaiduNetdiskClient } from "./baiduClient.js";
import { parseCachedDocument } from "./contentReader.js";
import { createOperationPlan, type OperationLogger } from "./operationLog.js";
import { FileSelectionStore, selectableFromBaiduEntry, type FileSelection, type SelectableFile } from "./selection.js";
import { FileSkillRegistry, runSkill, type FileSkillRegistry as SkillRegistry } from "./skills.js";
import { downloadFileByFsId, uploadFile } from "./transfer.js";
import { mkdir } from "node:fs/promises";
import { join, posix } from "node:path";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type ToolHandler<T = any> = (args: T) => Promise<ToolResult> | ToolResult;

export interface ToolRegistry {
  registerTool(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: z.ZodTypeAny;
    },
    handler: ToolHandler
  ): unknown;
}

export interface RegisterBaiduToolsDeps {
  config?: BaiduConfig;
  tokenManager?: TokenManager;
  client?: BaiduNetdiskClient;
  operationLogger?: OperationLogger;
  selectionStore?: FileSelectionStore;
  skillRegistry?: SkillRegistry;
}

export function registerBaiduTools(
  registry: ToolRegistry,
  deps: RegisterBaiduToolsDeps = {}
): void {
  registry.registerTool(
    "baidu_auth_status",
    {
      title: "Baidu auth status",
      description: "Check whether the MCP server has a Baidu Netdisk access token.",
      inputSchema: z.object({})
    },
    async () => jsonResult(await requireTokenManager(deps).status())
  );

  registry.registerTool(
    "baidu_auth_url",
    {
      title: "Build Baidu auth URL",
      description: "Build a Baidu OAuth authorization URL for basic,netdisk access.",
      inputSchema: z.object({
        state: z.string().optional(),
        deviceId: z.string().optional(),
        display: z.string().optional(),
        qrcode: z.boolean().optional()
      })
    },
    async (args) => {
      const config = requireConfig(deps);
      if (!config.appKey) throw new Error("Missing BAIDU_APP_KEY.");
      const url = buildAuthorizeUrl({
        appKey: config.appKey,
        redirectUri: config.redirectUri,
        scope: config.scope,
        state: args.state,
        deviceId: args.deviceId,
        display: args.display,
        qrcode: args.qrcode
      });
      return jsonResult({ url: url.toString(), redirectUri: config.redirectUri });
    }
  );

  registry.registerTool(
    "baidu_auth_qrcode_url",
    {
      title: "Build Baidu QR auth URL",
      description: "Build a Baidu OAuth URL optimized for QR-code login.",
      inputSchema: z.object({
        state: z.string().optional(),
        deviceId: z.string().optional()
      })
    },
    async (args) => jsonResult(await buildQrAuthPayload(deps, args, false))
  );

  registry.registerTool(
    "baidu_auth_qrcode",
    {
      title: "Build Baidu QR login",
      description: "Build a QR-code Baidu OAuth URL plus terminal QR and PNG data URL.",
      inputSchema: z.object({
        state: z.string().optional(),
        deviceId: z.string().optional()
      })
    },
    async (args) => jsonResult(await buildQrAuthPayload(deps, args, true))
  );

  registry.registerTool(
    "baidu_auth_exchange_code",
    {
      title: "Exchange Baidu auth code",
      description: "Exchange a Baidu OAuth authorization code for access and refresh tokens.",
      inputSchema: z.object({ code: z.string().min(1) })
    },
    async ({ code }) => {
      const token = await requireTokenManager(deps).exchangeCode(code);
      return jsonResult(redactToken(token));
    }
  );

  registry.registerTool(
    "baidu_auth_refresh",
    {
      title: "Refresh Baidu token",
      description: "Refresh the stored Baidu access token and persist the new single-use refresh token.",
      inputSchema: z.object({})
    },
    async () => jsonResult(redactToken(await requireTokenManager(deps).refresh()))
  );

  registry.registerTool(
    "baidu_operation_log",
    {
      title: "Baidu operation log",
      description: "Read recent local audit records for executed Baidu Netdisk write operations.",
      inputSchema: z.object({
        limit: z.number().int().positive().max(100).default(20)
      })
    },
    async ({ limit }) => jsonResult({ entries: await requireOperationLogger(deps).recent(limit) })
  );

  registry.registerTool(
    "baidu_quota",
    {
      title: "Baidu quota",
      description: "Get Baidu Netdisk total, used, free, and expiring capacity.",
      inputSchema: z.object({})
    },
    async () => jsonResult(await requireClient(deps).quota())
  );

  registry.registerTool(
    "baidu_list_files",
    {
      title: "List Baidu files",
      description: "List files in a Baidu Netdisk directory.",
      inputSchema: z.object({
        dir: z.string().default("/"),
        order: z.enum(["name", "time", "size"]).optional(),
        desc: z.boolean().optional(),
        start: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(1000).optional(),
        web: z.boolean().optional(),
        folder: z.boolean().optional(),
        showempty: z.boolean().optional()
      })
    },
    async (args) => jsonResult(await requireClient(deps).listFiles(args))
  );

  registry.registerTool(
    "baidu_list_all_files",
    {
      title: "Recursively list Baidu files",
      description: "List files below a Baidu Netdisk path, optionally recursively.",
      inputSchema: z.object({
        path: z.string().default("/"),
        recursion: z.boolean().optional(),
        order: z.enum(["name", "time", "size"]).optional(),
        desc: z.boolean().optional(),
        start: z.number().int().nonnegative().optional(),
        limit: z.number().int().positive().max(1000).optional(),
        ctime: z.number().int().optional(),
        mtime: z.number().int().optional(),
        web: z.boolean().optional(),
        deviceId: z.string().optional()
      })
    },
    async (args) => jsonResult(await requireClient(deps).listAllFiles(args))
  );

  registry.registerTool(
    "baidu_search_files",
    {
      title: "Search Baidu files",
      description: "Search Baidu Netdisk files by keyword.",
      inputSchema: z.object({
        key: z.string().min(1).max(30),
        dir: z.string().optional(),
        category: z.number().int().min(1).max(7).optional(),
        recursion: z.boolean().optional(),
        web: z.boolean().optional(),
        page: z.number().int().positive().optional(),
        num: z.number().int().positive().optional(),
        deviceId: z.string().optional()
      })
    },
    async (args) => jsonResult(await requireClient(deps).searchFiles(args))
  );

  registry.registerTool(
    "baidu_search_selectable_files",
    {
      title: "Search selectable Baidu files",
      description: "Search files and return a numbered list that can be selected with expressions like 1,3,5-9.",
      inputSchema: z.object({
        key: z.string().min(1).max(30),
        dir: z.string().optional(),
        category: z.number().int().min(1).max(7).optional(),
        recursion: z.boolean().optional(),
        web: z.boolean().optional()
      })
    },
    async (args) => {
      const raw = await requireClient(deps).searchFiles(args);
      return jsonResult(await saveSelectableResult(deps, raw));
    }
  );

  registry.registerTool(
    "baidu_list_selectable_files",
    {
      title: "List selectable Baidu files",
      description: "List files and return a numbered list that can be selected with expressions like 1,3,5-9.",
      inputSchema: z.object({
        dir: z.string().default("/"),
        recursive: z.boolean().optional(),
        category: z.number().int().min(1).max(7).optional(),
        fileTypes: z.array(z.string()).optional(),
        limit: z.number().int().positive().max(1000).optional()
      })
    },
    async (args) => {
      const raw = args.recursive
        ? await requireClient(deps).listAllFiles({
            path: args.dir,
            recursion: true,
            limit: args.limit,
            web: true
          })
        : await requireClient(deps).listFiles({
            dir: args.dir,
            limit: args.limit,
            web: true
          });
      return jsonResult(await saveSelectableResult(deps, raw, {
        category: args.category,
        fileTypes: args.fileTypes
      }));
    }
  );

  registry.registerTool(
    "baidu_select_files",
    {
      title: "Create Baidu file selection",
      description: "Create a reusable selectionId from a resultId plus an expression such as 1,3,5-9.",
      inputSchema: z.object({
        resultId: z.string().optional(),
        select: z.string().optional(),
        paths: z.array(z.string()).optional(),
        fsids: z.array(z.union([z.number().int(), z.string()])).optional()
      })
    },
    async (args) => {
      const store = requireSelectionStore(deps);
      if (args.resultId && args.select) {
        return jsonResult(await store.createSelectionFromIndexes(args.resultId, args.select));
      }
      const items: SelectableFile[] = [];
      for (const path of args.paths ?? []) {
        items.push(await resolveRemotePathToSelectableFile(requireClient(deps), path));
      }
      for (const fsid of args.fsids ?? []) {
        items.push(await resolveFsIdToSelectableFile(requireClient(deps), fsid));
      }
      if (items.length === 0) throw new Error("Provide resultId/select, paths, or fsids.");
      return jsonResult(await store.createSelection(items));
    }
  );

  registry.registerTool(
    "baidu_file_metas",
    {
      title: "Get Baidu file metadata",
      description: "Get metadata for one or more Baidu Netdisk fs_id values.",
      inputSchema: z.object({
        fsids: z.array(z.union([z.number().int(), z.string()])).min(1).max(100),
        dlink: z.boolean().optional(),
        thumb: z.boolean().optional(),
        extra: z.boolean().optional(),
        needmedia: z.boolean().optional(),
        detail: z.boolean().optional(),
        path: z.string().optional(),
        deviceId: z.string().optional()
      })
    },
    async (args) => jsonResult(await requireClient(deps).fileMetas(args))
  );

  registry.registerTool(
    "baidu_create_folder",
    {
      title: "Create Baidu folder",
      description: "Create a folder under /apps/<appName> in Baidu Netdisk.",
      inputSchema: z.object({
        path: z.string().min(1),
        rtype: z.union([z.literal(0), z.literal(1)]).optional(),
        dryRun: z.boolean().optional()
      })
    },
    async (args) => {
      const client = requireClient(deps);
      assertWritableRemotePath(args.path, client.config.strictAppPaths);
      if (args.dryRun) {
        return jsonResult(createOperationPlan({
          operation: "create_folder",
          paths: [args.path],
          request: args
        }));
      }
      const response = await client.createFolder(args);
      await recordOperation(deps, {
        operation: "create_folder",
        paths: [args.path],
        request: args,
        response
      });
      return jsonResult(response);
    }
  );

  registry.registerTool(
    "baidu_rename_file",
    {
      title: "Rename Baidu file",
      description: "Rename a Baidu Netdisk file or folder.",
      inputSchema: z.object({
        path: z.string().min(1),
        newname: z.string().min(1),
        async: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
        dryRun: z.boolean().optional()
      })
    },
    async (args) => {
      const client = requireClient(deps);
      assertWritableRemotePath(args.path, client.config.strictAppPaths);
      if (args.dryRun) {
        return jsonResult(createOperationPlan({
          operation: "rename",
          paths: [args.path],
          request: args
        }));
      }
      const response = await client.manageFile({
        opera: "rename",
        async: args.async,
        filelist: [{ path: args.path, newname: args.newname }]
      });
      await recordOperation(deps, {
        operation: "rename",
        paths: [args.path],
        request: args,
        response
      });
      return jsonResult(response);
    }
  );

  registry.registerTool(
    "baidu_copy_file",
    {
      title: "Copy Baidu file",
      description: "Copy a Baidu Netdisk file or folder.",
      inputSchema: z.object({
        path: z.string().min(1),
        dest: z.string().min(1),
        newname: z.string().optional(),
        ondup: z.enum(["fail", "newcopy", "overwrite"]).optional(),
        async: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
        dryRun: z.boolean().optional()
      })
    },
    async (args) => copyOrMove("copy", deps, args)
  );

  registry.registerTool(
    "baidu_move_file",
    {
      title: "Move Baidu file",
      description: "Move a Baidu Netdisk file or folder.",
      inputSchema: z.object({
        path: z.string().min(1),
        dest: z.string().min(1),
        newname: z.string().optional(),
        ondup: z.enum(["fail", "newcopy", "overwrite"]).optional(),
        async: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
        dryRun: z.boolean().optional()
      })
    },
    async (args) => copyOrMove("move", deps, args)
  );

  registry.registerTool(
    "baidu_delete_file",
    {
      title: "Delete Baidu file",
      description: "Delete Baidu Netdisk files. Requires confirm: DELETE.",
      inputSchema: z.object({
        paths: z.array(z.string().min(1)).min(1),
        confirm: z.literal("DELETE").optional(),
        async: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
        dryRun: z.boolean().optional()
      })
    },
    async (args) => {
      const client = requireClient(deps);
      for (const path of args.paths) {
        assertWritableRemotePath(path, client.config.strictAppPaths);
      }
      if (args.dryRun) {
        return jsonResult(createOperationPlan({
          operation: "delete",
          paths: args.paths,
          requiresConfirm: "DELETE",
          request: args
        }));
      }
      if (args.confirm !== "DELETE") {
        throw new Error('Deleting files requires confirm: "DELETE".');
      }
      const response = await client.manageFile({
        opera: "delete",
        async: args.async,
        filelist: args.paths
      });
      await recordOperation(deps, {
        operation: "delete",
        paths: args.paths,
        request: args,
        response
      });
      return jsonResult(response);
    }
  );

  registry.registerTool(
    "baidu_upload_file",
    {
      title: "Upload file to Baidu",
      description: "Upload a local file to Baidu Netdisk using the official multipart upload flow.",
      inputSchema: z.object({
        localPath: z.string().min(1),
        remotePath: z.string().min(1),
        rtype: z.union([
          z.literal(0),
          z.literal(1),
          z.literal(2),
          z.literal(3)
        ]).optional()
      })
    },
    async (args) => jsonResult(await uploadFile(requireClient(deps), args))
  );

  registry.registerTool(
    "baidu_download_file",
    {
      title: "Download Baidu file",
      description: "Download a Baidu Netdisk file by fs_id to the configured local root.",
      inputSchema: z.object({
        fsId: z.union([z.number().int(), z.string()]),
        localPath: z.string().min(1),
        overwrite: z.boolean().optional()
      })
    },
    async (args) => jsonResult(await downloadFileByFsId(requireClient(deps), args))
  );

  registry.registerTool(
    "baidu_read_selection",
    {
      title: "Read selected Baidu files",
      description: "Download selected files to local cache, parse supported document formats, and return chunked text.",
      inputSchema: z.object({
        selectionId: z.string(),
        chunkSize: z.number().int().positive().max(20000).optional()
      })
    },
    async (args) => jsonResult({ documents: await readSelectionDocuments(deps, args.selectionId, args.chunkSize) })
  );

  registry.registerTool(
    "baidu_analyze_selection",
    {
      title: "Analyze selected Baidu files",
      description: "Summarize selected files with key points, actions, tags, value judgment, and suggested classification.",
      inputSchema: z.object({
        selectionId: z.string(),
        chunkSize: z.number().int().positive().max(20000).optional()
      })
    },
    async (args) => {
      const docs = await readSelectionDocuments(deps, args.selectionId, args.chunkSize);
      return jsonResult(analyzeDocuments(docs));
    }
  );

  registry.registerTool(
    "baidu_list_skills",
    {
      title: "List knowledge skills",
      description: "List built-in and user-defined Markdown/YAML knowledge processing skills.",
      inputSchema: z.object({})
    },
    async () => jsonResult({ skills: await requireSkillRegistry(deps).listSkills() })
  );

  registry.registerTool(
    "baidu_run_skill",
    {
      title: "Run knowledge skill",
      description: "Run a configured knowledge processing skill over a selectionId.",
      inputSchema: z.object({
        skill: z.string(),
        selectionId: z.string(),
        chunkSize: z.number().int().positive().max(20000).optional()
      })
    },
    async (args) => {
      const docs = await readSelectionDocuments(deps, args.selectionId, args.chunkSize);
      const skill = await requireSkillRegistry(deps).getSkill(args.skill);
      return jsonResult(runSkill(skill, docs));
    }
  );

  registry.registerTool(
    "baidu_plan_organize_selection",
    {
      title: "Plan selected file organization",
      description: "Create a dry-run folder organization plan for selected files. It does not move files.",
      inputSchema: z.object({
        selectionId: z.string(),
        targetRoot: z.string().default("/apps/知识库"),
        skill: z.string().default("knowledge-notes")
      })
    },
    async (args) => {
      const config = requireConfig(deps);
      const targetRoot = args.targetRoot ?? "/apps/知识库";
      assertWritableRemotePath(targetRoot, config.strictAppPaths);
      const docs = await readSelectionDocuments(deps, args.selectionId);
      const skill = await requireSkillRegistry(deps).getSkill(args.skill ?? "knowledge-notes");
      const result = runSkill(skill, docs);
      const moves = docs.map((doc) => ({
        from: doc.path,
        to: `${result.note.suggestedFolder.replace(/^\/apps\/知识库/, targetRoot)}/${doc.filename}`
      }));
      return jsonResult({
        dryRun: true,
        operation: "organize_selection",
        itemCount: moves.length,
        note: result.note,
        moves,
        nextStep: "Review the plan, then use baidu_move_file with dryRun=false for each approved move."
      });
    }
  );
}

async function buildQrAuthPayload(
  deps: RegisterBaiduToolsDeps,
  args: { state?: string; deviceId?: string },
  includeImage: boolean
): Promise<Record<string, unknown>> {
  const config = requireConfig(deps);
  if (!config.appKey) throw new Error("Missing BAIDU_APP_KEY.");
  const url = buildAuthorizeUrl({
    appKey: config.appKey,
    redirectUri: config.redirectUri,
    scope: config.scope,
    state: args.state,
    deviceId: args.deviceId,
    qrcode: true
  });
  const terminalQr = await terminalQrString(url.toString());
  return {
    url: url.toString(),
    terminalQr,
    qrDataUrl: includeImage ? await QRCode.toDataURL(url.toString()) : undefined,
    nextStep: "Scan the QR code, copy the returned code, then call baidu_auth_exchange_code."
  };
}

function copyOrMove(
  opera: "copy" | "move",
  deps: RegisterBaiduToolsDeps,
  args: {
    path: string;
    dest: string;
    newname?: string;
    ondup?: "fail" | "newcopy" | "overwrite";
    async?: 0 | 1 | 2;
    dryRun?: boolean;
  }
): Promise<ToolResult> {
  const client = requireClient(deps);
  assertWritableRemotePath(args.path, client.config.strictAppPaths);
  assertWritableRemotePath(args.dest, client.config.strictAppPaths);
  if (args.dryRun) {
    return Promise.resolve(jsonResult(createOperationPlan({
      operation: opera,
      paths: [args.path],
      request: args
    })));
  }
  return client
    .manageFile({
      opera,
      async: args.async,
      ondup: args.ondup,
      filelist: [{ path: args.path, dest: args.dest, newname: args.newname }]
    })
    .then(async (response) => {
      await recordOperation(deps, {
        operation: opera,
        paths: [args.path],
        request: args,
        response
      });
      return jsonResult(response);
    });
}

function requireConfig(deps: RegisterBaiduToolsDeps): BaiduConfig {
  if (!deps.config) throw new Error("Baidu MCP config is not initialized.");
  return deps.config;
}

function requireTokenManager(deps: RegisterBaiduToolsDeps): TokenManager {
  if (!deps.tokenManager) throw new Error("Baidu token manager is not initialized.");
  return deps.tokenManager;
}

function requireClient(deps: RegisterBaiduToolsDeps): BaiduNetdiskClient {
  if (!deps.client) throw new Error("Baidu Netdisk client is not initialized.");
  return deps.client;
}

function requireOperationLogger(deps: RegisterBaiduToolsDeps): OperationLogger {
  if (!deps.operationLogger) throw new Error("Baidu operation logger is not initialized.");
  return deps.operationLogger;
}

function requireSelectionStore(deps: RegisterBaiduToolsDeps): FileSelectionStore {
  if (deps.selectionStore) return deps.selectionStore;
  return new FileSelectionStore(requireConfig(deps).selectionStorePath);
}

function requireSkillRegistry(deps: RegisterBaiduToolsDeps): SkillRegistry {
  if (deps.skillRegistry) return deps.skillRegistry;
  const config = requireConfig(deps);
  return new FileSkillRegistry({
    userSkillsDir: config.skillsDir,
    builtInSkillsDir: join(process.cwd(), "skills")
  });
}

async function saveSelectableResult(
  deps: RegisterBaiduToolsDeps,
  raw: unknown,
  filters: { category?: number; fileTypes?: string[] } = {}
): Promise<Record<string, unknown>> {
  const entries = extractList(raw).map(selectableFromBaiduEntry).filter((item) => {
    if (item.isdir === 1) return false;
    if (filters.category !== undefined && item.category !== filters.category) return false;
    if (filters.fileTypes?.length) {
      const lower = item.filename.toLowerCase();
      if (!filters.fileTypes.some((ext) => lower.endsWith(ext.toLowerCase().startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`))) return false;
    }
    return true;
  });
  const result = await requireSelectionStore(deps).saveResultList(entries);
  return { ...result, source: raw };
}

function extractList(raw: unknown): Record<string, unknown>[] {
  if (typeof raw === "object" && raw !== null && Array.isArray((raw as { list?: unknown }).list)) {
    return (raw as { list: Record<string, unknown>[] }).list;
  }
  throw new Error("Baidu response did not include a list array.");
}

async function readSelectionDocuments(
  deps: RegisterBaiduToolsDeps,
  selectionId: string,
  chunkSize?: number
): Promise<Array<{ filename: string; path: string; text: string; chunks: Array<{ index: number; text: string }>; metadata: unknown }>> {
  const selection = await requireSelectionStore(deps).getSelection(selectionId);
  const docs = [];
  for (const item of selection.items) {
    if (item.isdir === 1) continue;
    const localPath = await ensureCachedFile(deps, selection, item);
    const parsed = await parseCachedDocument(localPath, { chunkSize });
    docs.push({
      filename: item.filename,
      path: item.path,
      text: parsed.text,
      chunks: parsed.chunks,
      metadata: {
        ...parsed.metadata,
        fsId: item.fsId,
        cachePath: localPath
      }
    });
  }
  return docs;
}

async function ensureCachedFile(
  deps: RegisterBaiduToolsDeps,
  selection: FileSelection,
  item: { fsId: string; filename: string; path: string }
): Promise<string> {
  const config = requireConfig(deps);
  const selectionCache = join(config.cacheRoot, selection.selectionId);
  await mkdir(selectionCache, { recursive: true });
  const localPath = join(selectionCache, safeFilename(item.filename));
  const client = requireClient(deps);
  if (item.fsId.startsWith("path:")) {
    item = await resolveRemotePathToSelectableFile(client, item.fsId.slice("path:".length));
  }
  const response = await client.downloadDlink(await resolveDlink(client, item.fsId));
  const buffer = Buffer.from(await response.arrayBuffer());
  await import("node:fs/promises").then(({ writeFile }) => writeFile(localPath, buffer));
  return localPath;
}

async function resolveRemotePathToSelectableFile(
  client: BaiduNetdiskClient,
  remotePath: string
): Promise<SelectableFile> {
  const normalizedPath = normalizeRemotePath(remotePath);
  const filename = posix.basename(normalizedPath);
  const raw = await client.listFiles({
    dir: posix.dirname(normalizedPath),
    limit: 1000,
    web: true
  });
  const entry = extractList(raw).find((candidate) => {
    return candidate.path === normalizedPath || candidate.server_filename === filename || candidate.filename === filename;
  });
  if (!entry) throw new Error(`Could not resolve Baidu path: ${normalizedPath}`);
  const file = selectableFromBaiduEntry(entry);
  if (file.isdir === 1) throw new Error(`Baidu path is a directory, not a readable file: ${normalizedPath}`);
  return file;
}

async function resolveFsIdToSelectableFile(
  client: BaiduNetdiskClient,
  fsid: number | string
): Promise<SelectableFile> {
  const fsId = String(fsid);
  const metas = await client.fileMetas({ fsids: [fsId] });
  const entry = metas.list?.find((candidate) => {
    return String(candidate.fs_id) === fsId || String(candidate.fsId) === fsId;
  }) ?? metas.list?.[0];
  if (!entry) throw new Error(`Could not resolve Baidu fs_id: ${fsId}`);
  const file = selectableFromBaiduEntry(entry);
  if (file.isdir === 1) throw new Error(`Baidu fs_id is a directory, not a readable file: ${fsId}`);
  return file;
}

function normalizeRemotePath(remotePath: string): string {
  const trimmed = remotePath.trim();
  if (!trimmed.startsWith("/")) throw new Error(`Baidu remote paths must start with "/": ${remotePath}`);
  return posix.normalize(trimmed);
}

async function resolveDlink(client: BaiduNetdiskClient, fsId: string): Promise<string> {
  const metas = await client.fileMetas({ fsids: [fsId], dlink: true });
  const dlink = metas.list?.find((entry) => String(entry.fs_id) === fsId || String(entry.fsId) === fsId)?.dlink ?? metas.list?.[0]?.dlink;
  if (typeof dlink !== "string") throw new Error(`No dlink for fs_id ${fsId}.`);
  return dlink;
}

function analyzeDocuments(docs: Array<{ filename: string; path: string; text: string }>): Record<string, unknown> {
  const combined = docs.map((doc) => doc.text).join("\n\n");
  const result = runSkill({
    name: "knowledge-notes",
    description: "Default knowledge analysis",
    category: "knowledge",
    template: "Analyze selected files.",
    outputSchema: "knowledge-note"
  }, docs.map((doc) => ({ ...doc, chunks: [] })));
  return {
    summary: result.note.summary,
    keyPoints: result.note.keyPoints,
    actionItems: result.note.actionItems,
    tags: result.note.tags,
    valueJudgment: combined.length > 200 ? "high" : "medium",
    suggestedFolder: result.note.suggestedFolder,
    executablePlan: [
      "Review extracted note.",
      `Move useful files into ${result.note.suggestedFolder} after approval.`,
      "Archive or delete low-value duplicates only after explicit confirmation."
    ],
    documents: docs.map((doc) => ({ filename: doc.filename, path: doc.path }))
  };
}

function terminalQrString(url: string): Promise<string> {
  return new Promise((resolve) => {
    qrcodeTerminal.generate(url, { small: true }, (qr: string) => resolve(qr));
  });
}

function safeFilename(filename: string): string {
  return filename.replace(/[\\/:*?"<>|]/g, "_");
}

async function recordOperation(
  deps: RegisterBaiduToolsDeps,
  input: {
    operation: string;
    paths: string[];
    request: unknown;
    response: unknown;
  }
): Promise<void> {
  await deps.operationLogger?.record({
    ...input,
    status: "executed"
  });
}

function jsonResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent:
      typeof data === "object" && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : { value: data }
  };
}

function redactToken(token: {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}): Record<string, unknown> {
  return {
    accessToken: token.accessToken ? redact(token.accessToken) : undefined,
    refreshToken: token.refreshToken ? redact(token.refreshToken) : undefined,
    expiresAt: token.expiresAt,
    scope: token.scope
  };
}

function redact(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
