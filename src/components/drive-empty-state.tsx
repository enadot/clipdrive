"use client";

import { Button, EmptyState } from "@heroui/react";

/**
 * Screen 1b, in the v2 visual language. One sentence on why the connection is
 * needed and exactly what the permission covers — the spec's whole pitch is
 * trust, so the narrow scope is stated up front rather than buried.
 */
export function DriveEmptyState({ configured }: { configured: boolean }) {
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

        <span className="text-[11px] text-muted">
          אפשר לנתק בכל רגע — הניתוק מוחק את ההרשאה מהמכשיר הזה.
        </span>
      </EmptyState>
    </div>
  );
}
