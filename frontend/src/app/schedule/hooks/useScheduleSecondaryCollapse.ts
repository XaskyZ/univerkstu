'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'schedule-hide-secondary:v1';

/**
 * Owns the "hide the regular class schedule during session mode" state.
 *
 * Behaviour:
 * - Default `true` (collapsed) when no stored value exists — during session
 *   mode the regular schedule is secondary, so we keep it hidden by default.
 * - Persists across reloads via `localStorage` (key: `schedule-hide-secondary:v1`).
 * - Lazy initialiser is SSR-safe (returns the default on the server).
 */
export function useScheduleSecondaryCollapse() {
    const [collapsed, setCollapsedState] = useState<boolean>(() => {
        if (typeof window === 'undefined') return true;
        try {
            const saved = window.localStorage.getItem(STORAGE_KEY);
            if (saved === 'true') return true;
            if (saved === 'false') return false;
        } catch {
            // localStorage may be unavailable (private mode, etc.); fall through.
        }
        return true;
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.localStorage.setItem(STORAGE_KEY, collapsed ? 'true' : 'false');
        } catch {
            // Ignore quota / access errors — the toggle still works in-memory.
        }
    }, [collapsed]);

    const setCollapsed = useCallback((next: boolean) => {
        setCollapsedState(next);
    }, []);

    const toggle = useCallback(() => {
        setCollapsedState((prev) => !prev);
    }, []);

    return { collapsed, toggle, setCollapsed };
}
