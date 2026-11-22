import { PassThrough, Readable } from "node:stream";

import archiver from "archiver";
import { NextResponse, type NextRequest } from "next/server";

import { safeFileName } from "@/lib/drive";
import { listJobs, localFile } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Every finished direct-download file in one ZIP — or just one batch's, with
 * ?batch=<id>. Streamed as it is built, and stored rather than compressed:
 * MP4 and MP3 are already compressed, so deflating them would cost minutes of
 * CPU to save almost nothing. ZIP64 is automatic, so a 10GB channel is fine.
 */
export async function GET(request: NextRequest) {
  const batch = request.nextUrl.searchParams.get("batch");

  const jobs = (await listJobs()).filter(
    (job) =>
      job.destination === "download" &&
      job.status === "done" &&
      (!batch || job.batchId === batch),
  );

  const files: Array<{ path: string; name: string }> = [];
  const used = new Set<string>();
  // Oldest first, so the archive reads in the order the videos were queued.
  for (const job of [...jobs].reverse()) {
    const file = await localFile(job);
    if (!file) continue;
    const wanted = job.fileName ?? safeFileName(job.title, `.${job.format}`);
    let name = wanted;
    const dot = wanted.lastIndexOf(".");
    for (let n = 2; used.has(name); n++) {
      name = `${wanted.slice(0, dot)} (${n})${wanted.slice(dot)}`;
    }
    used.add(name);
    files.push({ path: file, name });
  }

  if (files.length === 0) {
    return NextResponse.json({ error: "אין קבצים מוכנים להורדה" }, { status: 404 });
  }

  const archive = archiver("zip", { store: true });
  const out = new PassThrough();
  archive.on("error", (err) => out.destroy(err));
  archive.pipe(out);
  for (const file of files) archive.file(file.path, { name: file.name });
  void archive.finalize();

  // The user closed the tab mid-download: stop reading files for nobody.
  request.signal.addEventListener("abort", () => archive.abort(), { once: true });

  const channel = batch ? jobs.find((j) => j.batchId === batch)?.channel : null;
  const zipName = `${channel ? safeFileName(channel, "") : "ClipDrive"} (${files.length}).zip`;

  return new Response(Readable.toWeb(out) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="clipdrive.zip"; filename*=UTF-8''${encodeRfc5987(zipName)}`,
      "cache-control": "no-store",
    },
  });
}
