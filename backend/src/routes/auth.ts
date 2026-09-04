/**
 * Routes для авторизации
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { platonusLogin } from '../parsers/platonus-client.js';
import { findUserIdByPlatonusLogin, savePlatonusSession } from '../services/platonus.js';
import { getEffectiveAccess } from '../services/group-space.js';
import { upsertUser, getUser, touchUserLastLogin, verifyStaffPassword } from '../services/users.js';
import { ensureReferralProfileForUser, tryApplyReferralOnLogin } from '../services/referrals.js';
import { logAction } from '../utils/actionLog.js';
import { consumeRateLimit } from '../utils/rateLimit.js';
import { clearUserSessionCookie, readBearerToken, readUserSessionToken, setUserSessionCookie } from '../utils/userSession.js';
import { createUserSession, revokeCurrentSession, ensureSessionExists } from '../services/sessions.js';

interface LoginBody {
    username: string;
    password: string;
    referralCode?: string;
}

interface CuratorLoginBody {
    userId: string;
    password: string;
}

// Защита: логин Platonus обычно короткий (≤80 символов), пароль bcrypt/text не >1024,
// referralCode короткий идентификатор. Любая попытка отправить мегабайтовое
// значение — отказ на edge.
const MAX_LOGIN_LENGTH = 200;
const MAX_PASSWORD_LENGTH = 1024;
const MAX_REFERRAL_CODE_LENGTH = 100;

const loginBodySchema = {
    type: 'object',
    required: ['username', 'password'],
    properties: {
        username: { type: 'string', minLength: 1, maxLength: MAX_LOGIN_LENGTH },
        password: { type: 'string', minLength: 1, maxLength: MAX_PASSWORD_LENGTH },
        referralCode: { type: ['string', 'null'], maxLength: MAX_REFERRAL_CODE_LENGTH },
    },
} as const;

const curatorLoginBodySchema = {
    type: 'object',
    required: ['userId', 'password'],
    properties: {
        userId: { type: 'string', minLength: 1, maxLength: MAX_LOGIN_LENGTH },
        password: { type: 'string', minLength: 1, maxLength: MAX_PASSWORD_LENGTH },
    },
} as const;

/**
 * Пре-нормализация логина Platonus перед отправкой в /rest/api/login.
 * Только внешний trim: регистр и спецсимволы не трогаем — Platonus сам решает,
 * что считать валидным логином.
 */
export function normalizePlatonusLogin(value: string): string {
    return value.trim();
}

export async function authRoutes(app: FastifyInstance) {

    /**
     * POST /api/v3/auth/login
     * Авторизация пользователя
     */
    app.post('/login', {
        schema: { body: loginBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: LoginBody }>,
        reply: FastifyReply
    ) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'Необходимо указать логин и пароль',
            });
        }

        const loginMax = Number.parseInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || '', 10);
        const loginWindowSec = Number.parseInt(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC || '', 10);
        const maxAttempts = Number.isFinite(loginMax) && loginMax > 0 ? loginMax : 20;
        const windowSec = Number.isFinite(loginWindowSec) && loginWindowSec > 0 ? loginWindowSec : 60;
        const rate = consumeRateLimit(`auth-login:${request.ip || 'unknown'}`, maxAttempts, windowSec * 1000);
        if (!rate.allowed) {
            logAction(
                request.body?.username || `ip:${request.ip || 'unknown'}`,
                'login_rate_limited',
                `Login blocked by rate limit from ip=${request.ip || 'unknown'}`
            );
            reply.header('Retry-After', String(rate.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Слишком много попыток входа. Попробуйте позже.',
            });
        }

        // Ajv обеспечил наличие и тип полей; нормализуем whitespace в username.
        const platonusLoginStr = normalizePlatonusLogin(request.body.username);
        const password = request.body.password;
        const referralCode = request.body.referralCode;

        if (!platonusLoginStr) {
            return reply.status(400).send({
                success: false,
                error: 'Необходимо указать логин и пароль',
            });
        }

        // userId по умолчанию = логин Platonus (новая регистрация). Для аккаунтов
        // времён Univer он будет заменён ниже на старый userId из app_platonus_sessions.
        let userId = platonusLoginStr;

        try {
            // Проверяем учётные данные через Platonus — единственный источник идентичности.
            console.log(`[Auth] Verifying Platonus credentials for ${platonusLoginStr}`);
            const platonusSession = await platonusLogin(platonusLoginStr, password);

            if (!platonusSession) {
                logAction(
                    platonusLoginStr,
                    'login_failed',
                    'Login failed: invalid_credentials'
                );
                return reply.status(401).send({
                    success: false,
                    error: 'Неверный логин или пароль',
                    errorCode: 'AUTH_INVALID_CREDENTIALS',
                });
            }

            // Существующие аккаунты: userId = старый Univer-логин, а platonus_login
            // лежит в app_platonus_sessions. Ищем без учёта регистра, чтобы не
            // завести дубликат аккаунта и не потерять историю пользователя.
            const existingUserId = await findUserIdByPlatonusLogin(platonusLoginStr);
            if (existingUserId) {
                userId = existingUserId;
                if (existingUserId !== platonusLoginStr) {
                    console.log(`[Auth] Platonus login ${platonusLoginStr} mapped to existing account ${existingUserId}`);
                }
            }

            // Сохраняем пользователя
            await upsertUser(userId, password);

            // Сразу кэшируем сессию Platonus — её используют расписание, оценки и т.д.
            try {
                await savePlatonusSession(userId, platonusLoginStr, password, platonusSession);
            } catch (sessionError) {
                console.warn(`[Auth] Failed to cache Platonus session for ${userId}:`, sessionError);
            }

            try {
                await ensureReferralProfileForUser(userId);
            } catch (referralProfileError) {
                console.warn(`[Auth] Failed to ensure referral profile for ${userId}:`, referralProfileError);
            }

            // Генерируем JWT
            const token = app.jwt.sign({ userId });
            setUserSessionCookie(reply, token);

            // Сохраняем сессию
            createUserSession({
                userId,
                token,
                userAgent: request.headers['user-agent'] || null,
                ip: request.ip || null,
            }).catch((err) => console.warn('[Auth] Failed to create session:', err));

            const referral = await tryApplyReferralOnLogin(userId, referralCode);
            if (referral.status === 'applied') {
                logAction(userId, 'referral_claim', 'Referral attached automatically on login', {
                    result: 'success',
                    metadata: {
                        source: 'link',
                    },
                });
            }

            console.log(`[Auth] Login successful for ${userId}`);
            logAction(userId, 'login', 'Login successful; JWT issued');

            return {
                success: true,
                token,
                user: {
                    userId,
                },
                referral,
            };

        } catch (error) {
            console.error('[Auth] Login error:', error);
            logAction(
                userId || `ip:${request.ip || 'unknown'}`,
                'login_failed',
                'Login failed because of internal server error'
            );
            return reply.status(500).send({
                success: false,
                error: 'Ошибка сервера при авторизации',
            });
        }
    });

    /**
     * GET /api/v3/auth/verify
     * Проверка токена
     */
    app.get('/verify', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const user = await getUser(userId);

        if (!user) {
            return reply.status(401).send({
                success: false,
                error: 'Пользователь не найден',
            });
        }

        const renewedToken = reply.getHeader('X-Renewed-Token');
        const bearerToken = readBearerToken(request);
        const cookieToken = readUserSessionToken(request);
        const nextToken = typeof renewedToken === 'string'
            ? renewedToken
            : bearerToken || cookieToken;

        if (nextToken && (!cookieToken || typeof renewedToken === 'string')) {
            setUserSessionCookie(reply, nextToken);
        }

        // Backfill: если сессии для токена ещё нет — создаём (старые токены до фичи)
        if (nextToken) {
            ensureSessionExists({
                userId,
                token: nextToken,
                userAgent: request.headers['user-agent'] || null,
                ip: request.ip || null,
            }).catch(() => { });
        }

        return {
            success: true,
            user: {
                userId: user.userId,
                settings: user.settings,
                lastLogin: user.lastLogin,
            },
        };
    });

    /**
     * POST /api/v3/auth/logout
     * Выход (клиентская сторона удаляет токен)
     */
    app.post('/logout', async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const token = readBearerToken(request) || readUserSessionToken(request);
        if (token) {
            revokeCurrentSession(token).catch((err) =>
                console.warn('[Auth] Failed to revoke session on logout:', err)
            );
        }
        clearUserSessionCookie(reply);
        return { success: true };
    });

    /**
     * POST /api/v3/auth/curator-login
     * Локальный вход для куратора
     */
    app.post('/curator-login', {
        schema: { body: curatorLoginBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: CuratorLoginBody }>,
        reply: FastifyReply
    ) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'Необходимо указать логин и пароль',
            });
        }

        const loginMax = Number.parseInt(process.env.AUTH_LOGIN_RATE_LIMIT_MAX || '', 10);
        const loginWindowSec = Number.parseInt(process.env.AUTH_LOGIN_RATE_LIMIT_WINDOW_SEC || '', 10);
        const maxAttempts = Number.isFinite(loginMax) && loginMax > 0 ? loginMax : 20;
        const windowSec = Number.isFinite(loginWindowSec) && loginWindowSec > 0 ? loginWindowSec : 60;
        const rate = consumeRateLimit(`auth-curator-login:${request.ip || 'unknown'}`, maxAttempts, windowSec * 1000);
        if (!rate.allowed) {
            logAction(
                request.body?.userId || `ip:${request.ip || 'unknown'}`,
                'curator_login_rate_limited',
                `Curator login blocked by rate limit from ip=${request.ip || 'unknown'}`
            );
            reply.header('Retry-After', String(rate.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Слишком много попыток входа. Попробуйте позже.',
            });
        }

        // Ajv проверил типы/длины; трим whitespace вручную.
        const userId = request.body.userId.trim();
        const password = request.body.password;
        if (!userId) {
            return reply.status(400).send({
                success: false,
                error: 'Необходимо указать логин и пароль',
            });
        }

        try {
            const [passwordValid, access] = await Promise.all([
                verifyStaffPassword(userId, password),
                getEffectiveAccess(userId, null),
            ]);

            if (!passwordValid) {
                logAction(userId, 'curator_login_failed', 'Curator login failed: invalid credentials');
                return reply.status(401).send({
                    success: false,
                    error: 'Неверный логин или пароль куратора',
                    errorCode: 'AUTH_INVALID_CREDENTIALS',
                });
            }

            if (!access.roles.includes('curator')) {
                logAction(userId, 'curator_login_failed', 'Curator login failed: role is missing');
                return reply.status(403).send({
                    success: false,
                    error: 'У пользователя нет роли куратора',
                    errorCode: 'AUTH_ROLE_REQUIRED',
                });
            }

            await touchUserLastLogin(userId);
            const token = app.jwt.sign({ userId });
            setUserSessionCookie(reply, token);

            // Сохраняем сессию
            createUserSession({
                userId,
                token,
                userAgent: request.headers['user-agent'] || null,
                ip: request.ip || null,
            }).catch((err) => console.warn('[Auth] Failed to create curator session:', err));

            logAction(userId, 'curator_login', 'Curator login successful; JWT issued');

            return {
                success: true,
                token,
                user: {
                    userId,
                },
            };
        } catch (error) {
            console.error('[Auth] Curator login error:', error);
            logAction(
                userId || `ip:${request.ip || 'unknown'}`,
                'curator_login_failed',
                'Curator login failed because of internal server error'
            );
            return reply.status(500).send({
                success: false,
                error: 'Ошибка сервера при авторизации',
            });
        }
    });
}
