import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getAcademicContext } from '../services/academic-context.js';
import { traceRuntime } from '../utils/runtimeTrace.js';

interface AcademicQuery {
    refresh?: string;
}

export async function academicRoutes(app: FastifyInstance) {
    app.get('/academic/context', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Querystring: AcademicQuery }>,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;
        const forceRefresh = request.query.refresh === 'true';

        const result = await getAcademicContext(userId, forceRefresh);
        if (!result.context) {
            const message = result.error || 'Не удалось получить академический контекст';
            const userMissing = message.includes('Пользователь не найден');
            const univerAuthFailed = message.includes('Ошибка авторизации Univer');

            if (univerAuthFailed) {
                return reply.send({
                    success: true,
                    degraded: true,
                    stale: false,
                    authRequired: true,
                    errorCode: 'UNIVER_AUTH_REQUIRED',
                    error: message,
                    data: null,
                });
            }

            if (!userMissing) {
                const diagnosticMessage = `[Academic Context] Failed for ${userId}: ${message}`;
                traceRuntime({
                    source: 'backend',
                    scope: 'academic.context',
                    event: 'academic_context_failed',
                    level: 'error',
                    userId,
                    message: diagnosticMessage,
                    metadata: {
                        forceRefresh,
                        errorMessage: message,
                    },
                });
            }

            const status = userMissing ? 404 : 502;
            return reply.status(status).send({
                success: false,
                error: message,
            });
        }

        return {
            success: true,
            data: result.context,
            cached: result.cached,
            stale: result.stale || false,
        };
    });
}
