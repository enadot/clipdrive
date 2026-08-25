"use client";

import { ProgressBar } from "@heroui/react";

import { eta as formatEta, bytesPerSecond } from "@/lib/format";
import { stagesFor, STAGE_LABEL, type Job, type Stage } from "@/lib/types";

interface Props {
  job: Job;
  /** Compact drops the caption row — used by the narrow side panel. */
  size?: "sm" | "md";
  /** Hides the speed reading when there isn't room for it. */
  showSpeed?: boolean;
}

type SegmentState = "done" | "active" | "failed" | "pending";

function segmentState(job: Job, stage: Stage): SegmentState {
  const stages = stagesFor(job.destination);
  const index = stages.indexOf(stage);
  const currentIndex = stages.indexOf(job.stage);

  if (job.status === "failed") {
    if (job.failedStage === stage) return "failed";
    return index < stages.indexOf(job.failedStage ?? job.stage) ? "done" : "pending";
  }
  if (job.status === "done") return "done";
  if (index < currentIndex) return "done";
  if (index > currentIndex) return "pending";
  return "active";
}

/** 0–100 across the job's whole pipeline, for the accessible value. */
function overallPercent(job: Job): number {
  if (job.status === "done") return 100;
  const stages = stagesFor(job.destination);
  const completed = Math.max(0, stages.indexOf(job.stage));
  return Math.round(((completed + job.stagePercent / 100) / stages.length) * 100);
}

/**
 * The stage meter: download → convert → upload, filling right-to-left. A direct
 * download runs two of those stages, so it gets two segments — the road ahead
 * shown is the road the job actually travels.
 *
 * It is deliberately determinate at every moment — a percentage and a time
 * estimate rather than a spinner — and only the segment doing work carries the
 * shimmer, so "alive" never reads as "looping forever". A failure colours just
 * the stage that broke, which is what makes "retry continues from step 2"
 * legible at a glance.
 */
export function ProgressMeter({ job, size = "md", showSpeed = true }: Props) {
  const percent = overallPercent(job);
  const stageLabel = STAGE_LABEL[job.status === "failed" ? job.failedStage ?? job.stage : job.stage];

  const caption =
    job.status === "failed"
      ? `${stageLabel} · נכשל`
      : job.status === "paused"
        ? `${stageLabel} · מושהה`
        : job.status === "done"
          ? "הושלם"
          : `${stageLabel} · ${Math.round(job.stagePercent)}%`;

  const speed = showSpeed && job.speed ? bytesPerSecond(job.speed) : "";
  const remaining = job.status === "running" ? formatEta(job.eta) : "";

  return (
    <ProgressBar
      value={percent}
      minValue={0}
      maxValue={100}
      aria-label={`${job.title} — ${caption}`}
      className="flex flex-col gap-2"
    >
      {/* One accessible progress bar, one visible segment per stage. */}
      <div className="flex gap-1.5">
        {stagesFor(job.destination).map((stage) => (
          <Segment
            key={stage}
            state={segmentState(job, stage)}
            percent={job.stagePercent}
            paused={job.status === "paused"}
          />
        ))}
      </div>

      <div
        className={`flex items-center justify-between gap-2 ${
          size === "sm" ? "text-[11px]" : "text-xs"
        } text-muted`}
      >
        <span
          className={`font-bold ${
            job.status === "failed" ? "text-danger" : "text-accent-soft-foreground"
          }`}
        >
          {caption}
          {speed ? <span className="font-normal text-muted"> · {speed}</span> : null}
        </span>
        {remaining ? <span>{remaining}</span> : null}
      </div>
    </ProgressBar>
  );
}

function Segment({
  state,
  percent,
  paused,
}: {
  state: SegmentState;
  percent: number;
  paused: boolean;
}) {
  if (state === "done") {
    return <div className="h-[5px] flex-1 rounded-[3px] bg-accent" />;
  }
  if (state === "failed") {
    return <div className="h-[5px] flex-1 rounded-[3px] bg-danger" />;
  }
  if (state === "pending") {
    return <div className="h-[5px] flex-1 rounded-[3px] bg-surface-secondary" />;
  }

  return (
    <div className="flex h-[5px] flex-1 overflow-hidden rounded-[3px] bg-surface-secondary">
      <div
        className="relative overflow-hidden rounded-[3px] bg-accent transition-[width] duration-300 ease-out"
        style={{ width: `${Math.max(2, Math.min(100, percent))}%` }}
      >
        {!paused ? (
          <span className="absolute inset-0 animate-shimmer bg-gradient-to-l from-transparent via-white/50 to-transparent" />
        ) : null}
      </div>
    </div>
  );
}
