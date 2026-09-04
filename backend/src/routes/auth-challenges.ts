/**
 * Routes challenge-входа: «подтверди вход на другом устройстве» через QR или push.
 * Все пути регистрируются под тем же префиксом /api/v3/auth, что и authRoutes.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { findUserIdByPlatonusLogin } from '../services/platonus.js';
import { getUser } from '../services/users.js';
import { createUserSession, findSessionIdByToken } from '../services/sessions.js';
import {
    deleteSubscription,
    getUserSubscriptions,
    sendPushNotification,
    type PushKind,
    type PushPayload,
} from '../services/push.js';
import {
    approveLoginChallenge,
    buildApprovePath,
    buildQrUrl,
    consumeLoginChallenge,
    createLoginChallenge,
    denyLoginChallenge,
    expireLoginChallenge,
    findLoginChallengeByApproveSecret,
    findLoginChallengeByPollSecret,
    formatManualCode,
    isValidApproveSecret,
    normalizeApproveSecret,
    type LoginChallenge,
} from '../services/login-challenges.js';
import { logAction } from '../utils/actionLog.js';
import { consumeRateLimit } from '../utils/rateLimit.js';
import { decrypt, encrypt } from '../utils/crypto.js';
import { readBearerToken, readUserSessionToken, setUserSessionCookie } from '../utils/userSession.js';

const LOGIN_APPROVE_PUSH_KIND: PushKind = 'login_approve';

const MAX_LOGIN_LENGTH = 200;
const MAX_CHALLENGE_ID_LENGTH = 64;
const MAX_APPROVE_SECRET_LENGTH = 64;
const MAX_POLL_SECRET_LENGTH = 128;

interface PushChallengeBody {
    username: string;
}

interface ChallengeStatusQuery {
    challengeId: string;
    pollSecret: string;
}

interface ApproverBody {
    challengeId: string;
    approveSecret: string;
}

const pushChallengeBodySchema = {
    type: 'object',
    required: ['username'],
    properties: {
        username: { type: 'string', minLength: 1, maxLength: MAX_LOGIN_LENGTH },
    },
} as const;

const challengeStatusQuerySchema = {
    type: 'object',
    required: ['challengeId', 'pollSecret'],
    properties: {
        challengeId: { type: 'string', minLength: 1, maxLength: MAX_CHALLENGE_ID_LENGTH },
        pollSecret: { type: 'string', minLength: 1, maxLength: MAX_POLL_SECRET_LENGTH },
    },
} as const;

const approverBodySchema = {
    type: 'object',
    required: ['challengeId', 'approveSecret'],
    properties: {
        challengeId: { type: 'string', minLength: 1, maxLength: MAX_CHALLENGE_ID_LENGTH },
        approveSecret: { type: 'string', minLength: 1, maxLength: MAX_APPROVE_SECRET_LENGTH },
    },
} as const;

const NOT_FOUND_RESPONSE = {
    success: false,
    error: 'Запрос на вход не найден или код неверный',
    errorCode: 'LOGIN_CHALLENGE_NOT_FOUND',
} as const;

function sendRateLimited(reply: FastifyReply, retryAfterSec: number) {
    reply.header('Retry-After', String(retryAfterSec));
    return reply.status(429).send({
        success: false,
        error: 'Слишком много запросов. Попробуйте позже.',
        errorCode: 'RATE_LIMITED',
    });
}

function sendServerError(reply: FastifyReply, scope: string, error: unknown) {
    console.error(`[AuthChallenge] ${scope} error:`, error);
    return reply.status(500).send({ success: false, error: 'Ошибка сервера' });
}

function sendNotPending(reply: FastifyReply, status: LoginChallenge['status']) {
    return reply.status(409).send({
        success: false,
        error: 'Запрос на вход уже неактуален',
        errorCode: 'LOGIN_CHALLENGE_NOT_PENDING',
        data: { status },
    });
}

function clientIp(request: FastifyRequest): string {
    return request.ip || 'unknown';
}

/** userId по логину Platonus: старые аккаунты — через app_platonus_sessions, новые — сам логин. */
async function resolveUserIdByLogin(login: string): Promise<string | null> {
    const mapped = await findUserIdByPlatonusLogin(login);
    if (mapped) return mapped;
    return (await getUser(login)) ? login : null;
}

function serializeChallenge(challenge: LoginChallenge) {
    return {
        challengeId: challenge.challengeId,
        kind: challenge.kind,
        status: challenge.status,
        requesterDeviceName: challenge.requesterDeviceName,
        requesterIp: challenge.requesterIp,
        createdAt: challenge.createdAt.toISOString(),
        expiresAt: challenge.expiresAt.toISOString(),
    };
}

export async function authChallengeRoutes(app: FastifyInstance) {

    /**
     * Общая часть inspect/approve/deny: валидация, нормализация manualCode,
     * поиск по approveSecret и проверка адресата push-challenge. При отказе
     * ответ уже отправлен и возвращается null.
     */
    async function loadChallengeForApprover(
        request: FastifyRequest<{ Body: ApproverBody }>,
        reply: FastifyReply,
        rateBucket: string,
        rateMax: number,
    ): Promise<{ challenge: LoginChallenge; userId: string } | null> {
        const userId = (request.user as any).userId as string;

        const rate = consumeRateLimit(`${rateBucket}:${userId}`, rateMax, 60_000);
        if (!rate.allowed) {
            sendRateLimited(reply, rate.retryAfterSec);
            return null;
        }

        if (request.validationError) {
            reply.status(400).send({ success: false, error: 'Необходимо указать код подтверждения' });
            return null;
        }

        const challengeId = request.body.challengeId.trim();
        const approveSecret = normalizeApproveSecret(request.body.approveSecret);
        if (!challengeId || !isValidApproveSecret(approveSecret)) {
            reply.status(404).send(NOT_FOUND_RESPONSE);
            return null;
        }

        const challenge = await findLoginChallengeByApproveSecret(challengeId, approveSecret);
        if (!challenge) {
            reply.status(404).send(NOT_FOUND_RESPONSE);
            return null;
        }

        // Push-challenge адресован конкретному пользователю: чужой аккаунт не
        // должен ни видеть, ни подтверждать его, даже зная секрет.
        if (challenge.kind === 'push' && challenge.targetUserId !== userId) {
            reply.status(403).send({
                success: false,
                error: 'Этот запрос на вход адресован другому пользователю',
                errorCode: 'LOGIN_CHALLENGE_FORBIDDEN',
            });
            return null;
        }

        return { challenge, userId };
    }

    /**
     * POST /api/v3/auth/login/challenge
     * Создать QR-challenge. Без auth: вызывает устройство, которое хочет войти.
     */
    app.post('/login/challenge', async (request: FastifyRequest, reply: FastifyReply) => {
        const rate = consumeRateLimit(`auth-login-challenge:${clientIp(request)}`, 10, 60_000);
        if (!rate.allowed) return sendRateLimited(reply, rate.retryAfterSec);

        try {
            const { challenge, approveSecret, pollSecret } = await createLoginChallenge({
                kind: 'qr',
                userAgent: request.headers['user-agent'] || null,
                ip: request.ip || null,
            });

            return {
                success: true,
                data: {
                    challengeId: challenge.challengeId,
                    approveSecret,
                    manualCode: formatManualCode(approveSecret),
                    pollSecret,
                    qrUrl: buildQrUrl(challenge.challengeId, approveSecret),
                    expiresAt: challenge.expiresAt.toISOString(),
                },
            };
        } catch (error) {
            return sendServerError(reply, 'Create QR challenge', error);
        }
    });

    /**
     * POST /api/v3/auth/login/push/challenge
     * Push-challenge на устройства пользователя. Без auth. Ответ одинаковой
     * формы независимо от того, существует ли пользователь — чтобы не раскрывать
     * список аккаунтов.
     */
    app.post('/login/push/challenge', {
        schema: { body: pushChallengeBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: PushChallengeBody }>,
        reply: FastifyReply
    ) => {
        const ipRate = consumeRateLimit(`auth-push-challenge-ip:${clientIp(request)}`, 5, 60_000);
        if (!ipRate.allowed) return sendRateLimited(reply, ipRate.retryAfterSec);

        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'Необходимо указать логин' });
        }

        const username = request.body.username.trim();
        if (!username) {
            return reply.status(400).send({ success: false, error: 'Необходимо указать логин' });
        }

        const userRate = consumeRateLimit(`auth-push-challenge-user:${username.toLowerCase()}`, 3, 10 * 60_000);
        if (!userRate.allowed) return sendRateLimited(reply, userRate.retryAfterSec);

        const notDelivered = {
            success: true,
            data: { challengeId: null, pollSecret: null, expiresAt: null, delivered: false },
        };

        try {
            const userId = await resolveUserIdByLogin(username);
            if (!userId) return notDelivered;

            const subscriptions = await getUserSubscriptions(userId);
            if (subscriptions.length === 0) return notDelivered;

            const userAgent = request.headers['user-agent'] || null;
            const ip = request.ip || null;
            const { challenge, approveSecret, pollSecret } = await createLoginChallenge({
                kind: 'push',
                targetUserId: userId,
                userAgent,
                ip,
            });

            // sw.js открывает `payload.url` по клику — сюда идёт путь страницы
            // подтверждения с approveSecret. pollSecret в push не попадает.
            const payload: PushPayload = {
                title: 'Вход в UniverKstu',
                body: `Подтвердите вход: ${challenge.requesterDeviceName ?? 'Неизвестное устройство'}, ${ip ?? 'unknown'}`,
                url: buildApprovePath(challenge.challengeId, approveSecret),
                tag: `login-approve-${challenge.challengeId}`,
                data: { kind: LOGIN_APPROVE_PUSH_KIND, challengeId: challenge.challengeId },
            };

            let delivered = false;
            for (const subscription of subscriptions) {
                const result = await sendPushNotification(subscription, payload);
                if (result.ok) {
                    delivered = true;
                } else if (result.expired) {
                    deleteSubscription(userId, subscription.endpoint).catch((cleanupError) =>
                        console.warn('[AuthChallenge] Failed to delete expired push subscription:', cleanupError)
                    );
                }
            }

            if (!delivered) {
                await expireLoginChallenge(challenge.challengeId).catch((expireError) =>
                    console.warn('[AuthChallenge] Failed to expire undelivered push challenge:', expireError)
                );
                return notDelivered;
            }

            return {
                success: true,
                data: {
                    challengeId: challenge.challengeId,
                    pollSecret,
                    expiresAt: challenge.expiresAt.toISOString(),
                    delivered: true,
                },
            };
        } catch (error) {
            return sendServerError(reply, 'Create push challenge', error);
        }
    });

    /**
     * GET /api/v3/auth/login/challenge/status?challengeId=&pollSecret=
     * Поллинг с устройства-запросчика. Токен выдаётся ровно один раз.
     */
    app.get('/login/challenge/status', {
        schema: { querystring: challengeStatusQuerySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Querystring: ChallengeStatusQuery }>,
        reply: FastifyReply
    ) => {
        const rate = consumeRateLimit(`auth-login-challenge-status:${clientIp(request)}`, 60, 60_000);
        if (!rate.allowed) return sendRateLimited(reply, rate.retryAfterSec);

        if (request.validationError) {
            return reply.status(404).send(NOT_FOUND_RESPONSE);
        }

        const challengeId = request.query.challengeId.trim();
        const pollSecret = request.query.pollSecret.trim();

        try {
            const challenge = await findLoginChallengeByPollSecret(challengeId, pollSecret);
            if (!challenge) {
                return reply.status(404).send(NOT_FOUND_RESPONSE);
            }

            if (challenge.status !== 'approved') {
                return { success: true, data: { status: challenge.status } };
            }

            const consumed = await consumeLoginChallenge(challenge.challengeId);
            if (!consumed) {
                // Кто-то успел забрать токен между чтением и consume — одноразовость.
                return { success: true, data: { status: 'consumed' } };
            }

            const token = decrypt(consumed.tokenEncrypted);
            const userId = consumed.userId;
            setUserSessionCookie(reply, token);
            logAction(userId, 'login', `Login via ${challenge.kind} challenge`, {
                entityId: challenge.challengeId,
                metadata: {
                    challengeKind: challenge.kind,
                    requesterDeviceName: challenge.requesterDeviceName,
                    requesterIp: challenge.requesterIp,
                },
            });

            return {
                success: true,
                data: {
                    status: 'approved',
                    token,
                    user: { userId },
                },
            };
        } catch (error) {
            return sendServerError(reply, 'Challenge status', error);
        }
    });

    /**
     * POST /api/v3/auth/login/challenge/inspect  (auth)
     * Что именно пользователь собирается подтвердить: устройство, IP, время.
     */
    app.post('/login/challenge/inspect', {
        schema: { body: approverBodySchema },
        attachValidation: true,
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Body: ApproverBody }>,
        reply: FastifyReply
    ) => {
        try {
            const loaded = await loadChallengeForApprover(request, reply, 'auth-login-challenge-inspect', 20);
            if (!loaded) return reply;
            return { success: true, data: serializeChallenge(loaded.challenge) };
        } catch (error) {
            return sendServerError(reply, 'Challenge inspect', error);
        }
    });

    /**
     * POST /api/v3/auth/login/challenge/approve  (auth)
     * Выпустить JWT для устройства-запросчика и положить его в challenge.
     */
    app.post('/login/challenge/approve', {
        schema: { body: approverBodySchema },
        attachValidation: true,
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Body: ApproverBody }>,
        reply: FastifyReply
    ) => {
        try {
            const loaded = await loadChallengeForApprover(request, reply, 'auth-login-challenge-approve', 10);
            if (!loaded) return reply;
            const { challenge, userId } = loaded;

            if (challenge.status !== 'pending') {
                return sendNotPending(reply, challenge.status);
            }

            const currentToken = readBearerToken(request) || readUserSessionToken(request);
            const approverSessionId = currentToken
                ? await findSessionIdByToken(currentToken).catch(() => null)
                : null;

            const token = app.jwt.sign({ userId });

            // Сначала атомарный переход pending → approved, и только потом сессия:
            // при гонке двух подтверждений «лишний» токен не должен остаться живым.
            const approved = await approveLoginChallenge({
                challengeId: challenge.challengeId,
                approvedByUserId: userId,
                approvedBySessionId: approverSessionId,
                tokenEncrypted: encrypt(token),
            });
            if (!approved) {
                const current = await findLoginChallengeByApproveSecret(
                    challenge.challengeId,
                    normalizeApproveSecret(request.body.approveSecret),
                );
                return sendNotPending(reply, current?.status ?? 'expired');
            }

            try {
                await createUserSession({
                    userId,
                    token,
                    userAgent: challenge.requesterUserAgent,
                    ip: challenge.requesterIp,
                });
            } catch (sessionError) {
                console.warn('[AuthChallenge] Failed to create requester session:', sessionError);
            }

            logAction(
                userId,
                'login_challenge_approved',
                `Approved ${challenge.kind} login for ${challenge.requesterDeviceName ?? 'unknown device'}, ip=${challenge.requesterIp ?? 'unknown'}`,
                {
                    entityId: challenge.challengeId,
                    result: 'approved',
                    metadata: {
                        challengeKind: challenge.kind,
                        requesterDeviceName: challenge.requesterDeviceName,
                        requesterIp: challenge.requesterIp,
                        approverSessionId,
                    },
                }
            );

            return { success: true, data: { status: 'approved' } };
        } catch (error) {
            return sendServerError(reply, 'Challenge approve', error);
        }
    });

    /**
     * POST /api/v3/auth/login/challenge/deny  (auth)
     * «Это не я»: pending → denied.
     */
    app.post('/login/challenge/deny', {
        schema: { body: approverBodySchema },
        attachValidation: true,
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Body: ApproverBody }>,
        reply: FastifyReply
    ) => {
        try {
            const loaded = await loadChallengeForApprover(request, reply, 'auth-login-challenge-deny', 10);
            if (!loaded) return reply;
            const { challenge, userId } = loaded;

            if (challenge.status === 'denied') {
                return { success: true, data: { status: 'denied' } };
            }
            if (challenge.status !== 'pending') {
                // Уже подтверждён/использован — «отклонить» задним числом нельзя.
                return sendNotPending(reply, challenge.status);
            }

            const denied = await denyLoginChallenge(challenge.challengeId);
            if (!denied) {
                const current = await findLoginChallengeByApproveSecret(
                    challenge.challengeId,
                    normalizeApproveSecret(request.body.approveSecret),
                );
                if (current?.status !== 'denied') {
                    return sendNotPending(reply, current?.status ?? 'expired');
                }
            }

            logAction(
                userId,
                'login_challenge_denied',
                `Denied ${challenge.kind} login for ${challenge.requesterDeviceName ?? 'unknown device'}, ip=${challenge.requesterIp ?? 'unknown'}`,
                {
                    entityId: challenge.challengeId,
                    result: 'rejected',
                    metadata: {
                        challengeKind: challenge.kind,
                        requesterDeviceName: challenge.requesterDeviceName,
                        requesterIp: challenge.requesterIp,
                    },
                }
            );

            return { success: true, data: { status: 'denied' } };
        } catch (error) {
            return sendServerError(reply, 'Challenge deny', error);
        }
    });
}
