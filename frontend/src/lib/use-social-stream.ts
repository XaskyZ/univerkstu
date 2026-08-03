/**
 * `useSocialStream` — frontend SSE client for the universal social bus
 * (`GET /api/v3/social/stream?scopes=...`).
 *
 * Backend contract is documented in `docs/SOCIAL_STORE.md` (SSE section). In
 * short:
 *  - The endpoint emits two named events: `entity-created` and
 *    `comment-created`. Each frame is JSON.
 *  - `:heartbeat` SSE comments arrive every 30s — they keep the connection
 *    alive but are not surfaced to consumers.
 *  - Auth is cookie-based (no bearer header); `EventSource` does not let us
 *    set headers anyway, so we rely on `withCredentials: true`.
 *  - Re-subscribing to a different scope set requires tearing down the
 *    existing `EventSource` and opening a new one — there is no in-flight
 *    subscribe primitive.
 *
 * The hook itself is DOM-coupled and is therefore not unit-tested directly;
 * the pure helpers below (`parseSocialStreamEvent`, `buildStreamUrl`,
 * `computeBackoffMs`) carry the bulk of the test coverage instead.
 *
 * Reconnect strategy:
 *  - `EventSource` already auto-reconnects on transport errors via the
 *    `retry:` directive (defaulting to ~3s). On top of that we layer a
 *    jittered exponential backoff that closes the failing socket and opens
 *    a fresh one after `computeBackoffMs(attempt)` ms, so persistent
 *    failures (auth lapsed, backend rolled, network down) do not hot-loop.
 *  - After `MAX_RECONNECT_ATTEMPTS` consecutive failures the hook gives up
 *    and surfaces `status: 'closed'`. A single retry is scheduled after the
 *    final backoff so brief outages still recover without user input.
 *  - Any successful `open` event resets the attempt counter to 0.
 *
 * Safe fallback:
 *  - When `EventSource` is undefined (older browsers, SSR), the hook stays
 *    in `status: 'idle'` permanently. Polling remains the source of truth.
 *  - When `enabled === false` or `scopes` is empty, no connection is opened
 *    and the status is `'idle'`.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import { API_URL } from './api/core';

// === Event payload types ====================================================

export interface SocialStreamEntityCreatedData {
    id: string;
    kind: string;
    scopeType: string;
    scopeId: string;
    authorUserId: string;
    pinned: boolean;
    createdAt: string;
}

export interface SocialStreamCommentCreatedData {
    id: string;
    entityId: string;
    parentCommentId: string | null;
    authorUserId: string;
    createdAt: string;
    scopeType: string;
    scopeId: string;
    parentEntity: {
        id: string;
        kind: string;
        authorUserId: string;
    };
}

/**
 * Roster snapshot for a single scope. The backend re-broadcasts this whenever
 * a user connects/disconnects (or expires via the janitor sweep). The set is
 * authoritative — clients should overwrite, not merge.
 */
export interface SocialStreamPresenceChangedData {
    scope: string;
    onlineUserIds: string[];
}

/**
 * Typing indicator ping. Each frame represents one user becoming "active" in
 * one scope. The server-side TTL is 5s — the client should expire the
 * indicator locally if no follow-up `typing` frame arrives within that
 * window. `startedAt` is an epoch-ms timestamp the client uses to decay.
 */
export interface SocialStreamTypingData {
    scope: string;
    userId: string;
    startedAt: number;
}

export type SocialStreamEvent =
    | { type: 'entity-created'; data: SocialStreamEntityCreatedData }
    | { type: 'comment-created'; data: SocialStreamCommentCreatedData }
    | { type: 'presence-changed'; data: SocialStreamPresenceChangedData }
    | { type: 'typing'; data: SocialStreamTypingData };

export type SocialStreamEventName = SocialStreamEvent['type'];

export type SocialStreamStatus =
    | 'idle'
    | 'connecting'
    | 'open'
    | 'reconnecting'
    | 'closed';

export interface UseSocialStreamOpts {
    /** Scope keys like `group:abc`, `dm:room1`, `global:chat`. */
    scopes: string[];
    /** Gate the connection (e.g. feature flag). Defaults to `true`. */
    enabled?: boolean;
    /** Fires for every business frame after JSON parse + minimal validation. */
    onEvent?: (event: SocialStreamEvent) => void;
}

export interface UseSocialStreamResult {
    status: SocialStreamStatus;
    /** `performance.now()`-style timestamp of the last frame, or null. */
    lastEventAt: number | null;
}

// === Pure helpers ===========================================================

/**
 * Maximum scope count enforced server-side; we mirror it client-side so
 * `buildStreamUrl` can dedupe + bound up front without bouncing off a 400.
 */
export const MAX_STREAM_SCOPES = 64;

/**
 * Maximum consecutive failed connect attempts before we settle into the
 * `closed` state. The final attempt still schedules one more retry after the
 * (capped) backoff so brief outages eventually heal.
 */
export const MAX_RECONNECT_ATTEMPTS = 5;

const BACKOFF_BASE_MS = 1000;
const BACKOFF_FACTOR = 2;
const BACKOFF_MAX_MS = 30_000;

const ALLOWED_SCOPE_TYPES = new Set(['group', 'dm', 'global', 'announcement']);

/**
 * JSON.parse + minimal shape guard for an `entity-created` / `comment-created`
 * frame. Returns `null` on any parse error or missing required field so the
 * hook can skip the frame without throwing into the SSE event loop.
 *
 * Exported as a pure helper so the validation surface is unit-testable apart
 * from the DOM-coupled hook.
 */
export function parseSocialStreamEvent(
    rawData: string,
): Record<string, unknown> | null {
    if (typeof rawData !== 'string' || rawData.length === 0) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawData);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj.id !== 'string' || obj.id.length === 0) return null;
    return obj;
}

/**
 * Lighter-weight parser that does NOT require an `id` field. `presence-changed`
 * and `typing` frames are keyed on `scope` instead — the upstream helper
 * `parseSocialStreamEvent` would reject them.
 *
 * Returns `null` on any JSON parse error or non-object payload. Per-frame
 * shape validation is delegated to `toPresenceChangedEvent` / `toTypingEvent`.
 */
export function parseSocialStreamPayload(
    rawData: string,
): Record<string, unknown> | null {
    if (typeof rawData !== 'string' || rawData.length === 0) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(rawData);
    } catch {
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
}

/**
 * Normalize a scope list:
 *  - drop empty / whitespace-only entries
 *  - drop entries with no `type:id` shape
 *  - drop entries whose type is not in the allowed set
 *  - dedupe (case-sensitive on id)
 *  - sort ASC so query string is stable across re-renders (helps the
 *    `useEffect` dependency check avoid spurious reconnects)
 *  - cap at `MAX_STREAM_SCOPES`
 *
 * Pure — no side effects, exported for unit testing.
 */
export function normalizeScopes(scopes: string[]): string[] {
    if (!Array.isArray(scopes)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of scopes) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        const colonIdx = trimmed.indexOf(':');
        if (colonIdx <= 0 || colonIdx === trimmed.length - 1) continue;
        const type = trimmed.slice(0, colonIdx);
        if (!ALLOWED_SCOPE_TYPES.has(type)) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        out.push(trimmed);
    }
    out.sort();
    if (out.length > MAX_STREAM_SCOPES) out.length = MAX_STREAM_SCOPES;
    return out;
}

/**
 * Build the absolute SSE URL the hook will pass to `new EventSource(...)`.
 * Normalizes the scope list (sort + dedupe + cap), then URL-encodes the
 * comma-joined query value.
 *
 * Returns an empty string when the resulting scope list is empty — callers
 * use that signal to skip opening a connection.
 */
export function buildStreamUrl(scopes: string[], apiUrl: string = API_URL): string {
    const normalized = normalizeScopes(scopes);
    if (normalized.length === 0) return '';
    const joined = normalized.join(',');
    return `${apiUrl}/api/v3/social/stream?scopes=${encodeURIComponent(joined)}`;
}

/**
 * Compute backoff for the Nth reconnect attempt (zero-indexed). The formula
 * is `min(BASE * FACTOR^attempt, MAX) * (0.5 + random()/2)` — i.e. between
 * 50% and 100% of the exponential value, capped at 30s.
 *
 * The jitter prevents a fleet of tabs that just lost backend connectivity
 * from all reconnecting in lockstep.
 *
 * Exported for unit testing — tests stub `Math.random` to get deterministic
 * boundaries.
 */
export function computeBackoffMs(attempt: number): number {
    const safeAttempt = Math.max(0, Math.floor(attempt));
    const exponential = BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, safeAttempt);
    const capped = Math.min(exponential, BACKOFF_MAX_MS);
    // 50% .. 100% of `capped` — keeps the lower bound meaningful so a long
    // outage still re-pings at a reasonable rate, and the upper bound at
    // BACKOFF_MAX_MS.
    const jittered = capped * (0.5 + Math.random() * 0.5);
    return Math.floor(jittered);
}

// === Internal: validators for the typed event payloads ======================

function isEntityCreatedData(
    obj: Record<string, unknown>,
): boolean {
    return (
        typeof obj.id === 'string'
        && typeof obj.kind === 'string'
        && typeof obj.scopeType === 'string'
        && typeof obj.scopeId === 'string'
        && typeof obj.authorUserId === 'string'
        && typeof obj.pinned === 'boolean'
        && typeof obj.createdAt === 'string'
    );
}

function isCommentCreatedData(
    obj: Record<string, unknown>,
): boolean {
    if (
        typeof obj.id !== 'string'
        || typeof obj.entityId !== 'string'
        || typeof obj.authorUserId !== 'string'
        || typeof obj.createdAt !== 'string'
        || typeof obj.scopeType !== 'string'
        || typeof obj.scopeId !== 'string'
    ) {
        return false;
    }
    // `parentCommentId` is `string | null`
    if (obj.parentCommentId !== null && typeof obj.parentCommentId !== 'string') {
        return false;
    }
    const parent = obj.parentEntity;
    if (!parent || typeof parent !== 'object' || Array.isArray(parent)) return false;
    const p = parent as Record<string, unknown>;
    return (
        typeof p.id === 'string'
        && typeof p.kind === 'string'
        && typeof p.authorUserId === 'string'
    );
}

/**
 * `presence-changed` frame validator. We deliberately accept an empty
 * `onlineUserIds` array — it's the canonical "everyone disconnected" signal
 * the server sends after the last subscriber leaves a scope.
 *
 * Unlike `entity-created` and `comment-created`, this frame does NOT carry an
 * `id` field — the canonical key is the scope itself. We loosen the
 * `parseSocialStreamEvent` constraint here because that helper hard-requires
 * a non-empty `id`.
 */
function isPresenceChangedData(obj: Record<string, unknown>): boolean {
    if (typeof obj.scope !== 'string' || obj.scope.length === 0) return false;
    if (!Array.isArray(obj.onlineUserIds)) return false;
    return obj.onlineUserIds.every((value) => typeof value === 'string');
}

/**
 * `typing` frame validator. `startedAt` is a finite millisecond timestamp.
 */
function isTypingData(obj: Record<string, unknown>): boolean {
    return (
        typeof obj.scope === 'string'
        && obj.scope.length > 0
        && typeof obj.userId === 'string'
        && obj.userId.length > 0
        && typeof obj.startedAt === 'number'
        && Number.isFinite(obj.startedAt)
    );
}

/**
 * Type-guarded promote of a parsed payload to an `entity-created` event.
 * Returns null if any required field is missing or mistyped.
 */
export function toEntityCreatedEvent(
    parsed: Record<string, unknown> | null,
):
    | { type: 'entity-created'; data: SocialStreamEntityCreatedData }
    | null {
    if (!parsed) return null;
    if (!isEntityCreatedData(parsed)) return null;
    return {
        type: 'entity-created',
        data: parsed as unknown as SocialStreamEntityCreatedData,
    };
}

/**
 * Type-guarded promote of a parsed payload to a `comment-created` event.
 * Returns null if any required field is missing or mistyped.
 */
export function toCommentCreatedEvent(
    parsed: Record<string, unknown> | null,
):
    | { type: 'comment-created'; data: SocialStreamCommentCreatedData }
    | null {
    if (!parsed) return null;
    if (!isCommentCreatedData(parsed)) return null;
    return {
        type: 'comment-created',
        data: parsed as unknown as SocialStreamCommentCreatedData,
    };
}

/**
 * Type-guarded promote of a parsed payload to a `presence-changed` event.
 * Returns null if `scope` or `onlineUserIds` is missing/mistyped.
 */
export function toPresenceChangedEvent(
    parsed: Record<string, unknown> | null,
):
    | { type: 'presence-changed'; data: SocialStreamPresenceChangedData }
    | null {
    if (!parsed) return null;
    if (!isPresenceChangedData(parsed)) return null;
    return {
        type: 'presence-changed',
        data: parsed as unknown as SocialStreamPresenceChangedData,
    };
}

/**
 * Type-guarded promote of a parsed payload to a `typing` event. Returns null
 * if any of `scope`/`userId`/`startedAt` is missing or mistyped.
 */
export function toTypingEvent(
    parsed: Record<string, unknown> | null,
):
    | { type: 'typing'; data: SocialStreamTypingData }
    | null {
    if (!parsed) return null;
    if (!isTypingData(parsed)) return null;
    return {
        type: 'typing',
        data: parsed as unknown as SocialStreamTypingData,
    };
}

// === Hook ===================================================================

export function useSocialStream(opts: UseSocialStreamOpts): UseSocialStreamResult {
    const { scopes, enabled = true, onEvent } = opts;
    // `connectionStatus` only tracks states that exist while the effect is
    // actively trying to maintain a connection (`connecting`, `open`,
    // `reconnecting`, `closed`). The public `status` is derived below so that
    // disabled / empty-scope / SSR cases collapse to `'idle'` without
    // triggering a setState-in-effect cascade for the bail paths.
    const [connectionStatus, setConnectionStatus] = useState<SocialStreamStatus>('idle');
    const [lastEventAt, setLastEventAt] = useState<number | null>(null);

    // Keep the latest `onEvent` callback in a ref so we don't tear down the
    // `EventSource` every time the parent rerenders with a fresh function
    // identity. The effect only depends on stable inputs (url + enabled).
    const onEventRef = useRef<UseSocialStreamOpts['onEvent']>(onEvent);
    useEffect(() => {
        onEventRef.current = onEvent;
    }, [onEvent]);

    // Normalize once per scope-array identity change so the URL string we use
    // as the dep key is stable. The helper is pure so this is safe across
    // renders that pass a fresh array with the same contents.
    const url = buildStreamUrl(scopes);
    const supported = typeof window !== 'undefined' && typeof window.EventSource !== 'undefined';
    // `shouldConnect` collects every "no connection" guard into a single
    // boolean. The effect below becomes a no-op when this is false, so the
    // public status is derived (no setState-in-effect needed for the bail
    // paths — eslint-plugin-react `set-state-in-effect` enforces this).
    const shouldConnect = enabled && url.length > 0 && supported;

    useEffect(() => {
        if (!shouldConnect) {
            return;
        }

        let cancelled = false;
        let eventSource: EventSource | null = null;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let attempt = 0;

        const handleParsed = (
            event: SocialStreamEvent | null,
        ) => {
            if (!event) return;
            setLastEventAt(Date.now());
            try {
                onEventRef.current?.(event);
            } catch (err) {
                // Don't let a consumer throw kill the stream. We log so the
                // problem is visible in devtools but the EventSource lives on.
                if (process.env.NODE_ENV !== 'production') {
                    console.error('[useSocialStream] onEvent callback threw:', err);
                }
            }
        };

        const open = () => {
            if (cancelled) return;
            setConnectionStatus(attempt === 0 ? 'connecting' : 'reconnecting');

            try {
                eventSource = new window.EventSource(url, { withCredentials: true });
            } catch (err) {
                if (process.env.NODE_ENV !== 'production') {
                    console.warn('[useSocialStream] failed to construct EventSource:', err);
                }
                scheduleRetry();
                return;
            }

            eventSource.addEventListener('open', () => {
                if (cancelled) return;
                attempt = 0;
                setConnectionStatus('open');
            });

            eventSource.addEventListener('entity-created', (evt: MessageEvent) => {
                handleParsed(toEntityCreatedEvent(parseSocialStreamEvent(evt.data)));
            });

            eventSource.addEventListener('comment-created', (evt: MessageEvent) => {
                handleParsed(toCommentCreatedEvent(parseSocialStreamEvent(evt.data)));
            });

            // presence-changed / typing frames don't carry an `id`, so they go
            // through the looser `parseSocialStreamPayload` instead of the
            // entity/comment-only `parseSocialStreamEvent`.
            eventSource.addEventListener('presence-changed', (evt: MessageEvent) => {
                handleParsed(toPresenceChangedEvent(parseSocialStreamPayload(evt.data)));
            });

            eventSource.addEventListener('typing', (evt: MessageEvent) => {
                handleParsed(toTypingEvent(parseSocialStreamPayload(evt.data)));
            });

            eventSource.addEventListener('error', () => {
                if (cancelled) return;
                // `EventSource` auto-reconnects on its own; we layer our own
                // jittered backoff on top so persistent failures (401, 5xx,
                // backend restart) don't hot-loop. Tear the dead socket down
                // so the next reconnect attempt opens a fresh one with a
                // fresh cookie/credentials roundtrip.
                if (eventSource) {
                    eventSource.close();
                    eventSource = null;
                }
                setConnectionStatus('reconnecting');
                scheduleRetry();
            });
        };

        const scheduleRetry = () => {
            if (cancelled) return;
            const delay = computeBackoffMs(attempt);
            attempt += 1;
            if (attempt > MAX_RECONNECT_ATTEMPTS) {
                // Schedule one final attempt after the (already capped) delay
                // — after that we surface `closed` and stop spinning.
                setConnectionStatus('closed');
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    if (cancelled) return;
                    attempt = 0;
                    open();
                }, delay);
                return;
            }
            reconnectTimer = setTimeout(() => {
                reconnectTimer = null;
                if (cancelled) return;
                open();
            }, delay);
        };

        open();

        return () => {
            cancelled = true;
            if (reconnectTimer !== null) {
                clearTimeout(reconnectTimer);
                reconnectTimer = null;
            }
            if (eventSource) {
                eventSource.close();
                eventSource = null;
            }
            // Reset to `'idle'` so a remount with `shouldConnect=true` does
            // not flash a stale `'open'` before the next `open()` call runs.
            setConnectionStatus('idle');
        };
    }, [url, shouldConnect]);

    // Derive the public status: when we're not actively connecting (disabled,
    // empty scopes, SSR / unsupported browser), force `'idle'` regardless of
    // the stale `connectionStatus` value. Otherwise surface whatever the
    // effect last set it to.
    const status: SocialStreamStatus = shouldConnect ? connectionStatus : 'idle';

    return { status, lastEventAt };
}
