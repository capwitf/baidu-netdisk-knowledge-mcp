import { describe, expect, it } from "vitest";
import { join, resolve } from "node:path";
import { loadConfig } from "../src/config.js";

describe("configuration loading", () => {
  it("treats blank optional environment values as unset so defaults still apply", () => {
    const config = loadConfig(
      {
        BAIDU_TOKEN_STORE: "",
        BAIDU_LOCAL_ROOT: "",
        BAIDU_USER_AGENT: "",
        BAIDU_UPLOAD_CHUNK_SIZE_BYTES: "",
        BAIDU_STRICT_APP_PATHS: ""
      },
      "C:/workspace/project",
      "C:/Users/example"
    );

    expect(config.tokenStorePath).toBe(
      join("C:/Users/example", ".baidu-netdisk-mcp", "tokens.json")
    );
    expect(config.localRoot).toBe(resolve("C:/workspace/project"));
    expect(config.userAgent).toBe("pan.baidu.com");
    expect(config.uploadChunkSizeBytes).toBe(4 * 1024 * 1024);
    expect(config.strictAppPaths).toBe(true);
  });
});
