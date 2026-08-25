#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { resolveConfig } from "./config";
import { createClipdriveServer } from "./server";

/**
 * Stdio entry point for the ClipDrive MCP server.
 *
 * Launch it directly — `node_modules/.bin/tsx src/mcp/stdio.ts` — and never
 * through `npm run`: npm prints the script banner to stdout, and on this
 * transport stdout carries the JSON-RPC frames. For the same reason every
 * diagnostic below goes to stderr.
 */
console.log = console.error;

function main(): void {
  let config;
  try {
    config = resolveConfig();
  } catch (err) {
    // Failing here, at connect time, puts a readable line in the client's
    // server log; failing on the first tool call would not.
    console.error(`clipdrive-mcp: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  serveStdio(() => createClipdriveServer(config));

  console.error(
    `clipdrive-mcp: ready, talking to ${config.baseUrl} ` +
      `(saving downloads to ${config.downloadDir} by default)`,
  );
}

main();
