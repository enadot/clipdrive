import { NextResponse, type NextRequest } from "next/server";

import {
  authorizedClient,
  clearToken,
  fetchEmail,
  isConfigured,
  readToken,
  redirectUri,
} from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Drives the "connected / not connected" split between screens 2a and 1b.
 *
 * It also reports `redirectUri` — the exact string this app sends to Google.
 * A redirect_uri_mismatch is always a disagreement between that string and the
 * console's "Authorized redirect URIs", so having it printed somewhere makes
 * the mismatch a two-second comparison instead of a guessing game.
 */
export async function GET(request: NextRequest) {
  const uri = redirectUri(request.nextUrl.origin);

  if (!isConfigured()) {
    return NextResponse.json({
      connected: false,
      email: null,
      configured: false,
      redirectUri: uri,
    });
  }

  const stored = await readToken();
  if (!stored) {
    return NextResponse.json({
      connected: false,
      email: null,
      configured: true,
      redirectUri: uri,
    });
  }

  if (stored.email) {
    return NextResponse.json({
      connected: true,
      email: stored.email,
      configured: true,
      redirectUri: uri,
    });
  }

  try {
    const email = await fetchEmail(await authorizedClient());
    return NextResponse.json({
      connected: true,
      email,
      configured: true,
      redirectUri: uri,
    });
  } catch {
    return NextResponse.json({
      connected: false,
      email: null,
      configured: true,
      redirectUri: uri,
    });
  }
}

/** Disconnect — drops the stored token and returns the app to the empty state. */
export async function DELETE() {
  await clearToken();
  return NextResponse.json({ connected: false, email: null });
}
