import type { LinkErrorCode } from "../lib/types";

/**
 * Every failure an agent sees is one of these. The message is the whole product:
 * it says what happened, quotes ClipDrive's own Hebrew sentence so the human
 * reading over the agent's shoulder sees exactly what the UI would have shown,
 * and ends with the thing to actually do about it.
 */
export class ToolError extends Error {}

/** The app didn't answer at all — it isn't running, or it isn't where we looked. */
export class ClipdriveOfflineError extends Error {
  constructor(
    readonly baseUrl: string,
    readonly cause_: string,
  ) {
    super(`ClipDrive is not reachable at ${baseUrl} (${cause_}).`);
  }
}

/** The app answered with a non-2xx. Every route uses the same JSON error shape. */
export class ClipdriveApiError extends Error {
  constructor(
    readonly status: number,
    /** The app's own Hebrew sentence. */
    readonly hebrew: string,
    readonly code?: string,
    /** yt-dlp's own last ERROR line, when the route passes one through. */
    readonly detail?: string,
  ) {
    super(`ClipDrive returned HTTP ${status}: ${hebrew}`);
  }
}

/** The app is up but took too long. */
export class ClipdriveTimeoutError extends Error {
  constructor(
    readonly seconds: number,
    readonly what: string,
  ) {
    super(`ClipDrive did not answer within ${seconds}s (${what}).`);
  }
}

/**
 * What each yt-dlp failure actually means, and what a human has to do about it.
 * This map is the main thing this server adds over raw HTTP: the app's Hebrew
 * sentence tells a person what went wrong, and these tell an agent whether
 * retrying is pointless.
 */
export const LINK_ERROR_HELP: Record<LinkErrorCode, string> = {
  not_youtube:
    "The URL isn't a YouTube video. Pass a watch/shorts/live/embed URL, a youtu.be link, or a bare 11-character video id.",
  private: "The video is private. Nothing to retry — the owner has to change that.",
  unavailable:
    "The video was removed or never existed. Nothing to retry; check the id.",
  geo_blocked:
    "YouTube blocks this video in the app machine's country. A retry from the same machine will fail the same way.",
  age_restricted:
    "The video is age-restricted, so yt-dlp needs a signed-in session. Ask the human to set YT_DLP_COOKIES_FROM_BROWSER=chrome (or firefox/edge/brave) in the app's .env and restart it.",
  bot_check:
    "YouTube served a bot check instead of the video. Ask the human to run `yt-dlp -U`; if it keeps happening, set YT_DLP_COOKIES_FROM_BROWSER=chrome in the app's .env and restart it. Retrying as-is will not help.",
  outdated:
    "yt-dlp is behind YouTube's current player. Ask the human to run `yt-dlp -U` and try again.",
  blocked:
    "YouTube refused every player client the app tried. Ask the human to run `yt-dlp -U`, and consider YT_DLP_COOKIES_FROM_BROWSER. Retrying immediately will not help.",
  unknown: "yt-dlp failed for a reason the app couldn't classify — the detail line below is the real message.",
};

/**
 * The two failures that look like an app bug but are a missing binary. Both
 * arrive as free Hebrew text (from a 500, or from a failed job's `error`), so
 * substring matching is the only handle we have on them.
 */
export function toolingHint(hebrew: string): string | null {
  if (hebrew.includes("לא נמצא yt-dlp")) {
    return (
      "yt-dlp is not installed, or not on the PATH of the process running ClipDrive. " +
      "Ask the human to install it (`pip install -U yt-dlp`) or set YT_DLP_PATH to its absolute " +
      "path in the app's .env, then restart the app. No conversion can work until that is fixed."
    );
  }
  if (hebrew.includes("לא נמצא ffmpeg")) {
    return (
      "ffmpeg is not installed, or not on the PATH of the process running ClipDrive. " +
      "Ask the human to install it (`apt install ffmpeg` / `brew install ffmpeg`) or set FFMPEG_PATH " +
      "in the app's .env, then restart the app. Downloads will work but nothing will convert."
    );
  }
  return null;
}

/**
 * Turns any thrown thing into the sentence the agent gets. Shape is always the
 * same: what happened → the app's own words → what to do.
 */
export function explain(err: unknown, config: { baseUrl: string }): string {
  if (err instanceof ToolError) return err.message;

  if (err instanceof ClipdriveOfflineError) {
    return [
      err.message,
      "",
      "This server drives a ClipDrive app that is already running — it does not start the app itself.",
      "Ask the human to start it:",
      "",
      "    npm run dev                     # development",
      "    npm run build && npm start      # production",
      "",
      `If the app is running on another port, point this server at it by setting CLIPDRIVE_BASE_URL`,
      `(for example CLIPDRIVE_BASE_URL=http://localhost:3005) in the MCP client's config and restarting`,
      `the MCP server. ClipDrive has no port setting of its own — the port comes from Next's PORT variable.`,
    ].join("\n");
  }

  if (err instanceof ClipdriveTimeoutError) {
    return err.message;
  }

  if (err instanceof ClipdriveApiError) {
    const lines = [`ClipDrive rejected the request (HTTP ${err.status}${err.code ? `, code: ${err.code}` : ""}).`];
    lines.push(`ClipDrive says (Hebrew): "${err.hebrew}"`);
    if (err.detail) lines.push(`yt-dlp detail: ${err.detail}`);

    const help = toolingHint(err.hebrew) ?? helpForCode(err.code) ?? helpForStatus(err.status, config.baseUrl);
    if (help) lines.push("", help);
    return lines.join("\n");
  }

  if (err instanceof Error) return err.message;
  return String(err);
}

function helpForCode(code: string | undefined): string | null {
  if (!code) return null;
  return LINK_ERROR_HELP[code as LinkErrorCode] ?? null;
}

function helpForStatus(status: number, baseUrl: string): string | null {
  if (status === 401) {
    return (
      "Google Drive isn't connected. Ask the human to open " +
      `${baseUrl} in a browser and press the connect button — it is an interactive OAuth flow ` +
      "with a state cookie, so an agent cannot complete it. Run clipdrive_status first: if it reports " +
      "configured=false, the app has no Google credentials in .env and connecting is impossible until it does. " +
      "Conversions with destination='download' need no Drive connection at all."
    );
  }
  if (status >= 500) {
    return "This came from the app's server side — the app's terminal output will have the stack trace.";
  }
  return null;
}
