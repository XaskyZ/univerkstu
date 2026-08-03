'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { MotionConfig } from 'framer-motion';

export type Theme =
    | 'light'
    | 'dark'
    | 'deep-blue'
    | 'aurora'
    | 'sunset'
    | 'matrix'
    | 'pastel'
    | 'referral-nebula'
    | 'referral-sherbet'
    | 'supporter-midnight'
    | 'supporter-paper';

export type ThemeScheme = 'light' | 'dark';

interface ThemeContextType {
    theme: Theme;
    scheme: ThemeScheme;
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const THEMES: { value: Theme; label: string; icon: string; scheme: ThemeScheme }[] = [
    { value: 'light', label: 'Light', icon: '☀️', scheme: 'light' },
    { value: 'dark', label: 'Dark', icon: '🌙', scheme: 'dark' },
    { value: 'deep-blue', label: 'Deep Blue', icon: '🌊', scheme: 'dark' },
    { value: 'aurora', label: 'Aurora', icon: '🌌', scheme: 'dark' },
    { value: 'sunset', label: 'Sunset', icon: '🌅', scheme: 'dark' },
    { value: 'matrix', label: 'Matrix', icon: '💚', scheme: 'dark' },
    { value: 'pastel', label: 'Pastel', icon: '🎨', scheme: 'light' },
    { value: 'referral-nebula', label: 'Nebula Rush', icon: '🪐', scheme: 'dark' },
    { value: 'referral-sherbet', label: 'Sherbet Pop', icon: '🍊', scheme: 'light' },
    { value: 'supporter-midnight', label: 'Midnight Gold', icon: '🏆', scheme: 'dark' },
    { value: 'supporter-paper', label: 'Paper Mint', icon: '🍃', scheme: 'light' },
];

export function resolveThemeScheme(theme: Theme): ThemeScheme {
    return THEMES.find((item) => item.value === theme)?.scheme || 'dark';
}

/**
 * Point the browser/PWA chrome at the active theme's `--bg`.
 *
 * The static `viewport.themeColor` in app/layout.tsx can only express two
 * values (prefers-color-scheme light/dark) for eleven themes, so it stays as
 * the pre-hydration default and this takes over once a theme is applied.
 *
 * Tree order matters: the UA uses the *first* `<meta name="theme-color">` whose
 * `media` matches, so the dynamic tag is prepended into <head> ahead of the two
 * media-scoped ones Next.js renders.
 */
const DYNAMIC_THEME_COLOR_ID = 'app-theme-color';

function syncBrowserChromeColor(root: HTMLElement) {
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
    if (!bg) return;

    let meta = document.getElementById(DYNAMIC_THEME_COLOR_ID) as HTMLMetaElement | null;
    if (!meta) {
        meta = document.createElement('meta');
        meta.id = DYNAMIC_THEME_COLOR_ID;
        meta.name = 'theme-color';
        document.head.prepend(meta);
    }
    if (meta.content !== bg) {
        meta.content = bg;
    }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>(() => {
        if (typeof window === 'undefined') return 'dark';
        const savedTheme = localStorage.getItem('theme') as Theme | null;
        return savedTheme && THEMES.some((t) => t.value === savedTheme) ? savedTheme : 'dark';
    });
    const scheme = resolveThemeScheme(theme);

    const setTheme = useCallback((nextTheme: Theme) => {
        setThemeState(nextTheme);
    }, []);

    // Применение темы
    useEffect(() => {
        const root = document.documentElement;

        root.classList.add('theme-switching');
        root.setAttribute('data-theme', theme);
        root.setAttribute('data-theme-scheme', scheme);
        localStorage.setItem('theme', theme);

        // Read back AFTER the attributes land so getComputedStyle resolves the
        // new theme's --bg rather than the previous one.
        syncBrowserChromeColor(root);

        const timer = window.setTimeout(() => {
            root.classList.remove('theme-switching');
        }, 180);

        return () => {
            window.clearTimeout(timer);
            root.classList.remove('theme-switching');
        };
    }, [scheme, theme]);

    return (
        <ThemeContext.Provider value={{ theme, scheme, setTheme }}>
            {/*
              * `reducedMotion="user"` makes every framer-motion animation in the
              * app honour `prefers-reduced-motion`, matching the 48 media-query
              * blocks the stylesheets already implement — without it, JS-driven
              * motion walked straight past that guard.
              *
              * It lives here rather than in app/layout.tsx because layout.tsx is
              * an async Server Component and framer-motion 12.x ships no
              * `"use client"` directive, so importing MotionConfig there would
              * fail at render. ThemeProvider is the outermost client boundary in
              * the layout, so wrapping here covers the identical subtree.
              */}
            <MotionConfig reducedMotion="user">
                {children}
            </MotionConfig>
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (context === undefined) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}
