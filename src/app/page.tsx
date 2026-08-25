"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { toast } from "@heroui/react";

import { AppShell } from "@/components/app-shell";
import { ConverterForm } from "@/components/converter-form";
import { DriveEmptyState } from "@/components/drive-empty-state";
import { TaskPanel } from "@/components/task-panel";
import { useAuth } from "@/hooks/use-drive";
import { useJobs } from "@/hooks/use-jobs";
import { bytes } from "@/lib/format";
import { downloadUrl, type Job } from "@/lib/types";

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}

function Home() {
  const { auth } = useAuth();
  const { jobs, ready, act, remove } = useJobs();
  // Converting to a direct download needs no Drive at all, so the connect
  // screen is a recommendation rather than a wall.
  const [skipDrive, setSkipDrive] = useState(false);

  useAuthRedirectToast();
  useCompletionToasts(jobs);

  const onSubmitted = useCallback(() => {
    toast.success("המשימה נוספה לתור");
  }, []);

  return (
    <AppShell auth={auth}>
      {auth && !auth.connected && !skipDrive ? (
        <DriveEmptyState
          configured={auth.configured}
          redirectUri={auth.redirectUri}
          onSkip={() => setSkipDrive(true)}
        />
      ) : (
        <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-6 p-4 sm:p-7 lg:flex-row lg:gap-6">
          <ConverterForm
            onSubmitted={onSubmitted}
            driveConnected={Boolean(auth?.connected)}
          />
          <TaskPanel jobs={jobs} ready={ready} onAct={act} onRemove={remove} />
        </div>
      )}
    </AppShell>
  );
}

/** Reports the outcome of the OAuth round-trip once we land back here. */
function useAuthRedirectToast() {
  const params = useSearchParams();
  const shown = useRef(false);

  useEffect(() => {
    const status = params.get("auth");
    if (!status || shown.current) return;
    shown.current = true;

    if (status === "connected") toast.success("גוגל דרייב חובר");
    else if (status === "denied") toast.danger("החיבור בוטל");
    else toast.danger("החיבור נכשל. נסו שוב.");

    window.history.replaceState(null, "", window.location.pathname);
  }, [params]);
}

/**
 * The success toast from screen 2e. Fires once per job, the moment it flips to
 * done, and links straight to the file in Drive.
 */
function useCompletionToasts(jobs: Job[]) {
  const announced = useRef<Set<string>>(new Set());
  const primed = useRef(false);

  useEffect(() => {
    // Skip the first snapshot — history shouldn't replay as fresh toasts.
    if (!primed.current) {
      if (jobs.length > 0) {
        for (const job of jobs) announced.current.add(job.id);
        primed.current = true;
      }
      return;
    }

    for (const job of jobs) {
      if (job.status !== "done" || announced.current.has(job.id)) continue;
      announced.current.add(job.id);

      const local = job.destination === "download";

      toast.success(local ? "הקובץ מוכן להורדה" : "הקובץ מוכן בדרייב", {
        description: [job.title, job.format.toUpperCase(), bytes(job.bytes)]
          .filter(Boolean)
          .join(" · "),
        actionProps: local
          ? {
              children: "הורדה ⤓",
              // The response is an attachment, so this starts the download
              // instead of navigating away from the app.
              onPress: () => {
                window.location.href = downloadUrl(job.id);
              },
            }
          : job.driveLink
            ? {
                children: "פתיחה ↗",
                onPress: () => window.open(job.driveLink!, "_blank", "noopener,noreferrer"),
              }
            : undefined,
      });
    }

    for (const job of jobs) {
      if (job.status === "queued" || job.status === "running") {
        announced.current.delete(job.id);
      }
    }
  }, [jobs]);
}
