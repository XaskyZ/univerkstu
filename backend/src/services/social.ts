/**
 * Universal social entity service — Phase 1b.
 *
 * This module is the contract surface for the universal social model
 * (see docs/SOCIAL_STORE.md and backend/src/types/social.ts).
 *
 * Phase 1a delivered the pure helpers (validators, mention extraction,
 * scope_id construction, emoji allow-list). Phase 1b — implemented here —
 * fills in the real Postgres-backed CRUD against `app_social_entity` and
 * the five cross-cutting tables (`app_social_comment`,
 * `app_social_reaction`, `app_social_mention`, `app_social_attachment`,
 * `app_social_revision`).
 *
 * Nothing in the rest of the codebase calls these CRUD methods yet — the
 * backward-compatibility shim lands in Phase 1c. The methods are designed
 * to be called directly from future routes once the wiring is added.
 *
 * Authorization model (Phase 1b): the service performs an owner-only check
 * on update/delete/restore. RBAC bypass for coordinator/curator/admin will
 * be added in Phase 1c at the route layer (or via an actor-role argument
 * passed in). Pin is gated the same way as update — owner-only here.
 */

import { EventEmitter } from 'node:events';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { assertCanReadGroup } from './group-space.js';
import { prefetchLinkPreviewForText } from './link-previews.js';
import { parseDirectRoomId } from './messaging.js';
import type {
    SocialComment,
    SocialEntity,
    SocialEntityKind,
    SocialEntityView,
    SocialPayloadByKind,
    SocialScopeType,
} from '../types/social.js';

/**
 * Cross-cutting event bus for the social store. Sinks (push notifications,
 * future audit log, etc.) subscribe to lifecycle events without coupling
 * `services/social.ts` to those concerns. Listeners are invoked synchronously
 * by EventEmitter; if they return a Promise the rejection surfaces as an
 * unhandled rejection — sinks must catch their own errors so a failing
 * notification path does not fail the originating CRUD call.
 *
 * Events:
 *   'entity-created'   payload: SocialEntity
 *   'comment-created'  payload: { comment: SocialComment, parentEntity: SocialEntity }
 */
export const socialEvents = new EventEmitter();
// Default maxListeners is 10; we keep that — at present there is one sink
// (services/social-events.ts) and we do not expect many more.

// === Limits ==================================================================

export const SOCIAL_BODY_MAX_LENGTH = 4000;
export const SOCIAL_TITLE_MAX_LENGTH = 200;
export const SOCIAL_COMMENT_MAX_LENGTH = 2000;
export const SOCIAL_COMMENT_MAX_DEPTH = 1;

// === Reaction allow-list =====================================================

/**
 * Mirrors `ALLOWED_EMOJI` in services/group-reactions.ts. Re-declared here
 * because the universal model spans every entity kind (not just group feed
 * posts) and we want to keep the existing per-feature service independent
 * during the additive Phase 1a/1b rollout.
 */
const ALLOWED_REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '😢'] as const;
export type AllowedReactionEmoji = (typeof ALLOWED_REACTION_EMOJI)[number];

export function isAllowedReactionEmoji(value: string): value is AllowedReactionEmoji {
    return (ALLOWED_REACTION_EMOJI as readonly string[]).includes(value);
}

// === Validators ==============================================================

function assertString(input: unknown, field: string): string {
    if (typeof input !== 'string') {
        throw new Error(`${field} must be a string`);
    }
    return input;
}

/** Trim, enforce non-empty, enforce body-length cap. */
export function validateBody(input: unknown): string {
    const raw = assertString(input, 'body');
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        throw new Error('body must not be empty');
    }
    if (trimmed.length > SOCIAL_BODY_MAX_LENGTH) {
        throw new Error(`body must be ≤ ${SOCIAL_BODY_MAX_LENGTH} characters`);
    }
    return trimmed;
}

/** Trim, enforce non-empty, enforce title-length cap. */
export function validateTitle(input: unknown): string {
    const raw = assertString(input, 'title');
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        throw new Error('title must not be empty');
    }
    if (trimmed.length > SOCIAL_TITLE_MAX_LENGTH) {
        throw new Error(`title must be ≤ ${SOCIAL_TITLE_MAX_LENGTH} characters`);
    }
    return trimmed;
}

/** Trim, enforce non-empty, enforce comment-length cap. */
export function validateCommentBody(input: unknown): string {
    const raw = assertString(input, 'comment body');
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        throw new Error('comment body must not be empty');
    }
    if (trimmed.length > SOCIAL_COMMENT_MAX_LENGTH) {
        throw new Error(`comment body must be ≤ ${SOCIAL_COMMENT_MAX_LENGTH} characters`);
    }
    return trimmed;
}

// === Mention extraction ======================================================

/**
 * Find @handles in arbitrary user text. Returns unique handles preserving
 * first-occurrence order.
 *
 * Handle rules (deliberately conservative — false negatives are safer than
 * false positives because mentions trigger notifications):
 *   - prefix `@` must NOT be preceded by an alphanumeric character (so the
 *     `gmail` part of `user@gmail.com` is NOT a handle)
 *   - the handle itself is `[A-Za-z0-9_]{1,}` followed by an optional
 *     suffix of letters/digits/underscores; `.` and other punctuation
 *     terminate the handle so `@name.dot` only captures `name`
 *   - a bare `@` with no characters after it is ignored
 *   - purely-numeric handles (e.g. `@1`) are accepted — student logins in
 *     this product can be numeric strings.
 */
export function extractMentions(body: string): string[] {
    if (typeof body !== 'string' || body.length === 0) return [];
    // Negative-lookbehind on `[A-Za-z0-9]` to skip email local parts. After
    // `@` we capture word chars greedily.
    const re = /(?<![A-Za-z0-9])@([A-Za-z0-9_]+)/g;
    const seen = new Set<string>();
    const out: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = re.exec(body)) !== null) {
        const handle = match[1];
        if (!handle) continue;
        if (seen.has(handle)) continue;
        seen.add(handle);
        out.push(handle);
    }
    return out;
}

// === Scope identifier ========================================================

/**
 * Build the canonical scope_id used in app_social_entity. The raw value may
 * already include its own type prefix (e.g. `"group:ITS-21"`); in that case
 * we accept it verbatim so callers can pass already-normalized identifiers
 * without double-prefixing.
 *
 * Examples:
 *   buildScopeId('group', 'ITS-21')        → 'group:ITS-21'
 *   buildScopeId('group', 'group:ITS-21')  → 'group:ITS-21'  (idempotent)
 *   buildScopeId('dm', 'roomId')           → 'dm:roomId'
 *   buildScopeId('global', 'global')       → 'global:global'
 */
export function buildScopeId(scopeType: SocialScopeType, raw: string): string {
    if (typeof raw !== 'string') {
        throw new Error('scope raw id must be a string');
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        throw new Error('scope raw id must not be empty');
    }
    const prefix = `${scopeType}:`;
    if (trimmed.startsWith(prefix)) {
        return trimmed;
    }
    return `${prefix}${trimmed}`;
}

// === Scope access ============================================================

/**
 * Проверка права пользователя на доступ к scope перед чтением/созданием
 * сущностей:
 *   - `global` / `announcement` — публичные scope, доступны любому
 *     аутентифицированному пользователю, дополнительных проверок нет;
 *   - `dm` — пользователь должен быть одним из двух участников комнаты
 *     `direct:<low>::<high>` (scope_id хранится как `dm:direct:...`,
 *     см. buildScopeId + services/messaging.ts#buildDirectRoomId);
 *   - `group` — членство/роль проверяет существующая `assertCanReadGroup`
 *     из services/group-space.ts (бросает Error('Forbidden') при отказе).
 *
 * Пустой userId трактуется как неаутентифицированный вызов — отказ.
 * Бросает Error('forbidden') в стиле остальных ошибок сервиса — маршрутный
 * слой маппит её в 403 SOCIAL_FORBIDDEN (см. routes/social.ts#mapServiceError).
 */
export async function assertScopeAccess(
    scopeType: SocialScopeType,
    scopeId: string,
    userId: string,
): Promise<void> {
    const trimmedUserId = (userId || '').trim();
    if (!trimmedUserId) throw new Error('forbidden');

    switch (scopeType) {
        case 'global':
        case 'announcement':
            // Публичные scope — доступ всем аутентифицированным
            return;
        case 'dm': {
            // scope_id хранится как `dm:direct:<low>::<high>`; допускаем и
            // «голый» вариант `direct:...` без префикса `dm:` — так же, как
            // это делает isSocialSearchHitVisible ниже.
            const raw = scopeId.startsWith('dm:') ? scopeId.slice(3) : scopeId;
            const direct = parseDirectRoomId(raw);
            if (!direct || (trimmedUserId !== direct.low && trimmedUserId !== direct.high)) {
                throw new Error('forbidden');
            }
            return;
        }
        case 'group': {
            // scope_id хранится как `group:<ключ>`; assertCanReadGroup ждёт
            // голый ключ группы без префикса.
            const rawKey = scopeId.startsWith('group:') ? scopeId.slice('group:'.length) : scopeId;
            try {
                await assertCanReadGroup(trimmedUserId, rawKey);
            } catch {
                // assertCanReadGroup бросает Error('Forbidden') с заглавной
                // буквы; нормализуем к общему для сервиса 'forbidden', как это
                // уже делает services/social-polls.ts#assertCanVoteOnPoll.
                // mapServiceError сравнивает в нижнем регистре, так что HTTP-код
                // не меняется — но вызывающие внутри сервиса могут теперь
                // надёжно отличать отказ доступа от прочих ошибок.
                throw new Error('forbidden');
            }
            return;
        }
        default:
            // Неизвестный тип scope — отказ по умолчанию
            throw new Error('forbidden');
    }
}

// === Internal helpers ========================================================

/**
 * Bridge to `withSupabasePostgres` that throws when the pool is unavailable.
 * Mirrors the pattern from services/group-space.ts so failures surface as
 * loud errors at the route layer instead of returning silent nulls.
 */
async function requireSocialPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Social] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

type EntityRow = {
    id: string;
    kind: string;
    scope_type: string;
    scope_id: string;
    author_user_id: string;
    payload: unknown;
    pinned: boolean;
    created_at: Date | string;
    updated_at: Date | string;
    deleted_at: Date | string | null;
    deleted_by_user_id: string | null;
    deleted_reason: string | null;
};

function toIso(value: Date | string | null): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function mapEntityRow<K extends SocialEntityKind>(row: EntityRow): SocialEntity<K> {
    return {
        id: row.id,
        kind: row.kind as K,
        scopeType: row.scope_type as SocialScopeType,
        scopeId: row.scope_id,
        authorUserId: row.author_user_id,
        payload: (row.payload ?? {}) as SocialPayloadByKind[K],
        pinned: Boolean(row.pinned),
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
        updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
        deletedAt: toIso(row.deleted_at),
        deletedByUserId: row.deleted_by_user_id,
        deletedReason: row.deleted_reason,
    };
}

/**
 * Загрузить строку сущности по id и проверить, что вызывающий имеет доступ к
 * её scope. Единая точка контроля для всех by-id путей (комментарии, реакции,
 * вложения, ревизии, просмотры) — раньше каждый из них читал сущность по UUID
 * без единой проверки членства, из-за чего исключённый из группы пользователь
 * или заблокированный собеседник продолжали читать/писать по известному id.
 *
 * Контракт:
 *   - строки нет → `null` (вызывающий сам решает: 404 или пустой список);
 *   - строка есть, но scope недоступен → бросает Error('forbidden')
 *     (тот же shape, что и `assertScopeAccess`, маршрут маппит в 403
 *     SOCIAL_FORBIDDEN);
 *   - soft-delete здесь НЕ фильтруется — у вызывающих разные правила
 *     (getEntityView скрывает удалённые, recordView/attach — свои).
 *
 * `announcement` / `global` остаются публичными для любого аутентифицированного
 * пользователя — доска объявлений (services/board.ts, scope `announcement`)
 * продолжает работать без изменений.
 */
async function loadEntityRowWithScopeAccess(
    client: PoolClient,
    entityId: string,
    viewerUserId: string,
): Promise<EntityRow | null> {
    const result = await client.query<EntityRow>(
        `select * from app_social_entity where id = $1::uuid`,
        [entityId],
    );
    if (result.rowCount === 0) return null;
    const row = result.rows[0];
    await assertScopeAccess(row.scope_type as SocialScopeType, row.scope_id, viewerUserId);
    return row;
}

/**
 * Pull the free-text fields out of a payload that the mention extractor
 * should scan. Different kinds put their primary text in different places
 * (post.body, poll.question, etc.); concatenate them so mentions inside any
 * field are picked up.
 */
function payloadTextForMentions(payload: unknown): string {
    if (!payload || typeof payload !== 'object') return '';
    const parts: string[] = [];
    const obj = payload as Record<string, unknown>;
    for (const key of ['title', 'body', 'question', 'subject', 'note', 'location']) {
        const value = obj[key];
        if (typeof value === 'string' && value.length > 0) {
            parts.push(value);
        }
    }
    return parts.join('\n');
}

async function insertMentions(
    client: PoolClient,
    args: {
        entityId: string;
        sourceKind: 'entity' | 'comment';
        sourceId: string;
        authorUserId: string;
        handles: string[];
        skipHandles?: Set<string>;
    },
): Promise<void> {
    const fresh = args.handles.filter((h) => !args.skipHandles?.has(h));
    if (fresh.length === 0) return;
    for (const handle of fresh) {
        await client.query(
            `
                insert into app_social_mention
                    (entity_id, source_kind, source_id, author_user_id, mentioned_user_id)
                values ($1, $2, $3, $4, $5)
            `,
            [args.entityId, args.sourceKind, args.sourceId, args.authorUserId, handle],
        );
    }
}

async function insertRevision(
    client: PoolClient,
    args: {
        entityId: string;
        authorUserId: string;
        snapshot: unknown;
        revisionKind: 'create' | 'update' | 'delete' | 'restore';
        note?: string | null;
    },
): Promise<void> {
    await client.query(
        `
            insert into app_social_revision
                (entity_id, author_user_id, snapshot, revision_kind, note)
            values ($1, $2, $3::jsonb, $4, $5)
        `,
        [
            args.entityId,
            args.authorUserId,
            JSON.stringify(args.snapshot ?? {}),
            args.revisionKind,
            args.note ?? null,
        ],
    );
}

// === CRUD ====================================================================

export interface CreateEntityInput<K extends SocialEntityKind> {
    kind: K;
    scopeType: SocialScopeType;
    scopeId: string;
    authorUserId: string;
    payload: SocialPayloadByKind[K];
}

/**
 * Create an entity: INSERT row, persist mentions, write a 'create' revision.
 * The payload is stored verbatim — callers are expected to have already run
 * per-kind validation (e.g. validateBody / validateTitle).
 */
export async function createEntity<K extends SocialEntityKind>(
    input: CreateEntityInput<K>,
): Promise<SocialEntity<K>> {
    const trimmedAuthor = (input.authorUserId || '').trim();
    if (!trimmedAuthor) throw new Error('authorUserId is required');
    const trimmedScopeId = (input.scopeId || '').trim();
    if (!trimmedScopeId) throw new Error('scopeId is required');

    // Контроль доступа: автор должен иметь право писать в этот scope
    // (участник dm-комнаты / член группы; публичные scope открыты всем).
    await assertScopeAccess(input.scopeType, trimmedScopeId, trimmedAuthor);

    const entity = await requireSocialPostgres('createEntity', async (client) => {
        const insert = await client.query<EntityRow>(
            `
                insert into app_social_entity
                    (kind, scope_type, scope_id, author_user_id, payload, pinned)
                values ($1, $2, $3, $4, $5::jsonb, false)
                returning *
            `,
            [
                input.kind,
                input.scopeType,
                trimmedScopeId,
                trimmedAuthor,
                JSON.stringify(input.payload ?? {}),
            ],
        );
        const row = insert.rows[0];
        const created = mapEntityRow<K>(row);

        const handles = extractMentions(payloadTextForMentions(input.payload));
        await insertMentions(client, {
            entityId: created.id,
            sourceKind: 'entity',
            sourceId: created.id,
            authorUserId: trimmedAuthor,
            handles,
        });

        await insertRevision(client, {
            entityId: created.id,
            authorUserId: trimmedAuthor,
            snapshot: input.payload,
            revisionKind: 'create',
        });

        return created;
    });

    // Fan-out lifecycle event (push notifications, etc.). Emit after the DB
    // block so listeners observe a fully committed entity. Listener errors
    // must be swallowed inside each sink — we do not want a failing
    // notification path to fail entity creation.
    socialEvents.emit('entity-created', entity);

    // Background link-preview prefetch — best-effort cache warm-up so the
    // first viewer of a freshly-posted entity gets a populated unfurl card
    // without paying the cold-fetch latency on render. Fire-and-forget; any
    // failure is swallowed inside prefetchLinkPreviewForText.
    prefetchLinkPreviewForText(payloadTextForMentions(input.payload));

    return entity;
}

/**
 * Owner-only update: merge `patch` into the existing payload, persist mention
 * diff (only new handles get a new row), record an 'update' revision.
 * Throws 'forbidden' when the actor is not the original author.
 * Throws 'not found' when the entity does not exist or has been soft-deleted.
 */
export async function updateEntity<K extends SocialEntityKind>(
    id: string,
    actorUserId: string,
    patch: Partial<SocialPayloadByKind[K]>,
): Promise<SocialEntity<K>> {
    const trimmedId = (id || '').trim();
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedId) throw new Error('id is required');
    if (!trimmedActor) throw new Error('actorUserId is required');

    return requireSocialPostgres('updateEntity', async (client) => {
        const existing = await client.query<EntityRow>(
            `select * from app_social_entity where id = $1::uuid`,
            [trimmedId],
        );
        if (existing.rowCount === 0) throw new Error('not found');
        const current = existing.rows[0];
        if (current.deleted_at) throw new Error('not found');
        if (current.author_user_id !== trimmedActor) throw new Error('forbidden');

        const existingPayload = (current.payload ?? {}) as Record<string, unknown>;
        const mergedPayload = { ...existingPayload, ...(patch as Record<string, unknown>) };

        const updated = await client.query<EntityRow>(
            `
                update app_social_entity
                set payload = $2::jsonb, updated_at = now()
                where id = $1::uuid
                returning *
            `,
            [trimmedId, JSON.stringify(mergedPayload)],
        );
        const entity = mapEntityRow<K>(updated.rows[0]);

        // Mention diff: only insert handles that did not already exist as
        // entity-source mentions for this entity.
        const oldHandles = extractMentions(payloadTextForMentions(existingPayload));
        const newHandles = extractMentions(payloadTextForMentions(mergedPayload));
        const skip = new Set(oldHandles);
        await insertMentions(client, {
            entityId: entity.id,
            sourceKind: 'entity',
            sourceId: entity.id,
            authorUserId: trimmedActor,
            handles: newHandles,
            skipHandles: skip,
        });

        await insertRevision(client, {
            entityId: entity.id,
            authorUserId: trimmedActor,
            snapshot: mergedPayload,
            revisionKind: 'update',
        });

        return entity;
    });
}

/**
 * Soft-delete: mark `deleted_at` with the actor's id and an optional reason.
 * Record a 'delete' revision so the moderation trail is preserved.
 * Throws 'forbidden' when the actor is not the original author.
 */
export async function softDeleteEntity(
    id: string,
    actorUserId: string,
    reason?: string,
): Promise<void> {
    const trimmedId = (id || '').trim();
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedId) throw new Error('id is required');
    if (!trimmedActor) throw new Error('actorUserId is required');

    await requireSocialPostgres('softDeleteEntity', async (client) => {
        const existing = await client.query<EntityRow>(
            `select * from app_social_entity where id = $1::uuid`,
            [trimmedId],
        );
        if (existing.rowCount === 0) throw new Error('not found');
        const current = existing.rows[0];
        if (current.deleted_at) return null; // already deleted — idempotent
        if (current.author_user_id !== trimmedActor) throw new Error('forbidden');

        await client.query(
            `
                update app_social_entity
                set deleted_at = now(),
                    deleted_by_user_id = $2,
                    deleted_reason = $3,
                    updated_at = now()
                where id = $1::uuid
            `,
            [trimmedId, trimmedActor, reason ?? null],
        );

        await insertRevision(client, {
            entityId: trimmedId,
            authorUserId: trimmedActor,
            snapshot: current.payload ?? {},
            revisionKind: 'delete',
            note: reason ?? null,
        });
        return null;
    });
}

/**
 * Restore a previously soft-deleted entity. Clears deletion bookkeeping and
 * records a 'restore' revision. Owner-only (Phase 1c will add admin/curator
 * bypass at the route layer).
 */
export async function restoreEntity(id: string, actorUserId: string): Promise<void> {
    const trimmedId = (id || '').trim();
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedId) throw new Error('id is required');
    if (!trimmedActor) throw new Error('actorUserId is required');

    await requireSocialPostgres('restoreEntity', async (client) => {
        const existing = await client.query<EntityRow>(
            `select * from app_social_entity where id = $1::uuid`,
            [trimmedId],
        );
        if (existing.rowCount === 0) throw new Error('not found');
        const current = existing.rows[0];
        if (!current.deleted_at) return null; // already live — idempotent
        if (current.author_user_id !== trimmedActor) throw new Error('forbidden');

        await client.query(
            `
                update app_social_entity
                set deleted_at = null,
                    deleted_by_user_id = null,
                    deleted_reason = null,
                    updated_at = now()
                where id = $1::uuid
            `,
            [trimmedId],
        );

        await insertRevision(client, {
            entityId: trimmedId,
            authorUserId: trimmedActor,
            snapshot: current.payload ?? {},
            revisionKind: 'restore',
        });
        return null;
    });
}

/**
 * Pin / unpin. Owner-only here; metadata change so we deliberately do NOT
 * write a revision (revisions track payload edits, not surface state).
 */
export async function pinEntity(
    id: string,
    actorUserId: string,
    pinned: boolean,
): Promise<void> {
    const trimmedId = (id || '').trim();
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedId) throw new Error('id is required');
    if (!trimmedActor) throw new Error('actorUserId is required');

    await requireSocialPostgres('pinEntity', async (client) => {
        const existing = await client.query<EntityRow>(
            `select author_user_id, deleted_at from app_social_entity where id = $1::uuid`,
            [trimmedId],
        );
        if (existing.rowCount === 0) throw new Error('not found');
        const current = existing.rows[0];
        if (current.deleted_at) throw new Error('not found');
        if (current.author_user_id !== trimmedActor) throw new Error('forbidden');

        await client.query(
            `update app_social_entity set pinned = $2, updated_at = now() where id = $1::uuid`,
            [trimmedId, pinned],
        );
        return null;
    });
}

// === Read paths ==============================================================

export interface ListEntitiesOptions {
    kind?: SocialEntityKind;
    viewerUserId?: string;
    limit?: number;
    offset?: number;
    includeDeleted?: boolean;
    pinnedFirst?: boolean;
    favoriteOnly?: boolean;
}

type AggregateRow = {
    id: string;
    reaction_emojis: string[] | null;
    reaction_counts: string[] | null;
    comment_count: string | null;
    attachment_count: string | null;
    view_count: string | null;
};

type MineRow = { entity_id: string; emoji: string };

async function fetchAggregates(
    client: PoolClient,
    entityIds: string[],
): Promise<Map<string, { reactions: Array<{ emoji: string; count: number }>; commentCount: number; attachmentCount: number; viewCount: number }>> {
    const out = new Map<
        string,
        { reactions: Array<{ emoji: string; count: number }>; commentCount: number; attachmentCount: number; viewCount: number }
    >();
    if (entityIds.length === 0) return out;

    const result = await client.query<AggregateRow>(
        `
            select
                e.id::text as id,
                coalesce(r.emojis, '{}') as reaction_emojis,
                coalesce(r.counts, '{}') as reaction_counts,
                coalesce(c.comment_count, 0)::text as comment_count,
                coalesce(a.attachment_count, 0)::text as attachment_count,
                coalesce(v.view_count, 0)::text as view_count
            from app_social_entity e
            left join lateral (
                select
                    array_agg(emoji order by emoji) as emojis,
                    array_agg(count::text order by emoji) as counts
                from (
                    select emoji, count(*) as count
                    from app_social_reaction
                    where entity_id = e.id
                    group by emoji
                ) g
            ) r on true
            left join (
                select entity_id, count(*) as comment_count
                from app_social_comment
                where deleted_at is null
                group by entity_id
            ) c on c.entity_id = e.id
            left join (
                select entity_id, count(*) as attachment_count
                from app_social_attachment
                group by entity_id
            ) a on a.entity_id = e.id
            left join (
                select entity_id, count(*) as view_count
                from app_social_view
                group by entity_id
            ) v on v.entity_id = e.id
            where e.id = any($1::uuid[])
        `,
        [entityIds],
    );

    for (const row of result.rows) {
        const emojis = row.reaction_emojis ?? [];
        const counts = row.reaction_counts ?? [];
        const reactions: Array<{ emoji: string; count: number }> = [];
        for (let i = 0; i < emojis.length; i++) {
            const emoji = emojis[i];
            const count = Number(counts[i] ?? 0) || 0;
            if (count > 0 && emoji) {
                reactions.push({ emoji, count });
            }
        }
        out.set(row.id, {
            reactions,
            commentCount: Number(row.comment_count ?? 0) || 0,
            attachmentCount: Number(row.attachment_count ?? 0) || 0,
            viewCount: Number(row.view_count ?? 0) || 0,
        });
    }
    return out;
}

async function fetchViewerReactions(
    client: PoolClient,
    entityIds: string[],
    viewerUserId: string,
): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (entityIds.length === 0 || !viewerUserId) return out;
    const result = await client.query<MineRow>(
        `
            select entity_id::text as entity_id, emoji
            from app_social_reaction
            where user_id = $1 and entity_id = any($2::uuid[])
        `,
        [viewerUserId, entityIds],
    );
    for (const row of result.rows) {
        const bucket = out.get(row.entity_id) || [];
        bucket.push(row.emoji);
        out.set(row.entity_id, bucket);
    }
    return out;
}

async function fetchViewerSeenEntities(
    client: PoolClient,
    entityIds: string[],
    viewerUserId: string,
): Promise<Set<string>> {
    const out = new Set<string>();
    if (entityIds.length === 0 || !viewerUserId) return out;
    const result = await client.query<{ entity_id: string }>(
        `
            select entity_id::text as entity_id
            from app_social_view
            where user_id = $1 and entity_id = any($2::uuid[])
        `,
        [viewerUserId, entityIds],
    );
    for (const row of result.rows) {
        if (row.entity_id) out.add(row.entity_id);
    }
    return out;
}

/**
 * Paginated, scope-filtered list of entities. Joins aggregate reaction
 * counts, comment counts and attachment counts. If a viewer is supplied the
 * resulting `myReactions` is populated for that user; otherwise it's [].
 */
export async function listEntitiesByScope(
    scopeType: SocialScopeType,
    scopeId: string,
    opts?: ListEntitiesOptions,
): Promise<SocialEntityView[]> {
    const trimmedScopeId = (scopeId || '').trim();
    if (!trimmedScopeId) return [];

    const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
    const offset = Math.max(0, opts?.offset ?? 0);
    const includeDeleted = Boolean(opts?.includeDeleted);
    const pinnedFirst = opts?.pinnedFirst !== false; // default on
    const kindFilter = opts?.kind ?? null;
    const viewerUserId = (opts?.viewerUserId || '').trim();
    const favoriteOnly = Boolean(opts?.favoriteOnly && viewerUserId);

    // Контроль доступа к scope: пустой viewerUserId — неаутентифицированный
    // путь, тоже отказ. Публичные scope (global/announcement) проходят всегда.
    await assertScopeAccess(scopeType, trimmedScopeId, viewerUserId);

    return requireSocialPostgres('listEntitiesByScope', async (client) => {
        const params: unknown[] = [scopeType, trimmedScopeId];
        let where = `scope_type = $1 and scope_id = $2`;
        if (!includeDeleted) {
            where += ` and deleted_at is null`;
        }
        if (kindFilter) {
            params.push(kindFilter);
            where += ` and kind = $${params.length}`;
        }
        if (favoriteOnly) {
            params.push(viewerUserId);
            where += ` and exists (
                select 1 from app_social_favorite f
                where f.entity_id = app_social_entity.id and f.user_id = $${params.length}
            )`;
        }
        params.push(limit);
        const limitIdx = params.length;
        params.push(offset);
        const offsetIdx = params.length;

        const orderBy = pinnedFirst
            ? `order by pinned desc, created_at desc`
            : `order by created_at desc`;

        const rows = await client.query<EntityRow>(
            `
                select * from app_social_entity
                where ${where}
                ${orderBy}
                limit $${limitIdx} offset $${offsetIdx}
            `,
            params,
        );

        const entities = rows.rows.map((row) => mapEntityRow(row));
        if (entities.length === 0) return [];

        const ids = entities.map((e) => e.id);
        const [aggregates, viewerReactions, viewerSeen] = await Promise.all([
            fetchAggregates(client, ids),
            viewerUserId ? fetchViewerReactions(client, ids, viewerUserId) : Promise.resolve(new Map<string, string[]>()),
            viewerUserId ? fetchViewerSeenEntities(client, ids, viewerUserId) : Promise.resolve(new Set<string>()),
        ]);

        return entities.map<SocialEntityView>((entity) => {
            const agg = aggregates.get(entity.id);
            return {
                entity,
                reactions: agg?.reactions ?? [],
                myReactions: viewerReactions.get(entity.id) ?? [],
                commentCount: agg?.commentCount ?? 0,
                attachmentCount: agg?.attachmentCount ?? 0,
                isPinned: entity.pinned,
                viewCount: agg?.viewCount ?? 0,
                hasViewed: viewerSeen.has(entity.id),
            };
        });
    });
}

// === Revision history ========================================================

/**
 * Shape of a single revision row returned to the route layer / frontend. Mirrors
 * `app_social_revision` 1:1 but normalizes timestamps to ISO and the snapshot
 * column to a plain object so callers don't have to know about the underlying
 * `jsonb` representation.
 */
export interface SocialRevisionView {
    id: string;
    entityId: string;
    authorUserId: string;
    snapshot: Record<string, unknown>;
    revisionKind: 'create' | 'update' | 'delete' | 'restore';
    note: string | null;
    createdAt: string;
}

/**
 * Hard cap on the number of revisions returned in a single page. Higher caps
 * would let a malicious caller pull the entire history of a long-lived entity
 * in one round-trip; lower caps would force pagination noise on the UI for
 * mostly-stable entities. 100 is a compromise that still fits a single modal
 * scroll without paging in the common case.
 */
export const SOCIAL_REVISION_MAX_LIMIT = 100;
export const SOCIAL_REVISION_DEFAULT_LIMIT = 50;

type RevisionRow = {
    id: string;
    entity_id: string;
    author_user_id: string;
    snapshot: unknown;
    revision_kind: string;
    note: string | null;
    created_at: Date | string;
};

function mapRevisionRow(row: RevisionRow): SocialRevisionView {
    const kind = row.revision_kind === 'create'
        || row.revision_kind === 'update'
        || row.revision_kind === 'delete'
        || row.revision_kind === 'restore'
        ? row.revision_kind
        : 'update';
    return {
        id: row.id,
        entityId: row.entity_id,
        authorUserId: row.author_user_id,
        snapshot: (row.snapshot ?? {}) as Record<string, unknown>,
        revisionKind: kind,
        note: row.note ?? null,
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    };
}

/**
 * List revision history for an entity. Visibility is enforced by re-using the
 * same access check that gates `getEntityView` — if the viewer can read the
 * entity they can read its revisions. Throws 'not found' for missing / soft-
 * deleted / forbidden entities (we deliberately do NOT differentiate the three
 * cases at the route layer to avoid leaking existence).
 *
 * Results are ordered newest-first so the UI can render the timeline without
 * an in-memory reverse. `limit` is clamped into [1, SOCIAL_REVISION_MAX_LIMIT].
 */
export async function listRevisions(
    entityId: string,
    viewerUserId: string,
    opts?: { limit?: number },
): Promise<SocialRevisionView[]> {
    const trimmedId = (entityId || '').trim();
    if (!trimmedId) return [];
    const trimmedViewer = (viewerUserId || '').trim();
    if (!trimmedViewer) throw new Error('viewerUserId is required');

    // Re-use the existing read-access path: getEntityView enforces both
    // soft-delete filtering AND scope membership (`assertScopeAccess`). If the
    // viewer can't read the entity they can't read its history.
    //
    // A scope denial is deliberately folded into 'not found' here: this helper's
    // contract (and the route comment on GET /social/entities/:id/revisions) is
    // that missing / soft-deleted / forbidden all surface as the same 404, so a
    // caller cannot probe for the existence of an entity in a foreign scope.
    let view: SocialEntityView | null;
    try {
        view = await getEntityView(trimmedId, trimmedViewer);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'forbidden') throw new Error('not found', { cause: error });
        throw error;
    }
    if (!view) throw new Error('not found');

    const limit = Math.max(
        1,
        Math.min(
            typeof opts?.limit === 'number' && Number.isFinite(opts.limit)
                ? Math.floor(opts.limit)
                : SOCIAL_REVISION_DEFAULT_LIMIT,
            SOCIAL_REVISION_MAX_LIMIT,
        ),
    );

    return requireSocialPostgres('listRevisions', async (client) => {
        const result = await client.query<RevisionRow>(
            `
                select id::text as id,
                       entity_id::text as entity_id,
                       author_user_id,
                       snapshot,
                       revision_kind,
                       note,
                       created_at
                from app_social_revision
                where entity_id = $1::uuid
                order by created_at desc
                limit $2
            `,
            [trimmedId, limit],
        );
        return result.rows.map(mapRevisionRow);
    });
}

/**
 * Single-entity view: identical shape to `listEntitiesByScope` items, with
 * the same aggregate joins. Returns null when not found or soft-deleted.
 *
 * Контроль доступа: после загрузки строки и ДО обогащения агрегатами вызывается
 * `assertScopeAccess` — знание UUID само по себе не даёт права читать сущность
 * из группы/переписки, участником которой зритель не является. Публичные scope
 * (`global` / `announcement`, в том числе доска объявлений) проходят всегда.
 */
export async function getEntityView(
    id: string,
    viewerUserId: string,
): Promise<SocialEntityView | null> {
    const trimmedId = (id || '').trim();
    if (!trimmedId) return null;
    const trimmedViewer = (viewerUserId || '').trim();

    return requireSocialPostgres('getEntityView', async (client) => {
        const rows = await client.query<EntityRow>(
            `select * from app_social_entity where id = $1::uuid and deleted_at is null`,
            [trimmedId],
        );
        if (rows.rowCount === 0) return null;
        const entity = mapEntityRow(rows.rows[0]);

        await assertScopeAccess(entity.scopeType, entity.scopeId, trimmedViewer);

        const [aggregates, viewerReactions, viewerSeen] = await Promise.all([
            fetchAggregates(client, [entity.id]),
            trimmedViewer
                ? fetchViewerReactions(client, [entity.id], trimmedViewer)
                : Promise.resolve(new Map<string, string[]>()),
            trimmedViewer
                ? fetchViewerSeenEntities(client, [entity.id], trimmedViewer)
                : Promise.resolve(new Set<string>()),
        ]);
        const agg = aggregates.get(entity.id);
        return {
            entity,
            reactions: agg?.reactions ?? [],
            myReactions: viewerReactions.get(entity.id) ?? [],
            commentCount: agg?.commentCount ?? 0,
            attachmentCount: agg?.attachmentCount ?? 0,
            isPinned: entity.pinned,
            viewCount: agg?.viewCount ?? 0,
            hasViewed: viewerSeen.has(entity.id),
        };
    });
}

// === Universal search ========================================================

/**
 * Minimum / maximum length of a search query string. Anything shorter than 2
 * characters returns `[]` to avoid hammering the DB with single-letter LIKEs;
 * anything longer than 200 is clipped so a user pasting a wall of text doesn't
 * blow the parameter buffer. Exported for unit tests + the route layer.
 */
export const SOCIAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const SOCIAL_SEARCH_MAX_QUERY_LENGTH = 200;

/** Default and hard-cap result counts for `searchSocialEntities`. */
export const SOCIAL_SEARCH_DEFAULT_LIMIT = 20;
export const SOCIAL_SEARCH_MAX_LIMIT = 50;

/**
 * Pure helper — normalize an arbitrary input into a clean search query, or
 * `null` if the input is too short / too long / wrong type. The trimmed string
 * is what gets ILIKE-wrapped server-side; the cap is applied as a hard truncate
 * AFTER trim so users can paste with leading whitespace without losing chars.
 *
 * Exported for unit testing.
 */
export function normalizeSocialSearchQuery(input: unknown): string | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (trimmed.length < SOCIAL_SEARCH_MIN_QUERY_LENGTH) return null;
    if (trimmed.length > SOCIAL_SEARCH_MAX_QUERY_LENGTH) {
        return trimmed.slice(0, SOCIAL_SEARCH_MAX_QUERY_LENGTH);
    }
    return trimmed;
}

/**
 * Pure helper — escape user-supplied text so it is safe to embed inside an
 * `ILIKE '%X%'` clause. Postgres `LIKE` treats `%`, `_` and `\` as special;
 * we escape all three so a query like `100%` matches the literal sequence
 * "100%" instead of "100<anything>". Exported for unit testing.
 */
export function escapeSocialSearchLike(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

/**
 * Pure helper — clamp a raw limit argument into the [1, MAX_LIMIT] range, with
 * `undefined`/non-finite falling back to `DEFAULT_LIMIT`. Exported for tests.
 */
export function clampSocialSearchLimit(input: unknown): number {
    if (typeof input !== 'number' || !Number.isFinite(input)) {
        return SOCIAL_SEARCH_DEFAULT_LIMIT;
    }
    const rounded = Math.floor(input);
    if (rounded < 1) return 1;
    if (rounded > SOCIAL_SEARCH_MAX_LIMIT) return SOCIAL_SEARCH_MAX_LIMIT;
    return rounded;
}

/**
 * Pure helper — given a candidate hit, decide whether `viewerUserId` is allowed
 * to see it based on the scope rules:
 *
 *   - `global` / `announcement` → any authenticated viewer.
 *   - `dm` → viewer must be one of the two participants of the `direct:` room.
 *   - `group` → caller must have already passed `assertCanReadGroup` (the
 *     authorization is async + DB-backed, so this pure helper takes a Set of
 *     pre-resolved allowed group scope ids).
 *
 * Returns `true` when the entity passes the filter, `false` otherwise.
 * Exported for unit testing.
 */
export function isSocialSearchHitVisible(
    hit: { scopeType: SocialScopeType; scopeId: string },
    viewerUserId: string,
    allowedGroupScopeIds: ReadonlySet<string>,
): boolean {
    if (!viewerUserId) return false;
    switch (hit.scopeType) {
        case 'global':
        case 'announcement':
            return true;
        case 'group':
            return allowedGroupScopeIds.has(hit.scopeId);
        case 'dm': {
            // scopeId is `dm:direct:<low>::<high>`; strip the leading `dm:` so
            // `parseDirectRoomId` only sees the canonical `direct:...` form.
            const raw = hit.scopeId.startsWith('dm:') ? hit.scopeId.slice(3) : hit.scopeId;
            const direct = parseDirectRoomId(raw);
            if (!direct) return false;
            return viewerUserId === direct.low || viewerUserId === direct.high;
        }
        default:
            return false;
    }
}

export interface SearchSocialEntitiesOptions {
    viewerUserId: string;
    scopes?: SocialScopeType[];
    scopeIds?: string[];
    kinds?: SocialEntityKind[];
    limit?: number;
}

export interface SearchSocialEntitiesResult {
    results: SocialEntityView[];
    total: number;
}

/**
 * Cross-scope text search over `app_social_entity`. Matches any of
 * `payload->>'title' | 'body' | 'subject' | 'note'` against an ILIKE pattern
 * built from the user's query. Soft-deleted rows are excluded.
 *
 * Authorization model:
 *   - global / announcement scopes are open to any authenticated viewer.
 *   - group scopes are filtered down to the set the viewer can read
 *     (`assertCanReadGroup` per distinct `group:<key>` hit; rejected scopes
 *     drop their rows silently).
 *   - dm scopes are filtered to rooms where the viewer is a participant.
 *
 * The DB returns a wider candidate pool than `limit` so the in-memory auth
 * filter can drop forbidden rows without leaving the response short.
 *
 * Throws on validation errors (`'query too short'` / `'query too long'`) and
 * on Postgres unavailability — the route maps both to 400 / 500 respectively.
 */
export async function searchSocialEntities(
    query: string,
    opts: SearchSocialEntitiesOptions,
): Promise<SearchSocialEntitiesResult> {
    const trimmedViewer = (opts.viewerUserId || '').trim();
    if (!trimmedViewer) throw new Error('viewerUserId is required');

    if (typeof query !== 'string') throw new Error('query is required');
    const rawTrimmed = query.trim();
    if (rawTrimmed.length < SOCIAL_SEARCH_MIN_QUERY_LENGTH) {
        throw new Error('query too short');
    }
    if (rawTrimmed.length > SOCIAL_SEARCH_MAX_QUERY_LENGTH) {
        throw new Error('query too long');
    }
    const normalized = normalizeSocialSearchQuery(rawTrimmed) ?? rawTrimmed;

    const cappedLimit = clampSocialSearchLimit(opts.limit);

    // De-dup + sanitize the optional filter arrays. Empty arrays disable the
    // filter so callers don't have to special-case `[]` upstream.
    const scopeFilter = Array.isArray(opts.scopes)
        ? Array.from(new Set(opts.scopes.filter(Boolean)))
        : [];
    const scopeIdFilter = Array.isArray(opts.scopeIds)
        ? Array.from(new Set(opts.scopeIds.map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)))
        : [];
    const kindFilter = Array.isArray(opts.kinds)
        ? Array.from(new Set(opts.kinds.filter(Boolean)))
        : [];

    const likePattern = `%${escapeSocialSearchLike(normalized)}%`;

    // Over-fetch candidates so the post-filter auth pass can drop forbidden
    // rows without starving the response. Cap to a sensible upper bound to
    // protect the DB.
    const candidatePoolSize = Math.min(cappedLimit * 5, 200);

    return requireSocialPostgres('searchSocialEntities', async (client) => {
        const params: unknown[] = [likePattern];
        const conditions: string[] = [
            `deleted_at is null`,
            `(
                (payload->>'title') ilike $1
                or (payload->>'body') ilike $1
                or (payload->>'subject') ilike $1
                or (payload->>'note') ilike $1
            )`,
        ];

        if (scopeFilter.length > 0) {
            params.push(scopeFilter);
            conditions.push(`scope_type = any($${params.length}::text[])`);
        }
        if (scopeIdFilter.length > 0) {
            params.push(scopeIdFilter);
            conditions.push(`scope_id = any($${params.length}::text[])`);
        }
        if (kindFilter.length > 0) {
            params.push(kindFilter);
            conditions.push(`kind = any($${params.length}::text[])`);
        }

        params.push(candidatePoolSize);
        const limitIdx = params.length;

        const rows = await client.query<EntityRow>(
            `
                select * from app_social_entity
                where ${conditions.join(' and ')}
                order by created_at desc
                limit $${limitIdx}
            `,
            params,
        );

        const candidates = rows.rows.map((row) => mapEntityRow(row));
        if (candidates.length === 0) return { results: [], total: 0 };

        // Resolve which group scopes the viewer can read. We dedupe by scope_id
        // so we only hit `assertCanReadGroup` once per group even if dozens of
        // posts from the same group are in the candidate pool.
        const distinctGroupScopeIds: string[] = Array.from(
            new Set<string>(
                candidates
                    .filter((e) => e.scopeType === 'group')
                    .map((e) => e.scopeId),
            ),
        );
        const allowedGroupScopeIds = new Set<string>();
        await Promise.all(
            distinctGroupScopeIds.map(async (scopeId: string) => {
                // scope_id is stored as `group:<key>`; strip the prefix because
                // `assertCanReadGroup` expects the bare key.
                const rawKey = scopeId.startsWith('group:') ? scopeId.slice(6) : scopeId;
                try {
                    await assertCanReadGroup(trimmedViewer, rawKey);
                    allowedGroupScopeIds.add(scopeId);
                } catch {
                    /* not a member — drop */
                }
            }),
        );

        const visible = candidates.filter((entity) =>
            isSocialSearchHitVisible(entity, trimmedViewer, allowedGroupScopeIds),
        );

        const limited = visible.slice(0, cappedLimit);
        if (limited.length === 0) {
            return { results: [], total: 0 };
        }

        const ids = limited.map((e) => e.id);
        const [aggregates, viewerReactions, viewerSeen] = await Promise.all([
            fetchAggregates(client, ids),
            fetchViewerReactions(client, ids, trimmedViewer),
            fetchViewerSeenEntities(client, ids, trimmedViewer),
        ]);

        const results = limited.map<SocialEntityView>((entity) => {
            const agg = aggregates.get(entity.id);
            return {
                entity,
                reactions: agg?.reactions ?? [],
                myReactions: viewerReactions.get(entity.id) ?? [],
                commentCount: agg?.commentCount ?? 0,
                attachmentCount: agg?.attachmentCount ?? 0,
                isPinned: entity.pinned,
                viewCount: agg?.viewCount ?? 0,
                hasViewed: viewerSeen.has(entity.id),
            };
        });

        return { results, total: visible.length };
    });
}

// === Comments ================================================================

/**
 * Add a comment to an entity. depth=0 for top-level, depth=parent.depth+1 for
 * replies. Capped at SOCIAL_COMMENT_MAX_DEPTH (=1) — replies-to-replies are
 * rejected with 'comment depth limit'. Mentions in the body are persisted so
 * notification consumers can pick them up.
 */
export async function addComment(
    entityId: string,
    authorUserId: string,
    body: string,
    parentCommentId?: string,
): Promise<{ id: string }> {
    const trimmedEntity = (entityId || '').trim();
    const trimmedAuthor = (authorUserId || '').trim();
    if (!trimmedEntity) throw new Error('entityId is required');
    if (!trimmedAuthor) throw new Error('authorUserId is required');
    const cleanBody = validateCommentBody(body);
    const trimmedParent = (parentCommentId ?? '').trim() || null;

    const result = await requireSocialPostgres('addComment', async (client) => {
        const entity = await client.query<EntityRow>(
            `select * from app_social_entity where id = $1::uuid`,
            [trimmedEntity],
        );
        if (entity.rowCount === 0) throw new Error('not found');
        const parentEntityRow = entity.rows[0];
        if (parentEntityRow.deleted_at) throw new Error('not found');

        // Контроль доступа: автор комментария должен иметь право писать в scope
        // родительской сущности. Знание UUID поста не даёт права комментировать
        // его после исключения из группы / блокировки собеседника.
        await assertScopeAccess(
            parentEntityRow.scope_type as SocialScopeType,
            parentEntityRow.scope_id,
            trimmedAuthor,
        );

        let depth: 0 | 1 = 0;
        if (trimmedParent) {
            const parent = await client.query<{ entity_id: string; depth: number; deleted_at: Date | null }>(
                `select entity_id::text as entity_id, depth, deleted_at from app_social_comment where id = $1::uuid`,
                [trimmedParent],
            );
            if (parent.rowCount === 0) throw new Error('parent not found');
            const parentRow = parent.rows[0];
            if (parentRow.deleted_at) throw new Error('parent not found');
            if (parentRow.entity_id !== trimmedEntity) throw new Error('parent not found');
            if (parentRow.depth >= SOCIAL_COMMENT_MAX_DEPTH) throw new Error('comment depth limit');
            depth = (parentRow.depth + 1) as 0 | 1;
        }

        const insert = await client.query<{ id: string }>(
            `
                insert into app_social_comment
                    (entity_id, parent_comment_id, author_user_id, body, depth)
                values ($1::uuid, $2, $3, $4, $5)
                returning id::text as id
            `,
            [trimmedEntity, trimmedParent, trimmedAuthor, cleanBody, depth],
        );
        const commentId = insert.rows[0].id;

        const handles = extractMentions(cleanBody);
        await insertMentions(client, {
            entityId: trimmedEntity,
            sourceKind: 'comment',
            sourceId: commentId,
            authorUserId: trimmedAuthor,
            handles,
        });

        const nowIso = new Date().toISOString();
        const comment: SocialComment = {
            id: commentId,
            entityId: trimmedEntity,
            parentCommentId: trimmedParent,
            authorUserId: trimmedAuthor,
            body: cleanBody,
            depth,
            createdAt: nowIso,
            updatedAt: nowIso,
            deletedAt: null,
        };
        const parentEntity = mapEntityRow(parentEntityRow);
        return { commentId, comment, parentEntity };
    });

    // Fan-out lifecycle event (push notifications, etc.). Emit after the DB
    // block so listeners see a committed comment. Listener errors must be
    // swallowed inside each sink — a failing notification path must not fail
    // the comment insert.
    socialEvents.emit('comment-created', {
        comment: result.comment,
        parentEntity: result.parentEntity,
    });

    // Background link-preview prefetch for URLs in the comment body. See the
    // same call in createEntity for rationale (best-effort cache warm-up).
    prefetchLinkPreviewForText(cleanBody);

    return { id: result.commentId };
}

type CommentRow = {
    id: string;
    entity_id: string;
    parent_comment_id: string | null;
    author_user_id: string;
    body: string;
    depth: number;
    created_at: Date | string;
    updated_at: Date | string;
    deleted_at: Date | string | null;
};

function mapCommentRow(row: CommentRow): SocialComment {
    const depthRaw = Number(row.depth);
    const depth: 0 | 1 = depthRaw === 1 ? 1 : 0;
    return {
        id: row.id,
        entityId: row.entity_id,
        parentCommentId: row.parent_comment_id,
        authorUserId: row.author_user_id,
        body: row.body,
        depth,
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
        updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
        deletedAt: toIso(row.deleted_at),
    };
}

/**
 * List non-deleted comments attached to an entity, ordered by created_at ASC
 * (top-level threads first as they appear chronologically; replies follow
 * their parent because their own created_at is later, but the UI is expected
 * to re-bucket by parent_comment_id when rendering nesting).
 *
 * Returns an empty array when the entity does not exist or has no comments —
 * we deliberately do not surface a 404 here so the comments thread can render
 * cleanly against either a missing or an empty entity without a separate
 * fetch.
 *
 * `viewerUserId` is required: the thread is gated by the parent entity's scope
 * (`assertScopeAccess`), so a non-member gets 'forbidden' instead of the
 * comment bodies. Unknown entities still return `[]` — the "missing" and
 * "empty" cases stay indistinguishable, as before.
 */
export async function listComments(
    entityId: string,
    viewerUserId: string,
): Promise<SocialComment[]> {
    const trimmedEntity = (entityId || '').trim();
    if (!trimmedEntity) return [];
    const trimmedViewer = (viewerUserId || '').trim();
    if (!trimmedViewer) throw new Error('viewerUserId is required');

    return requireSocialPostgres('listComments', async (client) => {
        const parent = await loadEntityRowWithScopeAccess(client, trimmedEntity, trimmedViewer);
        if (!parent) return [];

        const rows = await client.query<CommentRow>(
            `
                select
                    id::text as id,
                    entity_id::text as entity_id,
                    parent_comment_id::text as parent_comment_id,
                    author_user_id,
                    body,
                    depth,
                    created_at,
                    updated_at,
                    deleted_at
                from app_social_comment
                where entity_id = $1::uuid and deleted_at is null
                order by created_at asc
            `,
            [trimmedEntity],
        );
        return rows.rows.map(mapCommentRow);
    });
}

// === Reactions ===============================================================

/**
 * Toggle a reaction on a social entity. Mirrors the semantics of
 * `services/group-reactions.ts#toggleReaction` but against the universal
 * `app_social_reaction` table. Returns the new aggregate plus the viewer's
 * current picks so the caller can render the bar without a follow-up read.
 *
 * Контроль доступа: сущность должна существовать, не быть удалённой, и её scope
 * должен быть доступен пользователю (`assertScopeAccess`). Раньше реакция
 * ставилась по любому известному UUID без единой проверки.
 */
export async function toggleReaction(
    entityId: string,
    userId: string,
    emoji: string,
): Promise<{
    added: boolean;
    reactions: Array<{ emoji: string; count: number }>;
    mine: string[];
}> {
    if (!isAllowedReactionEmoji(emoji)) {
        throw new Error('invalid emoji');
    }
    const trimmedEntity = (entityId || '').trim();
    const trimmedUser = (userId || '').trim();
    if (!trimmedEntity) throw new Error('entityId is required');
    if (!trimmedUser) throw new Error('userId is required');

    return requireSocialPostgres('toggleReaction', async (client) => {
        const parent = await loadEntityRowWithScopeAccess(client, trimmedEntity, trimmedUser);
        if (!parent || parent.deleted_at) throw new Error('not found');

        const existing = await client.query(
            `
                select 1 from app_social_reaction
                where entity_id = $1::uuid and user_id = $2 and emoji = $3
                limit 1
            `,
            [trimmedEntity, trimmedUser, emoji],
        );
        let added: boolean;
        if (existing.rowCount > 0) {
            await client.query(
                `
                    delete from app_social_reaction
                    where entity_id = $1::uuid and user_id = $2 and emoji = $3
                `,
                [trimmedEntity, trimmedUser, emoji],
            );
            added = false;
        } else {
            await client.query(
                `
                    insert into app_social_reaction (entity_id, user_id, emoji)
                    values ($1::uuid, $2, $3)
                    on conflict (entity_id, user_id, emoji) do nothing
                `,
                [trimmedEntity, trimmedUser, emoji],
            );
            added = true;
        }

        const aggRows = await client.query<{ emoji: string; count: string }>(
            `
                select emoji, count(*)::text as count
                from app_social_reaction
                where entity_id = $1::uuid
                group by emoji
                order by emoji asc
            `,
            [trimmedEntity],
        );
        const reactions = aggRows.rows
            .filter((r) => isAllowedReactionEmoji(r.emoji))
            .map((r) => ({ emoji: r.emoji, count: Number(r.count) || 0 }));

        const mineRows = await client.query<{ emoji: string }>(
            `
                select emoji from app_social_reaction
                where entity_id = $1::uuid and user_id = $2
            `,
            [trimmedEntity, trimmedUser],
        );
        const mine = mineRows.rows.map((r) => r.emoji);

        return { added, reactions, mine };
    });
}

// === Attachments =============================================================

type AttachmentRow = {
    id: string;
    entity_id: string;
    file_id: string;
    mime: string | null;
    size_bytes: string | number | null;
    sort_order: number;
    created_at: Date | string;
    filename?: string | null;
};

function mapAttachmentRow(row: AttachmentRow): {
    id: string;
    entityId: string;
    fileId: string;
    mime: string | null;
    sizeBytes: number | null;
    sortOrder: number;
    createdAt: string;
    filename: string | null;
} {
    const sizeRaw = row.size_bytes;
    const sizeBytes = sizeRaw === null || sizeRaw === undefined
        ? null
        : (typeof sizeRaw === 'number' ? sizeRaw : Number(sizeRaw));
    const filenameRaw = row.filename;
    const filename = typeof filenameRaw === 'string' && filenameRaw.length > 0
        ? filenameRaw
        : null;
    return {
        id: row.id,
        entityId: row.entity_id,
        fileId: row.file_id,
        mime: row.mime,
        sizeBytes: sizeBytes !== null && Number.isFinite(sizeBytes) ? sizeBytes : null,
        sortOrder: Number(row.sort_order) || 0,
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
        filename,
    };
}

/**
 * Associate an already-stored R2 file (registered via the storage abstraction)
 * with a social entity. Returns the attachment row id.
 *
 * Owner-only, mirroring `removeAttachment`: only the parent entity's author may
 * attach a file to it. Ранее функция вообще не проверяла ни существование
 * сущности, ни авторство — любой аутентифицированный пользователь мог навесить
 * произвольный fileId на чужой пост.
 *
 * Порядок проверок:
 *   - сущности нет / она soft-deleted → 'not found'
 *   - scope недоступен вызывающему    → 'forbidden' (assertScopeAccess)
 *   - вызывающий не автор сущности    → 'forbidden'
 */
export async function attachFile(
    entityId: string,
    fileId: string,
    mime: string | undefined,
    sizeBytes: number | undefined,
    sortOrder: number | undefined,
    actorUserId: string,
): Promise<{ id: string }> {
    const trimmedEntity = (entityId || '').trim();
    const trimmedFile = (fileId || '').trim();
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedEntity) throw new Error('entityId is required');
    if (!trimmedFile) throw new Error('fileId is required');
    if (!trimmedActor) throw new Error('actorUserId is required');

    return requireSocialPostgres('attachFile', async (client) => {
        const parent = await loadEntityRowWithScopeAccess(client, trimmedEntity, trimmedActor);
        if (!parent || parent.deleted_at) throw new Error('not found');
        if (parent.author_user_id !== trimmedActor) throw new Error('forbidden');

        const insert = await client.query<{ id: string }>(
            `
                insert into app_social_attachment
                    (entity_id, file_id, mime, size_bytes, sort_order)
                values ($1::uuid, $2, $3, $4, $5)
                returning id::text as id
            `,
            [
                trimmedEntity,
                trimmedFile,
                mime ?? null,
                typeof sizeBytes === 'number' && Number.isFinite(sizeBytes) ? sizeBytes : null,
                typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : 0,
            ],
        );
        return { id: insert.rows[0].id };
    });
}

/**
 * List attachments associated with an entity, ordered by sort_order ASC then
 * created_at ASC for deterministic display. Returns `[]` for unknown / empty
 * entities — mirrors the comments helper for a clean UI render path.
 *
 * A LEFT JOIN to `app_umkd_files` resolves the human-readable upload filename
 * for every attachment so the UI can render "Lecture-3.pdf" instead of the
 * MIME surrogate. Missing rows (orphans, non-UMKD uploads) surface as
 * `filename: null` — the client falls back to a MIME-derived label.
 *
 * `viewerUserId` is required — the list is gated by the parent entity's scope
 * (`assertScopeAccess`) so a non-member cannot enumerate fileIds of a foreign
 * group / DM. Unknown entities still return `[]`.
 */
export async function listAttachments(entityId: string, viewerUserId: string): Promise<Array<{
    id: string;
    entityId: string;
    fileId: string;
    mime: string | null;
    sizeBytes: number | null;
    sortOrder: number;
    createdAt: string;
    filename: string | null;
}>> {
    const trimmedEntity = (entityId || '').trim();
    if (!trimmedEntity) return [];
    const trimmedViewer = (viewerUserId || '').trim();
    if (!trimmedViewer) throw new Error('viewerUserId is required');

    return requireSocialPostgres('listAttachments', async (client) => {
        const parent = await loadEntityRowWithScopeAccess(client, trimmedEntity, trimmedViewer);
        if (!parent) return [];

        const rows = await client.query<AttachmentRow>(
            `
                select
                    a.id::text as id,
                    a.entity_id::text as entity_id,
                    a.file_id,
                    a.mime,
                    a.size_bytes,
                    a.sort_order,
                    a.created_at,
                    f.filename as filename
                from app_social_attachment a
                left join app_umkd_files f on f.file_id = a.file_id
                where a.entity_id = $1::uuid
                order by a.sort_order asc, a.created_at asc
            `,
            [trimmedEntity],
        );
        return rows.rows.map(mapAttachmentRow);
    });
}

/**
 * Remove an attachment row. Owner-only — only the parent entity's author may
 * detach a file. Throws 'forbidden' otherwise, and 'not found' for a missing
 * attachment id.
 *
 * Deliberately does NOT delete the underlying R2 binary: the storage
 * abstraction dedupes by content hash, so the same blob may be referenced by
 * other UMKD rows, group files, or other social entities. Detaching is a
 * pure metadata operation in this layer.
 */
export async function removeAttachment(
    attachmentId: string,
    actorUserId: string,
): Promise<void> {
    const trimmedId = (attachmentId || '').trim();
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedId) throw new Error('attachmentId is required');
    if (!trimmedActor) throw new Error('actorUserId is required');

    await requireSocialPostgres('removeAttachment', async (client) => {
        const existing = await client.query<{
            attachment_id: string;
            author_user_id: string;
            deleted_at: Date | string | null;
        }>(
            `
                select
                    a.id::text as attachment_id,
                    e.author_user_id,
                    e.deleted_at
                from app_social_attachment a
                join app_social_entity e on e.id = a.entity_id
                where a.id = $1::uuid
                limit 1
            `,
            [trimmedId],
        );
        if (existing.rowCount === 0) throw new Error('not found');
        const row = existing.rows[0];
        if (row.author_user_id !== trimmedActor) throw new Error('forbidden');

        await client.query(
            `delete from app_social_attachment where id = $1::uuid`,
            [trimmedId],
        );
        return null;
    });
}
