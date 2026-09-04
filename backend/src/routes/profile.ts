/**
 * Profile Routes - API endpoints для профиля студента.
 *
 * Univer отключён: маршрут больше не логинится никуда и ничего не парсит.
 * Данные собирает services/profile.ts (сохранённый профиль + сводка Platonus).
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getProfile } from '../services/profile.js';
import { logAction } from '../utils/actionLog.js';

/**
 * Полный ли legacy-профиль в кэше (все разделы Univer на месте). Теперь это
 * только диагностика: пересобрать неполный профиль всё равно негде.
 */
export function hasRichProfileCache(cached: any): boolean {
    return Boolean(
        cached?.profile?.questionnaire
        && Object.prototype.hasOwnProperty.call(cached, 'transcript') && cached.transcript !== null && cached.transcript !== undefined
        && Object.prototype.hasOwnProperty.call(cached, 'recbook') && cached.recbook !== null && cached.recbook !== undefined
        && Object.prototype.hasOwnProperty.call(cached, 'practice') && cached.practice !== null && cached.practice !== undefined
        && Object.prototype.hasOwnProperty.call(cached, 'advisor') && cached.advisor !== null && cached.advisor !== undefined
    );
}

interface AuthenticatedRequest extends FastifyRequest {
    user: { userId: string };
}

export async function profileRoutes(fastify: FastifyInstance) {
    // Получить профиль студента
    fastify.get('/profile', {
        preHandler: [fastify.authenticate]
    }, async (request: AuthenticatedRequest, reply) => {
        const { userId } = request.user;
        const refresh = (request.query as { refresh?: string }).refresh === 'true';

        try {
            const data = await getProfile(userId, refresh);
            const cached = data.source === 'cache';

            logAction(
                userId,
                'profile_view',
                `Opened profile with refresh=${refresh ? 'true' : 'false'}; source=${data.source}; platonus=${data.platonusStatus}; legacyComplete=${hasRichProfileCache(data) ? 'yes' : 'no'}`
            );

            return {
                success: true,
                data,
                cached,
            };
        } catch (error) {
            console.error('[Profile] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка получения профиля'
            });
        }
    });

    // Обновить профиль
    fastify.post('/profile/refresh', {
        preHandler: [fastify.authenticate]
    }, async (_request: AuthenticatedRequest, reply) => {
        // Redirect to GET /profile with refresh=true
        return reply.redirect('/api/v3/profile?refresh=true');
    });
}
