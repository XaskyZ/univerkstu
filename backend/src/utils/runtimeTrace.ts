import { withSupabasePostgres } from '../db/postgres.js';

export const RUNTIME_TRACE_COLLECTION = 'runtime_traces';

/**
 * Pure helper — escape admin-supplied text before embedding it in an
 * `ILIKE '%X%'` filter, so `%`/`_`/`\` match literally instead of broadening
 * the match. Mirrors `escapeSocialSearchLike` in `services/social.ts`.
 * Exported for unit testing.
 */
export function escapeRuntimeTraceLike(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}

export type RuntimeTraceLevel = 'debug' | 'info' | 'warn' | 'error';
export type RuntimeTraceSource = 'frontend' | 'backend';

export interface RuntimeTraceEntry {
    createdAt: Date;
    source: RuntimeTraceSource;
    scope: string;
    event: string;
    level: RuntimeTraceLevel;
    message: string;
    userId: string | null;
    sessionId: string | null;
    reqId: string | null;
    routeKind: string | null;
    path: string | null;
    metadata: Record<string, unknown> | null;
}

async function requireRuntimeTracePostgres<T>(
    operation: string,
    handler: Parameters<typeof withSupabasePostgres<T>>[0]
): Promise<T> {
    const result = await withSupabasePostgres(handler);
    if (result === null) {
        throw new Error(`[RuntimeTrace] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result;
}

export function traceRuntime(_input: {
    source: RuntimeTraceSource;
    scope: string;
    event: string;
    level?: RuntimeTraceLevel;
    message: string;
    userId?: string | null;
    metadata?: Record<string, unknown> | null;
}): void {
    // Runtime-трейсы не персистятся: функция намеренно оставлена как no-op,
    // чтобы вызывающий код не менялся.
}

export async function getRuntimeTraces(options: {
    limit?: number;
    source?: RuntimeTraceSource;
    scope?: string;
    userId?: string;
    level?: RuntimeTraceLevel;
} = {}): Promise<RuntimeTraceEntry[]> {
    const { limit = 50, source, scope, userId, level } = options;
    const safeLimit = Math.max(1, Math.min(limit, 200));
    return requireRuntimeTracePostgres('getRuntimeTraces', async (client) => {
        const conditions: string[] = [];
        const values: unknown[] = [];
        const push = (value: unknown) => {
            values.push(value);
            return `$${values.length}`;
        };
        if (source) conditions.push(`source = ${push(source)}`);
        if (scope) conditions.push(`scope = ${push(scope)}`);
        if (level) conditions.push(`level = ${push(level)}`);
        if (userId) conditions.push(`coalesce(user_id, '') ilike ${push(`%${escapeRuntimeTraceLike(userId)}%`)}`);
        const whereClause = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
        const limitPlaceholder = push(safeLimit);

        const result = await client.query<{
            created_at: Date;
            source: RuntimeTraceSource;
            scope: string;
            event: string;
            level: RuntimeTraceLevel;
            message: string;
            user_id: string | null;
            session_id: string | null;
            req_id: string | null;
            route_kind: string | null;
            path: string | null;
            metadata_json: Record<string, unknown> | null;
        }>(
            `
                select created_at, source, scope, event, level, message, user_id, session_id, req_id, route_kind, path, metadata_json
                from app_runtime_traces
                ${whereClause}
                order by created_at desc
                limit ${limitPlaceholder}
            `,
            values
        );

        return result.rows.map((row) => ({
            createdAt: new Date(row.created_at),
            source: row.source,
            scope: row.scope,
            event: row.event,
            level: row.level,
            message: row.message,
            userId: row.user_id,
            sessionId: row.session_id,
            reqId: row.req_id,
            routeKind: row.route_kind,
            path: row.path,
            metadata: row.metadata_json,
        }));
    });
}
