/**
 * Routes для УМКД
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { parseUMKD, UMKD } from '../parsers/umkd.js';
import { getCachedData, setCachedData } from '../db/mongo.js';
import { logAction } from '../utils/actionLog.js';
import { getAcademicContext, type AcademicContextResponse } from '../services/academic-context.js';
import { getUserPassword } from '../services/users.js';
import { getOrParseExamQuestions } from '../services/umkd-parse-questions.js';
import { canAccessFile } from '../services/file-access.js';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // УМКД кешируем на 24 часа (в миллисекундах)

interface UMKDResult {
    umkd: UMKD | null;
    cached: boolean;
    error?: string;
}

export function getUmkdPeriodOverrides(context: AcademicContextResponse | null): { year?: string; semester?: string } {
    if (!context?.semesterStart || !context.currentSemesterNumber) {
        return {};
    }

    const semesterStart = new Date(context.semesterStart);
    if (Number.isNaN(semesterStart.getTime())) {
        return {};
    }

    const semester = context.currentSemesterNumber % 2 === 0 ? '2' : '1';
    const academicYearStart = semester === '1'
        ? semesterStart.getFullYear()
        : semesterStart.getFullYear() - 1;

    return {
        year: String(academicYearStart),
        semester,
    };
}

async function getUMKD(userId: string, forceRefresh = false): Promise<UMKDResult> {
    const cacheKey = `umkd:${userId}`;

    // Проверяем кеш, если не нужно принудительное обновление
    if (!forceRefresh) {
        const cached = await getCachedData<UMKD>(cacheKey);
        if (cached) {
            console.log(`[UMKD Service] Cache hit for ${userId}`);
            return { umkd: cached, cached: true };
        }
    }

    const password = await getUserPassword(userId);
    if (!password) {
        return { umkd: null, cached: false, error: 'Требуется повторная авторизация' };
    }

    try {
        const academicContextResult = await getAcademicContext(userId, false);
        const umkdPeriod = getUmkdPeriodOverrides(academicContextResult.context);

        console.log(`[UMKD Service] Parsing UMKD for ${userId}...`);
        const result = await parseUMKD(userId, password, umkdPeriod);

        if (!result.success || !result.data) {
            return { umkd: null, cached: false, error: result.error || 'Parse failed' };
        }

        // Добавляем метаданные кеша
        const umkdWithCache: UMKD = {
            ...result.data,
            meta: {
                ...result.data.meta,
                parsedAt: new Date().toISOString(),
            },
        };

        // Сохраняем в кеш
        await setCachedData(cacheKey, umkdWithCache, CACHE_TTL_MS);

        return { umkd: umkdWithCache, cached: false };
    } catch (error) {
        console.error('[UMKD Service] Error:', error);
        return { umkd: null, cached: false, error: 'Failed to parse UMKD' };
    }
}

export async function umkdRoutes(app: FastifyInstance) {
    const mapUmkdError = (error: string) => {
        if (error.includes('Требуется повторная авторизация') || error.includes('Пользователь не найден')) {
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
     * GET /api/v3/umkd
     * Получение УМКД текущего пользователя
     */
    app.get('/umkd', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Querystring: { refresh?: string } }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const forceRefresh = request.query.refresh === 'true';

        try {
            const result = await getUMKD(userId, forceRefresh);

            if (result.error) {
                const mapped = mapUmkdError(result.error);
                return reply.status(mapped.status).send({
                    success: false,
                    error: result.error,
                    errorCode: mapped.errorCode,
                });
            }

            if (!result.umkd) {
                return reply.status(404).send({
                    success: false,
                    error: 'УМКД не найдено',
                });
            }

            return {
                success: true,
                data: result.umkd,
                cached: result.cached,
            };

        } catch (error) {
            console.error('[UMKD Route] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка получения УМКД',
            });
        }
    });

    /**
     * POST /api/v3/umkd/refresh
     * Принудительное обновление УМКД
     */
    app.post('/umkd/refresh', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        try {
            const result = await getUMKD(userId, true);

            if (result.error) {
                logAction(userId, 'umkd_refresh', `UMKD refresh failed: ${result.error}`, { result: 'failed' });
                const mapped = mapUmkdError(result.error);
                return reply.status(mapped.status).send({
                    success: false,
                    error: result.error,
                    errorCode: mapped.errorCode,
                });
            }

            logAction(userId, 'umkd_refresh', 'UMKD refreshed successfully', { result: 'success' });
            return {
                success: true,
                data: result.umkd,
                cached: false,
                message: 'УМКД обновлено',
            };

        } catch (error) {
            console.error('[UMKD Route] Error:', error);
            logAction(userId, 'umkd_refresh', 'UMKD refresh failed because of internal server error', { result: 'failed' });
            return reply.status(500).send({
                success: false,
                error: 'Ошибка обновления УМКД',
            });
        }
    });

    /**
     * GET /api/v3/umkd/stream
     * Стрим с прогрессом получения УМКД (SSE)
     */
    app.get('/umkd/stream', {
        preHandler: [app.authenticate as any],
    }, (
        request: FastifyRequest<{ Querystring: { refresh?: string } }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const forceRefresh = request.query.refresh === 'true';

        // Настройка SSE заголовков
        const requestOrigin = typeof request.headers.origin === 'string' ? request.headers.origin : null;
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            ...(requestOrigin ? {
                'Access-Control-Allow-Origin': requestOrigin,
                'Access-Control-Allow-Credentials': 'true',
                'Vary': 'Origin',
            } : {}),
        });

        const sendEvent = (data: any) => {
            reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        (async () => {
            try {
                // 1. Проверяем кеш (если не forceRefresh)
                if (!forceRefresh) {
                    const cacheKey = `umkd:${userId}`;
                    const cached = await getCachedData<UMKD>(cacheKey);
                    if (cached) {
                        console.log(`[UMKD Stream] Cache hit for ${userId}`);
                        sendEvent({ type: 'progress', status: 'Загрузка из кеша', percent: 100 });
                        sendEvent({ type: 'complete', data: cached });
                        reply.raw.end();
                        return;
                    }
                }

                const password = await getUserPassword(userId);
                if (!password) {
                    sendEvent({
                        type: 'error',
                        error: 'Требуется повторная авторизация',
                        errorCode: 'AUTH_RELOGIN_REQUIRED',
                    });
                    reply.raw.end();
                    return;
                }

                const academicContextResult = await getAcademicContext(userId, false);
                const umkdPeriod = getUmkdPeriodOverrides(academicContextResult.context);

                sendEvent({ type: 'progress', status: 'Подключение...', percent: 0 });

                const result = await parseUMKD(userId, password, {
                    ...umkdPeriod,
                    onProgress: (status, percent) => {
                        sendEvent({ type: 'progress', status, percent });
                    }
                });

                if (!result.success || !result.data) {
                    const mapped = mapUmkdError(result.error || 'Ошибка парсинга');
                    sendEvent({
                        type: 'error',
                        error: result.error || 'Ошибка парсинга',
                        errorCode: mapped.errorCode,
                    });
                    reply.raw.end();
                    return;
                }

                // 4. Кешируем результат
                const umkdWithCache: UMKD = {
                    ...result.data,
                    meta: {
                        ...result.data.meta,
                        parsedAt: new Date().toISOString(),
                    },
                };

                const cacheKey = `umkd:${userId}`;
                await setCachedData(cacheKey, umkdWithCache, CACHE_TTL_MS);

                sendEvent({ type: 'complete', data: umkdWithCache });
                reply.raw.end();

            } catch (error) {
                console.error('[UMKD Stream] Error:', error);
                const msg = error instanceof Error ? error.message : 'Unknown error';
                const mapped = mapUmkdError(msg);
                sendEvent({
                    type: 'error',
                    error: mapped.errorCode === 'AUTH_RELOGIN_REQUIRED' ? 'Требуется повторная авторизация' : `Internal error: ${msg}`,
                    errorCode: mapped.errorCode,
                });
                reply.raw.end();
            }
        })();
    });

    /**
     * GET /api/v3/umkd/exam-questions/:fileId/parsed
     * Возвращает распарсенный список экзаменационных вопросов для UMKD-файла.
     * Кеш на уровне content_hash в app_umkd_parsed_content.
     */
    app.get('/umkd/exam-questions/:fileId/parsed', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Params: { fileId: string } }>,
        reply: FastifyReply
    ) => {
        const fileId = (request.params.fileId || '').trim();
        if (!fileId) {
            return reply.status(400).send({
                success: false,
                error: 'fileId is required',
                errorCode: 'BAD_REQUEST',
            });
        }

        const userId = (request.user as any)?.userId || '';

        try {
            // Тот же контроль доступа, что и у прямого скачивания: распарсенный
            // текст вопросов — это содержимое файла, отдавать его шире, чем сам
            // файл, нельзя. См. services/file-access.ts.
            const access = await canAccessFile(userId, fileId);
            if (!access.allowed) {
                if (access.reason === 'file_not_found') {
                    return reply.status(404).send({
                        success: false,
                        error: 'Файл не найден',
                        errorCode: 'FILE_NOT_FOUND',
                    });
                }
                return reply.status(403).send({
                    success: false,
                    error: 'Нет доступа к файлу',
                    errorCode: 'FILE_FORBIDDEN',
                });
            }

            const data = await getOrParseExamQuestions(fileId);
            return reply.status(200).send({ success: true, data });
        } catch (error) {
            // Внутренний текст ошибки («File not found: <id>», исключение
            // storage-слоя) остаётся в логах — наружу идёт фиксированная строка
            // + errorCode, как во всех остальных маршрутах.
            const msg = error instanceof Error ? error.message : 'Unknown error';
            console.error('[UMKD Route] exam-questions parse failed:', msg);
            return reply.status(500).send({
                success: false,
                error: 'Не удалось разобрать файл с вопросами',
                errorCode: 'PARSE_FAILED',
            });
        }
    });
}
