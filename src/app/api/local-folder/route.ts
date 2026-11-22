import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_LOCAL_DIR, LocalFolderError, prepareLocalDir } from "@/lib/local-folder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The folder offered before the user has picked one. */
export async function GET() {
  return NextResponse.json({ path: DEFAULT_LOCAL_DIR });
}

/** Checks (and creates) a folder as it's typed, so a bad path shows up early. */
export async function POST(request: NextRequest) {
  let raw: unknown;
  try {
    ({ path: raw } = await request.json());
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }
  try {
    return NextResponse.json({ path: await prepareLocalDir(String(raw ?? "")) });
  } catch (err) {
    const message = err instanceof LocalFolderError ? err.message : "בדיקת התיקייה נכשלה";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
