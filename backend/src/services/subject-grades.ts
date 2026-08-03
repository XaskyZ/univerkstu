/**
 * Subject grade leaderboard data layer.
 *
 * Persists per-subject numeric grades across ALL users (table
 * `app_subject_grades`) so we can rank "who scored best in subject X" across
 * cohorts/semesters — something the per-user grade caches can't answer. Rows
 * are populated best-effort when a user's Platonus grades / Univer transcript
 * are fetched (see services/platonus-grades.ts + services/profile.ts).
 *
 * Privacy: the leaderboard is opt-OUT (visible by default). Users who set
 * `gradesLeaderboardOptOut` are excluded entirely from query results.
 */
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';

async function requireSubjectGradesPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const wrapped = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (wrapped === null) {
        throw new Error(`[SubjectGrades] Supabase/Postgres is unavailable during ${operation}`);
    }
    return wrapped.value;
}

const PLATONUS_CACHE_BACKFILL_CACHE_LIMIT = 5_000;

/**
 * Canonical key for grouping the same subject across users/cohorts. Lowercased,
 * parenthetical codes/teachers stripped, punctuation removed, whitespace
 * collapsed. Unicode-aware so Cyrillic names normalize correctly.
 */
export function normalizeSubjectKey(name: unknown): string {
    if (typeof name !== 'string') return '';
    return name
        .toLowerCase()
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Parse a raw grade value into a 0–100 number, or null when not a real score. */
export function parseScore(value: unknown): number | null {
    let num: number;
    if (typeof value === 'number') {
        num = value;
    } else if (typeof value === 'string') {
        const match = value.replace(',', '.').match(/-?\d+(\.\d+)?/);
        if (!match) return null;
        num = Number.parseFloat(match[0]);
    } else {
        return null;
    }
    if (!Number.isFinite(num) || num < 0 || num > 100) return null;
    return Math.round(num * 100) / 100;
}

export function selectLeaderboardScore(total: unknown, rating: unknown): unknown {
    const totalScore = parseScore(total);
    if (totalScore !== null && totalScore > 0) return totalScore;

    const ratingScore = parseScore(rating);
    if (ratingScore !== null && ratingScore > 0) return ratingScore;

    return totalScore ?? ratingScore ?? total;
}

function nameInitial(part: string): string {
    const [first] = Array.from(part.trim());
    return first ? `${first.toUpperCase()}.` : '';
}

export function formatPublicLeaderboardName(fullName: unknown): string {
    if (typeof fullName !== 'string') return '';
    const normalized = fullName.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';

    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length < 2) return normalized;
    if (parts.some((part) => part.endsWith('.'))) return normalized;

    const [familyName, firstName, patronymic] = parts;
    const initials = [nameInitial(firstName), patronymic ? nameInitial(patronymic) : '']
        .filter(Boolean)
        .join(' ');

    return initials ? `${familyName} ${initials}` : normalized;
}

/** Legacy anonymous handle helper; subject leaderboard display no longer uses it. */
export function pseudonymFor(userId: string, displayName?: string | null): string {
    const explicit = (displayName || '').trim();
    if (explicit) return explicit;
    let hash = 5381;
    for (let i = 0; i < userId.length; i += 1) {
        hash = ((hash << 5) + hash + userId.charCodeAt(i)) | 0;
    }
    // Low-order base36 digits (36^4) keep entropy where small id differences
    // manifest, so near-identical ids don't collide to the same handle.
    const token = (Math.abs(hash) % 1_679_616).toString(36).toUpperCase().padStart(4, '0');
    return `Студент-${token}`;
}

export interface LeaderboardContacts {
    telegram?: string;
    instagram?: string;
}

function normalizeHandle(value: unknown, hostPattern: RegExp): string {
    if (typeof value !== 'string') return '';
    let normalized = value.trim();
    if (!normalized) return '';
    normalized = normalized
        .replace(/^https?:\/\//i, '')
        .replace(/^www\./i, '')
        .replace(hostPattern, '')
        .replace(/^@+/, '')
        .split(/[/?#]/)[0]
        .trim();
    return normalized.replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 40);
}

export function normalizeLeaderboardContacts(raw: unknown): LeaderboardContacts | null {
    if (!raw || typeof raw !== 'object') return null;
    const candidate = raw as { telegram?: unknown; instagram?: unknown };
    const telegram = normalizeHandle(candidate.telegram, /^(?:t\.me|telegram\.me|telegram\.dog)\//i);
    const instagram = normalizeHandle(candidate.instagram, /^instagram\.com\//i);
    const contacts: LeaderboardContacts = {};
    if (telegram) contacts.telegram = telegram;
    if (instagram) contacts.instagram = instagram;
    return contacts.telegram || contacts.instagram ? contacts : null;
}

/** Parse a transcript term label like "Семестр 2024-1" or "2024-2" → {year, semester}. */
export function parseTermLabel(label: unknown): { year: number; semester: number } | null {
    if (typeof label !== 'string') return null;
    const match = label.match(/(\d{4})\D+(\d)/);
    if (!match) return null;
    const year = Number.parseInt(match[1], 10);
    const semester = Number.parseInt(match[2], 10);
    if (!Number.isInteger(year) || semester < 1 || semester > 4) return null;
    return { year, semester };
}

export interface SubjectGradeInput {
    name: string;
    year: number;
    semester: number;
    source: 'platonus' | 'univer';
    /** Raw grade value (string/number); parsed via parseScore. */
    score: unknown;
    gpa?: number | null;
    letter?: string | null;
}

type SubjectGradeRow = {
    userId: string;
    key: string;
    label: string;
    year: number;
    semester: number;
    source: string;
    score: number;
    gpa: number | null;
    letter: string | null;
};

function buildSubjectGradeRows(userId: string, inputs: SubjectGradeInput[]): SubjectGradeRow[] {
    const trimmedUser = (userId || '').trim();
    if (!trimmedUser || inputs.length === 0) return [];

    const byKey = new Map<string, SubjectGradeRow>();
    for (const input of inputs) {
        const key = normalizeSubjectKey(input.name);
        const score = parseScore(input.score);
        if (!key || score === null) continue;
        if (!Number.isInteger(input.year) || !Number.isInteger(input.semester)) continue;
        const source = input.source === 'univer' ? 'univer' : 'platonus';
        const mapKey = `${trimmedUser}|${key}|${input.year}|${input.semester}|${source}`;
        const existing = byKey.get(mapKey);
        if (existing && existing.score >= score) continue;
        byKey.set(mapKey, {
            userId: trimmedUser,
            key,
            label: (input.name || '').trim().slice(0, 200) || key,
            year: input.year,
            semester: input.semester,
            source,
            score,
            gpa: typeof input.gpa === 'number' && Number.isFinite(input.gpa) ? input.gpa : null,
            letter: (input.letter || '').trim().slice(0, 8) || null,
        });
    }
    return Array.from(byKey.values());
}

async function upsertSubjectGradeRows(client: PoolClient, rows: SubjectGradeRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    await client.query(
        `
            insert into app_subject_grades
                (user_id, subject_key, subject_label, year, semester, source, score, gpa, letter, updated_at)
            select u, k, l, y, s, src, sc, g, lt, now()
            from unnest(
                $1::text[], $2::text[], $3::text[], $4::int[], $5::int[], $6::text[],
                $7::numeric[], $8::numeric[], $9::text[]
            ) as t(u, k, l, y, s, src, sc, g, lt)
            on conflict (user_id, subject_key, year, semester, source) do update
            set subject_label = excluded.subject_label,
                score = excluded.score,
                gpa = excluded.gpa,
                letter = excluded.letter,
                updated_at = now()
        `,
        [
            rows.map((r) => r.userId),
            rows.map((r) => r.key),
            rows.map((r) => r.label),
            rows.map((r) => r.year),
            rows.map((r) => r.semester),
            rows.map((r) => r.source),
            rows.map((r) => r.score),
            rows.map((r) => r.gpa),
            rows.map((r) => r.letter),
        ],
    );
    return rows.length;
}

/**
 * Upsert a user's subject grades (best-effort, single batched query). Only rows
 * with a normalizable subject + a real numeric score are stored.
 */
export async function recordUserSubjectGrades(userId: string, inputs: SubjectGradeInput[]): Promise<number> {
    const rows = buildSubjectGradeRows(userId, inputs);
    if (rows.length === 0) return 0;

    await requireSubjectGradesPostgres('recordUserSubjectGrades', async (client) => {
        return upsertSubjectGradeRows(client, rows);
    });

    return rows.length;
}

type PlatonusCacheBackfillRow = {
    user_id: string;
    year: number;
    semester: number;
    data_json: { subjects?: Array<{ name?: unknown; total?: unknown; rating?: unknown }> };
};

async function backfillSubjectGradesFromPlatonusCache(client: PoolClient): Promise<number> {
    const result = await client.query<PlatonusCacheBackfillRow>(
        `
            select trim(c.user_id) as user_id, c.year, c.semester, c.data_json
            from app_platonus_grades_cache c
            where jsonb_typeof(c.data_json->'subjects') = 'array'
              and jsonb_array_length(c.data_json->'subjects') > 0
              and not exists (
                  select 1 from app_subject_grades g
                  where g.user_id = trim(c.user_id)
                    and g.year = c.year
                    and g.semester = c.semester
                    and g.source = 'platonus'
              )
            order by c.cached_at desc
            limit $1
        `,
        [PLATONUS_CACHE_BACKFILL_CACHE_LIMIT],
    );
    const rows: SubjectGradeRow[] = [];
    for (const cache of result.rows) {
        const subjects = Array.isArray(cache.data_json?.subjects) ? cache.data_json.subjects : [];
        rows.push(...buildSubjectGradeRows(
            cache.user_id,
            subjects.map((subject) => ({
                name: typeof subject.name === 'string' ? subject.name : '',
                year: cache.year,
                semester: cache.semester,
                source: 'platonus' as const,
                score: selectLeaderboardScore(subject.total, subject.rating),
            })),
        ));
    }
    return upsertSubjectGradeRows(client, rows);
}

export interface LeaderboardSubject {
    key: string;
    label: string;
    learners: number;
}

/** Subjects that have at least one recorded numeric grade, busiest first. */
export async function listLeaderboardSubjects(): Promise<LeaderboardSubject[]> {
    return requireSubjectGradesPostgres('listLeaderboardSubjects', async (client) => {
        await backfillSubjectGradesFromPlatonusCache(client);
        const result = await client.query<{ subject_key: string; label: string; learners: number }>(
            `
                select subject_key, max(subject_label) as label, count(distinct user_id)::int as learners
                from app_subject_grades
                where score is not null and score > 0
                group by subject_key
                order by learners desc, label asc
                limit 300
            `,
        );
        return result.rows.map((r) => ({ key: r.subject_key, label: r.label, learners: r.learners }));
    });
}

export interface LeaderboardEntry {
    rank: number;
    displayName: string;
    /** Target user id — used only to build the DM contact link, never displayed. */
    userId: string;
    isCurrentUser: boolean;
    score: number;
    gpa: number | null;
    letter: string | null;
    year: number;
    semester: number;
    contacts: LeaderboardContacts | null;
}

export interface SubjectLeaderboard {
    subjectKey: string;
    subjectLabel: string | null;
    entries: LeaderboardEntry[];
    viewerRank: number | null;
    totalRanked: number;
}

type LeaderboardRow = {
    user_id: string;
    subject_label: string;
    score: number;
    gpa: number | null;
    letter: string | null;
    year: number;
    semester: number;
    leaderboard_display_name: string | null;
    snapshot_full_name: string | null;
    contacts_json: unknown;
};

/**
 * Ranked best-score-per-user for a subject, opted-out users excluded. Returns
 * the top `limit` plus the viewer's own rank.
 */
export async function listSubjectLeaderboard(
    subjectKey: string,
    viewerUserId: string,
    limit = 50,
): Promise<SubjectLeaderboard> {
    const key = (subjectKey || '').trim();
    const safeLimit = Math.max(1, Math.min(limit, 500));
    if (!key) {
        return { subjectKey: key, subjectLabel: null, entries: [], viewerRank: null, totalRanked: 0 };
    }

    const rows = await requireSubjectGradesPostgres('listSubjectLeaderboard', async (client) => {
        await backfillSubjectGradesFromPlatonusCache(client);
        const result = await client.query<LeaderboardRow>(
            `
                with best as (
                    select distinct on (user_id)
                        user_id, subject_label, score::float8 as score,
                        gpa::float8 as gpa, letter, year, semester
                    from app_subject_grades
                    where subject_key = $1 and score is not null and score > 0
                    order by user_id, score desc, gpa desc nulls last, year desc, semester desc
                )
                select
                    b.user_id, b.subject_label, b.score, b.gpa, b.letter, b.year, b.semester,
                    nullif(u.settings_json->>'leaderboardDisplayName', '') as leaderboard_display_name,
                    coalesce(
                        nullif(s.snapshot_json->>'fullName', ''),
                        nullif(s.snapshot_json#>>'{profileSummary,fullName}', '')
                    ) as snapshot_full_name,
                    u.settings_json->'leaderboardContacts' as contacts_json
                from best b
                left join app_users u on u.user_id = b.user_id
                left join app_admin_user_snapshots s on s.user_id = b.user_id
                where coalesce(u.settings_json->>'gradesLeaderboardOptOut', 'false') <> 'true'
                order by b.score desc, b.gpa desc nulls last
                limit 500
            `,
            [key],
        );
        return result.rows;
    });

    const ranked = rows.map((row, index) => ({
        rank: index + 1,
        displayName: (row.leaderboard_display_name || '').trim()
            || formatPublicLeaderboardName(row.snapshot_full_name)
            || row.user_id,
        userId: row.user_id,
        isCurrentUser: row.user_id === viewerUserId,
        score: row.score,
        gpa: row.gpa,
        letter: row.letter,
        year: row.year,
        semester: row.semester,
        contacts: normalizeLeaderboardContacts(row.contacts_json),
    }));

    const viewer = ranked.find((entry) => entry.isCurrentUser);
    const subjectLabel = rows[0]?.subject_label ?? null;

    return {
        subjectKey: key,
        subjectLabel,
        entries: ranked.slice(0, safeLimit),
        viewerRank: viewer ? viewer.rank : null,
        totalRanked: ranked.length,
    };
}
