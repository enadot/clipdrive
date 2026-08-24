import { NextResponse, type NextRequest } from "next/server";

import { fetchMetadata, LINK_ERROR_TEXT, YoutubeError } from "@/lib/youtube";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Backs the preview card on screen 2a: as soon as a link is pasted, this fills
 * in the title, channel, duration, thumbnail and per-quality size estimates.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json(
      { error: LINK_ERROR_TEXT.not_youtube, code: "not_youtube" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json({ video: await fetchMetadata(url) });
  } catch (err) {
    if (err instanceof YoutubeError) {
      return NextResponse.json(
        { error: err.message, code: err.code, detail: err.detail },
        { status: 400 },
      );
    }
    return NextResponse.json(
      { error: LINK_ERROR_TEXT.unknown, code: "unknown" },
      { status: 500 },
    );
  }
}
