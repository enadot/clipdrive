import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

import { findOutput, toMp3, toMp4 } from "./convert";
import { safeFileName, uploadFile } from "./drive";
import { ensureDirs, HISTORY_FILE, jobDir, jobDirPath, WORK_DIR } from "./paths";
import { readFile, writeFile } from "node:fs/promises";
import { download, fetchMetadata, findSource, YoutubeError } from "./youtube";
import type { CreateJobInput, Job, Stage } from "./types";

/** One at a time — the queue position shown on a queued card is real. */
const MAX_CONCURRENT = 1;
/** How many finished jobs the history keeps. */
const HISTORY_LIMIT = 50;

interface Store {
  jobs: Map<string, Job>;
  runners: Map<string, AbortController>;
  emitter: EventEmitter;
  loaded: boolean;
}

/**
 * Survives dev-server hot reloads — otherwise every edit would orphan running
 * child processes and lose the job list.
 */
const store: Store = ((globalThis as Record<string, unknown>).__clipdriveStore ??= {
  jobs: new Map<string, Job>(),
  runners: new Map<string, AbortController>(),
  emitter: new EventEmitter(),
  loaded: false,
}) as Store;

store.emitter.setMaxListeners(50);

export function onChange(listener: () => void): () => void {
  store.emitter.on("change", listener);
  return () => store.emitter.off("change", listener);
}

function emit(): void {
  store.emitter.emit("change");
}

/* ------------------------------------------------------------------ */
/* History persistence                                                 */
/* ------------------------------------------------------------------ */

async function loadHistory(): Promise<void> {
  if (store.loaded) return;
  store.loaded = true;
  try {
    const raw = JSON.parse(await readFile(HISTORY_FILE, "utf8")) as Job[];
    for (const job of raw) store.jobs.set(job.id, restore(job));
  } catch {
    /* first run — nothing to load */
  }
  await pruneOrphanWork();
}

/** Fills in fields that a history file written by an older version lacks. */
function restore(job: Job): Job {
  return {
    ...job,
    destination: job.destination ?? "drive",
    folderId: job.folderId ?? null,
    folderName: job.folderName ?? null,
    fileName: job.fileName ?? null,
  };
}

/**
 * A direct-download file waits in its job's scratch directory until the card is
 * removed, so the work root can't just be wiped at startup. What it can drop is
 * every directory no job claims any more: a dead process's half-finished
 * downloads, and jobs that fell off the end of the history.
 */
async function pruneOrphanWork(): Promise<void> {
  try {
    const entries = await readdir(WORK_DIR, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && !store.jobs.has(entry.name))
        .map((entry) =>
          rm(path.join(WORK_DIR, entry.name), { recursive: true, force: true }).catch(
            () => {},
          ),
        ),
    );
  } catch {
    /* first run — nothing has been written yet */
  }
}

async function saveHistory(): Promise<void> {
  ensureDirs();
  const finished = [...store.jobs.values()]
    .filter((j) => j.status === "done" || j.status === "failed")
    .sort((a, b) => (b.finishedAt ?? b.createdAt) - (a.finishedAt ?? a.createdAt))
    .slice(0, HISTORY_LIMIT);
  await writeFile(HISTORY_FILE, JSON.stringify(finished, null, 2));
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Newest first, with live queue positions filled in. */
export async function listJobs(): Promise<Job[]> {
  await loadHistory();
  const jobs = [...store.jobs.values()].sort((a, b) => b.createdAt - a.createdAt);

  const queued = jobs
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt);

  return jobs.map((job) => {
    const index = queued.indexOf(job);
    return index === -1
      ? { ...job, queuePosition: undefined }
      : { ...job, queuePosition: index + 1 };
  });
}

export async function getJob(id: string): Promise<Job | null> {
  await loadHistory();
  return store.jobs.get(id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Mutations                                                           */
/* ------------------------------------------------------------------ */

function patch(id: string, changes: Partial<Job>): void {
  const job = store.jobs.get(id);
  if (!job) return;
  store.jobs.set(id, { ...job, ...changes });
  emit();
}

export async function createJob(input: CreateJobInput): Promise<Job> {
  await loadHistory();

  // Metadata is fetched up front so the card has a title and thumbnail the
  // moment it appears, instead of a placeholder that fills in later.
  const meta = await fetchMetadata(input.url);

  const job: Job = {
    id: randomUUID(),
    url: input.url,
    format: input.format,
    quality: input.quality,
    destination: input.destination,
    folderId: input.destination === "drive" ? input.folderId : null,
    folderName: input.destination === "drive" ? input.folderName : null,
    title: meta.title,
    channel: meta.channel,
    duration: meta.duration,
    thumbnail: meta.thumbnail,
    status: "queued",
    stage: "download",
    stagePercent: 0,
    speed: null,
    eta: null,
    bytes:
      (input.format === "mp3"
        ? meta.audioSizeEstimate
        : meta.sizeEstimates[input.quality]) ?? null,
    failedStage: null,
    error: null,
    driveLink: null,
    driveFileId: null,
    fileName: null,
    createdAt: Date.now(),
    finishedAt: null,
  };

  store.jobs.set(job.id, job);
  emit();
  pump();
  return job;
}

/** Stops the running process but keeps the partial download for a resume. */
export function pauseJob(id: string): void {
  const job = store.jobs.get(id);
  if (!job || job.status !== "running") return;
  store.runners.get(id)?.abort();
  store.runners.delete(id);
  patch(id, { status: "paused", speed: null, eta: null });
  pump();
}

export function resumeJob(id: string): void {
  const job = store.jobs.get(id);
  if (!job || job.status !== "paused") return;
  patch(id, { status: "queued" });
  pump();
}

export async function cancelJob(id: string): Promise<void> {
  const job = store.jobs.get(id);
  if (!job) return;
  store.runners.get(id)?.abort();
  store.runners.delete(id);
  patch(id, { status: "canceled", speed: null, eta: null, finishedAt: Date.now() });
  await cleanup(id);
  store.jobs.delete(id);
  emit();
  pump();
}

/**
 * Drops a finished/failed card from the list without touching Drive. A direct
 * download's file lives in the scratch directory, so this is also what finally
 * deletes it — which is why the card says so before the ✕ is pressed.
 */
export async function removeJob(id: string): Promise<void> {
  const job = store.jobs.get(id);
  if (!job) return;
  if (job.status === "running") {
    store.runners.get(id)?.abort();
    store.runners.delete(id);
  }
  await cleanup(id);
  store.jobs.delete(id);
  emit();
  await saveHistory();
  pump();
}

/**
 * Re-queues a failed job. The scratch directory is left intact, so if the
 * download completed and conversion is what broke, the retry picks up at
 * conversion — exactly what the error card promises the user.
 */
export function retryJob(id: string): void {
  const job = store.jobs.get(id);
  if (!job || job.status !== "failed") return;
  patch(id, {
    status: "queued",
    error: null,
    failedStage: null,
    stagePercent: 0,
    finishedAt: null,
  });
  pump();
}

async function cleanup(id: string): Promise<void> {
  await rm(jobDirPath(id), { recursive: true, force: true }).catch(() => {});
}

/**
 * Empties a job's scratch directory of everything but the finished file. The
 * downloaded streams are the bulk of it and nothing needs them once stage 2 is
 * over, but a direct download still has to keep the file itself around.
 */
async function keepOnly(dir: string, file: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    await Promise.all(
      entries
        .map((name) => path.join(dir, name))
        .filter((entry) => entry !== file)
        .map((entry) => rm(entry, { recursive: true, force: true }).catch(() => {})),
    );
  } catch {
    /* the directory is already gone */
  }
}

/**
 * The finished file of a direct-download job, if it is still on disk. Returns
 * null once the card has been removed — the route turns that into "the file is
 * no longer here" rather than a broken download.
 */
export async function localFile(job: Job): Promise<string | null> {
  if (job.destination !== "download" || job.status !== "done") return null;
  return findOutput(jobDirPath(job.id), job.format);
}

/* ------------------------------------------------------------------ */
/* Queue                                                               */
/* ------------------------------------------------------------------ */

function pump(): void {
  const running = [...store.jobs.values()].filter((j) => j.status === "running");
  if (running.length >= MAX_CONCURRENT) return;

  const next = [...store.jobs.values()]
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt)[0];
  if (!next) return;

  void run(next.id);
}

async function run(id: string): Promise<void> {
  const job = store.jobs.get(id);
  if (!job) return;

  const controller = new AbortController();
  store.runners.set(id, controller);
  const { signal } = controller;

  patch(id, { status: "running", error: null, failedStage: null });

  let stage: Stage = "download";

  try {
    const dir = jobDir(id);
    const audioOnly = job.format === "mp3";

    /* -- Stage 1: download ---------------------------------------- */
    let source = await findSource(dir);
    if (!source) {
      patch(id, { stage: "download", stagePercent: 0, speed: null, eta: null });
      source = await download({
        url: job.url,
        dir,
        audioOnly,
        quality: job.quality,
        signal,
        onProgress: (p) =>
          patch(id, {
            stage: "download",
            stagePercent: p.percent,
            speed: p.speed,
            eta: p.eta,
            bytes: p.totalBytes ?? store.jobs.get(id)?.bytes ?? null,
          }),
      });
    }
    throwIfAborted(signal);

    /* -- Stage 2: convert ----------------------------------------- */
    stage = "convert";

    // A job that died during upload already has its converted file; retrying
    // should push those bytes, not transcode them again.
    let output = await findOutput(dir, job.format);
    if (!output) {
      patch(id, { stage: "convert", stagePercent: 0, speed: null, eta: null });

      const onProgress = (p: { percent: number; eta: number | null }) =>
        patch(id, { stage: "convert", stagePercent: p.percent, eta: p.eta });

      output = audioOnly
        ? await toMp3({
            source,
            dir,
            durationSec: job.duration,
            title: job.title,
            channel: job.channel,
            onProgress,
            signal,
          })
        : await toMp4({
            source,
            dir,
            durationSec: job.duration,
            onProgress,
            signal,
          });
    }
    throwIfAborted(signal);

    const { size } = await stat(output);
    const fileName = safeFileName(job.title, audioOnly ? ".mp3" : ".mp4");

    /* -- Stage 3: hand over --------------------------------------- */
    // A direct download has no third stage: the file is finished the moment
    // ffmpeg is, and it waits here until the browser asks for it.
    if (job.destination === "download") {
      await keepOnly(dir, output);
      patch(id, {
        status: "done",
        stage: "convert",
        stagePercent: 100,
        speed: null,
        eta: null,
        bytes: size,
        fileName,
        finishedAt: Date.now(),
      });
      await saveHistory();
      return;
    }

    /* -- Stage 3: upload ------------------------------------------ */
    stage = "upload";
    if (!job.folderId) throw new Error("לא נבחרה תיקיית יעד בדרייב");
    patch(id, { stage: "upload", stagePercent: 0, eta: null, bytes: size });

    const result = await uploadFile({
      filePath: output,
      name: fileName,
      mimeType: audioOnly ? "audio/mpeg" : "video/mp4",
      folderId: job.folderId,
      totalBytes: size,
      signal,
      onProgress: (percent) => patch(id, { stage: "upload", stagePercent: percent }),
    });
    throwIfAborted(signal);

    patch(id, {
      status: "done",
      stage: "upload",
      stagePercent: 100,
      speed: null,
      eta: null,
      bytes: result.bytes,
      fileName,
      driveLink: result.webViewLink,
      driveFileId: result.fileId,
      finishedAt: Date.now(),
    });

    await cleanup(id);
    await saveHistory();
  } catch (err) {
    // A pause aborts the same way a cancel does; only report a real failure.
    const current = store.jobs.get(id);
    if (!current || current.status === "paused" || current.status === "canceled") {
      return;
    }

    patch(id, {
      status: "failed",
      failedStage: stage,
      speed: null,
      eta: null,
      error: errorMessage(err),
      finishedAt: Date.now(),
    });
    await saveHistory();
  } finally {
    store.runners.delete(id);
    pump();
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("canceled");
}

function errorMessage(err: unknown): string {
  if (err instanceof YoutubeError) return err.message;
  if (err instanceof Error) return err.message;
  return "משהו השתבש";
}
