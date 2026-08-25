import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Everything the server writes lives under one root so a single-user install
 * stays tidy and easy to wipe. Override with CLIPDRIVE_DATA_DIR.
 */
export const DATA_DIR =
  process.env.CLIPDRIVE_DATA_DIR ?? path.join(os.homedir(), ".clipdrive");

export const WORK_DIR = path.join(DATA_DIR, "work");
export const TOKEN_FILE = path.join(DATA_DIR, "token.json");
export const HISTORY_FILE = path.join(DATA_DIR, "history.json");
export const FOLDER_USAGE_FILE = path.join(DATA_DIR, "folders.json");

export function ensureDirs(): void {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(WORK_DIR, { recursive: true });
}

/** Where one job's intermediate files live — without creating the directory. */
export function jobDirPath(jobId: string): string {
  return path.join(WORK_DIR, jobId);
}

/** Scratch directory for one job's intermediate files. */
export function jobDir(jobId: string): string {
  const dir = jobDirPath(jobId);
  mkdirSync(dir, { recursive: true });
  return dir;
}
