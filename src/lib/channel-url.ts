/**
 * Channel links, recognised on both sides of the wire. Kept free of Node
 * imports so the form can tell a channel from a single video as it is typed,
 * without a round-trip.
 */

const HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);

/** Tab suffixes a pasted channel link may carry; all of them mean "this channel". */
const TAB_SEGMENTS = new Set([
  "videos",
  "shorts",
  "streams",
  "featured",
  "playlists",
  "community",
  "about",
  "live",
]);

/**
 * Accepts the shapes a channel link comes in — `@handle`, `/channel/UC…`,
 * `/c/name`, `/user/name`, each optionally followed by a tab like `/shorts` —
 * and returns the channel's base URL, or null when this isn't a channel link.
 */
export function normalizeChannelUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // A bare "@handle" is how people often copy a channel name.
  if (/^@[\w.-]{2,}$/.test(trimmed)) {
    return `https://www.youtube.com/${trimmed}`;
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
  if (!HOSTS.has(url.hostname.toLowerCase())) return null;

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;

  let base: string[];
  let rest: string[];
  if (segments[0].startsWith("@") && segments[0].length > 1) {
    base = [segments[0]];
    rest = segments.slice(1);
  } else if (["channel", "c", "user"].includes(segments[0]) && segments[1]) {
    base = segments.slice(0, 2);
    rest = segments.slice(2);
  } else {
    return null;
  }

  if (rest.length > 0 && !TAB_SEGMENTS.has(rest[0].toLowerCase())) return null;

  // Decoded, so a Hebrew handle reads the same however it was pasted, and the
  // result survives being normalised a second time on the server.
  let decoded: string[];
  try {
    decoded = base.map(decodeURIComponent);
  } catch {
    decoded = base;
  }
  return `https://www.youtube.com/${decoded.join("/")}`;
}
