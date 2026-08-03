/**
 * Routes для интеграции с Platonus
 * Экспериментальная функция: оценки, журнал
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { platonusLogin, fetchDetailedSubject, fetchAvailableSemesters } from '../parsers/platonus-client.js';
import { extractDetailedGrades } from '../parsers/grades.js';
import {
    savePlatonusSession,
    getActivePlatonusSession,
    forceRefreshSession,
    isPlatonusConnected,
    deletePlatonusSession,
} from '../services/platonus.js';
import {
    getPlatonusGradesCached,
    deletePlatonusGradesCache,
} from '../services/platonus-grades.js';
import { logAction } from '../utils/actionLog.js';
import { consumeRateLimit } from '../utils/rateLimit.js';
import { traceRuntime } from '../utils/runtimeTrace.js';

interface PlatonusLoginBody {
    login: string;
    password: string;
}

const MAX_PLATONUS_LOGIN_LENGTH = 200;
const MAX_PLATONUS_PASSWORD_LENGTH = 1024;

// `/platonus/login` forwards an arbitrary login/password pair to the university's
// Platonus system and reports back whether it was accepted, so it must never be
// usable as an unmetered credential-checking proxy. A student connects Platonus
// once (and re-connects only after a password change), so both budgets below are
// far above legitimate usage:
//   - per account: 5 attempts / 5 min (mirrors auth.ts change-password)
//   - per IP:     20 attempts / 5 min (campus NAT puts many students on one IP,
//                 but 20 onboarding attempts per 5 min is still ample)
const PLATONUS_LOGIN_USER_MAX_ATTEMPTS = 5;
const PLATONUS_LOGIN_USER_WINDOW_MS = 5 * 60 * 1000;
const PLATONUS_LOGIN_IP_MAX_ATTEMPTS = 20;
const PLATONUS_LOGIN_IP_WINDOW_MS = 5 * 60 * 1000;

const platonusLoginBodySchema = {
    type: 'object',
    required: ['login', 'password'],
    properties: {
        login: { type: 'string', minLength: 1, maxLength: MAX_PLATONUS_LOGIN_LENGTH },
        password: { type: 'string', minLength: 1, maxLength: MAX_PLATONUS_PASSWORD_LENGTH },
    },
} as const;

interface GradesQuery {
    year?: string;
    semester?: string;
    refresh?: string;
}

function normalizePlatonusLogin(value: string): string {
    return value.trim();
}

export function collectPreviewKeys(input: unknown): string[] {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
    return Object.keys(input as Record<string, unknown>).sort().slice(0, 12);
}

function summarizeDetailedSubjectPayload(rawData: unknown): Record<string, unknown> {
    if (!Array.isArray(rawData)) {
        return {
            isArray: false,
            type: typeof rawData,
        };
    }

    const firstItem = rawData[0];
    const firstMarks = firstItem && typeof firstItem === 'object' ? (firstItem as Record<string, unknown>).Marks : null;
    const monthKeys = firstMarks && typeof firstMarks === 'object'
        ? Object.keys(firstMarks as Record<string, unknown>).slice(0, 6)
        : [];
    const firstMonth = monthKeys.length > 0
        ? (firstMarks as Record<string, unknown>)[monthKeys[0]]
        : null;
    const firstMonthMarks = firstMonth && typeof firstMonth === 'object'
        ? (firstMonth as Record<string, unknown>).Marks
        : null;
    const dayKeys = firstMonthMarks && typeof firstMonthMarks === 'object'
        ? Object.keys(firstMonthMarks as Record<string, unknown>).slice(0, 6)
        : [];
    const firstDayMarks = dayKeys.length > 0
        ? (firstMonthMarks as Record<string, unknown>)[dayKeys[0]]
        : null;
    const firstMark = Array.isArray(firstDayMarks) ? firstDayMarks[0] : null;

    return {
        isArray: true,
        itemCount: rawData.length,
        firstItemKeys: collectPreviewKeys(firstItem),
        monthKeys,
        firstMonthKeys: collectPreviewKeys(firstMonth),
        dayKeys,
        firstMarkKeys: collectPreviewKeys(firstMark),
    };
}

// Доступные семестры для выбора
const AVAILABLE_SEMESTERS = [
    { year: 2026, semester: 1, label: '2026/2027 — Осенний' },
    { year: 2025, semester: 2, label: '2025/2026 — Весенний' },
    { year: 2025, semester: 1, label: '2025/2026 — Осенний' },
    { year: 2024, semester: 2, label: '2024/2025 — Весенний' },
    { year: 2024, semester: 1, label: '2024/2025 — Осенний' },
    { year: 2023, semester: 2, label: '2023/2024 — Весенний' },
    { year: 2023, semester: 1, label: '2023/2024 — Осенний' },
];

const SEMESTERS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SEMESTERS_FAILURE_BACKOFF_MS = 30 * 60 * 1000;

const semestersCache = new Map<string, {
    semesters: typeof AVAILABLE_SEMESTERS;
    expiresAt: number;
    source: 'dynamic' | 'fallback';
}>();

async function resolveAvailableSemesters(
    userId: string,
    connected: boolean
) {
    if (!connected) return AVAILABLE_SEMESTERS;

    const cached = semestersCache.get(userId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
        return cached.semesters;
    }

    try {
        const session = await getActivePlatonusSession(userId);
        if (!session) return AVAILABLE_SEMESTERS;

        const dynamicSemesters = await fetchAvailableSemesters(session);
        if (dynamicSemesters && dynamicSemesters.length > 0) {
            semestersCache.set(userId, {
                semesters: dynamicSemesters as typeof AVAILABLE_SEMESTERS,
                expiresAt: now + SEMESTERS_CACHE_TTL_MS,
                source: 'dynamic',
            });
            return dynamicSemesters;
        }
    } catch (error) {
        console.warn('[Platonus] Failed to resolve dynamic semesters:', error);
    }

    semestersCache.set(userId, {
        semesters: AVAILABLE_SEMESTERS,
        expiresAt: now + SEMESTERS_FAILURE_BACKOFF_MS,
        source: 'fallback',
    });

    return AVAILABLE_SEMESTERS;
}

export async function platonusRoutes(app: FastifyInstance) {

    /**
     * POST /api/v3/platonus/login
     * Авторизация в Platonus (отдельная от основной авторизации)
     */
    app.post('/login', {
        preHandler: [app.authenticate as any],
        schema: { body: platonusLoginBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: PlatonusLoginBody }>,
        reply: FastifyReply
    ) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'Необходимо указать логин и пароль Platonus',
            });
        }
        const userId = (request.user as any).userId;
        const rawLogin = request.body.login;
        const password = request.body.password;
        const login = normalizePlatonusLogin(rawLogin);

        if (!login) {
            return reply.status(400).send({
                success: false,
                error: 'Необходимо указать логин и пароль Platonus',
            });
        }

        const userRate = consumeRateLimit(
            `platonus-login:${userId}`,
            PLATONUS_LOGIN_USER_MAX_ATTEMPTS,
            PLATONUS_LOGIN_USER_WINDOW_MS
        );
        const ipRate = userRate.allowed
            ? consumeRateLimit(
                `platonus-login-ip:${request.ip || 'unknown'}`,
                PLATONUS_LOGIN_IP_MAX_ATTEMPTS,
                PLATONUS_LOGIN_IP_WINDOW_MS
            )
            : { allowed: false, retryAfterSec: userRate.retryAfterSec };

        if (!userRate.allowed || !ipRate.allowed) {
            const retryAfterSec = Math.max(userRate.retryAfterSec, ipRate.retryAfterSec);
            logAction(userId, 'platonus_login', 'Platonus login blocked by rate limit', {
                result: 'failed',
                metadata: {
                    scope: userRate.allowed ? 'ip' : 'user',
                    retryAfterSec,
                },
            });
            reply.header('Retry-After', String(retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Слишком много попыток подключения Platonus. Попробуйте позже.',
                errorCode: 'PLATONUS_LOGIN_RATE_LIMITED',
            });
        }

        // We cannot hard-verify that `login` belongs to the caller: the Platonus
        // login is stored as a separate field from the app userId (univer login)
        // and users type it by hand, so the two legitimately differ. Record the
        // relationship so a pattern of one account submitting many distinct
        // Platonus logins is visible in the action log.
        const loginMatchesAccount = login.toLowerCase() === String(userId || '').toLowerCase();

        try {
            console.log(`[Platonus] Login attempt for ${userId} as ${login}`);

            const session = await platonusLogin(login, password);

            if (!session) {
                logAction(
                    userId,
                    'platonus_login',
                    `Failed Platonus login: ${login}`,
                    {
                        result: 'failed',
                        metadata: {
                            login,
                            hadWhitespaceTrim: rawLogin !== login,
                            loginMatchesAccount,
                        },
                    }
                );
                return reply.status(401).send({
                    success: false,
                    error: 'Неверный логин или пароль Platonus',
                });
            }

            // Кэшируем сессию
            await savePlatonusSession(userId, login, password, session);
            semestersCache.delete(userId);

            console.log(`[Platonus] Login successful for ${userId}`);
            logAction(
                userId,
                'platonus_login',
                `Connected Platonus account ${login}; personID=${session.personID}`,
                {
                    metadata: {
                        login,
                        loginMatchesAccount,
                    },
                }
            );

            return {
                success: true,
                data: {
                    login,
                    personID: session.personID,
                },
            };
        } catch (error) {
            console.error('[Platonus] Login error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка сервера при авторизации в Platonus',
            });
        }
    });

    /**
     * GET /api/v3/platonus/grades?year=2025&semester=2
     * Получение оценок за указанный семестр
     */
    app.get('/grades', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Querystring: GradesQuery }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const year = Number.parseInt(request.query.year || '2025', 10);
        const semester = Number.parseInt(request.query.semester || '2', 10);
        const forceRefresh = request.query.refresh === 'true';

        // Валидация
        if (Number.isNaN(year) || Number.isNaN(semester) || semester < 1 || semester > 2) {
            return reply.status(400).send({
                success: false,
                error: 'Некорректные параметры year/semester',
            });
        }

        try {
            const result = await getPlatonusGradesCached(userId, year, semester, forceRefresh);

            if (result.error || !result.data) {
                if (result.errorCode === 'PLATONUS_NOT_CONNECTED') {
                    return reply.status(401).send({
                        success: false,
                        error: result.error || 'Platonus не подключён. Необходимо авторизоваться.',
                        errorCode: 'PLATONUS_NOT_CONNECTED',
                    });
                }

                return reply.status(502).send({
                    success: false,
                    error: result.error || 'Ошибка получения данных из Platonus',
                    errorCode: result.errorCode || 'PLATONUS_UPSTREAM_ERROR',
                });
            }

            return {
                success: true,
                data: result.data,
                cached: result.cached,
                stale: result.stale || false,
                cacheAge: result.cacheAge ?? 0,
            };
        } catch (error) {
            console.error('[Platonus] Grades fetch error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка сервера при получении оценок',
            });
        }
    });

    /**
     * Получение детальных оценок по конкретному предмету
     */
    app.get<{
        Querystring: { year: string; semester: string; subjectId: string; queryId: string };
    }>('/subject', { preHandler: [app.authenticate] }, async (request, reply) => {
        try {
            const { year: yearStr, semester: semStr, subjectId, queryId } = request.query;
            const year = parseInt(yearStr, 10);
            const semester = parseInt(semStr, 10);

            if (!year || !semester || !subjectId || !queryId) {
                return reply.status(400).send({ error: 'Missing Required Query Parameters' });
            }

            const userId = (request.user as any).userId;
            const session = await getActivePlatonusSession(userId);

            if (!session) {
                return reply.status(401).send({
                    success: false,
                    error: 'Platonus не подключён.',
                    errorCode: 'PLATONUS_NOT_CONNECTED',
                });
            }

            let effectiveQueryId = queryId;
            let rawData: any;

            try {
                rawData = await fetchDetailedSubject(session, year, semester, subjectId, effectiveQueryId);
            } catch (initialError) {
                console.warn('[Platonus] Detailed subject fetch failed, trying refreshed session and fresh journal queryID...', {
                    userId,
                    year,
                    semester,
                    subjectId,
                    queryId,
                    error: initialError instanceof Error ? initialError.message : String(initialError),
                });

                const refreshedSession = await forceRefreshSession(userId);
                const retrySession = refreshedSession || session;
                const freshGrades = await getPlatonusGradesCached(userId, year, semester, true);
                const freshSubject = freshGrades.data?.subjects.find((item) => item.subjectID === subjectId);
                const freshQueryId = freshSubject?.queryID?.trim();

                if (!freshQueryId) {
                    return reply.status(502).send({
                        success: false,
                        error: 'Не удалось обновить данные предмета в Platonus',
                        errorCode: 'PLATONUS_SUBJECT_REFRESH_FAILED',
                    });
                }

                effectiveQueryId = freshQueryId;
                rawData = await fetchDetailedSubject(retrySession, year, semester, subjectId, effectiveQueryId);
            }

            const detailedGrades = extractDetailedGrades(rawData);
            traceRuntime({
                source: 'backend',
                scope: 'platonus.subject',
                event: 'payload_shape',
                level: 'debug',
                message: `Collected Platonus detailed subject payload shape for ${subjectId}`,
                userId,
                metadata: {
                    year,
                    semester,
                    subjectId,
                    queryId: effectiveQueryId,
                    extractedCount: detailedGrades.length,
                    payload: summarizeDetailedSubjectPayload(rawData),
                },
            });

            return {
                success: true,
                data: detailedGrades,
            };
        } catch (error) {
            console.error('[Platonus] Detailed grades fetch error:', error);
            return reply.status(502).send({
                success: false,
                error: 'Ошибка при получении детальных оценок',
                errorCode: 'PLATONUS_SUBJECT_UPSTREAM_ERROR',
            });
        }
    });

    /**
     * GET /api/v3/platonus/status
     * Проверка статуса подключения Platonus
     */
    app.get('/status', {
        preHandler: [app.authenticate as any],
    }, async (request: FastifyRequest) => {
        const userId = (request.user as any).userId;
        const status = await isPlatonusConnected(userId);
        const availableSemesters = await resolveAvailableSemesters(userId, status.connected);

        return {
            success: true,
            data: {
                ...status,
                availableSemesters,
            },
        };
    });

    /**
     * POST /api/v3/platonus/disconnect
     * Отключение Platonus (удаление кэшированных данных)
     */
    app.post('/disconnect', {
        preHandler: [app.authenticate as any],
    }, async (request: FastifyRequest) => {
        const userId = (request.user as any).userId;
        await deletePlatonusSession(userId);
        await deletePlatonusGradesCache(userId);
        semestersCache.delete(userId);

        console.log(`[Platonus] Disconnected for ${userId}`);
        logAction(userId, 'platonus_disconnect', 'Disconnected Platonus account; active session removed and grades cache cleared');

        return {
            success: true,
        };
    });
}
