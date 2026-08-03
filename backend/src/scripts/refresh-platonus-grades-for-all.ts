import dotenv from 'dotenv';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { getPlatonusGradesCached } from '../services/platonus-grades.js';

dotenv.config({ path: '../.env' });
dotenv.config();

type Term = {
    year: number;
    semester: number;
};

type SessionRow = {
    user_id: string;
};

type CacheTermRow = {
    user_id: string;
    year: number;
    semester: number;
};

type RefreshResult = {
    userId: string;
    year: number;
    semester: number;
    success: boolean;
    subjectCount: number;
    error: string | null;
};

type UserJob = {
    userId: string;
    terms: Term[];
};

const CONCURRENCY = Math.max(1, Number(process.env.PLATONUS_REFRESH_CONCURRENCY || 2));
const DEFAULT_TERMS: Term[] = [
    { year: 2026, semester: 1 },
    { year: 2025, semester: 2 },
];

function parseTerms(value: string | undefined): Term[] {
    if (!value) return [];
    const terms: Term[] = [];
    for (const part of value.split(',')) {
        const [yearRaw, semesterRaw] = part.trim().split(/[:-]/);
        const year = Number.parseInt(yearRaw || '', 10);
        const semester = Number.parseInt(semesterRaw || '', 10);
        if (Number.isInteger(year) && (semester === 1 || semester === 2)) {
            terms.push({ year, semester });
        }
    }
    return terms;
}

function termKey(term: Term): string {
    return `${term.year}:${term.semester}`;
}

async function requirePostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Platonus Refresh All] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

async function loadUsersWithPlatonusSessions(): Promise<string[]> {
    return requirePostgres('load sessions', async (client) => {
        const result = await client.query<SessionRow>(
            `
                select distinct trim(user_id) as user_id
                from app_platonus_sessions
                where nullif(trim(user_id), '') is not null
                order by trim(user_id) asc
            `,
        );
        return result.rows.map((row) => row.user_id);
    });
}

async function loadCachedTermsByUser(): Promise<Map<string, Term[]>> {
    return requirePostgres('load cached terms', async (client) => {
        const result = await client.query<CacheTermRow>(
            `
                select distinct trim(user_id) as user_id, year, semester
                from app_platonus_grades_cache
                where nullif(trim(user_id), '') is not null
                order by trim(user_id) asc, year desc, semester desc
            `,
        );
        const byUser = new Map<string, Term[]>();
        for (const row of result.rows) {
            const list = byUser.get(row.user_id) || [];
            list.push({ year: row.year, semester: row.semester });
            byUser.set(row.user_id, list);
        }
        return byUser;
    });
}

function resolveTermsForUser(userId: string, cachedTerms: Map<string, Term[]>, requestedTerms: Term[]): Term[] {
    const byKey = new Map<string, Term>();
    for (const term of requestedTerms) {
        byKey.set(termKey(term), term);
    }
    for (const term of cachedTerms.get(userId) || []) {
        byKey.set(termKey(term), term);
    }
    return Array.from(byKey.values()).sort((left, right) => {
        if (left.year !== right.year) return right.year - left.year;
        return right.semester - left.semester;
    });
}

async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    async function consume(): Promise<void> {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    }

    await Promise.all(Array.from({ length: limit }, () => consume()));
    return results;
}

async function refreshUserTerm(userId: string, term: Term, index: number, total: number): Promise<RefreshResult> {
    console.log(`[${index + 1}/${total}] Refreshing ${userId} ${term.year}/${term.semester}`);
    try {
        const result = await getPlatonusGradesCached(userId, term.year, term.semester, true);
        if (!result.data) {
            const error = result.errorCode || result.error || 'unknown_error';
            console.warn(`[${index + 1}/${total}] Failed ${userId} ${term.year}/${term.semester}: ${error}`);
            return {
                userId,
                year: term.year,
                semester: term.semester,
                success: false,
                subjectCount: 0,
                error,
            };
        }

        const subjectCount = Array.isArray(result.data.subjects) ? result.data.subjects.length : 0;
        console.log(`[${index + 1}/${total}] Updated ${userId} ${term.year}/${term.semester}: ${subjectCount} subjects`);
        return {
            userId,
            year: term.year,
            semester: term.semester,
            success: true,
            subjectCount,
            error: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[${index + 1}/${total}] Exception ${userId} ${term.year}/${term.semester}: ${message}`);
        return {
            userId,
            year: term.year,
            semester: term.semester,
            success: false,
            subjectCount: 0,
            error: message,
        };
    }
}

async function main(): Promise<void> {
    const requestedTerms = parseTerms(process.env.PLATONUS_REFRESH_TERMS);
    const baseTerms = requestedTerms.length > 0 ? requestedTerms : DEFAULT_TERMS;
    const [users, cachedTerms] = await Promise.all([
        loadUsersWithPlatonusSessions(),
        loadCachedTermsByUser(),
    ]);

    const jobs: UserJob[] = users.map((userId) => ({
        userId,
        terms: resolveTermsForUser(userId, cachedTerms, baseTerms),
    }));
    const totalTermJobs = jobs.reduce((sum, job) => sum + job.terms.length, 0);

    console.log(`Starting Platonus grades refresh for ${users.length} users, ${totalTermJobs} user/term jobs, concurrency=${CONCURRENCY}`);
    console.log(`Base terms: ${baseTerms.map(termKey).join(', ')}`);

    let completedTermJobs = 0;
    const nestedResults = await runWithConcurrency(
        jobs,
        CONCURRENCY,
        async (job) => {
            const userResults: RefreshResult[] = [];
            for (const term of job.terms) {
                const index = completedTermJobs;
                completedTermJobs += 1;
                userResults.push(await refreshUserTerm(job.userId, term, index, totalTermJobs));
            }
            return userResults;
        },
    );
    const results = nestedResults.flat();

    const failed = results.filter((item) => !item.success);
    const summary = {
        users: users.length,
        jobs: jobs.length,
        succeeded: results.length - failed.length,
        failed: failed.length,
        withSubjects: results.filter((item) => item.success && item.subjectCount > 0).length,
        emptySubjects: results.filter((item) => item.success && item.subjectCount === 0).length,
        failures: failed.slice(0, 50).map((item) => ({
            userId: item.userId,
            year: item.year,
            semester: item.semester,
            error: item.error,
        })),
    };

    console.log(JSON.stringify(summary, null, 2));
}

await main();
