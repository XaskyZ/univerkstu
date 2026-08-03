/**
 * Сервис работы с экзаменами
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { Exams, CACHE_TTL } from '../types/index.js';
import { parseExams } from '../parsers/exams.js';
import { getPlatonusSessionDiagnostics } from './platonus.js';
import { getUser } from './users.js';

async function requireExamsPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Exams Cache] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

export function toPgExams(row: { user_id: string; data_json: Exams; cached_at: Date; expires_at: Date }): Exams {
    const data = row.data_json as Exams;
    return {
        ...data,
        userId: row.user_id,
        cachedAt: new Date(row.cached_at),
        expiresAt: new Date(row.expires_at),
        meta: { ...data.meta, userId: row.user_id },
    };
}

/**
 * Получение экзаменов из кэша
 */
export async function getCachedExams(userId: string): Promise<Exams | null> {
    return requireExamsPostgres('getCachedExams', async (client) => {
        const result = await client.query<{
            user_id: string;
            data_json: Exams;
            cached_at: Date;
            expires_at: Date;
        }>(
            `
                select user_id, data_json, cached_at, expires_at
                from app_exams_cache
                where user_id = $1 and expires_at > now()
                limit 1
            `,
            [userId]
        );
        return result.rows[0] ? toPgExams(result.rows[0]) : null;
    });
}

/**
 * Получение любого кеша (даже истёкшего) для stale-while-revalidate
 */
export async function getAnyExams(userId: string): Promise<Exams | null> {
    return requireExamsPostgres('getAnyExams', async (client) => {
        const result = await client.query<{
            user_id: string;
            data_json: Exams;
            cached_at: Date;
            expires_at: Date;
        }>(
            `
                select user_id, data_json, cached_at, expires_at
                from app_exams_cache
                where user_id = $1
                limit 1
            `,
            [userId]
        );
        return result.rows[0] ? toPgExams(result.rows[0]) : null;
    });
}

/**
 * Фоновое обновление экзаменов (не блокирует ответ)
 */
export function refreshExamsInBackground(userId: string): void {
    (async () => {
        try {
            const [user, platonus] = await Promise.all([
                getUser(userId),
                getPlatonusSessionDiagnostics(userId),
            ]);
            if (!platonus?.login || !platonus.password) return;
            
            console.log(`[Exams Service] Background refresh for ${userId}`);
            const result = await parseExams(
                platonus.login,
                platonus.password,
                user?.settings?.language || 'ru'
            );
            
            if (result.success && result.data) {
                await saveExams(userId, result.data);
                console.log(`[Exams Service] Background refresh complete for ${userId}`);
            }
        } catch (error) {
            console.error(`[Exams Service] Background refresh failed for ${userId}:`, error);
        }
    })();
}

/**
 * Сохранение экзаменов в кэш
 */
export async function saveExams(
    userId: string,
    examsData: Omit<Exams, '_id' | 'userId' | 'cachedAt' | 'expiresAt'>
): Promise<Exams> {
    const now = new Date();

    const exams: Omit<Exams, '_id'> = {
        ...examsData,
        userId,
        meta: { ...examsData.meta, userId },
        cachedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_TTL.EXAMS),
    };

    await requireExamsPostgres('saveExams', async (client) => {
        await client.query(
            `
                insert into app_exams_cache (user_id, data_json, cached_at, expires_at)
                values ($1, $2::jsonb, $3, $4)
                on conflict (user_id)
                do update set
                    data_json = excluded.data_json,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `,
            [userId, JSON.stringify(exams), now, exams.expiresAt]
        );
    });

    return exams as Exams;
}

/**
 * Получение экзаменов (с кэшированием и stale-while-revalidate)
 */
export async function getExams(
    userId: string,
    forceRefresh: boolean = false
): Promise<{ exams: Exams | null; cached: boolean; stale?: boolean; error?: string }> {

    // Проверяем свежий кэш
    if (!forceRefresh) {
        const cached = await getCachedExams(userId);
        if (cached) {
            console.log(`[Exams Service] Using fresh cached exams for ${userId}`);
            return { exams: cached, cached: true };
        }
    }

    // Проверяем любой кеш (даже истёкший) для stale-while-revalidate
    if (!forceRefresh) {
        const staleCache = await getAnyExams(userId);
        if (staleCache) {
            console.log(`[Exams Service] Using stale cache for ${userId}, refreshing in background`);
            refreshExamsInBackground(userId);
            return { exams: staleCache, cached: true, stale: true };
        }
    }

    // Нет кеша вообще — парсим синхронно
    const [user, platonus] = await Promise.all([
        getUser(userId),
        getPlatonusSessionDiagnostics(userId),
    ]);
    if (!user) {
        return { exams: null, cached: false, error: 'Пользователь не найден' };
    }
    if (!platonus?.login || !platonus.password) {
        return { exams: null, cached: false, error: 'Требуется авторизация в Platonus' };
    }

    // Парсим новые экзамены
    console.log(`[Exams Service] Fetching fresh exams for ${userId}`);
    const result = await parseExams(
        platonus.login,
        platonus.password,
        user.settings?.language || 'ru'
    );

    if (!result.success || !result.data) {
        return { exams: null, cached: false, error: result.error };
    }

    // Сохраняем в кэш
    const exams = await saveExams(userId, result.data);

    return { exams, cached: false };
}

/**
 * Инвалидация кэша экзаменов
 */
export async function invalidateExamsCache(userId: string): Promise<boolean> {
    return requireExamsPostgres('invalidateExamsCache', async (client) => {
        const result = await client.query(`delete from app_exams_cache where user_id = $1`, [userId]);
        return (result.rowCount ?? 0) > 0;
    });
}

/**
 * Получение статуса кэша
 */
export async function getExamsCacheStatus(userId: string): Promise<{
    cached: boolean;
    cachedAt: string | null;
    expiresAt: string | null;
    cacheAge: number | null;
}> {
    return requireExamsPostgres('getExamsCacheStatus', async (client) => {
        const result = await client.query<{ cached_at: Date; expires_at: Date }>(
            `
                select cached_at, expires_at
                from app_exams_cache
                where user_id = $1
                limit 1
            `,
            [userId]
        );
        const row = result.rows[0];
        if (!row) {
            return { cached: false, cachedAt: null, expiresAt: null, cacheAge: null };
        }
        const now = new Date();
        const cachedAt = new Date(row.cached_at);
        const expiresAt = new Date(row.expires_at);
        const isValid = expiresAt > now;
        return {
            cached: isValid,
            cachedAt: cachedAt.toISOString(),
            expiresAt: expiresAt.toISOString(),
            cacheAge: isValid ? Math.floor((now.getTime() - cachedAt.getTime()) / 1000) : null,
        };
    });
}
