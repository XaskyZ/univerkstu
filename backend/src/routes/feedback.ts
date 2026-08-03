import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
    getOwnRating,
    submitUserFeedback,
    submitUserRating,
    type FeedbackCategory,
} from '../services/feedback.js';
import { logAction } from '../utils/actionLog.js';
import { consumeRateLimit } from '../utils/rateLimit.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

type RatingRequest = FastifyRequest<{ Body: { rating?: number; page?: string | null; appVersion?: string | null } }> & {
    user: { userId: string };
};

type FeedbackRequest = FastifyRequest<{ Body: { category?: string; message?: string; rating?: number | null; page?: string | null; appVersion?: string | null } }> & {
    user: { userId: string };
};

// Защита от megabyte-size payload'ов от одного пользователя.
const MAX_MESSAGE_LENGTH = 4000;
const MAX_PAGE_LENGTH = 200;
const MAX_APP_VERSION_LENGTH = 50;

// JSON Schemas — fastify прогоняет body через Ajv до того, как handler побежит.
// `attachValidation: true` ниже превращает ошибки валидации в `request.validationError`,
// чтобы мы могли вернуть наш стандартный `{success, error}` envelope вместо дефолтного
// fastify `{statusCode, error, message}`. Это образцовый шаблон для миграции остальных
// route-файлов (см. loop-state queue).
const ratingBodySchema = {
    type: 'object',
    required: ['rating'],
    properties: {
        rating: { type: 'number', minimum: 1, maximum: 5 },
        page: { type: ['string', 'null'], maxLength: MAX_PAGE_LENGTH },
        appVersion: { type: ['string', 'null'], maxLength: MAX_APP_VERSION_LENGTH },
    },
} as const;

const messageBodySchema = {
    type: 'object',
    required: ['message'],
    properties: {
        message: { type: 'string', minLength: 3, maxLength: MAX_MESSAGE_LENGTH },
        category: { type: 'string', enum: ['bug', 'other', 'suggestion'], default: 'suggestion' },
        rating: { type: ['number', 'null'], minimum: 1, maximum: 5 },
        page: { type: ['string', 'null'], maxLength: MAX_PAGE_LENGTH },
        appVersion: { type: ['string', 'null'], maxLength: MAX_APP_VERSION_LENGTH },
    },
} as const;

// Оба пользовательских эндпоинта пишут строки в хранилище отзывов от имени
// авторизованного пользователя и до сих пор не были ограничены ничем, кроме
// размера payload. Троттлинг — по тому же шаблону, что в routes/board.ts
// (`board-post:{userId}`, 5/300s): рейтинг ставят раз в сессию, сообщения
// отправляют единицами, поэтому окна узкие, но не мешают нормальной работе.
const FEEDBACK_RATING_RATE_MAX = 10;
const FEEDBACK_RATING_RATE_WINDOW_SEC = 300;
const FEEDBACK_MESSAGE_RATE_MAX = 5;
const FEEDBACK_MESSAGE_RATE_WINDOW_SEC = 300;

function envPositiveInt(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function normalizeCategory(value: unknown): FeedbackCategory {
    if (value === 'bug' || value === 'other') return value;
    return 'suggestion';
}

export async function feedbackRoutes(app: FastifyInstance) {
    app.get('/feedback/me', {
        preHandler: [app.authenticate as any],
    }, async (request: AuthenticatedRequest) => {
        try {
            const rating = await getOwnRating(request.user.userId);
            return { success: true, rating };
        } catch (error) {
            request.log.warn(
                { error, userId: request.user.userId },
                '[feedback] feedback/me degraded because feedback storage is unavailable',
            );
            return { success: true, rating: null };
        }
    });

    app.post<{ Body: { rating?: number; page?: string | null; appVersion?: string | null } }>('/feedback/rating', {
        preHandler: [app.authenticate as any],
        schema: { body: ratingBodySchema },
        attachValidation: true,
    }, async (request: RatingRequest, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message,
            });
        }
        const ratingRl = consumeRateLimit(
            `feedback-rating:${request.user.userId}`,
            envPositiveInt('FEEDBACK_RATING_RATE_LIMIT_MAX', FEEDBACK_RATING_RATE_MAX),
            envPositiveInt('FEEDBACK_RATING_RATE_LIMIT_WINDOW_SEC', FEEDBACK_RATING_RATE_WINDOW_SEC) * 1000,
        );
        if (!ratingRl.allowed) {
            reply.header('Retry-After', String(ratingRl.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Too many ratings. Please wait a bit.',
            });
        }
        // After Ajv: rating is a finite number in [1, 5], page/appVersion are length-capped.
        const rating = Math.round(request.body.rating as number);

        let stored: number;
        try {
            stored = await submitUserRating(request.user.userId, rating, {
                lastPath: request.body?.page ?? null,
                appVersion: request.body?.appVersion ?? null,
            });
        } catch (error) {
            request.log.warn(
                { error, userId: request.user.userId },
                '[feedback] submit rating failed because feedback storage is unavailable',
            );
            return reply.status(503).send({ success: false, error: 'feedback storage is temporarily unavailable' });
        }

        logAction(request.user.userId, 'app_rating_submit', `Submitted app rating ${stored}`, {
            result: 'success',
            metadata: {
                rating: stored,
                page: request.body?.page || null,
                appVersion: request.body?.appVersion || null,
            },
        });

        return { success: true, rating: stored };
    });

    app.post<{ Body: { category?: string; message?: string; rating?: number | null; page?: string | null; appVersion?: string | null } }>('/feedback/message', {
        preHandler: [app.authenticate as any],
        schema: { body: messageBodySchema },
        attachValidation: true,
    }, async (request: FeedbackRequest, reply) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message,
            });
        }
        const messageRl = consumeRateLimit(
            `feedback-message:${request.user.userId}`,
            envPositiveInt('FEEDBACK_MESSAGE_RATE_LIMIT_MAX', FEEDBACK_MESSAGE_RATE_MAX),
            envPositiveInt('FEEDBACK_MESSAGE_RATE_LIMIT_WINDOW_SEC', FEEDBACK_MESSAGE_RATE_WINDOW_SEC) * 1000,
        );
        if (!messageRl.allowed) {
            reply.header('Retry-After', String(messageRl.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Too many messages. Please wait a bit.',
            });
        }
        // Ajv enforces minLength: 3 on the raw string. Trim afterwards in case of
        // whitespace-only content that satisfies raw min but not semantic min.
        const message = (request.body.message ?? '').trim();
        if (message.length < 3) {
            return reply.status(400).send({ success: false, error: 'message is too short' });
        }

        const category = normalizeCategory(request.body?.category);
        const rating = typeof request.body?.rating === 'number'
            ? Math.round(request.body.rating)
            : null;

        let id: string;
        try {
            id = await submitUserFeedback(request.user.userId, category, message, {
                rating,
                page: request.body?.page ?? null,
                appVersion: request.body?.appVersion ?? null,
            });
        } catch (error) {
            request.log.warn(
                { error, userId: request.user.userId, category },
                '[feedback] submit message failed because feedback storage is unavailable',
            );
            return reply.status(503).send({ success: false, error: 'feedback storage is temporarily unavailable' });
        }

        logAction(request.user.userId, 'app_feedback_submit', `Submitted ${category} feedback`, {
            result: 'success',
            entityId: id,
            metadata: {
                category,
                rating,
                page: request.body?.page || null,
                messageLength: message.length,
                appVersion: request.body?.appVersion || null,
            },
        });

        return { success: true, id };
    });
}
