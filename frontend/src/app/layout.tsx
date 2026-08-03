import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { LanguageProvider } from "@/lib/language-context";
import { ThemeProvider } from "@/lib/theme-context";
import { SnowProvider } from "@/lib/snow-context";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import BottomNav from "@/components/BottomNav";
import SwipeNavigation from "@/components/SwipeNavigation";
import ThemeBackgroundWrapper from "@/components/ThemeBackgroundWrapper";
import AppClientEffects from "@/components/AppClientEffects";
import ConfirmDialogHost from "@/components/ConfirmDialogHost";
import ToastHost from "@/components/ToastHost";
import { KeyboardShortcutsProvider } from "@/lib/keyboard-shortcuts";
import { GlobalShortcuts } from "@/components/GlobalShortcuts";
import { getLanguageLocale, getServerLanguage } from "@/lib/server-language";

const siteUrl = getCanonicalSiteUrl();

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage();
  const description = language === 'en'
    ? 'Personal schedule, exams and UMKD for KSTU students'
    : language === 'kz'
      ? 'KSTU студенттеріне арналған жеке кесте, емтихандар және УӘКД'
      : 'Персональное расписание, экзамены и УМКД для студентов KSTU';

  return {
    metadataBase: new URL(siteUrl),
    title: {
      default: "UniverSchedule | KSTU",
      template: "%s | UniverSchedule",
    },
    description,
    applicationName: "UniverSchedule",
    alternates: {
      canonical: "/",
    },
    openGraph: {
      type: "website",
      siteName: "UniverSchedule",
      url: siteUrl,
      title: "UniverSchedule | KSTU",
      description,
      locale: getLanguageLocale(language),
    },
    twitter: {
      card: "summary_large_image",
      title: "UniverSchedule | KSTU",
      description,
    },
    robots: {
      index: true,
      follow: true,
    },
    verification: {
      google: process.env.GOOGLE_SITE_VERIFICATION,
    },
    manifest: "/manifest.json",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "UniverSchedule",
    },
    icons: {
      icon: [
        { url: "/favicon.ico", sizes: "any" },
        { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
        { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
        { url: "/android-chrome-192x192.png", type: "image/png", sizes: "192x192" },
        { url: "/android-chrome-512x512.png", type: "image/png", sizes: "512x512" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
      shortcut: ["/favicon.ico"],
    },
  };
}

// Pre-hydration default only. There are eleven themes and this static form can
// express two, so ThemeProvider (lib/theme-context.tsx) prepends a dynamic
// <meta name="theme-color"> carrying the active theme's --bg as soon as a theme
// is applied; the UA honours the first matching tag in tree order, so that one
// wins after hydration and these remain the first-paint fallback.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f7fb" },
    { media: "(prefers-color-scheme: dark)", color: "#060918" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const language = await getServerLanguage();
  return (
    <html lang={language} suppressHydrationWarning>
      <body suppressHydrationWarning className="font-sans antialiased">
        {/* ThemeProvider is the outermost client boundary and also hosts
            framer-motion's <MotionConfig reducedMotion="user">, which cannot be
            mounted from this file: layout.tsx is an async Server Component and
            framer-motion 12.x ships no "use client" directive. */}
        <ThemeProvider>
          <LanguageProvider>
            <SnowProvider>
              <ThemeBackgroundWrapper />
              <AuthProvider>
                <KeyboardShortcutsProvider>
                  <AppClientEffects />
                  <SwipeNavigation>
                    <div className="page-content page-transition-wrapper">{children}</div>
                  </SwipeNavigation>
                  <BottomNav />
                  <ConfirmDialogHost />
                  <ToastHost />
                  <GlobalShortcuts />
                </KeyboardShortcutsProvider>
              </AuthProvider>
            </SnowProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
