import { constants } from "node:fs";
import { access, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * "Save to a folder on this computer". ClipDrive's server runs on the same
 * machine as the browser, so the server can write the finished file straight
 * into a folder the user names — no download button, no browser involved.
 */

export const DEFAULT_LOCAL_DIR = path.join(os.homedir(), "Downloads", "ClipDrive");

export class LocalFolderError extends Error {}

/** "~/Videos" → "/home/me/Videos"; relative paths are taken from the home folder. */
function expand(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["']$/g, "");
  if (trimmed === "~") return os.homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return path.isAbsolute(trimmed) ? trimmed : path.join(os.homedir(), trimmed);
}

/** A channel name made safe to use as one folder name. */
export function folderNameFor(name: string): string {
  return (
    name
      .replace(/[/\\?%*:|"<>]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^\.+/, "")
      .slice(0, 80) || "ערוץ"
  );
}

/**
 * Resolves the folder, creates it if needed, and checks it can be written to —
 * so a typo fails when the job is queued, not after a 2GB download.
 */
export async function prepareLocalDir(raw: string | null | undefined): Promise<string> {
  if (!raw?.trim()) throw new LocalFolderError("צריך לכתוב לאיזו תיקייה לשמור");
  const dir = path.resolve(expand(raw));
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    await readdir(dir);
  } catch {
    throw new LocalFolderError(`אי אפשר לשמור בתיקייה ${dir} — בדקו את הנתיב וההרשאות`);
  }
  return dir;
}

/** "name.mp4", or "name (2).mp4" when a file by that name is already there. */
export async function freeName(dir: string, fileName: string): Promise<string> {
  const existing = new Set(await readdir(dir).catch(() => [] as string[]));
  if (!existing.has(fileName)) return fileName;
  const ext = path.extname(fileName);
  const base = fileName.slice(0, fileName.length - ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!existing.has(candidate)) return candidate;
  }
}
