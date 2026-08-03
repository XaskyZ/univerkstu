/**
 * Social view tracking — per-user "I've seen this entity" markers backed by
 * `app_social_view`. Each (entity_id, user_id) tuple is recorded at most once
 * (composite PK + `ON CONFLICT DO NOTHING`), so the per-entity view count is
 * the number of distinct users who have ever observed the entity.
 *
 * Why a separate table:
 *  - Read markers (`app_social_read_marker`) are per-scope and timestamp-based
 *    — they answer "what is the viewer's last-read cursor in this DM/feed".
 *    They cannot answer "how many distinct people have seen this specific
 *    entity", which is what the announcement UI needs (the legacy
 *    `app_coordinator_announcement_views` table did the same per-announcement
 *    counting before the social-store migration).
 *  - Comments / reactions / mentions all have their own cross-cutting tables;
 *    views fit the same pattern.
 *
 * Phase 2 usage:
 *  - The frontend mounts `useSocialViewTracker` per visible card and POSTs
 *    `/api/v3/social/entities/:id/view` after a short dwell (2s default).
 *  - `listEntitiesByScope` / `getEntityView` enrich each row with
 *    `viewCount` + `hasViewed` so the UI can render counters without an
 *    extra round-trip.
 *  - The legacy `markCoordinatorAnnouncementViewed` flow is left untouched —
 *    it continues to populate `app_coordinator_announcement_views` for the
 *    legacy code path. The two paths do not share a table.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { assertScopeAccess } from './social.js';
import type { SocialScopeType } from '../types/social.js';

// === Internal helpers ========================================================

async function requireViewPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[SocialView] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

// === API =====================================================================

/**
 * Record that `userId` has viewed `entityId`. Idempotent — the composite PK
 * plus `ON CONFLICT DO NOTHING` collapses repeated calls into a single row, so
 * the per-entity view count is "distinct users who saw the entity at least
 * once" rather than "raw view count".
 *
 * Throws on missing inputs.
 *
 * Контроль доступа: перед вставкой читается scope родительской сущности и
 * прогоняется `assertScopeAccess` — счётчик просмотров чужой группы/переписки
 * нельзя накрутить, зная только UUID. Отсутствующая сущность даёт 'not found'
 * (раньше это всплывало как FK-violation → 500). Soft-deleted сущности
 * по-прежнему принимают просмотр: карточка могла быть удалена уже после того,
 * как зритель её открыл.
 */
export async function recordView(entityId: string, userId: string): Promise<void> {
    const trimmedEntity = (entityId || '').trim();
    const trimmedUser = (userId || '').trim();
    if (!trimmedEntity) throw new Error('entityId is required');
    if (!trimmedUser) throw new Error('userId is required');

    await requireViewPostgres('recordView', async (client) => {
        const scope = await client.query<{ scope_type: string; scope_id: string }>(
            `select scope_type, scope_id from app_social_entity where id = $1::uuid limit 1`,
            [trimmedEntity],
        );
        if (scope.rowCount === 0) throw new Error('not found');
        await assertScopeAccess(
            scope.rows[0].scope_type as SocialScopeType,
            scope.rows[0].scope_id,
            trimmedUser,
        );

        await client.query(
            `
                insert into app_social_view (entity_id, user_id)
                values ($1::uuid, $2)
                on conflict (entity_id, user_id) do nothing
            `,
            [trimmedEntity, trimmedUser],
        );
        return null;
    });
}

/**
 * Single-entity view count. Returns 0 for unknown / unviewed entities.
 *
 * Intentionally not coupled to `app_social_entity` — the count is independent
 * of soft-delete state so revoked announcements can still surface the legacy
 * view counter for moderation audits. Callers that want a "live" filter can
 * intersect with the entity table themselves.
 */
export async function getViewCount(entityId: string): Promise<number> {
    const trimmedEntity = (entityId || '').trim();
    if (!trimmedEntity) return 0;

    return requireViewPostgres('getViewCount', async (client) => {
        const result = await client.query<{ count: string }>(
            `
                select count(*)::text as count
                from app_social_view
                where entity_id = $1::uuid
            `,
            [trimmedEntity],
        );
        const raw = result.rows[0]?.count ?? '0';
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    });
}

/**
 * Batched view-count fetch — one round-trip for N entities. Returns a map
 * keyed by entity id; entities with zero views are absent from the map (callers
 * should treat missing keys as 0).
 *
 * Used by `listEntitiesByScope` / `getEntityView` to enrich aggregates without
 * issuing one count query per row.
 */
export async function getViewCountsBatch(
    entityIds: string[],
): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (!Array.isArray(entityIds) || entityIds.length === 0) return out;
    const cleaned = Array.from(
        new Set(
            entityIds
                .map((id) => (typeof id === 'string' ? id.trim() : ''))
                .filter((id) => id.length > 0),
        ),
    );
    if (cleaned.length === 0) return out;

    return requireViewPostgres('getViewCountsBatch', async (client) => {
        const result = await client.query<{ entity_id: string; count: string }>(
            `
                select entity_id::text as entity_id, count(*)::text as count
                from app_social_view
                where entity_id = any($1::uuid[])
                group by entity_id
            `,
            [cleaned],
        );
        for (const row of result.rows) {
            const count = Number(row.count) || 0;
            if (count > 0) out.set(row.entity_id, count);
        }
        return out;
    });
}

/**
 * Does `userId` already have a recorded view on `entityId`? Used by
 * `listEntitiesByScope` to populate the per-row `hasViewed` flag so the UI can
 * suppress "new" badges for entities the viewer already opened.
 */
export async function hasUserViewed(
    entityId: string,
    userId: string,
): Promise<boolean> {
    const trimmedEntity = (entityId || '').trim();
    const trimmedUser = (userId || '').trim();
    if (!trimmedEntity || !trimmedUser) return false;

    return requireViewPostgres('hasUserViewed', async (client) => {
        const result = await client.query(
            `
                select 1 from app_social_view
                where entity_id = $1::uuid and user_id = $2
                limit 1
            `,
            [trimmedEntity, trimmedUser],
        );
        return result.rowCount > 0;
    });
}

/**
 * Batched "has the viewer seen these entities" lookup — one round-trip for N
 * entities. Returns a Set of entity ids the viewer has already viewed.
 *
 * Used by `listEntitiesByScope` to populate the per-row `hasViewed` flag in
 * the same pass as the view-count fetch.
 */
export async function getViewerSeenEntities(
    entityIds: string[],
    userId: string,
): Promise<Set<string>> {
    const out = new Set<string>();
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return out;
    if (!Array.isArray(entityIds) || entityIds.length === 0) return out;
    const cleaned = Array.from(
        new Set(
            entityIds
                .map((id) => (typeof id === 'string' ? id.trim() : ''))
                .filter((id) => id.length > 0),
        ),
    );
    if (cleaned.length === 0) return out;

    return requireViewPostgres('getViewerSeenEntities', async (client) => {
        const result = await client.query<{ entity_id: string }>(
            `
                select entity_id::text as entity_id
                from app_social_view
                where user_id = $1 and entity_id = any($2::uuid[])
            `,
            [trimmedUser, cleaned],
        );
        for (const row of result.rows) {
            if (row.entity_id) out.add(row.entity_id);
        }
        return out;
    });
}

/**
 * Return the user ids that have viewed `entityId`, ordered by most-recent
 * view first. Used by the admin-only `GET /social/entities/:id/views` route
 * (visibility-into-who-saw-the-announcement is moderation-sensitive — the
 * surface is gated to coordinator/curator/super-admin at the route layer).
 *
 * `limit` is clamped to a sensible upper bound so a malicious caller cannot
 * page through a huge audit-log in one request.
 */
export async function listEntityViewers(
    entityId: string,
    limit = 500,
): Promise<Array<{ userId: string; viewedAt: string }>> {
    const trimmedEntity = (entityId || '').trim();
    if (!trimmedEntity) return [];
    const cappedLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 500, 2000));

    return requireViewPostgres('listEntityViewers', async (client) => {
        const result = await client.query<{ user_id: string; viewed_at: Date | string }>(
            `
                select user_id, viewed_at
                from app_social_view
                where entity_id = $1::uuid
                order by viewed_at desc
                limit $2
            `,
            [trimmedEntity, cappedLimit],
        );
        return result.rows.map((row) => ({
            userId: row.user_id,
            viewedAt: row.viewed_at instanceof Date
                ? row.viewed_at.toISOString()
                : new Date(row.viewed_at).toISOString(),
        }));
    });
}
