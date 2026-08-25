import {
  ClipdriveApiError,
  ClipdriveOfflineError,
  ClipdriveTimeoutError,
} from "./errors";
import type {
  CreateJobInput,
  DriveFolder,
  Job,
  VideoMeta,
} from "../lib/types";

export interface SessionInfo {
  connected: boolean;
  email: string | null;
  configured: boolean;
  redirectUri: string;
}

/** Seconds. `POST /api/jobs` and `/api/video` both block on a yt-dlp metadata
 *  read that sweeps up to six player clients, so they get their own budget. */
const TIMEOUT = { fast: 30, metadata: 180 } as const;

/**
 * The one place that speaks HTTP to ClipDrive.
 *
 * Everything goes through the app's public API rather than importing
 * `src/lib/jobs.ts`: the job store is an in-process singleton, so a second
 * process that imported it would get a second, disconnected queue. The in-app
 * transport calls its own origin for the same reason it would call any other
 * service — one code path, and the routes keep owning validation.
 */
export class ClipdriveClient {
  constructor(readonly baseUrl: string) {}

  session(): Promise<SessionInfo> {
    return this.json<SessionInfo>("/api/auth/session", { seconds: TIMEOUT.fast });
  }

  async video(url: string): Promise<VideoMeta> {
    const path = `/api/video?url=${encodeURIComponent(url)}`;
    const { video } = await this.json<{ video: VideoMeta }>(path, {
      seconds: TIMEOUT.metadata,
    });
    return video;
  }

  async jobs(): Promise<Job[]> {
    const { jobs } = await this.json<{ jobs: Job[] }>("/api/jobs", {
      seconds: TIMEOUT.fast,
    });
    return jobs;
  }

  async createJob(input: CreateJobInput): Promise<Job> {
    const { job } = await this.json<{ job: Job }>("/api/jobs", {
      method: "POST",
      body: input,
      seconds: TIMEOUT.metadata,
    });
    return job;
  }

  async jobAction(id: string, action: "pause" | "resume" | "retry"): Promise<void> {
    await this.json(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "POST",
      body: { action },
      seconds: TIMEOUT.fast,
    });
  }

  async deleteJob(id: string): Promise<void> {
    await this.json(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      seconds: TIMEOUT.fast,
    });
  }

  async folders(): Promise<DriveFolder[]> {
    const { folders } = await this.json<{ folders: DriveFolder[] }>(
      "/api/drive/folders",
      { seconds: TIMEOUT.fast },
    );
    return folders;
  }

  async createFolder(name: string): Promise<DriveFolder> {
    const { folder } = await this.json<{ folder: DriveFolder }>("/api/drive/folders", {
      method: "POST",
      body: { name },
      seconds: TIMEOUT.fast,
    });
    return folder;
  }

  /** The raw response, so the caller can stream the body and read the headers. */
  async fileResponse(id: string): Promise<Response> {
    const res = await this.send(`/api/jobs/${encodeURIComponent(id)}/file`, {
      seconds: 3600,
    });
    if (!res.ok) throw await apiError(res);
    return res;
  }

  private async json<T>(path: string, init: SendInit): Promise<T> {
    const res = await this.send(path, init);
    if (!res.ok) throw await apiError(res);
    return (await res.json()) as T;
  }

  private async send(path: string, init: SendInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, {
        method: init.method ?? "GET",
        headers: init.body ? { "content-type": "application/json" } : undefined,
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(init.seconds * 1000),
        cache: "no-store",
      });
    } catch (err) {
      throw transportError(err, this.baseUrl, init.seconds, path);
    }
  }
}

interface SendInit {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  seconds: number;
}

/** Reads the `{error, code, detail}` body every route uses for failures. */
async function apiError(res: Response): Promise<ClipdriveApiError> {
  let hebrew = `HTTP ${res.status}`;
  let code: string | undefined;
  let detail: string | undefined;
  try {
    const body = (await res.json()) as { error?: string; code?: string; detail?: string };
    if (body.error) hebrew = body.error;
    code = body.code;
    detail = body.detail;
  } catch {
    /* a route that failed before it could serialize JSON */
  }
  return new ClipdriveApiError(res.status, hebrew, code, detail);
}

/**
 * Node's fetch throws a bare `TypeError: fetch failed` and hides the real
 * reason on `cause`. An agent told "fetch failed" learns nothing; an agent told
 * ECONNREFUSED knows to ask for the app to be started.
 */
function transportError(
  err: unknown,
  baseUrl: string,
  seconds: number,
  path: string,
): Error {
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")) {
    return new ClipdriveTimeoutError(seconds, `${path} is still working`);
  }
  const cause = (err as { cause?: { code?: string } } | undefined)?.cause;
  return new ClipdriveOfflineError(baseUrl, cause?.code ?? (err instanceof Error ? err.message : "unknown"));
}
