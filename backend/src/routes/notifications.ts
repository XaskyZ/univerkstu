/**
 * REST для web-push уведомлений об экзаменах.
 *
 * Скоуп этого роутера — surface для клиента (подписка/отписка + prefs) и
 * минимальный debug-endpoint (`/test`). Cам шедулер (Agent B) пишет в эти же
 * таблицы напрямую через `services/push.ts`.
 *
 * Все клиентские endpoints под `app.authenticate`. Envelope: `{ success, error, errorCode? }`.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
    getUserSubscriptions,
    upsertSubscription,
    deleteSubscription,
    sendPushNotification,
    getVapidPublicKey,
    isPushConfigured,
} from '../services/push.js';
import { getUser, updateUserSettings } from '../services/users.js';
import { DEFAULT_EXAM_REMINDERS, type ExamRemindersSettings } from '../types/index.js';
import {
    getNotificationPrefs,
    setNotificationPrefs,
    NOTIFICATION_KINDS,
    type NotificationKind,
} from '../services/notification-prefs.js';

// Endpoint web-push обычно ~200-400 символов, but FCM/APNS могут быть длиннее.
// Намеренно ставим верхнюю границу с запасом, чтобы не отрезать корректные.
const MAX_ENDPOINT_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;
const MAX_USER_AGENT_LENGTH = 512;

interface SubscribeBody {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
    userAgent?: string;
}

interface UnsubscribeBody {
    endpoint: string;
}

interface PrefsBody {
    enabled?: boolean;
    oneDay?: boolean;
    oneHour?: boolean;
}

const subscribeBodySchema = {
    type: 'object',
    required: ['endpoint', 'keys'],
    properties: {
        endpoint: { type: 'string', minLength: 1, maxLength: MAX_ENDPOINT_LENGTH },
        keys: {
            type: 'object',
            required: ['p256dh', 'auth'],
            properties: {
                p256dh: { type: 'string', minLength: 1, maxLength: MAX_KEY_LENGTH },
                auth: { type: 'string', minLength: 1, maxLength: MAX_KEY_LENGTH },
            },
        },
        userAgent: { type: ['string', 'null'], maxLength: MAX_USER_AGENT_LENGTH },
    },
} as const;

const unsubscribeBodySchema = {
    type: 'object',
    required: ['endpoint'],
    properties: {
        endpoint: { type: 'string', minLength: 1, maxLength: MAX_ENDPOINT_LENGTH },
    },
} as const;

const prefsBodySchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        enabled: { type: 'boolean' },
        oneDay: { type: 'boolean' },
        oneHour: { type: 'boolean' },
    },
} as const;

/**
 * Body schema for the per-kind preference PUT. `enabledKinds` is a sparse
 * object whose keys are restricted to the known `PushKind` union.
 *
 * Note on Ajv: Fastify's default Ajv config sets `removeAdditional: true`, so a
 * plain `additionalProperties: false` would silently strip unknown keys
 * instead of returning 400. We rely on `propertyNames` with an enum, which
 * `removeAdditional` does NOT short-circuit — so a typo like `bogus_kind`
 * surfaces as a real validation error.
 */
const kindPrefsBodySchema = {
    type: 'object',
    additionalProperties: false,
    required: ['enabledKinds'],
    properties: {
        enabledKinds: {
            type: 'object',
            propertyNames: { enum: [...NOTIFICATION_KINDS] },
            additionalProperties: { type: 'boolean' },
        },
    },
} as const;

interface KindPrefsBody {
    enabledKinds: Partial<Record<NotificationKind, boolean>>;
}

export function mergeExamReminders(
    current: ExamRemindersSettings | undefined,
    patch: PrefsBody
): ExamRemindersSettings {
    const base: ExamRemindersSettings = current ?? DEFAULT_EXAM_REMINDERS;
    return {
        enabled: typeof patch.enabled === 'boolean' ? patch.enabled : base.enabled,
        oneDay: typeof patch.oneDay === 'boolean' ? patch.oneDay : base.oneDay,
        oneHour: typeof patch.oneHour === 'boolean' ? patch.oneHour : base.oneHour,
    };
}

export async function notificationRoutes(app: FastifyInstance) {

    /**
     * GET /api/v3/notifications/public-key
     * Отдаём публичный VAPID-ключ для клиентского PushManager.subscribe().
     * Если env не настроен — 503 с понятным errorCode, чтобы фронт мог скрыть UI.
     */
    app.get('/public-key', {
        preHandler: [app.authenticate as any],
    }, async (_request: FastifyRequest, reply: FastifyReply) => {
        const publicKey = getVapidPublicKey();
        if (!publicKey || !isPushConfigured()) {
            return reply.status(503).send({
                success: false,
                error: 'Push notifications are not configured on this server',
                errorCode: 'PUSH_NOT_CONFIGURED',
            });
        }
        return { success: true, publicKey };
    });

    /**
     * POST /api/v3/notifications/subscribe
     * Регистрируем (или обновляем) push-подписку.
     */
    app.post('/subscribe', {
        preHandler: [app.authenticate as any],
        schema: { body: subscribeBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: SubscribeBody }>,
        reply: FastifyReply
    ) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'Некорректное тело подписки',
                errorCode: 'PUSH_SUBSCRIBE_VALIDATION',
            });
        }

        const userId = (request.user as { userId: string }).userId;
        const { endpoint, keys, userAgent } = request.body;
        const ua = typeof userAgent === 'string' && userAgent.trim()
            ? userAgent.trim().slice(0, MAX_USER_AGENT_LENGTH)
            : (typeof request.headers['user-agent'] === 'string'
                ? request.headers['user-agent']!.slice(0, MAX_USER_AGENT_LENGTH)
                : null);

        try {
            await upsertSubscription(userId, { endpoint, keys }, ua);
            return { success: true };
        } catch (error) {
            console.error('[Notifications] subscribe failed:', error instanceof Error ? error.message : 'unknown');
            return reply.status(500).send({
                success: false,
                error: 'Не удалось сохранить подписку',
                errorCode: 'PUSH_SUBSCRIBE_INTERNAL',
            });
        }
    });

    /**
     * DELETE /api/v3/notifications/subscribe
     * Удаление подписки. Скоупится по userId — нельзя удалить чужую.
     */
    app.delete('/subscribe', {
        preHandler: [app.authenticate as any],
        schema: { body: unsubscribeBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: UnsubscribeBody }>,
        reply: FastifyReply
    ) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'Некорректное тело запроса',
                errorCode: 'PUSH_UNSUBSCRIBE_VALIDATION',
            });
        }

        const userId = (request.user as { userId: string }).userId;
        try {
            const removed = await deleteSubscription(userId, request.body.endpoint);
            return { success: true, removed };
        } catch (error) {
            console.error('[Notifications] unsubscribe failed:', error instanceof Error ? error.message : 'unknown');
            return reply.status(500).send({
                success: false,
                error: 'Не удалось удалить подписку',
                errorCode: 'PUSH_UNSUBSCRIBE_INTERNAL',
            });
        }
    });

    /**
     * GET /api/v3/notifications/prefs
     * Возвращаем pref-блок examReminders. По дефолту всё включено.
     */
    app.get('/prefs', {
        preHandler: [app.authenticate as any],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as { userId: string }).userId;
        try {
            const user = await getUser(userId);
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'Пользователь не найден',
                    errorCode: 'USER_NOT_FOUND',
                });
            }
            const prefs = user.settings?.examReminders ?? DEFAULT_EXAM_REMINDERS;
            return { success: true, prefs };
        } catch (error) {
            console.error('[Notifications] prefs read failed:', error instanceof Error ? error.message : 'unknown');
            return reply.status(500).send({
                success: false,
                error: 'Не удалось получить настройки',
                errorCode: 'PUSH_PREFS_INTERNAL',
            });
        }
    });

    /**
     * PATCH /api/v3/notifications/prefs
     * Частичное обновление флагов examReminders.
     */
    app.patch('/prefs', {
        preHandler: [app.authenticate as any],
        schema: { body: prefsBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: PrefsBody }>,
        reply: FastifyReply
    ) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'Некорректные настройки',
                errorCode: 'PUSH_PREFS_VALIDATION',
            });
        }

        const userId = (request.user as { userId: string }).userId;
        try {
            const user = await getUser(userId);
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'Пользователь не найден',
                    errorCode: 'USER_NOT_FOUND',
                });
            }

            const merged = mergeExamReminders(user.settings?.examReminders, request.body);
            const ok = await updateUserSettings(userId, { examReminders: merged });
            if (!ok) {
                return reply.status(500).send({
                    success: false,
                    error: 'Не удалось сохранить настройки',
                    errorCode: 'PUSH_PREFS_INTERNAL',
                });
            }
            return { success: true, prefs: merged };
        } catch (error) {
            console.error('[Notifications] prefs update failed:', error instanceof Error ? error.message : 'unknown');
            return reply.status(500).send({
                success: false,
                error: 'Не удалось сохранить настройки',
                errorCode: 'PUSH_PREFS_INTERNAL',
            });
        }
    });

    /**
     * GET /api/v3/notifications/kind-prefs
     *
     * Per-kind push opt-in/out map. Distinct from `/prefs` (which owns the
     * legacy `examReminders` flags on the user settings blob) — this endpoint
     * targets the universal `PushKind` union and lives in its own
     * `app_notification_prefs` table.
     *
     * Returns the user's current map; a missing key means "default-on", so the
     * frontend should render unchecked-by-default toggles as ON.
     */
    app.get('/kind-prefs', {
        preHandler: [app.authenticate as any],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const userId = (request.user as { userId: string }).userId;
        try {
            const prefs = await getNotificationPrefs(userId);
            return { success: true, data: prefs };
        } catch (error) {
            console.error('[Notifications] kind-prefs read failed:', error instanceof Error ? error.message : 'unknown');
            return reply.status(500).send({
                success: false,
                error: 'Не удалось получить настройки уведомлений',
                errorCode: 'PUSH_KIND_PREFS_INTERNAL',
            });
        }
    });

    /**
     * PUT /api/v3/notifications/kind-prefs
     *
     * Merge-update the per-kind opt-in map. The body is `{ enabledKinds: {...} }`
     * and only the keys present in the body are updated server-side — other
     * keys keep their previous value (or the implicit default-on).
     */
    app.put('/kind-prefs', {
        preHandler: [app.authenticate as any],
        schema: { body: kindPrefsBodySchema },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{ Body: KindPrefsBody }>,
        reply: FastifyReply,
    ) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: 'Некорректные настройки уведомлений',
                errorCode: 'PUSH_KIND_PREFS_VALIDATION',
            });
        }

        const userId = (request.user as { userId: string }).userId;
        try {
            await setNotificationPrefs(userId, request.body.enabledKinds);
            return reply.status(204).send();
        } catch (error) {
            console.error('[Notifications] kind-prefs update failed:', error instanceof Error ? error.message : 'unknown');
            return reply.status(500).send({
                success: false,
                error: 'Не удалось сохранить настройки уведомлений',
                errorCode: 'PUSH_KIND_PREFS_INTERNAL',
            });
        }
    });

    /**
     * POST /api/v3/notifications/test
     * Дебаг: отправляем тестовое уведомление на все подписки текущего юзера.
     * Доступно только в non-production окружении (для QA).
     */
    app.post('/test', {
        preHandler: [app.authenticate as any],
    }, async (request: FastifyRequest, reply: FastifyReply) => {
        const isNonProd = process.env.NODE_ENV !== 'production';
        if (!isNonProd) {
            return reply.status(403).send({
                success: false,
                error: 'Forbidden',
                errorCode: 'PUSH_TEST_FORBIDDEN',
            });
        }

        if (!isPushConfigured()) {
            return reply.status(503).send({
                success: false,
                error: 'Push notifications are not configured on this server',
                errorCode: 'PUSH_NOT_CONFIGURED',
            });
        }

        const userId = (request.user as { userId: string }).userId;
        try {
            const subs = await getUserSubscriptions(userId);
            if (subs.length === 0) {
                return reply.status(404).send({
                    success: false,
                    error: 'У пользователя нет активных подписок',
                    errorCode: 'PUSH_TEST_NO_SUBS',
                });
            }

            const payload = {
                title: 'UniverKstu — тест уведомлений',
                body: 'Если вы видите это сообщение, push-уведомления настроены корректно.',
                kind: 'test',
            };

            let sent = 0;
            let expired = 0;
            let failed = 0;
            for (const sub of subs) {
                const result = await sendPushNotification(sub, payload);
                if (result.ok) {
                    sent += 1;
                } else if (result.expired) {
                    expired += 1;
                    await deleteSubscription(userId, sub.endpoint).catch(() => { });
                } else {
                    failed += 1;
                }
            }
            return { success: true, total: subs.length, sent, expired, failed };
        } catch (error) {
            console.error('[Notifications] test send failed:', error instanceof Error ? error.message : 'unknown');
            return reply.status(500).send({
                success: false,
                error: 'Не удалось отправить тестовое уведомление',
                errorCode: 'PUSH_TEST_INTERNAL',
            });
        }
    });
}
