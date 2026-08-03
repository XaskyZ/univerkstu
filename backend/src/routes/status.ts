/**
 * Routes для статуса и общей информации
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PoolClient } from 'pg';
import { getScheduleCacheStatus } from '../services/schedule.js';
import { getExamsCacheStatus } from '../services/exams.js';
import { getUser, updateUserSettings, normalizeTheme } from '../services/users.js';
import { getReferralOverview } from '../services/referrals.js';
import { checkThemeEntitlement } from '../services/theme-unlocks.js';
import type { AppThemeId } from '../types/index.js';
import { withSupabasePostgres } from '../db/postgres.js';

const MAX_LANGUAGE_LENGTH = 5;
const MAX_DISPLAY_NAME_LENGTH = 100;
const MAX_LEADERBOARD_CONTACT_LENGTH = 100;
const MAX_THEME_LENGTH = 40;

const statusSettingsBodySchema = {
    type: 'object',
    properties: {
        language: { type: ['string', 'null'], maxLength: MAX_LANGUAGE_LENGTH },
        leaderboardDisplayName: { type: ['string', 'null'], maxLength: MAX_DISPLAY_NAME_LENGTH },
        leaderboardContacts: {
            type: ['object', 'null'],
            properties: {
                telegram: { type: ['string', 'null'], maxLength: MAX_LEADERBOARD_CONTACT_LENGTH },
                instagram: { type: ['string', 'null'], maxLength: MAX_LEADERBOARD_CONTACT_LENGTH },
            },
            additionalProperties: false,
        },
        theme: { type: ['string', 'null'], maxLength: MAX_THEME_LENGTH },
        gradesLeaderboardOptOut: { type: ['boolean', 'null'] },
    },
} as const;

export async function statusRoutes(app: FastifyInstance) {
    // Список userId, скрываемых из публичного лидерборда (тестовые/служебные
    // аккаунты). Задаётся через env как список через запятую; по умолчанию пуст.
    const LEADERBOARD_EXCLUDED_USER_IDS = new Set(
        (process.env.LEADERBOARD_EXCLUDED_USER_IDS || '')
            .split(',')
            .map((value) => value.trim().toLowerCase())
            .filter(Boolean)
    );

    const normalizeLeaderboardDisplayName = (value: unknown): string | undefined => {
        if (typeof value !== 'string') return undefined;
        const normalized = value.trim().replace(/\s+/g, ' ');
        if (!normalized) return '';
        return normalized.slice(0, 40);
    };

    const normalizeLeaderboardHandle = (value: unknown, hostPattern: RegExp): string | undefined => {
        if (value === null) return '';
        if (typeof value !== 'string') return undefined;
        let normalized = value.trim();
        if (!normalized) return '';
        normalized = normalized
            .replace(/^https?:\/\//i, '')
            .replace(/^www\./i, '')
            .replace(hostPattern, '')
            .replace(/^@+/, '')
            .split(/[/?#]/)[0]
            .trim();
        return normalized.replace(/[^\p{L}\p{N}._-]/gu, '').slice(0, 40);
    };

    const normalizeLeaderboardContacts = (value: unknown): { telegram?: string; instagram?: string } | undefined => {
        if (value === null) return {};
        if (!value || typeof value !== 'object') return undefined;
        const candidate = value as { telegram?: unknown; instagram?: unknown };
        const telegram = normalizeLeaderboardHandle(candidate.telegram, /^(?:t\.me|telegram\.me|telegram\.dog)\//i);
        const instagram = normalizeLeaderboardHandle(candidate.instagram, /^instagram\.com\//i);
        if (telegram === undefined && instagram === undefined) return undefined;
        return {
            ...(telegram ? { telegram } : {}),
            ...(instagram ? { instagram } : {}),
        };
    };

    const maskLeaderboardName = (value: string | null | undefined, fallbackUserId: string): string => {
        const normalized = String(value || '').trim();
        if (!normalized) {
            return `Студент ${fallbackUserId.slice(0, 4)}`;
        }

        const parts = normalized.split(/\s+/).filter(Boolean);
        if (parts.length === 0) {
            return `Студент ${fallbackUserId.slice(0, 4)}`;
        }

        const firstName = parts[1] || parts[0];
        const lastInitial = parts[0] && parts.length > 1 ? `${parts[0][0]}.` : '';
        return `${firstName}${lastInitial ? ` ${lastInitial}` : ''}`;
    };

    const resolveLeaderboardDisplayName = (
        explicitDisplayName: string | null | undefined,
        fallbackLabel: string | null | undefined,
        fallbackUserId: string
    ): string => {
        const normalizedExplicit = normalizeLeaderboardDisplayName(explicitDisplayName);
        if (normalizedExplicit) {
            return normalizedExplicit;
        }
        return maskLeaderboardName(fallbackLabel, fallbackUserId);
    };

    const getPgAnalyticsLeaderboardWindow = async (
        client: PoolClient,
        windowMode: 'day' | 'week' | 'all',
    ) => {
        const intervalSql = windowMode === 'day'
            ? `interval '1 day'`
            : windowMode === 'week'
                ? `interval '7 days'`
                : null;
        const createdAtFilterSql = intervalSql
            ? `and created_at >= now() - ${intervalSql}`
            : '';

        const result = await client.query<{ user_id: string; total_seconds: number }>(`
            with session_spans as (
                select
                    user_id,
                    session_id,
                    greatest(
                        5,
                        least(
                            14400,
                            greatest(
                                coalesce(max((metrics_json->>'engagedTimeSec')::int) filter (where event_type = 'session_end'), 0),
                                coalesce(max((metrics_json->>'sessionDurationSec')::int) filter (where event_type = 'session_end'), 0),
                                greatest(extract(epoch from (max(event_at) - min(event_at)))::int, 0)
                            )
                        )
                    ) as session_seconds
                from app_analytics_events
                where coalesce(user_id, '') <> ''
                  and coalesce(session_id, '') <> ''
                  and coalesce(path, '') not like '/admin%'
                  ${createdAtFilterSql}
                group by user_id, session_id
            )
            select user_id, coalesce(sum(session_seconds), 0)::int as total_seconds
            from session_spans
            group by user_id
        `);

        return new Map(
            result.rows.map((row) => [row.user_id, Number(row.total_seconds || 0)])
        );
    };

    const buildPublicActiveLeaderboard = async (
        currentUserId: string,
        period: 'day' | 'week' | 'all' = 'all',
    ) => {
        const pgLeaderboard = await withSupabasePostgres(async (client) => {
            const result = await client.query<{ user_id: string; snapshot_json: any; settings_json: any }>(
                `
                    select s.user_id, s.snapshot_json, u.settings_json
                    from app_admin_user_snapshots s
                    left join app_users u on u.user_id = s.user_id
                `
            );
            const analyticsWindowMap = await getPgAnalyticsLeaderboardWindow(client, period);

            const ranked = result.rows
                .map((row) => {
                    const snapshot = row.snapshot_json || {};
                    const settings = row.settings_json || {};
                    const windowSeconds = Number(analyticsWindowMap.get(row.user_id) || 0);
                    const totalSeconds = Math.max(windowSeconds, 0);

                    return {
                        userId: row.user_id,
                        displayName: resolveLeaderboardDisplayName(
                            settings.leaderboardDisplayName,
                            snapshot.fullName
                            || snapshot.profileSummary?.fullName
                            || snapshot.profileQuestionnaire?.summary?.firstName
                            || null,
                            row.user_id
                        ),
                        totalSeconds,
                    };
                })
                .filter((entry) => !LEADERBOARD_EXCLUDED_USER_IDS.has(entry.userId.trim().toLowerCase()))
                .filter((entry) => Number.isFinite(entry.totalSeconds) && entry.totalSeconds > 0)
                .sort((a, b) => b.totalSeconds - a.totalSeconds);

            const leaderboard = ranked.map((entry, index) => ({
                rank: index + 1,
                displayName: entry.displayName,
                totalSeconds: entry.totalSeconds,
                isCurrentUser: entry.userId === currentUserId,
            }));

            const currentUserIndex = ranked.findIndex((entry) => entry.userId === currentUserId);
            const currentUser = currentUserIndex >= 0
                ? {
                    rank: currentUserIndex + 1,
                    displayName: ranked[currentUserIndex].displayName,
                    totalSeconds: ranked[currentUserIndex].totalSeconds,
                    isCurrentUser: true,
                }
                : null;

            return {
                success: true,
                period,
                leaderboard,
                currentUser,
                totalRankedUsers: ranked.length,
                updatedAt: new Date().toISOString(),
            };
        });

        if (pgLeaderboard === null) {
            throw new Error('[Admin Status] Supabase/Postgres is unavailable during active leaderboard build');
        }
        return pgLeaderboard;
    };

    /**
     * GET /api/v3/status
     * Общий статус для авторизованного пользователя
     */
    app.get('/status', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest,
        reply: FastifyReply
    ) => {
        const userId = (request.user as any).userId;

        try {
            const [user, scheduleStatus, examsStatus] = await Promise.all([
                getUser(userId),
                getScheduleCacheStatus(userId),
                getExamsCacheStatus(userId),
            ]);

            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'Пользователь не найден',
                });
            }

            return {
                success: true,
                user: {
                    userId: user.userId,
                    lastLogin: user.lastLogin,
                    settings: user.settings,
                },
                schedule: scheduleStatus,
                exams: examsStatus,
            };

        } catch (error) {
            console.error('[Status Route] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка получения статуса',
            });
        }
    });

    /**
     * GET /api/v3/info
     * Информация о сервере (публичный endpoint без внутренних метрик)
     */
    app.get('/info', async () => {
        return {
            name: 'UniverSchedule API',
            version: '4.0.0',
            status: 'ok',
        };
    });

    app.get('/settings/active-leaderboard', {
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Querystring: { period?: string } }>,
        reply: FastifyReply
    ) => {
        try {
            const userId = (request.user as any).userId as string;
            const rawPeriod = typeof request.query?.period === 'string' ? request.query.period.trim().toLowerCase() : '';
            const period = rawPeriod === 'day' || rawPeriod === 'week' || rawPeriod === 'all' ? rawPeriod : 'all';
            return await buildPublicActiveLeaderboard(userId, period);
        } catch (error) {
            console.error('[Settings Leaderboard] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Ошибка получения рейтинга активности',
            });
        }
    });

    app.patch('/status/settings', {
        preHandler: [app.authenticate as any],
        schema: { body: statusSettingsBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: { language?: string; leaderboardDisplayName?: string; leaderboardContacts?: { telegram?: string | null; instagram?: string | null } | null; theme?: string; gradesLeaderboardOptOut?: boolean } }>,
        reply: FastifyReply
    ) => {
        if (request.validationError) {
            return reply.status(400).send({ success: false, error: 'invalid settings payload' });
        }
        const userId = (request.user as any).userId;
        const language = typeof request.body?.language === 'string' ? request.body.language.trim() : '';
        const rawDisplayName = request.body?.leaderboardDisplayName;
        const rawContacts = request.body?.leaderboardContacts;
        const rawTheme = request.body?.theme;
        const rawOptOut = request.body?.gradesLeaderboardOptOut;
        const hasLanguageUpdate = language === 'ru' || language === 'kz' || language === 'en';
        const hasDisplayNameUpdate = typeof rawDisplayName === 'string';
        const hasContactsUpdate = rawContacts !== undefined;
        const hasThemeUpdate = typeof rawTheme === 'string';
        const hasOptOutUpdate = typeof rawOptOut === 'boolean';

        if (!hasLanguageUpdate && !hasDisplayNameUpdate && !hasContactsUpdate && !hasThemeUpdate && !hasOptOutUpdate) {
            return reply.status(400).send({
                success: false,
                error: 'No supported settings provided',
            });
        }

        let normalizedTheme: AppThemeId | null = null;
        if (hasThemeUpdate) {
            normalizedTheme = normalizeTheme(rawTheme);
            // Server-side gate. Frontend hides locked tiles, but a tampered
            // client could PATCH any theme — we re-check here. Free themes
            // pass without DB calls; gated themes pull only the entitlement
            // they need. On infra failure we fail closed (better to bounce
            // than persist a gated theme without proof of entitlement).
            const entitlement = await checkThemeEntitlement(userId, normalizedTheme, {
                getReferralCount: async (uid) => (await getReferralOverview(uid)).referralCount,
                getSupporterTier: async () => null,
            });
            if (!entitlement.ok && entitlement.reason === 'locked') {
                return reply.status(403).send({
                    success: false,
                    error: 'theme locked',
                    errorCode: 'THEME_LOCKED',
                    requirement: entitlement.requirement,
                });
            }
            if (!entitlement.ok && entitlement.reason === 'unavailable') {
                return reply.status(503).send({
                    success: false,
                    error: 'theme entitlement check failed',
                    errorCode: 'THEME_ENTITLEMENT_UNAVAILABLE',
                });
            }
        }

        const leaderboardDisplayName = normalizeLeaderboardDisplayName(rawDisplayName);
        const leaderboardContacts = normalizeLeaderboardContacts(rawContacts);
        const updated = await updateUserSettings(userId, {
            ...(hasLanguageUpdate ? { language: language as 'ru' | 'kz' | 'en' } : {}),
            ...(hasDisplayNameUpdate ? { leaderboardDisplayName } : {}),
            ...(hasContactsUpdate ? { leaderboardContacts } : {}),
            ...(hasThemeUpdate && normalizedTheme ? { theme: normalizedTheme } : {}),
            ...(hasOptOutUpdate ? { gradesLeaderboardOptOut: rawOptOut } : {}),
        });
        return {
            success: true,
            updated,
            settings: {
                ...(hasLanguageUpdate ? { language } : {}),
                ...(hasDisplayNameUpdate ? { leaderboardDisplayName: leaderboardDisplayName || null } : {}),
                ...(hasContactsUpdate ? { leaderboardContacts: leaderboardContacts || null } : {}),
                ...(hasThemeUpdate && normalizedTheme ? { theme: normalizedTheme } : {}),
                ...(hasOptOutUpdate ? { gradesLeaderboardOptOut: rawOptOut } : {}),
            },
        };
    });

}
