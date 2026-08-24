"use client";

import Link from "next/link";
import { Skeleton } from "@heroui/react";

import { TaskCard } from "./task-card";
import { TaskHistoryList } from "./task-history-list";
import { dayBucket, DAY_BUCKET_LABEL } from "@/lib/format";
import type { Job } from "@/lib/types";

interface Props {
  jobs: Job[];
  ready: boolean;
  onAct: (id: string, action: "pause" | "resume" | "retry") => void;
  onRemove: (id: string) => void;
}

const ACTIVE = new Set(["running", "queued", "paused"]);

/** The side panel from screen 2a: what's live now, then a short history. */
export function TaskPanel({ jobs, ready, onAct, onRemove }: Props) {
  const active = jobs.filter((job) => ACTIVE.has(job.status));
  // The panel is a short digest of today; older runs live on /jobs.
  const finished = jobs
    .filter(
      (job) =>
        !ACTIVE.has(job.status) &&
        dayBucket(job.finishedAt ?? job.createdAt) === "today",
    )
    .slice(0, 6);

  if (!ready) {
    return (
      <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[330px]">
        <Skeleton className="h-5 w-24 rounded-md" />
        <Skeleton className="h-[104px] w-full rounded-2xl" />
        <Skeleton className="h-[70px] w-full rounded-2xl" />
      </aside>
    );
  }

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[330px]">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-bold text-foreground">משימות</span>
        <span className="text-xs text-muted">
          {active.length === 0
            ? "אין פעילות"
            : active.length === 1
              ? "1 פעילה"
              : `${active.length} פעילות`}
        </span>
      </div>

      {active.length === 0 && finished.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-xs text-muted">
          עוד לא המרתם כלום. הדביקו לינק והמשימה הראשונה תופיע כאן.
        </div>
      ) : null}

      {active.map((job) => (
        <TaskCard key={job.id} job={job} onAct={onAct} onRemove={onRemove} />
      ))}

      {finished.length > 0 ? (
        <>
          <div className="mt-1 flex items-center justify-between">
            <span className="text-[13px] font-bold text-foreground">
              {DAY_BUCKET_LABEL.today}
            </span>
            <Link href="/jobs" className="text-[11px] font-bold text-accent-soft-foreground">
              הכל
            </Link>
          </div>

          <TaskHistoryList jobs={finished} onAct={onAct} />
        </>
      ) : null}
    </aside>
  );
}
