"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DateValue } from "@internationalized/date";
import {
  Button,
  Checkbox,
  DateField,
  Label,
  Spinner,
  ToggleButton,
  ToggleButtonGroup,
  toast,
} from "@heroui/react";

import { Thumbnail } from "./thumbnail";
import {
  CHANNEL_TAB_LABEL,
  type ChannelEntry,
  type ChannelListing,
  type ChannelTab,
} from "@/lib/types";

const TABS: ChannelTab[] = ["videos", "shorts"];
/** Rows drawn at a time — a big channel has thousands. */
const PAGE = 150;

interface TabState {
  listing: ChannelListing | null;
  loading: boolean;
  error: string | null;
  detail: string | null;
}

const EMPTY_TAB: TabState = { listing: null, loading: true, error: null, detail: null };

interface Props {
  /** The channel's base URL, as normalizeChannelUrl returns it. */
  channelUrl: string;
  /** Reports the picked uploads, videos first, each list in channel order. */
  onChange: (picked: ChannelEntry[], channel: string) => void;
}

/**
 * The channel counterpart of the single-video preview card: both of the
 * channel's lists, a checkbox per upload, and the three ways of picking in
 * bulk — everything, every Short, or a date range.
 */
export function ChannelPicker({ channelUrl, onChange }: Props) {
  const [tabs, setTabs] = useState<Record<ChannelTab, TabState>>({
    videos: EMPTY_TAB,
    shorts: EMPTY_TAB,
  });
  const [active, setActive] = useState<ChannelTab>("videos");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);

  const [from, setFrom] = useState<DateValue | null>(null);
  const [to, setTo] = useState<DateValue | null>(null);
  const [rangeBusy, setRangeBusy] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);

  const loadTab = useCallback(
    async (tab: ChannelTab, signal: AbortSignal) => {
      let next: TabState;
      try {
        const res = await fetch(
          `/api/channel?url=${encodeURIComponent(channelUrl)}&tab=${tab}`,
          { signal },
        );
        const data = (await res.json()) as {
          listing?: ChannelListing;
          error?: string;
          detail?: string;
        };
        next =
          res.ok && data.listing
            ? { listing: data.listing, loading: false, error: null, detail: null }
            : {
                listing: null,
                loading: false,
                error: data.error ?? "לא הצלחנו לקרוא את הערוץ.",
                detail: data.detail ?? null,
              };
      } catch {
        if (signal.aborted) return;
        next = {
          listing: null,
          loading: false,
          error: "לא הצלחנו לקרוא את הערוץ. בדקו את החיבור ונסו שוב.",
          detail: null,
        };
      }
      if (!signal.aborted) setTabs((t) => ({ ...t, [tab]: next }));
    },
    [channelUrl],
  );

  /* Both lists load at once — the Shorts count is part of the answer. */
  useEffect(() => {
    const controller = new AbortController();
    setTabs({ videos: EMPTY_TAB, shorts: EMPTY_TAB });
    setSelected(new Set());
    setShown(PAGE);
    for (const tab of TABS) void loadTab(tab, controller.signal);
    return () => controller.abort();
  }, [loadTab]);

  /* A list YouTube cut short can be fetched again; picks in it are kept. */
  const reload = useCallback(
    (tab: ChannelTab) => {
      setTabs((t) => ({ ...t, [tab]: { ...t[tab], loading: true } }));
      void loadTab(tab, new AbortController().signal);
    },
    [loadTab],
  );

  const channelName =
    tabs.videos.listing?.channel || tabs.shorts.listing?.channel || "";

  /* Land on whichever list actually has something in it. */
  useEffect(() => {
    if (
      !tabs.videos.loading &&
      (tabs.videos.listing?.entries.length ?? 0) === 0 &&
      (tabs.shorts.listing?.entries.length ?? 0) > 0
    ) {
      setActive("shorts");
    }
  }, [tabs]);

  useEffect(() => {
    const picked = TABS.flatMap(
      (tab) => tabs[tab].listing?.entries.filter((e) => selected.has(e.id)) ?? [],
    );
    onChange(picked, channelName);
  }, [selected, tabs, channelName, onChange]);

  const current = tabs[active];
  const entries = useMemo(() => current.listing?.entries ?? [], [current.listing]);
  const pickedHere = entries.filter((e) => selected.has(e.id)).length;

  const replaceTabSelection = useCallback(
    (tab: ChannelTab, ids: string[]) => {
      const inTab = new Set(tabs[tab].listing?.entries.map((e) => e.id) ?? []);
      setSelected((prev) => {
        const next = new Set([...prev].filter((id) => !inTab.has(id)));
        for (const id of ids) next.add(id);
        return next;
      });
    },
    [tabs],
  );

  const toggle = useCallback((id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const selectAllShorts = () => {
    const ids = tabs.shorts.listing?.entries.map((e) => e.id) ?? [];
    replaceTabSelection("shorts", ids);
    setActive("shorts");
    setShown(PAGE);
  };

  const selectByDate = async () => {
    if (!from && !to) return;
    setRangeBusy(true);
    setRangeError(null);
    try {
      const res = await fetch("/api/channel/range", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ids: entries.map((e) => e.id),
          from: from?.toString() ?? null,
          to: to?.toString() ?? null,
        }),
      });
      const data = (await res.json()) as { start?: number; end?: number; error?: string };
      if (!res.ok || data.start === undefined || data.end === undefined) {
        setRangeError(data.error ?? "לא הצלחנו לבדוק את התאריכים");
        return;
      }
      const slice = entries.slice(data.start, data.end);
      replaceTabSelection(active, slice.map((e) => e.id));
      // Make sure the first picked row is actually on screen.
      setShown((n) => Math.max(n, Math.min(entries.length, data.end! + 20)));
      if (slice.length === 0) toast.warning("אין סרטונים בטווח התאריכים הזה");
      else toast.success(`סומנו ${slice.length} ${active === "shorts" ? "Shorts" : "סרטונים"} לפי תאריך`);
    } catch {
      setRangeError("לא הצלחנו לבדוק את התאריכים");
    } finally {
      setRangeBusy(false);
    }
  };

  const shortsCount = tabs.shorts.listing?.entries.length ?? 0;
  const allHere = entries.length > 0 && pickedHere === entries.length;

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-base font-bold text-foreground">
            {channelName || "ערוץ יוטיוב"}
          </span>
          <span className="text-xs text-muted">
            {selected.size > 0 ? `נבחרו ${selected.size}` : "בחרו אילו סרטונים להוריד"}
          </span>
        </div>
        {selected.size > 0 ? (
          <Button
            variant="ghost"
            size="sm"
            onPress={() => setSelected(new Set())}
            className="text-xs font-bold text-muted"
          >
            ניקוי הבחירה
          </Button>
        ) : null}
      </div>

      <ToggleButtonGroup
        aria-label="רשימה"
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[active]}
        onSelectionChange={(keys) => {
          const next = [...keys][0];
          if (next === "videos" || next === "shorts") {
            setActive(next);
            setShown(PAGE);
            setRangeError(null);
          }
        }}
        fullWidth
        className="rounded-[10px] bg-surface-secondary p-[3px]"
      >
        {TABS.map((tab) => {
          const state = tabs[tab];
          const count = state.listing?.entries.length;
          return (
            <ToggleButton
              key={tab}
              id={tab}
              className="flex-1 gap-1.5 rounded-lg px-[22px] py-[7px] text-[13px]"
            >
              {CHANNEL_TAB_LABEL[tab]}
              {state.loading ? (
                <Spinner size="sm" />
              ) : count !== undefined ? (
                <span className="ltr-run text-xs opacity-70">({count})</span>
              ) : null}
            </ToggleButton>
          );
        })}
      </ToggleButtonGroup>

      {/* Bulk picks. */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          isDisabled={shortsCount === 0}
          onPress={selectAllShorts}
          className="rounded-full text-xs font-bold"
        >
          כל ה-Shorts{shortsCount ? ` (${shortsCount})` : ""}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          isDisabled={entries.length === 0}
          onPress={() => replaceTabSelection(active, allHere ? [] : entries.map((e) => e.id))}
          className="rounded-full text-xs font-bold"
        >
          {allHere ? "ביטול הסימון ברשימה" : `כל ה${active === "shorts" ? "-Shorts" : "סרטונים"} ברשימה`}
        </Button>
      </div>

      <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
        <span className="text-xs font-bold text-muted">
          סימון לפי תאריך העלאה · {active === "shorts" ? "ב-Shorts" : "בסרטונים"}
        </span>
        <div className="flex flex-wrap items-end gap-3">
          <DateField value={from} onChange={setFrom} className="w-[150px]">
            <Label className="text-[11px] text-muted">מתאריך</Label>
            <DateField.Group>
              <DateField.Input>
                {(segment) => <DateField.Segment segment={segment} />}
              </DateField.Input>
            </DateField.Group>
          </DateField>
          <DateField value={to} onChange={setTo} className="w-[150px]">
            <Label className="text-[11px] text-muted">עד תאריך</Label>
            <DateField.Group>
              <DateField.Input>
                {(segment) => <DateField.Segment segment={segment} />}
              </DateField.Input>
            </DateField.Group>
          </DateField>
          <Button
            size="sm"
            variant="primary"
            isDisabled={(!from && !to) || entries.length === 0 || rangeBusy}
            onPress={() => void selectByDate()}
            className="h-9 rounded-lg text-xs font-bold"
          >
            {rangeBusy ? <Spinner size="sm" /> : "סימון"}
          </Button>
        </div>
        <span className="text-[11px] text-muted">
          {rangeBusy
            ? "בודק תאריכים מדויקים מול יוטיוב — זה לוקח כמה שניות"
            : "אפשר למלא רק אחד מהשניים. התאריך המדויק של כל סרטון נבדק מול יוטיוב."}
        </span>
        {rangeError ? (
          <span className="text-xs text-danger-soft-foreground">{rangeError}</span>
        ) : null}
      </div>

      <List
        state={current}
        entries={entries}
        shown={shown}
        onShowMore={() => setShown((n) => n + PAGE)}
        selected={selected}
        onToggle={toggle}
        onReload={() => reload(active)}
      />
    </div>
  );
}

function List({
  state,
  entries,
  shown,
  onShowMore,
  selected,
  onToggle,
  onReload,
}: {
  state: TabState;
  entries: ChannelEntry[];
  shown: number;
  onShowMore: () => void;
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
  onReload: () => void;
}) {
  if (state.loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted">
        <Spinner size="sm" />
        טוען את רשימת הסרטונים — בערוץ גדול זה יכול לקחת עד דקה
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="flex flex-col gap-1.5 py-4">
        <span className="text-xs text-danger-soft-foreground">{state.error}</span>
        {state.detail ? (
          <code className="ltr-run block overflow-x-auto rounded-lg border border-border bg-surface-secondary px-3 py-2 text-[11px] text-muted">
            {state.detail}
          </code>
        ) : null}
      </div>
    );
  }

  if (entries.length === 0) {
    return <div className="py-8 text-center text-xs text-muted">אין כאן סרטונים</div>;
  }

  return (
    <div className="flex flex-col">
      {state.listing?.partial ? (
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-xs text-warning">
            יוטיוב הפסיק לענות באמצע — מוצגים {entries.length} הסרטונים החדשים ביותר, והישנים
            יותר חסרים.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onPress={onReload}
            className="shrink-0 text-xs font-bold text-accent-soft-foreground"
          >
            טעינה מחדש
          </Button>
        </div>
      ) : null}
      <ul className="flex max-h-[440px] flex-col overflow-y-auto rounded-xl border border-border">
        {entries.slice(0, shown).map((entry) => (
          <li key={entry.id} className="border-b border-border last:border-b-0">
            <Checkbox
              isSelected={selected.has(entry.id)}
              onChange={(on: boolean) => onToggle(entry.id, on)}
              className="w-full px-3 py-2 hover:bg-surface-secondary"
            >
              <Checkbox.Content className="flex w-full min-w-0 items-center gap-3">
                <Checkbox.Control>
                  <Checkbox.Indicator />
                </Checkbox.Control>
                <Thumbnail
                  src={entry.thumbnail}
                  alt=""
                  className="h-[36px] w-[64px]"
                  durationSec={entry.duration}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span dir="auto" className="truncate text-start text-[13px] text-foreground">
                    {entry.title}
                  </span>
                  {entry.approxTimestamp ? (
                    <span className="text-[11px] text-muted">
                      ~{new Date(entry.approxTimestamp * 1000).toLocaleDateString("he-IL")}
                    </span>
                  ) : null}
                </span>
              </Checkbox.Content>
            </Checkbox>
          </li>
        ))}
      </ul>
      {shown < entries.length ? (
        <Button
          variant="ghost"
          size="sm"
          onPress={onShowMore}
          className="mt-2 self-center text-xs font-bold text-accent-soft-foreground"
        >
          הצגת עוד ({entries.length - shown} נוספים)
        </Button>
      ) : null}
    </div>
  );
}
