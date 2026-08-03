import 'dotenv/config';
import { connectDB, getDB, closeDB } from '../db/mongo.js';
import { withSupabasePostgres } from '../db/postgres.js';
import type { Document } from 'mongodb';

type Scope = 'core' | 'logs' | 'analytics' | 'all';

function getScope(): Scope {
    const value = (process.env.MIGRATE_SCOPE || 'all').toLowerCase();
    if (value === 'core' || value === 'logs' || value === 'analytics' || value === 'all') return value;
    return 'all';
}

async function ensureSupabaseReachable() {
    const ok = await withSupabasePostgres(async (client) => {
        await client.query('select 1');
        return true;
    });
    if (!ok) {
        throw new Error('Supabase Postgres is not reachable from this environment. Check SUPABASE_POOLER_URL / SUPABASE_DATABASE_URL.');
    }
}

async function chunkedMongo<T>(
    collectionName: string,
    onChunk: (rows: T[]) => Promise<void>,
    batchSize = 500
): Promise<number> {
    const cursor = getDB().collection<Document>(collectionName).find({}).batchSize(batchSize);
    let chunk: T[] = [];
    let total = 0;

    for await (const doc of cursor) {
        chunk.push(doc as unknown as T);
        if (chunk.length >= batchSize) {
            await onChunk(chunk);
            total += chunk.length;
            chunk = [];
            console.log(`[Mongo -> Supabase] ${collectionName}: ${total} migrated`);
        }
    }

    if (chunk.length > 0) {
        await onChunk(chunk);
        total += chunk.length;
        console.log(`[Mongo -> Supabase] ${collectionName}: ${total} migrated`);
    }

    return total;
}

async function queryChunk(sql: string, values: unknown[]) {
    const result = await withSupabasePostgres((client) => client.query(sql, values));
    if (result === null) {
        throw new Error('Supabase Postgres is not reachable during chunk write.');
    }
}

async function migrateUsers() {
    return chunkedMongo<any>('users', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 5;
            values.push(
                row.userId,
                row.passwordEncrypted,
                row.createdAt,
                row.lastLogin,
                JSON.stringify(row.settings || { language: 'ru', notifications: true, theme: 'system' }),
            );
            return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::timestamptz, $${base + 4}::timestamptz, $${base + 5}::jsonb)`;
        });

        await queryChunk(
            `
                insert into app_users (user_id, password_encrypted, created_at, last_login, settings_json)
                values ${tuples.join(', ')}
                on conflict (user_id)
                do update set
                    password_encrypted = excluded.password_encrypted,
                    created_at = excluded.created_at,
                    last_login = excluded.last_login,
                    settings_json = excluded.settings_json
            `,
            values
        );
    }, 250);
}

async function migratePlatonusSessions() {
    return chunkedMongo<any>('platonus_sessions', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 9;
            values.push(
                row.userId,
                row.platonusLogin,
                row.passwordEncrypted,
                row.token,
                row.sid,
                row.cookieString || null,
                row.personId,
                row.createdAt,
                row.expiresAt,
            );
            return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text, $${base + 5}::text, $${base + 6}::text, $${base + 7}::text, $${base + 8}::timestamptz, $${base + 9}::timestamptz)`;
        });

        await queryChunk(
            `
                insert into app_platonus_sessions (
                    user_id, platonus_login, password_encrypted, token, sid, cookie_string, person_id, created_at, expires_at
                )
                values ${tuples.join(', ')}
                on conflict (user_id)
                do update set
                    platonus_login = excluded.platonus_login,
                    password_encrypted = excluded.password_encrypted,
                    token = excluded.token,
                    sid = excluded.sid,
                    cookie_string = excluded.cookie_string,
                    person_id = excluded.person_id,
                    created_at = excluded.created_at,
                    expires_at = excluded.expires_at
            `,
            values
        );
    }, 250);
}

async function migrateGenericCache() {
    return chunkedMongo<any>('generic_cache', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 4;
            values.push(row.key, JSON.stringify(row.data), row.createdAt, row.expiresAt);
            return `($${base + 1}::text, $${base + 2}::jsonb, $${base + 3}::timestamptz, $${base + 4}::timestamptz)`;
        });

        await queryChunk(
            `
                insert into app_generic_cache (cache_key, data_json, created_at, expires_at)
                values ${tuples.join(', ')}
                on conflict (cache_key)
                do update set
                    data_json = excluded.data_json,
                    created_at = excluded.created_at,
                    expires_at = excluded.expires_at
            `,
            values
        );
    }, 250);
}

async function migrateScheduleCache() {
    return chunkedMongo<any>('schedules', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 4;
            values.push(row.userId, JSON.stringify(row), row.cachedAt, row.expiresAt);
            return `($${base + 1}::text, $${base + 2}::jsonb, $${base + 3}::timestamptz, $${base + 4}::timestamptz)`;
        });

        await queryChunk(
            `
                insert into app_schedule_cache (user_id, data_json, cached_at, expires_at)
                values ${tuples.join(', ')}
                on conflict (user_id)
                do update set
                    data_json = excluded.data_json,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `,
            values
        );
    }, 200);
}

async function migrateExamsCache() {
    return chunkedMongo<any>('exams', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 4;
            values.push(row.userId, JSON.stringify(row), row.cachedAt, row.expiresAt);
            return `($${base + 1}::text, $${base + 2}::jsonb, $${base + 3}::timestamptz, $${base + 4}::timestamptz)`;
        });

        await queryChunk(
            `
                insert into app_exams_cache (user_id, data_json, cached_at, expires_at)
                values ${tuples.join(', ')}
                on conflict (user_id)
                do update set
                    data_json = excluded.data_json,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `,
            values
        );
    }, 200);
}

async function migratePlatonusGradesCache() {
    return chunkedMongo<any>('platonus_grades_cache', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 6;
            values.push(row.userId, row.year, row.semester, JSON.stringify(row.data), row.cachedAt, row.expiresAt);
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, $${base + 5}, $${base + 6})`;
        });

        await queryChunk(
            `
                insert into app_platonus_grades_cache (user_id, year, semester, data_json, cached_at, expires_at)
                values ${tuples.join(', ')}
                on conflict (user_id, year, semester)
                do update set
                    data_json = excluded.data_json,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `,
            values
        );
    }, 200);
}

async function migrateFeedback() {
    return chunkedMongo<any>('app_feedback', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 11;
            values.push(
                row.kind,
                row.userId,
                row.rating ?? null,
                row.category ?? null,
                row.message ?? null,
                row.page ?? null,
                row.lastPath ?? null,
                row.appVersion ?? null,
                row.status ?? null,
                row.createdAt,
                row.updatedAt,
            );
            return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::integer, $${base + 4}::text, $${base + 5}::text, $${base + 6}::text, $${base + 7}::text, $${base + 8}::text, $${base + 9}::text, $${base + 10}::timestamptz, $${base + 11}::timestamptz)`;
        });

        await queryChunk(
            `
                insert into app_feedback (
                    kind, user_id, rating, category, message, page, last_path, app_version, status, created_at, updated_at
                )
                values ${tuples.join(', ')}
                on conflict (user_id) where kind = 'rating'
                do update set
                    rating = excluded.rating,
                    category = excluded.category,
                    message = excluded.message,
                    page = excluded.page,
                    last_path = excluded.last_path,
                    app_version = excluded.app_version,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
            `,
            values
        );
    }, 200);
}

async function migrateRequestAudit() {
    return chunkedMongo<any>('request_audit', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 20;
            values.push(
                row.createdAt,
                row.reqId,
                row.routeKind,
                row.method,
                row.url,
                row.path,
                row.statusCode,
                Math.round(row.durationMs ?? 0),
                row.ip ?? null,
                row.userId ?? null,
                row.sessionId ?? null,
                row.source ?? null,
                row.host ?? null,
                row.userAgent ?? null,
                row.referer ?? null,
                row.origin ?? null,
                row.contentLength ?? null,
                row.responseBytes ?? null,
                row.errorCode ?? null,
                row.errorMessage ?? null,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15}, $${base + 16}, $${base + 17}, $${base + 18}, $${base + 19}, $${base + 20})`;
        });

        await queryChunk(
            `
                insert into app_request_audit (
                    created_at, req_id, route_kind, method, url, path, status_code, duration_ms,
                    ip, user_id, session_id, source, host, user_agent, referer, origin,
                    content_length, response_bytes, error_code, error_message
                )
                values ${tuples.join(', ')}
            `,
            values
        );
    }, 1000);
}

async function migrateAnalyticsEvents() {
    return chunkedMongo<any>('analytics_events', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 13;
            values.push(
                row.createdAt ?? row.eventAt ?? new Date(),
                row.eventAt ?? row.createdAt ?? new Date(),
                row.eventType,
                row.sessionId,
                row.clientId,
                row.userId ?? null,
                row.path ?? null,
                row.referrer ?? null,
                JSON.stringify(row.utm ?? null),
                JSON.stringify(row.device ?? null),
                JSON.stringify(row.metrics ?? null),
                JSON.stringify(row.meta ?? null),
                row.ipHash ?? null,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}::jsonb, $${base + 10}::jsonb, $${base + 11}::jsonb, $${base + 12}::jsonb, $${base + 13})`;
        });

        await queryChunk(
            `
                insert into app_analytics_events (
                    created_at, event_at, event_type, session_id, client_id, user_id, path, referrer,
                    utm_json, device_json, metrics_json, meta_json, ip_hash
                )
                values ${tuples.join(', ')}
            `,
            values
        );
    }, 1000);
}

async function migrateActionLogs() {
    return chunkedMongo<any>('action_logs', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 14;
            values.push(
                row.createdAt,
                row.userId,
                row.action,
                row.details ?? null,
                row.reqId ?? null,
                row.sessionId ?? null,
                row.routeKind ?? null,
                row.path ?? null,
                row.source ?? null,
                row.targetUserId ?? null,
                row.groupKey ?? null,
                row.entityId ?? null,
                row.result ?? null,
                JSON.stringify(row.metadata ?? null),
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}::jsonb)`;
        });

        await queryChunk(
            `
                insert into app_action_logs (
                    created_at, user_id, action, details, req_id, session_id, route_kind, path,
                    source, target_user_id, group_key, entity_id, result, metadata_json
                )
                values ${tuples.join(', ')}
            `,
            values
        );
    }, 1000);
}

async function migrateRuntimeTraces() {
    return chunkedMongo<any>('runtime_traces', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 12;
            values.push(
                row.createdAt,
                row.source,
                row.scope,
                row.event,
                row.level,
                row.message,
                row.userId ?? null,
                row.sessionId ?? null,
                row.reqId ?? null,
                row.routeKind ?? null,
                row.path ?? null,
                JSON.stringify(row.metadata ?? null),
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}::jsonb)`;
        });

        await queryChunk(
            `
                insert into app_runtime_traces (
                    created_at, source, scope, event, level, message,
                    user_id, session_id, req_id, route_kind, path, metadata_json
                )
                values ${tuples.join(', ')}
            `,
            values
        );
    }, 1000);
}

async function migrateGroupSpaces() {
    return chunkedMongo<any>('group_spaces', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 6;
            values.push(
                String(row._id),
                row.groupKey,
                row.title,
                row.slug,
                row.createdAt ?? row.updatedAt ?? new Date(),
                row.updatedAt ?? row.createdAt ?? new Date(),
            );
            return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text, $${base + 5}::timestamptz, $${base + 6}::timestamptz)`;
        });

        await queryChunk(
            `
                insert into app_group_spaces (id, group_key, title, slug, created_at, updated_at)
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    group_key = excluded.group_key,
                    title = excluded.title,
                    slug = excluded.slug,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
            `,
            values
        );
    }, 250);
}

async function migrateGroupMemberships() {
    return chunkedMongo<any>('group_memberships', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 12;
            values.push(
                String(row._id),
                row.userId,
                row.groupKey,
                row.source,
                Boolean(row.active),
                row.createdAt ?? new Date(),
                row.updatedAt ?? row.createdAt ?? new Date(),
                row.createdBy ?? 'migration',
                row.reason ?? null,
                row.removedAt ?? null,
                row.removedBy ?? null,
                row.removalReason ?? null,
            );
            return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::text, $${base + 4}::text, $${base + 5}::boolean, $${base + 6}::timestamptz, $${base + 7}::timestamptz, $${base + 8}::text, $${base + 9}::text, $${base + 10}::timestamptz, $${base + 11}::text, $${base + 12}::text)`;
        });

        await queryChunk(
            `
                insert into app_group_memberships (
                    id, user_id, group_key, source, active, created_at, updated_at, created_by, reason, removed_at, removed_by, removal_reason
                )
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    user_id = excluded.user_id,
                    group_key = excluded.group_key,
                    source = excluded.source,
                    active = excluded.active,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    created_by = excluded.created_by,
                    reason = excluded.reason,
                    removed_at = excluded.removed_at,
                    removed_by = excluded.removed_by,
                    removal_reason = excluded.removal_reason
            `,
            values
        );
    }, 250);
}

async function migrateGroupRoleAssignments() {
    return chunkedMongo<any>('group_role_assignments', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 10;
            values.push(
                String(row._id),
                row.userId,
                row.roleId,
                row.scopeType,
                row.scopeId,
                Boolean(row.active),
                row.assignedBy ?? 'migration',
                row.createdAt ?? new Date(),
                row.updatedAt ?? row.createdAt ?? new Date(),
                row.reason ?? null,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        });

        await queryChunk(
            `
                insert into app_group_role_assignments (
                    id, user_id, role_id, scope_type, scope_id, active, assigned_by, created_at, updated_at, reason
                )
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    user_id = excluded.user_id,
                    role_id = excluded.role_id,
                    scope_type = excluded.scope_type,
                    scope_id = excluded.scope_id,
                    active = excluded.active,
                    assigned_by = excluded.assigned_by,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    reason = excluded.reason
            `,
            values
        );
    }, 250);
}

async function migrateGroupJoinRequests() {
    return chunkedMongo<any>('group_join_requests', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 11;
            values.push(
                String(row._id),
                row.userId,
                row.groupKey,
                row.status,
                row.createdAt ?? new Date(),
                row.updatedAt ?? row.createdAt ?? new Date(),
                row.reason ?? null,
                row.detectedGroupKey ?? null,
                row.reviewedAt ?? null,
                row.reviewedBy ?? null,
                row.reviewNote ?? null,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`;
        });

        await queryChunk(
            `
                insert into app_group_join_requests (
                    id, user_id, group_key, status, created_at, updated_at, reason, detected_group_key, reviewed_at, reviewed_by, review_note
                )
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    user_id = excluded.user_id,
                    group_key = excluded.group_key,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    reason = excluded.reason,
                    detected_group_key = excluded.detected_group_key,
                    reviewed_at = excluded.reviewed_at,
                    reviewed_by = excluded.reviewed_by,
                    review_note = excluded.review_note
            `,
            values
        );
    }, 250);
}

async function migrateGroupMembershipDisputes() {
    return chunkedMongo<any>('group_membership_disputes', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 13;
            values.push(
                String(row._id),
                row.userId,
                row.groupKey,
                row.issueType,
                row.status,
                row.reason,
                row.detectedGroupKey ?? null,
                row.activeGroupKey ?? null,
                row.createdAt ?? new Date(),
                row.updatedAt ?? row.createdAt ?? new Date(),
                row.reviewedAt ?? null,
                row.reviewedBy ?? null,
                row.reviewNote ?? null,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13})`;
        });

        await queryChunk(
            `
                insert into app_group_membership_disputes (
                    id, user_id, group_key, issue_type, status, reason, detected_group_key, active_group_key,
                    created_at, updated_at, reviewed_at, reviewed_by, review_note
                )
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    user_id = excluded.user_id,
                    group_key = excluded.group_key,
                    issue_type = excluded.issue_type,
                    status = excluded.status,
                    reason = excluded.reason,
                    detected_group_key = excluded.detected_group_key,
                    active_group_key = excluded.active_group_key,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    reviewed_at = excluded.reviewed_at,
                    reviewed_by = excluded.reviewed_by,
                    review_note = excluded.review_note
            `,
            values
        );
    }, 250);
}

async function migrateGroupPosts() {
    return chunkedMongo<any>('group_posts', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 10;
            values.push(
                String(row._id),
                row.groupKey,
                row.title,
                row.body,
                row.authorUserId,
                Boolean(row.pinned),
                row.createdAt ?? new Date(),
                row.updatedAt ?? row.createdAt ?? new Date(),
                row.deletedAt ?? null,
                row.deletedBy ?? null,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        });

        await queryChunk(
            `
                insert into app_group_posts (
                    id, group_key, title, body, author_user_id, pinned, created_at, updated_at, deleted_at, deleted_by
                )
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    group_key = excluded.group_key,
                    title = excluded.title,
                    body = excluded.body,
                    author_user_id = excluded.author_user_id,
                    pinned = excluded.pinned,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    deleted_by = excluded.deleted_by
            `,
            values
        );
    }, 250);
}

async function migrateGroupTasks() {
    return chunkedMongo<any>('group_tasks', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 15;
            values.push(
                String(row._id),
                row.groupKey,
                row.title,
                row.subject ?? null,
                row.description ?? null,
                row.deadline ?? null,
                row.priority,
                row.authorUserId,
                Boolean(row.completed),
                row.completedAt ?? null,
                row.completedBy ?? null,
                row.createdAt ?? new Date(),
                row.updatedAt ?? row.createdAt ?? new Date(),
                row.deletedAt ?? null,
                row.deletedBy ?? null,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14}, $${base + 15})`;
        });

        await queryChunk(
            `
                insert into app_group_tasks (
                    id, group_key, title, subject, description, deadline, priority, author_user_id,
                    completed, completed_at, completed_by, created_at, updated_at, deleted_at, deleted_by
                )
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    group_key = excluded.group_key,
                    title = excluded.title,
                    subject = excluded.subject,
                    description = excluded.description,
                    deadline = excluded.deadline,
                    priority = excluded.priority,
                    author_user_id = excluded.author_user_id,
                    completed = excluded.completed,
                    completed_at = excluded.completed_at,
                    completed_by = excluded.completed_by,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    deleted_by = excluded.deleted_by
            `,
            values
        );
    }, 250);
}

async function migrateGroupExtraLessons() {
    return chunkedMongo<any>('group_extra_lessons', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 14;
            values.push(
                String(row._id),
                row.groupKey,
                row.title,
                row.date,
                row.startTime,
                row.endTime,
                row.room ?? null,
                row.teacher ?? null,
                row.note ?? null,
                row.authorUserId,
                row.createdAt ?? new Date(),
                row.updatedAt ?? row.createdAt ?? new Date(),
                row.deletedAt ?? null,
                row.deletedBy ?? null,
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12}, $${base + 13}, $${base + 14})`;
        });

        await queryChunk(
            `
                insert into app_group_extra_lessons (
                    id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id,
                    created_at, updated_at, deleted_at, deleted_by
                )
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    group_key = excluded.group_key,
                    title = excluded.title,
                    date = excluded.date,
                    start_time = excluded.start_time,
                    end_time = excluded.end_time,
                    room = excluded.room,
                    teacher = excluded.teacher,
                    note = excluded.note,
                    author_user_id = excluded.author_user_id,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    deleted_at = excluded.deleted_at,
                    deleted_by = excluded.deleted_by
            `,
            values
        );
    }, 250);
}

async function migrateGroupContentRevisions() {
    return chunkedMongo<any>('group_content_revisions', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 7;
            values.push(
                String(row._id),
                row.groupKey,
                row.contentType,
                row.entityId,
                row.editedBy,
                row.editedAt ?? new Date(),
                JSON.stringify(row.snapshot ?? {}),
            );
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::jsonb)`;
        });

        await queryChunk(
            `
                insert into app_group_content_revisions (
                    id, group_key, content_type, entity_id, edited_by, edited_at, snapshot_json
                )
                values ${tuples.join(', ')}
                on conflict (id)
                do update set
                    group_key = excluded.group_key,
                    content_type = excluded.content_type,
                    entity_id = excluded.entity_id,
                    edited_by = excluded.edited_by,
                    edited_at = excluded.edited_at,
                    snapshot_json = excluded.snapshot_json
            `,
            values
        );
    }, 250);
}

async function migrateAdminUserSnapshots() {
    return chunkedMongo<any>('admin_user_snapshots', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 3;
            values.push(
                row.userId,
                JSON.stringify(row),
                row.updatedAt ?? new Date(),
            );
            return `($${base + 1}::text, $${base + 2}::jsonb, $${base + 3}::timestamptz)`;
        });

        await queryChunk(
            `
                insert into app_admin_user_snapshots (user_id, snapshot_json, updated_at)
                values ${tuples.join(', ')}
                on conflict (user_id)
                do update set
                    snapshot_json = excluded.snapshot_json,
                    updated_at = excluded.updated_at
            `,
            values
        );
    }, 250);
}

async function migrateAdminHydrationState() {
    return chunkedMongo<any>('admin_hydration_state', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 11;
            values.push(
                String(row._id),
                Boolean(row.running),
                row.leaseUntil ?? null,
                row.lastStartedAt ?? null,
                row.lastFinishedAt ?? null,
                row.lastScanCount ?? 0,
                row.lastCandidateCount ?? 0,
                JSON.stringify(row.lastCandidates ?? []),
                JSON.stringify(row.lastHydrated ?? []),
                JSON.stringify(row.lastFailed ?? []),
                row.trigger ?? null,
            );
            return `($${base + 1}::text, $${base + 2}::boolean, $${base + 3}::timestamptz, $${base + 4}::timestamptz, $${base + 5}::timestamptz, $${base + 6}::integer, $${base + 7}::integer, $${base + 8}::jsonb, $${base + 9}::jsonb, $${base + 10}::jsonb, $${base + 11}::text)`;
        });

        await queryChunk(
            `
                insert into app_admin_hydration_state (
                    id, running, lease_until, last_started_at, last_finished_at,
                    last_scan_count, last_candidate_count, last_candidates_json, last_hydrated_json, last_failed_json, trigger, updated_at
                )
                values ${tuples.map((tuple, _index) => `${tuple.replace(/\)$/, `, now())`)}`).join(', ')}
                on conflict (id)
                do update set
                    running = excluded.running,
                    lease_until = excluded.lease_until,
                    last_started_at = excluded.last_started_at,
                    last_finished_at = excluded.last_finished_at,
                    last_scan_count = excluded.last_scan_count,
                    last_candidate_count = excluded.last_candidate_count,
                    last_candidates_json = excluded.last_candidates_json,
                    last_hydrated_json = excluded.last_hydrated_json,
                    last_failed_json = excluded.last_failed_json,
                    trigger = excluded.trigger,
                    updated_at = excluded.updated_at
            `,
            values
        );
    }, 50);
}

async function migrateUmkdFiles() {
    return chunkedMongo<any>('umkd_files.files', async (rows) => {
        const values: unknown[] = [];
        const tuples = rows.map((row, index) => {
            const base = index * 6;
            values.push(
                String(row._id),
                row.filename,
                row.length ?? null,
                row.chunkSize ?? null,
                row.uploadDate ?? row.metadata?.uploadedAt ?? new Date(),
                JSON.stringify(row.metadata ?? {}),
            );
            return `($${base + 1}::text, $${base + 2}::text, $${base + 3}::bigint, $${base + 4}::integer, $${base + 5}::timestamptz, $${base + 6}::jsonb)`;
        });

        await queryChunk(
            `
                insert into app_umkd_files (
                    file_id, filename, length_bytes, chunk_size, upload_date, metadata_json
                )
                values ${tuples.join(', ')}
                on conflict (file_id)
                do update set
                    filename = excluded.filename,
                    length_bytes = excluded.length_bytes,
                    chunk_size = excluded.chunk_size,
                    upload_date = excluded.upload_date,
                    metadata_json = excluded.metadata_json
            `,
            values
        );
    }, 250);
}

async function main() {
    const scope = getScope();
    await connectDB();
    await ensureSupabaseReachable();

    const results: Record<string, number> = {};

    if (scope === 'core' || scope === 'all') {
        results.users = await migrateUsers();
        results.platonusSessions = await migratePlatonusSessions();
        results.genericCache = await migrateGenericCache();
        results.schedules = await migrateScheduleCache();
        results.exams = await migrateExamsCache();
        results.platonusGradesCache = await migratePlatonusGradesCache();
        results.feedback = await migrateFeedback();
        results.umkdFiles = await migrateUmkdFiles();
        results.groupSpaces = await migrateGroupSpaces();
        results.groupMemberships = await migrateGroupMemberships();
        results.groupRoleAssignments = await migrateGroupRoleAssignments();
        results.groupJoinRequests = await migrateGroupJoinRequests();
        results.groupMembershipDisputes = await migrateGroupMembershipDisputes();
        results.groupPosts = await migrateGroupPosts();
        results.groupTasks = await migrateGroupTasks();
        results.groupExtraLessons = await migrateGroupExtraLessons();
        results.groupContentRevisions = await migrateGroupContentRevisions();
        results.adminUserSnapshots = await migrateAdminUserSnapshots();
        results.adminHydrationState = await migrateAdminHydrationState();
    }

    if (scope === 'analytics' || scope === 'all') {
        results.analyticsEvents = await migrateAnalyticsEvents();
    }

    if (scope === 'logs' || scope === 'all') {
        results.requestAudit = await migrateRequestAudit();
        results.actionLogs = await migrateActionLogs();
        results.runtimeTraces = await migrateRuntimeTraces();
    }

    console.log('[Mongo -> Supabase] Migration complete:', results);
    await closeDB();
}

main().catch(async (error) => {
    console.error('[Mongo -> Supabase] Migration failed:', error);
    await closeDB().catch(() => {});
    process.exitCode = 1;
});
