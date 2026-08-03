import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
    blockChatUser,
    cancelFriendRequest,
    createRoomMessage,
    getChatMessageMaxLength,
    listDialogRooms,
    getMessagingPreferences,
    listFriendOverview,
    unblockChatUser,
    updateMessagingPreferences,
    listRoomMessages,
    markRoomRead,
    removeFriend,
    respondToFriendRequest,
    searchChatUsers,
    sendFriendRequest,
} from '../services/messaging.js';
import { logAction } from '../utils/actionLog.js';
import { consumeRateLimit } from '../utils/rateLimit.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

// Зеркало `MAX_CHAT_MESSAGE_LENGTH` из services/messaging.ts — нужно как литерал
// для schema. Если значение меняется в сервисе, поправь и здесь.
const MAX_CHAT_BODY_LENGTH = 2000;
const MAX_TARGET_USER_ID_LENGTH = 200;
const MAX_BLOCK_REASON_LENGTH = 500;

const preferencesBodySchema = {
    type: 'object',
    properties: {
        dmPrivacy: { type: 'string', enum: ['friends_only', 'open'] },
    },
} as const;

const friendRequestCreateBodySchema = {
    type: 'object',
    required: ['targetUserId'],
    properties: {
        targetUserId: { type: 'string', minLength: 1, maxLength: MAX_TARGET_USER_ID_LENGTH },
    },
} as const;

const blockBodySchema = {
    type: 'object',
    properties: {
        reason: { type: ['string', 'null'], maxLength: MAX_BLOCK_REASON_LENGTH },
    },
} as const;

const friendRequestRespondBodySchema = {
    type: 'object',
    required: ['decision'],
    properties: {
        decision: { type: 'string', enum: ['accept', 'reject'] },
    },
} as const;

const roomMessageCreateBodySchema = {
    type: 'object',
    required: ['body'],
    properties: {
        body: { type: 'string', minLength: 1, maxLength: MAX_CHAT_BODY_LENGTH },
        replyToMessageId: { type: ['string', 'null'], maxLength: 100 },
    },
} as const;

export function isMessagingServiceError(error: unknown): error is Error & { statusCode: number; code: string } {
    return Boolean(
        error
        && typeof error === 'object'
        && 'statusCode' in error
        && 'code' in error
        && typeof (error as { statusCode?: unknown }).statusCode === 'number'
        && typeof (error as { code?: unknown }).code === 'string'
    );
}

function sendMessagingError(reply: FastifyReply, error: unknown, fallbackMessage: string) {
    if (isMessagingServiceError(error)) {
        return reply.status(error.statusCode).send({
            success: false,
            error: error.message,
            errorCode: error.code,
        });
    }

    return reply.status(500).send({
        success: false,
        error: fallbackMessage,
    });
}

export async function messagingRoutes(app: FastifyInstance) {
    app.get<{ Querystring: { q?: string } }>('/chat/users/search', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const users = await searchChatUsers(authRequest.user.userId, request.query.q || '');
            return {
                success: true,
                data: { users },
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to search users');
            return sendMessagingError(reply, error, 'Failed to search users');
        }
    });

    app.get('/chat/friends', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const overview = await listFriendOverview(authRequest.user.userId);
            return {
                success: true,
                data: overview,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to load friends');
            return sendMessagingError(reply, error, 'Failed to load friends');
        }
    });

    app.get('/chat/preferences', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const preferences = await getMessagingPreferences(authRequest.user.userId);
            return {
                success: true,
                data: preferences,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to load messaging preferences');
            return sendMessagingError(reply, error, 'Failed to load messaging preferences');
        }
    });

    app.post<{ Body: { dmPrivacy?: 'friends_only' | 'open' } }>('/chat/preferences', {
        preHandler: [app.authenticate as any],
        schema: { body: preferencesBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'invalid dmPrivacy value' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const preferences = await updateMessagingPreferences(
                authRequest.user.userId,
                request.body?.dmPrivacy === 'open' ? 'open' : 'friends_only'
            );
            return {
                success: true,
                data: preferences,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to update messaging preferences');
            return sendMessagingError(reply, error, 'Failed to update messaging preferences');
        }
    });

    app.post<{ Body: { targetUserId?: string } }>('/chat/friends/requests', {
        preHandler: [app.authenticate as any],
        schema: { body: friendRequestCreateBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'targetUserId is required' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const friendRequest = await sendFriendRequest(authRequest.user.userId, request.body?.targetUserId || '');
            logAction(
                authRequest.user.userId,
                'friend_request_create',
                `Sent friend request to ${friendRequest.targetUserId}`,
                { targetUserId: friendRequest.targetUserId, entityId: friendRequest.id, result: 'success' }
            );
            return {
                success: true,
                data: friendRequest,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to send friend request');
            return sendMessagingError(reply, error, 'Failed to send friend request');
        }
    });

    app.post<{ Params: { targetUserId: string }; Body: { reason?: string | null } }>('/chat/blocks/:targetUserId', {
        preHandler: [app.authenticate as any],
        schema: { body: blockBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'invalid block payload' });
        }
        try {
            const authRequest = request as AuthenticatedRequest;
            const blocked = await blockChatUser(authRequest.user.userId, request.params.targetUserId, request.body?.reason || null);
            return {
                success: true,
                data: blocked,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to block user');
            return sendMessagingError(reply, error, 'Failed to block user');
        }
    });

    app.post<{ Params: { targetUserId: string } }>('/chat/blocks/:targetUserId/unblock', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await unblockChatUser(authRequest.user.userId, request.params.targetUserId);
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to unblock user');
            return sendMessagingError(reply, error, 'Failed to unblock user');
        }
    });

    app.post<{ Params: { requestId: string }; Body: { decision?: 'accept' | 'reject' } }>('/chat/friends/requests/:requestId/respond', {
        preHandler: [app.authenticate as any],
        schema: { body: friendRequestRespondBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'decision must be "accept" or "reject"' });
        }
        const decision = request.body.decision === 'reject' ? 'rejected' : 'accepted';
        try {
            const authRequest = request as AuthenticatedRequest;
            const friendRequest = await respondToFriendRequest(authRequest.user.userId, request.params.requestId, decision);
            logAction(
                authRequest.user.userId,
                decision === 'accepted' ? 'friend_request_accept' : 'friend_request_reject',
                `${decision === 'accepted' ? 'Accepted' : 'Rejected'} friend request ${friendRequest.id}`,
                { targetUserId: friendRequest.requesterUserId, entityId: friendRequest.id, result: decision === 'accepted' ? 'approved' : 'rejected' }
            );
            return {
                success: true,
                data: friendRequest,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to respond to friend request');
            return sendMessagingError(reply, error, 'Failed to process friend request');
        }
    });

    app.post<{ Params: { requestId: string } }>('/chat/friends/requests/:requestId/cancel', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const friendRequest = await cancelFriendRequest(authRequest.user.userId, request.params.requestId);
            logAction(
                authRequest.user.userId,
                'friend_request_cancel',
                `Cancelled friend request ${friendRequest.id}`,
                { targetUserId: friendRequest.targetUserId, entityId: friendRequest.id, result: 'info' }
            );
            return {
                success: true,
                data: friendRequest,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to cancel friend request');
            return sendMessagingError(reply, error, 'Failed to cancel friend request');
        }
    });

    app.post<{ Params: { targetUserId: string } }>('/chat/friends/:targetUserId/remove', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const result = await removeFriend(authRequest.user.userId, request.params.targetUserId);
            logAction(
                authRequest.user.userId,
                'friend_remove',
                `Removed friend ${result.targetUserId}`,
                { targetUserId: result.targetUserId, entityId: result.targetUserId, result: 'deleted' }
            );
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to remove friend');
            return sendMessagingError(reply, error, 'Failed to remove friend');
        }
    });

    app.get('/chat/rooms', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const rooms = await listDialogRooms(authRequest.user.userId);
            return {
                success: true,
                data: {
                    rooms,
                    maxMessageLength: getChatMessageMaxLength(),
                },
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to load rooms');
            return sendMessagingError(reply, error, 'Failed to load rooms');
        }
    });

    app.get<{ Params: { roomId: string }; Querystring: { limit?: string } }>('/chat/rooms/:roomId', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            const parsedLimit = Number.parseInt(request.query.limit || '', 10);
            const detail = await listRoomMessages(
                authRequest.user.userId,
                request.params.roomId,
                Number.isFinite(parsedLimit) ? parsedLimit : undefined
            );
            return {
                success: true,
                data: detail,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to load room');
            return sendMessagingError(reply, error, 'Failed to load room');
        }
    });

    app.post<{ Params: { roomId: string } }>('/chat/rooms/:roomId/read', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const authRequest = request as AuthenticatedRequest;
            await markRoomRead(authRequest.user.userId, request.params.roomId);
            logAction(
                authRequest.user.userId,
                'chat_room_read',
                `Marked room ${request.params.roomId} as read`,
                { entityId: request.params.roomId, result: 'success' }
            );
            return {
                success: true,
                data: { roomId: request.params.roomId },
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to mark room as read');
            return sendMessagingError(reply, error, 'Failed to mark room as read');
        }
    });

    app.post<{ Params: { roomId: string }; Body: { body?: string; replyToMessageId?: string | null } }>('/chat/rooms/:roomId/messages', {
        preHandler: [app.authenticate as any],
        schema: { body: roomMessageCreateBodySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: request.validationError.message || 'invalid message payload' });
        }
        const authRequest = request as AuthenticatedRequest;
        const userId = authRequest.user.userId;
        const roomId = request.params.roomId;
        const maxRequests = Number.parseInt(process.env.CHAT_ROOM_POST_RATE_LIMIT_MAX || '', 10);
        const windowSec = Number.parseInt(process.env.CHAT_ROOM_POST_RATE_LIMIT_WINDOW_SEC || '', 10);
        const rateLimit = consumeRateLimit(
            `room-chat-post:${userId}`,
            Number.isFinite(maxRequests) && maxRequests > 0 ? maxRequests : 10,
            (Number.isFinite(windowSec) && windowSec > 0 ? windowSec : 60) * 1000
        );

        if (!rateLimit.allowed) {
            reply.header('Retry-After', String(rateLimit.retryAfterSec));
            return reply.status(429).send({
                success: false,
                error: 'Too many messages. Please wait a bit.',
            });
        }

        try {
            const message = await createRoomMessage({
                viewerUserId: userId,
                roomId,
                body: request.body?.body || '',
                replyToMessageId: request.body?.replyToMessageId || null,
            });
            logAction(
                userId,
                'chat_direct_message_create',
                `Created ${message.roomKind} message ${message.id}`,
                {
                    entityId: message.id,
                    targetUserId: message.replyTo?.authorUserId ?? null,
                    groupKey: null,
                    result: 'success',
                }
            );
            return {
                success: true,
                data: message,
            };
        } catch (error) {
            request.log.error(error, '[Messaging] Failed to create room message');
            return sendMessagingError(reply, error, 'Failed to create room message');
        }
    });

}
