/** Shared vocabulary between the pipeline, the API routes and the UI. */

export type Format = "mp4" | "mp3";

/** Video heights the picker offers. MP3 ignores this entirely. */
export type Quality = "720p" | "1080p" | "1440p" | "4k";

export const QUALITIES: Quality[] = ["720p", "1080p", "1440p", "4k"];

/** Max video height fed to yt-dlp's format selector. */
export const QUALITY_HEIGHT: Record<Quality, number> = {
  "720p": 720,
  "1080p": 1080,
  "1440p": 1440,
  "4k": 2160,
};

/**
 * The three stages the progress meter renders, in pipeline order. The meter is
 * always three segments wide — a stage that hasn't started is an empty segment,
 * so the user can see the whole road ahead, not just the current step.
 */
export type Stage = "download" | "convert" | "upload";

export const STAGES: Stage[] = ["download", "convert", "upload"];

export const STAGE_LABEL: Record<Stage, string> = {
  download: "הורדה",
  convert: "המרה",
  upload: "העלאה לדרייב",
};

export type JobStatus =
  | "queued"
  | "running"
  | "paused"
  | "done"
  | "failed"
  | "canceled";

export interface VideoMeta {
  id: string;
  title: string;
  channel: string;
  /** Seconds. */
  duration: number;
  thumbnail: string | null;
  /** Per-quality byte estimates, when yt-dlp reports them. */
  sizeEstimates: Partial<Record<Quality, number>>;
  audioSizeEstimate: number | null;
}

export interface Job {
  id: string;
  url: string;
  format: Format;
  quality: Quality;
  /** Drive folder the finished file lands in. */
  folderId: string;
  folderName: string;

  title: string;
  channel: string;
  duration: number;
  thumbnail: string | null;

  status: JobStatus;
  stage: Stage;
  /** 0–100 within the current stage. */
  stagePercent: number;
  /** Bytes/sec during download, when known. */
  speed: number | null;
  /** Seconds remaining in the current stage, when known. */
  eta: number | null;
  /** Final file size once known. */
  bytes: number | null;

  /** Set when status is "failed" — the stage that broke. */
  failedStage: Stage | null;
  error: string | null;

  /** webViewLink of the uploaded Drive file. */
  driveLink: string | null;
  driveFileId: string | null;

  createdAt: number;
  finishedAt: number | null;
  /** Position in the queue, 1-based, while status is "queued". */
  queuePosition?: number;
}

/** What `POST /api/jobs` accepts. */
export interface CreateJobInput {
  url: string;
  format: Format;
  quality: Quality;
  folderId: string;
  folderName: string;
}

export interface DriveFolder {
  id: string;
  name: string;
  /** ms epoch of the last time a ClipDrive file landed here. */
  lastUsed: number | null;
  fileCount: number | null;
}

export interface AuthState {
  connected: boolean;
  email: string | null;
}

/** Error codes the link field turns into a Hebrew sentence. */
export type LinkErrorCode =
  | "not_youtube"
  | "private"
  | "unavailable"
  | "geo_blocked"
  | "age_restricted"
  /** YouTube demanded a human check — usually fixed by cookies. */
  | "bot_check"
  /** yt-dlp is behind YouTube's current player. */
  | "outdated"
  | "unknown";
