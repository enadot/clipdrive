import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { google, type drive_v3 } from "googleapis";

import { authorizedClient } from "./google-auth";
import { ensureDirs, FOLDER_USAGE_FILE } from "./paths";
import type { DriveFolder } from "./types";

async function client(): Promise<drive_v3.Drive> {
  return google.drive({ version: "v3", auth: await authorizedClient() });
}

const FOLDER_MIME = "application/vnd.google-apps.folder";

/** Local record of when each folder was last written to, for "אחרונות". */
type FolderUsage = Record<string, number>;

async function readUsage(): Promise<FolderUsage> {
  try {
    return JSON.parse(await readFile(FOLDER_USAGE_FILE, "utf8")) as FolderUsage;
  } catch {
    return {};
  }
}

async function touchFolder(folderId: string): Promise<void> {
  ensureDirs();
  const usage = await readUsage();
  usage[folderId] = Date.now();
  await writeFile(FOLDER_USAGE_FILE, JSON.stringify(usage, null, 2));
}

/**
 * Lists the folders this app created. With the `drive.file` scope that is the
 * entire visible universe — hence the picker's "folders are created inside
 * ClipDrive only" note.
 */
export async function listFolders(): Promise<DriveFolder[]> {
  const drive = await client();
  const usage = await readUsage();

  const { data } = await drive.files.list({
    q: `mimeType='${FOLDER_MIME}' and trashed=false`,
    fields: "files(id,name,createdTime)",
    orderBy: "createdTime desc",
    pageSize: 100,
    spaces: "drive",
  });

  const folders = (data.files ?? []).filter(
    (f): f is drive_v3.Schema$File & { id: string; name: string } =>
      Boolean(f.id && f.name),
  );

  const counted = await Promise.all(
    folders.map(async (f) => ({
      id: f.id,
      name: f.name,
      lastUsed: usage[f.id] ?? null,
      fileCount: await countFiles(drive, f.id),
    })),
  );

  // Recently used first, then everything else newest-first (list order).
  return counted.sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
}

async function countFiles(drive: drive_v3.Drive, folderId: string): Promise<number | null> {
  try {
    const { data } = await drive.files.list({
      q: `'${folderId}' in parents and trashed=false`,
      fields: "files(id)",
      pageSize: 1000,
    });
    return data.files?.length ?? 0;
  } catch {
    return null;
  }
}

export async function createFolder(name: string): Promise<DriveFolder> {
  const drive = await client();
  const { data } = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME },
    fields: "id,name",
  });
  if (!data.id || !data.name) throw new Error("יצירת התיקייה נכשלה");
  return { id: data.id, name: data.name, lastUsed: null, fileCount: 0 };
}

export interface UploadResult {
  fileId: string;
  webViewLink: string;
  bytes: number;
}

/**
 * Stage 3. googleapis handles the resumable session; we report progress off the
 * request stream so the third meter segment moves with the real byte count.
 */
export async function uploadFile(opts: {
  filePath: string;
  name: string;
  mimeType: string;
  folderId: string;
  totalBytes: number;
  onProgress: (percent: number) => void;
  signal?: AbortSignal;
}): Promise<UploadResult> {
  const drive = await client();

  let sent = 0;
  const body = createReadStream(opts.filePath);
  body.on("data", (chunk: string | Buffer) => {
    sent += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
    if (opts.totalBytes > 0) {
      opts.onProgress(Math.min(100, (sent / opts.totalBytes) * 100));
    }
  });

  opts.signal?.addEventListener("abort", () => body.destroy(), { once: true });

  const { data } = await drive.files.create({
    requestBody: {
      name: opts.name,
      parents: [opts.folderId],
    },
    media: { mimeType: opts.mimeType, body },
    fields: "id,webViewLink,size",
  });

  if (!data.id) throw new Error("ההעלאה לדרייב נכשלה");

  opts.onProgress(100);
  await touchFolder(opts.folderId);

  return {
    fileId: data.id,
    webViewLink:
      data.webViewLink ?? `https://drive.google.com/file/d/${data.id}/view`,
    bytes: Number(data.size ?? opts.totalBytes),
  };
}

/**
 * Drive rejects a handful of characters in names; everything else — Hebrew
 * included — is passed through untouched.
 */
export function safeFileName(title: string, ext: string): string {
  const cleaned = title
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${cleaned || "clipdrive"}${path.extname(ext) || ext}`;
}
