import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { FileTokenStore, TokenManager } from "./auth.js";
import { BaiduNetdiskClient } from "./baiduClient.js";
import type { BaiduConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { FileOperationLogger } from "./operationLog.js";
import { FileSelectionStore } from "./selection.js";
import { FileSkillRegistry } from "./skills.js";
import { registerBaiduTools } from "./tools.js";

export function createBaiduMcpServer(config: BaiduConfig = loadConfig()): McpServer {
  const tokenManager = new TokenManager({
    config,
    store: new FileTokenStore(config.tokenStorePath)
  });
  const client = new BaiduNetdiskClient({
    config,
    tokenProvider: tokenManager
  });
  const operationLogger = new FileOperationLogger(config.operationLogPath);
  const selectionStore = new FileSelectionStore(config.selectionStorePath);
  const skillRegistry = new FileSkillRegistry({
    userSkillsDir: config.skillsDir,
    builtInSkillsDir: fileURLToPath(new URL("../skills", import.meta.url))
  });

  const server = new McpServer({
    name: "baidu-netdisk-mcp",
    version: "0.1.0"
  });

  registerBaiduTools(server, {
    config,
    tokenManager,
    client,
    operationLogger,
    selectionStore,
    skillRegistry
  });
  return server;
}

export async function runStdioServer(config: BaiduConfig = loadConfig()): Promise<void> {
  const server = createBaiduMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
