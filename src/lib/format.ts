/**
 * Formatting helpers for the Hebrew UI.
 *
 * Latin-script runs (sizes, rates, shortcuts) are prefixed with a RIGHT-TO-LEFT
 * MARK so the bidi algorithm keeps them anchored on the correct side of the
 * surrounding Hebrew, instead of letting a trailing "MB" drift. The design
 * files do the same thing by hand; here it lives in one place.
 */
const RLM = "‏";

export function rtlNum(text: string): string {
  return `${RLM}${text}`;
}

/** 1234567 → "‏1.2MB". Uses MB/GB the way a download UI does, not MiB. */
export function bytes(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (value < 1000) return rtlNum(`${Math.round(value)}B`);
  const units = ["KB", "MB", "GB", "TB"];
  let n = value / 1000;
  let unit = 0;
  while (n >= 1000 && unit < units.length - 1) {
    n /= 1000;
    unit += 1;
  }
  const rounded = n >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return rtlNum(`${rounded}${units[unit]}`);
}

/** An approximate size, as the quality chips show it: "~890MB". */
export function approxBytes(value: number | null | undefined): string {
  const formatted = bytes(value);
  return formatted ? rtlNum(`~${formatted.replace(RLM, "")}`) : "";
}

export function bytesPerSecond(value: number | null | undefined): string {
  const formatted = bytes(value);
  return formatted ? `${formatted}/s` : "";
}

/** 728 → "12:08"; 3661 → "1:01:01". */
export function duration(totalSeconds: number | null | undefined): string {
  if (!totalSeconds || !Number.isFinite(totalSeconds)) return "";
  const s = Math.round(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = hours ? String(minutes).padStart(2, "0") : String(minutes);
  return hours
    ? `${hours}:${mm}:${String(seconds).padStart(2, "0")}`
    : `${mm}:${String(seconds).padStart(2, "0")}`;
}

/** "נותרו ~20 שנ׳" / "נותרו ~3 דק׳" — the right-hand label under the meter. */
export function eta(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return "";
  }
  if (seconds < 60) return `נותרו ${rtlNum(`~${Math.max(1, Math.round(seconds))}`)} שנ׳`;
  if (seconds < 3600) return `נותרו ${rtlNum(`~${Math.round(seconds / 60)}`)} דק׳`;
  return `נותרו ${rtlNum(`~${Math.round(seconds / 3600)}`)} שע׳`;
}

/** How long a finished job took: "הושלם ב-41 שנ׳". */
export function took(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return "";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `הושלם ב-${rtlNum(String(seconds))} שנ׳`;
  return `הושלם ב-${rtlNum(String(Math.round(seconds / 60)))} דק׳`;
}

/** Folder recency, as the picker labels it. */
export function relativeTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "";
  const diff = Date.now() - timestamp;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 2) return "עכשיו";
  if (minutes < 60) return `לפני ${rtlNum(String(minutes))} דק׳`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "לפני שעה" : `לפני ${rtlNum(String(hours))} שעות`;
  const days = Math.round(hours / 24);
  if (days === 1) return "אתמול";
  if (days < 7) return `לפני ${rtlNum(String(days))} ימים`;
  return new Date(timestamp).toLocaleDateString("he-IL");
}

/** Section headers in the task list. */
export function dayBucket(timestamp: number): "today" | "yesterday" | "earlier" {
  const then = new Date(timestamp);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (then.getTime() >= startOfToday) return "today";
  if (then.getTime() >= startOfToday - 86_400_000) return "yesterday";
  return "earlier";
}

export const DAY_BUCKET_LABEL: Record<ReturnType<typeof dayBucket>, string> = {
  today: "היום",
  yesterday: "אתמול",
  earlier: "קודם",
};

export function fileCount(count: number | null): string {
  if (count === null) return "";
  if (count === 0) return "ריקה";
  if (count === 1) return "קובץ אחד";
  return `${rtlNum(String(count))} קבצים`;
}
