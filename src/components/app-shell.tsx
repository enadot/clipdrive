"use client";

import Link from "next/link";
import { Button, Toast, useIsHydrated, useTheme } from "@heroui/react";

import type { AuthInfo } from "@/hooks/use-drive";

interface Props {
  auth: AuthInfo | null;
  children: React.ReactNode;
}

/** Header + toast region, shared by the main screen and the task list. */
export function AppShell({ auth, children }: Props) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-foreground">
            C
          </span>
          <span className="text-[15px] font-bold text-foreground">ClipDrive</span>
        </Link>

        <div className="flex items-center gap-3">
          <Link
            href="/jobs"
            className="text-[13px] font-bold text-muted hover:text-foreground"
          >
            משימות
          </Link>
          <DriveStatus auth={auth} />
          <ThemeToggle />
        </div>
      </header>

      <main className="flex flex-1 flex-col">{children}</main>

      {/* Success and failure toasts land bottom-centre, as in screen 2e. */}
      <Toast.Provider placement="bottom" />
    </div>
  );
}

function DriveStatus({ auth }: { auth: AuthInfo | null }) {
  if (!auth) return null;

  return (
    <span className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted sm:flex">
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          auth.connected ? "bg-accent" : "bg-muted"
        }`}
      />
      {auth.connected ? "מחובר לדרייב" : "לא מחובר"}
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  // The resolved theme is unknowable on the server, so the glyph and label stay
  // neutral until hydration. Rendering the light-mode icon eagerly would differ from
  // what a dark-mode visitor gets and trip a hydration mismatch.
  const isHydrated = useIsHydrated();
  const dark = isHydrated && resolvedTheme === "dark";

  return (
    <Button
      isIconOnly
      size="sm"
      variant="outline"
      aria-label={isHydrated ? (dark ? "מעבר למצב בהיר" : "מעבר למצב כהה") : "החלפת ערכת נושא"}
      onPress={() => setTheme(dark ? "light" : "dark")}
      className="h-7 w-7 min-w-7 rounded-full bg-surface-secondary text-[13px] text-muted"
    >
      <span suppressHydrationWarning>{isHydrated ? (dark ? "☀" : "☾") : "◐"}</span>
    </Button>
  );
}
