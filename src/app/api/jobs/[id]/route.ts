import { NextResponse, type NextRequest } from "next/server";

import {
  cancelJob,
  getJob,
  pauseJob,
  removeJob,
  resumeJob,
  retryJob,
} from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The card's action buttons all land here: pause, resume, retry. */
export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;

  let action: unknown;
  try {
    ({ action } = await request.json());
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  if (!(await getJob(id))) {
    return NextResponse.json({ error: "המשימה לא נמצאה" }, { status: 404 });
  }

  switch (action) {
    case "pause":
      pauseJob(id);
      break;
    case "resume":
      resumeJob(id);
      break;
    case "retry":
      retryJob(id);
      break;
    default:
      return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  }

  return NextResponse.json({ job: await getJob(id) });
}

/**
 * ✕ on a card. A running job is canceled and its scratch files removed; a
 * finished one is just dropped from the list — the Drive file stays put.
 */
export async function DELETE(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ ok: true });

  if (job.status === "running" || job.status === "queued" || job.status === "paused") {
    await cancelJob(id);
  } else {
    await removeJob(id);
  }

  return NextResponse.json({ ok: true });
}
