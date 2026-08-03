import type { FastifyInstance, FastifyRequest } from 'fastify';
import { listLeaderboardSubjects, listSubjectLeaderboard } from '../services/subject-grades.js';

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

const subjectQuerySchema = {
    type: 'object',
    required: ['key'],
    properties: {
        key: { type: 'string', minLength: 1, maxLength: 200 },
    },
} as const;

export async function leaderboardRoutes(app: FastifyInstance) {
    // List subjects that have ranked grades (for the picker).
    app.get('/leaderboard/subjects', {
        preHandler: [app.authenticate as any],
    }, async (request, reply) => {
        try {
            const subjects = await listLeaderboardSubjects();
            return { success: true, data: { subjects } };
        } catch (error) {
            request.log.error(error, '[Leaderboard] subjects failed');
            return reply.status(500).send({ success: false, error: 'Failed to load subjects' });
        }
    });

    // Ranked leaderboard for one subject (key is the normalized subject key,
    // url-encoded — may contain spaces/Cyrillic, hence a querystring).
    app.get<{ Querystring: { key?: string } }>('/leaderboard/subject', {
        preHandler: [app.authenticate as any],
        schema: { querystring: subjectQuerySchema },
        attachValidation: true,
    }, async (request, reply) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: request.validationError.message || 'invalid query' });
        }
        const userId = (request as AuthenticatedRequest).user.userId;
        try {
            const board = await listSubjectLeaderboard((request.query.key || '').trim(), userId, 500);
            return { success: true, data: board };
        } catch (error) {
            request.log.error(error, '[Leaderboard] subject failed');
            return reply.status(500).send({ success: false, error: 'Failed to load leaderboard' });
        }
    });
}
