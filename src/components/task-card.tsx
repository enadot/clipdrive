"use client";

import { Button, Card } from "@heroui/react";

import { ProgressMeter } from "./progress-meter";
import { Thumbnail } from "./thumbnail";
import { bytes, duration as formatDuration, took } from "@/lib/format";
import { STAGES, type Job, type Stage } from "@/lib/types";

interface Props {
  job: Job;
  onAct: (id: string, action: "pause" | "resume" | "retry") => void;
  onRemove: (id: string) => void;
}

const RETRY_LABEL: Record<Stage, string> = {
  download: "ניסיון חוזר",
  convert: "ניסיון חוזר משלב ההמרה",
  upload: "ניסיון חוזר משלב ההעלאה",
};

/** "ההורדה נשמרה — ניסיון חוזר ימשיך משלב 2" and friends. */
function resumeHint(failedStage: Stage | null): string {
  if (failedStage === "convert") return "ההורדה נשמרה — ניסיון חוזר ימשיך משלב 2";
  if (failedStage === "upload") return "הקובץ מוכן — ניסיון חוזר ימשיך משלב 3";
  return "";
}

function specLine(job: Job): string {
  const parts = [
    formatDuration(job.duration),
    job.format.toUpperCase(),
    job.format === "mp4" ? job.quality : "320kbps",
    bytes(job.bytes),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function TaskCard({ job, onAct, onRemove }: Props) {
  if (job.status === "done") return <DoneCard job={job} onRemove={onRemove} />;
  if (job.status === "failed") return <FailedCard job={job} onAct={onAct} onRemove={onRemove} />;
  if (job.status === "queued") return <QueuedCard job={job} onRemove={onRemove} />;
  return <RunningCard job={job} onAct={onAct} onRemove={onRemove} />;
}

function RunningCard({ job, onAct, onRemove }: Props) {
  const paused = job.status === "paused";

  return (
    <Card className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-3.5 shadow-none">
      <div className="flex items-center gap-2.5">
        <Thumbnail src={job.thumbnail} alt={job.title} className="h-[45px] w-20" />

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-sm font-bold text-foreground">{job.title}</span>
          <span className="truncate text-[11px] text-muted">{specLine(job)}</span>
        </div>

        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="outline"
            isIconOnly
            aria-label={paused ? "המשך" : "השהיה"}
            onPress={() => onAct(job.id, paused ? "resume" : "pause")}
            className="h-7 w-7 min-w-7 rounded-lg"
          >
            {paused ? "▶" : "⏸"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            isIconOnly
            aria-label="ביטול"
            onPress={() => onRemove(job.id)}
            className="h-7 w-7 min-w-7 rounded-lg"
          >
            ✕
          </Button>
        </div>
      </div>

      <ProgressMeter job={job} />

      {job.stage === "upload" ? (
        <span className="-mt-1 text-[11px] text-muted">אל &quot;{job.folderName}&quot;</span>
      ) : null}
    </Card>
  );
}

function DoneCard({ job, onRemove }: { job: Job; onRemove: (id: string) => void }) {
  return (
    <Card className="flex flex-row items-center gap-2.5 rounded-2xl border border-accent-soft-foreground/40 bg-surface p-3.5 shadow-none">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm text-accent-soft-foreground">
        ✓
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-sm font-bold text-foreground">{job.title}</span>
        <span className="truncate text-[11px] text-muted">
          {[job.format.toUpperCase(), bytes(job.bytes), took(
            job.finishedAt && job.createdAt ? job.finishedAt - job.createdAt : null,
          )]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>

      {job.driveLink ? (
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 rounded-lg border-accent-soft-foreground/40 text-xs font-bold text-accent-soft-foreground"
          onPress={() => window.open(job.driveLink!, "_blank", "noopener,noreferrer")}
        >
          פתיחה בדרייב ↗
        </Button>
      ) : null}

      <Button
        size="sm"
        variant="ghost"
        isIconOnly
        aria-label="הסרה מהרשימה"
        onPress={() => onRemove(job.id)}
        className="h-7 w-7 min-w-7 shrink-0"
      >
        ✕
      </Button>
    </Card>
  );
}

function FailedCard({ job, onAct, onRemove }: Props) {
  const hint = resumeHint(job.failedStage);

  return (
    <Card className="flex flex-col gap-2.5 rounded-2xl border border-danger bg-surface p-3.5 shadow-none">
      <div className="flex items-center gap-2.5">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-danger-soft text-sm font-bold text-danger-soft-foreground">
          !
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-px">
          <span className="truncate text-sm font-bold text-foreground">{job.title}</span>
          <span className="text-[11px] text-danger-soft-foreground">
            {job.error ?? "המשימה נכשלה"}
            {hint ? ` · ${hint}` : ""}
          </span>
        </div>
      </div>

      <div className="flex gap-1.5">
        {STAGES.map((stage) => {
          const index = STAGES.indexOf(stage);
          const failedIndex = STAGES.indexOf(job.failedStage ?? "download");
          const tone =
            index < failedIndex
              ? "bg-accent"
              : index === failedIndex
                ? "bg-danger"
                : "bg-surface-secondary";
          return <div key={stage} className={`h-[5px] flex-1 rounded-[3px] ${tone}`} />;
        })}
      </div>

      <div className="flex gap-2">
        <Button
          size="sm"
          variant="primary"
          className="flex-1 rounded-lg bg-accent text-xs font-bold text-accent-foreground"
          onPress={() => onAct(job.id, "retry")}
        >
          {RETRY_LABEL[job.failedStage ?? "download"]}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="rounded-lg text-xs"
          onPress={() => onRemove(job.id)}
        >
          הסרה
        </Button>
      </div>
    </Card>
  );
}

function QueuedCard({ job, onRemove }: { job: Job; onRemove: (id: string) => void }) {
  return (
    <Card className="flex flex-row items-center gap-2.5 rounded-2xl border border-border bg-surface p-3.5 opacity-75 shadow-none">
      <span className="flex h-7 w-7 shrink-0 animate-soft-pulse items-center justify-center rounded-full bg-surface-secondary text-[13px] text-muted">
        …
      </span>

      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-sm font-bold text-foreground">{job.title}</span>
        <span className="truncate text-[11px] text-muted">
          ממתין לסיום המשימה הפעילה
          {job.queuePosition ? ` · מקום ${job.queuePosition} בתור` : ""}
        </span>
      </div>

      <Button
        size="sm"
        variant="ghost"
        isIconOnly
        aria-label="הסרה מהתור"
        onPress={() => onRemove(job.id)}
        className="h-7 w-7 min-w-7 shrink-0"
      >
        ✕
      </Button>
    </Card>
  );
}
