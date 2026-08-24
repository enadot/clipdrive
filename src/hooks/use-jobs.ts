"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { Job } from "@/lib/types";

interface UseJobs {
  jobs: Job[];
  /** False until the first snapshot arrives — drives the skeleton state. */
  ready: boolean;
  act: (id: string, action: "pause" | "resume" | "retry") => Promise<void>;
  remove: (id: string) => Promise<void>;
}

/**
 * Subscribes to the server's job stream. Progress is pushed as yt-dlp, ffmpeg
 * and Drive report it, so the meter moves at the speed of real work rather than
 * on a polling interval.
 */
export function useJobs(): UseJobs {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [ready, setReady] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource("/api/jobs/stream");
    sourceRef.current = source;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { jobs: Job[] };
        setJobs(payload.jobs);
        setReady(true);
      } catch {
        /* ignore a malformed frame and wait for the next one */
      }
    };

    // EventSource reconnects on its own; surfacing the list we already have is
    // better than blanking the panel on a transient drop.
    source.onerror = () => setReady(true);

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, []);

  const act = useCallback(
    async (id: string, action: "pause" | "resume" | "retry") => {
      await fetch(`/api/jobs/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
    },
    [],
  );

  const remove = useCallback(async (id: string) => {
    // Drop it locally right away — the stream will confirm a moment later.
    setJobs((current) => current.filter((job) => job.id !== id));
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
  }, []);

  return { jobs, ready, act, remove };
}
