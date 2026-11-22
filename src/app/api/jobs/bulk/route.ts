import { NextResponse, type NextRequest } from "next/server";

import { cancelMany } from "@/lib/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** { action: "clear-queue" } drops what's waiting; "cancel-all" also stops the running one. */
export async function POST(request: NextRequest) {
  let action: unknown;
  try {
    ({ action } = await request.json());
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }
  if (action !== "clear-queue" && action !== "cancel-all") {
    return NextResponse.json({ error: "פעולה לא מוכרת" }, { status: 400 });
  }
  const count = await cancelMany(action === "cancel-all" ? "all" : "queue");
  return NextResponse.json({ count });
}
