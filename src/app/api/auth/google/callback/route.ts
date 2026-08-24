import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { fetchEmail, oauthClient, writeToken } from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const home = new URL("/", request.nextUrl.origin);

  if (params.get("error")) {
    home.searchParams.set("auth", "denied");
    return NextResponse.redirect(home);
  }

  const code = params.get("code");
  const state = params.get("state");
  const store = await cookies();
  const expected = store.get("clipdrive_oauth_state")?.value;

  if (!code || !state || !expected || state !== expected) {
    home.searchParams.set("auth", "failed");
    return NextResponse.redirect(home);
  }

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);
    await writeToken({ ...tokens, email: await fetchEmail(client) });
    home.searchParams.set("auth", "connected");
  } catch {
    home.searchParams.set("auth", "failed");
  }

  store.delete("clipdrive_oauth_state");
  return NextResponse.redirect(home);
}
