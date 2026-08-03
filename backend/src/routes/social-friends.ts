/**
 * Universal social friendship REST routes — Phase 1c foundation for the
 * upcoming Phase 1e cutover.
 *
 * These endpoints expose `app_social_friendship` (see services/social-friends.ts)
 * over HTTP under `/api/v3/social/friends/*`. They are deliberately additive:
 *
 *   - no legacy route (`/api/v3/chat/friends/...`) is removed or rerouted
 *   - the legacy `services/messaging.ts` keeps mirroring writes via the
 *     `friends-shim.ts` dual-write
 *   - frontend pages can adopt these incrementally behind a feature flag
 *
 * Auth: every route requires `app.authenticate`. The service performs the
 * actual authorization (only the addressee can respond; only the
 * requester can cancel; either party can remove); the route layer just
 * maps thrown `SocialFriendshipError` to HTTP status codes.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
    SocialFriendshipError,
    cancelFriendRequest,
    listFriendsForUser,
    listPendingRequestsForUser,
    removeFriend,
    respondToFriendRequest,
    sendFriendRequest,
} from '../services/social-friends.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

const MAX_USER_ID_LENGTH = 200;
const MAX_REQUEST_ID_LENGTH = 100;
const MAX_NOTE_LENGTH = 500;

// === Schemas =================================================================

const createRequestBodySchema = {
    type: 'object',
    required: ['addresseeId'],
    properties: {
        addresseeId: { type: 'string', minLength: 1, maxLength: MAX_USER_ID_LENGTH },
        note: { type: ['string', 'null'], maxLength: MAX_NOTE_LENGTH },
    },
} as const;

const respondBodySchema = {
    type: 'object',
    required: ['response'],
    properties: {
        response: { type: 'string', enum: ['accepted', 'rejected'] },
    },
} as const;

const requestIdParamsSchema = {
    type: 'object',
    required: ['id'],
    properties: {
        id: { type: 'string', minLength: 1, maxLength: MAX_REQUEST_ID_LENGTH },
    },
} as const;

const removeFriendParamsSchema = {
    type: 'object',
    required: ['userId'],
    properties: {
        userId: { type: 'string', minLength: 1, maxLength: MAX_USER_ID_LENGTH },
    },
} as const;

const requestsListQuerySchema = {
    type: 'object',
    required: ['direction'],
    properties: {
        direction: { type: 'string', enum: ['incoming', 'outgoing'] },
    },
} as const;

// === Error mapping ===========================================================

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
    if (error instanceof SocialFriendshipError) {
        return reply.status(error.statusCode).send({
            success: false,
            error: error.message,
            errorCode: error.code,
        });
    }
    return reply.status(500).send({
        success: false,
        error: 'Internal social-friendship error',
        errorCode: 'SOCIAL_FRIENDSHIP_INTERNAL_ERROR',
    });
}

// === Routes ==================================================================

export async function socialFriendshipRoutes(app: FastifyInstance) {
    // ----- Send a friend request --------------------------------------------
    app.post<{ Body: { addresseeId?: string; note?: string | null } }>(
        '/social/friends/requests',
        {
            preHandler: [app.authenticate as any],
            schema: { body: createRequestBodySchema },
            attachValidation: true,
        },
        async (request, reply) => {
            if (request.validationError) {
                return reply.status(400).send({
                    success: false,
                    error: request.validationError.message || 'invalid payload',
                    errorCode: 'SOCIAL_FRIENDSHIP_REQUIRED',
                });
            }
            try {
                const authRequest = request as AuthenticatedRequest;
                const friendship = await sendFriendRequest(
                    authRequest.user.userId,
                    request.body?.addresseeId || '',
                    request.body?.note ?? null,
                );
                return reply.send({ success: true, data: friendship });
            } catch (error) {
                request.log.error(error, '[SocialFriends] sendFriendRequest failed');
                return sendError(reply, error);
            }
        },
    );

    // ----- Respond to a friend request --------------------------------------
    app.post<{ Params: { id: string }; Body: { response?: 'accepted' | 'rejected' } }>(
        '/social/friends/requests/:id/respond',
        {
            preHandler: [app.authenticate as any],
            schema: { params: requestIdParamsSchema, body: respondBodySchema },
            attachValidation: true,
        },
        async (request, reply) => {
            if (request.validationError) {
                return reply.status(400).send({
                    success: false,
                    error: request.validationError.message || 'invalid payload',
                    errorCode: 'SOCIAL_FRIENDSHIP_INVALID_RESPONSE',
                });
            }
            try {
                const authRequest = request as AuthenticatedRequest;
                const response = request.body?.response;
                if (response !== 'accepted' && response !== 'rejected') {
                    return reply.status(400).send({
                        success: false,
                        error: 'response must be "accepted" or "rejected"',
                        errorCode: 'SOCIAL_FRIENDSHIP_INVALID_RESPONSE',
                    });
                }
                const updated = await respondToFriendRequest(
                    request.params.id,
                    authRequest.user.userId,
                    response,
                );
                return reply.send({ success: true, data: updated });
            } catch (error) {
                request.log.error(error, '[SocialFriends] respondToFriendRequest failed');
                return sendError(reply, error);
            }
        },
    );

    // ----- Cancel an outgoing friend request --------------------------------
    app.post<{ Params: { id: string } }>(
        '/social/friends/requests/:id/cancel',
        {
            preHandler: [app.authenticate as any],
            schema: { params: requestIdParamsSchema },
            attachValidation: true,
        },
        async (request, reply) => {
            if (request.validationError) {
                return reply.status(400).send({
                    success: false,
                    error: 'invalid request id',
                    errorCode: 'SOCIAL_FRIENDSHIP_REQUIRED',
                });
            }
            try {
                const authRequest = request as AuthenticatedRequest;
                const updated = await cancelFriendRequest(
                    request.params.id,
                    authRequest.user.userId,
                );
                return reply.send({ success: true, data: updated });
            } catch (error) {
                request.log.error(error, '[SocialFriends] cancelFriendRequest failed');
                return sendError(reply, error);
            }
        },
    );

    // ----- Remove a friend ---------------------------------------------------
    app.delete<{ Params: { userId: string } }>(
        '/social/friends/:userId',
        {
            preHandler: [app.authenticate as any],
            schema: { params: removeFriendParamsSchema },
            attachValidation: true,
        },
        async (request, reply) => {
            if (request.validationError) {
                return reply.status(400).send({
                    success: false,
                    error: 'invalid userId',
                    errorCode: 'SOCIAL_FRIENDSHIP_REQUIRED',
                });
            }
            try {
                const authRequest = request as AuthenticatedRequest;
                const removed = await removeFriend(
                    authRequest.user.userId,
                    request.params.userId,
                );
                return reply.send({ success: true, data: removed });
            } catch (error) {
                request.log.error(error, '[SocialFriends] removeFriend failed');
                return sendError(reply, error);
            }
        },
    );

    // ----- List current friends ---------------------------------------------
    app.get(
        '/social/friends/me',
        {
            preHandler: [app.authenticate as any],
        },
        async (request, reply) => {
            try {
                const authRequest = request as AuthenticatedRequest;
                const friends = await listFriendsForUser(authRequest.user.userId);
                return reply.send({ success: true, data: { friends } });
            } catch (error) {
                request.log.error(error, '[SocialFriends] listFriendsForUser failed');
                return sendError(reply, error);
            }
        },
    );

    // ----- List pending requests --------------------------------------------
    app.get<{ Querystring: { direction?: 'incoming' | 'outgoing' } }>(
        '/social/friends/requests',
        {
            preHandler: [app.authenticate as any],
            schema: { querystring: requestsListQuerySchema },
            attachValidation: true,
        },
        async (request, reply) => {
            if (request.validationError) {
                return reply.status(400).send({
                    success: false,
                    error: 'direction must be "incoming" or "outgoing"',
                    errorCode: 'SOCIAL_FRIENDSHIP_INVALID_DIRECTION',
                });
            }
            try {
                const authRequest = request as AuthenticatedRequest;
                const direction = request.query.direction || 'incoming';
                const requests = await listPendingRequestsForUser(
                    authRequest.user.userId,
                    direction,
                );
                return reply.send({ success: true, data: { requests } });
            } catch (error) {
                request.log.error(error, '[SocialFriends] listPendingRequestsForUser failed');
                return sendError(reply, error);
            }
        },
    );
}
