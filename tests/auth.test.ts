import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildAuthorizeUrl,
  FileTokenStore,
  TokenManager
} from "../src/auth.js";
import type { BaiduConfig } from "../src/config.js";

const baseConfig = (tokenStorePath: string): BaiduConfig => ({
  appKey: "app-key",
  secretKey: "secret-key",
  redirectUri: "oob",
  scope: "basic,netdisk",
  tokenStorePath,
  operationLogPath: "operations.jsonl",
  selectionStorePath: "selections.json",
  cacheRoot: "cache",
  skillsDir: "skills",
  localRoot: process.cwd(),
  userAgent: "pan.baidu.com",
  uploadChunkSizeBytes: 4 * 1024 * 1024,
  strictAppPaths: true
});

describe("Baidu OAuth helpers", () => {
  it("builds an authorization URL with required Baidu Netdisk scope", () => {
    const url = buildAuthorizeUrl({
      appKey: "abc",
      redirectUri: "oob",
      scope: "basic,netdisk",
      state: "csrf-token"
    });

    expect(url.origin).toBe("https://openapi.baidu.com");
    expect(url.pathname).toBe("/oauth/2.0/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("abc");
    expect(url.searchParams.get("redirect_uri")).toBe("oob");
    expect(url.searchParams.get("scope")).toBe("basic,netdisk");
    expect(url.searchParams.get("state")).toBe("csrf-token");
  });

  it("exchanges an authorization code and persists token metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-auth-"));
    try {
      const storePath = join(dir, "tokens.json");
      const manager = new TokenManager({
        config: baseConfig(storePath),
        store: new FileTokenStore(storePath),
        fetch: async (input) => {
          const url = new URL(String(input));
          expect(url.searchParams.get("grant_type")).toBe("authorization_code");
          expect(url.searchParams.get("code")).toBe("code-123");
          return Response.json({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 2592000,
            scope: "basic netdisk"
          });
        },
        now: () => 1000
      });

      const token = await manager.exchangeCode("code-123");
      const saved = JSON.parse(await readFile(storePath, "utf8"));

      expect(token.accessToken).toBe("access-1");
      expect(token.refreshToken).toBe("refresh-1");
      expect(token.expiresAt).toBe(2593000);
      expect(saved.accessToken).toBe("access-1");
      expect(saved.refreshToken).toBe("refresh-1");
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("refreshes an expiring token and replaces the single-use refresh token", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-refresh-"));
    try {
      const storePath = join(dir, "tokens.json");
      const store = new FileTokenStore(storePath);
      await store.save({
        accessToken: "old-access",
        refreshToken: "old-refresh",
        expiresAt: 1050,
        scope: "basic netdisk"
      });

      const manager = new TokenManager({
        config: baseConfig(storePath),
        store,
        fetch: async (input) => {
          const url = new URL(String(input));
          expect(url.searchParams.get("grant_type")).toBe("refresh_token");
          expect(url.searchParams.get("refresh_token")).toBe("old-refresh");
          return Response.json({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 2592000,
            scope: "basic netdisk"
          });
        },
        now: () => 1000
      });

      await expect(manager.getAccessToken()).resolves.toBe("new-access");
      await expect(store.load()).resolves.toMatchObject({
        accessToken: "new-access",
        refreshToken: "new-refresh"
      });
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("coalesces concurrent refreshes because Baidu refresh tokens are single-use", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baidu-refresh-race-"));
    try {
      const storePath = join(dir, "tokens.json");
      const store = new FileTokenStore(storePath);
      await store.save({
        accessToken: "old-access",
        refreshToken: "single-use-refresh",
        expiresAt: 1050,
        scope: "basic netdisk"
      });
      let refreshCalls = 0;

      const manager = new TokenManager({
        config: baseConfig(storePath),
        store,
        fetch: async () => {
          refreshCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 10));
          return Response.json({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 2592000,
            scope: "basic netdisk"
          });
        },
        now: () => 1000
      });

      await expect(
        Promise.all([manager.getAccessToken(), manager.getAccessToken()])
      ).resolves.toEqual(["new-access", "new-access"]);
      expect(refreshCalls).toBe(1);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });
});
