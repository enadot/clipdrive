"use client";

import { Button } from "@heroui/react";

import { downloadUrl, type Job } from "@/lib/types";

interface Props {
  jobs: Job[];
  onAct: (id: string, action: "pause" | "resume" | "retry") => void;
}

/**
 * The compact history rows from screen 2a's side panel: one grouped card, a
 * status glyph, the title, and the single action that matters for that outcome.
 * The full card anatomy (2b) is used where there is room for it — the active
 * jobs above and the /jobs list.
 */
export function TaskHistoryList({ jobs, onAct }: Props) {
  if (jobs.length === 0) return null;

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
      {jobs.map((job, index) => (
        <div
          key={job.id}
          className={`flex items-center gap-2.5 px-3.5 py-2.5 ${
            index < jobs.length - 1 ? "border-b border-border" : ""
          }`}
        >
          {job.status === "done" ? (
            <span className="text-[13px] text-accent-soft-foreground">✓</span>
          ) : (
            <span className="text-[13px] font-bold text-danger-soft-foreground">!</span>
          )}

          <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
            {job.title}
          </span>

          {job.status === "done" && job.destination === "download" ? (
            <a
              href={downloadUrl(job.id)}
              download
              className="shrink-0 text-[11px] font-bold text-accent-soft-foreground hover:underline"
            >
              הורדה ⤓
            </a>
          ) : job.status === "done" && job.driveLink ? (
            <a
              href={job.driveLink}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-[11px] font-bold text-accent-soft-foreground hover:underline"
            >
              בדרייב ↗
            </a>
          ) : job.status === "failed" ? (
            <Button
              variant="ghost"
              size="sm"
              onPress={() => onAct(job.id, "retry")}
              className="h-auto shrink-0 px-0 text-[11px] font-bold text-accent-soft-foreground"
            >
              ניסיון חוזר
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}
