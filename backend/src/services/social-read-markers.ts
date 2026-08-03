/**
 * Social read markers — per-viewer "last seen" cursors for universal social
 * scopes. Drives unread-count badges and read receipts for DM messages
 * (kind = `dm_message`, scope = `dm:roomId`) in v4.
 *
 * Why a separate table:
 *  - The legacy DM read state lives on `app_chat_rooms` and is only valid for
 *    the legacy chat-room model. The universal social store spans many kinds
 *    and scopes (DMs, group feed, tasks, announcements, …) so per-viewer
 *    cursors need a dedicated table keyed by (user_id, scope_type, scope_id).
 *  - Computing unread on top of `app_social_entity` keeps the data model
 *    consistent with the rest of the social rollout (see docs/SOCIAL_STORE.md)
 *    and lets the same cursor power feeds / tasks / etc. in later iterations.
 *
 * Scope key helper: routes and the frontend communicate scopes as
 * `"<scope_type>:<raw_id>"` strings (the canonical form returned by
 * `services/social.ts#buildScopeId`). `parseScopeKey` splits one back into
 * `{ scopeType, scopeId }` so the service can be called with either form.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { assertCanReadGroup } from './group-space.js';
import { buildScopeId, isSocialSearchHitVisible } from './social.js';
import type { SocialScopeType } from '../types/social.js';

// === Types ==================================================================

export interface SocialReadMarker {
    userId: string;
    scopeType: SocialScopeType;
    scopeId: string;
    lastReadAt: string;
    lastReadEntityId: string | null;
}

// === Internal helpers =======================================================

const ALLOWED_SCOPE_TYPES: readonly SocialScopeType[] = [
    'group',
    'dm',
    'global',
    'announcement',
];

function isSocialScopeType(value: string): value is SocialScopeType {
    return (ALLOWED_SCOPE_TYPES as readonly string[]).includes(value);
}

/**
 * Split a "type:id" scope key into its parts. Returns `null` for malformed
 * input. Re-exports `buildScopeId` semantics on the reverse direction — the
 * raw id may itself contain `:` (e.g. `dm:direct:alice::bob`) so we only
 * split on the first separator.
 */
export function parseScopeKey(
    raw: string,
): { scopeType: SocialScopeType; scopeId: string } | null {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;
    const colon = trimmed.indexOf(':');
    if (colon <= 0 || colon === trimmed.length - 1) return null;
    const type = trimmed.slice(0, colon);
    if (!isSocialScopeType(type)) return null;
    const rest = trimmed.slice(colon + 1);
    // Build the canonical scope id ourselves so callers cannot accidentally
    // pass an un-prefixed raw id by hand and end up storing a different key
    // than `app_social_entity.scope_id` carries.
    return { scopeType: type, scopeId: buildScopeId(type, rest) };
}

function toIso(value: Date | string | null): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

async function requireMarkerPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[SocialReadMarker] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

// === API ====================================================================

/**
 * Upsert a read marker for (userId, scopeType, scopeId). Always advances
 * `last_read_at` to `now()` because the caller is signalling "I've read up to
 * here as of right now". `lastReadEntityId` is optional bookkeeping for richer
 * "since X" diff renderers in the future — unread-count computation today is
 * timestamp-based (so passing it is purely advisory).
 *
 * Idempotent — calling repeatedly just bumps the timestamp.
 */
export async function markScopeRead(
    userId: string,
    scopeType: SocialScopeType,
    scopeId: string,
    lastEntityId?: string,
): Promise<void> {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) throw new Error('userId is required');
    if (!isSocialScopeType(scopeType)) throw new Error('invalid scopeType');
    const normalizedScopeId = buildScopeId(scopeType, scopeId);
    const trimmedEntity = typeof lastEntityId === 'string' && lastEntityId.trim()
        ? lastEntityId.trim()
        : null;

    await requireMarkerPostgres('markScopeRead', async (client) => {
        await client.query(
            `
                insert into app_social_read_marker
                    (user_id, scope_type, scope_id, last_read_at, last_read_entity_id)
                values ($1, $2, $3, now(), $4)
                on conflict (user_id, scope_type, scope_id)
                do update set
                    last_read_at = now(),
                    last_read_entity_id = coalesce(excluded.last_read_entity_id, app_social_read_marker.last_read_entity_id)
            `,
            [trimmedUser, scopeType, normalizedScopeId, trimmedEntity],
        );
        return null;
    });
}

type MarkerRow = {
    user_id: string;
    scope_type: string;
    scope_id: string;
    last_read_at: Date | string;
    last_read_entity_id: string | null;
};

/**
 * Отфильтровать список scope до тех, что пользователь реально имеет право
 * читать. Счётчики непрочитанного считаются по произвольным парам
 * `(scope_type, scope_id)`, которые присылает клиент, а ключи групп и DM
 * угадываются тривиально (каталог групп и поиск пользователей доступны любому
 * аутентифицированному). Без фильтра можно было узнать, сколько сообщений
 * лежит в чужой группе и существует ли переписка между двумя студентами.
 *
 * Логика повторяет `searchSocialEntities` (services/social.ts): группы
 * резолвятся один раз на уникальный scope_id через `assertCanReadGroup`,
 * остальное решает чистый `isSocialSearchHitVisible`. Недоступные ключи
 * молча отбрасываются — эндпоинт и так тихо игнорирует некорректные,
 * поэтому для легитимных вызовов поведение не меняется.
 */
async function filterVisibleScopes<T extends { scopeType: SocialScopeType; scopeId: string }>(
    userId: string,
    scopes: T[],
): Promise<T[]> {
    if (scopes.length === 0) return [];

    const distinctGroupScopeIds: string[] = Array.from(
        new Set<string>(scopes.filter((s) => s.scopeType === 'group').map((s) => s.scopeId)),
    );
    const allowedGroupScopeIds = new Set<string>();
    await Promise.all(
        distinctGroupScopeIds.map(async (scopeId: string) => {
            // scope_id хранится как `group:<ключ>`; assertCanReadGroup ждёт
            // голый ключ группы без префикса.
            const rawKey = scopeId.startsWith('group:') ? scopeId.slice('group:'.length) : scopeId;
            try {
                await assertCanReadGroup(userId, rawKey);
                allowedGroupScopeIds.add(scopeId);
            } catch {
                /* не участник — отбрасываем */
            }
        }),
    );

    return scopes.filter((scope) =>
        isSocialSearchHitVisible(
            { scopeType: scope.scopeType, scopeId: scope.scopeId },
            userId,
            allowedGroupScopeIds,
        ),
    );
}

function buildScopeKey(scopeType: SocialScopeType | string, scopeId: string): string {
    // scopeId is already canonical (`type:rest`) — just pass it through. Keeps
    // the map key consistent with what the frontend sends as `scopes=...`.
    if (scopeId.startsWith(`${scopeType}:`)) return scopeId;
    return `${scopeType}:${scopeId}`;
}

/**
 * Fetch read markers for the supplied scope keys (`"type:id"` strings). When
 * `scopeKeys` is omitted, returns every marker the user has — useful for an
 * "all my unread" view (not used yet, but the contract surface is here).
 * Result map is keyed by the canonical scope key so callers can look up a
 * marker via the same string they passed in.
 *
 * Missing markers are simply absent from the map (no synthetic "never read"
 * row). Callers that need a "default = epoch" behaviour should fall back to
 * the entity's own `created_at < now()` semantics — see `getUnreadCount`.
 */
export async function getReadMarkers(
    userId: string,
    scopeKeys?: string[],
): Promise<Map<string, SocialReadMarker>> {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return new Map();

    const parsed: Array<{ scopeType: SocialScopeType; scopeId: string; key: string }> = [];
    if (Array.isArray(scopeKeys)) {
        const seen = new Set<string>();
        for (const raw of scopeKeys) {
            const split = parseScopeKey(raw);
            if (!split) continue;
            const key = buildScopeKey(split.scopeType, split.scopeId);
            if (seen.has(key)) continue;
            seen.add(key);
            parsed.push({ scopeType: split.scopeType, scopeId: split.scopeId, key });
        }
        if (parsed.length === 0) return new Map();
    }

    return requireMarkerPostgres('getReadMarkers', async (client) => {
        let rows;
        if (parsed.length > 0) {
            const types = parsed.map((p) => p.scopeType);
            const ids = parsed.map((p) => p.scopeId);
            rows = await client.query<MarkerRow>(
                `
                    select user_id, scope_type, scope_id, last_read_at, last_read_entity_id
                    from app_social_read_marker
                    where user_id = $1
                      and (scope_type, scope_id) in (
                        select * from unnest($2::text[], $3::text[])
                      )
                `,
                [trimmedUser, types, ids],
            );
        } else {
            rows = await client.query<MarkerRow>(
                `
                    select user_id, scope_type, scope_id, last_read_at, last_read_entity_id
                    from app_social_read_marker
                    where user_id = $1
                `,
                [trimmedUser],
            );
        }

        const out = new Map<string, SocialReadMarker>();
        for (const row of rows.rows) {
            if (!isSocialScopeType(row.scope_type)) continue;
            const key = buildScopeKey(row.scope_type, row.scope_id);
            out.set(key, {
                userId: row.user_id,
                scopeType: row.scope_type,
                scopeId: row.scope_id,
                lastReadAt: toIso(row.last_read_at) ?? new Date(0).toISOString(),
                lastReadEntityId: row.last_read_entity_id,
            });
        }
        return out;
    });
}

/**
 * Count entities in `(scopeType, scopeId)` that:
 *   - were created strictly after the viewer's `last_read_at` (or all of them
 *     when no marker exists yet)
 *   - are authored by someone OTHER than the viewer (we don't count the
 *     viewer's own messages as unread to themselves)
 *   - are not soft-deleted
 *
 * Returns 0 for unknown / empty scopes. Throws on invalid scope type.
 *
 * Scope the viewer has no access to also returns 0 — same silent-drop rule as
 * the batch variant below (see `filterVisibleScopes`).
 */
export async function getUnreadCount(
    userId: string,
    scopeType: SocialScopeType,
    scopeId: string,
): Promise<number> {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return 0;
    if (!isSocialScopeType(scopeType)) throw new Error('invalid scopeType');
    const normalizedScopeId = buildScopeId(scopeType, scopeId);

    const visible = await filterVisibleScopes(trimmedUser, [
        { scopeType, scopeId: normalizedScopeId },
    ]);
    if (visible.length === 0) return 0;

    return requireMarkerPostgres('getUnreadCount', async (client) => {
        const result = await client.query<{ count: string }>(
            `
                select count(*)::text as count
                from app_social_entity e
                left join app_social_read_marker m
                  on m.user_id = $1
                 and m.scope_type = e.scope_type
                 and m.scope_id = e.scope_id
                where e.scope_type = $2
                  and e.scope_id = $3
                  and e.deleted_at is null
                  and e.author_user_id <> $1
                  and (m.last_read_at is null or e.created_at > m.last_read_at)
            `,
            [trimmedUser, scopeType, normalizedScopeId],
        );
        const raw = result.rows[0]?.count ?? '0';
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    });
}

/**
 * Batch variant of `getUnreadCount` — single SQL round-trip for N scopes.
 *
 * The frontend uses this to render unread badges on a room list without
 * issuing one request per row. Unknown scope keys are silently dropped so a
 * partially-bad input still returns a useful map for the valid entries.
 * Scopes with zero unread are NOT included in the result map — callers
 * should treat missing entries as 0.
 *
 * Scopes the viewer has no access to are dropped the same silent way (see
 * `filterVisibleScopes`) — the frontend only ever asks about rooms it has
 * already rendered, so legitimate callers see no difference.
 */
export async function getUnreadCountsBatch(
    userId: string,
    scopeKeys: string[],
): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return out;
    if (!Array.isArray(scopeKeys) || scopeKeys.length === 0) return out;

    const parsed: Array<{ scopeType: SocialScopeType; scopeId: string; key: string }> = [];
    const seen = new Set<string>();
    for (const raw of scopeKeys) {
        const split = parseScopeKey(raw);
        if (!split) continue;
        const key = buildScopeKey(split.scopeType, split.scopeId);
        if (seen.has(key)) continue;
        seen.add(key);
        parsed.push({ scopeType: split.scopeType, scopeId: split.scopeId, key });
    }
    if (parsed.length === 0) return out;

    const visible = await filterVisibleScopes(trimmedUser, parsed);
    if (visible.length === 0) return out;

    return requireMarkerPostgres('getUnreadCountsBatch', async (client) => {
        const types = visible.map((p) => p.scopeType);
        const ids = visible.map((p) => p.scopeId);
        const result = await client.query<{
            scope_type: string;
            scope_id: string;
            count: string;
        }>(
            `
                with target_scopes as (
                    select * from unnest($2::text[], $3::text[])
                    as t(scope_type, scope_id)
                )
                select e.scope_type, e.scope_id, count(*)::text as count
                from app_social_entity e
                join target_scopes t
                  on t.scope_type = e.scope_type
                 and t.scope_id = e.scope_id
                left join app_social_read_marker m
                  on m.user_id = $1
                 and m.scope_type = e.scope_type
                 and m.scope_id = e.scope_id
                where e.deleted_at is null
                  and e.author_user_id <> $1
                  and (m.last_read_at is null or e.created_at > m.last_read_at)
                group by e.scope_type, e.scope_id
            `,
            [trimmedUser, types, ids],
        );

        for (const row of result.rows) {
            if (!isSocialScopeType(row.scope_type)) continue;
            const key = buildScopeKey(row.scope_type, row.scope_id);
            const count = Number(row.count) || 0;
            if (count > 0) out.set(key, count);
        }
        return out;
    });
}
