import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface BaiduConfig {
  appKey?: string;
  secretKey?: string;
  redirectUri: string;
  scope: string;
  tokenStorePath: string;
  operationLogPath: string;
  selectionStorePath: string;
  cacheRoot: string;
  skillsDir: string;
  localRoot: string;
  userAgent: string;
  uploadChunkSizeBytes: number;
  transferMaxRetries?: number;
  strictAppPaths: boolean;
  accessToken?: string;
  refreshToken?: string;
}

const DEFAULT_CHUNK_SIZE = 4 * 1024 * 1024;

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
  home = homedir()
): BaiduConfig {
  return {
    appKey: envValue(env.BAIDU_APP_KEY) ?? envValue(env.BAIDU_CLIENT_ID),
    secretKey:
      envValue(env.BAIDU_SECRET_KEY) ?? envValue(env.BAIDU_CLIENT_SECRET),
    redirectUri: envValue(env.BAIDU_REDIRECT_URI) ?? "oob",
    scope: envValue(env.BAIDU_SCOPE) ?? "basic,netdisk",
    tokenStorePath:
      envValue(env.BAIDU_TOKEN_STORE) ??
      join(home, ".baidu-netdisk-mcp", "tokens.json"),
    operationLogPath:
      envValue(env.BAIDU_OPERATION_LOG) ??
      join(home, ".baidu-netdisk-mcp", "operations.jsonl"),
    selectionStorePath:
      envValue(env.BAIDU_SELECTION_STORE) ??
      join(home, ".baidu-netdisk-mcp", "selections.json"),
    cacheRoot:
      envValue(env.BAIDU_CACHE_ROOT) ??
      join(home, ".baidu-netdisk-mcp", "cache"),
    skillsDir:
      envValue(env.BAIDU_SKILLS_DIR) ??
      join(home, ".baidu-netdisk-mcp", "skills"),
    localRoot: resolve(envValue(env.BAIDU_LOCAL_ROOT) ?? cwd),
    userAgent: envValue(env.BAIDU_USER_AGENT) ?? "pan.baidu.com",
    uploadChunkSizeBytes: parsePositiveInteger(
      envValue(env.BAIDU_UPLOAD_CHUNK_SIZE_BYTES),
      DEFAULT_CHUNK_SIZE
    ),
    transferMaxRetries: parsePositiveInteger(
      envValue(env.BAIDU_TRANSFER_MAX_RETRIES),
      3
    ),
    strictAppPaths: parseBoolean(envValue(env.BAIDU_STRICT_APP_PATHS), true),
    accessToken: envValue(env.BAIDU_ACCESS_TOKEN),
    refreshToken: envValue(env.BAIDU_REFRESH_TOKEN)
  };
}

export function requireOAuthConfig(config: BaiduConfig): {
  appKey: string;
  secretKey: string;
} {
  if (!config.appKey) {
    throw new Error("Missing BAIDU_APP_KEY.");
  }
  if (!config.secretKey) {
    throw new Error("Missing BAIDU_SECRET_KEY.");
  }
  return { appKey: config.appKey, secretKey: config.secretKey };
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, got ${value}.`);
  }
  return parsed;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function envValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
