import {
  authArgs,
  run,
  runWithClientFallback,
  YoutubeError,
  ytDlpFailure,
} from "./youtube";
import type { ChannelEntry, ChannelListing, ChannelTab } from "./types";

/**
 * Channel support: list a channel's uploads, and find which of them fall inside
 * a date range.
 *
 * A listing is cheap — yt-dlp's flat mode reads the channel tab page by page
 * without opening any video. The catch is dates: YouTube only shows "3 weeks
 * ago" on the Videos tab, and nothing at all on the Shorts tab. Exact dates need
 * one request per video, so the range search below opens as few as it can.
 */

interface FlatEntry {
  id?: string;
  title?: string;
  duration?: number | null;
  timestamp?: number | null;
  _type?: string;
}

interface FlatPlaylist {
  channel?: string;
  uploader?: string;
  title?: string;
  entries?: (FlatEntry | null)[];
}

const VIDEO_ID = /^[a-zA-Z0-9_-]{11}$/;

export async function fetchChannelTab(
  baseUrl: string,
  tab: ChannelTab,
  signal?: AbortSignal,
): Promise<ChannelListing> {
  const { stdout, stderr, code } = await run(
    [
      // Keep the pages already read when a later one is refused, rather than
      // throwing away a list of 900 because page 10 got a 403.
      "--ignore-errors",
      "--flat-playlist",
      "--dump-single-json",
      "--no-warnings",
      "--socket-timeout",
      "20",
      // Outside Israel YouTube serves machine-translated titles, and the title
      // becomes the file name — so ask for the Hebrew originals. ("iw" is
      // YouTube's code for Hebrew; "he" is refused.) The price: approximate
      // dates ("לפני 3 שבועות") aren't parsed in Hebrew, so rows show none.
      // The date picker never relied on them; it checks exact dates.
      "--extractor-args",
      "youtube:lang=iw",
      ...authArgs(),
      `${baseUrl}/${tab}`,
    ],
    { signal },
  );

  let data: FlatPlaylist | null = null;
  try {
    data = stdout.trim() ? (JSON.parse(stdout) as FlatPlaylist) : null;
  } catch {
    data = null;
  }

  if (code !== 0 && !data?.entries?.length) {
    const s = stderr.toLowerCase();
    // A channel with no Shorts (or no long videos) simply has no such tab.
    if (s.includes("does not have a")) {
      return { channel: "", tab, entries: [], partial: null };
    }
    if (s.includes("404") || s.includes("does not exist")) {
      throw new YoutubeError(
        "unavailable",
        "הערוץ לא נמצא. בדקו את הכתובת.",
        stderr.trim().split("\n").pop(),
      );
    }
    throw ytDlpFailure(stderr);
  }

  if (!data) {
    throw new YoutubeError("unknown", "לא הצלחנו לקרוא את רשימת הסרטונים של הערוץ.");
  }

  const entries: ChannelEntry[] = [];
  const seen = new Set<string>();
  for (const e of data.entries ?? []) {
    if (!e?.id || !VIDEO_ID.test(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    entries.push({
      id: e.id,
      title: e.title ?? e.id,
      duration: e.duration ? Math.round(e.duration) : null,
      // The listing's own thumbnails are a mix of vertical Shorts crops and
      // custom sizes; this one exists for every upload and fits a row.
      thumbnail: `https://i.ytimg.com/vi/${e.id}/mqdefault.jpg`,
      approxTimestamp: e.timestamp ?? null,
    });
  }

  return {
    channel: data.channel ?? data.uploader ?? data.title ?? "",
    tab,
    entries,
    partial:
      code !== 0
        ? (stderr.trim().split("\n").reverse().find((l) => l.startsWith("ERROR")) ??
          "yt-dlp stopped early")
        : null,
  };
}

/* ------------------------------------------------------------------ */
/* Exact upload dates                                                  */
/* ------------------------------------------------------------------ */

/** id → "YYYYMMDD". An upload date never changes, so this never expires. */
const dateCache: Map<string, string> = ((globalThis as Record<string, unknown>)
  .__clipdriveDateCache ??= new Map<string, string>()) as Map<string, string>;

async function uploadDate(id: string, signal?: AbortSignal): Promise<string> {
  const cached = dateCache.get(id);
  if (cached) return cached;

  const { stdout, stderr, code } = await runWithClientFallback(
    (client) => [
      "--skip-download",
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout",
      "20",
      "--print",
      "%(upload_date)s",
      ...authArgs(),
      ...(client ? ["--extractor-args", `youtube:player_client=${client}`] : []),
      `https://www.youtube.com/watch?v=${id}`,
    ],
    { signal },
  );

  if (code !== 0) throw ytDlpFailure(stderr);

  const date = stdout.trim().split("\n").pop()?.trim() ?? "";
  if (!/^\d{8}$/.test(date)) {
    throw new YoutubeError("unknown", "לא הצלחנו לקרוא את תאריך ההעלאה של אחד הסרטונים.");
  }
  dateCache.set(id, date);
  return date;
}

/**
 * Index of the first `true` in a predicate that runs false…false,true…true over
 * [0, n) — or n when it never turns true. Probes several points per round in
 * parallel, so a list of 1,000 is settled in about five rounds of requests
 * rather than ten one-at-a-time.
 */
async function firstTrue(
  n: number,
  predicate: (index: number) => Promise<boolean>,
  fanout = 3,
): Promise<number> {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const span = hi - lo;
    const k = Math.min(fanout, span);
    const probes = [
      ...new Set(
        Array.from({ length: k }, (_, j) =>
          Math.min(hi - 1, lo + Math.floor((span * (j + 1)) / (k + 1))),
        ),
      ),
    ];
    const results = await Promise.all(probes.map((i) => predicate(i)));

    const hit = results.findIndex(Boolean);
    if (hit === -1) {
      lo = probes[probes.length - 1] + 1;
    } else {
      hi = probes[hit];
      if (hit > 0) lo = probes[hit - 1] + 1;
    }
  }
  return lo;
}

/**
 * Given a channel tab's ids in its own newest-first order, returns the slice
 * [start, end) uploaded between `from` and `to` (both "YYYY-MM-DD", inclusive,
 * either optional).
 */
export async function findDateRange(
  ids: string[],
  from: string | null,
  to: string | null,
  signal?: AbortSignal,
): Promise<{ start: number; end: number }> {
  const date = (i: number) => uploadDate(ids[i], signal);
  const fromKey = from?.replaceAll("-", "") ?? null;
  const toKey = to?.replaceAll("-", "") ?? null;

  const [start, end] = await Promise.all([
    // Skip everything newer than `to`.
    toKey ? firstTrue(ids.length, async (i) => (await date(i)) <= toKey) : 0,
    // Stop at the first upload older than `from`.
    fromKey ? firstTrue(ids.length, async (i) => (await date(i)) < fromKey) : ids.length,
  ]);

  return { start, end: Math.max(start, end) };
}
