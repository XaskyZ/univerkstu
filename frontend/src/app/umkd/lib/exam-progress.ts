'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Local-only progress tracker for UMKD exam-question files.
 *
 * Stores a flat map of `{ fileId: { reviewedAt: ISO string } }` in
 * `localStorage` under `umkd_exam_progress_v1`. There's no server sync — the
 * checkmark lives on the device.
 *
 * The key is intentionally suffixed with `_v1` so a future shape change can
 * coexist with the old data instead of overwriting it.
 */

export const EXAM_PROGRESS_STORAGE_KEY = 'umkd_exam_progress_v1';

export type ExamProgressMap = Record<string, { reviewedAt: string }>;

function readStorage(): ExamProgressMap {
    if (typeof window === 'undefined') return {};
    try {
        const raw = window.localStorage.getItem(EXAM_PROGRESS_STORAGE_KEY);
        if (!raw) return {};
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        const out: ExamProgressMap = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (!key) continue;
            if (
                value
                && typeof value === 'object'
                && !Array.isArray(value)
                && typeof (value as { reviewedAt?: unknown }).reviewedAt === 'string'
            ) {
                out[key] = { reviewedAt: (value as { reviewedAt: string }).reviewedAt };
            }
        }
        return out;
    } catch {
        return {};
    }
}

function writeStorage(map: ExamProgressMap): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(EXAM_PROGRESS_STORAGE_KEY, JSON.stringify(map));
    } catch {
        // Swallow quota / private-mode errors — progress is best-effort.
    }
}

// Module-level subscribers so the React hook can react to mutations triggered
// from anywhere in the app (e.g. another tab via the `storage` event, or a
// sibling component calling `markReviewed` directly).
type Listener = () => void;
const listeners = new Set<Listener>();

function emit(): void {
    for (const listener of listeners) {
        try {
            listener();
        } catch {
            // ignore listener errors so one bad subscriber can't break others
        }
    }
}

export function getProgress(): ExamProgressMap {
    return readStorage();
}

export function isReviewed(fileId: string): boolean {
    if (!fileId) return false;
    return Boolean(readStorage()[fileId]);
}

export function markReviewed(fileId: string): void {
    if (!fileId) return;
    const current = readStorage();
    current[fileId] = { reviewedAt: new Date().toISOString() };
    writeStorage(current);
    emit();
}

export function unmarkReviewed(fileId: string): void {
    if (!fileId) return;
    const current = readStorage();
    if (!(fileId in current)) return;
    delete current[fileId];
    writeStorage(current);
    emit();
}

export function getSubjectProgress(fileIds: string[]): { done: number; total: number } {
    const map = readStorage();
    const total = fileIds.length;
    let done = 0;
    for (const id of fileIds) {
        if (id && map[id]) done += 1;
    }
    return { done, total };
}

/**
 * React hook that surfaces the reviewed state for a known set of file IDs.
 *
 * - `progress[fileId]` is `true` when the file is marked reviewed
 * - `summary` is the `{ done, total }` count across the supplied IDs
 * - `toggle(fileId)` flips the reviewed state (and persists)
 *
 * Re-renders on local mutations and cross-tab `storage` events.
 */
export function useExamProgress(fileIds: string[]): {
    progress: Record<string, boolean>;
    summary: { done: number; total: number };
    toggle: (fileId: string) => void;
} {
    // Stable string key so the effect only re-subscribes when the *set* of IDs
    // changes, not when the parent re-renders with a fresh array reference.
    const idsKey = useMemo(() => fileIds.join('|'), [fileIds]);
    const [, setTick] = useState(0);

    useEffect(() => {
        const onChange: Listener = () => setTick((t) => t + 1);
        listeners.add(onChange);
        const onStorage = (event: StorageEvent) => {
            if (event.key === EXAM_PROGRESS_STORAGE_KEY) onChange();
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('storage', onStorage);
        }
        return () => {
            listeners.delete(onChange);
            if (typeof window !== 'undefined') {
                window.removeEventListener('storage', onStorage);
            }
        };
    }, []);

    const map = useMemo(() => readStorage(), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps
    // ^ also re-reads whenever the set of IDs changes; for in-tab mutations the
    //   force re-render from the listener + the fresh closure below handles it.

    const progress = useMemo<Record<string, boolean>>(() => {
        const out: Record<string, boolean> = {};
        const fresh = readStorage();
        for (const id of fileIds) {
            if (!id) continue;
            out[id] = Boolean(fresh[id]);
        }
        return out;
    // We deliberately re-derive on every render so a local mutation followed
    // by a forced re-tick produces fresh values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey, map]);

    const summary = useMemo(() => {
        const fresh = readStorage();
        let done = 0;
        for (const id of fileIds) {
            if (id && fresh[id]) done += 1;
        }
        return { done, total: fileIds.length };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey, map]);

    const toggle = useCallback((fileId: string) => {
        if (!fileId) return;
        if (isReviewed(fileId)) {
            unmarkReviewed(fileId);
        } else {
            markReviewed(fileId);
        }
    }, []);

    return { progress, summary, toggle };
}
