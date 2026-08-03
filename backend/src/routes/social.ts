/**
 * Universal social entity REST routes — Phase 1c foundation.
 *
 * These endpoints expose the universal social store (see
 * docs/SOCIAL_STORE.md, backend/src/services/social.ts and
 * backend/src/types/social.ts) over HTTP. They are deliberately additive:
 *
 *   - no existing route is removed or rerouted to call this layer yet
 *   - no frontend page consumes these routes yet
 *   - the legacy `services/*-shim.ts` keeps mirroring writes via the service
 *
 * The goal is to give Phase 2 (frontend rewrite) and operators (curl-based
 * testing) a stable contract surface before the legacy CRUD code is dropped.
 *
 * Auth model: every route requires `app.authenticate`. The service-layer
 * authorization (owner-only update/delete/restore/pin) is the source of
 * truth — the route just maps thrown errors to HTTP status codes.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
    SOCIAL_BODY_MAX_LENGTH,
    SOCIAL_COMMENT_MAX_LENGTH,
    SOCIAL_REVISION_MAX_LIMIT,
    SOCIAL_SEARCH_MAX_LIMIT,
    SOCIAL_SEARCH_MAX_QUERY_LENGTH,
    SOCIAL_SEARCH_MIN_QUERY_LENGTH,
    SOCIAL_TITLE_MAX_LENGTH,
    addComment,
    attachFile,
    buildScopeId,
    createEntity,
    getEntityView,
    listAttachments,
    listComments,
    listEntitiesByScope,
    listRevisions,
    pinEntity,
    removeAttachment,
    restoreEntity,
    searchSocialEntities,
    softDeleteEntity,
    toggleReaction,
    updateEntity,
} from '../services/social.js';
import {
    SOCIAL_USER_SEARCH_MAX_LIMIT,
    searchSocialUsers,
} from '../services/social-users.js';
import {
    getUnreadCountsBatch,
    markScopeRead,
} from '../services/social-read-markers.js';
import {
    SOCIAL_NOTIFICATION_MAX_LIMIT,
    getUnreadNotificationCount,
    listSocialNotifications,
    markAllNotificationsRead,
    markNotificationsRead,
} from '../services/social-notifications.js';
import {
    SOCIAL_REPORT_REASON_MAX_LENGTH,
    reportEntity,
} from '../services/social-moderation.js';
import {
    closePoll as closePollService,
    unvote as unvotePollService,
    vote as votePollService,
} from '../services/social-polls.js';
import {
    clearRsvp as clearRsvpService,
    rsvp as rsvpService,
    type RsvpStatus,
} from '../services/social-events-rsvp.js';
import {
    MAX_SERIES_OCCURRENCES,
    buildOccurrencePayload,
    computeEventDurationMs,
    extendEventSeries,
    generateEventSeries,
    type RecurrenceKind,
} from '../services/social-events-recurrence.js';
import {
    recordView,
} from '../services/social-views.js';
import { randomUUID } from 'node:crypto';
import { fetchPreview as fetchLinkPreview } from '../services/link-previews.js';
import { consumeRateLimit } from '../utils/rateLimit.js';
import type {
    SocialEntityKind,
    SocialPayloadByKind,
    SocialScopeType,
} from '../types/social.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

// === Constants / limits ======================================================

const SCOPE_TYPES: readonly SocialScopeType[] = ['group', 'dm', 'global', 'announcement'];
const ENTITY_KINDS: readonly SocialEntityKind[] = [
    'post',
    'task',
    'extra_lesson',
    'poll',
    'event',
    'announcement',
    'dm_message',
    'global_message',
];

const ALLOWED_EMOJI = ['👍', '❤️', '😂', '🎉', '😢'] as const;

const MAX_SCOPE_ID_LENGTH = 200;
const MAX_ENTITY_ID_LENGTH = 100;
const MAX_FILE_ID_LENGTH = 200;
const MAX_MIME_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
const MAX_LIST_LIMIT = 200;

// === Rate limits =============================================================
//
// Follows the per-user `consumeRateLimit` pattern already used by
// routes/board.ts (`board-post:{userId}`, 5/300s) and routes/global-chat.ts
// (`global-chat-post:{userId}`, 8/60s). `services/social-moderation.ts`
// explicitly states that report idempotency is NOT enforced in the service and
// that throttling belongs to the route layer — these are that throttle.
//
// Budgets are deliberately asymmetric:
//   - создание сущностей и комментарии — «горячие» пути (DM-сообщения тоже
//     создаются через POST /social/entities), поэтому окно щедрое и обычный
//     диалог в него укладывается;
//   - жалобы — редкое действие, там окно узкое.
// Каждый лимит переопределяется env-переменной, как в board/global-chat.
const SOCIAL_CREATE_RATE_MAX = 30;
const SOCIAL_CREATE_RATE_WINDOW_SEC = 60;
const SOCIAL_COMMENT_RATE_MAX = 20;
const SOCIAL_COMMENT_RATE_WINDOW_SEC = 60;
const SOCIAL_REPORT_RATE_MAX = 10;
const SOCIAL_REPORT_RATE_WINDOW_SEC = 300;

function envInt(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Consume one token for `key` and, when the budget is exhausted, send the
 * standard social 429 envelope (same shape as the link-preview limiter below,
 * plus a `Retry-After` header like board/global-chat). Returns `true` when the
 * caller may proceed.
 */
function allowSocialRequest(
    reply: FastifyReply,
    key: string,
    maxEnv: string,
    maxFallback: number,
    windowEnv: string,
    windowFallbackSec: number,
): boolean {
    const rl = consumeRateLimit(
        key,
        envInt(maxEnv, maxFallback),
        envInt(windowEnv, windowFallbackSec) * 1000,
    );
    if (rl.allowed) return true;
    reply.header('Retry-After', String(rl.retryAfterSec));
    reply.status(429).send({
        success: false,
        error: 'rate limited',
        errorCode: 'SOCIAL_RATE_LIMITED',
        retryAfterSec: rl.retryAfterSec,
    });
    return false;
}

// === Schemas =================================================================

// Scope-listing route — `scopeType` lives in the URL but we keep limits on the
// dynamic `scopeId` part. Querystring covers kind/limit/offset/flags.
const listScopeParamsSchema = {
    type: 'object',
    required: ['scopeType', 'scopeId'],
    properties: {
        scopeType: { type: 'string', enum: [...SCOPE_TYPES] },
        scopeId: { type: 'string', minLength: 1, maxLength: MAX_SCOPE_ID_LENGTH },
    },
} as const;

const listScopeQuerySchema = {
    type: 'object',
    properties: {
        kind: { type: 'string', enum: [...ENTITY_KINDS] },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT },
        offset: { type: 'integer', minimum: 0 },
        includeDeleted: { type: 'boolean' },
        pinnedFirst: { type: 'boolean' },
    },
} as const;

const entityIdParamsSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: { type: 'string', minLength: 1, maxLength: MAX_ENTITY_ID_LENGTH },
    },
} as const;

const deleteQuerySchema = {
    type: 'object',
    properties: {
        reason: { type: 'string', maxLength: MAX_REASON_LENGTH },
    },
} as const;

// Create requires body to be a non-empty object — per-kind shape is checked at
// the handler layer (validateBody/validateTitle ensure free-text limits).
const createEntityBodySchema = {
    type: 'object',
    required: ['kind', 'scopeType', 'scopeId', 'payload'],
    properties: {
        kind: { type: 'string', enum: [...ENTITY_KINDS] },
        scopeType: { type: 'string', enum: [...SCOPE_TYPES] },
        scopeId: { type: 'string', minLength: 1, maxLength: MAX_SCOPE_ID_LENGTH },
        payload: {
            type: 'object',
            // payload is per-kind; we cap free-text fields here as a defensive
            // upper bound, leaving deeper validation to the service.
            properties: {
                title: { type: 'string', maxLength: SOCIAL_TITLE_MAX_LENGTH },
                body: { type: 'string', maxLength: SOCIAL_BODY_MAX_LENGTH },
                tags: { type: 'array', items: { type: 'string', maxLength: 64 }, maxItems: 32 },
                dueAt: { type: 'string', maxLength: 64 },
                completedByUserIds: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 200 },
                assignedUserIds: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 200 },
                subject: { type: 'string', maxLength: SOCIAL_TITLE_MAX_LENGTH },
                teacher: { type: 'string', maxLength: SOCIAL_TITLE_MAX_LENGTH },
                room: { type: 'string', maxLength: 100 },
                startsAt: { type: 'string', maxLength: 64 },
                endsAt: { type: 'string', maxLength: 64 },
                note: { type: 'string', maxLength: SOCIAL_BODY_MAX_LENGTH },
                question: { type: 'string', maxLength: SOCIAL_TITLE_MAX_LENGTH },
                options: { type: 'array', maxItems: 16 },
                votes: { type: 'object' },
                closedAt: { type: 'string', maxLength: 64 },
                location: { type: 'string', maxLength: 200 },
                rsvpStatus: { type: 'object' },
                recurrence: {
                    type: 'object',
                    properties: {
                        kind: { type: 'string', enum: ['weekly', 'monthly'] },
                        until: { type: 'string', maxLength: 64 },
                        occurrencesAhead: { type: 'integer', minimum: 1, maximum: 60 },
                    },
                    additionalProperties: false,
                },
                seriesId: { type: 'string', maxLength: 100 },
                multiChoice: { type: 'boolean' },
                priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                targetGroups: { type: 'array', items: { type: 'string', maxLength: 100 }, maxItems: 200 },
                expiresAt: { type: 'string', maxLength: 64 },
                replyToMessageId: { type: 'string', maxLength: 100 },
                editedAt: { type: 'string', maxLength: 64 },
            },
            additionalProperties: true,
        },
    },
} as const;

const patchEntityBodySchema = {
    type: 'object',
    required: ['patch'],
    properties: {
        patch: {
            type: 'object',
            minProperties: 1,
            additionalProperties: true,
        },
    },
} as const;

const pinBodySchema = {
    type: 'object',
    required: ['pinned'],
    properties: {
        pinned: { type: 'boolean' },
    },
} as const;

const commentBodySchema = {
    type: 'object',
    required: ['body'],
    properties: {
        body: { type: 'string', minLength: 1, maxLength: SOCIAL_COMMENT_MAX_LENGTH },
        parentCommentId: { type: 'string', maxLength: MAX_ENTITY_ID_LENGTH },
    },
} as const;

// Querystring for `GET /social/entities/:id/revisions`. Only the (optional)
// `limit` field — the service clamps anything overshooting this AJV cap
// defensively, so the upper bound here matches `SOCIAL_REVISION_MAX_LIMIT`.
const listRevisionsQuerySchema = {
    type: 'object',
    properties: {
        limit: { type: 'integer', minimum: 1, maximum: SOCIAL_REVISION_MAX_LIMIT },
    },
} as const;

const reactionBodySchema = {
    type: 'object',
    required: ['emoji'],
    properties: {
        emoji: { type: 'string', enum: [...ALLOWED_EMOJI] },
    },
} as const;

const attachmentBodySchema = {
    type: 'object',
    required: ['fileId'],
    properties: {
        fileId: { type: 'string', minLength: 1, maxLength: MAX_FILE_ID_LENGTH },
        mime: { type: 'string', maxLength: MAX_MIME_LENGTH },
        sizeBytes: { type: 'integer', minimum: 0 },
        sortOrder: { type: 'integer', minimum: 0 },
    },
} as const;

const attachmentIdParamsSchema = {
    type: 'object',
    required: ['id', 'attachmentId'],
    properties: {
        id: { type: 'string', minLength: 1, maxLength: MAX_ENTITY_ID_LENGTH },
        attachmentId: { type: 'string', minLength: 1, maxLength: MAX_ENTITY_ID_LENGTH },
    },
} as const;

// Read-receipts surfaces. POST /social/read accepts a single scope-key triple;
// GET /social/unread accepts a comma-separated list of `type:id` scope keys.
// The 64-scope cap matches the SSE stream subscriber cap (services/social-stream).
const MAX_UNREAD_SCOPES = 64;
const MAX_UNREAD_QUERY_LENGTH = 4000;

const markScopeReadBodySchema = {
    type: 'object',
    required: ['scopeType', 'scopeId'],
    properties: {
        scopeType: { type: 'string', enum: [...SCOPE_TYPES] },
        scopeId: { type: 'string', minLength: 1, maxLength: MAX_SCOPE_ID_LENGTH },
        lastEntityId: { type: 'string', maxLength: MAX_ENTITY_ID_LENGTH },
    },
} as const;

const unreadCountsQuerySchema = {
    type: 'object',
    required: ['scopes'],
    properties: {
        scopes: { type: 'string', minLength: 1, maxLength: MAX_UNREAD_QUERY_LENGTH },
    },
} as const;

// Cross-scope universal text search. `q` is the user query; the rest are
// optional filters. Lists are encoded as comma-separated values in the
// querystring (split + dedup happens in the handler).
const entitySearchQuerySchema = {
    type: 'object',
    required: ['q'],
    properties: {
        q: {
            type: 'string',
            minLength: SOCIAL_SEARCH_MIN_QUERY_LENGTH,
            maxLength: SOCIAL_SEARCH_MAX_QUERY_LENGTH,
        },
        scopes: { type: 'string', maxLength: 200 },
        kinds: { type: 'string', maxLength: 200 },
        limit: { type: 'integer', minimum: 1, maximum: SOCIAL_SEARCH_MAX_LIMIT },
    },
} as const;

// User-hint search for the @mention autocomplete dropdown.
const userSearchQuerySchema = {
    type: 'object',
    required: ['scope', 'q'],
    properties: {
        scope: { type: 'string', minLength: 3, maxLength: MAX_SCOPE_ID_LENGTH + 16 },
        q: { type: 'string', minLength: 1, maxLength: 100 },
        limit: { type: 'integer', minimum: 1, maximum: SOCIAL_USER_SEARCH_MAX_LIMIT },
    },
} as const;

// Notification Center surfaces. The list endpoint is paginated by a
// `before` cursor (ISO timestamp); `read` and `read-all` flip the `read_at`
// column on `app_social_mention`. `MAX_NOTIFICATION_IDS` keeps a single read
// payload bounded so a malicious caller cannot DoS the table-level UPDATE.
const MAX_NOTIFICATION_IDS = 200;
const MAX_NOTIFICATION_ID_LENGTH = 100;

const listNotificationsQuerySchema = {
    type: 'object',
    properties: {
        limit: { type: 'integer', minimum: 1, maximum: SOCIAL_NOTIFICATION_MAX_LIMIT },
        before: { type: 'string', maxLength: 64 },
        unreadOnly: { type: 'boolean' },
    },
} as const;

const markNotificationsReadBodySchema = {
    type: 'object',
    required: ['ids'],
    properties: {
        ids: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_NOTIFICATION_IDS,
            items: { type: 'string', minLength: 1, maxLength: MAX_NOTIFICATION_ID_LENGTH },
        },
    },
} as const;

// === Moderation schemas ====================================================


const reportEntityBodySchema = {
    type: 'object',
    properties: {
        reason: { type: 'string', maxLength: SOCIAL_REPORT_REASON_MAX_LENGTH },
    },
} as const;

// === Poll voting schemas ====================================================
//
// Polls live in `app_social_entity` like any other kind, but voting is not an
// owner-only `updateEntity` op — every scope member can flip their own vote.
// Dedicated routes call into `services/social-polls.ts` which enforces the
// per-scope authorization (group membership, dm peer, etc.) before mutating
// the `votes` field of the payload.

const MAX_POLL_OPTION_ID_LENGTH = 100;

const pollVoteBodySchema = {
    type: 'object',
    required: ['optionId'],
    properties: {
        optionId: { type: 'string', minLength: 1, maxLength: MAX_POLL_OPTION_ID_LENGTH },
    },
} as const;

// ===== Events RSVP =========================================================
// `/social/events/:id/rsvp` accepts a single-shot status pick. The service
// itself validates the value too — duplicated here so AJV rejects malformed
// payloads with a 400 before reaching the handler.
const RSVP_STATUSES = ['yes', 'no', 'maybe'] as const;

const rsvpBodySchema = {
    type: 'object',
    required: ['status'],
    properties: {
        status: { type: 'string', enum: [...RSVP_STATUSES] },
    },
} as const;

// ----- Event series extension ----------------------------------------------
// Body of POST /social/events/:id/extend-series — `additional` is the number
// of future occurrences to materialize on top of the existing series. We
// cap at MAX_SERIES_OCCURRENCES on the server too; AJV gives the cheap 400.
const extendSeriesBodySchema = {
    type: 'object',
    properties: {
        additional: {
            type: 'integer',
            minimum: 1,
            maximum: MAX_SERIES_OCCURRENCES,
        },
    },
} as const;

// === Error mapping ===========================================================

/**
 * Map a thrown service Error to a `{ status, errorCode, message }` tuple.
 * Mirrors the messages thrown by `services/social.ts`:
 *
 *   - 'forbidden'                  → 403 SOCIAL_FORBIDDEN
 *   - 'not found' / 'parent ...'   → 404 SOCIAL_NOT_FOUND
 *   - 'invalid emoji'              → 400 SOCIAL_INVALID_EMOJI
 *   - 'comment depth limit'        → 400 SOCIAL_COMMENT_DEPTH_LIMIT
 *   - 'body must ... empty' etc.   → 400 SOCIAL_VALIDATION_*
 *   - everything else              → 500 SOCIAL_INTERNAL_ERROR
 */
function mapServiceError(error: unknown): { status: number; errorCode: string; message: string } {
    const message = error instanceof Error ? error.message : String(error || 'unknown error');
    const normalized = message.toLowerCase();

    if (normalized === 'muted') {
        return { status: 403, errorCode: 'SOCIAL_MUTED', message: 'muted' };
    }
    if (normalized === 'forbidden') {
        return { status: 403, errorCode: 'SOCIAL_FORBIDDEN', message: 'forbidden' };
    }
    if (normalized === 'not found' || normalized.startsWith('parent not found') || normalized === 'parent not found') {
        return { status: 404, errorCode: 'SOCIAL_NOT_FOUND', message };
    }
    if (normalized === 'already reviewed') {
        return { status: 409, errorCode: 'SOCIAL_ALREADY_REVIEWED', message };
    }
    if (normalized === 'invalid action') {
        return { status: 400, errorCode: 'SOCIAL_VALIDATION_REQUIRED', message };
    }
    if (normalized === 'reason too long') {
        return { status: 400, errorCode: 'SOCIAL_VALIDATION_TOO_LONG', message };
    }
    if (normalized === 'invalid emoji') {
        return { status: 400, errorCode: 'SOCIAL_INVALID_EMOJI', message };
    }
    if (normalized === 'invalid option') {
        return { status: 400, errorCode: 'SOCIAL_POLL_INVALID_OPTION', message };
    }
    if (normalized === 'poll closed') {
        return { status: 409, errorCode: 'SOCIAL_POLL_CLOSED', message };
    }
    if (normalized === 'invalid rsvp status') {
        return { status: 400, errorCode: 'SOCIAL_RSVP_INVALID_STATUS', message };
    }
    if (normalized === 'not an event') {
        return { status: 400, errorCode: 'SOCIAL_RSVP_NOT_AN_EVENT', message };
    }
    if (normalized === 'not a series') {
        return { status: 400, errorCode: 'SOCIAL_EVENT_NOT_A_SERIES', message };
    }
    if (normalized === 'comment depth limit') {
        return { status: 400, errorCode: 'SOCIAL_COMMENT_DEPTH_LIMIT', message };
    }
    // validateBody / validateTitle / validateCommentBody throw with these
    // canonical prefixes — surface them as 400s so the client can flag the
    // exact field.
    if (normalized.includes('must not be empty')) {
        return { status: 400, errorCode: 'SOCIAL_VALIDATION_EMPTY', message };
    }
    if (normalized.includes('characters') || normalized.includes('must be ≤') || normalized.includes('too long')) {
        return { status: 400, errorCode: 'SOCIAL_VALIDATION_TOO_LONG', message };
    }
    if (normalized.includes('too short')) {
        return { status: 400, errorCode: 'SOCIAL_VALIDATION_TOO_SHORT', message };
    }
    if (normalized.includes('is required') || normalized.includes('must be a string')) {
        return { status: 400, errorCode: 'SOCIAL_VALIDATION_REQUIRED', message };
    }

    return { status: 500, errorCode: 'SOCIAL_INTERNAL_ERROR', message };
}

function sendServiceError(reply: FastifyReply, error: unknown): FastifyReply {
    const mapped = mapServiceError(error);
    return reply.status(mapped.status).send({
        success: false,
        error: mapped.message,
        errorCode: mapped.errorCode,
    });
}

// === Routes ==================================================================

export async function socialRoutes(app: FastifyInstance) {
    // ----- List entities in a scope -----------------------------------------
    app.get<{
        Params: { scopeType: SocialScopeType; scopeId: string };
        Querystring: {
            kind?: SocialEntityKind;
            limit?: number;
            offset?: number;
            includeDeleted?: boolean;
            pinnedFirst?: boolean;
        };
    }>('/social/scope/:scopeType/:scopeId/entities', {
        preHandler: [app.authenticate as any],
        schema: {
            params: listScopeParamsSchema,
            querystring: listScopeQuerySchema,
        },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid scope or query',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const scopeType = request.params.scopeType;
            const scopeId = buildScopeId(scopeType, request.params.scopeId);

            const entities = await listEntitiesByScope(scopeType, scopeId, {
                kind: request.query.kind,
                viewerUserId: authRequest.user.userId,
                limit: request.query.limit,
                offset: request.query.offset,
                includeDeleted: request.query.includeDeleted,
                pinnedFirst: request.query.pinnedFirst,
            });

            return reply.send({ success: true, data: { entities } });
        } catch (error) {
            request.log.error(error, '[Social] listEntitiesByScope failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Get single entity ------------------------------------------------
    app.get<{ Params: { id: string } }>('/social/entities/:id', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid entity id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const view = await getEntityView(request.params.id, authRequest.user.userId);
            if (!view) {
                return reply.status(404).send({
                    success: false,
                    error: 'entity not found',
                    errorCode: 'SOCIAL_NOT_FOUND',
                });
            }
            return reply.send({ success: true, data: { entity: view } });
        } catch (error) {
            request.log.error(error, '[Social] getEntityView failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Create entity ----------------------------------------------------
    app.post<{
        Body: {
            kind: SocialEntityKind;
            scopeType: SocialScopeType;
            scopeId: string;
            payload: SocialPayloadByKind[SocialEntityKind];
        };
    }>('/social/entities', {
        preHandler: [app.authenticate as any],
        schema: { body: createEntityBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid entity payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        {
            const authRequest = request as AuthenticatedRequest;
            if (!allowSocialRequest(
                reply,
                `social-entity-create:${authRequest.user.userId}`,
                'SOCIAL_CREATE_RATE_LIMIT_MAX',
                SOCIAL_CREATE_RATE_MAX,
                'SOCIAL_CREATE_RATE_LIMIT_WINDOW_SEC',
                SOCIAL_CREATE_RATE_WINDOW_SEC,
            )) return reply;
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const { kind, scopeType, scopeId, payload } = request.body;

            // Phase 1c-route guard: every kind that has a primary free-text
            // surface MUST include a non-empty body/title/question/subject so
            // we don't store empty rows even when AJV would accept it. The
            // service-layer validators (validateBody/Title) catch this too —
            // we duplicate the cheap check here to fail fast with a clean 400.
            const payloadObj = (payload ?? {}) as Record<string, unknown>;
            const hasContent = (
                (typeof payloadObj.body === 'string' && payloadObj.body.trim().length > 0)
                || (typeof payloadObj.title === 'string' && payloadObj.title.trim().length > 0)
                || (typeof payloadObj.question === 'string' && payloadObj.question.trim().length > 0)
                || (typeof payloadObj.subject === 'string' && payloadObj.subject.trim().length > 0)
            );
            if (!hasContent) {
                return reply.status(400).send({
                    success: false,
                    error: 'payload must include a non-empty body, title, question or subject',
                    errorCode: 'SOCIAL_VALIDATION_EMPTY',
                });
            }

            const normalizedScopeId = buildScopeId(scopeType, scopeId);

            // Event recurrence pre-processing: if the caller sent
            // `payload.recurrence` for a kind='event' entity, generate a
            // `seriesId` up-front and stamp it onto the *first* row's
            // payload. We materialize the follow-up rows AFTER the base row
            // lands so soft-delete / pin semantics already work on the base.
            // Non-event kinds and one-off events skip this branch entirely.
            const eventPayload = payload as Record<string, unknown>;
            const recurrence = kind === 'event' && eventPayload && typeof eventPayload === 'object'
                ? (eventPayload.recurrence as Record<string, unknown> | undefined)
                : undefined;
            const recurrenceKind: RecurrenceKind | null =
                recurrence && (recurrence.kind === 'weekly' || recurrence.kind === 'monthly')
                    ? (recurrence.kind as RecurrenceKind)
                    : null;
            const seriesId = recurrenceKind
                ? (typeof eventPayload.seriesId === 'string' && eventPayload.seriesId.length > 0
                    ? (eventPayload.seriesId as string)
                    : randomUUID())
                : null;
            const insertPayload = seriesId
                ? { ...(payload as Record<string, unknown>), seriesId }
                : payload;

            const entity = await createEntity({
                kind,
                scopeType,
                scopeId: normalizedScopeId,
                authorUserId: authRequest.user.userId,
                payload: insertPayload as SocialPayloadByKind[SocialEntityKind],
            });

            // Materialize follow-up occurrences for recurring events. Failures
            // here are non-fatal: the base event has already landed and the
            // user can hit `extend-series` afterwards. We log + continue so a
            // PG hiccup on row 17 of 26 doesn't roll back row 1.
            if (recurrenceKind && seriesId && typeof eventPayload.startsAt === 'string') {
                const occurrences = generateEventSeries(eventPayload.startsAt as string, {
                    kind: recurrenceKind,
                    until: typeof recurrence?.until === 'string' ? (recurrence.until as string) : undefined,
                    occurrencesAhead: typeof recurrence?.occurrencesAhead === 'number'
                        ? (recurrence.occurrencesAhead as number)
                        : undefined,
                });
                if (occurrences.length > 0) {
                    const durationMs = computeEventDurationMs({
                        startsAt: eventPayload.startsAt as string,
                        endsAt: typeof eventPayload.endsAt === 'string'
                            ? (eventPayload.endsAt as string)
                            : undefined,
                    });
                    for (const occurrenceStarts of occurrences) {
                        const occurrencePayload = buildOccurrencePayload(
                            insertPayload as SocialPayloadByKind['event'],
                            occurrenceStarts,
                            seriesId,
                            durationMs,
                        );
                        try {
                            await createEntity({
                                kind: 'event',
                                scopeType,
                                scopeId: normalizedScopeId,
                                authorUserId: authRequest.user.userId,
                                payload: occurrencePayload,
                            });
                        } catch (occurrenceError) {
                            request.log.warn(
                                occurrenceError,
                                `[Social] series occurrence create failed for ${seriesId} @ ${occurrenceStarts}`,
                            );
                        }
                    }
                }
            }

            // Re-fetch the aggregated view so the caller gets the same shape
            // that listEntitiesByScope returns. Fallback to a minimal view when
            // the read-back fails so create still succeeds.
            const view = await getEntityView(entity.id, authRequest.user.userId);
            return reply.status(201).send({
                success: true,
                data: {
                    id: entity.id,
                    entity: view ?? {
                        entity,
                        reactions: [],
                        myReactions: [],
                        commentCount: 0,
                        attachmentCount: 0,
                        isPinned: entity.pinned,
                    },
                },
            });
        } catch (error) {
            request.log.error(error, '[Social] createEntity failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Patch entity -----------------------------------------------------
    app.patch<{
        Params: { id: string };
        Body: { patch: Partial<SocialPayloadByKind[SocialEntityKind]> };
    }>('/social/entities/:id', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: patchEntityBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid patch payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await updateEntity(request.params.id, authRequest.user.userId, request.body.patch);
            const view = await getEntityView(request.params.id, authRequest.user.userId);
            if (!view) {
                return reply.status(404).send({
                    success: false,
                    error: 'entity not found',
                    errorCode: 'SOCIAL_NOT_FOUND',
                });
            }
            return reply.send({ success: true, data: { entity: view } });
        } catch (error) {
            request.log.error(error, '[Social] updateEntity failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Soft-delete entity -----------------------------------------------
    app.delete<{
        Params: { id: string };
        Querystring: { reason?: string };
    }>('/social/entities/:id', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, querystring: deleteQuerySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid entity id or reason',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await softDeleteEntity(request.params.id, authRequest.user.userId, request.query.reason);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] softDeleteEntity failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Restore entity ---------------------------------------------------
    app.post<{ Params: { id: string } }>('/social/entities/:id/restore', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid entity id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await restoreEntity(request.params.id, authRequest.user.userId);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] restoreEntity failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Pin / unpin ------------------------------------------------------
    app.post<{
        Params: { id: string };
        Body: { pinned: boolean };
    }>('/social/entities/:id/pin', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: pinBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid pin payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await pinEntity(request.params.id, authRequest.user.userId, Boolean(request.body.pinned));
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] pinEntity failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- List revisions ---------------------------------------------------
    // GET /social/entities/:id/revisions — newest-first edit history for an
    // entity. The service re-uses `getEntityView` as the access check, so a
    // missing / soft-deleted / forbidden entity surfaces as a 404 here. We
    // deliberately do NOT differentiate "missing" from "forbidden" to avoid
    // an existence leak (matches the moderation rule for other read paths).
    app.get<{ Params: { id: string }; Querystring: { limit?: number } }>(
        '/social/entities/:id/revisions',
        {
            preHandler: [app.authenticate as any],
            schema: {
                params: entityIdParamsSchema,
                querystring: listRevisionsQuerySchema,
            },
            attachValidation: true,
        },
        async (request, reply) => {
            if (request.validationError) {
                return reply.status(400).send({
                    success: false,
                    error: 'invalid entity id or limit',
                    errorCode: 'SOCIAL_VALIDATION_REQUIRED',
                });
            }
            try {
                const authRequest = request as AuthenticatedRequest;
                const revisions = await listRevisions(
                    request.params.id,
                    authRequest.user.userId,
                    typeof request.query.limit === 'number'
                        ? { limit: request.query.limit }
                        : undefined,
                );
                return reply.send({ success: true, data: { revisions } });
            } catch (error) {
                request.log.error(error, '[Social] listRevisions failed');
                return sendServiceError(reply, error);
            }
        },
    );

    // ----- List comments ----------------------------------------------------
    // GET shape mirrors the other list routes — wraps the array in
    // `{ comments: [...] }` so the client can extend the response with
    // pagination cursors later without breaking the call shape.
    // Returns `[]` for both missing-and-unknown entities and entities that
    // simply have no comments yet (service helper does not 404 — the UI can
    // render an empty thread on top of either case).
    app.get<{ Params: { id: string } }>('/social/entities/:id/comments', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid entity id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const comments = await listComments(request.params.id, authRequest.user.userId);
            return reply.send({ success: true, data: { comments } });
        } catch (error) {
            request.log.error(error, '[Social] listComments failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Add comment ------------------------------------------------------
    app.post<{
        Params: { id: string };
        Body: { body: string; parentCommentId?: string };
    }>('/social/entities/:id/comments', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: commentBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid comment payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        {
            const authRequest = request as AuthenticatedRequest;
            if (!allowSocialRequest(
                reply,
                `social-comment:${authRequest.user.userId}`,
                'SOCIAL_COMMENT_RATE_LIMIT_MAX',
                SOCIAL_COMMENT_RATE_MAX,
                'SOCIAL_COMMENT_RATE_LIMIT_WINDOW_SEC',
                SOCIAL_COMMENT_RATE_WINDOW_SEC,
            )) return reply;
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await addComment(
                request.params.id,
                authRequest.user.userId,
                request.body.body,
                request.body.parentCommentId,
            );
            return reply.status(201).send({ success: true, data: { id: result.id } });
        } catch (error) {
            request.log.error(error, '[Social] addComment failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Toggle reaction --------------------------------------------------
    app.post<{
        Params: { id: string };
        Body: { emoji: string };
    }>('/social/entities/:id/reactions', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: reactionBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid emoji',
                errorCode: 'SOCIAL_INVALID_EMOJI',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await toggleReaction(
                request.params.id,
                authRequest.user.userId,
                request.body.emoji,
            );
            return reply.send({
                success: true,
                data: {
                    added: result.added,
                    reactions: result.reactions,
                    mine: result.mine,
                },
            });
        } catch (error) {
            request.log.error(error, '[Social] toggleReaction failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- View tracking ----------------------------------------------------
    app.post<{ Params: { id: string } }>('/social/entities/:id/view', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid entity id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await recordView(request.params.id, authRequest.user.userId);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] recordView failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- List attachments -------------------------------------------------
    // Mirrors `GET .../comments` — returns `[]` for missing/empty entities so
    // the UI can render an empty list without a separate fetch.
    app.get<{ Params: { id: string } }>('/social/entities/:id/attachments', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid entity id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const attachments = await listAttachments(request.params.id, authRequest.user.userId);
            return reply.send({ success: true, data: { attachments } });
        } catch (error) {
            request.log.error(error, '[Social] listAttachments failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Attach file ------------------------------------------------------
    app.post<{
        Params: { id: string };
        Body: { fileId: string; mime?: string; sizeBytes?: number; sortOrder?: number };
    }>('/social/entities/:id/attachments', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: attachmentBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid attachment payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await attachFile(
                request.params.id,
                request.body.fileId,
                request.body.mime,
                request.body.sizeBytes,
                request.body.sortOrder,
                authRequest.user.userId,
            );
            return reply.status(201).send({ success: true, data: { id: result.id } });
        } catch (error) {
            request.log.error(error, '[Social] attachFile failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Universal text search across social entities ---------------------
    // Cross-scope ILIKE over `title | body | subject | note` jsonb fields.
    // Scope filtering + per-row authorization (group membership / dm peer)
    // happens inside the service so this handler stays a thin pass-through.
    app.get<{
        Querystring: { q: string; scopes?: string; kinds?: string; limit?: number };
    }>('/social/search', {
        preHandler: [app.authenticate as any],
        schema: { querystring: entitySearchQuerySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid search query',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;

            // Querystring lists are comma-separated; split + filter empties.
            // The AJV schema only validates that the whole string fits — the
            // per-token validation happens here (unknown enum values are
            // silently dropped to keep search forgiving for typos).
            const splitCsv = (raw: string | undefined): string[] =>
                typeof raw === 'string' && raw.length > 0
                    ? raw.split(',').map((part) => part.trim()).filter(Boolean)
                    : [];

            const allowedScopeTypes = new Set<SocialScopeType>(SCOPE_TYPES);
            const requestedScopes = splitCsv(request.query.scopes).filter(
                (s): s is SocialScopeType => allowedScopeTypes.has(s as SocialScopeType),
            );
            const allowedKinds = new Set<SocialEntityKind>(ENTITY_KINDS);
            const requestedKinds = splitCsv(request.query.kinds).filter(
                (k): k is SocialEntityKind => allowedKinds.has(k as SocialEntityKind),
            );

            const { results, total } = await searchSocialEntities(request.query.q, {
                viewerUserId: authRequest.user.userId,
                scopes: requestedScopes.length > 0 ? requestedScopes : undefined,
                kinds: requestedKinds.length > 0 ? requestedKinds : undefined,
                limit: request.query.limit,
            });

            return reply.send({ success: true, data: { results, total } });
        } catch (error) {
            request.log.error(error, '[Social] searchSocialEntities failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Search users for @mention autocomplete ---------------------------
    // Scope-bounded user-hint search. Group scopes pull active group members;
    // dm scopes resolve the peer of the room; everything else returns []
    // (we deliberately do not expose a global directory). The viewer is
    // always filtered out of the response. Always 200 — the UI renders the
    // dropdown over an empty list when nothing matches.
    app.get<{
        Querystring: { scope: string; q: string; limit?: number };
    }>('/social/users/search', {
        preHandler: [app.authenticate as any],
        schema: { querystring: userSearchQuerySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid search query',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const users = await searchSocialUsers(
                request.query.scope,
                request.query.q,
                authRequest.user.userId,
                request.query.limit,
            );
            return reply.send({ success: true, data: { users } });
        } catch (error) {
            request.log.error(error, '[Social] searchSocialUsers failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Remove attachment ------------------------------------------------
    // Owner-only (the parent entity's author). 204 on success, 403 if a
    // different user attempts the delete, 404 if the attachment is unknown.
    app.delete<{
        Params: { id: string; attachmentId: string };
    }>('/social/entities/:id/attachments/:attachmentId', {
        preHandler: [app.authenticate as any],
        schema: { params: attachmentIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid attachment id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await removeAttachment(request.params.attachmentId, authRequest.user.userId);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] removeAttachment failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Mark scope as read ----------------------------------------------
    // Upserts a per-viewer cursor on (scopeType, scopeId). Drives the unread
    // badge below. 204 on success; service-layer thrown errors map through
    // `sendServiceError` (invalid scopeType → 400, infra failure → 500).
    app.post<{
        Body: {
            scopeType: SocialScopeType;
            scopeId: string;
            lastEntityId?: string;
        };
    }>('/social/read', {
        preHandler: [app.authenticate as any],
        schema: { body: markScopeReadBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid read marker payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await markScopeRead(
                authRequest.user.userId,
                request.body.scopeType,
                request.body.scopeId,
                request.body.lastEntityId,
            );
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] markScopeRead failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Get unread counts for many scopes -------------------------------
    // Caller passes `?scopes=dm:r1,dm:r2,group:ITS-21`; we split + de-dup,
    // cap at MAX_UNREAD_SCOPES, and return a `counts` object that omits zero
    // entries (callers should treat missing keys as 0). Always 200 — invalid
    // / unknown scopes are silently dropped so a partially-bad query still
    // returns the rest of the counts.
    app.get<{
        Querystring: { scopes: string };
    }>('/social/unread', {
        preHandler: [app.authenticate as any],
        schema: { querystring: unreadCountsQuerySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid scopes query',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const raw = request.query.scopes
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
            const deduped = Array.from(new Set(raw)).slice(0, MAX_UNREAD_SCOPES);
            const counts = await getUnreadCountsBatch(authRequest.user.userId, deduped);
            const out: Record<string, number> = {};
            for (const [key, value] of counts.entries()) {
                if (value > 0) out[key] = value;
            }
            return reply.send({ success: true, data: { counts: out } });
        } catch (error) {
            request.log.error(error, '[Social] getUnreadCountsBatch failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Notification Center: list ---------------------------------------
    // Per-viewer feed of social mentions, joined with the parent entity (and
    // comment row, when applicable) so the UI can render a card with a
    // snippet + scope chip without a second round trip. Pagination is keyset:
    // pass the oldest `createdAt` from the previous page as `before`.
    app.get<{
        Querystring: { limit?: number; before?: string; unreadOnly?: boolean };
    }>('/social/notifications', {
        preHandler: [app.authenticate as any],
        schema: { querystring: listNotificationsQuerySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid notifications query',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const notifications = await listSocialNotifications(authRequest.user.userId, {
                limit: request.query.limit,
                before: request.query.before,
                unreadOnly: request.query.unreadOnly,
            });
            return reply.send({ success: true, data: { notifications } });
        } catch (error) {
            request.log.error(error, '[Social] listSocialNotifications failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Notification Center: mark a list of rows as read ----------------
    // 204 on success — the client already has the new state locally so the
    // server returns no body. Service-layer guards reject foreign-user ids.
    app.post<{
        Body: { ids: string[] };
    }>('/social/notifications/read', {
        preHandler: [app.authenticate as any],
        schema: { body: markNotificationsReadBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid notifications read payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await markNotificationsRead(authRequest.user.userId, request.body.ids);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] markNotificationsRead failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Notification Center: mark every unread row as read --------------
    // Body-less convenience endpoint for the "Mark all as read" button.
    app.post('/social/notifications/read-all', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            await markAllNotificationsRead(authRequest.user.userId);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] markAllNotificationsRead failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Notification Center: unread badge count -------------------------
    // Drives the navigation badge. Always 200 — failures fall through to a
    // structured 500 via `sendServiceError`. Frontend caps display at "99+".
    app.get('/social/notifications/unread-count', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const count = await getUnreadNotificationCount(authRequest.user.userId);
            return reply.send({ success: true, data: { count } });
        } catch (error) {
            request.log.error(error, '[Social] getUnreadNotificationCount failed');
            return sendServiceError(reply, error);
        }
    });

    // ===== Moderation =====================================================
    // Пользователь может пожаловаться на запись (reportEntity).

    // ----- Report an entity (any authenticated user) ----------------------
    app.post<{
        Params: { id: string };
        Body: { reason?: string };
    }>('/social/entities/:id/report', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: reportEntityBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid report payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        {
            // services/social-moderation.ts#reportEntity deliberately does NOT
            // dedupe reports — the throttle lives here.
            const authRequest = request as AuthenticatedRequest;
            if (!allowSocialRequest(
                reply,
                `social-report:${authRequest.user.userId}`,
                'SOCIAL_REPORT_RATE_LIMIT_MAX',
                SOCIAL_REPORT_RATE_MAX,
                'SOCIAL_REPORT_RATE_LIMIT_WINDOW_SEC',
                SOCIAL_REPORT_RATE_WINDOW_SEC,
            )) return reply;
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await reportEntity(
                request.params.id,
                authRequest.user.userId,
                request.body?.reason,
            );
            return reply.status(201).send({ success: true, data: { id: result.id } });
        } catch (error) {
            request.log.error(error, '[Social] reportEntity failed');
            return sendServiceError(reply, error);
        }
    });

    // ===== Polls ==========================================================
    // Voting cannot go through the generic `PATCH /entities/:id` because that
    // endpoint is owner-only — only the poll author could vote on their own
    // poll. Dedicated endpoints below let any scope member cast / unvote, and
    // restrict close to the author. The service layer enforces scope access.

    // ----- Vote on a poll --------------------------------------------------
    app.post<{
        Params: { id: string };
        Body: { optionId: string };
    }>('/social/polls/:id/vote', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: pollVoteBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid vote payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await votePollService(
                request.params.id,
                authRequest.user.userId,
                request.body.optionId,
            );
            return reply.send({
                success: true,
                data: { votes: result.votes, myVote: result.myVote },
            });
        } catch (error) {
            request.log.error(error, '[Social] votePoll failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Unvote (clear viewer's vote) ------------------------------------
    app.post<{ Params: { id: string } }>('/social/polls/:id/unvote', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid poll id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await unvotePollService(request.params.id, authRequest.user.userId);
            return reply.send({
                success: true,
                data: { votes: result.votes, myVote: result.myVote },
            });
        } catch (error) {
            request.log.error(error, '[Social] unvotePoll failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Close a poll (author only) --------------------------------------
    app.post<{ Params: { id: string } }>('/social/polls/:id/close', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid poll id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            await closePollService(request.params.id, authRequest.user.userId);
            return reply.status(204).send();
        } catch (error) {
            request.log.error(error, '[Social] closePoll failed');
            return sendServiceError(reply, error);
        }
    });

    // ===== Events RSVP ====================================================
    // RSVP cannot go through the generic `PATCH /entities/:id` because that
    // endpoint is owner-only — only the event author could RSVP on their own
    // event. Dedicated endpoints below let any scope member set / clear their
    // OWN RSVP. The userId is sourced from the JWT — there is no path to flip
    // another user's RSVP through these routes.

    // ----- Set / move RSVP status -----------------------------------------
    app.post<{
        Params: { id: string };
        Body: { status: RsvpStatus };
    }>('/social/events/:id/rsvp', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: rsvpBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid rsvp payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await rsvpService(
                request.params.id,
                authRequest.user.userId,
                request.body.status,
            );
            return reply.send({
                success: true,
                data: { rsvpStatus: result.rsvpStatus, mine: result.mine },
            });
        } catch (error) {
            request.log.error(error, '[Social] rsvp failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Clear viewer's RSVP --------------------------------------------
    app.post<{ Params: { id: string } }>('/social/events/:id/rsvp/clear', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid event id',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await clearRsvpService(request.params.id, authRequest.user.userId);
            return reply.send({
                success: true,
                data: { rsvpStatus: result.rsvpStatus, mine: result.mine },
            });
        } catch (error) {
            request.log.error(error, '[Social] clearRsvp failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Extend recurring event series ---------------------------------
    // Author-only. Loads the series owning `:id` (any occurrence works),
    // walks from the latest occurrence forward, and creates `additional`
    // more rows (capped at MAX_SERIES_OCCURRENCES). Idempotent in the sense
    // that hitting it twice creates the next `additional` rows each time —
    // the frontend "Load more future occurrences" affordance can drive it
    // directly. Returns the created entity list + the new latest startsAt.
    app.post<{
        Params: { id: string };
        Body: { additional?: number };
    }>('/social/events/:id/extend-series', {
        preHandler: [app.authenticate as any],
        schema: { params: entityIdParamsSchema, body: extendSeriesBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid extend-series payload',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const additional = typeof request.body?.additional === 'number'
                ? request.body.additional
                : 12;
            const result = await extendEventSeries(
                request.params.id,
                authRequest.user.userId,
                additional,
            );
            return reply.send({
                success: true,
                data: {
                    seriesId: result.seriesId,
                    nextStartsAt: result.nextStartsAt,
                    createdIds: result.created.map((e) => e.id),
                    createdCount: result.created.length,
                },
            });
        } catch (error) {
            request.log.error(error, '[Social] extendEventSeries failed');
            return sendServiceError(reply, error);
        }
    });

    // ----- Link preview / unfurl ------------------------------------------
    // Returns Open Graph metadata for a URL found in a social entity body.
    // Auth-required + rate-limited (10/min per viewer) — preview fetches go
    // to arbitrary public hosts, so the rate limit caps both upstream load
    // and the SSRF probe attack surface.
    app.get<{ Querystring: { url?: string } }>('/social/link-preview', {
        preHandler: [app.authenticate as any],
        schema: {
            querystring: {
                type: 'object',
                required: ['url'],
                properties: {
                    url: { type: 'string', minLength: 1, maxLength: 2048 },
                },
            },
        },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'invalid url',
                errorCode: 'SOCIAL_VALIDATION_REQUIRED',
            });
        }
        const authRequest = request as AuthenticatedRequest;
        const rl = consumeRateLimit(
            `social-link-preview:${authRequest.user.userId}`,
            10,
            60_000,
        );
        if (!rl.allowed) {
            return reply.status(429).send({
                success: false,
                error: 'rate limited',
                errorCode: 'SOCIAL_RATE_LIMITED',
                retryAfterSec: rl.retryAfterSec,
            });
        }
        try {
            const preview = await fetchLinkPreview(request.query.url ?? '');
            return reply.send({ success: true, data: { preview } });
        } catch (error) {
            request.log.error(error, '[Social] link-preview failed');
            return sendServiceError(reply, error);
        }
    });
}
