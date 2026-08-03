import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { GradesData } from '../types/grades.js';
import { parseGradesWithSession } from '../parsers/grades.js';
import { fetchTranscriptGPA } from '../parsers/platonus-client.js';
import { getActivePlatonusSession, forceRefreshSession } from './platonus.js';
import { recordUserSubjectGrades, selectLeaderboardScore } from './subject-grades.js';

const PLATONUS_GRADES_TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface PlatonusGradesCacheDoc {
    userId: string;
    year: number;
    semester: number;
    data: GradesData;
    cachedAt: Date;
    expiresAt: Date;
}

type GradesFetchErrorCode = 'PLATONUS_NOT_CONNECTED' | 'PLATONUS_UPSTREAM_ERROR';

interface FreshGradesResult {
    data?: GradesData;
    error?: string;
    errorCode?: GradesFetchErrorCode;
}

async function requirePlatonusGradesPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Platonus Grades Cache] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

export function toPgDoc(row: {
    user_id: string;
    year: number;
    semester: number;
    data_json: GradesData;
    cached_at: Date;
    expires_at: Date;
}): PlatonusGradesCacheDoc {
    return {
        userId: row.user_id,
        year: row.year,
        semester: row.semester,
        data: row.data_json,
        cachedAt: new Date(row.cached_at),
        expiresAt: new Date(row.expires_at),
    };
}

async function getFreshCache(userId: string, year: number, semester: number): Promise<PlatonusGradesCacheDoc | null> {
    return requirePlatonusGradesPostgres('getFreshCache', async (client) => {
        const result = await client.query<{
            user_id: string;
            year: number;
            semester: number;
            data_json: GradesData;
            cached_at: Date;
            expires_at: Date;
        }>(
            `
                select user_id, year, semester, data_json, cached_at, expires_at
                from app_platonus_grades_cache
                where user_id = $1 and year = $2 and semester = $3 and expires_at > now()
                limit 1
            `,
            [userId, year, semester]
        );
        return result.rows[0] ? toPgDoc(result.rows[0]) : null;
    });
}

async function getAnyCache(userId: string, year: number, semester: number): Promise<PlatonusGradesCacheDoc | null> {
    return requirePlatonusGradesPostgres('getAnyCache', async (client) => {
        const result = await client.query<{
            user_id: string;
            year: number;
            semester: number;
            data_json: GradesData;
            cached_at: Date;
            expires_at: Date;
        }>(
            `
                select user_id, year, semester, data_json, cached_at, expires_at
                from app_platonus_grades_cache
                where user_id = $1 and year = $2 and semester = $3
                order by cached_at desc
                limit 1
            `,
            [userId, year, semester]
        );
        return result.rows[0] ? toPgDoc(result.rows[0]) : null;
    });
}

async function saveCache(userId: string, year: number, semester: number, data: GradesData): Promise<PlatonusGradesCacheDoc> {
    const now = new Date();
    const doc: PlatonusGradesCacheDoc = {
        userId,
        year,
        semester,
        data,
        cachedAt: now,
        expiresAt: new Date(now.getTime() + PLATONUS_GRADES_TTL_MS),
    };

    await requirePlatonusGradesPostgres('saveCache', async (client) => {
        await client.query(
            `
                insert into app_platonus_grades_cache (user_id, year, semester, data_json, cached_at, expires_at)
                values ($1, $2, $3, $4::jsonb, $5, $6)
                on conflict (user_id, year, semester)
                do update set
                    data_json = excluded.data_json,
                    cached_at = excluded.cached_at,
                    expires_at = excluded.expires_at
            `,
            [userId, year, semester, JSON.stringify(data), now, doc.expiresAt]
        );
    });

    // Best-effort: feed the cross-user subject leaderboard. Never blocks or
    // fails the grade-cache write (fire-and-forget; errors swallowed).
    if (Array.isArray(data.subjects) && data.subjects.length > 0) {
        void recordUserSubjectGrades(
            userId,
            data.subjects.map((s) => ({
                name: s.name,
                year,
                semester,
                source: 'platonus' as const,
                score: selectLeaderboardScore(s.total, s.rating),
            })),
        ).catch((error) => console.error('[PlatonusGrades] leaderboard record failed:', error));
    }

    return doc;
}

async function fetchFreshGrades(userId: string, year: number, semester: number): Promise<FreshGradesResult> {
    const session = await getActivePlatonusSession(userId);
    if (!session) {
        return {
            error: 'Platonus не подключён. Необходимо авторизоваться.',
            errorCode: 'PLATONUS_NOT_CONNECTED',
        };
    }

    const result = await parseGradesWithSession(session, year, semester);
    if (!result.success || !result.data) {
        return {
            error: result.error || 'Ошибка получения данных из Platonus',
            errorCode: 'PLATONUS_UPSTREAM_ERROR',
        };
    }

    // Retry transcript with force-refresh if GPA is missing
    if (result.data.meta.gpa === undefined) {
        console.log('[Platonus Grades Cache] GPA missing, force-refreshing session for transcript retry...');
        const freshSession = await forceRefreshSession(userId);
        if (freshSession) {
            const transcriptData = await fetchTranscriptGPA(freshSession).catch(() => null);
            if (transcriptData) {
                result.data.meta.gpa = transcriptData.overallGpa;
                result.data.meta.overallGpa = transcriptData.overallGpa;
                if (transcriptData.groupName) {
                    result.data.meta.groupName = transcriptData.groupName;
                }
                if (transcriptData.termGpaMap && Object.keys(transcriptData.termGpaMap).length > 0) {
                    result.data.meta.termGpaMap = transcriptData.termGpaMap;
                }
                if (transcriptData.courseGpaMap && Object.keys(transcriptData.courseGpaMap).length > 0) {
                    result.data.meta.courseGpaMap = transcriptData.courseGpaMap;
                }
                console.log(`[Platonus Grades Cache] GPA retry success: ${transcriptData.overallGpa}`);
            }
        }
    }

    return { data: result.data };
}

export function refreshPlatonusGradesInBackground(userId: string, year: number, semester: number): void {
    (async () => {
        try {
            console.log(`[Platonus Grades Cache] Background refresh for ${userId} ${year}/${semester}`);
            const fresh = await fetchFreshGrades(userId, year, semester);
            if (fresh.data) {
                await saveCache(userId, year, semester, fresh.data);
                console.log(`[Platonus Grades Cache] Background refresh complete for ${userId} ${year}/${semester}`);
            }
        } catch (error) {
            console.error('[Platonus Grades Cache] Background refresh failed:', error);
        }
    })();
}

export async function getPlatonusGradesCached(
    userId: string,
    year: number,
    semester: number,
    forceRefresh = false
): Promise<{
    data?: GradesData;
    error?: string;
    errorCode?: GradesFetchErrorCode;
    cached: boolean;
    stale?: boolean;
    cacheAge?: number;
}> {
    if (!forceRefresh) {
        const fresh = await getFreshCache(userId, year, semester);
        if (fresh) {
            return {
                data: fresh.data,
                cached: true,
                stale: false,
                cacheAge: Math.floor((Date.now() - fresh.cachedAt.getTime()) / 1000),
            };
        }
    }

    if (!forceRefresh) {
        const stale = await getAnyCache(userId, year, semester);
        if (stale) {
            refreshPlatonusGradesInBackground(userId, year, semester);
            return {
                data: stale.data,
                cached: true,
                stale: true,
                cacheAge: Math.floor((Date.now() - stale.cachedAt.getTime()) / 1000),
            };
        }
    }

    const freshResult = await fetchFreshGrades(userId, year, semester);
    if (!freshResult.data) {
        return {
            error: freshResult.error || 'Ошибка получения данных из Platonus',
            errorCode: freshResult.errorCode || 'PLATONUS_UPSTREAM_ERROR',
            cached: false,
        };
    }

    const saved = await saveCache(userId, year, semester, freshResult.data);
    return {
        data: saved.data,
        cached: false,
        stale: false,
        cacheAge: 0,
    };
}

export async function deletePlatonusGradesCache(userId: string): Promise<void> {
    await requirePlatonusGradesPostgres('deletePlatonusGradesCache', async (client) => {
        await client.query(`delete from app_platonus_grades_cache where user_id = $1`, [userId]);
    });
}
