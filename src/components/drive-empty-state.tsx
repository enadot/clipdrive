"use client";

import { Button, EmptyState } from "@heroui/react";

/**
 * Screen 1b, in the v2 visual language. One sentence on why the connection is
 * needed and exactly what the permission covers — the spec's whole pitch is
 * trust, so the narrow scope is stated up front rather than buried.
 *
 * Since a direct download needs no permission at all, this is a recommendation
 * with a way past it rather than a locked door.
 */
export function DriveEmptyState({
  configured,
  redirectUri,
  onSkip,
}: {
  configured: boolean;
  redirectUri?: string;
  /** Continues into the converter with "download to this computer" as the only destination. */
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <EmptyState className="flex w-full max-w-[560px] flex-col items-center gap-4 rounded-2xl border border-frame bg-background px-8 py-11 text-center shadow-surface">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-2xl text-accent-soft-foreground">
          ▣
        </span>

        <h1 className="text-[19px] font-bold text-foreground">
          חברו את גוגל דרייב כדי שהקבצים יחכו לכם שם
        </h1>

        <p className="max-w-[440px] text-[13px] leading-relaxed text-muted">
          ClipDrive מבקש הרשאה אחת בלבד —{" "}
          <span className="ltr-run font-bold text-foreground">drive.file</span> — שנותנת גישה{" "}
          <span className="font-bold text-foreground">רק לתיקיות ולקבצים שהאפליקציה עצמה יצרה</span>.
          שאר הדרייב שלכם נשאר בלתי נראה לה.
        </p>

        {configured ? (
          <Button
            variant="primary"
            onPress={() => {
              window.location.href = "/api/auth/google";
            }}
            className="h-12 rounded-xl bg-accent px-6 text-[15px] font-bold text-accent-foreground hover:bg-accent-hover"
          >
            חיבור לגוגל דרייב
          </Button>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-danger bg-danger-soft px-4 py-3 text-[13px] text-danger-soft-foreground">
            <span className="font-bold">חסרה הגדרת OAuth</span>
            <span>
              הוסיפו <span className="ltr-run">GOOGLE_CLIENT_ID</span> ו-
              <span className="ltr-run">GOOGLE_CLIENT_SECRET</span> לקובץ{" "}
              <span className="ltr-run">.env</span> — ראו{" "}
              <span className="ltr-run">.env.example</span>.
            </span>
          </div>
        )}

        <Button
          variant="ghost"
          onPress={onSkip}
          className="-mt-1 text-[13px] font-bold text-accent-soft-foreground"
        >
          בלי דרייב — רק להוריד למחשב ⤓
        </Button>

        <span className="text-[11px] text-muted">
          אפשר לנתק בכל רגע — הניתוק מוחק את ההרשאה מהמכשיר הזה.
        </span>

        {/* The one string a redirect_uri_mismatch is always about. */}
        {redirectUri ? (
          <details className="w-full text-right">
            <summary className="cursor-pointer list-none text-[11px] text-muted hover:text-foreground">
              קיבלתם <span className="ltr-run">redirect_uri_mismatch</span>? לחצו כאן
            </summary>
            <div className="mt-2 flex flex-col gap-2 rounded-xl border border-border bg-surface-secondary p-3 text-right">
              <span className="text-[11px] text-muted">
                זה בדיוק מה שהאפליקציה שולחת לגוגל. הדביקו אותו תחת{" "}
                <span className="font-bold text-foreground">Authorized redirect URIs</span>{" "}
                באותו OAuth client שממנו לקחתם את ה-
                <span className="ltr-run">CLIENT_ID</span>:
              </span>
              <code className="ltr-run block overflow-x-auto rounded-lg bg-surface px-3 py-2 text-xs text-foreground">
                {redirectUri}
              </code>
            </div>
          </details>
        ) : null}
      </EmptyState>
    </div>
  );
}
