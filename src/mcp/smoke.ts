/**
 * End-to-end smoke test for the ClipDrive MCP server.
 *
 * It starts a real ClipDrive against a seeded data directory, drives the real
 * stdio server through a real MCP client, and checks what an agent would
 * actually receive. Run it with `npm run mcp:smoke` (build the app first).
 *
 * yt-dlp and ffmpeg are not needed: the app turns a missing binary into a
 * specific Hebrew error, which is itself one of the things worth asserting.
 * What genuinely cannot be covered here is a successful conversion — that
 * needs yt-dlp, ffmpeg and a reachable YouTube.
 */
import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { CallToolResult } from "@modelcontextprotocol/server";
import type { Job } from "../lib/types";

const REPO = path.resolve(import.meta.dirname ?? __dirname, "../..");

/* ------------------------------------------------------------------ */
/* Tiny harness                                                        */
/* ------------------------------------------------------------------ */

let passed = 0;
const failures: string[] = [];

function check(label: string, condition: unknown, detail?: unknown): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL ${label}${detail === undefined ? "" : `\n       ${JSON.stringify(detail)?.slice(0, 400)}`}`);
  }
}

function section(name: string): void {
  console.log(`\n${name}`);
}

const text = (result: CallToolResult): string =>
  result.content.map((c) => ("text" in c ? c.text : "")).join("\n");

const structured = <T>(result: CallToolResult): T =>
  result.structuredContent as T;

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

const IDS = {
  localDone: "11111111-1111-1111-1111-111111111111",
  driveFailed: "22222222-2222-2222-2222-222222222222",
  driveDone: "33333333-3333-3333-3333-333333333333",
  running: "44444444-4444-4444-4444-444444444444",
  fileMissing: "55555555-5555-5555-5555-555555555555",
};

const FILE_NAME = "בדיקה עברית (live).mp4";
const FILE_BYTES = 1024;

function job(overrides: Partial<Job> & Pick<Job, "id" | "status" | "destination">): Job {
  return {
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    format: "mp4",
    quality: "1080p",
    folderId: null,
    folderName: null,
    title: `job ${overrides.id.slice(0, 8)}`,
    channel: "ערוץ",
    duration: 754,
    thumbnail: null,
    stage: "convert",
    stagePercent: 100,
    speed: null,
    eta: null,
    bytes: FILE_BYTES,
    failedStage: null,
    error: null,
    driveLink: null,
    driveFileId: null,
    fileName: null,
    createdAt: 1_756_000_000_000,
    finishedAt: 1_756_000_060_000,
    ...overrides,
  };
}

async function seedDataDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "clipdrive-mcp-smoke-"));

  const jobs: Job[] = [
    job({
      id: IDS.localDone,
      status: "done",
      destination: "download",
      title: "הרצאה על עיצוב ממשקים",
      fileName: FILE_NAME,
    }),
    job({
      id: IDS.driveFailed,
      status: "failed",
      destination: "drive",
      title: "מצגת שנתית",
      folderId: "folder-abc",
      folderName: "סרטונים",
      stage: "download",
      stagePercent: 12,
      failedStage: "download",
      error: "לא נמצא yt-dlp במערכת (yt-dlp). התקינו אותו והריצו שוב.",
      bytes: null,
    }),
    job({
      id: IDS.driveDone,
      status: "done",
      destination: "drive",
      title: "שיר לדוגמה",
      format: "mp3",
      stage: "upload",
      folderId: "folder-abc",
      folderName: "סרטונים",
      driveLink: "https://drive.google.com/file/d/xyz/view",
      driveFileId: "xyz",
      fileName: "שיר לדוגמה.mp3",
    }),
    // A seeded "running" job pins the queue: MAX_CONCURRENT is 1 and pump()
    // returns early while anything is running, so no mutation in this test can
    // start a real yt-dlp until we deliberately unpin it at the end.
    job({
      id: IDS.running,
      status: "running",
      destination: "download",
      title: "פודקאסט — פרק 12",
      stage: "download",
      stagePercent: 37,
      finishedAt: null,
    }),
    job({
      id: IDS.fileMissing,
      status: "done",
      destination: "download",
      title: "משימה בלי קובץ",
      fileName: "gone.mp4",
    }),
  ];

  await writeFile(path.join(dir, "history.json"), JSON.stringify(jobs, null, 2));

  // Only the first job gets a real file. It must be non-empty: findOutput
  // treats a zero-byte file as no file at all.
  const workDir = path.join(dir, "work", IDS.localDone);
  await mkdir(workDir, { recursive: true });
  await writeFile(path.join(workDir, "output.mp4"), Buffer.alloc(FILE_BYTES, 7));

  return dir;
}

/* ------------------------------------------------------------------ */
/* App under test                                                      */
/* ------------------------------------------------------------------ */

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startApp(dataDir: string, port: number): Promise<ChildProcess> {
  if (!existsSync(path.join(REPO, ".next", "BUILD_ID"))) {
    throw new Error("No production build found — run `npm run build` first.");
  }

  const child = spawn(
    process.execPath,
    [path.join(REPO, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(port)],
    {
      cwd: REPO,
      stdio: ["ignore", "ignore", "inherit"],
      env: {
        ...process.env,
        CLIPDRIVE_DATA_DIR: dataDir,
        GOOGLE_CLIENT_ID: "",
        GOOGLE_CLIENT_SECRET: "",
        NODE_ENV: "production",
      },
    },
  );

  const deadline = Date.now() + 40_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("ClipDrive did not start within 40s");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/auth/session`);
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    await sleep(400);
  }
}

function connectServer(baseUrl: string): Promise<{ client: Client; close: () => Promise<void> }> {
  const transport = new StdioClientTransport({
    command: path.join(REPO, "node_modules", ".bin", "tsx"),
    args: [path.join(REPO, "src", "mcp", "stdio.ts")],
    cwd: REPO,
    // env REPLACES the inherited allowlist, so the default has to be spread in
    // or the server loses PATH and NODE_ENV along with everything else.
    env: { ...getDefaultEnvironment(), CLIPDRIVE_BASE_URL: baseUrl },
    stderr: "pipe",
  });
  const client = new Client({ name: "clipdrive-smoke", version: "1.0.0" });
  return client
    .connect(transport)
    .then(() => ({ client, close: () => client.close() }));
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* The run                                                             */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  const dataDir = await seedDataDir();
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const saveDir = path.join(dataDir, "saved");

  let app: ChildProcess | undefined;
  let session: { client: Client; close: () => Promise<void> } | undefined;

  try {
    app = await startApp(dataDir, port);
    session = await connectServer(baseUrl);
    const { client } = session;
    const call = (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args });

    /* -- the seeding actually took ------------------------------- */
    section("fixture");
    const seeded = (await (await fetch(`${baseUrl}/api/jobs`)).json()) as { jobs: Job[] };
    check(
      "app is running against the seeded data directory",
      seeded.jobs.length === 5,
      seeded.jobs.map((j) => j.id),
    );

    /* -- tools/list ---------------------------------------------- */
    section("tools/list");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    check("exposes 11 tools", tools.length === 11, names);
    check(
      "every tool is named, described and annotated",
      tools.every((t) => t.name.startsWith("clipdrive_") && (t.description ?? "").length > 40 && t.annotations),
    );
    const remove = tools.find((t) => t.name === "clipdrive_remove_job");
    check("remove_job is marked destructive", remove?.annotations?.destructiveHint === true);
    const readOnly = tools.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name);
    check(
      "the six observing tools are marked read-only",
      readOnly.length === 6 && readOnly.every((n) => !["clipdrive_convert", "clipdrive_control_job", "clipdrive_remove_job", "clipdrive_save_file", "clipdrive_create_drive_folder"].includes(n)),
      readOnly,
    );

    /* -- status --------------------------------------------------- */
    section("clipdrive_status");
    const status = await call("clipdrive_status");
    const statusOut = structured<{ reachable: boolean; drive: { connected: boolean; configured: boolean }; jobs: Record<string, number> }>(status);
    check("reports the app as reachable", statusOut.reachable === true);
    check("reports Drive as unconfigured", statusOut.drive.configured === false && statusOut.drive.connected === false);
    check("counts the seeded jobs", statusOut.jobs.total === 5 && statusOut.jobs.done === 3 && statusOut.jobs.failed === 1 && statusOut.jobs.running === 1, statusOut.jobs);
    check("points at the missing .env", text(status).includes(".env"));

    /* -- list / get ----------------------------------------------- */
    section("listing jobs");
    const all = structured<{ total: number; jobs: { id: string }[] }>(await call("clipdrive_list_jobs"));
    check("lists all five", all.total === 5 && all.jobs.length === 5);
    const active = structured<{ total: number }>(await call("clipdrive_list_jobs", { status: "active" }));
    check("'active' finds the running job only", active.total === 1);
    const failedOnly = structured<{ total: number }>(await call("clipdrive_list_jobs", { status: "failed" }));
    check("filters by status", failedOnly.total === 1);
    const page = structured<{ has_more: boolean; next_offset?: number; count: number }>(
      await call("clipdrive_list_jobs", { limit: 2 }),
    );
    check("paginates", page.count === 2 && page.has_more && page.next_offset === 2);

    const one = await call("clipdrive_get_job", { job_id: IDS.localDone });
    const oneOut = structured<{ overallPercent: number; stages: string[]; fileName: string }>(one);
    check("a finished direct download reads as 100%", oneOut.overallPercent === 100);
    check("a direct download has two stages, not three", oneOut.stages.length === 2, oneOut.stages);
    const missing = await call("clipdrive_get_job", { job_id: "00000000-0000-0000-0000-000000000000" });
    check("an unknown id is an error that names the list tool", missing.isError === true && text(missing).includes("clipdrive_list_jobs"));

    /* -- waiting --------------------------------------------------- */
    section("clipdrive_wait_for_job");
    const waitDone = await call("clipdrive_wait_for_job", { job_id: IDS.localDone, timeout_seconds: 10 });
    const waitDoneOut = structured<{ outcome: string; nextStep: string }>(waitDone);
    check("a finished job returns at once", waitDoneOut.outcome === "done");
    check("and points at save_file", waitDoneOut.nextStep.includes("clipdrive_save_file"));

    const waitFailed = await call("clipdrive_wait_for_job", { job_id: IDS.driveFailed, timeout_seconds: 10 });
    check("a failed job reports the failure", structured<{ outcome: string }>(waitFailed).outcome === "failed");
    check("quoting ClipDrive's Hebrew verbatim", text(waitFailed).includes("לא נמצא yt-dlp במערכת"));
    check("and explaining it in English", text(waitFailed).includes("pip install -U yt-dlp"));

    const started = Date.now();
    const waitTimeout = await call("clipdrive_wait_for_job", { job_id: IDS.running, timeout_seconds: 5 });
    const timeoutOut = structured<{ outcome: string; timedOut: boolean; job: { stagePercent: number } }>(waitTimeout);
    check("a timeout waits the requested time", Date.now() - started >= 4500);
    check("a timeout is not an error", waitTimeout.isError !== true && timeoutOut.timedOut === true && timeoutOut.outcome === "timeout");
    check("and reports live progress", timeoutOut.job.stagePercent === 37);

    /* -- strictness ------------------------------------------------ */
    section("input validation");
    const badQuality = await call("clipdrive_convert", { url: "https://youtu.be/dQw4w9WgXcQ", destination: "download", quality: "2160p" });
    check("an unsupported quality is rejected, not silently downgraded", badQuality.isError === true);

    const before = structured<{ total: number }>(await call("clipdrive_list_jobs")).total;
    const noFolder = await call("clipdrive_convert", { url: "https://youtu.be/dQw4w9WgXcQ", destination: "drive" });
    check("a Drive conversion without a folder is refused", noFolder.isError === true);
    check("naming the tool that would fix it", text(noFolder).includes("clipdrive_list_drive_folders"));
    check(
      "and no job was created",
      structured<{ total: number }>(await call("clipdrive_list_jobs")).total === before,
    );

    const notYoutube = await call("clipdrive_convert", { url: "https://example.com/video", destination: "download" });
    check("a non-YouTube link is refused by the app", notYoutube.isError === true && text(notYoutube).includes("not_youtube"));

    /* -- a real conversion attempt, without yt-dlp ------------------ */
    section("clipdrive_convert without yt-dlp installed");
    const noYtDlp = await call("clipdrive_convert", { url: "https://youtu.be/dQw4w9WgXcQ", destination: "download" });
    check("the conversion fails", noYtDlp.isError === true);
    check("quoting the Hebrew message", text(noYtDlp).includes("לא נמצא yt-dlp"));
    check("and saying how to fix it", text(noYtDlp).includes("YT_DLP_PATH"));
    check(
      "no job is left behind",
      structured<{ total: number }>(await call("clipdrive_list_jobs")).total === before,
    );

    /* -- drive tools ------------------------------------------------ */
    section("Drive tools without a connection");
    const folders = await call("clipdrive_list_drive_folders");
    check("listing folders reports the missing connection", folders.isError === true && text(folders).includes("לא מחובר לגוגל דרייב"));
    check("with an English remedy", text(folders).includes("clipdrive_status"));
    const createFolder = await call("clipdrive_create_drive_folder", { name: "בדיקה" });
    check("creating a folder fails the same way", createFolder.isError === true);
    const blankName = await call("clipdrive_create_drive_folder", { name: "   " });
    check("a blank folder name is rejected before any request", blankName.isError === true);

    /* -- saving files ------------------------------------------------ */
    section("clipdrive_save_file");
    const saved = await call("clipdrive_save_file", { job_id: IDS.localDone, path: `${saveDir}/` });
    const savedOut = structured<{ path: string; bytes: number; fileName: string }>(saved);
    check("writes the file", saved.isError !== true && savedOut.bytes === FILE_BYTES, text(saved));
    check("keeping the Hebrew name from content-disposition", savedOut.fileName === FILE_NAME, savedOut.fileName);
    check("at an absolute path that exists", path.isAbsolute(savedOut.path) && existsSync(savedOut.path));
    check("with the right size on disk", (await stat(savedOut.path)).size === FILE_BYTES);

    const again = await call("clipdrive_save_file", { job_id: IDS.localDone, path: savedOut.path });
    check("refuses to overwrite by default", again.isError === true && text(again).includes("overwrite=true"));
    const overwritten = await call("clipdrive_save_file", { job_id: IDS.localDone, path: savedOut.path, overwrite: true });
    check("overwrites when told to", overwritten.isError !== true && structured<{ overwritten: boolean }>(overwritten).overwritten === true);

    const driveFile = await call("clipdrive_save_file", { job_id: IDS.driveDone });
    check("a Drive job has no local file", driveFile.isError === true && text(driveFile).includes("Google Drive"));
    check("and is answered with its link", text(driveFile).includes("https://drive.google.com/file/d/xyz/view"));

    const unfinished = await call("clipdrive_save_file", { job_id: IDS.running });
    check("an unfinished job says so and names the wait tool", unfinished.isError === true && text(unfinished).includes("clipdrive_wait_for_job"));

    const gone = await call("clipdrive_save_file", { job_id: IDS.fileMissing });
    check("a vanished file is reported as gone, not as a crash", gone.isError === true && text(gone).includes("clipdrive_convert"));

    /* -- control --------------------------------------------------- */
    section("clipdrive_control_job");
    const retry = await call("clipdrive_control_job", { job_id: IDS.driveFailed, action: "retry" });
    const retryOut = structured<{ changed: boolean; previousStatus: string; status: string; job: { queuePosition?: number } }>(retry);
    check("retrying a failed job re-queues it", retryOut.changed && retryOut.previousStatus === "failed" && retryOut.status === "queued");
    check("and the queue position comes back", retryOut.job.queuePosition === 1, retryOut.job);

    const retryAgain = await call("clipdrive_control_job", { job_id: IDS.driveFailed, action: "retry" });
    check("retrying a queued job is refused, not silently ignored", retryAgain.isError === true && text(retryAgain).includes("not 'failed'"));
    const pauseQueued = await call("clipdrive_control_job", { job_id: IDS.driveFailed, action: "pause" });
    check("pausing a queued job points at remove instead", pauseQueued.isError === true && text(pauseQueued).includes("clipdrive_remove_job"));
    const resumeDone = await call("clipdrive_control_job", { job_id: IDS.localDone, action: "resume" });
    check("resuming a finished job is refused", resumeDone.isError === true && text(resumeDone).includes("not 'paused'"));

    /* -- removal ---------------------------------------------------- */
    section("clipdrive_remove_job");
    const removeUnknown = await call("clipdrive_remove_job", { job_id: "00000000-0000-0000-0000-000000000000" });
    check("removing an unknown job is not an error", removeUnknown.isError !== true && structured<{ removed: boolean }>(removeUnknown).removed === false);

    const removeDrive = await call("clipdrive_remove_job", { job_id: IDS.driveDone });
    const removeDriveOut = structured<{ removed: boolean; driveFileKept: boolean; deletedLocalFile: boolean }>(removeDrive);
    check("removing a Drive job keeps the Drive file", removeDriveOut.removed && removeDriveOut.driveFileKept && !removeDriveOut.deletedLocalFile);

    const removeLocal = await call("clipdrive_remove_job", { job_id: IDS.localDone });
    check("removing a direct download deletes its file", structured<{ deletedLocalFile: boolean }>(removeLocal).deletedLocalFile === true);
    check(
      "and the file really is gone from disk",
      !existsSync(path.join(dataDir, "work", IDS.localDone)),
    );

    /* -- HTTP transport --------------------------------------------- */
    section("/api/mcp");
    const rpc = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "smoke-http", version: "1.0.0" },
        },
      }),
    });
    check("the in-app endpoint answers initialize", rpc.ok, rpc.status);
    const rpcBody = await rpc.text();
    check("naming the same server", rpcBody.includes("clipdrive-mcp-server"), rpcBody.slice(0, 200));

    const foreign = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
    });
    check("and rejects a foreign Origin", foreign.status >= 400, foreign.status);

    /* -- the app going away ------------------------------------------ */
    section("app not running");
    const offline = await connectServer("http://127.0.0.1:1");
    try {
      const result = await offline.client.callTool({ name: "clipdrive_status", arguments: {} });
      check("every tool explains that ClipDrive is not running", result.isError === true && text(result).includes("not reachable"));
      check("naming the command that starts it", text(result).includes("npm run dev"));
      check("and how to point at another port", text(result).includes("CLIPDRIVE_BASE_URL"));
    } finally {
      await offline.close();
    }

    /* -- bad configuration -------------------------------------------- */
    section("bad configuration");
    let rejected = false;
    try {
      const bad = await connectServer("not-a-url");
      await bad.close();
    } catch {
      rejected = true;
    }
    check("an invalid CLIPDRIVE_BASE_URL fails at startup, not on first use", rejected);
  } finally {
    await session?.close().catch(() => {});
    if (app) {
      app.kill("SIGTERM");
      await sleep(500);
      if (!app.killed) app.kill("SIGKILL");
    }
    await rm(dataDir, { recursive: true, force: true });
  }

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join("\n"));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
