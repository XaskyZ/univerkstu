import { MongoClient, type Db, MongoServerError } from 'mongodb';
import { ACTION_LOG_COLLECTION } from '../utils/actionLog.js';
import { REQUEST_AUDIT_COLLECTION } from '../utils/requestAudit.js';
import { RUNTIME_TRACE_COLLECTION } from '../utils/runtimeTrace.js';
import { withSupabasePostgres } from './postgres.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDB(): Promise<Db> {
    if (db) return db;

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        throw new Error('MONGODB_URI is not defined');
    }

    client = new MongoClient(uri);
    await client.connect();
    db = client.db('univer_schedule_v3');

    try {
        await ensureIndexes(db);
    } catch (error) {
        if (isAtlasQuotaExceededError(error)) {
            console.warn('[MongoDB] Atlas space quota exceeded. Starting without index sync.');
        } else {
            throw error;
        }
    }

    return db;
}

export function isAtlasQuotaExceededError(error: unknown): boolean {
    if (!(error instanceof MongoServerError)) return false;
    const message = typeof error.message === 'string' ? error.message.toLowerCase() : '';
    return error.code === 8000 && message.includes('space quota');
}

/**
 * Ensure creating necessary indexes
 */
async function ensureIndexes(db: Db) {
    // 1. Users - userId (unique)
    await db.collection(Collections.USERS).createIndex({ userId: 1 }, { unique: true });

    // 2. Generic Cache - key (unique), expiresAt (TTL)
    const cacheCollection = db.collection(Collections.GENERIC_CACHE);
    await cacheCollection.createIndex({ key: 1 }, { unique: true });
    await cacheCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // 3. GridFS Files - Metadata indexes for search
    // Note: GridFS automatically indexes _id and filename, but we query by metadata
    const filesCollection = db.collection('umkd_files.files');
    await filesCollection.createIndex({ 'metadata.uploadedBy': 1 }); // For deleting user files
    await filesCollection.createIndex({ 'metadata.courseId': 1 });   // For course file lists
    await filesCollection.createIndex({ 'metadata.contentHash': 1 }); // For deduplication

    // 4. Platonus grades cache (user + academic period), TTL
    const platonusGradesCollection = db.collection('platonus_grades_cache');
    await platonusGradesCollection.createIndex({ userId: 1, year: 1, semester: 1 }, { unique: true });
    await platonusGradesCollection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

    // 5. Analytics events - query/aggregation and TTL
    const analyticsCollection = db.collection(Collections.ANALYTICS_EVENTS);
    const analyticsTtlDays = Number.parseInt(process.env.ANALYTICS_TTL_DAYS || '90', 10);
    const ttlSeconds = (Number.isFinite(analyticsTtlDays) && analyticsTtlDays > 0 ? analyticsTtlDays : 90) * 24 * 60 * 60;
    await analyticsCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: ttlSeconds });
    await analyticsCollection.createIndex({ eventType: 1, createdAt: -1 });
    await analyticsCollection.createIndex({ sessionId: 1, createdAt: -1 });
    await analyticsCollection.createIndex({ userId: 1, createdAt: -1 });
    await analyticsCollection.createIndex({ userId: 1, eventType: 1, createdAt: -1 });
    await analyticsCollection.createIndex({ path: 1, createdAt: -1 });
    await analyticsCollection.createIndex({ 'utm.source': 1, createdAt: -1 });

    // 6. Action Logs - query by action type, userId, and TTL (90 days)
    const actionLogsCollection = db.collection(ACTION_LOG_COLLECTION);
    await actionLogsCollection.createIndex({ createdAt: -1 });
    await actionLogsCollection.createIndex({ action: 1, createdAt: -1 });
    await actionLogsCollection.createIndex({ userId: 1, createdAt: -1 });
    await actionLogsCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

    // 6.5 App feedback / ratings
    const feedbackCollection = db.collection(Collections.APP_FEEDBACK);
    await feedbackCollection.createIndex({ kind: 1, userId: 1 });
    await feedbackCollection.createIndex({ createdAt: -1 });
    await feedbackCollection.createIndex({ updatedAt: -1 });
    await feedbackCollection.createIndex(
        { kind: 1, userId: 1 },
        {
            name: 'app_feedback_rating_unique',
            unique: true,
            partialFilterExpression: { kind: 'rating' },
        }
    );

    // 7. HTTP Request Audit logs - query and TTL
    const requestAuditCollection = db.collection(REQUEST_AUDIT_COLLECTION);
    const auditTtlDays = Number.parseInt(process.env.REQUEST_AUDIT_TTL_DAYS || '30', 10);
    const auditTtlSec = (Number.isFinite(auditTtlDays) && auditTtlDays > 0 ? auditTtlDays : 30) * 24 * 60 * 60;
    await requestAuditCollection.createIndex({ createdAt: -1 });
    await requestAuditCollection.createIndex({ method: 1, createdAt: -1 });
    await requestAuditCollection.createIndex({ statusCode: 1, createdAt: -1 });
    await requestAuditCollection.createIndex({ userId: 1, createdAt: -1 });
    await requestAuditCollection.createIndex({ reqId: 1, createdAt: -1 });
    await requestAuditCollection.createIndex({ sessionId: 1, createdAt: -1 });
    await requestAuditCollection.createIndex({ routeKind: 1, createdAt: -1 });
    await requestAuditCollection.createIndex({ source: 1, createdAt: -1 });
    await requestAuditCollection.createIndex({ path: 1, createdAt: -1 });
    await requestAuditCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: auditTtlSec });

    // 7.25 Runtime traces - unified debug timeline and TTL
    const runtimeTraceCollection = db.collection(RUNTIME_TRACE_COLLECTION);
    const runtimeTraceTtlDays = Number.parseInt(process.env.RUNTIME_TRACE_TTL_DAYS || '14', 10);
    const runtimeTraceTtlSec = (Number.isFinite(runtimeTraceTtlDays) && runtimeTraceTtlDays > 0 ? runtimeTraceTtlDays : 14) * 24 * 60 * 60;
    await runtimeTraceCollection.createIndex({ createdAt: -1 });
    await runtimeTraceCollection.createIndex({ source: 1, createdAt: -1 });
    await runtimeTraceCollection.createIndex({ scope: 1, createdAt: -1 });
    await runtimeTraceCollection.createIndex({ userId: 1, createdAt: -1 });
    await runtimeTraceCollection.createIndex({ level: 1, createdAt: -1 });
    await runtimeTraceCollection.createIndex({ createdAt: 1 }, { expireAfterSeconds: runtimeTraceTtlSec });

    // 7.5 Admin user snapshots - sticky last known admin view
    const adminUserSnapshotsCollection = db.collection('admin_user_snapshots');
    await adminUserSnapshotsCollection.createIndex({ userId: 1 }, { unique: true });
    await adminUserSnapshotsCollection.createIndex({ updatedAt: -1 });

    // 7.6 Admin hydration runner state
    const adminHydrationStateCollection = db.collection('admin_hydration_state');
    await adminHydrationStateCollection.createIndex({ updatedAt: -1 });

    // 8. Group Space foundation indexes
    const groupSpacesCollection = db.collection('group_spaces');
    await groupSpacesCollection.createIndex({ groupKey: 1 }, { unique: true });
    await groupSpacesCollection.createIndex({ slug: 1 }, { unique: true });

    const groupMembershipsCollection = db.collection('group_memberships');
    await groupMembershipsCollection.createIndex({ userId: 1, groupKey: 1 }, { unique: true });
    await groupMembershipsCollection.createIndex({ groupKey: 1, active: 1, createdAt: -1 });
    await groupMembershipsCollection.createIndex({ userId: 1, active: 1, createdAt: -1 });

    const groupRoleAssignmentsCollection = db.collection('group_role_assignments');
    await groupRoleAssignmentsCollection.createIndex(
        { userId: 1, roleId: 1, scopeType: 1, scopeId: 1 },
        { unique: true }
    );
    await groupRoleAssignmentsCollection.createIndex({ scopeType: 1, scopeId: 1, active: 1, createdAt: -1 });
    await groupRoleAssignmentsCollection.createIndex({ userId: 1, active: 1, createdAt: -1 });

    const groupJoinRequestsCollection = db.collection('group_join_requests');
    await groupJoinRequestsCollection.createIndex({ groupKey: 1, status: 1, createdAt: -1 });
    await groupJoinRequestsCollection.createIndex({ userId: 1, status: 1, createdAt: -1 });

    const groupMembershipDisputesCollection = db.collection('group_membership_disputes');
    await groupMembershipDisputesCollection.createIndex({ groupKey: 1, status: 1, createdAt: -1 });
    await groupMembershipDisputesCollection.createIndex({ userId: 1, status: 1, createdAt: -1 });
    await groupMembershipDisputesCollection.createIndex({ userId: 1, groupKey: 1, issueType: 1, status: 1 });

    const groupPostsCollection = db.collection('group_posts');
    await groupPostsCollection.createIndex({ groupKey: 1, deletedAt: 1, pinned: -1, createdAt: -1 });
    await groupPostsCollection.createIndex({ authorUserId: 1, deletedAt: 1, createdAt: -1 });

    const groupTasksCollection = db.collection('group_tasks');
    await groupTasksCollection.createIndex({ groupKey: 1, deletedAt: 1, completed: 1, deadline: 1, createdAt: -1 });
    await groupTasksCollection.createIndex({ authorUserId: 1, deletedAt: 1, createdAt: -1 });

    const groupExtraLessonsCollection = db.collection('group_extra_lessons');
    await groupExtraLessonsCollection.createIndex({ groupKey: 1, deletedAt: 1, date: 1, startTime: 1, createdAt: -1 });
    await groupExtraLessonsCollection.createIndex({ authorUserId: 1, deletedAt: 1, createdAt: -1 });

    const groupContentRevisionsCollection = db.collection('group_content_revisions');
    await groupContentRevisionsCollection.createIndex({ groupKey: 1, contentType: 1, entityId: 1, editedAt: -1 });
    await groupContentRevisionsCollection.createIndex({ contentType: 1, entityId: 1, editedAt: -1 });

    console.log('[MongoDB] Indexes ensured');
}

export function getDB(): Db {
    if (!db) {
        throw new Error('Database not connected. Call connectDB() first.');
    }
    return db;
}

export async function closeDB(): Promise<void> {
    if (client) {
        await client.close();
        client = null;
        db = null;
    }
}

// Collections
export const Collections = {
    USERS: 'users',
    SCHEDULE_CACHE: 'schedule_cache',
    EXAMS_CACHE: 'exams_cache',
    UMKD_CACHE: 'umkd_cache',
    PROFILE_CACHE: 'profile_cache',
    GENERIC_CACHE: 'generic_cache',
    ANALYTICS_EVENTS: 'analytics_events',
    APP_FEEDBACK: 'app_feedback',
    ADMIN_USER_SNAPSHOTS: 'admin_user_snapshots',
    ADMIN_HYDRATION_STATE: 'admin_hydration_state',
} as const;

// Generic cache interface
export interface CacheEntry<T> {
    key: string;
    data: T;
    expiresAt: Date;
    createdAt: Date;
}

async function requireGenericCachePostgres<T>(
    operation: string,
    handler: Parameters<typeof withSupabasePostgres<T>>[0]
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Generic Cache] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

/**
 * Get cached data by key
 */
export async function getCachedData<T>(key: string): Promise<T | null> {
    return requireGenericCachePostgres(`getCachedData(${key})`, async (client) => {
        const result = await client.query<{ data_json: T }>(
            `
                select data_json
                from app_generic_cache
                where cache_key = $1 and expires_at > now()
                limit 1
            `,
            [key]
        );
        return result.rows[0]?.data_json ?? null;
    });
}

/**
 * Get cache entry by key regardless of freshness
 */
export async function getCacheEntry<T>(key: string): Promise<CacheEntry<T> | null> {
    return requireGenericCachePostgres(`getCacheEntry(${key})`, async (client) => {
        const result = await client.query<{
            cache_key: string;
            data_json: T;
            created_at: Date;
            expires_at: Date;
        }>(
            `
                select cache_key, data_json, created_at, expires_at
                from app_generic_cache
                where cache_key = $1
                limit 1
            `,
            [key]
        );

        const row = result.rows[0];
        if (!row) return null;
        return {
            key: row.cache_key,
            data: row.data_json,
            createdAt: new Date(row.created_at),
            expiresAt: new Date(row.expires_at),
        } satisfies CacheEntry<T>;
    });
}

/**
 * Set cached data with TTL
 */
export async function setCachedData<T>(
    key: string,
    data: T,
    ttlMs: number
): Promise<void> {
    await requireGenericCachePostgres(`setCachedData(${key})`, async (client) => {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ttlMs);
        await client.query(
            `
                insert into app_generic_cache (cache_key, data_json, created_at, expires_at)
                values ($1, $2::jsonb, $3, $4)
                on conflict (cache_key)
                do update set
                    data_json = excluded.data_json,
                    created_at = excluded.created_at,
                    expires_at = excluded.expires_at
            `,
            [key, JSON.stringify(data), now, expiresAt]
        );
        return true;
    });
}

/**
 * Delete cached data by key
 */
export async function deleteCachedData(key: string): Promise<void> {
    await requireGenericCachePostgres(`deleteCachedData(${key})`, async (client) => {
        await client.query(`delete from app_generic_cache where cache_key = $1`, [key]);
        return true;
    });
}

/**
 * Clear expired cache entries
 */
export async function clearExpiredCache(): Promise<number> {
    return requireGenericCachePostgres('clearExpiredCache', async (client) => {
        const result = await client.query(`delete from app_generic_cache where expires_at <= now()`);
        return result.rowCount ?? 0;
    });
}

