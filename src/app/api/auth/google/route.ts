import { randomBytes } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { consentUrl, isConfigured } from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Kicks off the OAuth dance from the "חיבור לגוגל דרייב" button. */
export async function GET() {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: "חסרה הגדרת OAuth. ראו .env.example." },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");

  const store = await cookies();
  store.set("clipdrive_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });

  return NextResponse.redirect(consentUrl(state));
}
