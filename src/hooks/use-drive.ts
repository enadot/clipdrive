"use client";

import { useCallback, useEffect, useState } from "react";

import type { DriveFolder } from "@/lib/types";

export interface AuthInfo {
  connected: boolean;
  email: string | null;
  /** False when GOOGLE_CLIENT_ID / SECRET are missing from the environment. */
  configured: boolean;
  /** Exactly what this app sends to Google — paste it into the console. */
  redirectUri?: string;
}

export function useAuth() {
  const [auth, setAuth] = useState<AuthInfo | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      setAuth((await res.json()) as AuthInfo);
    } catch {
      setAuth({ connected: false, email: null, configured: true });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const disconnect = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" });
    await refresh();
  }, [refresh]);

  return { auth, refresh, disconnect };
}

export function useFolders(enabled: boolean) {
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/drive/folders", { cache: "no-store" });
      const data = (await res.json()) as { folders?: DriveFolder[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "טעינת התיקיות נכשלה");
      setFolders(data.folders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "טעינת התיקיות נכשלה");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (name: string): Promise<DriveFolder> => {
      const res = await fetch("/api/drive/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = (await res.json()) as { folder?: DriveFolder; error?: string };
      if (!res.ok || !data.folder) throw new Error(data.error ?? "יצירת התיקייה נכשלה");
      setFolders((current) => [data.folder!, ...current]);
      return data.folder;
    },
    [],
  );

  return { folders, loading, error, refresh, create };
}
