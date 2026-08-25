import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the MCP server finds ClipDrive, and where it is allowed to put files.
 *
 * The app has no port setting of its own — `next dev` / `next start` take the
 * port from Next's own PORT variable — so the base URL has to be told to us
 * rather than discovered. APP_URL is honoured because the app already uses it
 * for the OAuth redirect, so a user who pinned a port there has said it once.
 */
export interface McpConfig {
  /** Origin of the running ClipDrive app, without a trailing slash. */
  baseUrl: string;
  /** Where `clipdrive_save_file` puts a file when no path is given. */
  downloadDir: string;
  /** When set, no file may be saved outside this directory. */
  saveRoot: string | null;
}

export function resolveConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const raw =
    env.CLIPDRIVE_BASE_URL?.trim() || env.APP_URL?.trim() || "http://localhost:3000";

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `CLIPDRIVE_BASE_URL is not a valid URL: ${JSON.stringify(raw)}. ` +
        `Use something like http://localhost:3000.`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `CLIPDRIVE_BASE_URL must be http or https, got ${JSON.stringify(raw)}.`,
    );
  }

  return {
    baseUrl: raw.replace(/\/+$/, ""),
    downloadDir: resolveDownloadDir(env),
    saveRoot: env.CLIPDRIVE_SAVE_ROOT ? path.resolve(env.CLIPDRIVE_SAVE_ROOT) : null,
  };
}

/**
 * Never the working directory: an MCP server launched by an editor inherits the
 * repo as its cwd, and dropping a multi-gigabyte MP4 into a git worktree is not
 * a helpful default.
 */
function resolveDownloadDir(env: NodeJS.ProcessEnv): string {
  const configured = env.CLIPDRIVE_DOWNLOAD_DIR?.trim();
  if (configured) return path.resolve(configured);

  const downloads = path.join(os.homedir(), "Downloads");
  return existsSync(downloads) ? downloads : os.homedir();
}
