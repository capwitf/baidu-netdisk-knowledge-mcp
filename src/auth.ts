import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { BaiduConfig } from "./config.js";
import { requireOAuthConfig } from "./config.js";

export interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope?: string;
}

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

export interface TokenStore {
  load(): Promise<StoredToken | undefined>;
  save(token: StoredToken): Promise<void>;
  clear(): Promise<void>;
}

export interface BuildAuthorizeUrlOptions {
  appKey: string;
  redirectUri: string;
  scope: string;
  state?: string;
  deviceId?: string;
  display?: string;
  qrcode?: boolean;
}

export interface TokenManagerOptions {
  config: BaiduConfig;
  store?: TokenStore;
  fetch?: typeof fetch;
  now?: () => number;
}

interface BaiduTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

export class FileTokenStore implements TokenStore {
  constructor(private readonly path: string) {}

  async load(): Promise<StoredToken | undefined> {
    try {
      const raw = await readFile(this.path, "utf8");
      return JSON.parse(raw) as StoredToken;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(token: StoredToken): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tempPath = `${this.path}.${process.pid}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(token, null, 2)}\n`, {
      mode: 0o600
    });
    await rename(tempPath, this.path);
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

export class TokenManager implements TokenProvider {
  private readonly store: TokenStore;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private refreshInFlight?: Promise<StoredToken>;

  constructor(private readonly options: TokenManagerOptions) {
    this.store =
      options.store ?? new FileTokenStore(options.config.tokenStorePath);
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  async status(): Promise<{
    authenticated: boolean;
    source: "env" | "store" | "none";
    expiresAt?: number;
    expiresInSeconds?: number;
    scope?: string;
  }> {
    if (this.options.config.accessToken) {
      return { authenticated: true, source: "env" };
    }

    const token = await this.store.load();
    if (!token) return { authenticated: false, source: "none" };

    return {
      authenticated: true,
      source: "store",
      expiresAt: token.expiresAt,
      expiresInSeconds: token.expiresAt
        ? Math.max(0, token.expiresAt - this.now())
        : undefined,
      scope: token.scope
    };
  }

  async exchangeCode(code: string): Promise<StoredToken> {
    const { appKey, secretKey } = requireOAuthConfig(this.options.config);
    const url = new URL("https://openapi.baidu.com/oauth/2.0/token");
    url.searchParams.set("grant_type", "authorization_code");
    url.searchParams.set("code", code);
    url.searchParams.set("client_id", appKey);
    url.searchParams.set("client_secret", secretKey);
    url.searchParams.set("redirect_uri", this.options.config.redirectUri);

    const token = await this.fetchToken(url);
    await this.store.save(token);
    return token;
  }

  async refresh(): Promise<StoredToken> {
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.performRefresh().finally(() => {
      this.refreshInFlight = undefined;
    });
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<StoredToken> {
    const { appKey, secretKey } = requireOAuthConfig(this.options.config);
    const current = await this.store.load();
    const refreshToken =
      current?.refreshToken ?? this.options.config.refreshToken;
    if (!refreshToken) {
      throw new Error("No refresh token available. Run authorization again.");
    }

    const url = new URL("https://openapi.baidu.com/oauth/2.0/token");
    url.searchParams.set("grant_type", "refresh_token");
    url.searchParams.set("refresh_token", refreshToken);
    url.searchParams.set("client_id", appKey);
    url.searchParams.set("client_secret", secretKey);

    const token = await this.fetchToken(url);
    await this.store.save(token);
    return token;
  }

  async getAccessToken(): Promise<string> {
    if (this.options.config.accessToken) {
      return this.options.config.accessToken;
    }

    const token = await this.store.load();
    if (!token) {
      throw new Error("No Baidu access token. Use baidu_auth_url and baidu_auth_exchange_code first.");
    }

    const refreshWindowSeconds = 300;
    if (
      token.expiresAt !== undefined &&
      token.expiresAt <= this.now() + refreshWindowSeconds
    ) {
      return (await this.refresh()).accessToken;
    }

    return token.accessToken;
  }

  async clear(): Promise<void> {
    await this.store.clear();
  }

  private async fetchToken(url: URL): Promise<StoredToken> {
    const response = await this.fetchImpl(url);
    const payload = (await response.json()) as BaiduTokenResponse;
    if (!response.ok || payload.error) {
      throw new Error(
        payload.error_description ??
          payload.error ??
          `Baidu OAuth request failed with HTTP ${response.status}.`
      );
    }
    if (!payload.access_token) {
      throw new Error("Baidu OAuth response did not include access_token.");
    }

    return {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt:
        payload.expires_in === undefined
          ? undefined
          : this.now() + payload.expires_in,
      scope: payload.scope
    };
  }
}

export function buildAuthorizeUrl(options: BuildAuthorizeUrlOptions): URL {
  const url = new URL("https://openapi.baidu.com/oauth/2.0/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.appKey);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("scope", options.scope);
  if (options.state) url.searchParams.set("state", options.state);
  if (options.deviceId) url.searchParams.set("device_id", options.deviceId);
  if (options.display) url.searchParams.set("display", options.display);
  if (options.qrcode) url.searchParams.set("qrcode", "1");
  return url;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
