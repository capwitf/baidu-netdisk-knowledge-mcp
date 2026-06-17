import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createBaiduMcpServer } from "../src/server.js";
import type { BaiduConfig } from "../src/config.js";

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

describe("MCP integration", () => {
  it("lists Baidu Netdisk tools through the MCP protocol", async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createBaiduMcpServer(config);
    const client = new Client({ name: "test-client", version: "1.0.0" });

    await server.connect(serverTransport);
    await client.connect(clientTransport);

    try {
      const result = await client.listTools();
      expect(result.tools.map((tool) => tool.name)).toContain("baidu_list_files");
      expect(result.tools.map((tool) => tool.name)).toContain("baidu_upload_file");
      expect(result.tools).toHaveLength(27);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
