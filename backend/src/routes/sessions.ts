/**
 * Routes для управления сессиями (устройствами)
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { logAction } from '../utils/actionLog.js';
import { readBearerToken, readUserSessionToken } from '../utils/userSession.js';
import {
    getUserSessionsWithCurrent,
    revokeUserSession,
    revokeAllOtherSessions,
} from '../services/sessions.js';

export async function sessionsRoutes(app: FastifyInstance) {

    /**
     * GET /api/v3/auth/sessions
     * Список активных сессий пользователя
     */
    app.get('/sessions', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const currentToken = readBearerToken(request) || readUserSessionToken(request);

        try {
            const sessions = await getUserSessionsWithCurrent(userId, currentToken);
            return {
                success: true,
                data: {
                    sessions: sessions.map((s) => ({
                        sessionId: s.sessionId,
                        deviceName: s.deviceName,
                        platform: s.platform,
                        browser: s.browser,
                        ip: s.ip,
                        createdAt: s.createdAt.toISOString(),
                        lastActiveAt: s.lastActiveAt.toISOString(),
                        isCurrent: s.isCurrent ?? false,
                    })),
                },
            };
        } catch (error) {
            console.error('[Sessions] List error:', error);
            return reply.status(500).send({ success: false, error: 'Ошибка сервера' });
        }
    });

    /**
     * DELETE /api/v3/auth/sessions/:sessionId
     * Отозвать конкретную сессию
     */
    app.delete('/sessions/:sessionId', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Params: { sessionId: string } }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const { sessionId } = request.params;

        if (!sessionId) {
            return reply.status(400).send({ success: false, error: 'sessionId обязателен' });
        }

        try {
            const revoked = await revokeUserSession(userId, sessionId);
            if (!revoked) {
                return reply.status(404).send({ success: false, error: 'Сессия не найдена' });
            }
            logAction(userId, 'session_revoked', `Session revoked: ${sessionId}`);
            return { success: true };
        } catch (error) {
            console.error('[Sessions] Revoke error:', error);
            return reply.status(500).send({ success: false, error: 'Ошибка сервера' });
        }
    });

    /**
     * DELETE /api/v3/auth/sessions
     * Отозвать все сессии кроме текущей
     */
    app.delete('/sessions', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const currentToken = readBearerToken(request) || readUserSessionToken(request);

        if (!currentToken) {
            return reply.status(400).send({ success: false, error: 'Нет текущего токена' });
        }

        try {
            const count = await revokeAllOtherSessions(userId, currentToken);
            logAction(userId, 'sessions_revoke_all', `Revoked ${count} other sessions`);
            return { success: true, revokedCount: count };
        } catch (error) {
            console.error('[Sessions] Revoke all error:', error);
            return reply.status(500).send({ success: false, error: 'Ошибка сервера' });
        }
    });
}
