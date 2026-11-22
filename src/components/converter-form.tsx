"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  InputGroup,
  Kbd,
  Spinner,
  ToggleButton,
  ToggleButtonGroup,
  toast,
} from "@heroui/react";

import { ChannelPicker } from "./channel-picker";
import { FolderPicker } from "./folder-picker";
import { Thumbnail } from "./thumbnail";
import { approxBytes, duration as formatDuration } from "@/lib/format";
import { normalizeChannelUrl } from "@/lib/channel-url";
import {
  DESTINATION_LABEL,
  QUALITIES,
  type Destination,
  type ChannelEntry,
  type DriveFolder,
  type Format,
  type Quality,
  type VideoMeta,
} from "@/lib/types";

const LAST_FOLDER_KEY = "clipdrive-last-folder";
const LAST_DESTINATION_KEY = "clipdrive-last-destination";
const LOCAL_DIR_KEY = "clipdrive-local-dir";
const SUBFOLDER_KEY = "clipdrive-channel-subfolder";

interface Props {
  onSubmitted: () => void;
  /** Drive is only offered as a destination once it is actually connected. */
  driveConnected: boolean;
}

/**
 * Screen 2a. The whole point is "paste to converting in under ten seconds", so
 * the link field carries focus on mount, a paste anywhere on the page lands in
 * it, metadata resolves on its own, and Enter submits.
 */
export function ConverterForm({ onSubmitted, driveConnected }: Props) {
  const [url, setUrl] = useState("");
  const [video, setVideo] = useState<VideoMeta | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [linkDetail, setLinkDetail] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);

  const [format, setFormat] = useState<Format>("mp4");
  const [quality, setQuality] = useState<Quality>("1080p");
  const [destination, setDestination] = useState<Destination>("drive");
  const [folder, setFolder] = useState<DriveFolder | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // A channel link swaps the single-video card for a list to pick from.
  const channelUrl = useMemo(() => normalizeChannelUrl(url), [url]);
  const [picked, setPicked] = useState<ChannelEntry[]>([]);
  const [channelName, setChannelName] = useState("");
  const onPicked = useCallback((entries: ChannelEntry[], channel: string) => {
    setPicked(entries);
    setChannelName(channel);
  }, []);

  const inputRef = useRef<HTMLInputElement>(null);
  const probeRef = useRef<AbortController | null>(null);

  /* Restore the last folder — the spec labels it "התיקייה האחרונה שנבחרה". */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LAST_FOLDER_KEY);
      if (stored) setFolder(JSON.parse(stored) as DriveFolder);
    } catch {
      /* nothing stored yet */
    }
  }, []);

  /* The destination is sticky too — most people use the same one every time. */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(LAST_DESTINATION_KEY);
      if (stored === "drive" || stored === "download" || stored === "folder") {
        setDestination(stored);
      }
    } catch {
      /* nothing stored yet */
    }
  }, []);

  // Without a connected Drive there is exactly one destination that works, so
  // the choice is made rather than offered.
  useEffect(() => {
    if (!driveConnected) setDestination((d) => (d === "drive" ? "download" : d));
  }, [driveConnected]);

  const chooseDestination = useCallback((next: Destination) => {
    setDestination(next);
    try {
      localStorage.setItem(LAST_DESTINATION_KEY, next);
    } catch {
      /* private mode — it just won't be remembered */
    }
  }, []);

  /* The computer folder: remembered, else the server's suggestion. */
  const [localDir, setLocalDir] = useState("");
  const [channelSubfolder, setChannelSubfolder] = useState(true);
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCAL_DIR_KEY);
      setChannelSubfolder(localStorage.getItem(SUBFOLDER_KEY) !== "0");
    } catch {
      /* private mode */
    }
    if (stored) {
      setLocalDir(stored);
      return;
    }
    void fetch("/api/local-folder")
      .then((r) => r.json() as Promise<{ path?: string }>)
      .then((d) => d.path && setLocalDir((cur) => cur || d.path!))
      .catch(() => {});
  }, []);
  const chooseLocalDir = useCallback((next: string) => {
    setLocalDir(next);
    try {
      localStorage.setItem(LOCAL_DIR_KEY, next);
    } catch {
      /* private mode */
    }
  }, []);
  const chooseSubfolder = useCallback((next: boolean) => {
    setChannelSubfolder(next);
    try {
      localStorage.setItem(SUBFOLDER_KEY, next ? "1" : "0");
    } catch {
      /* private mode */
    }
  }, []);

  const chooseFolder = useCallback((next: DriveFolder) => {
    setFolder(next);
    try {
      localStorage.setItem(LAST_FOLDER_KEY, JSON.stringify(next));
    } catch {
      /* private mode — the picker still works, it just won't be remembered */
    }
  }, []);

  /* Resolve metadata shortly after typing settles. */
  useEffect(() => {
    probeRef.current?.abort();
    if (!url.trim() || channelUrl) {
      setVideo(null);
      setLinkError(null);
      setLinkDetail(null);
      setProbing(false);
      return;
    }

    const controller = new AbortController();
    probeRef.current = controller;
    setProbing(true);

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/video?url=${encodeURIComponent(url.trim())}`, {
          signal: controller.signal,
        });
        const data = (await res.json()) as {
          video?: VideoMeta;
          error?: string;
          detail?: string;
        };
        if (controller.signal.aborted) return;
        if (!res.ok || !data.video) {
          setVideo(null);
          setLinkError(data.error ?? "לא הצלחנו לקרוא את הסרטון.");
          setLinkDetail(data.detail ?? null);
        } else {
          setVideo(data.video);
          setLinkError(null);
          setLinkDetail(null);
        }
      } catch {
        if (!controller.signal.aborted) {
          setVideo(null);
          setLinkError("לא הצלחנו לקרוא את הסרטון. בדקו את החיבור ונסו שוב.");
          setLinkDetail(null);
        }
      } finally {
        if (!controller.signal.aborted) setProbing(false);
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [url, channelUrl]);

  /* Ctrl+V anywhere on the screen — the tip the empty state promises. */
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const text = event.clipboardData?.getData("text")?.trim();
      if (!text) return;
      event.preventDefault();
      setUrl(text);
      inputRef.current?.focus();
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  const needsFolder =
    (destination === "drive" && !folder) || (destination === "folder" && !localDir.trim());
  const hasSomething = channelUrl ? picked.length > 0 : Boolean(video);
  const canSubmit = Boolean(hasSomething && !needsFolder && !submitting);

  const submitBatch = useCallback(async () => {
    if (picked.length === 0 || submitting) return;
    if (needsFolder) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel: channelName,
          items: picked.map(({ id, title, duration, thumbnail }) => ({
            id,
            title,
            duration,
            thumbnail,
          })),
          format,
          quality,
          destination,
          folderId: destination === "drive" ? folder?.id : null,
          folderName: destination === "drive" ? folder?.name : null,
          localDir: destination === "folder" ? localDir : null,
          channelSubfolder,
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        count?: number;
        localDir?: string | null;
      };
      if (!res.ok) {
        toast.danger(data.error ?? "לא הצלחנו להתחיל את ההמרה");
        return;
      }
      toast.success(`${data.count ?? picked.length} סרטונים נוספו לתור`, {
        description: data.localDir ? `יישמרו ב-${data.localDir}` : undefined,
      });
      setUrl("");
      setPicked([]);
      inputRef.current?.focus();
    } catch {
      toast.danger("לא הצלחנו להתחיל את ההמרה");
    } finally {
      setSubmitting(false);
    }
  }, [
    picked,
    channelName,
    folder,
    submitting,
    format,
    quality,
    destination,
    needsFolder,
    localDir,
    channelSubfolder,
  ]);

  const submit = useCallback(async () => {
    if (channelUrl) return submitBatch();
    if (!video || submitting) return;
    if (needsFolder) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          format,
          quality,
          destination,
          folderId: destination === "drive" ? folder?.id : null,
          folderName: destination === "drive" ? folder?.name : null,
          localDir: destination === "folder" ? localDir : null,
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.danger(data.error ?? "לא הצלחנו להתחיל את ההמרה");
        return;
      }
      setUrl("");
      setVideo(null);
      onSubmitted();
      inputRef.current?.focus();
    } catch {
      toast.danger("לא הצלחנו להתחיל את ההמרה");
    } finally {
      setSubmitting(false);
    }
  }, [
    channelUrl,
    submitBatch,
    video,
    folder,
    submitting,
    url,
    format,
    quality,
    destination,
    needsFolder,
    localDir,
    onSubmitted,
  ]);

  const estimate = channelUrl
    ? null
    : format === "mp3"
      ? video?.audioSizeEstimate ?? null
      : video?.sizeEstimates[quality] ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-1 flex-col gap-4">
      <LinkField
        ref={inputRef}
        value={url}
        onChange={setUrl}
        onSubmit={() => void submit()}
        onClear={() => setUrl("")}
        state={linkError ? "error" : video || channelUrl ? "valid" : "idle"}
        probing={probing}
      />

      {linkError ? (
        <div className="-mt-2 flex flex-col gap-1.5">
          <span className="text-xs text-danger-soft-foreground">{linkError}</span>

          {/* yt-dlp's own words. Hidden by default, but one click away — the
              friendly sentence is a guess, this line is the fact. */}
          {linkDetail ? (
            <details>
              <summary className="cursor-pointer list-none text-[11px] text-muted hover:text-foreground">
                הפרטים המלאים מ-yt-dlp
              </summary>
              <code className="ltr-run mt-1.5 block overflow-x-auto rounded-lg border border-border bg-surface-secondary px-3 py-2 text-[11px] text-muted">
                {linkDetail}
              </code>
            </details>
          ) : null}
        </div>
      ) : null}

      {channelUrl ? <ChannelPicker channelUrl={channelUrl} onChange={onPicked} /> : null}

      {video || channelUrl ? (
        <div className="flex flex-col gap-[18px] rounded-2xl border border-border bg-surface p-5">
          {video && !channelUrl ? (
            <div className="flex items-center gap-3.5">
              <Thumbnail
                src={video.thumbnail}
                alt={video.title}
                className="h-[54px] w-24 sm:h-[83px] sm:w-[148px]"
                durationSec={video.duration}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="text-base font-bold text-foreground">{video.title}</span>
                <span className="text-xs text-muted">
                  {[video.channel, formatDuration(video.duration), "זוהה אוטומטית עם ההדבקה"]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-[18px]">
            <div className="flex w-full flex-col gap-2 sm:w-auto">
              <label className="text-xs font-bold text-muted" id="format-label">
                פורמט
              </label>
              <ToggleButtonGroup
                aria-labelledby="format-label"
                selectionMode="single"
                disallowEmptySelection
                selectedKeys={[format]}
                onSelectionChange={(keys) => {
                  const next = [...keys][0];
                  if (next === "mp4" || next === "mp3") setFormat(next);
                }}
                fullWidth
                className="rounded-[10px] bg-surface-secondary p-[3px] sm:w-auto"
              >
                <ToggleButton
                  id="mp4"
                  className="flex-1 rounded-lg px-[22px] py-[7px] text-[13px] sm:flex-none"
                >
                  MP4
                </ToggleButton>
                <ToggleButton
                  id="mp3"
                  className="flex-1 rounded-lg px-[22px] py-[7px] text-[13px] sm:flex-none"
                >
                  MP3
                </ToggleButton>
              </ToggleButtonGroup>
            </div>

            {/* Quality is meaningless for audio, so it leaves rather than greys out. */}
            {format === "mp4" ? (
              <div className="flex w-full flex-col gap-2 sm:w-auto">
                <label className="text-xs font-bold text-muted" id="quality-label">
                  איכות · משפיעה על גודל הקובץ
                </label>
                <ToggleButtonGroup
                  aria-labelledby="quality-label"
                  selectionMode="single"
                  disallowEmptySelection
                  isDetached
                  selectedKeys={[quality]}
                  onSelectionChange={(keys) => {
                    const next = [...keys][0];
                    if (typeof next === "string") setQuality(next as Quality);
                  }}
                  className="flex flex-wrap gap-1.5 bg-transparent p-0"
                >
                  {QUALITIES.map((q) => {
                    const size = video?.sizeEstimates[q];
                    const label = q === "4k" ? "4K" : q;
                    return (
                      <ToggleButton
                        key={q}
                        id={q}
                        className="rounded-full border border-border px-3.5 py-[7px] text-xs data-[selected=true]:border-accent-soft-foreground/40 data-[selected=true]:bg-accent-soft data-[selected=true]:font-bold data-[selected=true]:text-accent-soft-foreground"
                      >
                        {q === quality && size ? `${label} · ${approxBytes(size)}` : label}
                      </ToggleButton>
                    );
                  })}
                </ToggleButtonGroup>
              </div>
            ) : null}
          </div>

          <div className="flex w-full flex-col gap-2">
            <label className="text-xs font-bold text-muted" id="destination-label">
              יעד
            </label>
            <ToggleButtonGroup
              aria-labelledby="destination-label"
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={[destination]}
              onSelectionChange={(keys) => {
                const next = [...keys][0];
                if (next === "drive" || next === "download" || next === "folder") {
                  chooseDestination(next);
                }
              }}
              fullWidth
              className="rounded-[10px] bg-surface-secondary p-[3px]"
            >
              <ToggleButton
                id="drive"
                isDisabled={!driveConnected}
                className="flex-1 rounded-lg px-[22px] py-[7px] text-[13px]"
              >
                {DESTINATION_LABEL.drive}
              </ToggleButton>
              <ToggleButton
                id="download"
                className="flex-1 rounded-lg px-[22px] py-[7px] text-[13px]"
              >
                {DESTINATION_LABEL.download}
              </ToggleButton>
              <ToggleButton
                id="folder"
                className="flex-1 rounded-lg px-[22px] py-[7px] text-[13px]"
              >
                {DESTINATION_LABEL.folder}
              </ToggleButton>
            </ToggleButtonGroup>
          </div>

          {destination === "drive" ? (
            <FolderRow folder={folder} onSelectFolder={chooseFolder} />
          ) : destination === "folder" ? (
            <LocalFolderRow
              value={localDir}
              onChange={chooseLocalDir}
              channelMode={Boolean(channelUrl)}
              channelName={channelName}
              subfolder={channelSubfolder}
              onSubfolderChange={chooseSubfolder}
            />
          ) : (
            <DownloadRow driveConnected={driveConnected} />
          )}

          <Button
            variant="primary"
            isDisabled={!canSubmit}
            onPress={() => void submit()}
            className="h-[54px] rounded-xl bg-accent text-base font-bold text-accent-foreground hover:bg-accent-hover"
          >
            {submitting ? (
              <Spinner size="sm" />
            ) : (
              <>
                {channelUrl
                  ? `${picked.length > 0 ? `המר ${picked.length} סרטונים` : "בחרו סרטונים"} ו${SUBMIT_VERB[destination]}`
                  : `המר ו${SUBMIT_VERB[destination]}`}
                <span className="text-xs font-normal opacity-80">
                  {" · "}
                  <span className="ltr-run">Enter ↵</span>
                </span>
              </>
            )}
          </Button>

          {estimate ? (
            <span className="-mt-2 text-center text-xs text-muted">
              גודל משוער: {approxBytes(estimate)}
            </span>
          ) : null}
        </div>
      ) : null}

      <span className="text-center text-xs text-muted">
        טיפ: <span className="ltr-run">Ctrl+V</span> בכל מקום במסך מדביק ומזהה את הלינק אוטומטית
      </span>

    </div>
  );
}

const SUBMIT_VERB: Record<Destination, string> = {
  drive: "שמור בדרייב",
  download: "הורד למחשב",
  folder: "שמור בתיקייה",
};

/**
 * "Save to a folder on this computer": the server runs here, so it writes the
 * file straight into this path. The path is checked (and created) on blur, so
 * a typo shows up now rather than after the download.
 */
function LocalFolderRow({
  value,
  onChange,
  channelMode,
  channelName,
  subfolder,
  onSubfolderChange,
}: {
  value: string;
  onChange: (value: string) => void;
  channelMode: boolean;
  channelName: string;
  subfolder: boolean;
  onSubfolderChange: (value: boolean) => void;
}) {
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const check = async () => {
    if (!value.trim()) return;
    try {
      const res = await fetch("/api/local-folder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: value }),
      });
      const data = (await res.json()) as { path?: string; error?: string };
      setStatus(
        res.ok && data.path
          ? { ok: true, text: `✓ ${data.path}` }
          : { ok: false, text: data.error ?? "התיקייה לא תקינה" },
      );
    } catch {
      setStatus({ ok: false, text: "לא הצלחנו לבדוק את התיקייה" });
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm text-accent-soft-foreground">
          ▤
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-bold text-foreground">תיקייה במחשב</span>
          <InputGroup className="h-9 rounded-lg border border-border bg-surface px-2.5">
            <InputGroup.Input
              value={value}
              onChange={(event) => {
                onChange(event.target.value);
                setStatus(null);
              }}
              onBlur={() => void check()}
              aria-label="נתיב התיקייה במחשב"
              placeholder="C:\\Users\\me\\Downloads\\ClipDrive"
              dir="ltr"
              className="flex-1 border-none bg-transparent text-[13px] text-foreground shadow-none focus:outline-none"
            />
          </InputGroup>
        </div>
      </div>

      {channelMode ? (
        <Checkbox isSelected={subfolder} onChange={onSubfolderChange}>
          <Checkbox.Content className="text-[12px] text-foreground">
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            תת-תיקייה בשם הערוץ{channelName ? ` ("${channelName}")` : ""}
          </Checkbox.Content>
        </Checkbox>
      ) : null}

      <span
        dir="auto"
        className={`text-start text-[11px] ${status && !status.ok ? "text-danger-soft-foreground" : "text-muted"}`}
      >
        {status?.text ?? "כל קובץ נשמר כאן לבד כשהוא מוכן · אם התיקייה לא קיימת היא תיווצר"}
      </span>
    </div>
  );
}

/**
 * The direct-download counterpart of FolderRow. There is nothing to choose, so
 * it spends its space explaining where the file waits and how long — plus the
 * way back to Drive when there is no connection yet.
 */
function DownloadRow({ driveConnected }: { driveConnected: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm text-accent-soft-foreground">
          ⤓
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold text-foreground">
            {DESTINATION_LABEL.download}
          </span>
          <span className="text-[11px] text-muted">
            כשהקובץ יהיה מוכן יופיע כפתור הורדה על כרטיס המשימה
          </span>
        </div>
      </div>

      {!driveConnected ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={() => {
            window.location.href = "/api/auth/google";
          }}
          className="shrink-0 text-[13px] font-bold text-accent-soft-foreground"
        >
          חיבור לדרייב
        </Button>
      ) : null}
    </div>
  );
}

function FolderRow({
  folder,
  onSelectFolder,
}: {
  folder: DriveFolder | null;
  onSelectFolder: (folder: DriveFolder) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background px-3.5 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg bg-accent-soft text-sm text-accent-soft-foreground">
          ▣
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-bold text-foreground">
            {folder?.name ?? "לא נבחרה תיקייה"}
          </span>
          <span className="text-[11px] text-muted">
            {folder ? "התיקייה האחרונה שנבחרה" : "בחרו לאן הקובץ ילך"}
          </span>
        </div>
      </div>

      <FolderPicker
        selectedId={folder?.id ?? null}
        onSelect={onSelectFolder}
        trigger={
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-[13px] font-bold text-accent-soft-foreground"
          >
            {folder ? "החלפה" : "בחירה"}
          </Button>
        }
      />
    </div>
  );
}

interface LinkFieldProps {
  ref: React.Ref<HTMLInputElement>;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClear: () => void;
  state: "idle" | "valid" | "error";
  probing: boolean;
}

function LinkField({
  ref,
  value,
  onChange,
  onSubmit,
  onClear,
  state,
  probing,
}: LinkFieldProps) {
  const ring =
    state === "error"
      ? "border-danger"
      : state === "valid"
        ? "border-accent-soft-foreground/40 shadow-[0_0_0_3px_var(--accent-soft)]"
        : "border-border";

  return (
    <InputGroup className={`h-[54px] rounded-[14px] border bg-surface px-3.5 ${ring}`}>
      <InputGroup.Input
        ref={ref}
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            onSubmit();
          }
        }}
        aria-label="לינק יוטיוב"
        placeholder="הדביקו לינק לסרטון או לערוץ — או Ctrl+V מכל מקום"
        dir="auto"
        className="ltr-run flex-1 border-none bg-transparent text-[15px] text-foreground shadow-none placeholder:text-right placeholder:text-muted focus:outline-none"
      />

      <InputGroup.Suffix className="gap-2">
        {probing ? <Spinner size="sm" aria-label="מזהה את הסרטון" /> : null}
        {value ? (
          <Button
            size="sm"
            variant="ghost"
            onPress={onClear}
            className="rounded-lg bg-surface-secondary px-3 text-xs font-bold text-muted"
          >
            ✕ ניקוי
          </Button>
        ) : (
          <Kbd className="ltr-run text-[11px]">Ctrl+V</Kbd>
        )}
      </InputGroup.Suffix>
    </InputGroup>
  );
}
