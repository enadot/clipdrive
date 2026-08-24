"use client";

import { useState } from "react";

import { duration as formatDuration } from "@/lib/format";

interface Props {
  src: string | null;
  alt: string;
  className?: string;
  /** Rendered as a badge in the corner, like YouTube's own runtime chip. */
  durationSec?: number | null;
}

/**
 * Falls back to the spec's diagonal-stripe placeholder rather than a broken
 * image box, so a missing thumbnail still holds its place in the layout.
 */
export function Thumbnail({ src, alt, className = "", durationSec }: Props) {
  const [failed, setFailed] = useState(false);
  const showImage = src && !failed;

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-lg bg-surface-secondary ${className}`}
      style={
        showImage
          ? undefined
          : {
              backgroundImage:
                "repeating-linear-gradient(45deg, var(--surface-secondary), var(--surface-secondary) 6px, var(--border) 6px, var(--border) 12px)",
            }
      }
    >
      {showImage ? (
        // Remote YouTube thumbnails, already served at the size we draw them;
        // routing them through next/image would add a round-trip for nothing.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : null}

      {durationSec ? (
        <span className="ltr-run absolute bottom-1.5 left-1.5 rounded bg-black/75 px-1.5 py-px text-[10px] text-white">
          {formatDuration(durationSec)}
        </span>
      ) : null}
    </div>
  );
}
