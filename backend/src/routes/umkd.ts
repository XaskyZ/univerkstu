/**
 * Routes для УМКД.
 *
 * Источник УМКД (univer.kstu.kz/student/umkd) отключён навсегда: маршруты
 * отдают только ранее сохранённые списки (`umkd:<userId>`, файлы в R2) и
 * отвечают 503 + UMKD_SOURCE_UNAVAILABLE на любую попытку обновления.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
    type UMKD,
    UMKD_SOURCE_UNAVAILABLE,
    UMKD_SOURCE_UNAVAILABLE_MESSAGE,
} from '../services/umkd-types.js';
import { getCacheEntry, setCachedData } from '../db/mongo.js';
import { logAction } from '../utils/actionLog.js';
import type { AcademicContextResponse } from '../services/academic-context.js';
import { getOrParseExamQuestions } from '../services/umkd-parse-questions.js';
import { canAccessFile } from '../services/file-access.js';

/**
 * Сохранённый список УМКД пересобрать негде — продлеваем хранение, когда
 * отдаём просроченную запись (раньше TTL был 24 часа под ежедневный парсинг).
 */
const CACHE_TTL_MS = 365 * 24 * 60 * 60 * 1000;

interface UMKDCacheHit {
    umkd: UMKD;
    /** true — запись формально просрочена, но это всё, что осталось. */
    stale: boolean;
}

function umkdCacheKey(userId: string): string {
    return `umkd:${userId}`;
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

/**
 * Ранее сохранённый УМКД пользователя (свежий или просроченный). Просроченную
 * запись продлеваем, чтобы её не выкинула чистка кэша.
 */
async function getCachedUMKD(userId: string): Promise<UMKDCacheHit | null> {
    const cacheKey = umkdCacheKey(userId);
    const entry = await getCacheEntry<UMKD>(cacheKey);
    if (!entry?.data) {
        return null;
    }

    const stale = entry.expiresAt.getTime() <= Date.now();
    if (stale) {
        try {
            await setCachedData(cacheKey, entry.data, CACHE_TTL_MS);
        } catch (error) {
            console.error(`[UMKD Service] Failed to extend cache for ${userId}:`, error);
        }
    }

    console.log(`[UMKD Service] Cache hit for ${userId}${stale ? ' (stale, extended)' : ''}`);
    return { umkd: entry.data, stale };
}

const sourceUnavailablePayload = {
    success: false as const,
    error: UMKD_SOURCE_UNAVAILABLE_MESSAGE,
    errorCode: UMKD_SOURCE_UNAVAILABLE,
};

export async function umkdRoutes(app: FastifyInstance) {
    /**
     * GET /api/v3/umkd
     * Ранее сохранённый УМКД текущего пользователя. `refresh=true` → 503:
     * источника больше нет.
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
            if (!forceRefresh) {
                const hit = await getCachedUMKD(userId);
                if (hit) {
                    return {
                        success: true,
                        data: hit.umkd,
                        cached: true,
                        stale: hit.stale,
                    };
                }
            }

            return reply.status(503).send(sourceUnavailablePayload);
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
     * Обновление невозможно — источник отключён.
     */
    app.post('/umkd/refresh', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        logAction(userId, 'umkd_refresh', `UMKD refresh rejected: ${UMKD_SOURCE_UNAVAILABLE}`, { result: 'failed' });
        return reply.status(503).send(sourceUnavailablePayload);
    });

    /**
     * GET /api/v3/umkd/stream
     * SSE-поток: отдаёт сохранённый УМКД одним событием `complete`, либо
     * событие `error` с UMKD_SOURCE_UNAVAILABLE.
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
                if (!forceRefresh) {
                    const hit = await getCachedUMKD(userId);
                    if (hit) {
                        sendEvent({ type: 'progress', status: 'Загрузка из кеша', percent: 100 });
                        sendEvent({ type: 'complete', data: hit.umkd, stale: hit.stale });
                        reply.raw.end();
                        return;
                    }
                }

                if (forceRefresh) {
                    logAction(userId, 'umkd_refresh', `UMKD stream refresh rejected: ${UMKD_SOURCE_UNAVAILABLE}`, { result: 'failed' });
                }
                sendEvent({
                    type: 'error',
                    error: UMKD_SOURCE_UNAVAILABLE_MESSAGE,
                    errorCode: UMKD_SOURCE_UNAVAILABLE,
                });
                reply.raw.end();
            } catch (error) {
                console.error('[UMKD Stream] Error:', error);
                const msg = error instanceof Error ? error.message : 'Unknown error';
                sendEvent({
                    type: 'error',
                    error: `Internal error: ${msg}`,
                    errorCode: 'UPSTREAM_UNAVAILABLE',
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
