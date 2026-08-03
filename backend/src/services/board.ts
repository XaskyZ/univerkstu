/**
 * Student announcements board.
 *
 * A shared, student-facing bulletin board: any authenticated user can post an
 * announcement; everyone can read the feed. Built on top of the universal
 * social-entity store (services/social.ts) under a DEDICATED scope so it stays
 * fully isolated from:
 *   - coordinator announcements (scope `announcement:global`, read from the
 *     legacy `app_coordinator_announcements` table), and
 *   - the global chat (scope `global:chat`).
 *
 * Reactions, comments, attachments, @mentions, moderation/reports and revisions
 * all come "for free" via the generic /social endpoints operating on the
 * announcement entity id.
 *
 * Owner-only mutations go through services/social.ts. Admin overrides (delete /
 * edit / pin any announcement) are direct, board-scoped queries — mirroring the
 * moderation override in services/social-moderation.ts (reviewReport).
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import * as social from './social.js';
import { isUserMuted } from './social-moderation.js';
import type { SocialEntityView, SocialPayloadByKind } from '../types/social.js';

export const BOARD_SCOPE_TYPE = 'announcement' as const;
const BOARD_SCOPE_RAW = 'student-board';
/** Canonical scope id: `announcement:student-board`. */
export const BOARD_SCOPE_ID = social.buildScopeId(BOARD_SCOPE_TYPE, BOARD_SCOPE_RAW);

/** Fixed category keys — human labels are localized on the client. */
export const BOARD_CATEGORIES = ['sale', 'buy', 'service', 'event', 'lost_found', 'help', 'other'] as const;
export type BoardCategory = (typeof BOARD_CATEGORIES)[number];
export const BOARD_DEAL_TYPES = ['product', 'service', 'other'] as const;
export type BoardDealType = (typeof BOARD_DEAL_TYPES)[number];
export const BOARD_LOST_FOUND_TYPES = ['lost', 'found'] as const;
export type BoardLostFoundType = (typeof BOARD_LOST_FOUND_TYPES)[number];
export const BOARD_STATUSES = ['active', 'closed', 'sold', 'found', 'archived'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const BOARD_SORTS = ['newest', 'popular', 'discussed', 'views', 'favorites'] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

export function isBoardCategory(value: unknown): value is BoardCategory {
    return typeof value === 'string' && (BOARD_CATEGORIES as readonly string[]).includes(value);
}

/** Normalize a category; unknown/missing values fall back to 'other'. */
export function normalizeBoardCategory(input: unknown): BoardCategory {
    return isBoardCategory(input) ? input : 'other';
}

export function isBoardDealType(value: unknown): value is BoardDealType {
    return typeof value === 'string' && (BOARD_DEAL_TYPES as readonly string[]).includes(value);
}

export function normalizeBoardDealType(input: unknown): BoardDealType {
    return isBoardDealType(input) ? input : 'product';
}

export function inferBoardDealType(category: BoardCategory): BoardDealType {
    if (category === 'sale' || category === 'buy') return 'product';
    if (category === 'service' || category === 'help') return 'service';
    return 'other';
}

export function isBoardLostFoundType(value: unknown): value is BoardLostFoundType {
    return typeof value === 'string' && (BOARD_LOST_FOUND_TYPES as readonly string[]).includes(value);
}

export function normalizeBoardLostFoundType(input: unknown): BoardLostFoundType {
    return isBoardLostFoundType(input) ? input : 'lost';
}

export function isBoardStatus(value: unknown): value is BoardStatus {
    return typeof value === 'string' && (BOARD_STATUSES as readonly string[]).includes(value);
}

export function normalizeBoardStatus(input: unknown): BoardStatus {
    return isBoardStatus(input) ? input : 'active';
}

export function isBoardSort(value: unknown): value is BoardSort {
    return typeof value === 'string' && (BOARD_SORTS as readonly string[]).includes(value);
}

export function normalizeBoardSort(input: unknown): BoardSort {
    return isBoardSort(input) ? input : 'newest';
}

function normalizeOptionalText(input: unknown, maxLength: number): string | undefined {
    if (input === undefined || input === null) return undefined;
    if (typeof input !== 'string') throw new BoardError('invalid optional text field', 400, 'BOARD_VALIDATION');
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    if (trimmed.length > maxLength) throw new BoardError('optional text field too long', 400, 'BOARD_VALIDATION');
    return trimmed;
}

function normalizeOptionalIso(input: unknown): string | undefined {
    const value = normalizeOptionalText(input, 80);
    if (!value) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BoardError('invalid expiresAt', 400, 'BOARD_VALIDATION');
    return date.toISOString();
}

function isProductCategory(category: BoardCategory | undefined): boolean {
    return category === 'sale' || category === 'buy';
}

function isServiceCategory(category: BoardCategory | undefined): boolean {
    return category === 'service' || category === 'help';
}

function clearIncompatibleAnnouncementFields(payload: Record<string, unknown>, category: BoardCategory): void {
    if (!isProductCategory(category) && !isServiceCategory(category)) payload.price = null;
    if (!isProductCategory(category)) payload.condition = null;
    if (!isServiceCategory(category)) payload.serviceFormat = null;
    if (category !== 'event' && category !== 'lost_found') payload.eventAt = null;
    if (category !== 'lost_found') payload.lostFoundType = null;
}

function applyOptionalAnnouncementFields(
    payload: Record<string, unknown>,
    source: Record<string, unknown>,
    category?: BoardCategory,
    clearIncompatible = false,
): void {
    if (category !== undefined && clearIncompatible) clearIncompatibleAnnouncementFields(payload, category);
    const dealType = category !== undefined
        ? inferBoardDealType(category)
        : source.dealType !== undefined
            ? normalizeBoardDealType(source.dealType)
            : undefined;
    if (dealType !== undefined) payload.dealType = dealType;
    const status = source.status !== undefined ? normalizeBoardStatus(source.status) : undefined;
    if (status !== undefined) payload.status = status;
    const price = normalizeOptionalText(source.price, 80);
    if (price !== undefined && (category === undefined || isProductCategory(category) || isServiceCategory(category))) payload.price = price;
    const condition = normalizeOptionalText(source.condition, 80);
    if (condition !== undefined && (category === undefined || isProductCategory(category))) payload.condition = condition;
    const location = normalizeOptionalText(source.location, 120);
    if (location !== undefined) payload.location = location;
    const serviceFormat = normalizeOptionalText(source.serviceFormat, 120);
    if (serviceFormat !== undefined && (category === undefined || isServiceCategory(category))) payload.serviceFormat = serviceFormat;
    const eventAt = normalizeOptionalIso(source.eventAt);
    if (eventAt !== undefined && (category === undefined || category === 'event' || category === 'lost_found')) payload.eventAt = eventAt;
    const lostFoundType = source.lostFoundType !== undefined ? normalizeBoardLostFoundType(source.lostFoundType) : undefined;
    if (lostFoundType !== undefined && (category === undefined || category === 'lost_found')) payload.lostFoundType = lostFoundType;
    const contactTelegram = normalizeOptionalText(source.contactTelegram, 120);
    if (contactTelegram !== undefined) payload.contactTelegram = contactTelegram;
    const contactInstagram = normalizeOptionalText(source.contactInstagram, 120);
    if (contactInstagram !== undefined) payload.contactInstagram = contactInstagram;
    const contactPhone = normalizeOptionalText(source.contactPhone, 60);
    if (contactPhone !== undefined) payload.contactPhone = contactPhone;
    const expiresAt = normalizeOptionalIso(source.expiresAt);
    if (expiresAt !== undefined) payload.expiresAt = expiresAt;
}

export class BoardError extends Error {
    statusCode: number;
    code: string;
    constructor(message: string, statusCode: number, code: string) {
        super(message);
        this.name = 'BoardError';
        this.statusCode = statusCode;
        this.code = code;
    }
}

export function isBoardError(error: unknown): error is BoardError {
    return error instanceof BoardError;
}

/**
 * Board announcement enriched with a human author label. The board feed shows
 * real names instead of raw login ids.
 */
export interface BoardAnnouncementView extends SocialEntityView {
    authorLabel: string;
    /** file_id of the first image attachment, for the preview cover. */
    coverFileId?: string;
    favoriteCount: number;
    isFavorite: boolean;
}

async function requireBoardPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Board] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

/**
 * Resolve human display labels for a set of author ids. Mirrors the global-chat
 * coalesce: self-chosen leaderboard name → profile snapshot fullName → raw id.
 * Best-effort — users without a name source fall back to their id.
 */
async function resolveAuthorLabels(userIds: string[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) return new Map();
    return requireBoardPostgres('resolveAuthorLabels', async (client) => {
        const rows = await client.query<{ user_id: string; label: string }>(
            `
                select
                    ids.user_id,
                    coalesce(
                        nullif(u.settings_json->>'leaderboardDisplayName', ''),
                        nullif(s.snapshot_json->>'fullName', ''),
                        nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                        ids.user_id
                    ) as label
                from unnest($1::text[]) as ids(user_id)
                left join app_users u on u.user_id = ids.user_id
                left join app_admin_user_snapshots s on s.user_id = ids.user_id
            `,
            [unique],
        );
        const map = new Map<string, string>();
        for (const row of rows.rows) {
            if (row.user_id) map.set(row.user_id, row.label || row.user_id);
        }
        return map;
    });
}

/**
 * Resolve the cover image (first image attachment) for a set of entities, as a
 * Map entityId → file_id. Used to render preview thumbnails without an extra
 * round-trip per card.
 */
async function resolveCoverFileIds(entityIds: string[]): Promise<Map<string, string>> {
    const unique = Array.from(new Set(entityIds.filter(Boolean)));
    if (unique.length === 0) return new Map();
    return requireBoardPostgres('resolveCoverFileIds', async (client) => {
        const rows = await client.query<{ entity_id: string; file_id: string }>(
            `
                select distinct on (entity_id)
                    entity_id::text as entity_id,
                    file_id
                from app_social_attachment
                where entity_id = any($1::uuid[])
                  and mime like 'image/%'
                order by entity_id, sort_order asc, created_at asc
            `,
            [unique],
        );
        const map = new Map<string, string>();
        for (const row of rows.rows) {
            if (row.entity_id && row.file_id) map.set(row.entity_id, row.file_id);
        }
        return map;
    });
}

async function resolveFavoriteCounts(entityIds: string[]): Promise<Map<string, number>> {
    const unique = Array.from(new Set(entityIds.filter(Boolean)));
    if (unique.length === 0) return new Map();
    return requireBoardPostgres('resolveFavoriteCounts', async (client) => {
        const rows = await client.query<{ entity_id: string; count: string }>(
            `
                select entity_id::text as entity_id, count(*)::text as count
                from app_social_favorite
                where entity_id = any($1::uuid[])
                group by entity_id
            `,
            [unique],
        );
        const map = new Map<string, number>();
        for (const row of rows.rows) {
            map.set(row.entity_id, Number(row.count) || 0);
        }
        return map;
    });
}

async function resolveViewerFavorites(entityIds: string[], viewerUserId: string): Promise<Set<string>> {
    const unique = Array.from(new Set(entityIds.filter(Boolean)));
    const viewer = (viewerUserId || '').trim();
    if (unique.length === 0 || !viewer) return new Set();
    return requireBoardPostgres('resolveViewerFavorites', async (client) => {
        const rows = await client.query<{ entity_id: string }>(
            `
                select entity_id::text as entity_id
                from app_social_favorite
                where user_id = $1 and entity_id = any($2::uuid[])
            `,
            [viewer, unique],
        );
        return new Set(rows.rows.map((row) => row.entity_id).filter(Boolean));
    });
}

/**
 * Enrich raw social views into board views: attach the author display label and
 * the cover-image file id. Both lookups are best-effort — a failure in either
 * never fails the feed read (the cosmetic data just falls back / is omitted).
 */
async function enrichBoardViews(views: SocialEntityView[], viewerUserId: string): Promise<BoardAnnouncementView[]> {
    if (views.length === 0) return [];
    let labels = new Map<string, string>();
    let covers = new Map<string, string>();
    let favoriteCounts = new Map<string, number>();
    let viewerFavorites = new Set<string>();
    try {
        labels = await resolveAuthorLabels(views.map((v) => v.entity.authorUserId));
    } catch (error) {
        console.error('[Board] author label resolution failed:', error);
    }
    try {
        covers = await resolveCoverFileIds(views.map((v) => v.entity.id));
    } catch (error) {
        console.error('[Board] cover image resolution failed:', error);
    }
    try {
        favoriteCounts = await resolveFavoriteCounts(views.map((v) => v.entity.id));
    } catch (error) {
        console.error('[Board] favorite count resolution failed:', error);
    }
    try {
        viewerFavorites = await resolveViewerFavorites(views.map((v) => v.entity.id), viewerUserId);
    } catch (error) {
        console.error('[Board] viewer favorite resolution failed:', error);
    }
    return views.map((view) => ({
        ...view,
        authorLabel: labels.get(view.entity.authorUserId) ?? view.entity.authorUserId,
        coverFileId: covers.get(view.entity.id),
        favoriteCount: favoriteCounts.get(view.entity.id) ?? 0,
        isFavorite: viewerFavorites.has(view.entity.id),
    }));
}

/**
 * Map errors thrown by services/social.ts ('not found' / 'forbidden') to
 * BoardError so the route layer returns a clean status + code.
 */
function mapSocialError(error: unknown): never {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'not found') throw new BoardError('Announcement not found', 404, 'BOARD_NOT_FOUND');
    if (message === 'forbidden') throw new BoardError('Not allowed', 403, 'BOARD_FORBIDDEN');
    throw error;
}

/** True when the entity exists, is not deleted, and belongs to the board scope. */
async function assertBoardEntity(client: PoolClient, id: string): Promise<void> {
    const rows = await client.query<{ scope_type: string; scope_id: string; deleted_at: Date | null }>(
        `select scope_type, scope_id, deleted_at from app_social_entity where id = $1::uuid`,
        [id],
    );
    if (rows.rowCount === 0) throw new BoardError('Announcement not found', 404, 'BOARD_NOT_FOUND');
    const row = rows.rows[0];
    if (row.scope_type !== BOARD_SCOPE_TYPE || row.scope_id !== BOARD_SCOPE_ID) {
        // The id refers to some other social entity (e.g. a coordinator
        // announcement) — never let board endpoints act on it.
        throw new BoardError('Announcement not found', 404, 'BOARD_NOT_FOUND');
    }
    if (row.deleted_at) throw new BoardError('Announcement not found', 404, 'BOARD_NOT_FOUND');
}

// === Create ==================================================================

export interface CreateBoardAnnouncementInput {
    authorUserId: string;
    title: unknown;
    body: unknown;
    category?: unknown;
    dealType?: unknown;
    status?: unknown;
    price?: unknown;
    condition?: unknown;
    location?: unknown;
    serviceFormat?: unknown;
    eventAt?: unknown;
    lostFoundType?: unknown;
    contactTelegram?: unknown;
    contactInstagram?: unknown;
    contactPhone?: unknown;
    expiresAt?: unknown;
}

export async function createBoardAnnouncement(
    input: CreateBoardAnnouncementInput,
): Promise<BoardAnnouncementView> {
    const authorUserId = (input.authorUserId || '').trim();
    if (!authorUserId) throw new BoardError('authorUserId is required', 400, 'BOARD_AUTHOR_REQUIRED');

    let title: string;
    let body: string;
    try {
        title = social.validateTitle(input.title);
        body = social.validateBody(input.body);
    } catch (error) {
        throw new BoardError(error instanceof Error ? error.message : 'invalid payload', 400, 'BOARD_VALIDATION');
    }
    const category = normalizeBoardCategory(input.category);
    const payload: Record<string, unknown> = { title, body, priority: 'low', category, dealType: inferBoardDealType(category), status: 'active' };
    applyOptionalAnnouncementFields(payload, input as unknown as Record<string, unknown>, category);

    // The mute check is best-effort: a moderation-layer error (e.g. a transient
    // DB issue) must never block a normal user from posting. Only an explicit
    // `true` blocks; any failure is logged and treated as "not muted".
    let muted = false;
    try {
        muted = await isUserMuted(authorUserId, BOARD_SCOPE_TYPE, BOARD_SCOPE_ID);
    } catch (error) {
        console.error('[Board] mute check failed; allowing post:', error);
    }
    if (muted) {
        throw new BoardError('You are muted on the board', 403, 'BOARD_MUTED');
    }

    const entity = await social.createEntity({
        kind: 'announcement',
        scopeType: BOARD_SCOPE_TYPE,
        scopeId: BOARD_SCOPE_ID,
        authorUserId,
        // `priority` is required by the announcement payload type but is a
        // coordinator-only concept; the board fixes it to 'low'.
        payload: payload as SocialPayloadByKind['announcement'],
    });

    const view = (await social.getEntityView(entity.id, authorUserId)) ?? {
        entity,
        reactions: [],
        myReactions: [],
        commentCount: 0,
        attachmentCount: 0,
        isPinned: entity.pinned,
        viewCount: 0,
        hasViewed: false,
    };
    const [withLabel] = await enrichBoardViews([view], authorUserId);
    return withLabel;
}

// === Read ====================================================================

export interface ListBoardAnnouncementsOptions {
    viewerUserId: string;
    limit?: number;
    offset?: number;
    favoriteOnly?: boolean;
    mineOnly?: boolean;
    q?: string;
    category?: unknown;
    status?: unknown;
    sort?: unknown;
}

export async function listBoardAnnouncements(
    opts: ListBoardAnnouncementsOptions,
): Promise<BoardAnnouncementView[]> {
    const viewerUserId = (opts.viewerUserId || '').trim();
    const limit = Math.max(1, Math.min(opts.limit ?? 50, 50));
    const offset = Math.max(0, opts.offset ?? 0);
    const q = typeof opts.q === 'string' ? opts.q.trim().slice(0, 160) : '';
    const category = opts.category === undefined ? null : normalizeBoardCategory(opts.category);
    const status = opts.status === undefined ? null : normalizeBoardStatus(opts.status);
    const sort = normalizeBoardSort(opts.sort);

    const ids = await requireBoardPostgres('listBoardAnnouncements.filteredIds', async (client) => {
        const params: unknown[] = [BOARD_SCOPE_TYPE, BOARD_SCOPE_ID];
        const where = [
            `e.scope_type = $1`,
            `e.scope_id = $2`,
            `e.kind = 'announcement'`,
            `e.deleted_at is null`,
        ];
        if (opts.favoriteOnly) {
            params.push(viewerUserId);
            where.push(`exists (select 1 from app_social_favorite fav where fav.entity_id = e.id and fav.user_id = $${params.length})`);
        }
        if (opts.mineOnly) {
            params.push(viewerUserId);
            where.push(`e.author_user_id = $${params.length}`);
        }
        if (category) {
            params.push(category);
            where.push(`coalesce(e.payload->>'category', 'other') = $${params.length}`);
        }
        if (status) {
            params.push(status);
            where.push(`coalesce(e.payload->>'status', 'active') = $${params.length}`);
        }
        if (q) {
            params.push(`%${q}%`);
            where.push(`(e.payload->>'title' ilike $${params.length} or e.payload->>'body' ilike $${params.length})`);
        }
        params.push(limit);
        const limitIdx = params.length;
        params.push(offset);
        const offsetIdx = params.length;
        const metricOrder = sort === 'popular'
            ? `(coalesce(r.reaction_count, 0) + coalesce(c.comment_count, 0) + coalesce(v.view_count, 0) + coalesce(f.favorite_count, 0)) desc,`
            : sort === 'discussed'
                ? `coalesce(c.comment_count, 0) desc,`
                : sort === 'views'
                    ? `coalesce(v.view_count, 0) desc,`
                    : sort === 'favorites'
                        ? `coalesce(f.favorite_count, 0) desc,`
                        : '';
        const rows = await client.query<{ id: string }>(
            `
                select e.id::text as id
                from app_social_entity e
                left join (
                    select entity_id, count(*) as reaction_count from app_social_reaction group by entity_id
                ) r on r.entity_id = e.id
                left join (
                    select entity_id, count(*) as comment_count from app_social_comment where deleted_at is null group by entity_id
                ) c on c.entity_id = e.id
                left join (
                    select entity_id, count(*) as view_count from app_social_view group by entity_id
                ) v on v.entity_id = e.id
                left join (
                    select entity_id, count(*) as favorite_count from app_social_favorite group by entity_id
                ) f on f.entity_id = e.id
                where ${where.join(' and ')}
                order by e.pinned desc, ${metricOrder} e.created_at desc
                limit $${limitIdx} offset $${offsetIdx}
            `,
            params,
        );
        return rows.rows.map((row) => row.id);
    });
    const views = (await Promise.all(ids.map((id) => social.getEntityView(id, viewerUserId))))
        .filter((view): view is SocialEntityView => Boolean(view));
    return enrichBoardViews(views, viewerUserId);
}

export async function getBoardAnnouncement(
    id: string,
    viewerUserId: string,
): Promise<BoardAnnouncementView> {
    const view = await social.getEntityView(id, viewerUserId);
    if (!view) throw new BoardError('Announcement not found', 404, 'BOARD_NOT_FOUND');
    if (view.entity.scopeType !== BOARD_SCOPE_TYPE || view.entity.scopeId !== BOARD_SCOPE_ID) {
        throw new BoardError('Announcement not found', 404, 'BOARD_NOT_FOUND');
    }
    const [withLabel] = await enrichBoardViews([view], viewerUserId);
    return withLabel;
}

export async function setBoardAnnouncementFavorite(
    id: string,
    actorUserId: string,
    favorite: boolean,
): Promise<{ isFavorite: boolean; favoriteCount: number }> {
    const trimmedId = (id || '').trim();
    const viewer = (actorUserId || '').trim();
    if (!trimmedId || !viewer) throw new BoardError('id and actorUserId are required', 400, 'BOARD_VALIDATION');

    return requireBoardPostgres('setBoardAnnouncementFavorite', async (client) => {
        await assertBoardEntity(client, trimmedId);
        if (favorite) {
            await client.query(
                `
                    insert into app_social_favorite (entity_id, user_id)
                    values ($1::uuid, $2)
                    on conflict (entity_id, user_id) do nothing
                `,
                [trimmedId, viewer],
            );
        } else {
            await client.query(
                `delete from app_social_favorite where entity_id = $1::uuid and user_id = $2`,
                [trimmedId, viewer],
            );
        }
        const countRows = await client.query<{ count: string }>(
            `select count(*)::text as count from app_social_favorite where entity_id = $1::uuid`,
            [trimmedId],
        );
        return {
            isFavorite: favorite,
            favoriteCount: Number(countRows.rows[0]?.count ?? 0) || 0,
        };
    });
}

// === Update (owner; admin override) =========================================

export interface UpdateBoardAnnouncementPatch {
    title?: unknown;
    body?: unknown;
    category?: unknown;
    dealType?: unknown;
    status?: unknown;
    price?: unknown;
    condition?: unknown;
    location?: unknown;
    serviceFormat?: unknown;
    eventAt?: unknown;
    lostFoundType?: unknown;
    contactTelegram?: unknown;
    contactInstagram?: unknown;
    contactPhone?: unknown;
    expiresAt?: unknown;
}

export async function updateBoardAnnouncement(
    id: string,
    actorUserId: string,
    patch: UpdateBoardAnnouncementPatch,
    isAdmin: boolean,
): Promise<BoardAnnouncementView> {
    const trimmedId = (id || '').trim();
    if (!trimmedId) throw new BoardError('id is required', 400, 'BOARD_VALIDATION');

    // Build the validated payload patch (only provided fields).
    const payloadPatch: Record<string, unknown> = {};
    try {
        if (patch.title !== undefined) payloadPatch.title = social.validateTitle(patch.title);
        if (patch.body !== undefined) payloadPatch.body = social.validateBody(patch.body);
    } catch (error) {
        throw new BoardError(error instanceof Error ? error.message : 'invalid payload', 400, 'BOARD_VALIDATION');
    }
    const category = patch.category !== undefined ? normalizeBoardCategory(patch.category) : undefined;
    if (category !== undefined) payloadPatch.category = category;
    applyOptionalAnnouncementFields(payloadPatch, patch as Record<string, unknown>, category, category !== undefined);
    if (Object.keys(payloadPatch).length === 0) {
        throw new BoardError('nothing to update', 400, 'BOARD_VALIDATION');
    }

    try {
        await social.updateEntity(trimmedId, actorUserId, payloadPatch);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Admin override: edit any board announcement bypassing owner-only.
        if (message === 'forbidden' && isAdmin) {
            await requireBoardPostgres('updateBoardAnnouncement.forceUpdate', async (client) => {
                await assertBoardEntity(client, trimmedId);
                await client.query(
                    `
                        update app_social_entity
                        set payload = payload || $2::jsonb, updated_at = now()
                        where id = $1::uuid and deleted_at is null
                    `,
                    [trimmedId, JSON.stringify(payloadPatch)],
                );
                return null;
            });
        } else {
            mapSocialError(error);
        }
    }

    return getBoardAnnouncement(trimmedId, actorUserId);
}

// === Delete (owner; admin override) =========================================

export async function deleteBoardAnnouncement(
    id: string,
    actorUserId: string,
    isAdmin: boolean,
    reason?: string,
): Promise<void> {
    const trimmedId = (id || '').trim();
    if (!trimmedId) throw new BoardError('id is required', 400, 'BOARD_VALIDATION');

    try {
        await social.softDeleteEntity(trimmedId, actorUserId, reason);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'forbidden' && isAdmin) {
            await requireBoardPostgres('deleteBoardAnnouncement.forceDelete', async (client) => {
                await assertBoardEntity(client, trimmedId);
                await client.query(
                    `
                        update app_social_entity
                        set deleted_at = now(),
                            deleted_by_user_id = $2,
                            deleted_reason = $3,
                            updated_at = now()
                        where id = $1::uuid and deleted_at is null
                    `,
                    [trimmedId, actorUserId, reason ?? 'moderation'],
                );
                return null;
            });
        } else {
            mapSocialError(error);
        }
    }
}

export async function deleteAllBoardAnnouncements(
    actorUserId: string,
    reason = 'super-admin-clear-board',
): Promise<number> {
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedActor) throw new BoardError('actorUserId is required', 400, 'BOARD_VALIDATION');

    return requireBoardPostgres('deleteAllBoardAnnouncements', async (client) => {
        const result = await client.query(
            `
                update app_social_entity
                set deleted_at = now(),
                    deleted_by_user_id = $1,
                    deleted_reason = $2,
                    pinned = false,
                    updated_at = now()
                where scope_type = $3
                  and scope_id = $4
                  and kind = 'announcement'
                  and deleted_at is null
            `,
            [trimmedActor, reason, BOARD_SCOPE_TYPE, BOARD_SCOPE_ID],
        );
        return result.rowCount ?? 0;
    });
}

// === Pin (admin-only) ========================================================

export async function pinBoardAnnouncement(
    id: string,
    pinned: boolean,
): Promise<void> {
    const trimmedId = (id || '').trim();
    if (!trimmedId) throw new BoardError('id is required', 400, 'BOARD_VALIDATION');
    // Pinning is an admin/moderation action on the board, so we always go
    // through the board-scoped direct query (route layer enforces admin).
    await requireBoardPostgres('pinBoardAnnouncement', async (client) => {
        await assertBoardEntity(client, trimmedId);
        await client.query(
            `update app_social_entity set pinned = $2, updated_at = now() where id = $1::uuid`,
            [trimmedId, pinned],
        );
        return null;
    });
}
