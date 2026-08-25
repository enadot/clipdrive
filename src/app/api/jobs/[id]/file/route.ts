import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextResponse, type NextRequest } from "next/server";

import { getJob, localFile } from "@/lib/jobs";
import { safeFileName } from "@/lib/drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * RFC 5987 allows fewer characters unescaped than encodeURIComponent leaves
 * alone, so a title with an apostrophe or brackets would otherwise produce a
 * header no spec says how to read.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const MIME: Record<string, string> = {
  mp4: "video/mp4",
  mp3: "audio/mpeg",
};

/**
 * Stage 3 for a direct download: the finished file, streamed to whoever pressed
 * the button. It lives in the job's scratch directory until the card is removed,
 * so this stays valid across restarts — and answers honestly when it doesn't.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const job = await getJob(id);

  if (!job || job.destination !== "download") {
    return NextResponse.json({ error: "המשימה לא נמצאה" }, { status: 404 });
  }
  if (job.status !== "done") {
    return NextResponse.json({ error: "הקובץ עוד לא מוכן" }, { status: 409 });
  }

  const file = await localFile(job);
  if (!file) {
    return NextResponse.json(
      { error: "הקובץ כבר לא נמצא כאן. הריצו את ההמרה שוב." },
      { status: 410 },
    );
  }

  const { size } = await stat(file);
  const name = job.fileName ?? safeFileName(job.title, `.${job.format}`);
  const body = Readable.toWeb(
    createReadStream(file),
  ) as unknown as ReadableStream<Uint8Array>;

  return new Response(body, {
    headers: {
      "content-type": MIME[job.format] ?? "application/octet-stream",
      "content-length": String(size),
      // The ASCII fallback is there for the rare client that ignores the
      // RFC 5987 form; Hebrew titles need the encoded one.
      "content-disposition": `attachment; filename="clipdrive.${job.format}"; filename*=UTF-8''${encodeRfc5987(name)}`,
      "cache-control": "no-store",
    },
  });
}
