import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
    BOARD_CATEGORIES,
    BOARD_DEAL_TYPES,
    BOARD_LOST_FOUND_TYPES,
    BOARD_SORTS,
    BOARD_STATUSES,
    createBoardAnnouncement,
    deleteBoardAnnouncement,
    getBoardAnnouncement,
    isBoardError,
    listBoardAnnouncements,
    setBoardAnnouncementFavorite,
    updateBoardAnnouncement,
} from '../services/board.js';
import { logAction } from '../utils/actionLog.js';
import { consumeRateLimit } from '../utils/rateLimit.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 5000;
const MAX_LIST_LIMIT = 50;

const createBodySchema = {
    type: 'object',
    required: ['title', 'body'],
    properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
        body: { type: 'string', minLength: 1, maxLength: MAX_BODY_LENGTH },
        category: { type: 'string', enum: [...BOARD_CATEGORIES] },
        dealType: { type: 'string', enum: [...BOARD_DEAL_TYPES] },
        status: { type: 'string', enum: [...BOARD_STATUSES] },
        price: { type: 'string', maxLength: 80 },
        condition: { type: 'string', maxLength: 80 },
        location: { type: 'string', maxLength: 120 },
        serviceFormat: { type: 'string', maxLength: 120 },
        eventAt: { type: 'string', maxLength: 80 },
        lostFoundType: { type: 'string', enum: [...BOARD_LOST_FOUND_TYPES] },
        contactTelegram: { type: 'string', maxLength: 120 },
        contactInstagram: { type: 'string', maxLength: 120 },
        contactPhone: { type: 'string', maxLength: 60 },
        expiresAt: { type: 'string', maxLength: 80 },
    },
} as const;

const updateBodySchema = {
    type: 'object',
    properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_LENGTH },
        body: { type: 'string', minLength: 1, maxLength: MAX_BODY_LENGTH },
        category: { type: 'string', enum: [...BOARD_CATEGORIES] },
        dealType: { type: 'string', enum: [...BOARD_DEAL_TYPES] },
        status: { type: 'string', enum: [...BOARD_STATUSES] },
        price: { type: 'string', maxLength: 80 },
        condition: { type: 'string', maxLength: 80 },
        location: { type: 'string', maxLength: 120 },
        serviceFormat: { type: 'string', maxLength: 120 },
        eventAt: { type: 'string', maxLength: 80 },
        lostFoundType: { type: 'string', enum: [...BOARD_LOST_FOUND_TYPES] },
        contactTelegram: { type: 'string', maxLength: 120 },
        contactInstagram: { type: 'string', maxLength: 120 },
        contactPhone: { type: 'string', maxLength: 60 },
        expiresAt: { type: 'string', maxLength: 80 },
    },
} as const;

const favoriteBodySchema = {
    type: 'object',
    required: ['favorite'],
    properties: {
        favorite: { type: 'boolean' },
    },
} as const;

const listQuerySchema = {
    type: 'object',
    properties: {
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIST_LIMIT },
        offset: { type: 'integer', minimum: 0 },
        favoriteOnly: { type: 'boolean' },
        mineOnly: { type: 'boolean' },
        q: { type: 'string', maxLength: 160 },
        category: { type: 'string', enum: [...BOARD_CATEGORIES] },
        status: { type: 'string', enum: [...BOARD_STATUSES] },
        sort: { type: 'string', enum: [...BOARD_SORTS] },
    },
} as const;

function parseIntOr(value: string | undefined, fallback: number): number {
    const n = Number.parseInt(value ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function boardRoutes(app: FastifyInstance) {
    // ----- List ------------------------------------------------------------
    app.get<{ Querystring: { limit?: string; offset?: string; favoriteOnly?: boolean; mineOnly?: boolean; q?: string; category?: string; status?: string; sort?: string } }>('/board/announcements', {
        preHandler: [app.authenticate as any],
        schema: { querystring: listQuerySchema },
    }, async (request, reply) => {
        const userId = (request as AuthenticatedRequest).user.userId;
        try {
            const limit = Math.min(parseIntOr(request.query.limit, MAX_LIST_LIMIT), MAX_LIST_LIMIT);
            const offset = parseIntOr(request.query.offset, 0);
            const announcements = await listBoardAnnouncements({
                viewerUserId: userId,
                limit,
                offset,
                favoriteOnly: request.query.favoriteOnly === true,
                mineOnly: request.query.mineOnly === true,
                q: request.query.q,
                category: request.query.category,
                status: request.query.status,
                sort: request.query.sort,
            });
            // Tell the client whether this viewer may moderate (pin / delete any
            // / edit any) so the UI can surface the admin affordances.
            const canModerate = false;
            const canSuperModerate = false;
            return { success: true, data: { announcements, canModerate, canSuperModerate } };
        } catch (error) {
            request.log.error(error, '[Board] list failed');
            return reply.status(500).send({ success: false, error: 'Failed to load announcements' });
        }
    });

    // ----- Favorite (viewer bookmark) --------------------------------------
    app.post<{ Params: { id: string }; Body: { favorite?: boolean } }>('/board/announcements/:id/favorite', {
        preHandler: [app.authenticate as any],
        schema: { body: favoriteBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: request.validationError.message || 'invalid payload' });
        }
        const userId = (request as AuthenticatedRequest).user.userId;
        try {
            const result = await setBoardAnnouncementFavorite(request.params.id, userId, Boolean(request.body?.favorite));
            return { success: true, data: result };
        } catch (error) {
            if (isBoardError(error)) {
                return reply.status(error.statusCode).send({ success: false, error: error.message, errorCode: error.code });
            }
            request.log.error(error, '[Board] favorite failed');
            return reply.status(500).send({ success: false, error: 'Failed to update favorite' });
        }
    });

    // ----- Get one (permalink/share) --------------------------------------
    app.get<{ Params: { id: string } }>('/board/announcements/:id', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        const userId = (request as AuthenticatedRequest).user.userId;
        try {
            const announcement = await getBoardAnnouncement(request.params.id, userId);
            const canModerate = false;
            const canSuperModerate = false;
            return { success: true, data: { announcement, canModerate, canSuperModerate } };
        } catch (error) {
            if (isBoardError(error)) {
                return reply.status(error.statusCode).send({ success: false, error: error.message, errorCode: error.code });
            }
            request.log.error(error, '[Board] get failed');
            return reply.status(500).send({ success: false, error: 'Failed to load announcement' });
        }
    });

    // ----- Create ----------------------------------------------------------
    app.post<{ Body: { title?: string; body?: string; category?: string; dealType?: string; status?: string; price?: string; condition?: string; location?: string; serviceFormat?: string; eventAt?: string; lostFoundType?: string; contactTelegram?: string; contactInstagram?: string; contactPhone?: string; expiresAt?: string } }>('/board/announcements', {
        preHandler: [app.authenticate as any],
        schema: { body: createBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: request.validationError.message || 'invalid payload' });
        }
        const userId = (request as AuthenticatedRequest).user.userId;

        const maxRequests = Number.parseInt(process.env.BOARD_POST_RATE_LIMIT_MAX || '', 10);
        const windowSec = Number.parseInt(process.env.BOARD_POST_RATE_LIMIT_WINDOW_SEC || '', 10);
        const rl = consumeRateLimit(
            `board-post:${userId}`,
            Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : 5,
            (Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 300) * 1000,
        );
        if (!rl.allowed) {
            reply.header('Retry-After', String(rl.retryAfterSec));
            return reply.status(429).send({ success: false, error: 'Too many announcements. Please wait a bit.' });
        }

        try {
            const announcement = await createBoardAnnouncement({
                authorUserId: userId,
                title: request.body?.title,
                body: request.body?.body,
                category: request.body?.category,
                dealType: request.body?.dealType,
                status: request.body?.status,
                price: request.body?.price,
                condition: request.body?.condition,
                location: request.body?.location,
                serviceFormat: request.body?.serviceFormat,
                eventAt: request.body?.eventAt,
                lostFoundType: request.body?.lostFoundType,
                contactTelegram: request.body?.contactTelegram,
                contactInstagram: request.body?.contactInstagram,
                contactPhone: request.body?.contactPhone,
                expiresAt: request.body?.expiresAt,
            });
            logAction(userId, 'board_announcement_create', `Created board announcement ${announcement.entity.id}`, {
                entityId: announcement.entity.id,
                result: 'success',
            });
            return { success: true, data: { announcement } };
        } catch (error) {
            if (isBoardError(error)) {
                return reply.status(error.statusCode).send({ success: false, error: error.message, errorCode: error.code });
            }
            request.log.error(error, '[Board] create failed');
            return reply.status(500).send({ success: false, error: 'Failed to post announcement' });
        }
    });

    // ----- Update (owner; admin override) ---------------------------------
    app.patch<{ Params: { id: string }; Body: { title?: string; body?: string; category?: string; dealType?: string; status?: string; price?: string; condition?: string; location?: string; serviceFormat?: string; eventAt?: string; lostFoundType?: string; contactTelegram?: string; contactInstagram?: string; contactPhone?: string; expiresAt?: string } }>('/board/announcements/:id', {
        preHandler: [app.authenticate as any],
        schema: { body: updateBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: request.validationError.message || 'invalid payload' });
        }
        const userId = (request as AuthenticatedRequest).user.userId;
        const isAdmin = false;
        try {
            const announcement = await updateBoardAnnouncement(
                request.params.id,
                userId,
                {
                    title: request.body?.title,
                    body: request.body?.body,
                    category: request.body?.category,
                    dealType: request.body?.dealType,
                    status: request.body?.status,
                    price: request.body?.price,
                    condition: request.body?.condition,
                    location: request.body?.location,
                    serviceFormat: request.body?.serviceFormat,
                    eventAt: request.body?.eventAt,
                    lostFoundType: request.body?.lostFoundType,
                    contactTelegram: request.body?.contactTelegram,
                    contactInstagram: request.body?.contactInstagram,
                    contactPhone: request.body?.contactPhone,
                    expiresAt: request.body?.expiresAt,
                },
                isAdmin,
            );
            return { success: true, data: { announcement } };
        } catch (error) {
            if (isBoardError(error)) {
                return reply.status(error.statusCode).send({ success: false, error: error.message, errorCode: error.code });
            }
            request.log.error(error, '[Board] update failed');
            return reply.status(500).send({ success: false, error: 'Failed to update announcement' });
        }
    });


    // ----- Delete (owner; admin override) ---------------------------------
    app.delete<{ Params: { id: string } }>('/board/announcements/:id', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        const userId = (request as AuthenticatedRequest).user.userId;
        const isAdmin = false;
        try {
            await deleteBoardAnnouncement(request.params.id, userId, isAdmin);
            logAction(userId, 'board_announcement_delete', `Deleted board announcement ${request.params.id}`, {
                entityId: request.params.id,
                result: 'success',
            });
            return { success: true, data: null };
        } catch (error) {
            if (isBoardError(error)) {
                return reply.status(error.statusCode).send({ success: false, error: error.message, errorCode: error.code });
            }
            request.log.error(error, '[Board] delete failed');
            return reply.status(500).send({ success: false, error: 'Failed to delete announcement' });
        }
    });

}
