/**
 * Утилита записи логов действий в MongoDB
 * Используется для отслеживания действий пользователей в админ-панели
 */

import { withSupabasePostgres } from '../db/postgres.js';
import { getRequestContext } from './requestContext.js';

export const ACTION_LOG_COLLECTION = 'action_logs';

/**
 * Pure helper — escape admin-supplied text so it is safe to embed inside an
 * `ILIKE '%X%'` clause. Postgres `LIKE` treats `%`, `_` and `\` as special, so
 * an unescaped filter like `a_c` silently matches `abc` too. Values are still
 * bound as `$n` (this is match-broadening, not injection), but the filter
 * should mean what the admin typed. Mirrors `escapeSocialSearchLike` in
 * `services/social.ts`. Exported for unit testing.
 */
export function escapeActionLogLike(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function requireActionLogPostgres<T>(
    operation: string,
    handler: Parameters<typeof withSupabasePostgres<T>>[0]
): Promise<T> {
    const result = await withSupabasePostgres(handler);
    if (result === null) {
        throw new Error(`[ActionLog] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result;
}

export type ActionType =
    | 'login'
    | 'curator_login'
    | 'login_failed'
    | 'curator_login_failed'
    | 'login_rate_limited'
    | 'curator_login_rate_limited'
    | 'schedule_refresh'
    | 'schedule_ics_export'
    | 'exams_refresh'
    | 'platonus_login'
    | 'platonus_disconnect'
    | 'umkd_refresh'
    | 'profile_view'
    | 'admin_user_hydrate'
    | 'files_download_success'
    | 'files_download_failed'
    | 'files_upload_success'
    | 'files_upload_failed'
    | 'files_info_view'
    | 'app_rating_submit'
    | 'app_feedback_submit'
    | 'support_request_create'
    | 'support_request_submit'
    | 'support_request_cancel'
    | 'support_request_verify'
    | 'support_request_reject'
    | 'support_override_grant'
    | 'support_override_revoke'
    | 'support_override_clear'
    | 'referral_claim'
    | 'frontend_runtime_error'
    | 'group_role_assign'
    | 'group_role_revoke'
    | 'group_join_request_create'
    | 'group_join_request_approve'
    | 'group_join_request_reject'
    | 'group_membership_dispute_create'
    | 'group_membership_dispute_approve'
    | 'group_membership_dispute_reject'
    | 'group_membership_dispute_escalate'
    | 'group_member_remove'
    | 'group_user_phone_view'
    | 'group_coordinator_announcement_create'
    | 'group_coordinator_announcement_revoke'
    | 'group_post_create'
    | 'group_post_update'
    | 'group_post_restore'
    | 'group_post_restore_deleted'
    | 'group_post_delete'
    | 'group_post_delete_permanently'
    | 'group_task_create'
    | 'group_task_update'
    | 'group_task_restore'
    | 'group_task_restore_deleted'
    | 'group_task_toggle'
    | 'group_task_delete'
    | 'group_extra_lesson_create'
    | 'group_extra_lesson_update'
    | 'group_extra_lesson_restore'
    | 'group_extra_lesson_restore_deleted'
    | 'group_extra_lesson_delete'
    | 'group_link_create'
    | 'group_link_delete'
    | 'group_file_create'
    | 'group_file_delete'
    | 'group_space_update'
    | 'global_chat_message_create'
    | 'global_chat_message_report'
    | 'global_chat_message_delete'
    | 'global_chat_message_pin'
    | 'global_chat_message_unpin'
    | 'global_chat_report_review'
    | 'global_chat_user_mute'
    | 'global_chat_user_unmute'
    | 'global_feed_post_create'
    | 'global_feed_post_report'
    | 'global_feed_post_delete'
    | 'global_feed_post_pin'
    | 'global_feed_post_unpin'
    | 'global_feed_report_review'
    | 'board_announcement_create'
    | 'board_announcement_delete'
    | 'board_announcement_pin'
    | 'board_announcements_clear_all'
    | 'friend_request_create'
    | 'friend_request_accept'
    | 'friend_request_reject'
    | 'friend_request_cancel'
    | 'friend_remove'
    | 'chat_direct_message_create'
    | 'chat_group_message_create'
    | 'chat_message_edit'
    | 'chat_room_read'
    | 'curator_account_upsert'
    | 'session_revoked'
    | 'sessions_revoke_all'
    | 'teacher_directory_create';

export interface ActionLog {
    userId: string;
    action: ActionType;
    details?: string;
    reqId?: string | null;
    sessionId?: string | null;
    routeKind?: string | null;
    path?: string | null;
    source?: 'webapp' | 'direct' | 'unknown' | null;
    targetUserId?: string | null;
    groupKey?: string | null;
    entityId?: string | null;
    result?: 'success' | 'failed' | 'info' | 'restored' | 'deleted' | 'approved' | 'rejected' | null;
    metadata?: Record<string, unknown> | null;
    createdAt: Date;
}

interface LogActionOptions {
    targetUserId?: string | null;
    groupKey?: string | null;
    entityId?: string | null;
    result?: ActionLog['result'];
    metadata?: Record<string, unknown> | null;
}

/**
 * Записать действие пользователя в лог
 * Fire-and-forget: ошибки не должны ломать основную логику
 */
export function logAction(userId: string, action: ActionType, details?: string, options: LogActionOptions = {}): void {
    // Fire and forget — не блокируем основной запрос
    (async () => {
        try {
            const requestContext = getRequestContext();
            const entry: ActionLog = {
                userId,
                action,
                details,
                reqId: requestContext?.reqId ?? null,
                sessionId: requestContext?.sessionId ?? null,
                routeKind: requestContext?.routeKind ?? null,
                path: requestContext?.path ?? null,
                source: requestContext?.source ?? null,
                targetUserId: options.targetUserId ?? null,
                groupKey: options.groupKey ?? null,
                entityId: options.entityId ?? null,
                result: options.result ?? null,
                metadata: options.metadata ?? null,
                createdAt: new Date(),
            };

            await requireActionLogPostgres('logAction', async (client) => {
                await client.query(
                    `
                        insert into app_action_logs (
                            created_at, user_id, action, details, req_id, session_id, route_kind, path,
                            source, target_user_id, group_key, entity_id, result, metadata_json
                        )
                        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
                    `,
                    [
                        entry.createdAt,
                        entry.userId,
                        entry.action,
                        entry.details ?? null,
                        entry.reqId ?? null,
                        entry.sessionId ?? null,
                        entry.routeKind ?? null,
                        entry.path ?? null,
                        entry.source ?? null,
                        entry.targetUserId ?? null,
                        entry.groupKey ?? null,
                        entry.entityId ?? null,
                        entry.result ?? null,
                        JSON.stringify(entry.metadata),
                    ]
                );
                return true;
            });
        } catch (error) {
            console.error('[ActionLog] Failed to log action:', error);
        }
    })();
}

export function inferRouteKindForAction(action: ActionType): string | null {
    if (action.startsWith('group_')) return 'group';
    if (action.startsWith('global_chat_')) return 'chat';
    if (action.startsWith('global_feed_')) return 'chat';
    if (action.startsWith('friend_request_')) return 'chat';
    if (action === 'friend_remove') return 'chat';
    if (action.startsWith('chat_')) return 'chat';
    if (action.startsWith('files_')) return 'files';
    if (action.startsWith('platonus_')) return 'platonus';
    if (action.startsWith('support_')) return 'support';
    if (action.startsWith('referral_')) return 'referrals';
    if (action === 'schedule_refresh') return 'schedule';
    if (action === 'exams_refresh') return 'exams';
    if (action === 'umkd_refresh') return 'umkd';
    if (action === 'profile_view') return 'profile';
    if (action === 'admin_user_hydrate') return 'admin';
    if (action === 'teacher_directory_create') return 'teacher';
    if (
        action === 'login'
        || action === 'curator_login'
        || action === 'login_failed'
        || action === 'curator_login_failed'
        || action === 'login_rate_limited'
        || action === 'curator_login_rate_limited'
    ) return 'auth';
    return null;
}

export function inferStructuredFields(_action: ActionType, details?: string | null): Partial<ActionLog> {
    if (!details) return {};

    const targetUserMatch = details.match(/user(?:\s|=|:)+([a-zA-Z0-9._-]+)/i)
        || details.match(/for\s+([a-zA-Z0-9._-]+)\b/i);
    const groupKeyMatch = details.match(/group(?:Key)?(?:\s|=|:)+([^\s,;]+)/i);
    const entityMatch = details.match(/\b(post|task|lesson|file)\s+([a-zA-Z0-9_-]+)/i);

    let result: ActionLog['result'] = null;
    if (/approved|created|connected|successful|issued|fetched fresh|opened/i.test(details)) result = 'success';
    if (/failed|error|exception|not found|denied|rejected/i.test(details)) result = 'failed';
    if (/deleted|moved .* deleted/i.test(details)) result = 'deleted';
    if (/restored|restore/i.test(details)) result = 'restored';

    return {
        targetUserId: targetUserMatch?.[1] || null,
        groupKey: groupKeyMatch?.[1] || null,
        entityId: entityMatch?.[2] || null,
        result,
    };
}

export async function backfillActionLogs(limit = 1000): Promise<{ scanned: number; updated: number }> {
    const docs = await requireActionLogPostgres('backfillActionLogs:loadDocs', async (client) => {
        const result = await client.query<{
            id: string;
            created_at: Date;
            user_id: string;
            action: ActionType;
            details: string | null;
            req_id: string | null;
            session_id: string | null;
            route_kind: string | null;
            path: string | null;
            source: ActionLog['source'];
            target_user_id: string | null;
            group_key: string | null;
            entity_id: string | null;
            result: ActionLog['result'];
            metadata_json: Record<string, unknown> | null;
        }>(
            `
                select id::text as id, created_at, user_id, action, details, req_id, session_id, route_kind, path,
                       source, target_user_id, group_key, entity_id, result, metadata_json
                from app_action_logs
                order by created_at desc
                limit $1
            `,
            [limit]
        );
        return result.rows;
    });
    let updated = 0;

    for (const doc of docs) {
        const patch: Partial<ActionLog> = {};
        const inferred = inferStructuredFields(doc.action, doc.details || null);
        if (!doc.route_kind) patch.routeKind = inferRouteKindForAction(doc.action);
        if (!doc.target_user_id && inferred.targetUserId) patch.targetUserId = inferred.targetUserId;
        if (!doc.group_key && inferred.groupKey) patch.groupKey = inferred.groupKey;
        if (!doc.entity_id && inferred.entityId) patch.entityId = inferred.entityId;
        if (!doc.result && inferred.result) patch.result = inferred.result;

        if (!doc.req_id || !doc.session_id || !doc.path) {
            const nearestAudit = await requireActionLogPostgres('backfillActionLogs:nearestAudit', async (client) => {
                const result = await client.query<{
                    req_id: string | null;
                    session_id: string | null;
                    route_kind: string | null;
                    path: string | null;
                    source: ActionLog['source'];
                }>(
                    `
                        select req_id, session_id, route_kind, path, source
                        from app_request_audit
                        where user_id = $1
                          and created_at >= $2
                          and created_at <= $3
                        order by created_at desc
                        limit 1
                    `,
                    [doc.user_id, new Date(doc.created_at.getTime() - 15_000), new Date(doc.created_at.getTime() + 15_000)]
                );
                return result.rows[0] ?? null;
            });

            if (nearestAudit) {
                if (!doc.req_id && nearestAudit.req_id) patch.reqId = nearestAudit.req_id;
                if (!doc.session_id && nearestAudit.session_id) patch.sessionId = nearestAudit.session_id;
                if (!doc.route_kind && nearestAudit.route_kind) patch.routeKind = nearestAudit.route_kind;
                if (!doc.path && nearestAudit.path) patch.path = nearestAudit.path;
                if (!doc.source && nearestAudit.source) patch.source = nearestAudit.source;
            }
        }

        if (Object.keys(patch).length > 0) {
            await requireActionLogPostgres('backfillActionLogs:update', async (client) => {
                await client.query(
                    `
                        update app_action_logs
                        set req_id = coalesce($2, req_id),
                            session_id = coalesce($3, session_id),
                            route_kind = coalesce($4, route_kind),
                            path = coalesce($5, path),
                            source = coalesce($6, source),
                            target_user_id = coalesce($7, target_user_id),
                            group_key = coalesce($8, group_key),
                            entity_id = coalesce($9, entity_id),
                            result = coalesce($10, result)
                        where id = $1
                    `,
                    [
                        Number.parseInt(doc.id, 10),
                        patch.reqId ?? null,
                        patch.sessionId ?? null,
                        patch.routeKind ?? null,
                        patch.path ?? null,
                        patch.source ?? null,
                        patch.targetUserId ?? null,
                        patch.groupKey ?? null,
                        patch.entityId ?? null,
                        patch.result ?? null,
                    ]
                );
                return true;
            });
            updated += 1;
        }
    }

    return {
        scanned: docs.length,
        updated,
    };
}

/**
 * Получить последние действия для админки
 */
export async function getActionLogs(options: {
    limit?: number;
    offset?: number;
    action?: ActionType;
    userId?: string;
} = {}): Promise<{ logs: ActionLog[]; hasMore: boolean }> {
    return requireActionLogPostgres('getActionLogs', async (client) => {
        const { limit = 50, offset = 0, action, userId } = options;
        const safeLimit = Math.min(Math.max(limit, 1), 200);
        const safeOffset = Math.max(offset, 0);
        const conditions: string[] = [];
        const values: unknown[] = [];
        const push = (value: unknown) => {
            values.push(value);
            return `$${values.length}`;
        };
        if (action) conditions.push(`action = ${push(action)}`);
        if (userId) conditions.push(`user_id ilike ${push(`%${escapeActionLogLike(userId)}%`)}`);
        const whereClause = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
        const limitPlaceholder = push(safeLimit + 1);
        const offsetPlaceholder = push(safeOffset);
        const result = await client.query<{
            created_at: Date;
            user_id: string;
            action: ActionType;
            details: string | null;
            req_id: string | null;
            session_id: string | null;
            route_kind: string | null;
            path: string | null;
            source: ActionLog['source'];
            target_user_id: string | null;
            group_key: string | null;
            entity_id: string | null;
            result: ActionLog['result'];
            metadata_json: Record<string, unknown> | null;
        }>(
            `
                select created_at, user_id, action, details, req_id, session_id, route_kind, path,
                       source, target_user_id, group_key, entity_id, result, metadata_json
                from app_action_logs
                ${whereClause}
                order by created_at desc
                limit ${limitPlaceholder}
                offset ${offsetPlaceholder}
            `,
            values
        );

        return {
            logs: result.rows.slice(0, safeLimit).map((row) => ({
                userId: row.user_id,
                action: row.action,
                details: row.details ?? undefined,
                reqId: row.req_id,
                sessionId: row.session_id,
                routeKind: row.route_kind,
                path: row.path,
                source: row.source,
                targetUserId: row.target_user_id,
                groupKey: row.group_key,
                entityId: row.entity_id,
                result: row.result,
                metadata: row.metadata_json,
                createdAt: new Date(row.created_at),
            })),
            hasMore: result.rows.length > safeLimit,
        };
    });
}
