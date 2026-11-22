"use client";

import Link from "next/link";
import { Skeleton } from "@heroui/react";

import { BulkActions } from "./bulk-actions";
import { TaskCard } from "./task-card";
import { TaskHistoryList } from "./task-history-list";
import { dayBucket, DAY_BUCKET_LABEL } from "@/lib/format";
import { zipUrl, type Job } from "@/lib/types";

interface Props {
  jobs: Job[];
  ready: boolean;
  onAct: (id: string, action: "pause" | "resume" | "retry") => void;
  onRemove: (id: string) => void;
}

const ACTIVE = new Set(["running", "queued", "paused"]);
/** Queued cards drawn in the panel; a channel batch can queue hundreds. */
const QUEUED_SHOWN = 5;

/** The side panel from screen 2a: what's live now, then a short history. */
export function TaskPanel({ jobs, ready, onAct, onRemove }: Props) {
  const active = jobs.filter((job) => ACTIVE.has(job.status));
  // Running and paused always show; of the queued, only the next few — in the
  // order they'll run — with the rest summed up below.
  const queued = active
    .filter((job) => job.status === "queued")
    .sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0));
  const shownActive = [
    ...active.filter((job) => job.status !== "queued"),
    ...queued.slice(0, QUEUED_SHOWN),
  ];
  const hiddenQueued = queued.length - Math.min(queued.length, QUEUED_SHOWN);
  // The panel is a short digest of today; older runs live on /jobs.
  const finished = jobs
    .filter(
      (job) =>
        !ACTIVE.has(job.status) &&
        dayBucket(job.finishedAt ?? job.createdAt) === "today",
    )
    .slice(0, 6);

  // Everything waiting to be downloaded — not just today's few on screen.
  const waiting = jobs.filter((job) => job.status === "done" && job.destination === "download");

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

      {waiting.length >= 2 ? (
        <a
          href={zipUrl()}
          download
          className="flex items-center justify-between rounded-xl border border-accent-soft-foreground/40 bg-accent-soft px-3.5 py-2.5 text-xs font-bold text-accent-soft-foreground hover:brightness-95"
        >
          <span>הורדת כל הקבצים כ-ZIP</span>
          <span className="ltr-run opacity-80">{waiting.length} ⤓</span>
        </a>
      ) : null}

      <BulkActions jobs={jobs} />

      {shownActive.map((job) => (
        <TaskCard key={job.id} job={job} onAct={onAct} onRemove={onRemove} />
      ))}

      {hiddenQueued > 0 ? (
        <Link
          href="/jobs"
          className="rounded-xl border border-dashed border-border px-3.5 py-2.5 text-center text-xs text-muted hover:text-foreground"
        >
          ועוד {hiddenQueued} בתור · הצגת הכל
        </Link>
      ) : null}

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
