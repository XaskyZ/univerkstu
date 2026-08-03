import 'dotenv/config';
import { getExams } from '../services/exams.js';
import { getAllUsers } from '../services/users.js';

type BackfillResult = {
    userId: string;
    success: boolean;
    cached: boolean;
    stale: boolean;
    examsCount: number;
    error: string | null;
};

const CONCURRENCY = Number(process.env.EXAMS_BACKFILL_CONCURRENCY || 2);

async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;

    async function consume() {
        while (true) {
            const index = cursor;
            cursor += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await worker(items[index], index);
        }
    }

    const workers = Array.from({ length: Math.max(1, limit) }, () => consume());
    await Promise.all(workers);
    return results;
}

async function refreshUserExams(userId: string, index: number, total: number): Promise<BackfillResult> {
    console.log(`[${index + 1}/${total}] Refreshing exams for ${userId}`);

    try {
        const { exams, cached, stale, error } = await getExams(userId, true);
        const examsCount = exams?.exams?.length || 0;

        if (error || !exams) {
            console.warn(`[${index + 1}/${total}] Failed for ${userId}: ${error || 'unknown_error'}`);
            return {
                userId,
                success: false,
                cached,
                stale: Boolean(stale),
                examsCount,
                error: error || 'unknown_error',
            };
        }

        console.log(`[${index + 1}/${total}] Updated ${userId}: ${examsCount} exams`);
        return {
            userId,
            success: true,
            cached,
            stale: Boolean(stale),
            examsCount,
            error: null,
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[${index + 1}/${total}] Exception for ${userId}: ${message}`);
        return {
            userId,
            success: false,
            cached: false,
            stale: false,
            examsCount: 0,
            error: message,
        };
    }
}

async function main() {
    const users = await getAllUsers();
    const total = users.length;

    console.log(`Starting one-time exams backfill for ${total} users with concurrency=${CONCURRENCY}`);

    const results = await runWithConcurrency(
        users,
        CONCURRENCY,
        (user, index) => refreshUserExams(user.userId, index, total)
    );

    const summary = {
        totalUsers: total,
        succeeded: results.filter((item) => item.success).length,
        failed: results.filter((item) => !item.success).length,
        withExams: results.filter((item) => item.success && item.examsCount > 0).length,
        emptyExamLists: results.filter((item) => item.success && item.examsCount === 0).length,
        authRequired: results.filter((item) => item.error === 'Требуется авторизация в Platonus').length,
        failures: results
            .filter((item) => !item.success)
            .slice(0, 50)
            .map((item) => ({
                userId: item.userId,
                error: item.error,
            })),
    };

    console.log(JSON.stringify(summary, null, 2));
}

await main();
