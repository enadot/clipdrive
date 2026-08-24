import { NextResponse, type NextRequest } from "next/server";

import { createFolder, listFolders } from "@/lib/drive";
import { NotConnectedError } from "@/lib/google-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ folders: await listFolders() });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  let name: unknown;
  try {
    ({ name } = await request.json());
  } catch {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "צריך שם לתיקייה" }, { status: 400 });
  }

  try {
    return NextResponse.json({ folder: await createFolder(name.trim()) });
  } catch (err) {
    return errorResponse(err);
  }
}

function errorResponse(err: unknown) {
  if (err instanceof NotConnectedError) {
    return NextResponse.json({ error: err.message }, { status: 401 });
  }
  const message = err instanceof Error ? err.message : "שגיאה מול גוגל דרייב";
  return NextResponse.json({ error: message }, { status: 500 });
}
