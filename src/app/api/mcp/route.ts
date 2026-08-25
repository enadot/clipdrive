import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
  localhostAllowedOrigins,
  originValidationResponse,
} from "@modelcontextprotocol/server";
import type { NextRequest } from "next/server";

import { resolveConfig } from "@/mcp/config";
import { createClipdriveServer } from "@/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The same MCP server the stdio entry serves, reachable over HTTP for clients
 * that prefer a URL to a subprocess. `createMcpHandler` is fetch-shaped, so the
 * App Router's Request/Response is all it needs.
 *
 * The factory runs per request and the handler keeps nothing between them; a
 * ClipDrive tool call is a short HTTP hop to this same app, so there is no
 * session worth holding.
 *
 * The tools reach the app the same way the browser does, over HTTP — the job
 * queue is an in-process singleton and the routes own every bit of validation,
 * so one code path serves both transports. Taking the base URL from the
 * request's own origin means this endpoint needs no configuration whatever port
 * Next ended up on.
 */
const handler = createMcpHandler((ctx) => {
  const config = resolveConfig();
  const origin = ctx.requestInfo ? new URL(ctx.requestInfo.url).origin : config.baseUrl;
  return createClipdriveServer({ ...config, baseUrl: origin });
});

/**
 * A local MCP endpoint with no authentication is exactly what DNS rebinding
 * goes after: a page the user visits resolves its own hostname to 127.0.0.1 and
 * starts driving this app. Rejecting unexpected Host and Origin headers is what
 * stops that; it is not authentication, and is not meant to be.
 */
export async function POST(request: NextRequest): Promise<Response> {
  const badHost = hostHeaderValidationResponse(request, localhostAllowedHostnames());
  if (badHost) return badHost;

  const badOrigin = originValidationResponse(request, localhostAllowedOrigins());
  if (badOrigin) return badOrigin;

  return handler.fetch(request);
}
