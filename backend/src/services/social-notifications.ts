/**
 * Per-viewer social notification feed.
 *
 * Phase 2 surface — the user-facing Notification Center page. The push fan-out
 * in `services/social-events.ts` only delivers ephemeral OS notifications; if a
 * user misses a push there is no UI today that lets them see the recent events
 * targeted at them. This service backs the list at `/notifications`.
 *
 * Source-of-truth for "events targeted at this user":
 *   - `app_social_mention` rows where `mentioned_user_id = $viewer`.
 *
 * `source_kind` ('entity' | 'comment') tells us what generated the mention so
 * we can compute a small text snippet for the card. The mention row is also
 * the carrier for read state via the `read_at` timestamptz column added in the
 * same change as this service (`backend/src/db/postgres.ts`).
 *
 * Why piggy-back on `app_social_mention` instead of a new
 * `app_social_notification` table:
 *   - mention rows already encode every push fan-out target (mentions, DMs,
 *     comments, group posts, announcements) — see `services/social-events.ts`
 *     for which kinds trigger them
 *   - one source-of-truth table means the read state cannot drift from the
 *     underlying event
 *   - the `read_at` column is sparse-indexed so unread counts stay cheap
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import type { SocialEntityKind, SocialScopeType } from '../types/social.js';

// === Public types ===========================================================

/**
 * Notification kinds surfaced to the UI. These are NOT the same set as the
 * push-fan-out `PushKind` values — the notification center treats anything
 * that produced a mention row as a single conceptual "mention" by default,
 * unless the source entity is a DM/comment/group post/announcement, in which
 * case we map it to the more specific kind for richer rendering.
 */
export type SocialNotificationKind =
    | 'mention'
    | 'dm'
    | 'comment'
    | 'group_post'
    | 'announcement';

export interface SocialNotification {
    /** `app_social_mention.id` */
    id: string;
    kind: SocialNotificationKind;
    /** The row that generated the mention (entity row or comment row). */
    sourceKind: 'entity' | 'comment';
    sourceEntityId: string;
    /** The parent entity that the user should land on when tapping the card. */
    entityId: string;
    actorUserId: string;
    /** Short text snippet for the card (≤ 160 chars). */
    summary: string;
    scopeType: SocialScopeType;
    scopeId: string;
    /** Originating entity kind — useful for icons / labels in the UI. */
    entityKind: SocialEntityKind;
    createdAt: string;
    readAt: string | null;
}

export interface ListSocialNotificationsOptions {
    /** Hard cap regardless — service clamps to [1, MAX_LIMIT]. */
    limit?: number;
    /** Cursor: ISO `created_at` of the last item the client already has. */
    before?: string;
    /** When true, returns only rows with `read_at is null`. */
    unreadOnly?: boolean;
}

// === Limits =================================================================

export const SOCIAL_NOTIFICATION_DEFAULT_LIMIT = 30;
export const SOCIAL_NOTIFICATION_MAX_LIMIT = 100;
export const SOCIAL_NOTIFICATION_SUMMARY_MAX = 160;

// === Internal helpers =======================================================

const VALID_SCOPE_TYPES: ReadonlySet<SocialScopeType> = new Set(['group', 'dm', 'global', 'announcement']);
const VALID_ENTITY_KINDS: ReadonlySet<SocialEntityKind> = new Set([
    'post',
    'task',
    'extra_lesson',
    'poll',
    'event',
    'announcement',
    'dm_message',
    'global_message',
]);

function isSocialScopeType(value: unknown): value is SocialScopeType {
    return typeof value === 'string' && VALID_SCOPE_TYPES.has(value as SocialScopeType);
}

function isSocialEntityKind(value: unknown): value is SocialEntityKind {
    return typeof value === 'string' && VALID_ENTITY_KINDS.has(value as SocialEntityKind);
}

function toIso(value: Date | string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function clampLimit(input: unknown): number {
    if (typeof input !== 'number' || !Number.isFinite(input)) {
        return SOCIAL_NOTIFICATION_DEFAULT_LIMIT;
    }
    const floored = Math.floor(input);
    if (floored <= 0) return SOCIAL_NOTIFICATION_DEFAULT_LIMIT;
    return Math.min(SOCIAL_NOTIFICATION_MAX_LIMIT, floored);
}

/**
 * Pure helper — derive the SocialNotificationKind label from the raw mention
 * row. Exposed for unit tests so the mapping can be exercised without
 * round-tripping through Postgres.
 */
export function deriveNotificationKind(
    sourceKind: 'entity' | 'comment',
    entityKind: SocialEntityKind,
): SocialNotificationKind {
    // Comment-sourced mentions always present as 'comment' regardless of the
    // parent entity kind — the UI renders "так-то replied to your post" style.
    if (sourceKind === 'comment') return 'comment';

    // Entity-sourced mentions: map per kind. Anything not in the table below
    // falls back to the generic 'mention' label.
    switch (entityKind) {
        case 'dm_message':
        case 'global_message':
            return 'dm';
        case 'announcement':
            return 'announcement';
        case 'post':
        case 'task':
        case 'extra_lesson':
        case 'poll':
        case 'event':
            return 'group_post';
        default:
            return 'mention';
    }
}

/**
 * Pure helper — pull a short text snippet out of the source row's free-text
 * fields. The order of preference mirrors the entity-kind-vs-payload table in
 * `docs/SOCIAL_STORE.md`: title > body > subject > question > note > a
 * generic placeholder.
 */
export function pickSummary(
    sourceKind: 'entity' | 'comment',
    commentBody: string | null,
    entityPayload: Record<string, unknown> | null,
    max: number = SOCIAL_NOTIFICATION_SUMMARY_MAX,
): string {
    const pickField = (raw: unknown): string => {
        if (typeof raw !== 'string') return '';
        return raw.trim();
    };

    if (sourceKind === 'comment') {
        const body = pickField(commentBody);
        if (body) return truncate(body, max);
    }

    const payload = entityPayload ?? {};
    const candidates = [
        pickField(payload.body),
        pickField(payload.title),
        pickField(payload.subject),
        pickField(payload.question),
        pickField(payload.note),
    ];
    for (const candidate of candidates) {
        if (candidate) return truncate(candidate, max);
    }
    return '';
}

function truncate(value: string, max: number): string {
    if (value.length <= max) return value;
    return `${value.slice(0, Math.max(1, max - 1))}…`;
}

async function requirePostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[SocialNotifications] Postgres unavailable during ${operation}`);
    }
    return result.value;
}

// === SQL row shape ==========================================================

interface MentionRow {
    id: string;
    source_kind: 'entity' | 'comment';
    source_id: string;
    entity_id: string;
    author_user_id: string;
    created_at: Date | string;
    read_at: Date | string | null;
    entity_kind: string | null;
    scope_type: string | null;
    scope_id: string | null;
    entity_payload: Record<string, unknown> | null;
    comment_body: string | null;
}

function rowToNotification(row: MentionRow): SocialNotification | null {
    if (!isSocialEntityKind(row.entity_kind)) return null;
    if (!isSocialScopeType(row.scope_type)) return null;
    if (typeof row.scope_id !== 'string' || row.scope_id.length === 0) return null;
    const created = toIso(row.created_at);
    if (created === null) return null;

    const kind = deriveNotificationKind(row.source_kind, row.entity_kind);
    const summary = pickSummary(row.source_kind, row.comment_body, row.entity_payload);

    return {
        id: row.id,
        kind,
        sourceKind: row.source_kind,
        sourceEntityId: row.source_id,
        entityId: row.entity_id,
        actorUserId: row.author_user_id,
        summary,
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        entityKind: row.entity_kind,
        createdAt: created,
        readAt: toIso(row.read_at),
    };
}

// === Public API =============================================================

/**
 * Return a chronologically descending slice of notifications for `userId`.
 *
 * Filtering:
 *   - parent entity must NOT be soft-deleted (we never surface tombstoned events)
 *   - when `unreadOnly` is true, `read_at` must be null
 *   - `before` (ISO timestamp) acts as a keyset cursor: only rows strictly
 *     older than that instant are returned. Malformed `before` is silently
 *     dropped (the first page is returned instead)
 *
 * Returns `[]` when the user has no mentions yet (no synthetic seed rows).
 */
export async function listSocialNotifications(
    userId: string,
    opts: ListSocialNotificationsOptions = {},
): Promise<SocialNotification[]> {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return [];

    const limit = clampLimit(opts.limit);
    const unreadOnly = opts.unreadOnly === true;

    let beforeIso: string | null = null;
    if (typeof opts.before === 'string' && opts.before.trim()) {
        const parsed = new Date(opts.before);
        if (!Number.isNaN(parsed.getTime())) {
            beforeIso = parsed.toISOString();
        }
    }

    return requirePostgres('listSocialNotifications', async (client) => {
        // `payload` is jsonb — we extract only the fields needed for the
        // summary snippet client-side instead of dumping the whole document
        // into the response (saves bandwidth on the inbox page).
        //
        // The LEFT JOIN to `app_social_comment` is the only way to get the
        // comment body for `source_kind = 'comment'`; for entity-sourced rows
        // it just returns NULL columns which we ignore.
        const params: unknown[] = [trimmedUser, limit];
        let whereExtra = '';
        if (unreadOnly) {
            whereExtra += ' and m.read_at is null';
        }
        if (beforeIso) {
            params.push(beforeIso);
            whereExtra += ` and m.created_at < $${params.length}::timestamptz`;
        }

        const sql = `
            select m.id::text as id,
                   m.source_kind,
                   m.source_id::text as source_id,
                   m.entity_id::text as entity_id,
                   m.author_user_id,
                   m.created_at,
                   m.read_at,
                   e.kind as entity_kind,
                   e.scope_type,
                   e.scope_id,
                   e.payload as entity_payload,
                   c.body as comment_body
            from app_social_mention m
            join app_social_entity e
              on e.id = m.entity_id
             and e.deleted_at is null
            left join app_social_comment c
              on c.id = m.source_id
             and m.source_kind = 'comment'
             and c.deleted_at is null
            where m.mentioned_user_id = $1
              ${whereExtra}
            order by m.created_at desc, m.id desc
            limit $2
        `;
        const result = await client.query<MentionRow>(sql, params);

        const out: SocialNotification[] = [];
        for (const row of result.rows) {
            const mapped = rowToNotification(row);
            if (mapped) out.push(mapped);
        }
        return out;
    });
}

/**
 * Stamp `read_at = now()` on the given mention rows owned by `userId`. The
 * user-id predicate is on the SQL so a malicious payload cannot mark another
 * user's notifications as read.
 *
 * No-ops on an empty input. Idempotent: re-marking an already-read row leaves
 * the original timestamp in place (the `read_at is null` guard prevents the
 * UPDATE from touching it).
 */
export async function markNotificationsRead(
    userId: string,
    notificationIds: string[],
): Promise<void> {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return;
    if (!Array.isArray(notificationIds) || notificationIds.length === 0) return;

    const seen = new Set<string>();
    const filtered: string[] = [];
    for (const raw of notificationIds) {
        if (typeof raw !== 'string') continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (seen.has(trimmed)) continue;
        seen.add(trimmed);
        filtered.push(trimmed);
    }
    if (filtered.length === 0) return;

    await requirePostgres('markNotificationsRead', async (client) => {
        await client.query(
            `
                update app_social_mention
                set read_at = now()
                where mentioned_user_id = $1
                  and read_at is null
                  and id = any($2::uuid[])
            `,
            [trimmedUser, filtered],
        );
        return null;
    });
}

/**
 * Stamp `read_at = now()` on every unread mention row owned by `userId`. Used
 * by the "Mark all as read" button on the Notification Center page.
 */
export async function markAllNotificationsRead(userId: string): Promise<void> {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return;

    await requirePostgres('markAllNotificationsRead', async (client) => {
        await client.query(
            `
                update app_social_mention
                set read_at = now()
                where mentioned_user_id = $1
                  and read_at is null
            `,
            [trimmedUser],
        );
        return null;
    });
}

/**
 * Count the user's unread notifications. Used by the nav badge. Caps the
 * returned value at 99+ in the UI layer — the backend returns the raw count
 * so the client can decide its own display threshold.
 */
export async function getUnreadNotificationCount(userId: string): Promise<number> {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return 0;

    return requirePostgres('getUnreadNotificationCount', async (client) => {
        const result = await client.query<{ count: string }>(
            `
                select count(*)::text as count
                from app_social_mention m
                join app_social_entity e
                  on e.id = m.entity_id
                 and e.deleted_at is null
                where m.mentioned_user_id = $1
                  and m.read_at is null
            `,
            [trimmedUser],
        );
        const raw = result.rows[0]?.count ?? '0';
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    });
}

// Test-only export bundle for unit tests that want to drive the pure helpers
// without going through `withSupabasePostgres`.
export const __testing = {
    clampLimit,
    truncate,
    rowToNotification,
};
