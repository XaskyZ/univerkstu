import { withSupabasePostgres } from '../db/postgres.js';

export type FeedbackCategory = 'suggestion' | 'bug' | 'other';

export type FeedbackStatus = 'new' | 'planned' | 'done' | 'wontfix';

export const FEEDBACK_STATUSES: readonly FeedbackStatus[] = ['new', 'planned', 'done', 'wontfix'] as const;

export function normalizeFeedbackStatus(value: unknown): FeedbackStatus {
    if (value === 'planned' || value === 'done' || value === 'wontfix') return value;
    return 'new';
}

export type AdminFeedbackSummary = {
    ratings: {
        total: number;
        average: number;
        distribution: Record<'1' | '2' | '3' | '4' | '5', number>;
        recent: Array<{
            userId: string;
            fullName: string | null;
            rating: number;
            updatedAt: string;
        }>;
    };
    feedback: {
        total: number;
        byCategory: Record<FeedbackCategory, number>;
        byStatus: Record<FeedbackStatus, number>;
        recent: Array<{
            id: string;
            userId: string;
            fullName: string | null;
            category: FeedbackCategory;
            status: FeedbackStatus;
            message: string;
            rating: number | null;
            page: string | null;
            createdAt: string;
        }>;
    };
};

export function clampRating(value: number): number {
    return Math.min(5, Math.max(1, Math.round(value)));
}

async function requireFeedbackPostgres<T>(
    operation: string,
    handler: Parameters<typeof withSupabasePostgres<T>>[0]
): Promise<T> {
    const result = await withSupabasePostgres(handler);
    if (result === null) {
        throw new Error(`[Feedback] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result;
}

export async function getOwnRating(userId: string): Promise<number | null> {
    return requireFeedbackPostgres('getOwnRating', async (client) => {
        const result = await client.query<{ rating: number | null }>(
            `
                select rating
                from app_feedback
                where kind = 'rating' and user_id = $1
                limit 1
            `,
            [userId]
        );
        return typeof result.rows[0]?.rating === 'number' ? result.rows[0].rating : null;
    });
}

export async function submitUserRating(
    userId: string,
    rating: number,
    options: { lastPath?: string | null; appVersion?: string | null } = {}
): Promise<number> {
    const now = new Date();
    const safeRating = clampRating(rating);

    await requireFeedbackPostgres('submitUserRating', async (client) => {
        await client.query(
            `
                insert into app_feedback (
                    kind, user_id, rating, last_path, app_version, created_at, updated_at
                )
                values ('rating', $1, $2, $3, $4, $5, $5)
                on conflict (user_id) where kind = 'rating'
                do update set
                    rating = excluded.rating,
                    last_path = excluded.last_path,
                    app_version = excluded.app_version,
                    updated_at = excluded.updated_at
            `,
            [userId, safeRating, options.lastPath || null, options.appVersion || null, now]
        );
        return true;
    });

    return safeRating;
}

export async function submitUserFeedback(
    userId: string,
    category: FeedbackCategory,
    message: string,
    options: { rating?: number | null; page?: string | null; appVersion?: string | null } = {}
): Promise<string> {
    const now = new Date();
    return requireFeedbackPostgres('submitUserFeedback', async (client) => {
        const result = await client.query<{ id: string }>(
            `
                insert into app_feedback (
                    kind, user_id, category, message, rating, page, app_version, status, created_at, updated_at
                )
                values ('feedback', $1, $2, $3, $4, $5, $6, 'new', $7, $7)
                returning id::text as id
            `,
            [
                userId,
                category,
                message,
                typeof options.rating === 'number' ? clampRating(options.rating) : null,
                options.page || null,
                options.appVersion || null,
                now,
            ]
        );
        return result.rows[0]?.id || '';
    });
}

export async function deleteUserRating(userId: string): Promise<boolean> {
    return requireFeedbackPostgres('deleteUserRating', async (client) => {
        const result = await client.query(
            `delete from app_feedback where kind = 'rating' and user_id = $1`,
            [userId]
        );
        return (result.rowCount ?? 0) > 0;
    });
}

export async function deleteFeedbackMessage(id: string): Promise<boolean> {
    const numericId = Number.parseInt(id, 10);
    return requireFeedbackPostgres('deleteFeedbackMessage', async (client) => {
        if (!Number.isFinite(numericId)) return false;
        const result = await client.query(
            `delete from app_feedback where id = $1 and kind = 'feedback'`,
            [numericId]
        );
        return (result.rowCount ?? 0) > 0;
    });
}

export async function updateFeedbackStatus(id: string, status: FeedbackStatus): Promise<boolean> {
    const numericId = Number.parseInt(id, 10);
    return requireFeedbackPostgres('updateFeedbackStatus', async (client) => {
        if (!Number.isFinite(numericId)) return false;
        const result = await client.query(
            `update app_feedback set status = $2, updated_at = now() where id = $1 and kind = 'feedback'`,
            [numericId, status]
        );
        return (result.rowCount ?? 0) > 0;
    });
}

export type AdminFeedbackSort = 'newest' | 'oldest' | 'user';

export interface AdminFeedbackListFilters {
    statuses?: readonly FeedbackStatus[];
    categories?: readonly FeedbackCategory[];
    search?: string | null;
    sort?: AdminFeedbackSort;
    limit?: number;
    offset?: number;
}

export interface AdminFeedbackMessageItem {
    id: string;
    userId: string;
    fullName: string | null;
    category: FeedbackCategory;
    status: FeedbackStatus;
    message: string;
    rating: number | null;
    page: string | null;
    appVersion: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface AdminFeedbackListResult {
    items: AdminFeedbackMessageItem[];
    total: number;
    counts: Record<FeedbackStatus, number>;
}

const ALL_STATUSES: readonly FeedbackStatus[] = FEEDBACK_STATUSES;
const ALL_CATEGORIES: readonly FeedbackCategory[] = ['suggestion', 'bug', 'other'] as const;
const ALL_SORTS: readonly AdminFeedbackSort[] = ['newest', 'oldest', 'user'] as const;

export function normalizeFeedbackStatusList(values: readonly unknown[] | undefined | null): readonly FeedbackStatus[] {
    if (!Array.isArray(values) || values.length === 0) return ALL_STATUSES;
    const seen = new Set<FeedbackStatus>();
    for (const value of values) {
        if (typeof value !== 'string') continue;
        if ((ALL_STATUSES as readonly string[]).includes(value)) {
            seen.add(value as FeedbackStatus);
        }
    }
    return seen.size > 0 ? Array.from(seen) : ALL_STATUSES;
}

export function normalizeFeedbackCategoryList(values: readonly unknown[] | undefined | null): readonly FeedbackCategory[] {
    if (!Array.isArray(values) || values.length === 0) return ALL_CATEGORIES;
    const seen = new Set<FeedbackCategory>();
    for (const value of values) {
        if (typeof value !== 'string') continue;
        if ((ALL_CATEGORIES as readonly string[]).includes(value)) {
            seen.add(value as FeedbackCategory);
        }
    }
    return seen.size > 0 ? Array.from(seen) : ALL_CATEGORIES;
}

export function normalizeFeedbackSort(value: unknown): AdminFeedbackSort {
    if (typeof value === 'string' && (ALL_SORTS as readonly string[]).includes(value)) {
        return value as AdminFeedbackSort;
    }
    return 'newest';
}

export function buildFeedbackListOrderBy(sort: AdminFeedbackSort | undefined): string {
    switch (sort) {
        case 'oldest':
            return 'order by f.created_at asc';
        case 'user':
            return 'order by f.user_id asc, f.created_at desc';
        case 'newest':
        default:
            return 'order by f.created_at desc';
    }
}

export function clampFeedbackListLimit(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 50;
    return Math.min(Math.max(Math.floor(parsed), 1), 200);
}

export function clampFeedbackListOffset(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(Math.floor(parsed), 0);
}

export function parseCsvParam(value: unknown): string[] | undefined {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    return trimmed.split(',').map((part) => part.trim()).filter((part) => part.length > 0);
}

export async function listAdminFeedbackMessages(filters: AdminFeedbackListFilters = {}): Promise<AdminFeedbackListResult> {
    const statuses = normalizeFeedbackStatusList(filters.statuses);
    const categories = normalizeFeedbackCategoryList(filters.categories);
    const search = typeof filters.search === 'string' ? filters.search.trim() : '';
    const limit = clampFeedbackListLimit(filters.limit);
    const offset = clampFeedbackListOffset(filters.offset);
    const sort = normalizeFeedbackSort(filters.sort);

    return requireFeedbackPostgres('listAdminFeedbackMessages', async (client) => {
        const params: unknown[] = [];
        const conditions: string[] = [`f.kind = 'feedback'`];

        params.push(statuses as unknown as string[]);
        conditions.push(`coalesce(f.status, 'new') = any($${params.length}::text[])`);

        params.push(categories as unknown as string[]);
        conditions.push(`coalesce(f.category, 'suggestion') = any($${params.length}::text[])`);

        if (search.length > 0) {
            params.push(`%${search}%`);
            conditions.push(`f.message ilike $${params.length}`);
        }

        const where = conditions.join(' and ');
        const orderBy = buildFeedbackListOrderBy(sort);

        params.push(limit);
        const limitParamIndex = params.length;
        params.push(offset);
        const offsetParamIndex = params.length;

        const [itemsResult, totalResult, countsResult] = await Promise.all([
            client.query<{
                id: string;
                user_id: string;
                full_name: string | null;
                category: FeedbackCategory;
                status: string | null;
                message: string;
                rating: number | null;
                page: string | null;
                app_version: string | null;
                created_at: Date;
                updated_at: Date;
            }>(
                `
                    select
                        f.id::text as id,
                        f.user_id,
                        s.snapshot_json->>'fullName' as full_name,
                        f.category,
                        f.status,
                        f.message,
                        f.rating,
                        f.page,
                        f.app_version,
                        f.created_at,
                        f.updated_at
                    from app_feedback f
                    left join app_admin_user_snapshots s on s.user_id = f.user_id
                    where ${where}
                    ${orderBy}
                    limit $${limitParamIndex}
                    offset $${offsetParamIndex}
                `,
                params
            ),
            client.query<{ count: string }>(
                `
                    select count(*)::text as count
                    from app_feedback f
                    where ${where}
                `,
                params.slice(0, params.length - 2)
            ),
            client.query<{ status: string | null; count: string }>(
                `
                    select coalesce(status, 'new') as status, count(*)::text as count
                    from app_feedback
                    where kind = 'feedback'
                    group by coalesce(status, 'new')
                `
            ),
        ]);

        const counts: Record<FeedbackStatus, number> = {
            new: 0,
            planned: 0,
            done: 0,
            wontfix: 0,
        };
        for (const row of countsResult.rows) {
            const status = normalizeFeedbackStatus(row.status);
            counts[status] = Number.parseInt(row.count, 10) || 0;
        }

        const items: AdminFeedbackMessageItem[] = itemsResult.rows.map((row) => ({
            id: row.id,
            userId: row.user_id,
            fullName: row.full_name,
            category: row.category,
            status: normalizeFeedbackStatus(row.status),
            message: row.message,
            rating: row.rating,
            page: row.page,
            appVersion: row.app_version,
            createdAt: new Date(row.created_at).toISOString(),
            updatedAt: new Date(row.updated_at).toISOString(),
        }));

        const total = Number.parseInt(totalResult.rows[0]?.count || '0', 10) || 0;

        return { items, total, counts };
    });
}

export async function getAdminFeedbackSummary(limit = 12): Promise<AdminFeedbackSummary> {
    const safeLimit = Math.min(Math.max(limit, 1), 50);

    return requireFeedbackPostgres('getAdminFeedbackSummary', async (client) => {
        const [ratingsResult, feedbackResult, countsResult] = await Promise.all([
            client.query<{
                user_id: string;
                rating: number;
                updated_at: Date;
            }>(
                `
                    select user_id, rating, updated_at
                    from app_feedback
                    where kind = 'rating'
                    order by updated_at desc
                `
            ),
            client.query<{
                id: string;
                user_id: string;
                category: FeedbackCategory;
                status: string | null;
                message: string;
                rating: number | null;
                page: string | null;
                created_at: Date;
            }>(
                `
                    select id::text as id, user_id, category, status, message, rating, page, created_at
                    from app_feedback
                    where kind = 'feedback'
                    order by created_at desc
                    limit $1
                `,
                [safeLimit]
            ),
            client.query<{ kind: string; category: string | null; status: string | null; count: string }>(
                `
                    select kind, category, status, count(*)::text as count
                    from app_feedback
                    group by kind, category, status
                `
            ),
        ]);

        const distribution: Record<'1' | '2' | '3' | '4' | '5', number> = {
            '1': 0, '2': 0, '3': 0, '4': 0, '5': 0,
        };
        let totalRatingValue = 0;
        for (const item of ratingsResult.rows) {
            const safe = clampRating(item.rating);
            distribution[String(safe) as keyof typeof distribution] += 1;
            totalRatingValue += safe;
        }

        const feedbackByCategory: Record<FeedbackCategory, number> = {
            suggestion: 0,
            bug: 0,
            other: 0,
        };
        const feedbackByStatus: Record<FeedbackStatus, number> = {
            new: 0,
            planned: 0,
            done: 0,
            wontfix: 0,
        };
        let totalFeedback = 0;
        for (const row of countsResult.rows) {
            const count = Number.parseInt(row.count, 10) || 0;
            if (row.kind === 'feedback') {
                totalFeedback += count;
                if (row.category === 'suggestion' || row.category === 'bug' || row.category === 'other') {
                    feedbackByCategory[row.category] += count;
                }
                const status = normalizeFeedbackStatus(row.status);
                feedbackByStatus[status] += count;
            }
        }

        return {
            ratings: {
                total: ratingsResult.rows.length,
                average: ratingsResult.rows.length > 0 ? Number((totalRatingValue / ratingsResult.rows.length).toFixed(2)) : 0,
                distribution,
                recent: ratingsResult.rows.slice(0, safeLimit).map((item) => ({
                    userId: item.user_id,
                    fullName: null,
                    rating: clampRating(item.rating),
                    updatedAt: new Date(item.updated_at).toISOString(),
                })),
            },
            feedback: {
                total: totalFeedback,
                byCategory: feedbackByCategory,
                byStatus: feedbackByStatus,
                recent: feedbackResult.rows.map((item) => ({
                    id: item.id,
                    userId: item.user_id,
                    fullName: null,
                    category: item.category,
                    status: normalizeFeedbackStatus(item.status),
                    message: item.message,
                    rating: item.rating,
                    page: item.page,
                    createdAt: new Date(item.created_at).toISOString(),
                })),
            },
        } satisfies AdminFeedbackSummary;
    });
}
