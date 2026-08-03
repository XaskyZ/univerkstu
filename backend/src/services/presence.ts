/**
 * Presence + typing in-memory storage.
 *
 * Presence and typing are intentionally NOT persisted to Postgres — both are
 * extremely write-hot signals (one heartbeat per active user every ~10s,
 * one typing ping per keystroke burst) and Postgres is the wrong tool for
 * a single-instance ephemeral fan-out. A `Map` in-process is good enough on
 * a single-instance Heroku/Railway deploy. If/when we scale horizontally,
 * the right next step is Redis pub/sub, not a SQL table.
 *
 * Design notes:
 *   - `presenceMap`: keyed by `userId`. Each entry tracks the last heartbeat
 *     time and the scope set the user is "in". Lookup by scope (one of the
 *     hot paths used by `getPresentUserIds`) walks the whole map — that's
 *     fine at our expected concurrency (≤ a few hundred connected users).
 *   - `typingMap`: keyed by `${scope}|${userId}` because typing is a per-pair
 *     fact. TTL 5s — anything longer surfaces stale "печатает..." indicators
 *     after the user has clearly stopped.
 *
 * Lifecycle:
 *   - `markUserPresent(userId, scopes)` is called on SSE connect and from a
 *     periodic heartbeat refresh inside `social-stream.ts`.
 *   - `removeUserPresence(userId)` is called on SSE disconnect.
 *   - `markTyping(userId, scope)` is called from the POST /typing endpoint.
 *   - `startPresenceJanitor()` runs every 10s and prunes both expired
 *     presence entries (no heartbeat in 30s) and expired typing entries
 *     (started more than 5s ago). The janitor itself is `.unref()`ed so it
 *     never blocks process exit during test teardown.
 */

import { EventEmitter } from 'node:events';

// === Types ==================================================================

export interface PresenceState {
    /** epoch ms of the last heartbeat for this user. */
    lastSeenAt: number;
    /** canonical scope keys (e.g. `group:abc`, `dm:room1`) the user is in. */
    scopes: Set<string>;
}

export interface TypingState {
    /** epoch ms when typing started. Refreshed on every `markTyping` call. */
    startedAt: number;
}

// === Constants ==============================================================

/** Anything not heartbeating for 30s is considered offline. */
export const PRESENCE_TTL_MS = 30_000;

/** Typing indicators fade after 5s of silence (matches Telegram-like UX). */
export const TYPING_TTL_MS = 5_000;

/** Janitor cadence — must be < PRESENCE_TTL_MS / 3 to keep cleanup snappy. */
export const PRESENCE_JANITOR_INTERVAL_MS = 10_000;

// === In-memory stores =======================================================

export const presenceMap = new Map<string, PresenceState>();
export const typingMap = new Map<string, TypingState>();

/**
 * Cross-cutting bus for presence/typing changes. The SSE route subscribes to
 * `presence-changed` and re-emits matching events per connected client. The
 * janitor uses this to broadcast offline transitions.
 */
export const presenceEvents = new EventEmitter();

// === Helpers ================================================================

/** Build the typing-map key — kept private so callers cannot drift on format. */
function typingKey(userId: string, scope: string): string {
    return `${scope}|${userId}`;
}

/**
 * Mark `userId` present (or refresh their heartbeat) and (re)bind the set of
 * scopes they are currently subscribed to. Returns the set of scopes whose
 * online-user-list changed as a result — callers use this to decide which
 * `presence-changed` events to emit.
 *
 * Behavior:
 *   - First call (no prior entry) — every scope is "new", so all are returned.
 *   - Subsequent call with the SAME scope set — only `lastSeenAt` is bumped;
 *     no scope is returned (no one's view changed).
 *   - Subsequent call with a DIFFERENT scope set — the symmetric difference
 *     between old and new scopes is returned (added + removed scopes).
 */
export function markUserPresent(userId: string, scopes: readonly string[]): string[] {
    if (typeof userId !== 'string' || userId.length === 0) return [];
    const now = Date.now();
    const incoming = new Set<string>();
    for (const scope of scopes) {
        if (typeof scope === 'string' && scope.length > 0) {
            incoming.add(scope);
        }
    }

    const prev = presenceMap.get(userId);
    if (!prev) {
        presenceMap.set(userId, { lastSeenAt: now, scopes: incoming });
        return Array.from(incoming);
    }

    // Refresh timestamp regardless of scope changes.
    prev.lastSeenAt = now;

    const changed: string[] = [];
    // Newly added scopes — user just appeared in them.
    for (const scope of incoming) {
        if (!prev.scopes.has(scope)) changed.push(scope);
    }
    // Removed scopes — user just left them.
    for (const scope of prev.scopes) {
        if (!incoming.has(scope)) changed.push(scope);
    }
    prev.scopes = incoming;
    return changed;
}

/**
 * Remove a user from the presence map entirely (called on SSE disconnect).
 * Returns the set of scopes the user was in so the caller can fan out
 * `presence-changed` events.
 */
export function removeUserPresence(userId: string): string[] {
    const prev = presenceMap.get(userId);
    if (!prev) return [];
    presenceMap.delete(userId);
    return Array.from(prev.scopes);
}

/**
 * Returns the list of userIds currently online inside `scope`. "Online" =
 * `lastSeenAt > now - PRESENCE_TTL_MS`. The order is the iteration order of
 * `presenceMap` — Map preserves insertion order, which is good enough for a
 * UI that just needs a set.
 */
export function getPresentUserIds(scope: string, now: number = Date.now()): string[] {
    const cutoff = now - PRESENCE_TTL_MS;
    const out: string[] = [];
    for (const [userId, state] of presenceMap) {
        if (state.lastSeenAt <= cutoff) continue;
        if (state.scopes.has(scope)) out.push(userId);
    }
    return out;
}

/**
 * Mark `userId` as typing inside `scope`. Refreshes `startedAt` on every call
 * so a steady keystroke stream keeps the indicator alive without the client
 * having to flap between "true" and "false".
 */
export function markTyping(userId: string, scope: string): void {
    if (typeof userId !== 'string' || userId.length === 0) return;
    if (typeof scope !== 'string' || scope.length === 0) return;
    typingMap.set(typingKey(userId, scope), { startedAt: Date.now() });
}

/**
 * Returns the list of userIds actively typing in `scope` (started within the
 * last `TYPING_TTL_MS`). Anyone older is treated as having stopped — the
 * janitor will prune them on its next pass.
 */
export function getTypingUserIds(scope: string, now: number = Date.now()): string[] {
    const cutoff = now - TYPING_TTL_MS;
    const prefix = `${scope}|`;
    const out: string[] = [];
    for (const [key, state] of typingMap) {
        if (!key.startsWith(prefix)) continue;
        if (state.startedAt <= cutoff) continue;
        out.push(key.slice(prefix.length));
    }
    return out;
}

/**
 * Force-clear a single typing entry. Useful when the client explicitly sends
 * a "stopped typing" signal; otherwise typing entries decay naturally via
 * `getTypingUserIds` filtering + the janitor sweep.
 */
export function clearTyping(userId: string, scope: string): void {
    typingMap.delete(typingKey(userId, scope));
}

/**
 * Sweep `presenceMap` and `typingMap`, removing entries whose TTL has
 * expired. Returns the set of scopes affected by presence transitions so the
 * SSE layer can rebroadcast `presence-changed` to subscribers of those
 * scopes only.
 *
 * Pure-ish — depends only on `Date.now()` (overrideable via `now` for tests).
 */
export function sweepExpired(now: number = Date.now()): { presenceScopesChanged: string[] } {
    const presenceCutoff = now - PRESENCE_TTL_MS;
    const typingCutoff = now - TYPING_TTL_MS;
    const changed = new Set<string>();

    for (const [userId, state] of presenceMap) {
        if (state.lastSeenAt > presenceCutoff) continue;
        // User timed out — every scope they were in needs a refreshed roster.
        for (const scope of state.scopes) changed.add(scope);
        presenceMap.delete(userId);
    }

    for (const [key, state] of typingMap) {
        if (state.startedAt <= typingCutoff) typingMap.delete(key);
    }

    return { presenceScopesChanged: Array.from(changed) };
}

/**
 * Start the periodic janitor. Returns the timer handle so callers (tests,
 * shutdown hooks) can `clearInterval` it explicitly. Idempotent — calling it
 * more than once stacks timers, so production code should only call it from
 * `index.ts` start-up.
 */
export function startPresenceJanitor(): NodeJS.Timeout {
    const timer = setInterval(() => {
        try {
            const { presenceScopesChanged } = sweepExpired();
            if (presenceScopesChanged.length > 0) {
                presenceEvents.emit('presence-changed', { scopes: presenceScopesChanged });
            }
        } catch {
            // Never let a sweep crash the timer — the next tick will retry.
        }
    }, PRESENCE_JANITOR_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
    return timer;
}

// === Test-only resets =======================================================

/**
 * Reset both maps. Test-only — exposed so unit tests don't leak state across
 * cases. Not exported via the module surface for production use.
 */
export function __resetPresenceStateForTests(): void {
    presenceMap.clear();
    typingMap.clear();
}
