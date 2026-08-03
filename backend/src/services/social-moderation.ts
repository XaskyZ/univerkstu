/**
 * Universal social moderation service — reports + mutes on top of the
 * universal social store (see docs/SOCIAL_STORE.md and services/social.ts).
 *
 * Replaces the legacy global-chat moderation surface
 * (`services/global-chat.ts#reportGlobalChatMessage`,
 *  `muteGlobalChatUser`, `unmuteGlobalChatUser`, `reviewGlobalChatReport`)
 * with a scope-aware, entity-aware workflow that scales beyond global chat
 * (DMs, group feed, announcements, anything that produces a SocialEntity).
 *
 * Authorization model:
 *   - report — any authenticated user. Service does not gate, the route does
 *     (`app.authenticate`).
 *   - listReports / reviewReport / muteUser / unmuteUser — admin-only at the
 *     route layer (`requireAdminAccess`); the service trusts the caller.
 *   - isUserMuted / getActiveMutes — internal, used by createEntity to gate
 *     posts (see services/social.ts#createEntity).
 *
 * The service exposes thin pure DB calls. All Postgres access is funnelled
 * through `requireSocialPostgres` (same pattern as services/social.ts) so a
 * missing pool surfaces as a loud thrown error at the route boundary.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import type { SocialScopeType } from '../types/social.js';
// NOTE: services/social.ts imports `isUserMuted` from this file. To avoid a
// circular module init we lazy-import `softDeleteEntity` inside the
// `reviewReport` body via `await import('./social.js')`.

// === Limits ==================================================================

/** Hard cap on the report `reason` text. Mirrors `MAX_REASON_LENGTH` in the
 *  route layer; we re-declare here so the service can be called outside HTTP. */
export const SOCIAL_REPORT_REASON_MAX_LENGTH = 500;

/** Hard cap on the mute `reason` text. */
export const SOCIAL_MUTE_REASON_MAX_LENGTH = 500;

/** Default page size for listReports. */
export const SOCIAL_REPORT_DEFAULT_LIMIT = 50;
export const SOCIAL_REPORT_MAX_LIMIT = 200;

// === Types ==================================================================

export type SocialReportStatus = 'pending' | 'dismissed' | 'actioned';

export interface SocialReport {
    id: string;
    entityId: string;
    reporterUserId: string;
    reason: string | null;
    status: SocialReportStatus;
    reviewerUserId: string | null;
    reviewedAt: string | null;
    createdAt: string;
}

export interface SocialMute {
    userId: string;
    scopeType: SocialScopeType;
    scopeId: string;
    mutedUntil: string | null;
    reason: string | null;
    moderatorUserId: string;
    createdAt: string;
}

// === Helpers ================================================================

async function requireModerationPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[SocialModeration] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

function toIso(value: Date | string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function normalizeReason(reason: unknown, maxLength: number): string | null {
    if (typeof reason !== 'string') return null;
    const trimmed = reason.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > maxLength) {
        throw new Error('reason too long');
    }
    return trimmed;
}

type ReportRow = {
    id: string;
    entity_id: string;
    reporter_user_id: string;
    reason: string | null;
    status: string;
    reviewer_user_id: string | null;
    reviewed_at: Date | string | null;
    created_at: Date | string;
};

function mapReportRow(row: ReportRow): SocialReport {
    return {
        id: row.id,
        entityId: row.entity_id,
        reporterUserId: row.reporter_user_id,
        reason: row.reason,
        status: row.status as SocialReportStatus,
        reviewerUserId: row.reviewer_user_id,
        reviewedAt: toIso(row.reviewed_at),
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    };
}

type MuteRow = {
    user_id: string;
    scope_type: string;
    scope_id: string;
    muted_until: Date | string | null;
    reason: string | null;
    moderator_user_id: string;
    created_at: Date | string;
};

function mapMuteRow(row: MuteRow): SocialMute {
    return {
        userId: row.user_id,
        scopeType: row.scope_type as SocialScopeType,
        scopeId: row.scope_id,
        mutedUntil: toIso(row.muted_until),
        reason: row.reason,
        moderatorUserId: row.moderator_user_id,
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    };
}

// === Reports ================================================================

/**
 * File a report against a social entity. Idempotency is intentionally NOT
 * enforced — a user can re-report the same entity to add more reasons, but
 * the route layer is the place to throttle if needed.
 *
 * Throws 'not found' when the entity does not exist (cascade FK would catch
 * the insert anyway but a clean 404 is friendlier than a 500).
 * Throws 'reason too long' when the reason exceeds the cap.
 */
export async function reportEntity(
    entityId: string,
    reporterUserId: string,
    reason?: string,
): Promise<{ id: string }> {
    const trimmedEntity = (entityId || '').trim();
    const trimmedReporter = (reporterUserId || '').trim();
    if (!trimmedEntity) throw new Error('entityId is required');
    if (!trimmedReporter) throw new Error('reporterUserId is required');
    const cleanReason = normalizeReason(reason, SOCIAL_REPORT_REASON_MAX_LENGTH);

    return requireModerationPostgres('reportEntity', async (client) => {
        // Confirm the entity exists (deleted_at is allowed — moderators may
        // still want to keep the report row alive against a soft-deleted post).
        const existing = await client.query<{ id: string }>(
            `select id::text as id from app_social_entity where id = $1::uuid`,
            [trimmedEntity],
        );
        if (existing.rowCount === 0) throw new Error('not found');

        const insert = await client.query<{ id: string }>(
            `
                insert into app_social_report
                    (entity_id, reporter_user_id, reason)
                values ($1::uuid, $2, $3)
                returning id::text as id
            `,
            [trimmedEntity, trimmedReporter, cleanReason],
        );
        return { id: insert.rows[0].id };
    });
}

export interface ListReportsOptions {
    status?: SocialReportStatus;
    limit?: number;
    offset?: number;
}

/**
 * List reports, newest-first. Defaults to all statuses if `status` is omitted.
 * The `(status, created_at desc)` index makes the common
 * "pending reports queue" page cheap.
 */
export async function listReports(opts: ListReportsOptions = {}): Promise<SocialReport[]> {
    const status = opts.status ?? null;
    const limitRaw = typeof opts.limit === 'number' && Number.isFinite(opts.limit) ? Math.floor(opts.limit) : SOCIAL_REPORT_DEFAULT_LIMIT;
    const limit = Math.max(1, Math.min(limitRaw, SOCIAL_REPORT_MAX_LIMIT));
    const offsetRaw = typeof opts.offset === 'number' && Number.isFinite(opts.offset) ? Math.floor(opts.offset) : 0;
    const offset = Math.max(0, offsetRaw);

    return requireModerationPostgres('listReports', async (client) => {
        const params: unknown[] = [];
        let where = '1=1';
        if (status) {
            params.push(status);
            where = `status = $${params.length}`;
        }
        params.push(limit);
        const limitIdx = params.length;
        params.push(offset);
        const offsetIdx = params.length;

        const rows = await client.query<ReportRow>(
            `
                select
                    id::text as id,
                    entity_id::text as entity_id,
                    reporter_user_id,
                    reason,
                    status,
                    reviewer_user_id,
                    reviewed_at,
                    created_at
                from app_social_report
                where ${where}
                order by created_at desc
                limit $${limitIdx} offset $${offsetIdx}
            `,
            params,
        );
        return rows.rows.map(mapReportRow);
    });
}

/**
 * Review a report — either dismiss it (leave the entity alone) or "remove"
 * (soft-delete the reported entity through the universal store, then mark
 * the report as actioned). Both paths bookkeep `reviewer_user_id` /
 * `reviewed_at`.
 *
 * `action='remove'` delegates the entity removal to `softDeleteEntity` with
 * `reason='moderation'` so the universal revision history shows a clean
 * moderation trail.
 *
 * Throws 'not found' when the report does not exist.
 * Throws 'already reviewed' when the report is already in a terminal state —
 * keeps the moderator-queue UI honest (no double-actions).
 */
export async function reviewReport(
    reportId: string,
    reviewerUserId: string,
    action: 'dismiss' | 'remove',
): Promise<void> {
    const trimmedId = (reportId || '').trim();
    const trimmedReviewer = (reviewerUserId || '').trim();
    if (!trimmedId) throw new Error('reportId is required');
    if (!trimmedReviewer) throw new Error('reviewerUserId is required');
    if (action !== 'dismiss' && action !== 'remove') {
        throw new Error('invalid action');
    }

    const target = await requireModerationPostgres('reviewReport.fetch', async (client) => {
        const rows = await client.query<{ id: string; entity_id: string; status: string }>(
            `select id::text as id, entity_id::text as entity_id, status
             from app_social_report where id = $1::uuid`,
            [trimmedId],
        );
        if (rows.rowCount === 0) throw new Error('not found');
        const row = rows.rows[0];
        if (row.status !== 'pending') throw new Error('already reviewed');
        return row;
    });

    if (action === 'remove') {
        // softDeleteEntity is idempotent for already-deleted rows and runs its
        // own pool acquire — we deliberately do NOT inline the DB call here
        // so the revision/history bookkeeping in services/social.ts stays the
        // single source of truth for entity deletion. softDeleteEntity uses
        // an actor-only check; the reviewer is the actor in this context, so
        // we pass them as `actorUserId`. The service will throw 'forbidden' if
        // the reviewer is not the original author. Phase 1c plan: move that
        // owner-only gate to be RBAC-aware so admins can remove without
        // impersonating. Until then a forbidden-reviewer hard-deletes the row
        // directly so the moderation queue is not blocked on author ownership.
        try {
            const social = await import('./social.js');
            await social.softDeleteEntity(target.entity_id, trimmedReviewer, 'moderation');
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message === 'forbidden') {
                // Fall back to a direct soft-delete bypassing the owner-only
                // gate. This is the moderation override — the reviewer
                // already passed `requireAdminAccess` at the route boundary.
                await requireModerationPostgres('reviewReport.forceDelete', async (client) => {
                    await client.query(
                        `
                            update app_social_entity
                            set deleted_at = now(),
                                deleted_by_user_id = $2,
                                deleted_reason = 'moderation',
                                updated_at = now()
                            where id = $1::uuid and deleted_at is null
                        `,
                        [target.entity_id, trimmedReviewer],
                    );
                    return null;
                });
            } else if (message !== 'not found') {
                throw error;
            }
        }
    }

    const finalStatus: SocialReportStatus = action === 'remove' ? 'actioned' : 'dismissed';
    await requireModerationPostgres('reviewReport.update', async (client) => {
        await client.query(
            `
                update app_social_report
                set status = $2,
                    reviewer_user_id = $3,
                    reviewed_at = now()
                where id = $1::uuid
            `,
            [trimmedId, finalStatus, trimmedReviewer],
        );
        return null;
    });
}

// === Mutes ==================================================================

export interface MuteUserOptions {
    reason?: string;
    /** Duration in ms from now; undefined / null / non-positive = permanent. */
    durationMs?: number;
}

/**
 * Mute a user in a specific scope. The composite primary key
 * `(user_id, scope_type, scope_id)` makes the operation upsert — calling
 * `muteUser` twice with different durations simply refreshes the existing row.
 *
 * Scope semantics:
 *   - `('global', 'global:chat')` — silences the user in the universal global
 *     chat. Matches the legacy global-chat mute behaviour 1:1.
 *   - `('group', 'group:ITS-21')` — silences the user in a specific group.
 *   - `('dm', 'dm:direct:a::b')` — silences the user in a specific DM room.
 *
 * `durationMs` of `undefined` / `null` / `<= 0` is treated as a permanent mute
 * (`muted_until = null`).
 */
export async function muteUser(
    userId: string,
    scopeType: SocialScopeType,
    scopeId: string,
    moderatorUserId: string,
    opts: MuteUserOptions = {},
): Promise<void> {
    const trimmedUser = (userId || '').trim();
    const trimmedScopeId = (scopeId || '').trim();
    const trimmedModerator = (moderatorUserId || '').trim();
    if (!trimmedUser) throw new Error('userId is required');
    if (!trimmedScopeId) throw new Error('scopeId is required');
    if (!trimmedModerator) throw new Error('moderatorUserId is required');
    const cleanReason = normalizeReason(opts.reason, SOCIAL_MUTE_REASON_MAX_LENGTH);

    const mutedUntilIso: string | null =
        typeof opts.durationMs === 'number' && Number.isFinite(opts.durationMs) && opts.durationMs > 0
            ? new Date(Date.now() + opts.durationMs).toISOString()
            : null;

    await requireModerationPostgres('muteUser', async (client) => {
        await client.query(
            `
                insert into app_social_mute
                    (user_id, scope_type, scope_id, muted_until, reason, moderator_user_id, created_at)
                values ($1, $2, $3, $4, $5, $6, now())
                on conflict (user_id, scope_type, scope_id) do update
                set muted_until = excluded.muted_until,
                    reason = excluded.reason,
                    moderator_user_id = excluded.moderator_user_id,
                    created_at = now()
            `,
            [trimmedUser, scopeType, trimmedScopeId, mutedUntilIso, cleanReason, trimmedModerator],
        );
        return null;
    });
}

/**
 * Remove a mute. Idempotent — calling on a missing row is a no-op.
 */
export async function unmuteUser(
    userId: string,
    scopeType: SocialScopeType,
    scopeId: string,
): Promise<void> {
    const trimmedUser = (userId || '').trim();
    const trimmedScopeId = (scopeId || '').trim();
    if (!trimmedUser) throw new Error('userId is required');
    if (!trimmedScopeId) throw new Error('scopeId is required');

    await requireModerationPostgres('unmuteUser', async (client) => {
        await client.query(
            `
                delete from app_social_mute
                where user_id = $1
                  and scope_type = $2
                  and scope_id = $3
            `,
            [trimmedUser, scopeType, trimmedScopeId],
        );
        return null;
    });
}

/**
 * Returns true if the user is currently muted in the given scope. Honors
 * `muted_until` so an expired-but-not-yet-cleaned-up row is treated as
 * unmuted. The (composite-PK) lookup is O(log n).
 */
export async function isUserMuted(
    userId: string,
    scopeType: SocialScopeType,
    scopeId: string,
): Promise<boolean> {
    const trimmedUser = (userId || '').trim();
    const trimmedScopeId = (scopeId || '').trim();
    if (!trimmedUser || !trimmedScopeId) return false;

    return requireModerationPostgres('isUserMuted', async (client) => {
        const rows = await client.query<{ muted_until: Date | string | null }>(
            `
                select muted_until
                from app_social_mute
                where user_id = $1
                  and scope_type = $2
                  and scope_id = $3
                limit 1
            `,
            [trimmedUser, scopeType, trimmedScopeId],
        );
        if (rows.rowCount === 0) return false;
        const mutedUntil = rows.rows[0].muted_until;
        if (!mutedUntil) return true;
        const expiry = mutedUntil instanceof Date ? mutedUntil.getTime() : new Date(mutedUntil).getTime();
        if (!Number.isFinite(expiry)) return true;
        return expiry > Date.now();
    });
}

/**
 * List every active mute for a user (across all scopes). Used by the
 * moderation UI to show "this user is muted in 3 places".
 */
export async function getActiveMutes(userId: string): Promise<SocialMute[]> {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser) return [];

    return requireModerationPostgres('getActiveMutes', async (client) => {
        const rows = await client.query<MuteRow>(
            `
                select
                    user_id,
                    scope_type,
                    scope_id,
                    muted_until,
                    reason,
                    moderator_user_id,
                    created_at
                from app_social_mute
                where user_id = $1
                  and (muted_until is null or muted_until > now())
                order by created_at desc
            `,
            [trimmedUser],
        );
        return rows.rows.map(mapMuteRow);
    });
}
