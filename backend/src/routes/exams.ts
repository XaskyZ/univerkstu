/**
 * Routes для экзаменов
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getExams, invalidateExamsCache, getExamsCacheStatus } from '../services/exams.js';
import { logAction } from '../utils/actionLog.js';
import { getAcademicContext } from '../services/academic-context.js';

interface ExamsQuery {
    refresh?: string;
}

export function parseCalendarDate(value: string): Date | null {
    const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Конец календарного дня «DD.MM.YYYY» по времени Казахстана
 * (Asia/Almaty, UTC+5, без DST — тот же подход, что в jobs/exam-reminders.ts).
 * Нужен для правой границы вехи: раньше конец периода парсился в ПОЛНОЧЬ
 * последнего дня, из-за чего веха «гасла» на весь финальный день (№8 аудита).
 * Явный оффсет `+05:00` делает границу независимой от таймзоны сервера.
 */
export function endOfCalendarDayKz(value: string): Date | null {
    const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    const date = new Date(`${yyyy}-${mm}-${dd}T23:59:59.999+05:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function mapAcademicMilestones(periods: Array<{
    label: string;
    kind: string;
    start: string;
    end: string;
    weeks: number | null;
    segmentLabel: string;
}>) {
    const now = new Date();
    return periods
        .filter((period) => ['midterm_1', 'midterm_2', 'exams', 'state_exams'].includes(period.kind))
        .map((period) => {
            const start = parseCalendarDate(period.start);
            // Правая граница — 23:59:59.999 последнего дня (KZ), чтобы веха
            // оставалась «Идёт сейчас» весь последний день включительно.
            const end = endOfCalendarDayKz(period.end);
            const active = Boolean(start && end && now >= start && now <= end);
            const upcoming = Boolean(start && now < start);

            return {
                label: period.label,
                kind: period.kind as 'midterm_1' | 'midterm_2' | 'exams' | 'state_exams',
                start: period.start,
                end: period.end,
                weeks: period.weeks,
                segmentLabel: period.segmentLabel,
                active,
                upcoming,
            };
        });
}

export async function examsRoutes(app: FastifyInstance) {
    const mapExamsError = (error: string) => {
        if (error.includes('Пользователь не найден')) {
            return { status: 404, errorCode: 'USER_NOT_FOUND' };
        }
        if (
            error.includes('Требуется авторизация в Platonus') ||
            error.includes('Platonus')
        ) {
            return { status: 409, errorCode: 'PLATONUS_AUTH_REQUIRED' };
        }
        return { status: 502, errorCode: 'UPSTREAM_UNAVAILABLE' };
    };

    /**
     * GET /api/v3/exams
     * Получение экзаменов текущего пользователя
     */
    app.get('/exams', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Querystring: ExamsQuery }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const forceRefresh = request.query.refresh === 'true';

        try {
            const result = await getExams(userId, forceRefresh);
            const academicContextResult = await getAcademicContext(userId, false);

            if (result.error) {
                const mapped = mapExamsError(result.error);
                return reply.status(mapped.status).send({
                    success: false,
                    error: result.error,
                    errorCode: mapped.errorCode,
                });
            }

            if (!result.exams) {
                return reply.status(404).send({
                    success: false,
                    error: 'Экзамены не найдены',
                });
            }

            const academicMilestones = academicContextResult.context
                ? mapAcademicMilestones(academicContextResult.context.periods)
                : [];

            const data = {
                ...result.exams,
                meta: {
                    ...result.exams.meta,
                    academicMilestones,
                },
            };

            return {
                success: true,
                data,
                cached: result.cached,
                cacheAge: result.cached && result.exams.cachedAt
                    ? Math.floor((Date.now() - new Date(result.exams.cachedAt).getTime()) / 1000)
                    : 0,
            };

        } catch (error) {
            console.error('[Exams Route] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка получения экзаменов',
            });
        }
    });

    /**
     * POST /api/v3/exams/refresh
     * Принудительное обновление экзаменов
     */
    app.post('/exams/refresh', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        try {
            const result = await getExams(userId, true);
            const academicContextResult = await getAcademicContext(userId, false);

            if (result.error) {
                const mapped = mapExamsError(result.error);
                return reply.status(mapped.status).send({
                    success: false,
                    error: result.error,
                    errorCode: mapped.errorCode,
                });
            }

            const academicMilestones = academicContextResult.context
                ? mapAcademicMilestones(academicContextResult.context.periods)
                : [];

            const data = result.exams ? {
                ...result.exams,
                meta: {
                    ...result.exams.meta,
                    academicMilestones,
                },
            } : result.exams;

            logAction(
                userId,
                'exams_refresh',
                `Forced exams refresh; cached=${result.cached ? 'true' : 'false'}; examsCount=${result.exams?.exams?.length ?? 0}`
            );

            return {
                success: true,
                data,
                cached: false,
            };

        } catch (error) {
            console.error('[Exams Route] Refresh error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка обновления экзаменов',
            });
        }
    });

    /**
     * DELETE /api/v3/exams/cache
     * Инвалидация кэша экзаменов
     */
    app.delete('/exams/cache', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        _reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        await invalidateExamsCache(userId);

        return { success: true };
    });

    /**
     * GET /api/v3/exams/status
     * Статус кэша экзаменов
     */
    app.get('/exams/status', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        _reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        const status = await getExamsCacheStatus(userId);

        return {
            success: true,
            ...status,
        };
    });
}
