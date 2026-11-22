import { NextResponse, type NextRequest } from "next/server";

import { findDateRange } from "@/lib/channel";
import { YoutubeError } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

/**
 * Which slice of a newest-first list was uploaded between two dates. Opens only
 * the handful of videos the search needs to look at, not the whole list.
 */
export async function POST(request: NextRequest) {
  let body: { ids?: unknown; from?: unknown; to?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids)
    ? body.ids.filter((id): id is string => typeof id === "string" && VIDEO_ID.test(id))
    : [];
  const from = typeof body.from === "string" && ISO_DATE.test(body.from) ? body.from : null;
  const to = typeof body.to === "string" && ISO_DATE.test(body.to) ? body.to : null;

  if (ids.length === 0 || (!from && !to)) {
    return NextResponse.json({ error: "צריך רשימת סרטונים ולפחות תאריך אחד" }, { status: 400 });
  }
  if (from && to && from > to) {
    return NextResponse.json({ error: "תאריך ההתחלה מאוחר מתאריך הסיום" }, { status: 400 });
  }

  try {
    return NextResponse.json(await findDateRange(ids, from, to, request.signal));
  } catch (err) {
    const message =
      err instanceof YoutubeError || err instanceof Error
        ? err.message
        : "לא הצלחנו לבדוק את התאריכים";
    return NextResponse.json(
      { error: message, detail: err instanceof YoutubeError ? err.detail : undefined },
      { status: 400 },
    );
  }
}
