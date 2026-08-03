/**
 * Routes для авторизации
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { parseScheduleWithCookies } from '../parsers/schedule.js';
import { login as loginToUniver, changeUniverPassword } from '../parsers/http-client.js';
import { getEffectiveAccess } from '../services/group-space.js';
import { upsertUser, getUser, touchUserLastLogin, verifyStaffPassword } from '../services/users.js';
import { ensureReferralProfileForUser, tryApplyReferralOnLogin } from '../services/referrals.js';
import { saveSchedule } from '../services/schedule.js';
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

interface ChangePasswordBody {
    currentPassword: string;
    newPassword: string;
}

// Защита: KSTU-логин обычно `Фамилия_Имя` ≤80 символов, пароль bcrypt/text не >1024,
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

// Univer-side требования: минимум 9 символов, цифры + буквы, не совпадает с логином.
// На бэкенде минимально валидируем длину (≥6) — Univer всё равно сам отвергнет слабый
// пароль; жёсткие правила дополнительно подсказываем фронту, не блокируем route'ом,
// чтобы не дублировать политику Univer (она может меняться).
const MIN_NEW_PASSWORD_LENGTH = 6;

const changePasswordBodySchema = {
    type: 'object',
    required: ['currentPassword', 'newPassword'],
    properties: {
        currentPassword: { type: 'string', minLength: 1, maxLength: MAX_PASSWORD_LENGTH },
        newPassword: { type: 'string', minLength: MIN_NEW_PASSWORD_LENGTH, maxLength: MAX_PASSWORD_LENGTH },
    },
} as const;

export function normalizeUniverLogin(value: string): string {
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
        const username = normalizeUniverLogin(request.body.username);
        const password = request.body.password;
        const referralCode = request.body.referralCode;

        if (!username) {
            return reply.status(400).send({
                success: false,
                error: 'Необходимо указать логин и пароль',
            });
        }

        try {
            // Проверяем учётные данные через KSTU
            console.log(`[Auth] Verifying credentials for ${username}`);
            const univerCookies = await loginToUniver(username, password);

            if (!univerCookies) {
                logAction(
                    username,
                    'login_failed',
                    'Login failed: invalid_credentials'
                );
                return reply.status(401).send({
                    success: false,
                    error: 'Неверный логин или пароль',
                    errorCode: 'AUTH_INVALID_CREDENTIALS',
                });
            }

            // Сохраняем пользователя
            await upsertUser(username, password);
            try {
                await ensureReferralProfileForUser(username);
            } catch (referralProfileError) {
                console.warn(`[Auth] Failed to ensure referral profile for ${username}:`, referralProfileError);
            }

            try {
                // Переиспользуем cookies от первичной верификации — не логинимся в KSTU второй раз.
                const parseResult = await parseScheduleWithCookies(univerCookies);
                if (parseResult.data) {
                    // Осень 2026: основной источник расписания — Platonus (см.
                    // services/schedule.ts). Univer-warmup оставляем, но не даём ему
                    // затирать кэш НЕтекущим семестром (isCurrent === false — фолбэк
                    // на прошлый семестр): иначе повторный логин перезаписал бы свежие
                    // Platonus-данные прошлогодним расписанием на 7 дней.
                    if (parseResult.data.meta.semester?.isCurrent === false) {
                        console.warn(`[Auth] Schedule warmup skipped for ${username}: univer returned a non-current semester fallback`);
                    } else {
                        await saveSchedule(username, parseResult.data);
                    }
                } else if (!parseResult.success) {
                    console.warn(`[Auth] Schedule warmup skipped for ${username}: ${parseResult.error || 'unknown error'}`);
                }
            } catch (cacheError) {
                console.warn(`[Auth] Failed to warm schedule cache for ${username}:`, cacheError);
            }

            // Генерируем JWT
            const token = app.jwt.sign({ userId: username });
            setUserSessionCookie(reply, token);

            // Сохраняем сессию
            createUserSession({
                userId: username,
                token,
                userAgent: request.headers['user-agent'] || null,
                ip: request.ip || null,
            }).catch((err) => console.warn('[Auth] Failed to create session:', err));

            const referral = await tryApplyReferralOnLogin(username, referralCode);
            if (referral.status === 'applied') {
                logAction(username, 'referral_claim', 'Referral attached automatically on login', {
                    result: 'success',
                    metadata: {
                        source: 'link',
                    },
                });
            }

            console.log(`[Auth] Login successful for ${username}`);
            logAction(username, 'login', 'Login successful; JWT issued');

            return {
                success: true,
                token,
                user: {
                    userId: username,
                },
                referral,
            };

        } catch (error) {
            console.error('[Auth] Login error:', error);
            logAction(
                username || `ip:${request.ip || 'unknown'}`,
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

    /**
     * POST /api/v3/auth/change-password
     * Смена пароля Univer/KSTU.
     *
     * Flow:
     *   1. Проверяем currentPassword через login() в Univer.
     *   2. Зовём changeUniverPassword().
     *   3. Подтверждаем смену повторным login() с newPassword — это единственная
     *      надёжная проверка. Если не залогинились, локальная база не обновляется.
     *   4. При success обновляем зашифрованный пароль через upsertUser().
     */
    app.post('/change-password', {
        preHandler: [app.authenticate as any],
        schema: { body: changePasswordBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: ChangePasswordBody }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId as string;

        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'Проверьте поля: текущий пароль и новый пароль (от 6 символов) обязательны',
                errorCode: 'AUTH_CHANGE_PASSWORD_VALIDATION',
            });
        }

        const { currentPassword, newPassword } = request.body;

        if (currentPassword === newPassword) {
            return reply.status(400).send({
                success: false,
                error: 'Новый пароль должен отличаться от текущего',
                errorCode: 'AUTH_CHANGE_PASSWORD_SAME',
            });
        }

        // Rate-limit: ограничиваем по userId, чтобы один пользователь не мог DOS-ить
        // KSTU своими попытками сменить пароль (KSTU login достаточно медленный).
        const rate = consumeRateLimit(`auth-change-password:${userId}`, 5, 5 * 60 * 1000);
        if (!rate.allowed) {
            logAction(userId, 'login_rate_limited', 'change-password blocked by rate limit');
            reply.header('Retry-After', String(rate.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Слишком много попыток смены пароля. Попробуйте позже.',
                errorCode: 'AUTH_CHANGE_PASSWORD_RATE_LIMITED',
            });
        }

        try {
            // 1. Verify current password actually logs into KSTU.
            const verifyCurrent = await loginToUniver(userId, currentPassword);
            if (!verifyCurrent) {
                logAction(userId, 'login_failed', 'change-password: invalid current password');
                return reply.status(401).send({
                    success: false,
                    error: 'Текущий пароль неверен',
                    errorCode: 'AUTH_INVALID_CURRENT_PASSWORD',
                });
            }

            // 2. Submit change to KSTU.
            const changeResult = await changeUniverPassword(userId, currentPassword, newPassword);
            if (!changeResult.success) {
                logAction(userId, 'login_failed', `change-password: KSTU change request failed (${changeResult.error || 'unknown'})`);
                return reply.status(502).send({
                    success: false,
                    error: 'Не удалось сменить пароль на стороне Univer. Попробуйте позже.',
                    errorCode: 'AUTH_CHANGE_PASSWORD_UPSTREAM',
                });
            }

            // 3. Verify by logging in with the NEW password. This is the only reliable
            //    proof that KSTU actually accepted the change.
            const verifyNew = await loginToUniver(userId, newPassword);
            if (!verifyNew) {
                logAction(userId, 'login_failed', 'change-password: new password did not log in after change');
                // Не обновляем локальную базу — старый пароль всё ещё валиден на стороне KSTU.
                return reply.status(502).send({
                    success: false,
                    error: 'Univer не подтвердил смену пароля. Проверьте требования к паролю и попробуйте снова.',
                    errorCode: 'AUTH_CHANGE_PASSWORD_NOT_APPLIED',
                });
            }

            // 4. Rotate encrypted password in our DB.
            await upsertUser(userId, newPassword);
            logAction(userId, 'login', 'change-password: success');

            return { success: true };
        } catch (error) {
            console.error('[Auth] change-password error:', error instanceof Error ? error.message : 'unknown');
            logAction(userId, 'login_failed', 'change-password: internal error');
            return reply.status(500).send({
                success: false,
                error: 'Ошибка сервера при смене пароля',
                errorCode: 'AUTH_CHANGE_PASSWORD_INTERNAL',
            });
        }
    });
}
