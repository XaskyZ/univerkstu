'use client';

import { useCallback, useEffect, useState } from 'react';

const PARITY_MODE_KEY = 'schedule-parity-mode';
const PARITY_MANUAL_AT_KEY = 'schedule-parity-manual-at';
const PARITY_AUTO_SYNC_AFTER_MS = 60 * 60 * 1000;

export type ParityMode = 'num' | 'den';

/**
 * Parity mode (numerator/denominator) with two behaviors:
 *
 * 1. Manual override — user clicks the toggle, choice persists for 1 hour.
 * 2. Auto-sync — after 1 hour without manual interaction, the mode falls
 *    back to whatever the academic-context says is currently active.
 */
export function useScheduleParity(currentParityFromContext: ParityMode, currentTimestamp: number) {
    const [parityMode, setParityMode] = useState<ParityMode>(() => {
        if (typeof window === 'undefined') return currentParityFromContext;
        const savedMode = localStorage.getItem(PARITY_MODE_KEY);
        const manualAt = Number(localStorage.getItem(PARITY_MANUAL_AT_KEY) || '0');
        const canKeepManual = Number.isFinite(manualAt) && manualAt > 0 && Date.now() - manualAt < PARITY_AUTO_SYNC_AFTER_MS;
        if (canKeepManual && (savedMode === 'num' || savedMode === 'den')) {
            return savedMode;
        }
        return currentParityFromContext;
    });

    const setParityModeManual = useCallback((nextMode: ParityMode) => {
        setParityMode(nextMode);
        if (typeof window !== 'undefined') {
            localStorage.setItem(PARITY_MODE_KEY, nextMode);
            localStorage.setItem(PARITY_MANUAL_AT_KEY, String(Date.now()));
        }
    }, []);

    useEffect(() => {
        localStorage.setItem(PARITY_MODE_KEY, parityMode);
    }, [parityMode]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const manualAt = Number(localStorage.getItem(PARITY_MANUAL_AT_KEY) || '0');
        const shouldAutoSync = !Number.isFinite(manualAt)
            || manualAt <= 0
            || (currentTimestamp - manualAt >= PARITY_AUTO_SYNC_AFTER_MS);

        if (!shouldAutoSync) return;
        if (parityMode === currentParityFromContext) return;

        const syncTimer = window.setTimeout(() => {
            setParityMode(currentParityFromContext);
            localStorage.setItem(PARITY_MODE_KEY, currentParityFromContext);
        }, 0);

        return () => window.clearTimeout(syncTimer);
    }, [currentTimestamp, parityMode, currentParityFromContext]);

    return { parityMode, setParityMode: setParityModeManual };
}
