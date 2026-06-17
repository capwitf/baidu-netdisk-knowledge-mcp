import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { BaiduNetdiskClient } from "./baiduClient.js";
import { assertWritableRemotePath, resolveLocalPath } from "./paths.js";

export interface UploadFileOptions {
  localPath: string;
  remotePath: string;
  rtype?: 0 | 1 | 2 | 3;
}

export interface DownloadFileOptions {
  fsId: number | string;
  localPath: string;
  overwrite?: boolean;
}

export async function uploadFile(
  client: BaiduNetdiskClient,
  options: UploadFileOptions
): Promise<Record<string, unknown>> {
  assertWritableRemotePath(options.remotePath, client.config.strictAppPaths);
  const localPath = resolveLocalPath(options.localPath, client.config.localRoot);
  const fileStat = await stat(localPath);
  if (!fileStat.isFile()) {
    throw new Error(`Local path is not a file: ${options.localPath}`);
  }

  const { blockList, size } = await computeBlockList(
    localPath,
    client.config.uploadChunkSizeBytes
  );
  const precreate = await client.precreate({
    path: options.remotePath,
    size,
    blockList,
    rtype: options.rtype
  });
  if (!precreate.uploadid) {
    throw new Error("Baidu precreate response did not include uploadid.");
  }

  const { uploadServer } = await client.locateUpload({
    path: options.remotePath,
    uploadid: precreate.uploadid
  });

  const cloudMd5s = await uploadChunks(
    client,
    localPath,
    uploadServer,
    options.remotePath,
    precreate.uploadid,
    client.config.uploadChunkSizeBytes
  );

  return client.createFile({
    path: options.remotePath,
    size,
    blockList: cloudMd5s,
    uploadid: precreate.uploadid,
    rtype: options.rtype
  });
}

export async function downloadFileByFsId(
  client: BaiduNetdiskClient,
  options: DownloadFileOptions
): Promise<{ fsId: number | string; localPath: string; bytesWritten: number; remoteName?: string }> {
  const localPath = resolveLocalPath(options.localPath, client.config.localRoot);
  if (!options.overwrite) {
    await assertDoesNotExist(localPath);
  }

  const metas = await client.fileMetas({
    fsids: [options.fsId],
    dlink: true
  });
  const meta = metas.list?.[0];
  const dlink = typeof meta?.dlink === "string" ? meta.dlink : undefined;
  if (!dlink) {
    throw new Error(`Baidu file metadata for fs_id ${options.fsId} did not include dlink.`);
  }

  const response = await client.downloadDlink(dlink);
  await mkdir(dirname(localPath), { recursive: true });
  const bytesWritten = await writeResponseBody(response, localPath, Boolean(options.overwrite));

  return {
    fsId: options.fsId,
    localPath,
    bytesWritten,
    remoteName:
      typeof meta?.server_filename === "string" ? meta.server_filename : undefined
  };
}

async function computeBlockList(
  localPath: string,
  chunkSize: number
): Promise<{ blockList: string[]; size: number }> {
  const handle = await open(localPath, "r");
  const buffer = Buffer.allocUnsafe(chunkSize);
  const blockList: string[] = [];
  let offset = 0;

  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, offset);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      blockList.push(md5(chunk));
      offset += bytesRead;
      if (blockList.length > 1024) {
        throw new Error("Baidu upload supports at most 1024 chunks.");
      }
    }
  } finally {
    await handle.close();
  }

  if (blockList.length === 0) {
    blockList.push(md5(Buffer.alloc(0)));
  }

  return { blockList, size: offset };
}

async function uploadChunks(
  client: BaiduNetdiskClient,
  localPath: string,
  uploadServer: string,
  remotePath: string,
  uploadid: string,
  chunkSize: number
): Promise<string[]> {
  const handle = await open(localPath, "r");
  const buffer = Buffer.allocUnsafe(chunkSize);
  const cloudMd5s: string[] = [];
  let offset = 0;
  let partseq = 0;

  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, chunkSize, offset);
      if (bytesRead === 0) break;
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      const result = await uploadPartWithRetry(client, {
        uploadServer,
        path: remotePath,
        uploadid,
        partseq,
        chunk,
        filename: basename(localPath)
      });
      cloudMd5s.push(typeof result.md5 === "string" ? result.md5 : md5(chunk));
      offset += bytesRead;
      partseq += 1;
    }
  } finally {
    await handle.close();
  }

  if (cloudMd5s.length === 0) {
    const result = await client.uploadPart({
      uploadServer,
      path: remotePath,
      uploadid,
      partseq: 0,
      chunk: Buffer.alloc(0),
      filename: basename(localPath)
    });
    cloudMd5s.push(typeof result.md5 === "string" ? result.md5 : md5(Buffer.alloc(0)));
  }

  return cloudMd5s;
}

async function uploadPartWithRetry(
  client: BaiduNetdiskClient,
  args: Parameters<BaiduNetdiskClient["uploadPart"]>[0]
): Promise<Awaited<ReturnType<BaiduNetdiskClient["uploadPart"]>>> {
  const maxAttempts = Math.max(1, client.config.transferMaxRetries ?? 3);
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.uploadPart(args);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function writeResponseBody(
  response: Response,
  localPath: string,
  overwrite: boolean
): Promise<number> {
  const body = response.body;
  if (!body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(localPath, buffer, { flag: overwrite ? "w" : "wx" })
    );
    return buffer.byteLength;
  }

  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.byteLength;
      callback(null, chunk);
    }
  });

  await pipeline(
    Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>),
    counter,
    createWriteStream(localPath, { flags: overwrite ? "w" : "wx" })
  );
  return bytes;
}

async function assertDoesNotExist(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`Local file already exists: ${path}`);
}

function md5(buffer: Buffer): string {
  return createHash("md5").update(buffer).digest("hex");
}
