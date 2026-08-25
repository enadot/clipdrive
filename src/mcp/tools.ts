import type { CallToolResult, McpServer } from "@modelcontextprotocol/server";
import * as z from "zod";

import type { ClipdriveClient } from "./client";
import type { McpConfig } from "./config";
import { ClipdriveApiError, ToolError, explain, toolingHint } from "./errors";
import { saveJobFile } from "./save";
import { stagesFor, type Destination, type Format, type Job, type JobStatus, type Quality, type Stage } from "../lib/types";

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const FORMATS = ["mp4", "mp3"] as const;
const QUALITIES = ["720p", "1080p", "1440p", "4k"] as const;
const DESTINATIONS = ["drive", "download"] as const;
const STATUSES = ["queued", "running", "paused", "done", "failed", "canceled"] as const;
const STAGES = ["download", "convert", "upload"] as const;

/**
 * These tuples exist because zod needs literal tuples and the app exports plain
 * arrays. The assertions below fail the build the day the app grows a quality
 * or a status this server doesn't know about — which is the whole point of
 * writing them out twice.
 */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const _format: Exact<Format, (typeof FORMATS)[number]> = true;
const _quality: Exact<Quality, (typeof QUALITIES)[number]> = true;
const _destination: Exact<Destination, (typeof DESTINATIONS)[number]> = true;
const _status: Exact<JobStatus, (typeof STATUSES)[number]> = true;
const _stage: Exact<Stage, (typeof STAGES)[number]> = true;
void [_format, _quality, _destination, _status, _stage];

const ACTIVE: JobStatus[] = ["queued", "running", "paused"];

/* ------------------------------------------------------------------ */
/* Job projections                                                     */
/* ------------------------------------------------------------------ */

const JobSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  format: z.enum(FORMATS),
  quality: z.enum(QUALITIES),
  destination: z.enum(DESTINATIONS),
  status: z.enum(STATUSES),
  stage: z.enum(STAGES),
  stagePercent: z.number(),
  overallPercent: z.number(),
  stageCount: z.number(),
  bytes: z.number().nullable(),
  fileName: z.string().nullable(),
  folderName: z.string().nullable(),
  driveLink: z.string().nullable(),
  failedStage: z.enum(STAGES).nullable(),
  error: z.string().nullable(),
  queuePosition: z.number().optional(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});

const JobDetailSchema = JobSummarySchema.extend({
  url: z.string(),
  channel: z.string(),
  duration: z.number(),
  durationFormatted: z.string(),
  thumbnail: z.string().nullable(),
  speed: z.number().nullable(),
  eta: z.number().nullable(),
  driveFileId: z.string().nullable(),
  folderId: z.string().nullable(),
  stages: z.array(z.enum(STAGES)),
});

type JobSummary = z.infer<typeof JobSummarySchema>;

/** Progress across the stages this job actually runs — two of them for a
 *  direct download, three for a Drive upload. */
function overallPercent(job: Job): number {
  if (job.status === "done") return 100;
  const stages = stagesFor(job.destination);
  const index = Math.max(0, stages.indexOf(job.stage));
  return Math.round(((index + job.stagePercent / 100) / stages.length) * 100);
}

function summarize(job: Job): JobSummary {
  return {
    id: job.id,
    title: job.title,
    format: job.format,
    quality: job.quality,
    destination: job.destination,
    status: job.status,
    stage: job.stage,
    stagePercent: Math.round(job.stagePercent),
    overallPercent: overallPercent(job),
    stageCount: stagesFor(job.destination).length,
    bytes: job.bytes,
    fileName: job.fileName,
    folderName: job.folderName,
    driveLink: job.driveLink,
    failedStage: job.failedStage,
    error: job.error,
    ...(job.queuePosition === undefined ? {} : { queuePosition: job.queuePosition }),
    createdAt: job.createdAt,
    finishedAt: job.finishedAt,
  };
}

function detail(job: Job): z.infer<typeof JobDetailSchema> {
  return {
    ...summarize(job),
    url: job.url,
    channel: job.channel,
    duration: job.duration,
    durationFormatted: formatDuration(job.duration),
    thumbnail: job.thumbnail,
    speed: job.speed,
    eta: job.eta,
    driveFileId: job.driveFileId,
    folderId: job.folderId,
    stages: stagesFor(job.destination),
  };
}

function jobLine(job: JobSummary): string {
  const bits = [
    job.status,
    `${job.stage} ${job.stagePercent}%`,
    job.format.toUpperCase(),
    job.destination,
    formatBytes(job.bytes),
  ].filter(Boolean);
  const queue = job.queuePosition ? ` (queue position ${job.queuePosition})` : "";
  return `${job.id}  ${job.title}\n    ${bits.join(" · ")}${queue}`;
}

function formatBytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "";
  if (value < 1000) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = value / 1000;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit += 1;
  }
  return `${n >= 100 ? Math.round(n) : Math.round(n * 10) / 10} ${units[unit]}`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Result helpers                                                      */
/* ------------------------------------------------------------------ */

/** The SDK's own result type — a hand-rolled interface isn't assignable to it. */
type ToolResult = CallToolResult;

function ok(text: string, structured: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text }], structuredContent: structured };
}

/**
 * Every tool body runs through here: a failure becomes an `isError` result
 * carrying a sentence the agent can act on, never an exception that surfaces as
 * a bare stack trace.
 */
async function guard(
  config: McpConfig,
  fn: () => Promise<ToolResult>,
): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    return { content: [{ type: "text", text: explain(err, config) }], isError: true };
  }
}

/** The app has no single-job endpoint, and does not need one: `queuePosition`
 *  is computed only by the list route, so this is the richer read anyway. */
async function findJob(client: ClipdriveClient, id: string): Promise<Job | null> {
  const jobs = await client.jobs();
  return jobs.find((job) => job.id === id) ?? null;
}

async function requireJob(client: ClipdriveClient, id: string): Promise<Job> {
  const job = await findJob(client, id);
  if (job) return job;
  throw new ToolError(
    `No job with id ${id}. Call clipdrive_list_jobs to see current and recent jobs. ` +
      `A job leaves the list when it is canceled or removed, and queued/running/paused jobs ` +
      `are held in memory only — restarting the app loses them.`,
  );
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export const SERVER_INSTRUCTIONS = `ClipDrive turns YouTube links into MP4/MP3 files, either uploaded to a Google Drive folder or kept on disk for you to fetch.

The usual run: clipdrive_status → clipdrive_inspect_video → clipdrive_convert → clipdrive_wait_for_job → clipdrive_save_file (for destination='download') → clipdrive_remove_job to free the disk.

Things worth knowing before you start:
- Every tool talks to a ClipDrive app that must already be running. If it isn't, each tool says so and tells you how to start it.
- ClipDrive runs one job at a time. A second conversion queues behind the first.
- destination='download' needs no Google account at all. destination='drive' needs a connected Drive and a folder id.
- The app's own error messages are in Hebrew; they are quoted verbatim, with an English explanation of what to do.`;

export function registerClipdriveTools(
  server: McpServer,
  client: ClipdriveClient,
  config: McpConfig,
): void {
  /* -- status ---------------------------------------------------- */
  server.registerTool(
    "clipdrive_status",
    {
      title: "ClipDrive status",
      description:
        "Check that the ClipDrive app is reachable and report whether Google Drive is connected, plus a count of jobs by status. Call this first when anything is unclear — every other tool depends on the app running.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        reachable: z.literal(true),
        baseUrl: z.string(),
        drive: z.object({
          connected: z.boolean(),
          email: z.string().nullable(),
          configured: z.boolean(),
          redirectUri: z.string(),
        }),
        jobs: z.record(z.string(), z.number()),
        nextStep: z.string().nullable(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () =>
      guard(config, async () => {
        const [session, jobs] = await Promise.all([client.session(), client.jobs()]);

        const counts: Record<string, number> = { total: jobs.length };
        for (const status of STATUSES) {
          counts[status] = jobs.filter((job) => job.status === status).length;
        }

        const nextStep = !session.configured
          ? `Google OAuth is not configured — GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing from the app's .env. Only destination='download' will work; every Drive tool will return 401.`
          : !session.connected
            ? `Drive is not connected. Ask the human to open ${config.baseUrl} and press the connect button — it is a browser OAuth flow you cannot complete. The app sends Google redirect_uri=${session.redirectUri}, which must appear verbatim under "Authorized redirect URIs" in the Google Cloud console.`
            : counts.failed > 0
              ? `${counts.failed} job(s) have failed. Call clipdrive_list_jobs with status='failed' to see why.`
              : null;

        const structured = {
          reachable: true as const,
          baseUrl: config.baseUrl,
          drive: {
            connected: session.connected,
            email: session.email,
            configured: session.configured,
            redirectUri: session.redirectUri,
          },
          jobs: counts,
          nextStep,
        };

        const text = [
          `ClipDrive is running at ${config.baseUrl}.`,
          session.connected
            ? `Google Drive: connected as ${session.email ?? "unknown account"}.`
            : `Google Drive: not connected (credentials ${session.configured ? "are" : "are NOT"} configured).`,
          `Jobs: ${jobs.length} total — ${STATUSES.map((s) => `${counts[s]} ${s}`).join(", ")}.`,
          ...(nextStep ? ["", nextStep] : []),
        ].join("\n");

        return ok(text, structured);
      }),
  );

  /* -- inspect video --------------------------------------------- */
  server.registerTool(
    "clipdrive_inspect_video",
    {
      title: "Inspect a YouTube video",
      description:
        "Read a YouTube link's title, channel, duration and estimated file size per quality, without converting anything. Use it to confirm a link is usable and to choose a quality before calling clipdrive_convert. Size estimates come from yt-dlp and may be missing for some qualities — a missing entry means 'size unknown', not 'quality unavailable'. This can take several seconds.",
      inputSchema: z.object({
        url: z
          .string()
          .min(1)
          .max(2048)
          .describe(
            "A YouTube URL (watch, youtu.be, shorts, live or embed) or a bare 11-character video id.",
          ),
      }),
      outputSchema: z.object({
        id: z.string(),
        title: z.string(),
        channel: z.string(),
        duration: z.number(),
        durationFormatted: z.string(),
        thumbnail: z.string().nullable(),
        sizeEstimates: z.record(z.string(), z.number()),
        audioSizeEstimate: z.number().nullable(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ url }) =>
      guard(config, async () => {
        const video = await client.video(url);
        const structured = {
          id: video.id,
          title: video.title,
          channel: video.channel,
          duration: video.duration,
          durationFormatted: formatDuration(video.duration),
          thumbnail: video.thumbnail,
          sizeEstimates: video.sizeEstimates as Record<string, number>,
          audioSizeEstimate: video.audioSizeEstimate,
        };

        const sizes = QUALITIES.map((q) => {
          const bytes = video.sizeEstimates[q];
          return bytes ? `${q} ≈ ${formatBytes(bytes)}` : `${q} (size unknown)`;
        }).join("\n  ");

        const text = [
          `${video.title}`,
          `${video.channel} · ${formatDuration(video.duration)}`,
          "",
          "Estimated sizes:",
          `  ${sizes}`,
          `  mp3 ≈ ${video.audioSizeEstimate ? formatBytes(video.audioSizeEstimate) : "unknown"}`,
        ].join("\n");

        return ok(text, structured);
      }),
  );

  /* -- drive folders --------------------------------------------- */
  server.registerTool(
    "clipdrive_list_drive_folders",
    {
      title: "List Drive folders",
      description:
        "List the Google Drive folders ClipDrive can upload into. IMPORTANT: the app holds only the drive.file OAuth scope, so this shows ONLY folders ClipDrive itself created — an empty list does not mean the user's Drive is empty, it means ClipDrive hasn't made a folder yet. Create one with clipdrive_create_drive_folder.",
      inputSchema: z.object({}),
      outputSchema: z.object({
        count: z.number(),
        folders: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            lastUsed: z.number().nullable(),
            fileCount: z.number().nullable(),
          }),
        ),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async () =>
      guard(config, async () => {
        const folders = await client.folders();
        const text = folders.length
          ? folders.map((f) => `${f.id}  ${f.name}${f.fileCount === null ? "" : ` (${f.fileCount} files)`}`).join("\n")
          : "No folders yet. ClipDrive can only see folders it created (drive.file scope) — call clipdrive_create_drive_folder to make one.";
        return ok(text, { count: folders.length, folders });
      }),
  );

  server.registerTool(
    "clipdrive_create_drive_folder",
    {
      title: "Create a Drive folder",
      description:
        "Create a folder in the user's Google Drive for ClipDrive to upload into, and return the id and name that clipdrive_convert needs. Drive allows duplicate names, so calling this twice with the same name creates two folders — check clipdrive_list_drive_folders first.",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(255).describe("Folder name, created at the root of the user's Drive."),
      }),
      outputSchema: z.object({
        id: z.string(),
        name: z.string(),
        lastUsed: z.number().nullable(),
        fileCount: z.number().nullable(),
        nextStep: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name }) =>
      guard(config, async () => {
        const folder = await client.createFolder(name);
        const nextStep = `Pass folder_id=${folder.id} and folder_name=${JSON.stringify(folder.name)} to clipdrive_convert with destination='drive'.`;
        return ok(`Created Drive folder "${folder.name}" (${folder.id}).\n${nextStep}`, {
          ...folder,
          nextStep,
        });
      }),
  );

  /* -- convert ---------------------------------------------------- */
  server.registerTool(
    "clipdrive_convert",
    {
      title: "Convert a YouTube video",
      description:
        "Queue a conversion of a YouTube link to MP4 or MP3. Returns as soon as the job is queued — it does NOT wait for the file; follow it with clipdrive_wait_for_job. ClipDrive runs one job at a time. This call itself takes several seconds because the app reads the video's metadata before queueing. Calling it twice queues two jobs and produces two files.",
      inputSchema: z
        .object({
          url: z.string().min(1).max(2048).describe("A YouTube URL or a bare 11-character video id."),
          format: z.enum(FORMATS).default("mp4").describe("'mp4' for video, 'mp3' for 320kbps audio with ID3 tags."),
          quality: z
            .enum(QUALITIES)
            .default("1080p")
            .describe(
              "Maximum video height; ignored entirely when format='mp3'. Only these four values are accepted — the app itself would silently fall back to 1080p for anything else, so this tool rejects instead.",
            ),
          destination: z
            .enum(DESTINATIONS)
            .describe(
              "Required. 'download' keeps the file on the machine running ClipDrive, to be fetched with clipdrive_save_file. 'drive' uploads it to a Google Drive folder and needs folder_id and folder_name.",
            ),
          folder_id: z.string().min(1).optional().describe("Drive folder id. Required when destination='drive'."),
          folder_name: z.string().min(1).optional().describe("Drive folder name, matching folder_id. Required when destination='drive'."),
        })
        .refine((v) => v.destination !== "drive" || (v.folder_id && v.folder_name), {
          message:
            "destination='drive' needs both folder_id and folder_name. Call clipdrive_list_drive_folders first, or clipdrive_create_drive_folder if there are none — ClipDrive can only see folders it created.",
        }),
      outputSchema: JobDetailSchema.extend({ nextStep: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ url, format, quality, destination, folder_id, folder_name }) =>
      guard(config, async () => {
        const job = await client.createJob({
          url,
          format,
          quality,
          destination,
          folderId: destination === "drive" ? folder_id ?? null : null,
          folderName: destination === "drive" ? folder_name ?? null : null,
        });

        const nextStep = `Call clipdrive_wait_for_job with job_id=${job.id} to block until it finishes.`;
        const text = [
          `Queued: ${job.title}`,
          `  ${job.format.toUpperCase()}${job.format === "mp4" ? ` ${job.quality}` : ""} → ${
            job.destination === "drive" ? `Drive folder "${job.folderName}"` : "direct download"
          }`,
          `  job_id ${job.id}`,
          nextStep,
        ].join("\n");

        return ok(text, { ...detail(job), nextStep });
      }),
  );

  /* -- list / get ------------------------------------------------- */
  server.registerTool(
    "clipdrive_list_jobs",
    {
      title: "List ClipDrive jobs",
      description:
        "List conversion jobs, newest first: what is running now and what recently finished. The app keeps the last 50 finished jobs plus anything live. Note that 'canceled' never appears — a canceled job is deleted outright.",
      inputSchema: z.object({
        status: z
          .union([z.enum(STATUSES), z.literal("active")])
          .optional()
          .describe("Filter by status. 'active' means queued, running or paused. Omit for everything."),
        limit: z.number().int().min(1).max(50).default(20).describe("Maximum jobs to return."),
        offset: z.number().int().min(0).default(0).describe("How many to skip, newest first."),
      }),
      outputSchema: z.object({
        total: z.number(),
        count: z.number(),
        offset: z.number(),
        has_more: z.boolean(),
        next_offset: z.number().optional(),
        jobs: z.array(JobSummarySchema),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ status, limit, offset }) =>
      guard(config, async () => {
        const all = await client.jobs();
        const filtered = !status
          ? all
          : status === "active"
            ? all.filter((job) => ACTIVE.includes(job.status))
            : all.filter((job) => job.status === status);

        const page = filtered.slice(offset, offset + limit).map(summarize);
        const hasMore = offset + page.length < filtered.length;

        const structured = {
          total: filtered.length,
          count: page.length,
          offset,
          has_more: hasMore,
          ...(hasMore ? { next_offset: offset + page.length } : {}),
          jobs: page,
        };

        const text = page.length
          ? `${filtered.length} job(s)${status ? ` with status '${status}'` : ""}; showing ${page.length}.\n\n${page.map(jobLine).join("\n")}`
          : `No jobs${status ? ` with status '${status}'` : ""}.`;

        return ok(text, structured);
      }),
  );

  server.registerTool(
    "clipdrive_get_job",
    {
      title: "Get one job",
      description:
        "Read one job in full: its state, progress, and where its file ended up. Use this for a one-off check; use clipdrive_wait_for_job when you want to block until it finishes.",
      inputSchema: z.object({ job_id: z.string().min(1).describe("Job id from clipdrive_convert or clipdrive_list_jobs.") }),
      outputSchema: JobDetailSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ job_id }) =>
      guard(config, async () => {
        const job = await requireJob(client, job_id);
        return ok(describeState(job), detail(job));
      }),
  );

  /* -- wait ------------------------------------------------------- */
  server.registerTool(
    "clipdrive_wait_for_job",
    {
      title: "Wait for a job to finish",
      description:
        "Block until a job finishes, fails, is paused, or the timeout expires, then report what happened. A timeout is NOT a failure — it returns the job's current progress and you can call it again with the same id. Returns as soon as the job is paused, because nothing will move a paused job until you resume it.",
      inputSchema: z.object({
        job_id: z.string().min(1),
        timeout_seconds: z
          .number()
          .int()
          .min(5)
          .max(3600)
          .default(600)
          .describe("How long to wait. Long 4K conversions can take tens of minutes."),
      }),
      outputSchema: z.object({
        outcome: z.enum(["done", "failed", "paused", "gone", "timeout"]),
        timedOut: z.boolean(),
        waitedSeconds: z.number(),
        job: JobSummarySchema.nullable(),
        nextStep: z.string().nullable(),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ job_id, timeout_seconds }) =>
      guard(config, async () => {
        const startedAt = Date.now();
        // Polling rather than the SSE stream: at a one-second tick the outcome
        // is the same for a job measured in minutes, and there is no stream
        // lifecycle to get wrong under either transport.
        let seen = await requireJob(client, job_id);

        for (;;) {
          const elapsed = (Date.now() - startedAt) / 1000;
          const job = await findJob(client, job_id);

          if (!job) {
            return finishWait("gone", seen, elapsed, config, null);
          }
          seen = job;

          if (job.status === "done" || job.status === "failed" || job.status === "paused") {
            return finishWait(job.status, job, elapsed, config, null);
          }
          if (elapsed >= timeout_seconds) {
            return finishWait("timeout", job, elapsed, config, timeout_seconds);
          }
          await sleep(1000);
        }
      }),
  );

  /* -- control ---------------------------------------------------- */
  server.registerTool(
    "clipdrive_control_job",
    {
      title: "Pause, resume or retry a job",
      description:
        "Pause a running job (its partial download is kept), resume a paused one, or retry a failed one from the stage that broke. Each action only applies to one status; this tool checks first and tells you plainly when an action would do nothing, because the app's own API silently accepts a no-op.",
      inputSchema: z.object({
        job_id: z.string().min(1),
        action: z
          .enum(["pause", "resume", "retry"])
          .describe("'pause' needs a running job, 'resume' a paused one, 'retry' a failed one."),
      }),
      outputSchema: z.object({
        action: z.enum(["pause", "resume", "retry"]),
        changed: z.boolean(),
        previousStatus: z.enum(STATUSES),
        status: z.enum(STATUSES),
        job: JobSummarySchema,
        note: z.string().nullable(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ job_id, action }) =>
      guard(config, async () => {
        const before = await requireJob(client, job_id);
        assertActionApplies(before, action);

        await client.jobAction(job_id, action);

        // Re-read from the list rather than trusting the action response: only
        // the list route fills in queuePosition, which is exactly what a
        // just-queued retry needs to report.
        const after = (await findJob(client, job_id)) ?? before;
        const changed = after.status !== before.status;

        const note = changed
          ? null
          : `ClipDrive accepted the request but job ${job_id} is still '${after.status}'. It most likely changed state between the check and the action — re-read it with clipdrive_get_job.`;

        const text = changed
          ? `${action}: ${before.status} → ${after.status}\n${describeState(after)}`
          : `${action} made no difference — ${note}`;

        return ok(text, {
          action,
          changed,
          previousStatus: before.status,
          status: after.status,
          job: summarize(after),
          note,
        });
      }),
  );

  /* -- remove ----------------------------------------------------- */
  server.registerTool(
    "clipdrive_remove_job",
    {
      title: "Remove a job",
      description:
        "Drop a job from ClipDrive's list. A running, queued or paused job is canceled. A finished direct-download job has its converted file PERMANENTLY DELETED from disk — save it with clipdrive_save_file first if you still want it. A file already uploaded to Google Drive is never touched; only the card goes.",
      inputSchema: z.object({ job_id: z.string().min(1) }),
      outputSchema: z.object({
        removed: z.boolean(),
        jobId: z.string(),
        previousStatus: z.enum(STATUSES).nullable(),
        wasCanceled: z.boolean(),
        deletedLocalFile: z.boolean(),
        driveFileKept: z.boolean(),
        note: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ job_id }) =>
      guard(config, async () => {
        const before = await findJob(client, job_id);
        if (!before) {
          // DELETE answers 200 for an unknown id, so "already gone" is decided
          // here rather than reported as a success that did nothing.
          const note = `No job with id ${job_id} — nothing to remove.`;
          return ok(note, {
            removed: false,
            jobId: job_id,
            previousStatus: null,
            wasCanceled: false,
            deletedLocalFile: false,
            driveFileKept: false,
            note,
          });
        }

        await client.deleteJob(job_id);
        const stillThere = await findJob(client, job_id);

        const wasCanceled = ACTIVE.includes(before.status);
        const deletedLocalFile = before.destination === "download" && before.status === "done";
        const driveFileKept = Boolean(before.driveFileId);

        const note = stillThere
          ? `ClipDrive still lists job ${job_id} as '${stillThere.status}' after the delete. Nothing was removed.`
          : [
              `Removed "${before.title}" (was ${before.status}).`,
              wasCanceled ? "It was in flight, so it was canceled and its partial files deleted." : "",
              deletedLocalFile
                ? `Its converted file${before.bytes ? ` (${formatBytes(before.bytes)})` : ""} has been deleted from the app's working directory.`
                : "",
              driveFileKept ? `The file in Google Drive is untouched: ${before.driveLink ?? before.driveFileId}` : "",
            ]
              .filter(Boolean)
              .join(" ");

        return ok(note, {
          removed: !stillThere,
          jobId: job_id,
          previousStatus: before.status,
          wasCanceled,
          deletedLocalFile: deletedLocalFile && !stillThere,
          driveFileKept,
          note,
        });
      }),
  );

  /* -- save file --------------------------------------------------- */
  server.registerTool(
    "clipdrive_save_file",
    {
      title: "Save a finished file",
      description:
        "Copy a finished direct-download job's file to a path on the machine running this MCP server. Only works for destination='download' jobs that have finished — a Drive job's file lives in Google Drive and is reported as a link instead. ClipDrive keeps its own copy afterwards, so call clipdrive_remove_job when you no longer need it there.",
      inputSchema: z.object({
        job_id: z.string().min(1),
        path: z
          .string()
          .min(1)
          .optional()
          .describe(
            "Where to write it: an absolute path, an existing directory (the file keeps ClipDrive's name), or a path relative to the default download directory. Omit to use the default directory. The absolute path actually written is always returned.",
          ),
        overwrite: z.boolean().default(false).describe("Replace an existing file. Default false — an existing file is an error, never a silent rename."),
      }),
      outputSchema: z.object({
        path: z.string(),
        fileName: z.string(),
        bytes: z.number(),
        bytesFormatted: z.string(),
        contentType: z.string(),
        overwritten: z.boolean(),
        jobId: z.string(),
        title: z.string(),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ job_id, path: target, overwrite }) =>
      guard(config, async () => {
        const job = await requireJob(client, job_id);
        assertFileIsFetchable(job);

        try {
          const saved = await saveJobFile({ client, config, job, target, overwrite });
          const text = [
            `Saved "${job.title}" to ${saved.path}`,
            `  ${formatBytes(saved.bytes)} · ${saved.contentType}${saved.overwritten ? " · replaced an existing file" : ""}`,
            `ClipDrive still holds its own copy; clipdrive_remove_job frees that space.`,
          ].join("\n");
          return ok(text, {
            path: saved.path,
            fileName: saved.fileName,
            bytes: saved.bytes,
            bytesFormatted: formatBytes(saved.bytes),
            contentType: saved.contentType,
            overwritten: saved.overwritten,
            jobId: job.id,
            title: job.title,
          });
        } catch (err) {
          if (err instanceof ClipdriveApiError && err.status === 410) {
            throw new ToolError(
              `ClipDrive says the file is gone: "${err.hebrew}" — the job's card was removed, or the app pruned its working directory on startup. Run the conversion again with clipdrive_convert.`,
            );
          }
          throw err;
        }
      }),
  );
}

/* ------------------------------------------------------------------ */
/* Preconditions                                                       */
/* ------------------------------------------------------------------ */

function assertActionApplies(job: Job, action: "pause" | "resume" | "retry"): void {
  if (action === "pause" && job.status !== "running") {
    throw new ToolError(
      job.status === "queued"
        ? `Job ${job.id} is queued${job.queuePosition ? ` at position ${job.queuePosition}` : ""}, not running — ClipDrive runs one job at a time and this one hasn't started, so there is nothing to pause. To drop it from the queue, use clipdrive_remove_job.`
        : `Job ${job.id} is '${job.status}', not 'running'. Only a running job can be paused.`,
    );
  }
  if (action === "resume" && job.status !== "paused") {
    throw new ToolError(
      `Job ${job.id} is '${job.status}', not 'paused'. Nothing to resume.` +
        (job.status === "failed" ? " Use action='retry' instead." : ""),
    );
  }
  if (action === "retry" && job.status !== "failed") {
    throw new ToolError(
      `Job ${job.id} is '${job.status}', not 'failed'. Only a failed job can be retried.` +
        (job.status === "done" ? " It already finished — call clipdrive_convert again if you want another copy." : ""),
    );
  }
}

/**
 * `GET /api/jobs/[id]/file` answers 404 both for an unknown job and for a Drive
 * job, which are very different problems. Deciding here means the agent is told
 * which one it hit.
 */
function assertFileIsFetchable(job: Job): void {
  if (job.destination === "drive") {
    throw new ToolError(
      `Job ${job.id} ("${job.title}") was uploaded to Google Drive, so there is no local file to copy. ` +
        (job.driveLink
          ? `Open it at ${job.driveLink}.`
          : `It hasn't finished uploading yet.`) +
        ` To get a local copy, run clipdrive_convert again with destination='download'.`,
    );
  }
  if (job.status === "failed") {
    const hint = job.error ? toolingHint(job.error) : null;
    throw new ToolError(
      `Job ${job.id} failed at the '${job.failedStage ?? job.stage}' stage, so there is no file.\n` +
        `ClipDrive says (Hebrew): "${job.error ?? "unknown"}"` +
        (hint ? `\n\n${hint}` : `\n\nCall clipdrive_control_job with action='retry' to continue from the stage that broke.`),
    );
  }
  if (job.status !== "done") {
    throw new ToolError(
      `Job ${job.id} is '${job.status}' at stage '${job.stage}' ${Math.round(job.stagePercent)}% — the file doesn't exist yet. ` +
        `Call clipdrive_wait_for_job with job_id=${job.id} first.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

function describeState(job: Job): string {
  const summary = summarize(job);
  const head = `${job.title}\n  ${job.status} · stage ${job.stage} ${summary.stagePercent}% · ${summary.overallPercent}% overall`;

  if (job.status === "done") {
    return job.destination === "drive"
      ? `${head}\n  In Drive folder "${job.folderName}": ${job.driveLink ?? "(no link)"}`
      : `${head}\n  Waiting on disk as "${job.fileName ?? "?"}"${job.bytes ? ` (${formatBytes(job.bytes)})` : ""} — fetch it with clipdrive_save_file.`;
  }
  if (job.status === "failed") {
    const hint = job.error ? toolingHint(job.error) : null;
    return `${head}\n  Failed at '${job.failedStage ?? job.stage}'. ClipDrive says (Hebrew): "${job.error ?? "unknown"}"${hint ? `\n\n  ${hint}` : ""}`;
  }
  return head;
}

function finishWait(
  outcome: "done" | "failed" | "paused" | "gone" | "timeout",
  job: Job,
  elapsed: number,
  config: McpConfig,
  timeoutSeconds: number | null,
): ToolResult {
  void config;
  const waitedSeconds = Math.round(elapsed);
  const summary = summarize(job);

  const nextStep =
    outcome === "done" && job.destination === "download"
      ? `Call clipdrive_save_file with job_id=${job.id} to copy the file somewhere you want it.`
      : outcome === "done"
        ? `The file is in Drive: ${job.driveLink ?? "(no link)"}`
        : outcome === "failed"
          ? `Call clipdrive_control_job with action='retry' to continue from the stage that broke.`
          : outcome === "paused"
            ? `Call clipdrive_control_job with action='resume' to continue.`
            : outcome === "timeout"
              ? `Not a failure — call clipdrive_wait_for_job again with the same job_id, or clipdrive_get_job to check without blocking.`
              : null;

  const header =
    outcome === "gone"
      ? `Job ${job.id} disappeared while waiting — it was canceled or removed (a canceled job is deleted immediately).`
      : outcome === "timeout"
        ? `Still going after ${timeoutSeconds}s: stage '${job.stage}' ${summary.stagePercent}% (${summary.overallPercent}% overall).`
        : describeState(job);

  return ok(nextStep ? `${header}\n\n${nextStep}` : header, {
    outcome,
    timedOut: outcome === "timeout",
    waitedSeconds,
    job: outcome === "gone" ? null : summary,
    nextStep,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
