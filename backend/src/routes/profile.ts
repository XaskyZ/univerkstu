/**
 * Profile Routes - API endpoints для профиля студента
 * Использует HTTP вместо Playwright
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { parseFullProfile } from '../parsers/profile.js';
import { getCachedData, setCachedData } from '../db/mongo.js';
import { logAction } from '../utils/actionLog.js';
import { getUserPassword } from '../services/users.js';

const PROFILE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

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
            const cacheKey = `profile_${userId}`;

            // Проверяем кэш
            if (!refresh) {
                const cached = await getCachedData(cacheKey);
                if (cached && hasRichProfileCache(cached)) {
                    logAction(userId, 'profile_view', 'Opened profile from cache');
                    return {
                        success: true,
                        data: cached,
                        cached: true
                    };
                }
            }

            const password = await getUserPassword(userId);
            console.log(`[Profile] Password lookup for ${userId}:`, password ? 'found' : 'missing');

            if (!password) {
                return reply.status(401).send({
                    success: false,
                    error: 'Требуется повторная авторизация',
                    errorCode: 'AUTH_RELOGIN_REQUIRED'
                });
            }
            console.log(`[Profile] Password ready, length: ${password.length}`);

            // Парсим профиль через HTTP (без Playwright!)
            const { profile, iup, attestation, transcript, recbook, practice, advisor, educPlan, academicOptions } = await parseFullProfile(userId, password);

            const now = new Date();
            const result = {
                profile,
                iup,
                attestation,
                transcript,
                recbook,
                practice,
                advisor,
                educPlan,
                academicOptions,
                meta: {
                    parsedAt: now.toISOString(),
                    userId
                },
                cachedAt: now.toISOString(),
                expiresAt: new Date(now.getTime() + PROFILE_CACHE_TTL).toISOString()
            };

            // Сохраняем в кэш
            await setCachedData(cacheKey, result, PROFILE_CACHE_TTL);
            logAction(userId, 'profile_view', `Opened profile with refresh=${refresh ? 'true' : 'false'}; fetched fresh data`);

            return {
                success: true,
                data: result,
                cached: false
            };
        } catch (error) {
            console.error('[Profile] Error:', error);
            const errorMessage = error instanceof Error ? error.message : 'Ошибка получения профиля';
            
            if (
                errorMessage.includes('Сессия истекла') ||
                errorMessage.includes('Ошибка авторизации') ||
                errorMessage.includes('HTTP error: 401')
            ) {
                return reply.status(401).send({
                    success: false,
                    error: 'Требуется повторная авторизация',
                    errorCode: 'AUTH_RELOGIN_REQUIRED'
                });
            }
            
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
