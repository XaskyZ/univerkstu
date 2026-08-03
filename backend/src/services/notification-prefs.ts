/**
 * Per-kind push-notification preferences service.
 *
 * Sits between the REST surface (`routes/notifications.ts`) and the delivery
 * primitives in `services/push.ts` + `services/social-events.ts`. The contract
 * is intentionally minimal:
 *
 *   - storage is a single `app_notification_prefs` row keyed on `user_id`
 *     with a sparse JSONB map of `kind → boolean`
 *   - missing rows and missing keys both mean "default-on", so any newly added
 *     `PushKind` value is automatically enabled for existing users without a
 *     migration
 *   - writes are upserts that merge over the existing map server-side, so the
 *     client can toggle a single key without resending the whole object
 *
 * The gate function `isPushKindEnabledForUser` is called from the fan-out hot
 * path (one call per (user, kind) push). It must be cheap and tolerant of PG
 * unavailability — when the DB is down we fail open so users do not silently
 * stop receiving notifications during an outage.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import type { PushKind } from './push.js';

export type NotificationKind = PushKind;

/**
 * Whitelist of recognized push kinds. Mirrors the `PushKind` union; keeping it
 * as a runtime constant lets the route layer validate incoming keys without
 * leaking other strings into the JSONB map.
 */
export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
    '1day',
    '1hour',
    'social_mention',
    'social_dm',
    'social_comment',
    'social_group_post',
    'social_announcement',
    'event_1day',
    'event_1hour',
] as const;

const NOTIFICATION_KIND_SET = new Set<string>(NOTIFICATION_KINDS);

export function isValidNotificationKind(value: unknown): value is NotificationKind {
    return typeof value === 'string' && NOTIFICATION_KIND_SET.has(value);
}

export interface NotificationPrefs {
    userId: string;
    enabledKinds: Partial<Record<NotificationKind, boolean>>;
    updatedAt: string;
    createdAt: string;
}

/**
 * Default response shape when no row exists yet. The empty map signals
 * "all kinds default-on" without writing anything to storage.
 */
function defaultPrefs(userId: string): NotificationPrefs {
    const now = new Date().toISOString();
    return {
        userId,
        enabledKinds: {},
        updatedAt: now,
        createdAt: now,
    };
}

interface RawPrefsRow {
    user_id: string;
    enabled_kinds: unknown;
    updated_at: Date | string;
    created_at: Date | string;
}

function sanitizeEnabledKinds(raw: unknown): Partial<Record<NotificationKind, boolean>> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Partial<Record<NotificationKind, boolean>> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!isValidNotificationKind(key)) continue;
        if (typeof value === 'boolean') {
            out[key] = value;
        }
    }
    return out;
}

function rowToPrefs(row: RawPrefsRow): NotificationPrefs {
    const updatedAt = row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : String(row.updated_at);
    const createdAt = row.created_at instanceof Date
        ? row.created_at.toISOString()
        : String(row.created_at);
    return {
        userId: row.user_id,
        enabledKinds: sanitizeEnabledKinds(row.enabled_kinds),
        updatedAt,
        createdAt,
    };
}

async function selectPrefsRow(
    client: PoolClient,
    userId: string,
): Promise<RawPrefsRow | null> {
    const result = await client.query<RawPrefsRow>(
        `
            select user_id, enabled_kinds, updated_at, created_at
            from app_notification_prefs
            where user_id = $1
            limit 1
        `,
        [userId],
    );
    return result.rows[0] ?? null;
}

/**
 * Read the prefs row for a user. Returns a synthesized default object when no
 * row exists — callers should treat the response as "current effective prefs"
 * and not assume the row physically exists.
 */
export async function getNotificationPrefs(userId: string): Promise<NotificationPrefs> {
    const result = await withSupabasePostgres<{ value: NotificationPrefs }>(async (client) => {
        const row = await selectPrefsRow(client, userId);
        if (!row) return { value: defaultPrefs(userId) };
        return { value: rowToPrefs(row) };
    });
    if (result === null) {
        // PG unavailable — return defaults (fail-open).
        return defaultPrefs(userId);
    }
    return result.value;
}

/**
 * Upsert the prefs row for a user. `updates` is merged over the existing JSONB
 * map server-side via `||` so the caller can toggle a single key without
 * resending the full object. Unknown keys are dropped at validation time.
 */
export async function setNotificationPrefs(
    userId: string,
    updates: Partial<Record<NotificationKind, boolean>>,
): Promise<NotificationPrefs> {
    // Reject any unknown key defensively — keeps the JSONB map narrow.
    const sanitized: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(updates)) {
        if (!isValidNotificationKind(key)) continue;
        if (typeof value !== 'boolean') continue;
        sanitized[key] = value;
    }

    const result = await withSupabasePostgres<{ value: NotificationPrefs }>(async (client) => {
        const now = new Date();
        const row = await client.query<RawPrefsRow>(
            `
                insert into app_notification_prefs (user_id, enabled_kinds, updated_at, created_at)
                values ($1, $2::jsonb, $3, $3)
                on conflict (user_id)
                do update set
                    enabled_kinds = app_notification_prefs.enabled_kinds || excluded.enabled_kinds,
                    updated_at    = excluded.updated_at
                returning user_id, enabled_kinds, updated_at, created_at
            `,
            [userId, JSON.stringify(sanitized), now],
        );
        return { value: rowToPrefs(row.rows[0]) };
    });
    if (result === null) {
        // PG unavailable — surface a soft default so the route can decide whether
        // to expose a 5xx. We do not pretend the write succeeded.
        throw new Error('Postgres unavailable during setNotificationPrefs');
    }
    return result.value;
}

/**
 * Hot-path gate consulted by every social-events fan-out. Optimized for the
 * default case (no row → all kinds on) so most calls perform exactly one
 * indexed lookup and return immediately.
 *
 * Failure semantics: any unexpected error returns `true` so a transient PG
 * blip does not silently mute users. The caller is free to log; this function
 * does not.
 */
export async function isPushKindEnabledForUser(
    userId: string,
    kind: NotificationKind,
): Promise<boolean> {
    if (!isValidNotificationKind(kind)) {
        // Defensive: an unknown kind is treated as "off" — we do not invent
        // delivery for kinds the user could not possibly have opted into.
        return false;
    }
    try {
        const result = await withSupabasePostgres<{ value: boolean }>(async (client) => {
            const row = await selectPrefsRow(client, userId);
            if (!row) return { value: true }; // default-on
            const map = sanitizeEnabledKinds(row.enabled_kinds);
            if (!Object.prototype.hasOwnProperty.call(map, kind)) return { value: true };
            return { value: map[kind] === true };
        });
        if (result === null) return true; // PG unavailable → fail-open
        return result.value;
    } catch {
        return true;
    }
}
