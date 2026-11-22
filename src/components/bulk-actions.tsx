"use client";

import { useState } from "react";
import { Button, toast } from "@heroui/react";

import type { Job } from "@/lib/types";

type Action = "clear-queue" | "cancel-all";

/**
 * "Clear the queue" and "cancel everything", for when a channel's worth of
 * jobs turns out to be the wrong ones. Each asks once, inline — a stray click
 * shouldn't throw away a 200-video queue.
 */
export function BulkActions({ jobs }: { jobs: Job[] }) {
  const [confirming, setConfirming] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);

  const waiting = jobs.filter((j) => j.status === "queued" || j.status === "paused").length;
  const running = jobs.filter((j) => j.status === "running").length;
  if (waiting === 0 && running === 0) return null;

  const count = confirming === "cancel-all" ? waiting + running : waiting;

  const run = async (action: Action) => {
    setBusy(true);
    try {
      const res = await fetch("/api/jobs/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { count?: number; error?: string };
      if (!res.ok) toast.danger(data.error ?? "הפעולה נכשלה");
      else toast.success(`${data.count ?? 0} משימות בוטלו`);
    } catch {
      toast.danger("הפעולה נכשלה");
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  };

  if (confirming) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-danger bg-danger-soft/40 px-3 py-2">
        <span className="text-xs text-foreground">
          {confirming === "cancel-all"
            ? `לבטל את כל ${count} המשימות, כולל זו שרצה?`
            : `להוציא מהתור ${count} משימות ממתינות?`}
        </span>
        <div className="flex shrink-0 gap-1.5">
          <Button
            size="sm"
            variant="danger"
            isPending={busy}
            onPress={() => void run(confirming)}
            className="h-7 rounded-lg px-3 text-xs font-bold"
          >
            כן
          </Button>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={busy}
            onPress={() => setConfirming(null)}
            className="h-7 rounded-lg px-2 text-xs"
          >
            לא
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      {waiting > 0 ? (
        <Button
          size="sm"
          variant="secondary"
          onPress={() => setConfirming("clear-queue")}
          className="flex-1 rounded-lg text-xs font-bold"
        >
          ניקוי התור ({waiting})
        </Button>
      ) : null}
      <Button
        size="sm"
        variant="secondary"
        onPress={() => setConfirming("cancel-all")}
        className="flex-1 rounded-lg text-xs font-bold text-danger-soft-foreground"
      >
        ביטול הכל ({waiting + running})
      </Button>
    </div>
  );
}
