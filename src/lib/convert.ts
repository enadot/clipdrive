import { spawn } from "node:child_process";
import { rename, stat } from "node:fs/promises";
import path from "node:path";

const FFMPEG = process.env.FFMPEG_PATH ?? "ffmpeg";

export interface ConvertProgress {
  /** 0–100. */
  percent: number;
  /** Seconds remaining, when it can be inferred from throughput. */
  eta: number | null;
}

interface FfmpegRun {
  code: number | null;
  stderr: string;
}

/**
 * ffmpeg's `-progress` stream reports `out_time_us`, so progress is measured
 * against the media duration rather than guessed. That's what keeps the meter
 * deterministic — the design explicitly rules out an indeterminate spinner.
 */
function runFfmpeg(
  args: string[],
  opts: {
    durationSec: number;
    onProgress: (p: ConvertProgress) => void;
    signal?: AbortSignal;
  },
): Promise<FfmpegRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(FFMPEG, ["-hide_banner", "-nostats", "-y", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    const startedAt = Date.now();
    let stderr = "";
    let pending = "";

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        const [key, value] = line.trim().split("=");
        if (key !== "out_time_us" && key !== "out_time_ms") continue;
        const micros = Number(value);
        if (!Number.isFinite(micros) || opts.durationSec <= 0) continue;
        // `out_time_ms` is a misnomer in ffmpeg — it is microseconds too.
        const done = micros / 1_000_000;
        const percent = Math.max(0, Math.min(100, (done / opts.durationSec) * 100));
        const elapsed = (Date.now() - startedAt) / 1000;
        const rate = done > 0 ? elapsed / done : 0;
        opts.onProgress({
          percent,
          eta: rate > 0 ? Math.round((opts.durationSec - done) * rate) : null,
        });
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      // Keep the tail only — ffmpeg is chatty and we just want the failure line.
      stderr = (stderr + chunk).slice(-4000);
    });

    const abort = () => child.kill("SIGKILL");
    opts.signal?.addEventListener("abort", abort, { once: true });

    child.on("error", (err) => {
      opts.signal?.removeEventListener("abort", abort);
      reject(
        new Error(
          `לא נמצא ffmpeg במערכת (${FFMPEG}). התקינו אותו והריצו שוב. (${err.message})`,
        ),
      );
    });

    child.on("close", (code) => {
      opts.signal?.removeEventListener("abort", abort);
      resolve({ code, stderr });
    });
  });
}

const PROGRESS_ARGS = ["-progress", "pipe:1"];

/**
 * Stage 2 for MP4 jobs: put the downloaded streams into an MP4 container.
 * Tries a stream copy first (near-instant, no quality loss) and only transcodes
 * when the codecs can't live in MP4 — which is the 1440p/4K VP9/AV1 case.
 */
export async function toMp4(opts: {
  source: string;
  dir: string;
  durationSec: number;
  onProgress: (p: ConvertProgress) => void;
  signal?: AbortSignal;
}): Promise<string> {
  // ffmpeg writes progressively, so a killed run would leave a plausible-looking
  // file behind. Building under a .part name and promoting it on success means
  // "output.mp4 exists" reliably means "stage 2 finished".
  const out = path.join(opts.dir, "output.mp4");
  const partial = path.join(opts.dir, "output.part.mp4");

  const copy = await runFfmpeg(
    [
      ...PROGRESS_ARGS,
      "-i",
      opts.source,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      partial,
    ],
    opts,
  );

  if (copy.code === 0) {
    await rename(partial, out);
    return out;
  }
  if (opts.signal?.aborted) throw new Error("canceled");

  const transcode = await runFfmpeg(
    [
      ...PROGRESS_ARGS,
      "-i",
      opts.source,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "20",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      partial,
    ],
    opts,
  );

  if (transcode.code !== 0) {
    if (opts.signal?.aborted) throw new Error("canceled");
    throw new Error(`ההמרה ל-MP4 נכשלה. ${lastFfmpegError(transcode.stderr)}`);
  }

  await rename(partial, out);
  return out;
}

/** Stage 2 for MP3 jobs: transcode the audio stream to 320kbps MP3. */
export async function toMp3(opts: {
  source: string;
  dir: string;
  durationSec: number;
  title: string;
  channel: string;
  onProgress: (p: ConvertProgress) => void;
  signal?: AbortSignal;
}): Promise<string> {
  const out = path.join(opts.dir, "output.mp3");
  const partial = path.join(opts.dir, "output.part.mp3");

  const result = await runFfmpeg(
    [
      ...PROGRESS_ARGS,
      "-i",
      opts.source,
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "320k",
      "-metadata",
      `title=${opts.title}`,
      "-metadata",
      `artist=${opts.channel}`,
      partial,
    ],
    opts,
  );

  if (result.code !== 0) {
    if (opts.signal?.aborted) throw new Error("canceled");
    throw new Error(`ההמרה ל-MP3 נכשלה. ${lastFfmpegError(result.stderr)}`);
  }

  await rename(partial, out);
  return out;
}

function lastFfmpegError(stderr: string): string {
  const lines = stderr.trim().split("\n").filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/**
 * Locates a finished stage-2 output. When a job failed while uploading, the
 * converted file is still sitting there — a retry should push those same bytes
 * rather than transcode them a second time.
 */
export async function findOutput(
  dir: string,
  format: "mp4" | "mp3",
): Promise<string | null> {
  const candidate = path.join(dir, `output.${format}`);
  try {
    const info = await stat(candidate);
    return info.size > 0 ? candidate : null;
  } catch {
    return null;
  }
}
