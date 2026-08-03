/**
 * `useSocialUnread` — viewer-scoped unread badge driver for the universal
 * social store.
 *
 * Mirrors the `getSocialUnreadCounts` REST endpoint (`/api/v3/social/unread`)
 * over a polling cursor with a simple incremental-event fast path:
 *
 *   - Initial fetch on mount and on every `scopes` change.
 *   - Periodic refresh every 30s while mounted (suspended when the document
 *     is hidden, restored on visibility change — saves polling cost when the
 *     tab is in the background).
 *   - Optimistic `bumpScope(scopeKey)` lets the caller increment a count
 *     locally when an SSE entity-created event lands for a scope the viewer
 *     is subscribed to (and the author is not the viewer). The next polling
 *     cycle authoritatively reconciles the count, so any drift converges
 *     within 30s.
 *   - `refresh()` is exposed so callers can drive a manual reconcile after a
 *     burst of events without waiting on the timer.
 *
 * The hook stays cheap: when `scopes` is empty it skips the network call and
 * returns an empty map. When unmounted it tears down the timer + visibility
 * listener cleanly.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSocialUnreadCounts } from './api/social';

export interface UseSocialUnreadResult {
    counts: Map<string, number>;
    refresh: () => Promise<void>;
    /**
     * Optimistically increment the count for `scopeKey`. Used by SSE bridges
     * when an entity-created event lands for a scope the viewer cares about
     * and the event's author is not the viewer. The next polling cycle will
     * authoritatively reconcile.
     */
    bumpScope: (scopeKey: string) => void;
    /**
     * Optimistically clear the count for `scopeKey` — used right after the
     * caller has invoked `markScopeAsRead` so the badge disappears without
     * waiting for the next poll.
     */
    clearScope: (scopeKey: string) => void;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;

export interface UseSocialUnreadOptions {
    /**
     * Override the polling interval. Defaults to 30s; tests can pass a smaller
     * number through fake timers without forcing a real-time wait.
     */
    intervalMs?: number;
    /**
     * Suspend polling entirely. Used when the caller wants control over when
     * fetches happen (e.g. tests, embed contexts without the SSE bridge).
     */
    enabled?: boolean;
}

/**
 * Pure helper exported for tests — derives the next counts map from the
 * authoritative response. Zero entries are dropped to match the backend
 * contract; callers always treat a missing key as 0.
 */
export function buildCountsMap(
    raw: Record<string, number> | null | undefined,
): Map<string, number> {
    const map = new Map<string, number>();
    if (!raw) return map;
    for (const [key, value] of Object.entries(raw)) {
        const count = Number(value);
        if (Number.isFinite(count) && count > 0) {
            map.set(key, Math.floor(count));
        }
    }
    return map;
}

/**
 * Format a count for the round badge. Caps display at "99+" so the badge
 * footprint stays predictable across themes. Returns null for zero/invalid
 * so the caller can omit the element entirely.
 */
export function formatUnreadBadge(count: number | undefined | null): string | null {
    if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return null;
    if (count > 99) return '99+';
    return String(Math.floor(count));
}

export function useSocialUnread(
    scopes: string[],
    options: UseSocialUnreadOptions = {},
): UseSocialUnreadResult {
    const { intervalMs = DEFAULT_POLL_INTERVAL_MS, enabled = true } = options;
    const [counts, setCounts] = useState<Map<string, number>>(() => new Map());

    // Stable, sorted, deduped scope key so we can use it as a dep. Sorting
    // makes the dep stable across caller-side re-orderings of the array.
    const scopesKey = useMemo(() => {
        const deduped = Array.from(new Set((scopes || []).filter((s) => typeof s === 'string' && s.length > 0)));
        deduped.sort();
        return deduped.join(',');
    }, [scopes]);

    // We snapshot the scope array at fetch time so a stale fetch resolving
    // late does not overwrite a fresh `scopes` change. Updated inside an
    // effect (not render) to satisfy react-hooks/refs.
    const lastScopesRef = useRef<string>('');
    useEffect(() => {
        lastScopesRef.current = scopesKey;
    }, [scopesKey]);

    const refresh = useCallback(async (): Promise<void> => {
        if (!enabled) return;
        const requestKey = scopesKey;
        const scopesArr = requestKey ? requestKey.split(',') : [];
        if (scopesArr.length === 0) {
            // Empty scopes → empty counts. Skip network.
            setCounts((prev) => (prev.size === 0 ? prev : new Map()));
            return;
        }
        const response = await getSocialUnreadCounts(scopesArr);
        // Discard stale responses (the user switched scopes mid-fetch).
        if (lastScopesRef.current !== requestKey) return;
        if (!response.success || !response.data) {
            // Soft failure — keep last known counts. Polling will retry shortly.
            return;
        }
        const next = buildCountsMap(response.data.counts);
        setCounts(next);
    }, [enabled, scopesKey]);

    // Initial + on-scopes-change fetch. Wrapped in a setTimeout(0) tick to
    // keep the setState async — eslint flags the synchronous setState branch
    // inside `refresh` as a cascading-render risk; deferring by a microtask
    // is the convention other hooks in this codebase use (see
    // `useDmMessagesSocial`).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const timer = window.setTimeout(() => { void refresh(); }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    // Periodic poll, paused while the tab is hidden.
    useEffect(() => {
        if (!enabled) return;
        if (typeof window === 'undefined') return;
        if (intervalMs <= 0) return;

        let timer: ReturnType<typeof setInterval> | null = null;
        const start = (): void => {
            if (timer !== null) return;
            timer = setInterval(() => { void refresh(); }, intervalMs);
        };
        const stop = (): void => {
            if (timer !== null) {
                clearInterval(timer);
                timer = null;
            }
        };
        const onVisibility = (): void => {
            if (typeof document === 'undefined') return;
            if (document.hidden) stop();
            else { void refresh(); start(); }
        };

        if (typeof document === 'undefined' || !document.hidden) start();
        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', onVisibility);
        }

        return () => {
            stop();
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', onVisibility);
            }
        };
    }, [enabled, intervalMs, refresh]);

    const bumpScope = useCallback((scopeKey: string) => {
        if (!scopeKey || typeof scopeKey !== 'string') return;
        setCounts((prev) => {
            const next = new Map(prev);
            next.set(scopeKey, (next.get(scopeKey) ?? 0) + 1);
            return next;
        });
    }, []);

    const clearScope = useCallback((scopeKey: string) => {
        if (!scopeKey || typeof scopeKey !== 'string') return;
        setCounts((prev) => {
            if (!prev.has(scopeKey)) return prev;
            const next = new Map(prev);
            next.delete(scopeKey);
            return next;
        });
    }, []);

    return { counts, refresh, bumpScope, clearScope };
}
