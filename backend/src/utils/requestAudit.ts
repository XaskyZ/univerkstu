import { withSupabasePostgres } from '../db/postgres.js';

export const REQUEST_AUDIT_COLLECTION = 'request_audit';

/**
 * Pure helper — escape admin-supplied text so it is safe to embed inside an
 * `ILIKE '%X%'` clause. Postgres `LIKE` treats `%`, `_` and `\` as special, so
 * an unescaped path filter like `/api/v3/_x` would also match `/api/v3/ax`.
 * Values are still bound as `$n` (this is match-broadening, not injection).
 * Mirrors `escapeSocialSearchLike` in `services/social.ts`. Exported for tests.
 */
export function escapeRequestAuditLike(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

async function requireRequestAuditPostgres<T>(
    operation: string,
    handler: Parameters<typeof withSupabasePostgres<T>>[0]
): Promise<T> {
    const result = await withSupabasePostgres(handler);
    if (result === null) {
        throw new Error(`[RequestAudit] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result;
}

export interface RequestAuditLog {
    createdAt: Date;
    reqId: string;
    routeKind: string;
    method: string;
    url: string;
    path: string;
    statusCode: number;
    durationMs: number;
    ip: string | null;
    userId: string | null;
    sessionId: string | null;
    source: 'webapp' | 'direct' | 'unknown';
    host: string | null;
    userAgent: string | null;
    referer: string | null;
    origin: string | null;
    contentLength: number | null;
    responseBytes: number | null;
    errorCode: string | null;
    errorMessage: string | null;
}

export function logRequestAudit(_entry: Omit<RequestAuditLog, 'createdAt'>): void {
    // Аудит запросов не ведётся: функция намеренно оставлена как no-op, чтобы
    // вызывающие хуки не менялись.
}

export async function getRequestAuditLogs(options: {
    limit?: number;
    offset?: number;
    method?: string;
    statusCode?: number;
    userId?: string;
    path?: string;
    reqId?: string;
    sessionId?: string;
    routeKind?: string;
    source?: string;
    onlyErrors?: boolean;
} = {}): Promise<{ logs: RequestAuditLog[]; hasMore: boolean }> {
    return requireRequestAuditPostgres('getRequestAuditLogs', async (client) => {
        const { limit = 100, offset = 0, method, statusCode, userId, path, reqId, sessionId, routeKind, source, onlyErrors } = options;
        const safeLimit = Math.min(Math.max(limit, 1), 500);
        const safeOffset = Math.max(offset, 0);

        const conditions: string[] = [];
        const values: unknown[] = [];
        const push = (value: unknown) => {
            values.push(value);
            return `$${values.length}`;
        };

        if (method) conditions.push(`method = ${push(method.toUpperCase())}`);
        if (typeof statusCode === 'number' && Number.isFinite(statusCode)) conditions.push(`status_code = ${push(statusCode)}`);
        if (userId) conditions.push(`coalesce(user_id, '') ilike ${push(`%${escapeRequestAuditLike(userId)}%`)}`);
        if (path) conditions.push(`path ilike ${push(`%${escapeRequestAuditLike(path)}%`)}`);
        if (reqId) conditions.push(`req_id ilike ${push(`%${escapeRequestAuditLike(reqId)}%`)}`);
        if (sessionId) conditions.push(`coalesce(session_id, '') ilike ${push(`%${escapeRequestAuditLike(sessionId)}%`)}`);
        if (routeKind) conditions.push(`route_kind = ${push(routeKind)}`);
        if (source) conditions.push(`source = ${push(source)}`);
        if (onlyErrors) conditions.push(`status_code >= 400`);

        const whereClause = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
        const limitPlaceholder = push(safeLimit + 1);
        const offsetPlaceholder = push(safeOffset);
        const result = await client.query<{
            created_at: Date;
            req_id: string;
            route_kind: string;
            method: string;
            url: string;
            path: string;
            status_code: number;
            duration_ms: number;
            ip: string | null;
            user_id: string | null;
            session_id: string | null;
            source: 'webapp' | 'direct' | 'unknown';
            host: string | null;
            user_agent: string | null;
            referer: string | null;
            origin: string | null;
            content_length: number | null;
            response_bytes: number | null;
            error_code: string | null;
            error_message: string | null;
        }>(
            `
                select *
                from app_request_audit
                ${whereClause}
                order by created_at desc
                limit ${limitPlaceholder}
                offset ${offsetPlaceholder}
            `,
            values
        );

        return {
            logs: result.rows.slice(0, safeLimit).map((row) => ({
                createdAt: new Date(row.created_at),
                reqId: row.req_id,
                routeKind: row.route_kind,
                method: row.method,
                url: row.url,
                path: row.path,
                statusCode: row.status_code,
                durationMs: row.duration_ms,
                ip: row.ip,
                userId: row.user_id,
                sessionId: row.session_id,
                source: row.source,
                host: row.host,
                userAgent: row.user_agent,
                referer: row.referer,
                origin: row.origin,
                contentLength: row.content_length,
                responseBytes: row.response_bytes,
                errorCode: row.error_code,
                errorMessage: row.error_message,
            })),
            hasMore: result.rows.length > safeLimit,
        };
    });
}
