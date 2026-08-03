/**
 * Universal social store — SSE (Server-Sent Events) realtime channel.
 *
 * GET /api/v3/social/stream?scopes=group:ITS-21,dm:direct:alice::bob,global:chat
 *
 * Skeleton iteration: backend only. The frontend `EventSource` client lands in
 * a follow-up. Listeners on the `socialEvents` EventEmitter (`services/social.ts`)
 * filter on the per-connection subscribed scope set and write `event: ... \n
 * data: ...\n\n` frames to the underlying raw stream.
 *
 * Authorization model (POC):
 *   - scopes are resolved ONCE on connect via the same access helpers used by
 *     the REST routes (group: assertCanReadGroup, dm: peer membership in the
 *     room id, global / announcement: any authenticated user).
 *   - rejected scopes are dropped silently — we do not 403 the whole stream
 *     because partial subscription is a valid intent.
 *   - if every requested scope is rejected we still open the stream so the
 *     client can render an empty "no events yet" surface without retry
 *     bouncing; comparable to subscribing to zero topics over MQTT.
 *
 * Heartbeat:
 *   - 30s `:heartbeat\n\n` comment line so proxies don't kill idle conns
 *     (Cloudflare, nginx default to ~100s; 30s leaves margin).
 *
 * Backpressure / cleanup:
 *   - `request.raw.on('close')` is the single source of truth for client
 *     disconnect (covers both browser navigations and broken-pipe writes).
 *   - We do NOT throw on write failure — the listener removal in the close
 *     hook is enough; subsequent writes to a destroyed socket are no-ops.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { applyHijackedCorsHeaders } from '../utils/cors.js';
import { socialEvents } from '../services/social.js';
import { assertCanReadGroup } from '../services/group-space.js';
import { parseDirectRoomId } from '../services/messaging.js';
import {
    getPresentUserIds,
    markTyping,
    markUserPresent,
    presenceEvents,
    removeUserPresence,
} from '../services/presence.js';
import type {
    SocialComment,
    SocialEntity,
    SocialScopeType,
} from '../types/social.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

// === Constants ==============================================================

const KNOWN_SCOPE_TYPES: ReadonlySet<SocialScopeType> = new Set([
    'group',
    'dm',
    'global',
    'announcement',
]);

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_SCOPES_PER_CONNECTION = 64;
/**
 * How often each open SSE connection refreshes its presence heartbeat in the
 * in-memory `presenceMap`. Must be < `PRESENCE_TTL_MS` (30s) so a single
 * dropped tick doesn't flip the user to "offline". 10s gives us 3 ticks of
 * margin before TTL eviction.
 */
const PRESENCE_HEARTBEAT_INTERVAL_MS = 10_000;

// === Scope parsing ==========================================================

export interface ParsedScope {
    scopeType: SocialScopeType;
    /** raw id WITHOUT the type prefix (e.g. 'ITS-21' for group, 'direct:a::b' for dm) */
    rawId: string;
    /** canonical full form (`${type}:${rawId}`) — what we filter against. */
    full: string;
}

/**
 * Parse the `scopes` querystring (comma-separated `type:id` entries).
 *   - empty / missing → []
 *   - duplicates collapsed (preserving first-occurrence order)
 *   - unknown types and malformed entries silently skipped
 *   - bounded to MAX_SCOPES_PER_CONNECTION
 *
 * Pure function — exported for unit tests.
 */
export function parseScopesFromQuery(raw: unknown): ParsedScope[] {
    if (typeof raw !== 'string' || raw.length === 0) return [];
    const out: ParsedScope[] = [];
    const seen = new Set<string>();
    const parts = raw.split(',');
    for (const part of parts) {
        if (out.length >= MAX_SCOPES_PER_CONNECTION) break;
        const trimmed = part.trim();
        if (trimmed.length === 0) continue;
        const sep = trimmed.indexOf(':');
        if (sep <= 0 || sep === trimmed.length - 1) continue;
        const type = trimmed.slice(0, sep);
        const rawId = trimmed.slice(sep + 1).trim();
        if (!rawId) continue;
        if (!KNOWN_SCOPE_TYPES.has(type as SocialScopeType)) continue;
        const full = `${type}:${rawId}`;
        if (seen.has(full)) continue;
        seen.add(full);
        out.push({ scopeType: type as SocialScopeType, rawId, full });
    }
    return out;
}

/**
 * Compute the canonical `${scopeType}:${rawId}` filter key for an entity.
 * `scopeId` in the DB is already prefixed (`buildScopeId` enforces that), so
 * we normalize "double-prefixed" inputs back to a single prefix.
 *
 * Pure — exported for unit tests.
 */
export function entityScopeKey(entity: { scopeType: string; scopeId: string }): string {
    const prefix = `${entity.scopeType}:`;
    if (entity.scopeId.startsWith(prefix)) return entity.scopeId;
    return `${entity.scopeType}:${entity.scopeId}`;
}

// === SSE frame formatting ===================================================

/**
 * Format a single SSE frame: `event: <name>\ndata: <json>\n\n`.
 * The event name must be a single line (no LF/CR) — we drop control chars
 * defensively. The data payload is JSON-stringified; we deliberately do NOT
 * pretty-print so the wire frame stays compact.
 *
 * Pure — exported for unit tests.
 */
export function formatSseEvent(event: string, data: unknown): string {
    const safeEvent = String(event || 'message').replace(/[\r\n]+/g, '');
    let json: string;
    try {
        json = JSON.stringify(data ?? null);
    } catch {
        // Fallback: never crash the dispatch on a circular payload.
        json = JSON.stringify({ error: 'unserializable payload' });
    }
    return `event: ${safeEvent}\ndata: ${json}\n\n`;
}

// === Authorization ==========================================================

/**
 * Walk the requested scope set and return only the ones the viewer is allowed
 * to listen on. Failures inside a single check do not throw — we treat them as
 * "rejected" and skip. Order is preserved.
 */
export async function resolveAllowedScopes(
    viewerUserId: string,
    requested: readonly ParsedScope[],
): Promise<ParsedScope[]> {
    const allowed: ParsedScope[] = [];
    for (const scope of requested) {
        if (await isScopeAllowed(viewerUserId, scope)) {
            allowed.push(scope);
        }
    }
    return allowed;
}

async function isScopeAllowed(viewerUserId: string, scope: ParsedScope): Promise<boolean> {
    if (!viewerUserId) return false;
    try {
        switch (scope.scopeType) {
            case 'global':
            case 'announcement':
                // every authenticated user.
                return true;
            case 'group': {
                await assertCanReadGroup(viewerUserId, scope.rawId);
                return true;
            }
            case 'dm': {
                const direct = parseDirectRoomId(scope.rawId);
                if (!direct) return false;
                return viewerUserId === direct.low || viewerUserId === direct.high;
            }
            default:
                return false;
        }
    } catch {
        // assertCanReadGroup throws 'Forbidden' — treat any throw as "not
        // allowed". This is the silent-skip contract from the spec.
        return false;
    }
}

// === Route ==================================================================

interface StreamQuerystring {
    scopes?: string;
}

interface TypingBody {
    scope?: string;
}

// === Typing route schema ====================================================

const typingBodySchema = {
    type: 'object',
    required: ['scope'],
    properties: {
        scope: { type: 'string', minLength: 1, maxLength: 200 },
    },
} as const;

export async function socialStreamRoutes(app: FastifyInstance) {
    app.get<{ Querystring: StreamQuerystring }>('/social/stream', {
        preHandler: [app.authenticate as never],
    }, async (request, reply) => {
        const authRequest = request as AuthenticatedRequest;
        const viewerUserId = authRequest.user?.userId;
        if (!viewerUserId) {
            return reply.status(401).send({
                success: false,
                error: 'unauthenticated',
                errorCode: 'SOCIAL_UNAUTHENTICATED',
            });
        }

        const requested = parseScopesFromQuery(request.query?.scopes);
        const allowed = await resolveAllowedScopes(viewerUserId, requested);
        const allowedKeys = new Set(allowed.map((s) => s.full));

        attachSseStream(request, reply, allowedKeys, viewerUserId);
        return reply;
    });

    // ----- POST /social/typing ----------------------------------------------
    //
    // Records that `viewerUserId` is currently typing inside `scope`. The body
    // is intentionally minimal — the client pings this endpoint at most once
    // every ~3s during active typing and the server-side TTL of 5s lets the
    // indicator fade naturally without a follow-up "stopped" request.
    //
    // Authorization: the typing emit is filtered against the same per-scope
    // access rules used by the SSE stream. We do NOT mutate state if the user
    // is not allowed to read the scope — preventing typing-status leaks on
    // groups/dms they don't belong to.
    app.post<{ Body: TypingBody }>('/social/typing', {
        preHandler: [app.authenticate as never],
        schema: { body: typingBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid typing payload',
                errorCode: 'SOCIAL_TYPING_VALIDATION',
            });
        }

        const authRequest = request as AuthenticatedRequest;
        const viewerUserId = authRequest.user?.userId;
        if (!viewerUserId) {
            return reply.status(401).send({
                success: false,
                error: 'unauthenticated',
                errorCode: 'SOCIAL_UNAUTHENTICATED',
            });
        }

        const rawScope = (request.body?.scope || '').trim();
        if (!rawScope) {
            return reply.status(400).send({
                success: false,
                error: 'scope is required',
                errorCode: 'SOCIAL_TYPING_VALIDATION',
            });
        }

        // Parse + auth-gate the scope. We piggy-back on the SSE parser so the
        // scope format is identical and validation lives in one place.
        const parsed = parseScopesFromQuery(rawScope);
        if (parsed.length === 0) {
            return reply.status(400).send({
                success: false,
                error: 'unknown or malformed scope',
                errorCode: 'SOCIAL_TYPING_VALIDATION',
            });
        }
        const allowed = await resolveAllowedScopes(viewerUserId, parsed);
        if (allowed.length === 0) {
            return reply.status(403).send({
                success: false,
                error: 'forbidden',
                errorCode: 'SOCIAL_FORBIDDEN',
            });
        }

        const scope = allowed[0]!.full;
        const startedAt = Date.now();
        markTyping(viewerUserId, scope);
        // Broadcast through the presence bus — `attachSseStream` listens on
        // this and filters per-client by their allowed scope set.
        presenceEvents.emit('typing', { scope, userId: viewerUserId, startedAt });

        return reply.send({ success: true, data: { scope, startedAt } });
    });
}

/**
 * Helper — emit a `presence-changed` frame to the underlying response for a
 * single scope. Extracted so both the on-connect path and the periodic
 * heartbeat path stay in sync on payload shape.
 */
function writePresenceChanged(
    res: { write: (chunk: string) => boolean; writableEnded?: boolean; destroyed?: boolean },
    scope: string,
): void {
    const onlineUserIds = getPresentUserIds(scope);
    safeWrite(res, formatSseEvent('presence-changed', { scope, onlineUserIds }));
}

/**
 * Wire the raw response stream up to the social event bus. Extracted so the
 * route handler stays declarative and the writer can be unit-tested with a
 * synthetic reply in the future.
 *
 * Presence wiring (new in this revision):
 *   - On connect, the viewer is marked present in every allowed scope and
 *     a `presence-changed` frame is emitted to every other listener in those
 *     scopes via `presenceEvents`.
 *   - A 10s heartbeat refreshes the viewer's `lastSeenAt`. If the scope-set
 *     diff yields anything new, broadcast it.
 *   - On disconnect, the viewer is removed from `presenceMap` and the same
 *     fan-out emits the "user offline" state.
 *
 * Typing wiring:
 *   - Subscribes to `presenceEvents.on('typing', ...)`. The route's POST
 *     /social/typing handler emits onto this bus; each connected client
 *     filters by its own allowed-scope set.
 */
function attachSseStream(
    request: FastifyRequest,
    reply: FastifyReply,
    allowedKeys: ReadonlySet<string>,
    viewerUserId: string,
): void {
    // Hijack the reply BEFORE writing — tells Fastify we own the response
    // lifecycle. Without this Fastify will try to send its own response body
    // when the handler returns and corrupt the SSE framing.
    reply.hijack();

    const res = reply.raw;
    // Hijacking bypasses @fastify/cors' onSend hook, so set CORS headers here
    // ourselves — otherwise the cross-origin EventSource is blocked by the
    // browser ("No 'Access-Control-Allow-Origin' header").
    applyHijackedCorsHeaders(res, request.headers.origin);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // X-Accel-Buffering disables nginx response buffering so events flush
    // immediately. Harmless when the proxy is something else.
    res.setHeader('X-Accel-Buffering', 'no');
    // Flush headers eagerly so the client transitions out of "pending" state.
    if (typeof res.flushHeaders === 'function') {
        try {
            res.flushHeaders();
        } catch {
            // tolerated — some test transports do not implement flushHeaders
        }
    }

    // Initial keepalive — also serves as a "stream is live" signal for the
    // EventSource readyState transition.
    safeWrite(res, ':ok\n\n');

    const onEntity = (entity: SocialEntity): void => {
        try {
            const key = entityScopeKey(entity);
            if (!allowedKeys.has(key)) return;
            safeWrite(
                res,
                formatSseEvent('entity-created', {
                    id: entity.id,
                    kind: entity.kind,
                    scopeType: entity.scopeType,
                    scopeId: entity.scopeId,
                    authorUserId: entity.authorUserId,
                    pinned: entity.pinned,
                    createdAt: entity.createdAt,
                }),
            );
        } catch {
            // never let a single bad event tear down the listener pool
        }
    };

    const onComment = (payload: { comment: SocialComment; parentEntity: SocialEntity }): void => {
        try {
            const key = entityScopeKey(payload.parentEntity);
            if (!allowedKeys.has(key)) return;
            safeWrite(
                res,
                formatSseEvent('comment-created', {
                    id: payload.comment.id,
                    entityId: payload.comment.entityId,
                    parentCommentId: payload.comment.parentCommentId,
                    authorUserId: payload.comment.authorUserId,
                    createdAt: payload.comment.createdAt,
                    scopeType: payload.parentEntity.scopeType,
                    scopeId: payload.parentEntity.scopeId,
                    parentEntity: {
                        id: payload.parentEntity.id,
                        kind: payload.parentEntity.kind,
                        authorUserId: payload.parentEntity.authorUserId,
                    },
                }),
            );
        } catch {
            // see onEntity
        }
    };

    // ── Presence + typing listeners ──────────────────────────────────────────
    //
    // Bind the viewer into every allowed scope. The first call returns the set
    // of scopes whose roster changed — for a fresh connection that's typically
    // every scope in `allowedKeys`. Broadcast via `presenceEvents` so OTHER
    // open streams in the same scopes get a refreshed roster.
    const allowedScopeList: string[] = Array.from(allowedKeys);
    if (allowedScopeList.length > 0) {
        const changedScopes = markUserPresent(viewerUserId, allowedScopeList);
        if (changedScopes.length > 0) {
            presenceEvents.emit('presence-changed', { scopes: changedScopes });
        }
        // Send the current online list for each of OUR allowed scopes so the
        // client doesn't have to wait for the first peer-state-change event
        // to render the online indicator.
        for (const scope of allowedScopeList) {
            writePresenceChanged(res, scope);
        }
    }

    const onPresenceChanged = (payload: { scopes: readonly string[] }): void => {
        try {
            if (!payload || !Array.isArray(payload.scopes)) return;
            for (const scope of payload.scopes) {
                if (!allowedKeys.has(scope)) continue;
                writePresenceChanged(res, scope);
            }
        } catch {
            // never let a single bad event tear down the listener pool
        }
    };

    const onTyping = (payload: { scope: string; userId: string; startedAt: number }): void => {
        try {
            if (!payload || typeof payload.scope !== 'string') return;
            if (!allowedKeys.has(payload.scope)) return;
            // Don't echo the typing event back to the typer themselves — the
            // UI tracks its own "I am typing" state locally.
            if (payload.userId === viewerUserId) return;
            safeWrite(
                res,
                formatSseEvent('typing', {
                    scope: payload.scope,
                    userId: payload.userId,
                    startedAt: payload.startedAt,
                }),
            );
        } catch {
            // see onPresenceChanged
        }
    };

    socialEvents.on('entity-created', onEntity);
    socialEvents.on('comment-created', onComment);
    presenceEvents.on('presence-changed', onPresenceChanged);
    presenceEvents.on('typing', onTyping);

    const heartbeat = setInterval(() => {
        // Comment line (begins with `:`) — ignored by EventSource but keeps
        // the TCP/HTTP path warm.
        safeWrite(res, ':heartbeat\n\n');
    }, HEARTBEAT_INTERVAL_MS);
    // Unref so the timer never blocks process exit during test teardown.
    if (typeof heartbeat.unref === 'function') {
        heartbeat.unref();
    }

    // Presence heartbeat — refreshes the viewer's `lastSeenAt` so the janitor
    // doesn't evict them. Runs more often than the proxy heartbeat above
    // because the presence TTL is shorter.
    const presenceHeartbeat = setInterval(() => {
        try {
            const changed = markUserPresent(viewerUserId, allowedScopeList);
            if (changed.length > 0) {
                presenceEvents.emit('presence-changed', { scopes: changed });
            }
        } catch {
            // ignore — next tick will retry
        }
    }, PRESENCE_HEARTBEAT_INTERVAL_MS);
    if (typeof presenceHeartbeat.unref === 'function') {
        presenceHeartbeat.unref();
    }

    let cleanedUp = false;
    const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        clearInterval(heartbeat);
        clearInterval(presenceHeartbeat);
        socialEvents.off('entity-created', onEntity);
        socialEvents.off('comment-created', onComment);
        presenceEvents.off('presence-changed', onPresenceChanged);
        presenceEvents.off('typing', onTyping);
        // Remove user from presence map and broadcast the offline transition
        // to the remaining listeners.
        try {
            const droppedScopes = removeUserPresence(viewerUserId);
            if (droppedScopes.length > 0) {
                presenceEvents.emit('presence-changed', { scopes: droppedScopes });
            }
        } catch {
            // best-effort — process may be tearing down
        }
        try {
            res.end();
        } catch {
            // already closed
        }
    };

    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
}

function safeWrite(res: { write: (chunk: string) => boolean; writableEnded?: boolean; destroyed?: boolean }, chunk: string): void {
    if (res.writableEnded || res.destroyed) return;
    try {
        res.write(chunk);
    } catch {
        // broken pipe — cleanup listener will fire from the 'close' event.
    }
}

// Test-only exports — mirrors the pattern from social-events.ts.
export const __testing = {
    HEARTBEAT_INTERVAL_MS,
    MAX_SCOPES_PER_CONNECTION,
    isScopeAllowed,
};
