import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  QUALITY_HEIGHT,
  type LinkErrorCode,
  type Quality,
  type VideoMeta,
} from "./types";

const YT_DLP = process.env.YT_DLP_PATH ?? "yt-dlp";

export class YoutubeError extends Error {
  constructor(
    readonly code: LinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "YoutubeError";
  }
}

/** Hebrew copy for each failure mode, matching screen 2e's inline error. */
export const LINK_ERROR_TEXT: Record<LinkErrorCode, string> = {
  not_youtube: "זה לא לינק יוטיוב. בדקו את הכתובת.",
  private: "הסרטון פרטי — אין גישה אליו דרך הלינק הזה.",
  unavailable: "הסרטון לא זמין — ייתכן שהוסר או שהכתובת שגויה.",
  geo_blocked: "הסרטון חסום באזור שלכם.",
  unknown: "לא הצלחנו לקרוא את הסרטון. בדקו את הכתובת ונסו שוב.",
};

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
  "www.youtu.be",
]);

/**
 * Accepts the shapes a share sheet actually produces: watch URLs, youtu.be
 * shorts, /shorts/, /live/, and bare 11-character ids. Returns the canonical
 * watch URL, or null when this clearly isn't YouTube.
 */
export function normalizeYoutubeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return `https://www.youtube.com/watch?v=${trimmed}`;
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;

  const id = extractVideoId(url);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

function extractVideoId(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  if (host === "youtu.be" || host === "www.youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }

  const v = url.searchParams.get("v");
  if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length >= 2 && ["shorts", "live", "embed", "v"].includes(segments[0])) {
    const id = segments[1];
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
  }

  return null;
}

function classifyError(stderr: string): LinkErrorCode {
  const s = stderr.toLowerCase();
  if (s.includes("private video") || s.includes("sign in if you've been granted")) {
    return "private";
  }
  if (s.includes("blocked it in your country") || s.includes("not available in your country")) {
    return "geo_blocked";
  }
  if (
    s.includes("video unavailable") ||
    s.includes("removed by the uploader") ||
    s.includes("account associated with this video has been terminated") ||
    s.includes("this video has been removed")
  ) {
    return "unavailable";
  }
  if (s.includes("is not a valid url") || s.includes("unsupported url")) {
    return "not_youtube";
  }
  return "unknown";
}

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

function run(
  args: string[],
  opts: {
    onStdoutLine?: (line: string) => void;
    signal?: AbortSignal;
  } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(YT_DLP, args, { stdio: ["ignore", "pipe", "pipe"] });

    let stdout = "";
    let stderr = "";
    let pending = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!opts.onStdoutLine) return;
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) opts.onStdoutLine(line);
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const abort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", abort, { once: true });

    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", abort);
      reject(
        new YoutubeError(
          "unknown",
          `לא נמצא yt-dlp במערכת (${YT_DLP}). התקינו אותו והריצו שוב. (${err.message})`,
        ),
      );
    });

    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", abort);
      if (pending && opts.onStdoutLine) opts.onStdoutLine(pending);
      resolve({ stdout, stderr, code });
    });
  });
}

/** Shape of the subset of yt-dlp's --dump-json output we rely on. */
interface DumpJson {
  id: string;
  title: string;
  uploader?: string;
  channel?: string;
  duration?: number;
  thumbnail?: string;
  formats?: Array<{
    height?: number | null;
    vcodec?: string;
    acodec?: string;
    filesize?: number | null;
    filesize_approx?: number | null;
    tbr?: number | null;
  }>;
}

/**
 * Reads title/duration/thumbnail plus a size estimate per quality, so screen 2a
 * can show the preview card and the "~890MB" hint before anything is committed.
 */
export async function fetchMetadata(
  url: string,
  signal?: AbortSignal,
): Promise<VideoMeta> {
  const canonical = normalizeYoutubeUrl(url);
  if (!canonical) {
    throw new YoutubeError("not_youtube", LINK_ERROR_TEXT.not_youtube);
  }

  const { stdout, stderr, code } = await run(
    [
      "--dump-single-json",
      "--no-playlist",
      "--no-warnings",
      "--socket-timeout",
      "20",
      canonical,
    ],
    { signal },
  );

  if (code !== 0) {
    const errCode = classifyError(stderr);
    throw new YoutubeError(errCode, LINK_ERROR_TEXT[errCode]);
  }

  let data: DumpJson;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new YoutubeError("unknown", LINK_ERROR_TEXT.unknown);
  }

  return {
    id: data.id,
    title: data.title,
    channel: data.channel ?? data.uploader ?? "",
    duration: Math.round(data.duration ?? 0),
    thumbnail: data.thumbnail ?? null,
    sizeEstimates: estimateSizes(data),
    audioSizeEstimate: estimateAudioSize(data),
  };
}

function formatBytes(f: NonNullable<DumpJson["formats"]>[number], duration: number): number | null {
  if (f.filesize) return f.filesize;
  if (f.filesize_approx) return f.filesize_approx;
  // tbr is in kbit/s — good enough for a "~890MB" hint.
  if (f.tbr && duration) return Math.round((f.tbr * 1000 * duration) / 8);
  return null;
}

/**
 * A merged MP4 is roughly the best video stream at that height plus the best
 * audio stream, so the estimate sums the two rather than quoting video alone.
 */
function estimateSizes(data: DumpJson): Partial<Record<Quality, number>> {
  const formats = data.formats ?? [];
  const duration = data.duration ?? 0;
  const audio = estimateAudioSize(data) ?? 0;
  const out: Partial<Record<Quality, number>> = {};

  for (const [quality, maxHeight] of Object.entries(QUALITY_HEIGHT) as [
    Quality,
    number,
  ][]) {
    let best: number | null = null;
    let bestHeight = 0;
    for (const f of formats) {
      if (!f.height || f.height > maxHeight) continue;
      if (f.vcodec === "none") continue;
      const size = formatBytes(f, duration);
      if (size === null) continue;
      if (f.height > bestHeight || (f.height === bestHeight && size > (best ?? 0))) {
        bestHeight = f.height;
        best = size;
      }
    }
    if (best !== null) out[quality] = best + audio;
  }

  return out;
}

function estimateAudioSize(data: DumpJson): number | null {
  const duration = data.duration ?? 0;
  let best: number | null = null;
  for (const f of data.formats ?? []) {
    if (f.vcodec !== "none" || f.acodec === "none") continue;
    const size = formatBytes(f, duration);
    if (size !== null && size > (best ?? 0)) best = size;
  }
  return best;
}

export interface DownloadProgress {
  /** 0–100. */
  percent: number;
  /** Bytes per second, when yt-dlp reports it. */
  speed: number | null;
  /** Seconds remaining, when yt-dlp reports it. */
  eta: number | null;
  downloadedBytes: number | null;
  totalBytes: number | null;
}

const PROGRESS_PREFIX = "CLIPDRIVE_PROGRESS";

/** yt-dlp prints "NA" for fields it can't compute yet. */
function num(raw: string): number | null {
  if (!raw || raw === "NA") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Stage 1 of the pipeline. Pulls the streams into `dir` and returns the file on
 * disk. MP4 jobs get a merged MKV (remuxed to MP4 in stage 2); MP3 jobs get the
 * bare best-audio stream (transcoded in stage 2). Splitting it this way keeps
 * each segment of the three-part meter backed by real work, and leaves the
 * downloaded bytes on disk so a mid-pipeline failure can resume from stage 2.
 */
export async function download(
  opts: {
    url: string;
    dir: string;
    audioOnly: boolean;
    quality: Quality;
    onProgress: (p: DownloadProgress) => void;
    signal?: AbortSignal;
  },
): Promise<string> {
  const { url, dir, audioOnly, quality, onProgress, signal } = opts;
  const height = QUALITY_HEIGHT[quality];

  // For MP4 we ask for H.264 + AAC first so stage 2 can remux with `-c copy`
  // instead of transcoding. YouTube only offers those up to 1080p, so 1440p/4K
  // fall through to VP9/AV1 and stage 2 does a real transcode.
  const format = audioOnly
    ? "bestaudio/best"
    : `bestvideo[height<=${height}][vcodec^=avc1]+bestaudio[acodec^=mp4a]/` +
      `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    // Keep .part files and resume into them: that is what makes the card's
    // pause button real rather than a restart in disguise.
    "--continue",
    "--socket-timeout",
    "20",
    "--retries",
    "3",
    "-f",
    format,
    "-o",
    path.join(dir, "source.%(ext)s"),
    "--progress-template",
    `${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`,
  ];

  if (!audioOnly) args.push("--merge-output-format", "mkv");

  args.push(url);

  const { stderr, code } = await run(args, {
    signal,
    onStdoutLine: (line) => {
      if (!line.startsWith(PROGRESS_PREFIX)) return;
      const [, downloaded, total, totalEst, speed, eta] = line.trim().split(/\s+/);
      const downloadedBytes = num(downloaded);
      const totalBytes = num(total) ?? num(totalEst);
      const percent =
        downloadedBytes !== null && totalBytes
          ? Math.min(100, (downloadedBytes / totalBytes) * 100)
          : 0;
      onProgress({
        percent,
        speed: num(speed),
        eta: num(eta),
        downloadedBytes,
        totalBytes,
      });
    },
  });

  if (signal?.aborted) throw new Error("canceled");

  if (code !== 0) {
    const errCode = classifyError(stderr);
    throw new YoutubeError(errCode, LINK_ERROR_TEXT[errCode]);
  }

  const file = await findSource(dir);
  if (!file) throw new YoutubeError("unknown", "ההורדה הסתיימה אך הקובץ לא נמצא.");
  return file;
}

/**
 * Locates the *completed* stage-1 output, which is how a retry knows it can
 * skip straight to conversion. Half-downloaded `.part` files don't count.
 */
export async function findSource(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const entries = await readdir(dir);
  const match = entries.find(
    (name) =>
      name.startsWith("source.") &&
      !name.endsWith(".part") &&
      !name.endsWith(".ytdl"),
  );
  return match ? path.join(dir, match) : null;
}
