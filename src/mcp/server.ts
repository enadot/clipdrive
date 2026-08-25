import { McpServer } from "@modelcontextprotocol/server";

import { ClipdriveClient } from "./client";
import type { McpConfig } from "./config";
import { registerClipdriveTools, SERVER_INSTRUCTIONS } from "./tools";

export const SERVER_INFO = { name: "clipdrive-mcp-server", version: "1.0.0" } as const;

/**
 * One server instance with every ClipDrive tool on it.
 *
 * Both transports call this: the stdio entry once for the process, and the HTTP
 * route once per request (that entry is stateless by design). Nothing here
 * holds state between calls, so a fresh instance costs nothing.
 */
export function createClipdriveServer(config: McpConfig): McpServer {
  const server = new McpServer(SERVER_INFO, {
    capabilities: { tools: {} },
    instructions: SERVER_INSTRUCTIONS,
  });
  registerClipdriveTools(server, new ClipdriveClient(config.baseUrl), config);
  return server;
}
