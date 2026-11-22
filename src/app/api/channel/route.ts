import { NextResponse, type NextRequest } from "next/server";

import { fetchChannelTab } from "@/lib/channel";
import { normalizeChannelUrl } from "@/lib/channel-url";
import { LINK_ERROR_TEXT, YoutubeError } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One tab of a channel — its videos or its Shorts — newest first. */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url") ?? "";
  const tab = request.nextUrl.searchParams.get("tab") === "shorts" ? "shorts" : "videos";

  const base = normalizeChannelUrl(raw);
  if (!base) {
    return NextResponse.json(
      { error: "זה לא לינק של ערוץ יוטיוב.", code: "not_youtube" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ listing: await fetchChannelTab(base, tab, request.signal) });
  } catch (err) {
    if (err instanceof YoutubeError) {
      return NextResponse.json(
        { error: err.message, code: err.code, detail: err.detail },
        { status: 400 },
      );
    }
    console.error("[clipdrive] channel listing failed:", err);
    return NextResponse.json({ error: LINK_ERROR_TEXT.unknown }, { status: 500 });
  }
}
