'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { useTheme } from '@/lib/theme-context';
import { useKeyboardShortcuts, useShortcut } from '@/lib/keyboard-shortcuts';
import { useFeatureFlag } from '@/lib/feature-flags';
import { ShortcutsHelpModal } from '@/components/ShortcutsHelpModal';
import { SocialSearchPalette } from '@/components/SocialSearchPalette';

/**
 * Public/landing routes where we deliberately keep shortcuts disabled so the
 * marketing surface stays simple and predictable.
 */
const PUBLIC_PREFIXES = [
    '/login',
    '/univer-kstu',
    '/univer',
    '/raspisanie-kstu',
    '/raspisanie-zanyatii-kstu',
    '/kstu-raspisanie-par',
    '/ocenki-univer-kstu',
    '/ekzameny-kstu',
    '/vhod-univer-kstu',
    '/about',
    '/privacy',
    '/terms',
    '/curator-login',
];

function isPublicRoute(pathname: string | null): boolean {
    if (!pathname) return true;
    if (pathname === '/') return true;
    for (const prefix of PUBLIC_PREFIXES) {
        if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true;
    }
    return false;
}

/**
 * Registers the global keyboard shortcut set on authenticated routes.
 *
 * Mounted inside `<KeyboardShortcutsProvider>` from the root layout. Renders
 * the help modal but no visible UI of its own.
 */
export function GlobalShortcuts() {
    const router = useRouter();
    const pathname = usePathname();
    const { isAuth } = useAuth();
    const { messages } = useLanguage();
    const { theme, setTheme } = useTheme();
    const { openHelp, helpOpen, closeHelp } = useKeyboardShortcuts();
    const socialFeedBeta = useFeatureFlag('socialFeedBeta');

    const [searchPaletteOpen, setSearchPaletteOpen] = useState(false);

    const descriptions = messages.shortcuts.descriptions;

    // Whether the global handlers should be active right now.
    const active = isAuth && !isPublicRoute(pathname);

    const goto = useCallback((path: string) => {
        if (!active) return;
        router.push(path);
    }, [active, router]);

    // Build the registration list once; using useShortcut keeps each binding
    // tied to component lifetime via its internal useEffect.
    const handlers = useMemo(() => ({
        gotoSchedule: () => goto('/schedule'),
        gotoExams: () => goto('/exams'),
        gotoGrades: () => goto('/grades'),
        gotoUmkd: () => goto('/umkd'),
        gotoProfile: () => goto('/profile'),
        gotoGroup: () => goto('/group'),
        gotoSettings: () => goto('/settings'),
        toggleTheme: () => {
            if (!active) return;
            setTheme(theme === 'light' ? 'dark' : 'light');
        },
        refreshPage: () => {
            if (!active) return;
            if (!pathname) return;
            // Only refresh on data-heavy pages where the existing UI already has
            // a refresh affordance. router.refresh() re-runs the route's server
            // segments without a hard reload.
            if (pathname.startsWith('/schedule')
                || pathname.startsWith('/grades')
                || pathname.startsWith('/exams')
                || pathname.startsWith('/umkd')) {
                router.refresh();
            }
        },
        focusSearch: () => {
            if (!active) return;
            if (typeof document === 'undefined') return;
            const candidates = document.querySelectorAll<HTMLInputElement>(
                'input[type="search"], input[role="searchbox"], input[data-shortcut-search]',
            );
            for (const input of Array.from(candidates)) {
                if (input.offsetParent !== null) {
                    input.focus();
                    input.select?.();
                    return;
                }
            }
        },
        openHelpModal: () => {
            if (!active) return;
            openHelp();
        },
        openSearchPalette: () => {
            if (!active) return;
            if (!socialFeedBeta) return;
            setSearchPaletteOpen(true);
        },
        escape: () => {
            if (helpOpen) closeHelp();
        },
    }), [active, goto, helpOpen, closeHelp, openHelp, pathname, router, setTheme, socialFeedBeta, theme]);

    // Navigation group
    useShortcut('g s', handlers.gotoSchedule, { description: descriptions.goToSchedule, group: 'navigation' });
    useShortcut('g e', handlers.gotoExams, { description: descriptions.goToExams, group: 'navigation' });
    useShortcut('g g', handlers.gotoGrades, { description: descriptions.goToGrades, group: 'navigation' });
    useShortcut('g u', handlers.gotoUmkd, { description: descriptions.goToUmkd, group: 'navigation' });
    useShortcut('g p', handlers.gotoProfile, { description: descriptions.goToProfile, group: 'navigation' });
    useShortcut('g r', handlers.gotoGroup, { description: descriptions.goToGroup, group: 'navigation' });
    useShortcut('g t', handlers.gotoSettings, { description: descriptions.goToSettings, group: 'navigation' });

    // Actions group
    useShortcut('t', handlers.toggleTheme, { description: descriptions.toggleTheme, group: 'actions' });
    useShortcut('r', handlers.refreshPage, { description: descriptions.refreshPage, group: 'actions' });
    useShortcut('/', handlers.focusSearch, { description: descriptions.focusSearch, group: 'actions' });

    // Misc group
    useShortcut('Shift+?', handlers.openHelpModal, { description: descriptions.openHelp, group: 'misc' });
    useShortcut('Escape', handlers.escape, { description: descriptions.closeModal, group: 'misc' });

    // Universal social search palette — gated behind socialFeedBeta. Bound to
    // Cmd+K / Ctrl+K via the `Mod+K` combo (Mod resolves to ⌘ on Mac, Ctrl
    // elsewhere). The shortcut is registered unconditionally so the help modal
    // can list it once enabled, but the handler no-ops when the flag is off.
    useShortcut(
        'Mod+K',
        handlers.openSearchPalette,
        { description: descriptions.openSocialSearch, group: 'actions' },
    );

    return (
        <>
            <ShortcutsHelpModal />
            <SocialSearchPalette
                open={searchPaletteOpen && socialFeedBeta}
                onClose={() => setSearchPaletteOpen(false)}
            />
        </>
    );
}
