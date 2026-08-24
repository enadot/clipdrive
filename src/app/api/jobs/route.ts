import { NextResponse, type NextRequest } from "next/server";

import { createJob, listJobs } from "@/lib/jobs";
import { NotConnectedError } from "@/lib/google-auth";
import { QUALITIES, type CreateJobInput, type Quality } from "@/lib/types";
import { normalizeYoutubeUrl, YoutubeError } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ jobs: await listJobs() });
}

export async function POST(request: NextRequest) {
  let body: Partial<CreateJobInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const url = typeof body.url === "string" ? normalizeYoutubeUrl(body.url) : null;
  if (!url) {
    return NextResponse.json(
      { error: "זה לא לינק יוטיוב. בדקו את הכתובת.", code: "not_youtube" },
      { status: 400 },
    );
  }

  const format = body.format === "mp3" ? "mp3" : "mp4";
  const quality: Quality = QUALITIES.includes(body.quality as Quality)
    ? (body.quality as Quality)
    : "1080p";

  if (!body.folderId || !body.folderName) {
    return NextResponse.json({ error: "צריך לבחור תיקיית יעד" }, { status: 400 });
  }

  try {
    const job = await createJob({
      url,
      format,
      quality,
      folderId: body.folderId,
      folderName: body.folderName,
    });
    return NextResponse.json({ job }, { status: 201 });
  } catch (err) {
    if (err instanceof NotConnectedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof YoutubeError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 },
      );
    }
    const message = err instanceof Error ? err.message : "משהו השתבש";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
