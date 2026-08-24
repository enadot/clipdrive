import { readFile, writeFile, rm } from "node:fs/promises";

import { google } from "googleapis";
import type { OAuth2Client, Credentials } from "google-auth-library";

import { ensureDirs, TOKEN_FILE } from "./paths";

/**
 * The narrowest scope that lets the app write files: it can only see and touch
 * files and folders it created itself. This is the reason the folder picker has
 * to offer "create folder" — the app genuinely cannot list the user's own Drive.
 */
export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const SCOPES = [DRIVE_SCOPE, "https://www.googleapis.com/auth/userinfo.email"];

export interface StoredToken extends Credentials {
  email?: string | null;
}

export class NotConnectedError extends Error {
  constructor() {
    super("לא מחובר לגוגל דרייב");
    this.name = "NotConnectedError";
  }
}

export function isConfigured(): boolean {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
  );
}

export function redirectUri(): string {
  const base = process.env.APP_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/auth/google/callback`;
}

export function oauthClient(): OAuth2Client {
  if (!isConfigured()) {
    throw new Error(
      "חסרים GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET. ראו .env.example.",
    );
  }
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri(),
  );
}

export function consentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    // Force the consent screen so we reliably get a refresh token back — this
    // is a single-user tool that should stay connected indefinitely.
    prompt: "consent",
    include_granted_scopes: true,
    state,
  });
}

export async function readToken(): Promise<StoredToken | null> {
  try {
    return JSON.parse(await readFile(TOKEN_FILE, "utf8")) as StoredToken;
  } catch {
    return null;
  }
}

export async function writeToken(token: StoredToken): Promise<void> {
  ensureDirs();
  await writeFile(TOKEN_FILE, JSON.stringify(token, null, 2), { mode: 0o600 });
}

export async function clearToken(): Promise<void> {
  await rm(TOKEN_FILE, { force: true });
}

/**
 * Returns a client with credentials loaded, persisting refreshed tokens so the
 * connection survives restarts. Throws NotConnectedError when there is nothing
 * stored — which is what puts the UI into the "not connected" empty state.
 */
export async function authorizedClient(): Promise<OAuth2Client> {
  const stored = await readToken();
  if (!stored?.refresh_token && !stored?.access_token) {
    throw new NotConnectedError();
  }

  const client = oauthClient();
  client.setCredentials(stored);

  client.on("tokens", (tokens) => {
    void writeToken({
      ...stored,
      ...tokens,
      // Google omits the refresh token on refresh responses — keep the original.
      refresh_token: tokens.refresh_token ?? stored.refresh_token,
    });
  });

  return client;
}

export async function fetchEmail(client: OAuth2Client): Promise<string | null> {
  try {
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data } = await oauth2.userinfo.get();
    return data.email ?? null;
  } catch {
    return null;
  }
}
