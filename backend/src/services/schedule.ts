/**
 * Сервис работы с расписанием
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { Schedule, CACHE_TTL, ParseResult } from '../types/index.js';
import { parseSchedule } from '../parsers/schedule.js';
import { fetchAndParsePlatonusSchedule } from '../parsers/platonus-schedule.js';
import { getActivePlatonusSession, forceRefreshSession } from './platonus.js';
import { getUserPassword } from './users.js';
import { ensureTeacherDirectoryEntry } from './teacher-ratings.js';
import { findTeacherInDb } from '../utils/teacherMatcher.js';

async function requireSchedulePostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Schedule Cache] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

export function toPgSchedule(row: { user_id: string; data_json: Schedule; cached_at: Date; expires_at: Date }): Schedule {
    const data = row.data_json as Schedule;
    return {
        ...data,
        userId: row.user_id,
        cachedAt: new Date(row.cached_at),
        expiresAt: new Date(row.expires_at),
        meta: { ...data.meta, userId: row.user_id },
    };
}

/**
 * Получение расписания из кэша
 */
export async function getCachedSchedule(userId: string): Promise<Schedule | null> {
    return requireSchedulePostgres('getCachedSchedule', async (client) => {
        const result = await client.query<{
            user_id: string;
            data_json: Schedule;
            cached_at: Date;
            expires_at: Date;
        }>(
            `
                select user_id, data_json, cached_at, expires_at
                from app_schedule_cache
                where user_id = $1 and expires_at > now()
                limit 1
            `,
            [userId]
        );
        return result.rows[0] ? toPgSchedule(result.rows[0]) : null;
    });
}

/**
 * Получение любого кеша (даже истёкшего) для stale-while-revalidate
 */
export async function getAnySchedule(userId: string): Promise<Schedule | null> {
    return requireSchedulePostgres('getAnySchedule', async (client) => {
        const result = await client.query<{
            user_id: string;
            data_json: Schedule;
            cached_at: Date;
            expires_at: Date;
        }>(
            `
                select user_id, data_json, cached_at, expires_at
                from app_schedule_cache
                where user_id = $1
                limit 1
            `,
            [userId]
        );
        return result.rows[0] ? toPgSchedule(result.rows[0]) : null;
    });
}

/**
 * Свежее расписание из внешних источников.
 *
 * Порядок источников (осень 2026: КГТУ перенёс расписание в Platonus,
 * univer.kstu.kz его больше не публикует):
 *   1. Platonus v7 (сессия из app_platonus_sessions — тот же путь, что
 *      у оценок/экзаменов). При 401 пробуем один force-refresh сессии.
 *   2. Фолбэк — старый Univer-парсер (HTML myschedule), поведение прежнее:
 *      если у пользователя нет univer-пароля, возвращаем прежнюю ошибку.
 */
async function fetchFreshSchedule(
    userId: string
): Promise<ParseResult<Omit<Schedule, '_id' | 'userId' | 'cachedAt' | 'expiresAt'>>> {
    // 1) Platonus — основной источник
    let platonusError: string | undefined;
    try {
        const session = await getActivePlatonusSession(userId);
        if (session) {
            let result = await fetchAndParsePlatonusSchedule(session);

            // Сессия могла протухнуть раньше нашего TTL — один retry со свежим логином
            // (тот же паттерн, что у platonus-grades).
            if (!result.success && result.error?.includes('авторизация')) {
                console.log(`[Schedule Service] Platonus session stale for ${userId}, force-refreshing...`);
                const freshSession = await forceRefreshSession(userId);
                if (freshSession) {
                    result = await fetchAndParsePlatonusSchedule(freshSession);
                }
            }

            if (result.success && result.data) {
                console.log(`[Schedule Service] Schedule for ${userId} fetched from Platonus`);
                return result;
            }
            platonusError = result.error;
            console.warn(
                `[Schedule Service] Platonus schedule unavailable for ${userId} (${result.error}); ` +
                `falling back to Univer`
            );
        } else {
            console.log(`[Schedule Service] No Platonus session for ${userId}, using Univer source`);
        }
    } catch (error) {
        platonusError = error instanceof Error ? error.message : String(error);
        console.warn(`[Schedule Service] Platonus schedule path threw for ${userId}:`, error);
    }

    // 2) Фолбэк — Univer (старый путь, сохраняем прежнее поведение)
    const password = await getUserPassword(userId);
    if (!password) {
        return { success: false, error: platonusError || 'Пользователь не найден' };
    }

    const result = await parseSchedule(userId, password);
    if (result.success && result.data) {
        result.data.meta.source = 'univer';
    }
    return result;
}

/**
 * Фоновое обновление расписания (не блокирует ответ)
 */
export function refreshScheduleInBackground(userId: string): void {
    // Fire and forget
    (async () => {
        try {
            console.log(`[Schedule Service] Background refresh for ${userId}`);
            const result = await fetchFreshSchedule(userId);

            if (result.success && result.data) {
                await saveSchedule(userId, result.data);
                console.log(`[Schedule Service] Background refresh complete for ${userId}`);
            }
        } catch (error) {
            console.error(`[Schedule Service] Background refresh failed for ${userId}:`, error);
        }
    })();
}

/**
 * Сохранение расписания в кэш
 */
export async function saveSchedule(
    userId: string,
    scheduleData: Omit<Schedule, '_id' | 'userId' | 'cachedAt' | 'expiresAt'>
): Promise<Schedule> {
    const now = new Date();

    const schedule: Omit<Schedule, '_id'> = {
        ...scheduleData,
        userId,
        meta: { ...scheduleData.meta, userId },
        cachedAt: now,
        expiresAt: new Date(now.getTime() + CACHE_TTL.SCHEDULE),
    };

    await requireSchedulePostgres('saveSchedule', async (client) => {
        await client.query(
            `
                insert into app_schedule_cache (user_id, data_json, cached_at, expires_at)
                values ($1, $2::jsonb, $3, $4)
                on conflict (user_id)
                do update set
                    data_json = excluded.data_json,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `,
            [userId, JSON.stringify(schedule), now, schedule.expiresAt]
        );
    });

    // Phase 1 S8: auto-seed verified teachers into directory from parsed schedule.
    // Only seed teachers that match kstu_staff_data.json (trusted source).
    // Fire-and-forget — never block schedule save on this side effect.
    void seedTeachersFromSchedule(schedule).catch((error) => {
        console.warn(`[Schedule Service] Teacher auto-seed failed for ${userId}:`, error);
    });

    return schedule as Schedule;
}

/**
 * Walks the parsed schedule, finds teachers whose names match kstu_staff_data.json,
 * and upserts them into app_teacher_directory as verified+schedule-sourced.
 * Failures are logged but never rethrown.
 */
async function seedTeachersFromSchedule(schedule: Omit<Schedule, '_id'>): Promise<void> {
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const day of schedule.days || []) {
        for (const slot of day.lessons || []) {
            for (const lesson of slot || []) {
                const teacherText = lesson?.teacher?.trim();
                if (!teacherText) continue;
                if (seen.has(teacherText)) continue;
                seen.add(teacherText);
                const matched = findTeacherInDb(teacherText);
                if (matched) {
                    candidates.push(teacherText);
                }
            }
        }
    }

    for (const teacherName of candidates) {
        try {
            await ensureTeacherDirectoryEntry(teacherName, {
                createdBy: 'system:schedule',
                source: 'schedule',
                verified: true,
            });
        } catch (error) {
            console.warn(`[Schedule Service] Failed to auto-seed teacher "${teacherName}":`, error);
        }
    }
}

/**
 * Получение расписания (с кэшированием и stale-while-revalidate)
 */
export async function getSchedule(
    userId: string,
    forceRefresh: boolean = false
): Promise<{ schedule: Schedule | null; cached: boolean; stale?: boolean; error?: string }> {

    // Проверяем свежий кэш
    if (!forceRefresh) {
        const cached = await getCachedSchedule(userId);
        if (cached) {
            console.log(`[Schedule Service] Using fresh cached schedule for ${userId}`);
            return { schedule: cached, cached: true };
        }
    }

    // Проверяем любой кеш (даже истёкший) для stale-while-revalidate
    if (!forceRefresh) {
        const staleCache = await getAnySchedule(userId);
        if (staleCache) {
            console.log(`[Schedule Service] Using stale cache for ${userId}, refreshing in background`);
            refreshScheduleInBackground(userId);
            return { schedule: staleCache, cached: true, stale: true };
        }
    }

    // Нет кеша вообще — парсим синхронно (Platonus → фолбэк Univer)
    console.log(`[Schedule Service] Fetching fresh schedule for ${userId}`);
    const result = await fetchFreshSchedule(userId);

    if (!result.success || !result.data) {
        return { schedule: null, cached: false, error: result.error };
    }

    // Сохраняем в кэш
    const schedule = await saveSchedule(userId, result.data);

    return { schedule, cached: false };
}

/**
 * Инвалидация кэша расписания
 */
export async function invalidateScheduleCache(userId: string): Promise<boolean> {
    return requireSchedulePostgres('invalidateScheduleCache', async (client) => {
        const result = await client.query(`delete from app_schedule_cache where user_id = $1`, [userId]);
        return (result.rowCount ?? 0) > 0;
    });
}

/**
 * Получение статуса кэша
 */
export async function getScheduleCacheStatus(userId: string): Promise<{
    cached: boolean;
    cachedAt: string | null;
    expiresAt: string | null;
    cacheAge: number | null;
}> {
    return requireSchedulePostgres('getScheduleCacheStatus', async (client) => {
        const result = await client.query<{ cached_at: Date; expires_at: Date }>(
            `
                select cached_at, expires_at
                from app_schedule_cache
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
