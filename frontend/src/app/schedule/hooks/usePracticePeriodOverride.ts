'use client';

import { useCallback, useEffect, useState } from 'react';

export type PracticeChoice = 'practice' | 'vacation';

const STORAGE_PREFIX = 'schedule-practice-choice:v1:';

/**
 * Per-student override for the plan-wide "Практика" period.
 *
 * The academic calendar is per learning-plan, so it lists a "Практика" period
 * for everyone on that plan — it cannot tell whether *this* student actually
 * does practice or is on vacation during that window. This hook lets the
 * student say which one applies and remembers it.
 *
 * - Scoped per semester (`semesterKey`) so the choice resets each new semester
 *   instead of leaking a stale answer into the next practice window.
 * - Persisted in `localStorage`; no backend, no new env/tokens.
 * - Pass `semesterKey = null` (e.g. when not in a practice period) to disable.
 *
 * Hydration runs in a `setTimeout(…, 0)` effect — mirroring the schedule page's
 * cache hydration — so the lazy initializer stays SSR-safe and we don't trip
 * `react-hooks/set-state-in-effect`.
 */
export function usePracticePeriodOverride(semesterKey: string | null) {
    const storageKey = semesterKey ? `${STORAGE_PREFIX}${semesterKey}` : null;
    const [choice, setChoiceState] = useState<PracticeChoice | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined' || !storageKey) {
            return;
        }
        const timer = window.setTimeout(() => {
            try {
                const saved = window.localStorage.getItem(storageKey);
                setChoiceState(saved === 'practice' || saved === 'vacation' ? saved : null);
            } catch {
                // localStorage unavailable (private mode, etc.) — stay at default.
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [storageKey]);

    const setChoice = useCallback((next: PracticeChoice) => {
        setChoiceState(next);
        if (typeof window === 'undefined' || !storageKey) return;
        try {
            window.localStorage.setItem(storageKey, next);
        } catch {
            // Ignore quota/access errors — the toggle still works in-memory.
        }
    }, [storageKey]);

    return { choice, setChoice };
}
