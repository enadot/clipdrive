"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Input,
  ListBox,
  ListBoxItem,
  Modal,
  SearchField,
  Spinner,
  TextField,
} from "@heroui/react";

import { useFolders } from "@/hooks/use-drive";
import { fileCount, relativeTime } from "@/lib/format";
import type { DriveFolder } from "@/lib/types";

interface Props {
  /**
   * The element that opens the picker. It becomes the dialog's trigger child,
   * which is how React Aria wires press handling and focus return — passing it
   * in rather than opening the modal from the outside keeps that intact.
   */
  trigger: ReactNode;
  selectedId: string | null;
  onSelect: (folder: DriveFolder) => void;
}

/** Folders touched in the last week float to an "אחרונות" group. */
const RECENT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function FolderPicker({ trigger, selectedId, onSelect }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const { folders, loading, error, create } = useFolders(isOpen);
  const [query, setQuery] = useState("");
  const [draftName, setDraftName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(selectedId);

  const { recent, rest } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = needle
      ? folders.filter((f) => f.name.toLowerCase().includes(needle))
      : folders;
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    return {
      recent: matched.filter((f) => f.lastUsed && f.lastUsed >= cutoff),
      rest: matched.filter((f) => !f.lastUsed || f.lastUsed < cutoff),
    };
  }, [folders, query]);

  const handleCreate = async () => {
    const name = draftName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const folder = await create(name);
      setDraftName("");
      setPendingId(folder.id);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "יצירת התיקייה נכשלה");
    } finally {
      setCreating(false);
    }
  };

  const confirm = () => {
    const chosen = folders.find((f) => f.id === pendingId);
    if (chosen) onSelect(chosen);
    setIsOpen(false);
  };

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={(open) => {
        // Re-sync the pending choice each time it opens, so cancelling and
        // reopening doesn't resurrect an abandoned selection.
        if (open) setPendingId(selectedId);
        setIsOpen(open);
      }}
    >
      {trigger}
      <Modal.Backdrop>
        <Modal.Container>
          <Modal.Dialog className="w-[400px] max-w-[calc(100vw-32px)] overflow-hidden rounded-2xl border border-frame bg-overlay p-0 shadow-overlay">
            <Modal.Header className="flex flex-col gap-3 border-b border-border px-5 pb-3 pt-[18px]">
              <Modal.Heading className="text-[15px] font-bold text-foreground">
                בחירת תיקיית יעד
              </Modal.Heading>

              <SearchField value={query} onChange={setQuery} aria-label="חיפוש תיקייה">
                <SearchField.Group className="h-auto rounded-[10px] border border-border bg-background px-3 py-2">
                  <SearchField.SearchIcon />
                  <SearchField.Input
                    placeholder="חיפוש תיקייה…"
                    className="text-[13px] placeholder:text-muted"
                  />
                  {query ? <SearchField.ClearButton /> : null}
                </SearchField.Group>
              </SearchField>
            </Modal.Header>

            <Modal.Body className="flex max-h-[46vh] flex-col gap-0.5 overflow-y-auto p-2">
              {loading && folders.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-8 text-[13px] text-muted">
                  <Spinner size="sm" /> טוען תיקיות…
                </div>
              ) : null}

              {error ? (
                <p className="px-3 py-6 text-center text-[13px] text-danger-soft-foreground">
                  {error}
                </p>
              ) : null}

              {!loading && !error && folders.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-muted">
                  אין עדיין תיקיות. צרו אחת למטה — זו הדרך היחידה, וזה בכוונה.
                </p>
              ) : null}

              {recent.length > 0 ? (
                <>
                  <GroupLabel>אחרונות</GroupLabel>
                  <FolderList
                    folders={recent}
                    pendingId={pendingId}
                    onPick={setPendingId}
                    showRecency
                  />
                </>
              ) : null}

              {rest.length > 0 ? (
                <>
                  <GroupLabel>כל התיקיות · ClipDrive</GroupLabel>
                  <FolderList folders={rest} pendingId={pendingId} onPick={setPendingId} />
                </>
              ) : null}

              {/* Creating from here is the only way in — the drive.file scope
                  means the app cannot see folders it did not make. */}
              <div className="mt-1 flex items-center gap-2.5 rounded-[10px] border border-dashed border-accent-soft-foreground/40 bg-accent-soft px-3 py-2">
                <span className="font-bold text-accent-soft-foreground">+</span>
                <TextField
                  value={draftName}
                  onChange={setDraftName}
                  aria-label="שם תיקייה חדשה"
                  className="flex-1"
                >
                  <Input
                    placeholder="שם תיקייה חדשה…"
                    className="w-full border-none bg-transparent p-0 text-[13px] shadow-none placeholder:text-muted focus:outline-none"
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void handleCreate();
                      }
                    }}
                  />
                </TextField>
                <Button
                  size="sm"
                  variant="primary"
                  isDisabled={!draftName.trim() || creating}
                  onPress={() => void handleCreate()}
                  className="rounded-md bg-accent px-3 text-xs font-bold text-accent-foreground"
                >
                  {creating ? "יוצר…" : "יצירה"}
                </Button>
              </div>

              {createError ? (
                <span className="px-3 pt-1 text-[11px] text-danger-soft-foreground">
                  {createError}
                </span>
              ) : null}

              <span className="px-3 pb-0.5 pt-1 text-[10px] text-muted">
                תיקיות נוצרות בתוך ClipDrive בלבד (הרשאת drive.file מינימלית)
              </span>
            </Modal.Body>

            <Modal.Footer className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button
                variant="outline"
                className="rounded-[10px] px-[18px] text-[13px] font-bold"
                onPress={() => setIsOpen(false)}
              >
                ביטול
              </Button>
              <Button
                variant="primary"
                isDisabled={!pendingId}
                onPress={confirm}
                className="rounded-[10px] bg-accent px-5 text-[13px] font-bold text-accent-foreground"
              >
                בחירה
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-3 pb-0.5 pt-2.5 text-[11px] font-bold text-muted">{children}</span>
  );
}

function FolderList({
  folders,
  pendingId,
  onPick,
  showRecency = false,
}: {
  folders: DriveFolder[];
  pendingId: string | null;
  onPick: (id: string) => void;
  showRecency?: boolean;
}) {
  return (
    <ListBox
      aria-label="תיקיות"
      selectionMode="single"
      selectedKeys={pendingId ? [pendingId] : []}
      onSelectionChange={(keys) => {
        const first = [...keys][0];
        if (typeof first === "string") onPick(first);
      }}
      items={folders}
      className="flex flex-col gap-0.5 border-none bg-transparent p-0 shadow-none"
    >
      {(folder: DriveFolder) => {
        const selected = folder.id === pendingId;
        return (
          <ListBoxItem
            id={folder.id}
            key={folder.id}
            textValue={folder.name}
            className={`flex cursor-pointer items-center gap-2.5 rounded-[10px] px-3 py-2.5 outline-none ${
              selected
                ? "border border-accent-soft-foreground/40 bg-accent-soft"
                : "border border-transparent hover:bg-surface-secondary"
            }`}
          >
            <span className={selected ? "text-accent-soft-foreground" : "text-muted"}>▣</span>
            <span
              className={`flex-1 truncate text-sm text-foreground ${selected ? "font-bold" : ""}`}
            >
              {folder.name}
            </span>
            <span className="shrink-0 text-[11px] text-muted">
              {showRecency ? relativeTime(folder.lastUsed) : fileCount(folder.fileCount)}
            </span>
            {selected ? <span className="font-bold text-accent-soft-foreground">✓</span> : null}
          </ListBoxItem>
        );
      }}
    </ListBox>
  );
}
