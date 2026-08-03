import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
    createGlobalChatMessage,
    getGlobalChatMessageMaxLength,
    getGlobalChatViewerState,
    listGlobalChatMessages,
    reportGlobalChatMessage,
} from '../services/global-chat.js';
import { logAction } from '../utils/actionLog.js';
import { consumeRateLimit } from '../utils/rateLimit.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

// Зеркала констант из services/global-chat.ts.
// Schema-валидация даёт ранний 400 до rate-limit consumption.
const MAX_GLOBAL_BODY_LENGTH = 2000;
const MAX_REPORT_REASON_LENGTH = 160;
const MAX_REPORT_DETAILS_LENGTH = 1000;

const globalMessageCreateBodySchema = {
    type: 'object',
    required: ['body'],
    properties: {
        body: { type: 'string', minLength: 1, maxLength: MAX_GLOBAL_BODY_LENGTH },
    },
} as const;

// reason is optional — frontend no longer uses window.prompt for moderation actions.
const globalReportBodySchema = {
    type: 'object',
    properties: {
        reason: { type: ['string', 'null'], maxLength: MAX_REPORT_REASON_LENGTH },
        details: { type: ['string', 'null'], maxLength: MAX_REPORT_DETAILS_LENGTH },
    },
} as const;


export function isGlobalChatServiceError(error: unknown): error is Error & { statusCode: number; code: string } {
    return Boolean(
        error
        && typeof error === 'object'
        && 'statusCode' in error
        && 'code' in error
        && typeof (error as { statusCode?: unknown }).statusCode === 'number'
        && typeof (error as { code?: unknown }).code === 'string'
    );
}

export function parseMuteDurationMinutes(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    const normalized = Math.trunc(value);
    return normalized > 0 ? normalized : null;
}

export async function globalChatRoutes(app: FastifyInstance) {
    app.get<{ Querystring: { limit?: string } }>('/chat/global', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const parsedLimit = Number.parseInt(request.query.limit || '', 10);
            const canModerate = false;

            const [messages, viewer] = await Promise.all([
                listGlobalChatMessages(authRequest.user.userId, {
                    limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined,
                    canModerate,
                }),
                getGlobalChatViewerState(authRequest.user.userId, canModerate),
            ]);

            return {
                success: true,
                data: {
                    messages,
                    maxMessageLength: getGlobalChatMessageMaxLength(),
                    viewer,
                },
            };
        } catch (error) {
            request.log.error(error, '[Global Chat] Failed to load messages');
            return reply.status(500).send({
                success: false,
                error: 'Failed to load global chat',
            });
        }
    });

    app.post<{ Body: { body?: string } }>('/chat/global/messages', {
        preHandler: [app.authenticate as any],
        schema: { body: globalMessageCreateBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: request.validationError.message || 'invalid message payload' });
        }
        const authRequest = request as AuthenticatedRequest;
        const userId = authRequest.user.userId;
        const maxRequests = Number.parseInt(process.env.GLOBAL_CHAT_POST_RATE_LIMIT_MAX || '', 10);
        const windowSec = Number.parseInt(process.env.GLOBAL_CHAT_POST_RATE_LIMIT_WINDOW_SEC || '', 10);
        const rl = consumeRateLimit(
            `global-chat-post:${userId}`,
            Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : 8,
            (Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 60) * 1000
        );

        if (!rl.allowed) {
            reply.header('Retry-After', String(rl.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Too many messages. Please wait a bit.',
            });
        }

        try {
            const canModerate = false;

            const created = await createGlobalChatMessage({
                authorUserId: userId,
                body: request.body?.body || '',
                canModerate,
            });

            logAction(
                userId,
                'global_chat_message_create',
                `Created global chat message ${created.id}`,
                { entityId: created.id, result: 'success' }
            );

            return {
                success: true,
                data: created,
            };
        } catch (error) {
            if (isGlobalChatServiceError(error)) {
                return reply.status(error.statusCode).send({
                    success: false,
                    error: error.message,
                    errorCode: error.code,
                });
            }

            request.log.error(error, '[Global Chat] Failed to create message');
            return reply.status(500).send({
                success: false,
                error: 'Failed to send message',
            });
        }
    });

    app.post<{ Params: { messageId: string }; Body: { reason?: string | null; details?: string | null } }>('/chat/global/messages/:messageId/report', {
        preHandler: [app.authenticate as any],
        schema: { body: globalReportBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: request.validationError.message || 'invalid report payload' });
        }
        const authRequest = request as AuthenticatedRequest;
        const userId = authRequest.user.userId;

        // Жалобы — редкое действие, но ничем не ограниченное: сервис намеренно
        // не дедуплицирует их, поэтому троттлинг живёт здесь (тот же шаблон,
        // что и у `global-chat-post` выше).
        const reportMax = Number.parseInt(process.env.GLOBAL_CHAT_REPORT_RATE_LIMIT_MAX || '', 10);
        const reportWindowSec = Number.parseInt(process.env.GLOBAL_CHAT_REPORT_RATE_LIMIT_WINDOW_SEC || '', 10);
        const reportRl = consumeRateLimit(
            `global-chat-report:${userId}`,
            Number.isFinite(reportMax) && reportMax > 0 ? reportMax : 10,
            (Number.isFinite(reportWindowSec) && reportWindowSec > 0 ? reportWindowSec : 300) * 1000
        );
        if (!reportRl.allowed) {
            reply.header('Retry-After', String(reportRl.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Too many reports. Please wait a bit.',
            });
        }

        try {
            const report = await reportGlobalChatMessage({
                messageId: request.params.messageId,
                reporterUserId: userId,
                reason: request.body?.reason || '',
                details: request.body?.details || null,
            });

            logAction(
                userId,
                'global_chat_message_report',
                `Reported global chat message ${report.messageId}`,
                { entityId: report.messageId, result: 'success', targetUserId: report.messageAuthorUserId }
            );

            return {
                success: true,
                data: report,
            };
        } catch (error) {
            if (isGlobalChatServiceError(error)) {
                return reply.status(error.statusCode).send({
                    success: false,
                    error: error.message,
                    errorCode: error.code,
                });
            }

            request.log.error(error, '[Global Chat] Failed to report message');
            return reply.status(500).send({
                success: false,
                error: 'Failed to report message',
            });
        }
    });
}
