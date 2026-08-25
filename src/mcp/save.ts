import { createWriteStream, existsSync, statSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type { McpConfig } from "./config";
import { ToolError } from "./errors";
import type { ClipdriveClient } from "./client";
import type { Job } from "../lib/types";

export interface SaveResult {
  path: string;
  fileName: string;
  bytes: number;
  contentType: string;
  overwritten: boolean;
}

/**
 * Copies a finished direct-download job's file out of ClipDrive's scratch
 * directory to wherever the caller wants it.
 *
 * The app keeps its own copy until the job's card is removed, so this is a
 * copy, not a move — which is why the tool description points at
 * `clipdrive_remove_job` afterwards.
 */
export async function saveJobFile(opts: {
  client: ClipdriveClient;
  config: McpConfig;
  job: Job;
  /** A file path, an existing directory, or undefined for the default directory. */
  target?: string;
  overwrite: boolean;
}): Promise<SaveResult> {
  const res = await opts.client.fileResponse(opts.job.id);
  if (!res.body) throw new ToolError("ClipDrive returned an empty response body.");

  const fileName = pickFileName(res, opts.job);
  const target = resolveTarget(opts.config, opts.target, fileName);
  assertInsideSaveRoot(target, opts.config);

  const existed = existsSync(target);
  if (existed && !opts.overwrite) {
    throw new ToolError(
      `A file already exists at ${target}. Pass overwrite=true to replace it, or give a different path. ` +
        `Nothing was written and ClipDrive still holds its copy.`,
    );
  }

  await mkdir(path.dirname(target), { recursive: true });

  // Written under a .part name and promoted on success: a killed transfer must
  // never leave something that looks like a finished file.
  const partial = `${target}.clipdrive-part`;
  try {
    await pipeline(chunks(res.body), createWriteStream(partial));
  } catch (err) {
    await rm(partial, { force: true });
    throw new ToolError(
      `Writing ${target} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const written = statSync(partial).size;
  const expected = Number(res.headers.get("content-length") ?? 0);
  if (expected > 0 && written !== expected) {
    await rm(partial, { force: true });
    throw new ToolError(
      `Truncated transfer: expected ${expected} bytes, wrote ${written}. Nothing was saved; try again.`,
    );
  }

  await rename(partial, target);

  return {
    path: target,
    fileName: path.basename(target),
    bytes: written,
    contentType: res.headers.get("content-type") ?? "application/octet-stream",
    overwritten: existed,
  };
}

/**
 * The response body as an async iterable. Going through the reader by hand
 * rather than `Readable.fromWeb` keeps the DOM `ReadableStream` this file sees
 * (the app's tsconfig includes the DOM lib) away from node:stream's own copy of
 * the same type, which are structurally different and don't assign.
 */
async function* chunks(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * The header carries the real (usually Hebrew) name in the RFC 5987 form, and a
 * deliberately generic `clipdrive.mp4` ASCII fallback for clients that can't
 * read it. Prefer the encoded one — the fallback is the same for every video.
 */
function pickFileName(res: Response, job: Job): string {
  const disposition = res.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
  if (encoded) {
    try {
      return sanitize(decodeURIComponent(encoded));
    } catch {
      /* a malformed header shouldn't cost us the download */
    }
  }
  if (job.fileName) return sanitize(job.fileName);
  return `clipdrive-${job.id}.${job.format}`;
}

/**
 * The app already strips separators in `safeFileName`, so this is defence in
 * depth: a name that arrives over the wire never gets to choose a directory.
 */
function sanitize(name: string): string {
  const base = path.basename(name.replace(/[/\\?%*:|"<>]/g, "-")).trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 200) : "clipdrive-download";
}

function resolveTarget(
  config: McpConfig,
  target: string | undefined,
  fileName: string,
): string {
  if (!target) return path.join(config.downloadDir, fileName);

  const resolved = path.resolve(config.downloadDir, target);
  // A path that already names a directory means "put it in here".
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return path.join(resolved, fileName);
  }
  if (target.endsWith("/") || target.endsWith(path.sep)) {
    return path.join(resolved, fileName);
  }
  return resolved;
}

/** Opt-in confinement for an operator who wants one. Off unless configured. */
function assertInsideSaveRoot(target: string, config: McpConfig): void {
  if (!config.saveRoot) return;
  const relative = path.relative(config.saveRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ToolError(
      `Refusing to write outside CLIPDRIVE_SAVE_ROOT (${config.saveRoot}): ${target}`,
    );
  }
}
