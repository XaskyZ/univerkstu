/**
 * `usePresence` + `useTypingIndicator` — frontend bindings for the backend
 * presence/typing in-memory store (see `backend/src/services/presence.ts`).
 *
 * Architecture:
 *   - These hooks do NOT open their own EventSource. They subscribe to the
 *     existing `useSocialStream` connection in the parent component via its
 *     `onEvent` callback. The parent forwards `presence-changed` / `typing`
 *     frames into local state these hooks maintain.
 *   - Why this split? `EventSource` is expensive (one socket per scope set)
 *     and we already open one per chat thread. Duplicating it per indicator
 *     would multiply connections by a factor of 3.
 *
 * Pure helpers live below; both hooks are DOM-coupled (`useState`,
 * `useEffect`, `setTimeout`) and are intentionally not unit-tested directly.
 */
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from './api/core';
import type { SocialStreamEvent } from './use-social-stream';

// === Pure helpers ===========================================================

/**
 * How long (ms) a presence snapshot is considered fresh on the client. Should
 * match the backend `PRESENCE_TTL_MS` so the UI doesn't claim someone is
 * online longer than the server believes. If the latest `presence-changed`
 * frame for a scope is older than this, `isStale === true`.
 */
export const PRESENCE_STALE_MS = 30_000;

/**
 * How long (ms) a single `typing` frame keeps the indicator alive. Matches
 * the backend `TYPING_TTL_MS`. Each frame extends the user's expiry to
 * `startedAt + TYPING_DECAY_MS`.
 */
export const TYPING_DECAY_MS = 5_000;

/**
 * Minimum interval (ms) between two outgoing `setMyTyping(true)` calls. The
 * server already debounces on its own (5s TTL), but throttling on the
 * client side keeps the request rate predictable on key-mashing.
 */
export const TYPING_PING_THROTTLE_MS = 3_000;

/**
 * Compute the deduplicated set of currently-active typing user ids from a
 * mapping of `userId → expiresAt`. `now` is injected for deterministic tests.
 *
 * Pure — no side effects.
 */
export function selectActiveTypers(
    expiries: Readonly<Record<string, number>>,
    now: number = Date.now(),
): string[] {
    const out: string[] = [];
    for (const userId of Object.keys(expiries)) {
        const expiresAt = expiries[userId];
        if (typeof expiresAt === 'number' && expiresAt > now) {
            out.push(userId);
        }
    }
    return out;
}

/**
 * Build the next typing-expiries map after receiving a `typing` frame. Caller
 * is responsible for ignoring frames not addressed to the relevant scope.
 *
 * Pure — returns a new object so `setState` triggers a re-render.
 */
export function reduceTypingExpiries(
    current: Readonly<Record<string, number>>,
    userId: string,
    startedAt: number,
    decayMs: number = TYPING_DECAY_MS,
): Record<string, number> {
    const next: Record<string, number> = { ...current };
    next[userId] = startedAt + decayMs;
    return next;
}

// === usePresence hook =======================================================

export interface UsePresenceOpts {
    /**
     * Latest `presence-changed` frame from the SSE bridge. Pass `null` when
     * the parent hasn't received one yet — the hook then keeps the previous
     * roster but flips `isStale = true` once `PRESENCE_STALE_MS` has elapsed.
     */
    lastEvent: { scope: string; onlineUserIds: string[]; receivedAt: number } | null;
}

export interface UsePresenceResult {
    /** Authoritative set of online users in the watched scope. */
    onlineUserIds: string[];
    /**
     * `true` when the last `presence-changed` frame was received more than
     * `PRESENCE_STALE_MS` ago. The UI should hint that the roster may not be
     * current (typical case: SSE connection dropped).
     */
    isStale: boolean;
}

/**
 * Track presence for a single scope. The parent component is responsible for
 * filtering `presence-changed` frames coming out of `useSocialStream` and
 * forwarding the one matching `scope` via `opts.lastEvent`.
 *
 * Implementation: derives the displayed snapshot directly from the latest
 * prop value during render. Since the parent only updates `lastEvent` when a
 * new frame arrives, the derivation is naturally idempotent. The `now`
 * `useState` is a 1Hz timer that drives the `isStale` calculation only.
 */
export function usePresence(
    scope: string | null,
    opts: UsePresenceOpts,
): UsePresenceResult {
    const [now, setNow] = useState<number>(() => Date.now());

    // 1Hz ticker for `isStale`. Cheap — one timer per mount.
    useEffect(() => {
        if (!scope) return;
        const id = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(id);
    }, [scope]);

    if (!scope || !opts.lastEvent || opts.lastEvent.scope !== scope) {
        return { onlineUserIds: [], isStale: false };
    }
    const isStale = now - opts.lastEvent.receivedAt > PRESENCE_STALE_MS;
    return { onlineUserIds: opts.lastEvent.onlineUserIds, isStale };
}

// === useTypingIndicator hook ================================================

export interface UseTypingIndicatorOpts {
    /**
     * Latest `typing` frame from the SSE bridge, parented in the consumer.
     * Same forwarding model as `usePresence`.
     */
    lastEvent: { scope: string; userId: string; startedAt: number } | null;
}

export interface UseTypingIndicatorResult {
    /** Active typers (last `TYPING_DECAY_MS` of activity). */
    typingUserIds: string[];
    /**
     * Tell the server the local user is (or is not) actively typing. When
     * `active === true`, fires POST /api/v3/social/typing — throttled to one
     * call per `TYPING_PING_THROTTLE_MS`. When `false`, no request is sent;
     * the server-side TTL handles the fade.
     */
    setMyTyping: (active: boolean) => void;
}

/**
 * Track typing indicators for a single scope. Mirrors the parent-forwarding
 * pattern of `usePresence`.
 *
 * Implementation: uses React's documented "adjust state on prop change"
 * pattern (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
 * We keep the expiries map in `useState`, and during render we compare
 * `opts.lastEvent` against the previously-consumed reference. When a new
 * event is detected, we synchronously call `setExpiries` to merge it — React
 * tolerates this during render (no infinite loop since we gate on identity
 * comparison) and the eslint set-state-in-effect rule is satisfied because
 * the update is not in a `useEffect`.
 */
export function useTypingIndicator(
    scope: string | null,
    opts: UseTypingIndicatorOpts,
): UseTypingIndicatorResult {
    const [expiries, setExpiries] = useState<Record<string, number>>({});
    const [trackedScope, setTrackedScope] = useState<string | null>(scope);
    const [consumedEvent, setConsumedEvent] = useState<UseTypingIndicatorOpts['lastEvent']>(null);
    const [now, setNow] = useState<number>(() => Date.now());
    const lastPingRef = useRef<number>(0);

    // Adjust state during render when the scope changes — resets the map so
    // a freshly-opened room does not show stale typers from the previous one.
    // Note: `lastPingRef` is intentionally NOT reset here; the throttle is
    // wall-clock based, so a quick room hop already satisfies it naturally
    // (and writing a ref during render is disallowed by react-hooks/refs).
    if (trackedScope !== scope) {
        setTrackedScope(scope);
        setExpiries({});
        setConsumedEvent(null);
    }
    // Adjust state during render when a new event arrives for our scope.
    // Identity comparison on `opts.lastEvent` — the parent allocates a new
    // object per frame, so reference equality is a reliable "new event"
    // signal.
    else if (scope && opts.lastEvent && opts.lastEvent !== consumedEvent) {
        setConsumedEvent(opts.lastEvent);
        if (opts.lastEvent.scope === scope) {
            const { userId, startedAt } = opts.lastEvent;
            setExpiries((current) => reduceTypingExpiries(current, userId, startedAt));
        }
    }

    // 1Hz ticker — drives the active-typer filter so stale entries fade.
    useEffect(() => {
        if (!scope) return;
        const id = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(id);
    }, [scope]);

    const typingUserIds = scope ? selectActiveTypers(expiries, now) : [];

    const setMyTyping = useCallback((active: boolean) => {
        if (!active || !scope) return;
        const ts = Date.now();
        if (ts - lastPingRef.current < TYPING_PING_THROTTLE_MS) return;
        lastPingRef.current = ts;
        // Fire-and-forget — failure here is a tolerated non-fatal: typing
        // indicators are best-effort UX, not correctness-critical.
        void fetchWithAuth('/api/v3/social/typing', {
            method: 'POST',
            body: JSON.stringify({ scope }),
        }).catch(() => {
            // swallowed — see comment above
        });
    }, [scope]);

    return { typingUserIds, setMyTyping };
}

// === Convenience: pluck-from-stream forwarder ===============================

/**
 * Pure helper for components that already own a `useSocialStream` connection
 * and want a single `onEvent` handler that updates both presence + typing
 * state simultaneously. Returns null for irrelevant frames so the caller can
 * `if (forward) setX(forward)` without re-checking the discriminator.
 *
 * Two-step usage in the parent:
 * ```tsx
 * const [lastPresence, setLastPresence] = useState(null);
 * const [lastTyping, setLastTyping] = useState(null);
 * useSocialStream({
 *   ...,
 *   onEvent: (event) => {
 *     const forwarded = forwardPresenceOrTyping(event);
 *     if (forwarded?.kind === 'presence') setLastPresence(forwarded.payload);
 *     if (forwarded?.kind === 'typing')   setLastTyping(forwarded.payload);
 *   },
 * });
 * ```
 */
export function forwardPresenceOrTyping(
    event: SocialStreamEvent,
): { kind: 'presence'; payload: { scope: string; onlineUserIds: string[]; receivedAt: number } }
    | { kind: 'typing'; payload: { scope: string; userId: string; startedAt: number } }
    | null {
    if (event.type === 'presence-changed') {
        return {
            kind: 'presence',
            payload: {
                scope: event.data.scope,
                onlineUserIds: event.data.onlineUserIds,
                receivedAt: Date.now(),
            },
        };
    }
    if (event.type === 'typing') {
        return {
            kind: 'typing',
            payload: {
                scope: event.data.scope,
                userId: event.data.userId,
                startedAt: event.data.startedAt,
            },
        };
    }
    return null;
}
