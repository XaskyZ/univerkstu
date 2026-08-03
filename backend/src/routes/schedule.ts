/**
 * Routes для расписания
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getSchedule, invalidateScheduleCache, getScheduleCacheStatus } from '../services/schedule.js';
import { findTeacherInDb } from '../utils/teacherMatcher.js';
import { Schedule } from '../types/index.js';
import { logAction } from '../utils/actionLog.js';
import { buildIcsFeed } from '../services/ics.js';

/**
 * Пост-обработка: добавляет teacherUrl к урокам из кэша,
 * у которых его ещё нет (старые записи)
 */
function enrichWithTeacherUrls(schedule: Schedule): Schedule {
    for (const day of schedule.days) {
        for (const slot of day.lessons) {
            for (const lesson of slot) {
                if (lesson.teacher && !lesson.teacherUrl) {
                    const matched = findTeacherInDb(lesson.teacher);
                    if (matched) {
                        lesson.teacherUrl = matched.url;
                        lesson.teacherName = matched.name;
                    }
                }
            }
        }
    }
    return schedule;
}

interface ScheduleQuery {
    refresh?: string;
}

export async function scheduleRoutes(app: FastifyInstance) {
    const mapScheduleError = (error: string) => {
        if (error.includes('Пользователь не найден') || error.includes('Требуется повторная авторизация')) {
            return { status: 401, errorCode: 'AUTH_RELOGIN_REQUIRED' };
        }
        if (
            error.includes('Сессия истекла') ||
            error.includes('Ошибка авторизации') ||
            error.includes('HTTP error: 401')
        ) {
            return { status: 401, errorCode: 'AUTH_RELOGIN_REQUIRED' };
        }
        return { status: 502, errorCode: 'UPSTREAM_UNAVAILABLE' };
    };

    /**
     * GET /api/v3/schedule
     * Получение расписания текущего пользователя
     */
    app.get('/schedule', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Querystring: ScheduleQuery }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const forceRefresh = request.query.refresh === 'true';

        try {
            const result = await getSchedule(userId, forceRefresh);

            if (result.error) {
                const mapped = mapScheduleError(result.error);
                return reply.status(mapped.status).send({
                    success: false,
                    error: result.error,
                    errorCode: mapped.errorCode,
                });
            }

            if (!result.schedule) {
                return reply.status(404).send({
                    success: false,
                    error: 'Расписание не найдено',
                });
            }

            return {
                success: true,
                data: enrichWithTeacherUrls(result.schedule),
                cached: result.cached,
                cacheAge: result.cached && result.schedule.cachedAt
                    ? Math.floor((Date.now() - new Date(result.schedule.cachedAt).getTime()) / 1000)
                    : 0,
            };

        } catch (error) {
            console.error('[Schedule Route] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка получения расписания',
            });
        }
    });

    /**
     * POST /api/v3/schedule/refresh
     * Принудительное обновление расписания
     */
    app.post('/schedule/refresh', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        try {
            const result = await getSchedule(userId, true);

            if (result.error) {
                const mapped = mapScheduleError(result.error);
                return reply.status(mapped.status).send({
                    success: false,
                    error: result.error,
                    errorCode: mapped.errorCode,
                });
            }

            logAction(
                userId,
                'schedule_refresh',
                `Forced schedule refresh; cached=${result.cached ? 'true' : 'false'}; lessonsDays=${result.schedule?.days?.length ?? 0}`
            );

            return {
                success: true,
                data: result.schedule ? enrichWithTeacherUrls(result.schedule) : null,
                cached: false,
            };

        } catch (error) {
            console.error('[Schedule Route] Refresh error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка обновления расписания',
            });
        }
    });

    /**
     * DELETE /api/v3/schedule/cache
     * Инвалидация кэша расписания
     */
    app.delete('/schedule/cache', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        _reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        await invalidateScheduleCache(userId);

        return { success: true };
    });

    /**
     * GET /api/v3/schedule/status
     * Статус кэша расписания
     */
    app.get('/schedule/status', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        _reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        const status = await getScheduleCacheStatus(userId);

        return {
            success: true,
            ...status,
        };
    });

    /**
     * GET /api/v3/schedule/export.ics
     * RFC 5545 ICS feed of the user's schedule for the next ~semester. Used by
     * the "Экспорт в календарь" button on the schedule page — calendar apps
     * (Google Calendar, Apple Calendar, Outlook) can import the resulting file
     * to display weekly classes alongside personal events.
     */
    app.get('/schedule/export.ics', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Querystring: { lang?: string } }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        try {
            const result = await getSchedule(userId, false);
            if (result.error || !result.schedule) {
                const mapped = mapScheduleError(result.error || 'Расписание не найдено');
                return reply.status(mapped.status).send({
                    success: false,
                    error: result.error || 'Расписание не найдено',
                    errorCode: mapped.errorCode,
                });
            }

            const requestedLang = (request.query.lang || '').toLowerCase();
            const language: 'ru' | 'kz' | 'en' =
                requestedLang === 'en' || requestedLang === 'kz' || requestedLang === 'ru'
                    ? (requestedLang as 'ru' | 'kz' | 'en')
                    : 'ru';
            const calendarName =
                language === 'en'
                    ? 'UniverKstu — Schedule'
                    : language === 'kz'
                        ? 'UniverKstu — Кесте'
                        : 'UniverKstu — Расписание';

            const body = buildIcsFeed(result.schedule, {
                calendarName,
                language,
            });

            logAction(userId, 'schedule_ics_export', `Exported ICS feed; bytes=${Buffer.byteLength(body)}`);

            reply
                .header('Content-Type', 'text/calendar; charset=utf-8')
                .header('Content-Disposition', 'attachment; filename="schedule.ics"')
                .header('Cache-Control', 'no-store')
                .send(body);
            return reply;

        } catch (error) {
            console.error('[Schedule Route] ICS export error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка экспорта расписания',
            });
        }
    });
}
