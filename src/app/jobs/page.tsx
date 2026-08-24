"use client";

import { useMemo, useState } from "react";
import { EmptyState, Skeleton, ToggleButton, ToggleButtonGroup } from "@heroui/react";
import Link from "next/link";

import { AppShell } from "@/components/app-shell";
import { TaskCard } from "@/components/task-card";
import { useAuth } from "@/hooks/use-drive";
import { useJobs } from "@/hooks/use-jobs";
import { dayBucket, DAY_BUCKET_LABEL } from "@/lib/format";
import type { Job } from "@/lib/types";

type Filter = "all" | "active" | "done" | "failed";

const FILTER_LABEL: Record<Filter, string> = {
  all: "הכל",
  active: "פעילות",
  done: "הושלמו",
  failed: "נכשלו",
};

const ACTIVE = new Set(["running", "queued", "paused"]);

/**
 * Screen 1e in the v2 language: everything running side by side, then history
 * grouped by day, with the empty and failure states the brief calls for.
 */
export default function JobsPage() {
  const { auth } = useAuth();
  const { jobs, ready, act, remove } = useJobs();
  const [filter, setFilter] = useState<Filter>("all");

  const filtered = useMemo(() => {
    if (filter === "active") return jobs.filter((j) => ACTIVE.has(j.status));
    if (filter === "done") return jobs.filter((j) => j.status === "done");
    if (filter === "failed") return jobs.filter((j) => j.status === "failed");
    return jobs;
  }, [jobs, filter]);

  const active = filtered.filter((job) => ACTIVE.has(job.status));
  const history = filtered.filter((job) => !ACTIVE.has(job.status));

  const grouped = useMemo(() => {
    const buckets = new Map<ReturnType<typeof dayBucket>, Job[]>();
    for (const job of history) {
      const key = dayBucket(job.finishedAt ?? job.createdAt);
      buckets.set(key, [...(buckets.get(key) ?? []), job]);
    }
    return [...buckets.entries()];
  }, [history]);

  return (
    <AppShell auth={auth}>
      <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col gap-5 p-4 sm:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-bold text-foreground">משימות</h1>

          <ToggleButtonGroup
            aria-label="סינון משימות"
            selectionMode="single"
            disallowEmptySelection
            isDetached
            selectedKeys={[filter]}
            onSelectionChange={(keys) => {
              const next = [...keys][0];
              if (typeof next === "string") setFilter(next as Filter);
            }}
            className="flex gap-1.5 bg-transparent p-0"
          >
            {(Object.keys(FILTER_LABEL) as Filter[]).map((key) => (
              <ToggleButton
                key={key}
                id={key}
                size="sm"
                className="rounded-full border border-border px-3.5 py-1.5 text-xs data-[selected=true]:border-accent-soft-foreground/40 data-[selected=true]:bg-accent-soft data-[selected=true]:font-bold data-[selected=true]:text-accent-soft-foreground"
              >
                {FILTER_LABEL[key]}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </div>

        {!ready ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-[104px] w-full rounded-2xl" />
            <Skeleton className="h-[70px] w-full rounded-2xl" />
            <Skeleton className="h-[70px] w-full rounded-2xl" />
          </div>
        ) : null}

        {ready && filtered.length === 0 ? (
          <EmptyState className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border px-8 py-16 text-center">
            <span className="text-2xl text-muted">▤</span>
            <h2 className="text-base font-bold text-foreground">
              {filter === "all" ? "אין עדיין משימות" : `אין משימות בקטגוריה "${FILTER_LABEL[filter]}"`}
            </h2>
            <p className="text-[13px] text-muted">
              כל המרה שתתחילו תופיע כאן, עם ההתקדמות החיה וההיסטוריה.
            </p>
            {/* A link styled as a button — nesting an anchor inside a
                Button would be invalid HTML and break press handling. */}
            <Link
              href="/"
              className="mt-1 rounded-xl bg-accent px-5 py-2.5 text-sm font-bold text-accent-foreground hover:bg-accent-hover"
            >
              להמרה חדשה
            </Link>
          </EmptyState>
        ) : null}

        {active.length > 0 ? (
          <section className="flex flex-col gap-3">
            <span className="text-[13px] font-bold text-foreground">
              פעילות ({active.length})
            </span>
            {active.map((job) => (
              <TaskCard key={job.id} job={job} onAct={act} onRemove={remove} />
            ))}
          </section>
        ) : null}

        {grouped.map(([bucket, items]) => (
          <section key={bucket} className="flex flex-col gap-3">
            <span className="text-[13px] font-bold text-foreground">
              {DAY_BUCKET_LABEL[bucket]}
            </span>
            {items.map((job) => (
              <TaskCard key={job.id} job={job} onAct={act} onRemove={remove} />
            ))}
          </section>
        ))}
      </div>
    </AppShell>
  );
}
