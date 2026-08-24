import type { Metadata, Viewport } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "ClipDrive",
  description: "מדביקים לינק יוטיוב, בוחרים MP4 או MP3, והקובץ מחכה בדרייב.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f13" },
  ],
};

/**
 * Applies the stored theme before first paint, using the same storage key and
 * DOM contract as HeroUI's `useTheme`. Without this the page flashes light
 * before hydration — dark mode is first-class here, not an afterthought.
 */
const NO_FLASH = `(function(){try{var t=localStorage.getItem("heroui-theme")||"system";var r=t==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;document.documentElement.classList.add(r);document.documentElement.setAttribute("data-theme",r);}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      {/* HeroUI v3 needs no provider. */}
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
