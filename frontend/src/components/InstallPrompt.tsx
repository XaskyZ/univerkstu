'use client';

import { useCallback, useEffect, useState } from 'react';
import { X, Download, Share } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

/**
 * Soft "Install UniverSchedule" banner.
 *
 * - Captures the browser's `beforeinstallprompt` event so we can trigger the
 *   native install dialog from a button instead of letting Chrome show its
 *   own subtle hint that most students miss.
 * - On iOS (no `beforeinstallprompt`) shows a plain text hint pointing at
 *   the Share -> Add to Home Screen flow.
 * - Hidden entirely when the app is already running standalone.
 * - Once dismissed, suppressed for 30 days via a localStorage timestamp so
 *   we never become annoying.
 *
 * The banner sits above BottomNav on mobile (uses `safe-area-inset-bottom`
 * plus the BottomNav height of 68px) so it never covers the primary nav.
 */

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'pwa-install-banner-dismissed-at';
const DISMISS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function isIosDevice(): boolean {
    if (typeof window === 'undefined') return false;
    const ua = window.navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) return true;
    // iPadOS 13+ identifies as Macintosh but exposes multi-touch.
    if (/Macintosh/i.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) {
        return true;
    }
    return false;
}

function isStandaloneApp(): boolean {
    if (typeof window === 'undefined') return false;
    if (window.matchMedia?.('(display-mode: standalone)')?.matches) return true;
    const nav = window.navigator as Navigator & { standalone?: boolean };
    return nav.standalone === true;
}

function recentlyDismissed(): boolean {
    if (typeof window === 'undefined') return true;
    try {
        const raw = window.localStorage.getItem(DISMISS_KEY);
        if (!raw) return false;
        const at = Number.parseInt(raw, 10);
        if (!Number.isFinite(at) || at <= 0) return false;
        return Date.now() - at < DISMISS_WINDOW_MS;
    } catch {
        return false;
    }
}

function rememberDismissal(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
        // localStorage may be unavailable (private mode) — accept that the
        // banner will reappear on the next session.
    }
}

/**
 * Compute initial visibility/iOS state synchronously based on userAgent +
 * standalone + dismissal flag. Doing this in the useState initializer keeps
 * us out of the `set-state-in-effect` lint rule and avoids a double render.
 */
function computeInitialState(): { iosVisible: boolean; hidden: boolean } {
    if (typeof window === 'undefined') return { iosVisible: false, hidden: true };
    if (isStandaloneApp()) return { iosVisible: false, hidden: true };
    if (recentlyDismissed()) return { iosVisible: false, hidden: true };
    if (isIosDevice()) return { iosVisible: true, hidden: false };
    // For non-iOS we wait for `beforeinstallprompt`; banner stays hidden.
    return { iosVisible: false, hidden: true };
}

export default function InstallPrompt() {
    const { messages } = useLanguage();
    const ui = messages.pwa;
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
    const [iosVisible, setIosVisible] = useState<boolean>(() => computeInitialState().iosVisible);
    const [hidden, setHidden] = useState<boolean>(() => computeInitialState().hidden);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (isStandaloneApp()) return;
        if (recentlyDismissed()) return;

        const onBefore = (event: Event) => {
            event.preventDefault();
            setDeferred(event as BeforeInstallPromptEvent);
            setHidden(false);
        };
        const onInstalled = () => {
            setDeferred(null);
            setHidden(true);
        };

        window.addEventListener('beforeinstallprompt', onBefore);
        window.addEventListener('appinstalled', onInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', onBefore);
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    const dismiss = useCallback(() => {
        rememberDismissal();
        setHidden(true);
        setDeferred(null);
        setIosVisible(false);
    }, []);

    const install = useCallback(async () => {
        if (!deferred) return;
        try {
            await deferred.prompt();
            await deferred.userChoice;
        } catch {
            // Surface nothing — the user can re-trigger from settings.
        }
        setDeferred(null);
        setHidden(true);
        rememberDismissal();
    }, [deferred]);

    if (hidden) return null;
    if (!deferred && !iosVisible) return null;

    return (
        <div
            role="dialog"
            aria-label={ui.installTitle}
            className="fixed left-3 right-3 z-[180] mx-auto"
            style={{
                // 68px = BottomNav height. Adding the safe-area inset keeps
                // us clear of home-indicator bars on iOS standalone too.
                bottom: 'calc(68px + env(safe-area-inset-bottom, 0px) + 12px)',
                maxWidth: '420px',
                background: 'var(--card)',
                color: 'var(--text)',
                border: '1px solid var(--border)',
                borderRadius: '18px',
                boxShadow: 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.25))',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
            }}
        >
            <div className="flex items-start gap-3 p-4">
                <span
                    aria-hidden
                    className="inline-flex items-center justify-center rounded-full shrink-0"
                    style={{
                        width: 36,
                        height: 36,
                        background: 'rgba(var(--primary-rgb), 0.16)',
                        color: 'var(--primary)',
                    }}
                >
                    {deferred ? (
                        <Download className="w-4 h-4" strokeWidth={2.5} />
                    ) : (
                        <Share className="w-4 h-4" strokeWidth={2.5} />
                    )}
                </span>
                <div className="min-w-0 flex-1">
                    <p
                        className="text-sm font-semibold leading-tight"
                        style={{ color: 'var(--text)' }}
                    >
                        {ui.installTitle}
                    </p>
                    <p
                        className="text-xs mt-1 leading-snug"
                        style={{ color: 'var(--muted-fg, var(--text))' }}
                    >
                        {deferred ? ui.installSubtitle : ui.installIosHint}
                    </p>
                    {deferred ? (
                        <button
                            type="button"
                            onClick={install}
                            className="btn btn-primary mt-3 px-3 py-1.5 text-xs"
                        >
                            {ui.installCta}
                        </button>
                    ) : null}
                </div>
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label={messages.common.dismiss}
                    className="shrink-0 -mr-1 -mt-1 p-1 opacity-70 hover:opacity-100 transition-opacity"
                    style={{ color: 'var(--text)' }}
                >
                    <X className="w-4 h-4" strokeWidth={2.5} aria-hidden />
                </button>
            </div>
        </div>
    );
}
