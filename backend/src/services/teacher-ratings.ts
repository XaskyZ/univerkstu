import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { findTeacherInDb } from '../utils/teacherMatcher.js';
import { containsProfanity } from '../utils/teacherNameValidator.js';

export type TeacherTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type TeacherLeaderboardPeriod = 'day' | 'week' | 'all';

export interface TeacherDirectoryEntry {
    teacherId: string;
    name: string;
    sourceUrl: string | null;
    isVerified: boolean;
    createdBySource: string;
    createdAt: string;
    updatedAt: string;
}

export interface TeacherUserRating {
    teacherId: string;
    tier: TeacherTier;
    tags: string[];
    updatedAt: string;
}

export interface TeacherLeaderboardEntry {
    rank: number;
    teacherId: string;
    name: string;
    isVerified: boolean;
    averageTier: TeacherTier;
    averageValue: number;
    voteCount: number;
    topTags: string[];
    myRating: TeacherUserRating | null;
}

// Демо-сид рейтингов преподавателей заводится только для одного аккаунта,
// заданного через env (например, аккаунт мейнтейнера для превью). По умолчанию
// пусто — сид никому не создаётся.
const SEEDED_USER_ID = process.env.TEACHER_RATINGS_SEED_USER_ID || '';
const MAX_TAGS_PER_RATING = 5;
const MAX_SEARCH_RESULTS = 10;
const TIER_VALUE: Record<TeacherTier, number> = {
    S: 7,
    A: 6,
    B: 5,
    C: 4,
    D: 3,
    E: 2,
    F: 1,
};

const USER_SEED: Array<{ name: string; tier: TeacherTier; personalRank: number; tags: string[] }> = [
    { name: 'Аубакиров Н.М', tier: 'S', personalRank: 1, tags: ['величайший', 'божественный', 'goat', 'легенда'] },
    { name: 'Ярема Т.В', tier: 'S', personalRank: 2, tags: ['безупречный', 'лучший', 'объясняет как людям', 'уважаемый'] },
    { name: 'Рожкова О.О', tier: 'S', personalRank: 3, tags: ['легенда', 'комфортный', 'база', 'сильный'] },
    { name: 'Сиводедова А.В', tier: 'S', personalRank: 4, tags: ['адекватный', 'человечный', 'душевный', 'спаситель сессии'] },

    { name: 'Омаров Ш.Ә', tier: 'A', personalRank: 1, tags: ['очень сильный', 'огонь', 'на опыте', 'хочется ходить'] },
    { name: 'Аманов А.Н', tier: 'A', personalRank: 2, tags: ['сильный', 'справедливый', 'профи', 'уважаемый'] },
    { name: 'Нұрмағанбет Н.Н.Ж', tier: 'A', personalRank: 3, tags: ['адекватный', 'топчик', 'объективный', 'комфортный'] },

    { name: 'Кутуева Л.А', tier: 'B', personalRank: 1, tags: ['хороший', 'нормальный', 'можно жить', 'без сюрпризов'] },
    { name: 'Қыдырғали ұлы Д.', tier: 'B', personalRank: 2, tags: ['терпимо', 'требовательный', 'на любителя', 'средний'] },
    { name: 'Ильясова Б.К', tier: 'B', personalRank: 3, tags: ['нормальный', 'обычный', 'как повезёт', 'нейтральный'] },
    { name: 'Альжанова Г.Б', tier: 'B', personalRank: 4, tags: ['средний', 'без сюрпризов', 'терпимо', 'нормальный'] },
    { name: 'Шебалина О.А', tier: 'B', personalRank: 5, tags: ['сухой', 'обычный', 'на любителя', 'средний'] },
    { name: 'Капжаппарова Д.У', tier: 'B', personalRank: 6, tags: ['нормальный', 'терпимо', 'неплохо', 'можно жить'] },
    { name: 'Бегмагамбетова Э.К', tier: 'B', personalRank: 7, tags: ['спокойный', 'нейтральный', 'без сюрпризов', 'нормальный'] },
    { name: 'Алдаберген І.Е', tier: 'B', personalRank: 8, tags: ['строгий, но норм', 'терпимо', 'обычный', 'как повезёт'] },
    { name: 'Цой Н.К', tier: 'B', personalRank: 9, tags: ['средний', 'на любителя', 'нейтральный', 'без эмоций'] },

    { name: 'Темиргалиев К.А', tier: 'C', personalRank: 1, tags: ['спорный', 'нестабильный', 'странный', 'рандомный'] },
    { name: 'Мурых Е.Л', tier: 'C', personalRank: 2, tags: ['как повезёт', 'душный, но полезный', 'спорный', 'тяжёлый вайб'] },
    { name: 'Әсет Н.Қ', tier: 'C', personalRank: 3, tags: ['нестабильный', 'непредсказуемый', 'своеобразный', 'странный'] },
    { name: 'Королева А.А', tier: 'C', personalRank: 4, tags: ['спорный', 'сухой', 'не для всех', 'как повезёт'] },
    { name: 'Агафонова Л.А', tier: 'C', personalRank: 5, tags: ['сомнительный', 'странный', 'тяжёлый вайб', 'на любителя'] },
    { name: 'Белик Г.А', tier: 'C', personalRank: 6, tags: ['непредсказуемый', 'рандомный', 'спорный', 'терпимо'] },

    { name: 'Рысбеккызы Б.', tier: 'D', personalRank: 1, tags: ['плохой', 'раздражает', 'минус вайб', 'хочется сбежать'] },
    { name: 'Белик М.Н', tier: 'D', personalRank: 2, tags: ['слабое преподавание', 'душнила', 'неприятный', 'walking L'] },
    { name: 'Рахымбаева Г.Ж', tier: 'D', personalRank: 3, tags: ['тяжёлый опыт', 'скучный', 'не объясняет', 'кринж'] },
    { name: 'Байпелова Г.С', tier: 'D', personalRank: 4, tags: ['раздражает', 'хаотичный', 'необъективный', 'жесткач'] },
    { name: 'Жарылғап М.С', tier: 'D', personalRank: 5, tags: ['мутный', 'выносит мозг', 'антивдохновение', 'токсичный'] },
    { name: 'Яворский В.В', tier: 'D', personalRank: 6, tags: ['неприятный', 'скучный', 'ред флаг', 'минус вайб'] },
    { name: 'Шорманбаева Д.Г', tier: 'D', personalRank: 7, tags: ['худший вайб', 'душнила', 'раздражает', 'never again'] },

    { name: 'Кузнецова Ю.А', tier: 'E', personalRank: 1, tags: ['отвратительный', 'демон во плоти', 'мерзейший', 'emotional damage'] },
    { name: 'Кошебаева Г.К', tier: 'E', personalRank: 2, tags: ['токсичный', 'ужасный', 'мрак', 'red flag'] },
    { name: 'Клюева Е.Г', tier: 'E', personalRank: 3, tags: ['худший', 'ломает психику', 'душнила', 'nightmare mode'] },
    { name: 'Мустафина Л.М', tier: 'E', personalRank: 4, tags: ['мерзейший', 'never again', 'walking L', 'anti-vibe'] },
    { name: 'Журов В.В', tier: 'E', personalRank: 5, tags: ['сущий демон', 'final boss', '💀', 'демон во плоти'] },
];

export function normalizeWhitespace(value: string): string {
    return value.trim().replace(/\s+/g, ' ');
}

export function normalizeTeacherName(value: string): string {
    return normalizeWhitespace(value)
        .replace(/[’']/g, "'")
        .replace(/\s*\.\s*/g, '.')
        .toLowerCase()
        .replace(/\s+/g, ' ');
}

export function normalizeTag(value: string): string | null {
    const normalized = normalizeWhitespace(value).slice(0, 40);
    return normalized ? normalized : null;
}

export function normalizeTags(tags: unknown): string[] {
    if (!Array.isArray(tags)) return [];
    const seen = new Set<string>();
    const result: string[] = [];
    for (const entry of tags) {
        if (typeof entry !== 'string') continue;
        const normalized = normalizeTag(entry);
        if (!normalized) continue;
        // Phase 1 anti-abuse: silently drop tags containing profanity.
        if (containsProfanity(normalized)) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
        if (result.length >= MAX_TAGS_PER_RATING) break;
    }
    return result;
}

export function isTeacherTier(value: unknown): value is TeacherTier {
    return value === 'S' || value === 'A' || value === 'B' || value === 'C' || value === 'D' || value === 'E' || value === 'F';
}

export function scoreTeacherName(name: string, query: string): number {
    const normalizedName = normalizeTeacherName(name);
    const normalizedQuery = normalizeTeacherName(query);
    if (!normalizedQuery) return 0;
    if (normalizedName === normalizedQuery) return 1000;
    if (normalizedName.startsWith(normalizedQuery)) return 800;
    if (normalizedName.includes(normalizedQuery)) return 600;

    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    let score = 0;
    for (const token of queryTokens) {
        if (normalizedName.includes(token)) {
            score += 120;
        }
    }
    return score;
}

export function valueToTier(value: number): TeacherTier {
    if (value >= 6.5) return 'S';
    if (value >= 5.5) return 'A';
    if (value >= 4.5) return 'B';
    if (value >= 3.5) return 'C';
    if (value >= 2.5) return 'D';
    if (value >= 1.5) return 'E';
    return 'F';
}

async function ensureTeacherDirectoryEntryInClient(
    client: PoolClient,
    params: { name: string; createdBy: string; source?: string }
): Promise<TeacherDirectoryEntry> {
    const canonicalName = normalizeWhitespace(params.name);
    const normalizedName = normalizeTeacherName(canonicalName);
    const existing = await client.query<{
        id: string;
        canonical_name: string;
        source_url: string | null;
        is_verified: boolean;
        created_by_source: string;
        created_at: string;
        updated_at: string;
    }>(
        `
            select id, canonical_name, source_url, is_verified, created_by_source,
                   created_at::text, updated_at::text
            from app_teacher_directory
            where normalized_name = $1
            limit 1
        `,
        [normalizedName],
    );

    if (existing.rows[0]) {
        const row = existing.rows[0];
        return {
            teacherId: row.id,
            name: row.canonical_name,
            sourceUrl: row.source_url,
            isVerified: row.is_verified,
            createdBySource: row.created_by_source,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    const matched = findTeacherInDb(canonicalName);
    const isVerified = Boolean(matched);
    const createdBySource = params.source || 'user';
    const now = new Date().toISOString();
    const id = randomUUID();
    await client.query(
        `
            insert into app_teacher_directory (
                id, canonical_name, normalized_name, created_by, source_url,
                is_verified, created_by_source, created_at, updated_at
            ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        `,
        [
            id,
            canonicalName,
            normalizedName,
            params.createdBy,
            matched?.url || null,
            isVerified,
            createdBySource,
            now,
        ],
    );

    return {
        teacherId: id,
        name: canonicalName,
        sourceUrl: matched?.url || null,
        isVerified,
        createdBySource,
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Public wrapper around the directory upsert — used by background jobs like the
 * schedule auto-seeder (S8). Wraps its own pg client so callers don't need one.
 * Returns null if storage is unavailable (callers should treat as non-blocking).
 */
export async function ensureTeacherDirectoryEntry(
    name: string,
    options: { createdBy: string; source: string; verified?: boolean }
): Promise<TeacherDirectoryEntry | null> {
    return withSupabasePostgres(async (client) => {
        const entry = await ensureTeacherDirectoryEntryInClient(client, {
            name,
            createdBy: options.createdBy,
            source: options.source,
        });
        // For schedule-seeded entries that matched the staff JSON, ensure
        // is_verified stays true even if a manual entry existed earlier.
        if (options.verified && !entry.isVerified) {
            await client.query(
                `update app_teacher_directory set is_verified = true where id = $1`,
                [entry.teacherId],
            );
            return { ...entry, isVerified: true };
        }
        return entry;
    });
}

async function ensureSeedForUser(client: PoolClient, userId: string): Promise<void> {
    if (!SEEDED_USER_ID || userId !== SEEDED_USER_ID) return;

    const existingCount = await client.query<{ count: string }>(
        `select count(*)::text as count from app_teacher_ratings where user_id = $1`,
        [userId],
    );

    if (Number(existingCount.rows[0]?.count || 0) > 0) {
        return;
    }

    for (const entry of USER_SEED) {
        const teacher = await ensureTeacherDirectoryEntryInClient(client, { name: entry.name, createdBy: userId });
        const now = new Date().toISOString();
        await client.query(
            `
                insert into app_teacher_ratings (
                    id, teacher_id, user_id, tier, personal_rank, tags_json, created_at, updated_at
                ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
                on conflict (teacher_id, user_id) do nothing
            `,
            [randomUUID(), teacher.teacherId, userId, entry.tier, entry.personalRank, JSON.stringify(entry.tags), now],
        );
    }
}

interface RatingRow {
    teacher_id: string;
    teacher_name: string;
    source_url: string | null;
    is_verified: boolean;
    user_id: string;
    tier: TeacherTier;
    personal_rank: number | null;
    tags_json: unknown;
    updated_at: string;
}

async function getRatingsByPeriod(
    client: PoolClient,
    period: TeacherLeaderboardPeriod,
): Promise<RatingRow[]> {
    const params: unknown[] = [];
    let whereSql = '';
    if (period === 'day') {
        params.push(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
        whereSql = `where r.updated_at >= $1`;
    } else if (period === 'week') {
        params.push(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
        whereSql = `where r.updated_at >= $1`;
    }

    const result = await client.query<RatingRow>(
        `
            select
                d.id as teacher_id,
                d.canonical_name as teacher_name,
                d.source_url,
                d.is_verified,
                r.user_id,
                r.tier,
                r.personal_rank,
                r.tags_json,
                r.updated_at::text
            from app_teacher_directory d
            join app_teacher_ratings r on r.teacher_id = d.id
            ${whereSql}
        `,
        params,
    );

    return result.rows;
}

export async function getTeacherLeaderboard(
    userId: string,
    period: TeacherLeaderboardPeriod,
): Promise<{
    period: TeacherLeaderboardPeriod;
    leaderboard: TeacherLeaderboardEntry[];
    myRatings: TeacherUserRating[];
    totalTeachers: number;
    totalVotes: number;
    updatedAt: string;
}> {
    const result = await withSupabasePostgres(async (client) => {
        await ensureSeedForUser(client, userId);
        const rows = await getRatingsByPeriod(client, period);

        const grouped = new Map<string, {
            teacherId: string;
            name: string;
            isVerified: boolean;
            scoreSum: number;
            valueSum: number;
            voteCount: number;
            tagCounts: Map<string, number>;
            myRating: TeacherUserRating | null;
        }>();

        const myRatings: TeacherUserRating[] = [];

        for (const row of rows) {
            const tierValue = TIER_VALUE[row.tier];
            const personalRank = Number.isFinite(row.personal_rank as number) && row.personal_rank !== null
                ? Math.max(1, Number(row.personal_rank))
                : 50;
            const weightedScore = tierValue * 100 - Math.min(personalRank, 99);
            const tags = normalizeTags(row.tags_json);
            const existing = grouped.get(row.teacher_id) || {
                teacherId: row.teacher_id,
                name: row.teacher_name,
                isVerified: row.is_verified,
                scoreSum: 0,
                valueSum: 0,
                voteCount: 0,
                tagCounts: new Map<string, number>(),
                myRating: null,
            };

            existing.scoreSum += weightedScore;
            existing.valueSum += tierValue;
            existing.voteCount += 1;
            for (const tag of tags) {
                existing.tagCounts.set(tag, (existing.tagCounts.get(tag) || 0) + 1);
            }

            if (row.user_id === userId) {
                const myRating: TeacherUserRating = {
                    teacherId: row.teacher_id,
                    tier: row.tier,
                    tags,
                    updatedAt: row.updated_at,
                };
                existing.myRating = myRating;
                myRatings.push(myRating);
            }

            grouped.set(row.teacher_id, existing);
        }

        const leaderboard = Array.from(grouped.values())
            .sort((a, b) => {
                const scoreDiff = (b.scoreSum / Math.max(1, b.voteCount)) - (a.scoreSum / Math.max(1, a.voteCount));
                if (Math.abs(scoreDiff) > 0.0001) return scoreDiff;
                if (b.voteCount !== a.voteCount) return b.voteCount - a.voteCount;
                return a.name.localeCompare(b.name, 'ru');
            })
            .map((entry, index) => {
                const averageValue = entry.valueSum / Math.max(1, entry.voteCount);
                const topTags = Array.from(entry.tagCounts.entries())
                    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru'))
                    .slice(0, 4)
                    .map(([tag]) => tag);

                return {
                    rank: index + 1,
                    teacherId: entry.teacherId,
                    name: entry.name,
                    isVerified: entry.isVerified,
                    averageTier: valueToTier(averageValue),
                    averageValue,
                    voteCount: entry.voteCount,
                    topTags,
                    myRating: entry.myRating,
                };
            });

        return {
            period,
            leaderboard,
            myRatings: myRatings.sort((a, b) => a.teacherId.localeCompare(b.teacherId)),
            totalTeachers: leaderboard.length,
            totalVotes: rows.length,
            updatedAt: new Date().toISOString(),
        };
    });

    if (!result) {
        throw new Error('teacher leaderboard storage unavailable');
    }
    return result;
}

export async function searchTeachers(
    userId: string,
    query: string,
): Promise<Array<TeacherDirectoryEntry & { myRating: TeacherUserRating | null }>> {
    const result = await withSupabasePostgres(async (client) => {
        await ensureSeedForUser(client, userId);
        const trimmed = normalizeWhitespace(query);
        if (!trimmed) return [];

        const rows = await client.query<{
            id: string;
            canonical_name: string;
            source_url: string | null;
            is_verified: boolean;
            created_by_source: string;
            created_at: string;
            updated_at: string;
            tier: TeacherTier | null;
            tags_json: unknown;
            rating_updated_at: string | null;
        }>(
            `
                select
                    d.id,
                    d.canonical_name,
                    d.source_url,
                    d.is_verified,
                    d.created_by_source,
                    d.created_at::text,
                    d.updated_at::text,
                    r.tier,
                    r.tags_json,
                    r.updated_at::text as rating_updated_at
                from app_teacher_directory d
                left join app_teacher_ratings r
                    on r.teacher_id = d.id and r.user_id = $1
            `,
            [userId],
        );

        return rows.rows
            .map((row) => ({
                teacherId: row.id,
                name: row.canonical_name,
                sourceUrl: row.source_url,
                isVerified: row.is_verified,
                createdBySource: row.created_by_source,
                createdAt: row.created_at,
                updatedAt: row.updated_at,
                myRating: row.tier ? {
                    teacherId: row.id,
                    tier: row.tier,
                    tags: normalizeTags(row.tags_json),
                    updatedAt: row.rating_updated_at || row.updated_at,
                } : null,
                score: scoreTeacherName(row.canonical_name, trimmed),
            }))
            .filter((row) => row.score > 0)
            .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'ru'))
            .slice(0, MAX_SEARCH_RESULTS)
            .map(({ score: _score, ...entry }) => entry);
    });

    if (!result) {
        throw new Error('teacher search storage unavailable');
    }
    return result;
}

export async function createTeacher(
    userId: string,
    name: string,
    options?: { source?: string; forceVerified?: boolean },
): Promise<TeacherDirectoryEntry> {
    const result = await withSupabasePostgres(async (client) => {
        await ensureSeedForUser(client, userId);
        const entry = await ensureTeacherDirectoryEntryInClient(client, {
            name,
            createdBy: userId,
            source: options?.source,
        });
        // When fuzzy-matched to the user's own schedule, lift verification even
        // if the staff JSON didn't recognize the literal text (typo etc.).
        if (options?.forceVerified && !entry.isVerified) {
            await client.query(
                `update app_teacher_directory set is_verified = true where id = $1`,
                [entry.teacherId],
            );
            return { ...entry, isVerified: true };
        }
        return entry;
    });

    if (!result) {
        throw new Error('teacher create storage unavailable');
    }
    return result;
}

/**
 * Reads the user's cached schedule (if any) and returns a deduplicated list of
 * teacher display names found across every day/slot/lesson. Used by the soft
 * cross-check on POST /teacher/ratings/teachers to flag inputs that don't
 * match the user's own schedule. Returns [] if the user has no cache or the
 * cache shape is unexpected — callers should treat as non-blocking.
 */
export async function getUserScheduleTeachers(userId: string): Promise<string[]> {
    if (!userId) return [];
    const result = await withSupabasePostgres(async (client) => {
        const row = await client.query<{ data_json: unknown }>(
            `select data_json from app_schedule_cache where user_id = $1 limit 1`,
            [userId],
        );
        if (!row.rows[0]) return [];
        const data = row.rows[0].data_json as { days?: Array<{ lessons?: Array<Array<{ teacher?: string | null }>> }> } | null;
        if (!data || !Array.isArray(data.days)) return [];

        const seen = new Set<string>();
        for (const day of data.days) {
            const slots = Array.isArray(day?.lessons) ? day.lessons : [];
            for (const slot of slots) {
                const lessons = Array.isArray(slot) ? slot : [];
                for (const lesson of lessons) {
                    const teacher = typeof lesson?.teacher === 'string' ? lesson.teacher.trim() : '';
                    if (teacher) seen.add(teacher);
                }
            }
        }
        return Array.from(seen);
    });

    return result ?? [];
}

export async function saveTeacherRating(
    userId: string,
    params: {
        teacherId: string;
        tier: TeacherTier;
        tags: string[];
    },
): Promise<TeacherUserRating> {
    if (!isTeacherTier(params.tier)) {
        throw new Error('invalid teacher tier');
    }

    const tags = normalizeTags(params.tags);

    const result = await withSupabasePostgres(async (client) => {
        await ensureSeedForUser(client, userId);
        const teacherCheck = await client.query<{ id: string }>(
            `select id from app_teacher_directory where id = $1 limit 1`,
            [params.teacherId],
        );
        if (!teacherCheck.rows[0]) {
            throw new Error('teacher not found');
        }

        const now = new Date().toISOString();
        const existingRank = await client.query<{ personal_rank: number | null }>(
            `select personal_rank from app_teacher_ratings where teacher_id = $1 and user_id = $2 limit 1`,
            [params.teacherId, userId],
        );
        const nextRank = existingRank.rows[0]?.personal_rank ?? null;

        await client.query(
            `
                insert into app_teacher_ratings (
                    id, teacher_id, user_id, tier, personal_rank, tags_json, created_at, updated_at
                ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $7)
                on conflict (teacher_id, user_id)
                do update set
                    tier = excluded.tier,
                    tags_json = excluded.tags_json,
                    updated_at = excluded.updated_at
            `,
            [randomUUID(), params.teacherId, userId, params.tier, nextRank, JSON.stringify(tags), now],
        );

        return {
            teacherId: params.teacherId,
            tier: params.tier,
            tags,
            updatedAt: now,
        };
    });

    if (!result) {
        throw new Error('teacher rating storage unavailable');
    }
    return result;
}
