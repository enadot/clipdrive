import { NextResponse, type NextRequest } from "next/server";

import { createBatch } from "@/lib/jobs";
import { QUALITIES, type CreateBatchInput, type Quality } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

/** Many uploads from one channel, queued in one go with the same options. */
export async function POST(request: NextRequest) {
  let body: Partial<CreateBatchInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const items = (Array.isArray(body.items) ? body.items : [])
    .filter((item) => item && typeof item.id === "string" && VIDEO_ID.test(item.id))
    .map((item) => ({
      id: item.id,
      title: typeof item.title === "string" && item.title ? item.title : item.id,
      duration: typeof item.duration === "number" ? item.duration : null,
      thumbnail: typeof item.thumbnail === "string" ? item.thumbnail : "",
    }));

  if (items.length === 0) {
    return NextResponse.json({ error: "לא נבחרו סרטונים" }, { status: 400 });
  }

  const format = body.format === "mp3" ? "mp3" : "mp4";
  const quality: Quality = QUALITIES.includes(body.quality as Quality)
    ? (body.quality as Quality)
    : "1080p";
  const destination = body.destination === "download" ? "download" : "drive";
  if (destination === "drive" && (!body.folderId || !body.folderName)) {
    return NextResponse.json({ error: "צריך לבחור תיקיית יעד" }, { status: 400 });
  }

  const jobs = await createBatch({
    channel: typeof body.channel === "string" ? body.channel : "",
    items,
    format,
    quality,
    destination,
    folderId: body.folderId ?? null,
    folderName: body.folderName ?? null,
  });
  return NextResponse.json({ count: jobs.length }, { status: 201 });
}
