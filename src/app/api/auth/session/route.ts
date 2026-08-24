import { NextResponse } from "next/server";

import {
  authorizedClient,
  clearToken,
  fetchEmail,
  isConfigured,
  readToken,
} from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Drives the "connected / not connected" split between screens 2a and 1b. */
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json({
      connected: false,
      email: null,
      configured: false,
    });
  }

  const stored = await readToken();
  if (!stored) {
    return NextResponse.json({ connected: false, email: null, configured: true });
  }

  if (stored.email) {
    return NextResponse.json({
      connected: true,
      email: stored.email,
      configured: true,
    });
  }

  try {
    const email = await fetchEmail(await authorizedClient());
    return NextResponse.json({ connected: true, email, configured: true });
  } catch {
    return NextResponse.json({ connected: false, email: null, configured: true });
  }
}

/** Disconnect — drops the stored token and returns the app to the empty state. */
export async function DELETE() {
  await clearToken();
  return NextResponse.json({ connected: false, email: null });
}
