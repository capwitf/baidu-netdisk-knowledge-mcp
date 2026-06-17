import type { BaiduConfig } from "./config.js";
import type { TokenProvider } from "./auth.js";

export class BaiduApiError extends Error {
  readonly name = "BaiduApiError";

  constructor(
    readonly code: number | string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export interface BaiduNetdiskClientOptions {
  config: BaiduConfig;
  tokenProvider: TokenProvider;
  fetch?: typeof fetch;
}

type Params = Record<string, string | number | boolean | undefined>;

export class BaiduNetdiskClient {
  readonly config: BaiduConfig;
  private readonly tokenProvider: TokenProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BaiduNetdiskClientOptions) {
    this.config = options.config;
    this.tokenProvider = options.tokenProvider;
    this.fetchImpl = options.fetch ?? fetch;
  }

  getAccessToken(): Promise<string> {
    return this.tokenProvider.getAccessToken();
  }

  async quota(): Promise<unknown> {
    return this.getJson("https://pan.baidu.com/api/quota", {
      checkfree: 1,
      checkexpire: 1
    });
  }

  async listFiles(args: {
    dir?: string;
    order?: "name" | "time" | "size";
    desc?: boolean;
    start?: number;
    limit?: number;
    web?: boolean;
    folder?: boolean;
    showempty?: boolean;
  }): Promise<unknown> {
    return this.getJson("https://pan.baidu.com/rest/2.0/xpan/file", {
      method: "list",
      dir: args.dir ?? "/",
      order: args.order,
      desc: args.desc ? 1 : undefined,
      start: args.start,
      limit: args.limit,
      web: args.web ? 1 : undefined,
      folder: args.folder ? 1 : undefined,
      showempty: args.showempty ? 1 : undefined
    });
  }

  async listAllFiles(args: {
    path: string;
    recursion?: boolean;
    order?: "name" | "time" | "size";
    desc?: boolean;
    start?: number;
    limit?: number;
    ctime?: number;
    mtime?: number;
    web?: boolean;
    deviceId?: string;
  }): Promise<unknown> {
    return this.getJson("https://pan.baidu.com/rest/2.0/xpan/multimedia", {
      method: "listall",
      path: args.path,
      recursion: args.recursion ? 1 : 0,
      order: args.order,
      desc: args.desc ? 1 : 0,
      start: args.start,
      limit: args.limit,
      ctime: args.ctime,
      mtime: args.mtime,
      web: args.web ? 1 : undefined,
      device_id: args.deviceId
    });
  }

  async searchFiles(args: {
    key: string;
    dir?: string;
    category?: number;
    recursion?: boolean;
    web?: boolean;
    page?: number;
    num?: number;
    deviceId?: string;
  }): Promise<unknown> {
    return this.getJson("https://pan.baidu.com/rest/2.0/xpan/file", {
      method: "search",
      key: args.key,
      dir: args.dir,
      category: args.category,
      recursion: args.recursion ? 1 : undefined,
      web: args.web ? 1 : undefined,
      page: args.page,
      num: args.num,
      device_id: args.deviceId
    });
  }

  async fileMetas(args: {
    fsids: Array<number | string>;
    dlink?: boolean;
    thumb?: boolean;
    extra?: boolean;
    needmedia?: boolean;
    detail?: boolean;
    path?: string;
    deviceId?: string;
  }): Promise<{ list?: Array<Record<string, unknown>>; [key: string]: unknown }> {
    return this.getJson("https://pan.baidu.com/rest/2.0/xpan/multimedia", {
      method: "filemetas",
      fsids: formatFsids(args.fsids),
      dlink: args.dlink ? 1 : undefined,
      thumb: args.thumb ? 1 : undefined,
      extra: args.extra ? 1 : undefined,
      needmedia: args.needmedia ? 1 : undefined,
      detail: args.detail ? 1 : undefined,
      path: args.path,
      device_id: args.deviceId
    });
  }

  async createFolder(args: {
    path: string;
    rtype?: 0 | 1;
    localCtime?: number;
    localMtime?: number;
    mode?: number;
  }): Promise<unknown> {
    return this.postForm("https://pan.baidu.com/rest/2.0/xpan/file", {
      method: "create"
    }, {
      path: args.path,
      isdir: 1,
      rtype: args.rtype ?? 1,
      local_ctime: args.localCtime,
      local_mtime: args.localMtime,
      mode: args.mode
    });
  }

  async manageFile(args: {
    opera: "copy" | "move" | "rename" | "delete";
    filelist: unknown[];
    async?: 0 | 1 | 2;
    ondup?: "fail" | "newcopy" | "overwrite";
  }): Promise<unknown> {
    return this.postForm("https://pan.baidu.com/rest/2.0/xpan/file", {
      method: "filemanager",
      opera: args.opera
    }, {
      async: args.async ?? 1,
      filelist: JSON.stringify(args.filelist),
      ondup: args.ondup
    });
  }

  async precreate(args: {
    path: string;
    size: number;
    blockList: string[];
    rtype?: 0 | 1 | 2 | 3;
  }): Promise<{ uploadid?: string; [key: string]: unknown }> {
    return this.postForm("https://pan.baidu.com/rest/2.0/xpan/file", {
      method: "precreate"
    }, {
      path: args.path,
      size: args.size,
      isdir: 0,
      block_list: JSON.stringify(args.blockList),
      autoinit: 1,
      rtype: args.rtype ?? 1
    });
  }

  async locateUpload(args: {
    path: string;
    uploadid: string;
  }): Promise<{ uploadServer: string; raw: unknown }> {
    const raw = await this.getJson<{
      servers?: Array<{ server?: string }>;
      server?: Array<{ server?: string }>;
    }>("https://d.pcs.baidu.com/rest/2.0/pcs/file", {
      method: "locateupload",
      appid: 250528,
      path: args.path,
      uploadid: args.uploadid,
      upload_version: "2.0"
    });

    const servers = [...(raw.servers ?? []), ...(raw.server ?? [])];
    const uploadServer = servers
      .map((entry) => entry.server)
      .find((server): server is string => Boolean(server?.startsWith("https://")));
    if (!uploadServer) {
      throw new Error("Baidu locateupload response did not include an https upload server.");
    }

    return { uploadServer, raw };
  }

  async uploadPart(args: {
    uploadServer: string;
    path: string;
    uploadid: string;
    partseq: number;
    chunk: Buffer;
    filename: string;
  }): Promise<{ md5?: string; [key: string]: unknown }> {
    const url = new URL("/rest/2.0/pcs/superfile2", args.uploadServer);
    addParams(url, {
      method: "upload",
      type: "tmpfile",
      path: args.path,
      uploadid: args.uploadid,
      partseq: args.partseq,
      access_token: await this.getAccessToken()
    });

    const form = new FormData();
    form.append("file", new Blob([args.chunk as BlobPart]), args.filename);
    return this.requestJson(url, {
      method: "POST",
      headers: this.headers(),
      body: form
    });
  }

  async createFile(args: {
    path: string;
    size: number;
    blockList: string[];
    uploadid: string;
    rtype?: 0 | 1 | 2 | 3;
  }): Promise<Record<string, unknown>> {
    return this.postForm("https://pan.baidu.com/rest/2.0/xpan/file", {
      method: "create"
    }, {
      path: args.path,
      size: args.size,
      isdir: 0,
      block_list: JSON.stringify(args.blockList),
      uploadid: args.uploadid,
      rtype: args.rtype ?? 1
    });
  }

  async downloadDlink(dlink: string): Promise<Response> {
    const url = new URL(dlink);
    url.searchParams.set("access_token", await this.getAccessToken());
    const response = await this.fetchImpl(url, {
      headers: this.headers()
    });
    if (!response.ok) {
      throw new Error(`Baidu download failed with HTTP ${response.status}.`);
    }
    return response;
  }

  private async getJson<T = Record<string, unknown>>(
    url: string,
    params: Params
  ): Promise<T> {
    const target = new URL(url);
    addParams(target, params);
    target.searchParams.set("access_token", await this.getAccessToken());
    return this.requestJson<T>(target, {
      headers: this.headers()
    });
  }

  private async postForm<T = Record<string, unknown>>(
    url: string,
    query: Params,
    body: Params
  ): Promise<T> {
    const target = new URL(url);
    addParams(target, query);
    target.searchParams.set("access_token", await this.getAccessToken());

    const form = new URLSearchParams();
    addSearchParams(form, body);
    return this.requestJson<T>(target, {
      method: "POST",
      headers: {
        ...this.headers(),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: form
    });
  }

  private async requestJson<T>(url: URL, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(url, init);
    const payload = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(`Baidu request failed with HTTP ${response.status}.`);
    }
    throwOnBaiduError(payload);
    return payload as T;
  }

  private headers(): Record<string, string> {
    return {
      "User-Agent": this.config.userAgent
    };
  }
}

function addParams(url: URL, params: Params): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
}

function addSearchParams(target: URLSearchParams, params: Params): void {
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    target.set(key, String(value));
  }
}

function throwOnBaiduError(payload: Record<string, unknown>): void {
  const code = payload.errno ?? payload.error_code;
  if (code === undefined || code === 0 || code === "0") return;

  const message =
    stringValue(payload.errmsg) ??
    stringValue(payload.error_msg) ??
    stringValue(payload.error_description) ??
    `Baidu API returned error ${String(code)}.`;

  throw new BaiduApiError(code as number | string, message, payload);
}

function formatFsids(fsids: Array<number | string>): string {
  return `[${fsids.map(formatFsid).join(",")}]`;
}

function formatFsid(fsid: number | string): string {
  if (typeof fsid === "number") {
    if (!Number.isSafeInteger(fsid) || fsid < 0) {
      throw new Error(`fs_id numbers must be non-negative safe integers. Pass large uint64 fs_id values as strings: ${fsid}`);
    }
    return String(fsid);
  }

  if (!/^\d+$/.test(fsid)) {
    throw new Error(`fs_id strings must contain decimal digits only: ${fsid}`);
  }
  return fsid;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
