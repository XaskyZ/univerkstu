import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import {
    shimMirrorCreateGlobalChatMessage,
    shimMirrorSoftDeleteGlobalChatMessage,
} from './global-chat-shim.js';
import type {
    GlobalChatMessageView,
    GlobalChatMuteView,
    GlobalChatReportStatus,
    GlobalChatReportView,
    GlobalChatViewerState,
} from '../types/global-chat.js';

const DEFAULT_MESSAGE_LIMIT = 120;
const MAX_MESSAGE_LIMIT = 200;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_REPORT_REASON_LENGTH = 160;
const MAX_REPORT_DETAILS_LENGTH = 1000;
const MAX_MUTE_REASON_LENGTH = 200;

type PgGlobalChatMessageRow = {
    id: string;
    author_user_id: string;
    body: string;
    created_at: Date;
    pinned_at: Date | null;
    deleted_at: Date | null;
    author_label: string | null;
    report_count: string | number | null;
    is_reported_by_viewer: boolean | null;
};

type PgGlobalChatMuteRow = {
    id: string;
    user_id: string;
    muted_by: string;
    reason: string | null;
    created_at: Date;
    expires_at: Date | null;
    revoked_at: Date | null;
    revoked_by: string | null;
};

type PgGlobalChatReportRow = {
    id: string;
    message_id: string;
    message_body: string;
    message_created_at: Date;
    message_author_user_id: string;
    message_author_label: string | null;
    reporter_user_id: string;
    reporter_label: string | null;
    reason: string;
    details: string | null;
    status: GlobalChatReportStatus;
    created_at: Date;
    reviewed_at: Date | null;
    reviewed_by: string | null;
    resolution_note: string | null;
    message_deleted_at: Date | null;
};

class GlobalChatError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode = 400, code = 'GLOBAL_CHAT_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

async function requireGlobalChatPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Global Chat] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

export function normalizeMultiLineText(value: string): string {
    return value
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.replace(/\s+$/g, ''))
        .join('\n')
        .trim();
}

export function normalizeSingleLineText(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

export function clampMessageLimit(limit?: number): number {
    if (!Number.isFinite(limit)) return DEFAULT_MESSAGE_LIMIT;
    return Math.max(1, Math.min(Math.trunc(limit as number), MAX_MESSAGE_LIMIT));
}

export function clampMuteDurationMinutes(durationMinutes?: number | null): number | null {
    if (durationMinutes === null || durationMinutes === undefined) return null;
    if (!Number.isFinite(durationMinutes)) return null;
    const safeValue = Math.trunc(durationMinutes);
    if (safeValue <= 0) return null;
    return Math.min(safeValue, 60 * 24 * 30);
}

function mapPgGlobalChatMute(row: PgGlobalChatMuteRow): GlobalChatMuteView {
    const nowMs = Date.now();
    const expiresAtMs = row.expires_at ? new Date(row.expires_at).getTime() : null;
    const revokedAtMs = row.revoked_at ? new Date(row.revoked_at).getTime() : null;
    const isActive = !revokedAtMs && (!expiresAtMs || expiresAtMs > nowMs);

    return {
        id: row.id,
        userId: row.user_id,
        mutedBy: row.muted_by,
        reason: row.reason,
        createdAt: new Date(row.created_at),
        expiresAt: row.expires_at ? new Date(row.expires_at) : null,
        revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
        revokedBy: row.revoked_by,
        isActive,
    };
}

function mapPgGlobalChatMessage(
    row: PgGlobalChatMessageRow,
    viewerUserId: string,
    canModerate: boolean
): GlobalChatMessageView {
    return {
        id: row.id,
        authorUserId: row.author_user_id,
        authorLabel: row.author_label?.trim() || row.author_user_id,
        body: row.body,
        createdAt: new Date(row.created_at),
        isPinned: Boolean(row.pinned_at),
        pinnedAt: row.pinned_at ? new Date(row.pinned_at) : null,
        isOwn: row.author_user_id === viewerUserId,
        canDelete: canModerate,
        isReportedByViewer: Boolean(row.is_reported_by_viewer),
        reportCount: Number(row.report_count || 0),
    };
}

function mapPgGlobalChatReport(row: PgGlobalChatReportRow): GlobalChatReportView {
    return {
        id: row.id,
        messageId: row.message_id,
        messageBody: row.message_body,
        messageCreatedAt: new Date(row.message_created_at),
        messageAuthorUserId: row.message_author_user_id,
        messageAuthorLabel: row.message_author_label?.trim() || row.message_author_user_id,
        reporterUserId: row.reporter_user_id,
        reporterLabel: row.reporter_label?.trim() || row.reporter_user_id,
        reason: row.reason,
        details: row.details,
        status: row.status,
        createdAt: new Date(row.created_at),
        reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
        reviewedBy: row.reviewed_by,
        resolutionNote: row.resolution_note,
        messageDeletedAt: row.message_deleted_at ? new Date(row.message_deleted_at) : null,
    };
}

async function findActiveGlobalChatMuteRecord(
    client: PoolClient,
    userId: string
): Promise<PgGlobalChatMuteRow | null> {
    const result = await client.query<PgGlobalChatMuteRow>(
        `
            select id, user_id, muted_by, reason, created_at, expires_at, revoked_at, revoked_by
            from app_global_chat_mutes
            where user_id = $1
              and revoked_at is null
              and (expires_at is null or expires_at > now())
            order by created_at desc
            limit 1
        `,
        [userId]
    );

    return result.rows[0] || null;
}

async function findGlobalChatMessageRecordById(
    client: PoolClient,
    viewerUserId: string,
    messageId: string
): Promise<PgGlobalChatMessageRow | null> {
    const result = await client.query<PgGlobalChatMessageRow>(
        `
            select
                m.id,
                m.author_user_id,
                m.body,
                m.created_at,
                m.pinned_at,
                m.deleted_at,
                coalesce(
                    nullif(u.settings_json->>'leaderboardDisplayName', ''),
                    nullif(s.snapshot_json->>'fullName', ''),
                    nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                    m.author_user_id
                ) as author_label,
                count(r.id) filter (where r.status = 'open')::int as report_count,
                bool_or(r.reporter_user_id = $1) filter (where r.reporter_user_id is not null) as is_reported_by_viewer
            from app_global_chat_messages m
            left join app_users u on u.user_id = m.author_user_id
            left join app_admin_user_snapshots s on s.user_id = m.author_user_id
            left join app_global_chat_reports r on r.message_id = m.id
            where m.id = $2
            group by m.id, m.author_user_id, m.body, m.created_at, m.pinned_at, m.deleted_at, u.settings_json, s.snapshot_json
            limit 1
        `,
        [viewerUserId, messageId]
    );

    return result.rows[0] || null;
}

async function resolveGlobalChatMessageView(
    client: PoolClient,
    viewerUserId: string,
    messageId: string,
    canModerate: boolean
): Promise<GlobalChatMessageView | null> {
    const row = await findGlobalChatMessageRecordById(client, viewerUserId, messageId);
    if (!row) return null;
    return mapPgGlobalChatMessage(row, viewerUserId, canModerate);
}

export function getGlobalChatMessageMaxLength(): number {
    return MAX_MESSAGE_LENGTH;
}

export async function getGlobalChatViewerState(
    viewerUserId: string,
    canModerate: boolean
): Promise<GlobalChatViewerState> {
    return requireGlobalChatPostgres('getGlobalChatViewerState', async (client) => {
        const activeMute = await findActiveGlobalChatMuteRecord(client, viewerUserId);
        return {
            canModerate,
            isMuted: Boolean(activeMute),
            mute: activeMute ? mapPgGlobalChatMute(activeMute) : null,
        };
    });
}

export async function listGlobalChatMessages(
    viewerUserId: string,
    options: { limit?: number; canModerate?: boolean } = {}
): Promise<GlobalChatMessageView[]> {
    const effectiveLimit = clampMessageLimit(options.limit);
    const canModerate = Boolean(options.canModerate);
    return requireGlobalChatPostgres('listGlobalChatMessages', async (client) => {
        const pinnedRowsResult = await client.query<PgGlobalChatMessageRow>(
            `
                select
                    m.id,
                    m.author_user_id,
                    m.body,
                    m.created_at,
                    m.pinned_at,
                    m.deleted_at,
                    coalesce(
                        nullif(u.settings_json->>'leaderboardDisplayName', ''),
                        nullif(s.snapshot_json->>'fullName', ''),
                        nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                        m.author_user_id
                    ) as author_label,
                    count(r.id) filter (where r.status = 'open')::int as report_count,
                    bool_or(r.reporter_user_id = $1) filter (where r.reporter_user_id is not null) as is_reported_by_viewer
                from app_global_chat_messages m
                left join app_users u on u.user_id = m.author_user_id
                left join app_admin_user_snapshots s on s.user_id = m.author_user_id
                left join app_global_chat_reports r on r.message_id = m.id
                where m.deleted_at is null
                  and m.pinned_at is not null
                group by m.id, m.author_user_id, m.body, m.created_at, m.pinned_at, m.deleted_at, u.settings_json, s.snapshot_json
                order by m.pinned_at asc, m.created_at asc
            `,
            [viewerUserId]
        );

        const unpinnedLimit = Math.max(0, effectiveLimit - pinnedRowsResult.rows.length);
        const unpinnedRowsResult = await client.query<PgGlobalChatMessageRow>(
            `
                select
                    m.id,
                    m.author_user_id,
                    m.body,
                    m.created_at,
                    m.pinned_at,
                    m.deleted_at,
                    coalesce(
                        nullif(u.settings_json->>'leaderboardDisplayName', ''),
                        nullif(s.snapshot_json->>'fullName', ''),
                        nullif(s.snapshot_json#>>'{profileSummary,fullName}', ''),
                        m.author_user_id
                    ) as author_label,
                    count(r.id) filter (where r.status = 'open')::int as report_count,
                    bool_or(r.reporter_user_id = $1) filter (where r.reporter_user_id is not null) as is_reported_by_viewer
                from app_global_chat_messages m
                left join app_users u on u.user_id = m.author_user_id
                left join app_admin_user_snapshots s on s.user_id = m.author_user_id
                left join app_global_chat_reports r on r.message_id = m.id
                where m.deleted_at is null
                  and m.pinned_at is null
                group by m.id, m.author_user_id, m.body, m.created_at, m.pinned_at, m.deleted_at, u.settings_json, s.snapshot_json
                order by m.created_at desc
                limit $2
            `,
            [viewerUserId, unpinnedLimit]
        );

        return [...pinnedRowsResult.rows, ...unpinnedRowsResult.rows.reverse()]
            .map((row) => mapPgGlobalChatMessage(row, viewerUserId, canModerate));
    });
}

export async function createGlobalChatMessage(params: {
    authorUserId: string;
    body: string;
    canModerate?: boolean;
}): Promise<GlobalChatMessageView> {
    const normalizedBody = normalizeMultiLineText(params.body);
    if (!normalizedBody) {
        throw new GlobalChatError('Message body is required', 400, 'MESSAGE_BODY_REQUIRED');
    }
    if (normalizedBody.length > MAX_MESSAGE_LENGTH) {
        throw new GlobalChatError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`, 400, 'MESSAGE_TOO_LONG');
    }

    return requireGlobalChatPostgres('createGlobalChatMessage', async (client) => {
        const activeMute = await findActiveGlobalChatMuteRecord(client, params.authorUserId);
        if (activeMute) {
            const mute = mapPgGlobalChatMute(activeMute);
            const expirySuffix = mute.expiresAt ? ` until ${mute.expiresAt.toISOString()}` : '';
            throw new GlobalChatError(`You are muted${expirySuffix}`, 403, 'CHAT_MUTED');
        }

        const now = new Date();
        const id = randomUUID();
        const result = await client.query<{ id: string }>(
            `
                insert into app_global_chat_messages (
                    id, author_user_id, body, created_at
                )
                values ($1, $2, $3, $4)
                returning id
            `,
            [id, params.authorUserId, normalizedBody, now]
        );

        const createdId = result.rows[0]?.id;
        if (!createdId) {
            throw new Error('Failed to create global chat message');
        }

        const resolved = await resolveGlobalChatMessageView(client, params.authorUserId, createdId, Boolean(params.canModerate));
        if (!resolved) {
            throw new Error('Failed to resolve created global chat message');
        }

        // Phase 1c dual-write: mirror into app_social_entity (kind='global_message').
        // Non-fatal — the legacy insert above already succeeded. The mirror is
        // scoped under the fixed `global:chat` namespace since the global chat
        // is a single channel. Delete shim is wired in deleteGlobalChatMessage
        // below; pin is not shimmed today because the legacy pin route was
        // removed in the /chat rewrite.
        await shimMirrorCreateGlobalChatMessage({
            legacyId: createdId,
            authorUserId: params.authorUserId,
            body: normalizedBody,
        });

        return resolved;
    });
}

export async function reportGlobalChatMessage(params: {
    messageId: string;
    reporterUserId: string;
    reason: string;
    details?: string | null;
}): Promise<GlobalChatReportView> {
    const normalizedReason = normalizeSingleLineText(params.reason);
    const normalizedDetails = params.details ? normalizeMultiLineText(params.details) : '';

    if (!normalizedReason) {
        throw new GlobalChatError('Report reason is required', 400, 'REPORT_REASON_REQUIRED');
    }
    if (normalizedReason.length > MAX_REPORT_REASON_LENGTH) {
        throw new GlobalChatError(`Report reason is too long (max ${MAX_REPORT_REASON_LENGTH} characters)`, 400, 'REPORT_REASON_TOO_LONG');
    }
    if (normalizedDetails.length > MAX_REPORT_DETAILS_LENGTH) {
        throw new GlobalChatError(`Report details are too long (max ${MAX_REPORT_DETAILS_LENGTH} characters)`, 400, 'REPORT_DETAILS_TOO_LONG');
    }

    return requireGlobalChatPostgres('reportGlobalChatMessage', async (client) => {
        const messageRow = await findGlobalChatMessageRecordById(client, params.reporterUserId, params.messageId);
        if (!messageRow || messageRow.deleted_at) {
            throw new GlobalChatError('Message not found', 404, 'MESSAGE_NOT_FOUND');
        }
        if (messageRow.author_user_id === params.reporterUserId) {
            throw new GlobalChatError('You cannot report your own message', 400, 'REPORT_OWN_MESSAGE');
        }

        const id = randomUUID();
        const now = new Date();
        try {
            await client.query(
                `
                    insert into app_global_chat_reports (
                        id, message_id, reporter_user_id, reason, details, status, created_at
                    )
                    values ($1, $2, $3, $4, $5, 'open', $6)
                `,
                [id, params.messageId, params.reporterUserId, normalizedReason, normalizedDetails || null, now]
            );
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
                throw new GlobalChatError('You have already reported this message', 409, 'REPORT_ALREADY_EXISTS');
            }
            throw error;
        }

        const reports = await listGlobalChatReports({ status: 'open', limit: 500 });
        const created = reports.find((report) => report.id === id);
        if (!created) {
            throw new Error('Failed to resolve created report');
        }
        return created;
    });
}

export async function listGlobalChatReports(options: {
    status?: GlobalChatReportStatus | 'all';
    limit?: number;
} = {}): Promise<GlobalChatReportView[]> {
    const status = options.status || 'open';
    const effectiveLimit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 500));

    return requireGlobalChatPostgres('listGlobalChatReports', async (client) => {
        const result = await client.query<PgGlobalChatReportRow>(
            `
                select
                    r.id,
                    r.message_id,
                    m.body as message_body,
                    m.created_at as message_created_at,
                    m.author_user_id as message_author_user_id,
                    coalesce(
                        nullif(message_user.settings_json->>'leaderboardDisplayName', ''),
                        nullif(message_snapshot.snapshot_json->>'fullName', ''),
                        nullif(message_snapshot.snapshot_json#>>'{profileSummary,fullName}', ''),
                        m.author_user_id
                    ) as message_author_label,
                    r.reporter_user_id,
                    coalesce(
                        nullif(reporter_user.settings_json->>'leaderboardDisplayName', ''),
                        nullif(reporter_snapshot.snapshot_json->>'fullName', ''),
                        nullif(reporter_snapshot.snapshot_json#>>'{profileSummary,fullName}', ''),
                        r.reporter_user_id
                    ) as reporter_label,
                    r.reason,
                    r.details,
                    r.status,
                    r.created_at,
                    r.reviewed_at,
                    r.reviewed_by,
                    r.resolution_note,
                    m.deleted_at as message_deleted_at
                from app_global_chat_reports r
                join app_global_chat_messages m on m.id = r.message_id
                left join app_users message_user on message_user.user_id = m.author_user_id
                left join app_admin_user_snapshots message_snapshot on message_snapshot.user_id = m.author_user_id
                left join app_users reporter_user on reporter_user.user_id = r.reporter_user_id
                left join app_admin_user_snapshots reporter_snapshot on reporter_snapshot.user_id = r.reporter_user_id
                where ($1 = 'all' or r.status = $1)
                order by
                    case when r.status = 'open' then 0 else 1 end,
                    r.created_at desc
                limit $2
            `,
            [status, effectiveLimit]
        );

        return result.rows.map(mapPgGlobalChatReport);
    });
}

export async function reviewGlobalChatReport(params: {
    reportId: string;
    reviewedBy: string;
    status: Exclude<GlobalChatReportStatus, 'open'>;
    resolutionNote?: string | null;
}): Promise<GlobalChatReportView | null> {
    const resolutionNote = params.resolutionNote ? normalizeMultiLineText(params.resolutionNote).slice(0, MAX_REPORT_DETAILS_LENGTH) : null;
    return requireGlobalChatPostgres('reviewGlobalChatReport', async (client) => {
        const result = await client.query(
            `
                update app_global_chat_reports
                set status = $2,
                    reviewed_at = $3,
                    reviewed_by = $4,
                    resolution_note = $5
                where id = $1
            `,
            [params.reportId, params.status, new Date(), params.reviewedBy, resolutionNote]
        );

        if (!result.rowCount) {
            throw new GlobalChatError('Report not found', 404, 'REPORT_NOT_FOUND');
        }

        const reports = await listGlobalChatReports({ status: 'all', limit: 500 });
        return reports.find((report) => report.id === params.reportId) || null;
    });
}

export async function deleteGlobalChatMessage(params: {
    messageId: string;
    deletedBy: string;
    reason?: string | null;
}): Promise<{ messageId: string; resolvedReports: number }> {
    const deleteReason = params.reason ? normalizeMultiLineText(params.reason).slice(0, MAX_REPORT_DETAILS_LENGTH) : null;

    const { result, authorUserId } = await requireGlobalChatPostgres('deleteGlobalChatMessage', async (client) => {
        const now = new Date();
        // Capture the message author so the dual-write mirror can pass it to
        // the social-store's owner-only soft-delete. The legacy delete is
        // admin-only at the route layer, but the mirror entity is owned by the
        // original author. Returning the author from the UPDATE keeps this in
        // a single round-trip.
        const updateMessageResult = await client.query<{ author_user_id: string }>(
            `
                update app_global_chat_messages
                set deleted_at = coalesce(deleted_at, $2),
                    deleted_by = coalesce(deleted_by, $3),
                    delete_reason = coalesce(delete_reason, $4)
                where id = $1
                returning author_user_id
            `,
            [params.messageId, now, params.deletedBy, deleteReason]
        );

        if (!updateMessageResult.rowCount) {
            throw new GlobalChatError('Message not found', 404, 'MESSAGE_NOT_FOUND');
        }

        const resolvedReports = await client.query(
            `
                update app_global_chat_reports
                set status = 'actioned',
                    reviewed_at = coalesce(reviewed_at, $2),
                    reviewed_by = coalesce(reviewed_by, $3),
                    resolution_note = coalesce(resolution_note, $4)
                where message_id = $1 and status = 'open'
            `,
            [params.messageId, now, params.deletedBy, deleteReason || 'Message deleted by admin']
        );

        return {
            result: {
                messageId: params.messageId,
                resolvedReports: resolvedReports.rowCount || 0,
            },
            authorUserId: updateMessageResult.rows[0]?.author_user_id ?? null,
        };
    });

    // Phase 1c dual-write: mirror the legacy delete as a soft-delete on the
    // social entity. Owner-only check inside the social service is satisfied
    // by passing the original author as the actor; skipped if the row had no
    // recorded author (defensive, should not happen with the NOT NULL column).
    if (authorUserId) {
        await shimMirrorSoftDeleteGlobalChatMessage({
            legacyId: params.messageId,
            actorUserId: authorUserId,
        });
    }

    return result;
}

export async function muteGlobalChatUser(params: {
    userId: string;
    mutedBy: string;
    reason?: string | null;
    durationMinutes?: number | null;
}): Promise<GlobalChatMuteView> {
    const reason = params.reason ? normalizeMultiLineText(params.reason).slice(0, MAX_MUTE_REASON_LENGTH) : null;
    const durationMinutes = clampMuteDurationMinutes(params.durationMinutes);

    return requireGlobalChatPostgres('muteGlobalChatUser', async (client) => {
        const now = new Date();
        await client.query(
            `
                update app_global_chat_mutes
                set revoked_at = $2,
                    revoked_by = $3
                where user_id = $1
                  and revoked_at is null
                  and (expires_at is null or expires_at > $2)
            `,
            [params.userId, now, params.mutedBy]
        );

        const id = randomUUID();
        const expiresAt = durationMinutes ? new Date(now.getTime() + durationMinutes * 60_000) : null;
        const result = await client.query<PgGlobalChatMuteRow>(
            `
                insert into app_global_chat_mutes (
                    id, user_id, muted_by, reason, created_at, expires_at
                )
                values ($1, $2, $3, $4, $5, $6)
                returning id, user_id, muted_by, reason, created_at, expires_at, revoked_at, revoked_by
            `,
            [id, params.userId, params.mutedBy, reason, now, expiresAt]
        );

        const created = result.rows[0];
        if (!created) {
            throw new Error('Failed to create mute');
        }

        return mapPgGlobalChatMute(created);
    });
}

export async function unmuteGlobalChatUser(params: {
    userId: string;
    revokedBy: string;
}): Promise<GlobalChatMuteView | null> {
    return requireGlobalChatPostgres('unmuteGlobalChatUser', async (client) => {
        const activeMute = await findActiveGlobalChatMuteRecord(client, params.userId);
        if (!activeMute) return null;

        const now = new Date();
        await client.query(
            `
                update app_global_chat_mutes
                set revoked_at = $2,
                    revoked_by = $3
                where id = $1
            `,
            [activeMute.id, now, params.revokedBy]
        );

        return {
            ...mapPgGlobalChatMute(activeMute),
            revokedAt: now,
            revokedBy: params.revokedBy,
            isActive: false,
        };
    });
}

// Note: setGlobalChatMessagePinned was removed in the /chat rewrite. The
// `pinned_at` / `pinned_by` columns remain in the schema so existing pins
// continue to render via listGlobalChatMessages, and the endpoint can be
// brought back later without a migration.
