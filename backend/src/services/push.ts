/**
 * Web Push сервис: подписки + idempotency-журнал отправок + low-level send.
 *
 * Эта прослойка предоставляет API для Agent B (scheduler) и для REST роутов
 * `/api/v3/notifications`. Сам отправитель уведомлений (cron/loop) живёт в
 * другом модуле и пользуется только публичными экспортами.
 *
 * VAPID-ключи берутся из env при импорте. Если не сконфигурированы — модуль
 * не падает: subscription-CRUD и журнал по-прежнему работают, но реальная
 * отправка через `sendPushNotification` вернёт `{ ok: false, expired: false }`
 * и залогирует предупреждение один раз.
 */

import webpush, { type PushSubscription as WebPushSubscription, type RequestOptions } from 'web-push';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';

export interface PushSubscriptionRow {
    id: number;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string | null;
    createdAt: Date;
    lastSeenAt: Date;
}

export interface PushSubscriptionInput {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}

export type PushKind =
    | '1day'
    | '1hour'
    | 'social_mention'
    | 'social_dm'
    | 'social_comment'
    | 'social_group_post'
    | 'social_announcement'
    | 'event_1day'
    | 'event_1hour';

export interface PushPayload {
    title: string;
    body: string;
    [extra: string]: unknown;
}

export interface SendResult {
    ok: boolean;
    expired: boolean;
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || '';

let vapidConfigured = false;

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && VAPID_SUBJECT) {
    try {
        webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
        vapidConfigured = true;
    } catch (error) {
        console.warn('[Push] Failed to configure VAPID details:', error instanceof Error ? error.message : 'unknown');
    }
} else {
    console.warn('[Push] VAPID env vars are missing — web-push send disabled (subscription CRUD still works).');
}

export function isPushConfigured(): boolean {
    return vapidConfigured;
}

export function getVapidPublicKey(): string {
    return VAPID_PUBLIC_KEY;
}

async function requirePushPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Push] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

function rowToSubscription(row: {
    id: string | number;
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    user_agent: string | null;
    created_at: Date;
    last_seen_at: Date;
}): PushSubscriptionRow {
    return {
        id: typeof row.id === 'string' ? Number.parseInt(row.id, 10) : row.id,
        userId: row.user_id,
        endpoint: row.endpoint,
        p256dh: row.p256dh,
        auth: row.auth,
        userAgent: row.user_agent,
        createdAt: new Date(row.created_at),
        lastSeenAt: new Date(row.last_seen_at),
    };
}

/**
 * Список всех активных подписок пользователя. Возвращает [], если БД недоступна
 * нельзя (для шедулера тихий пропуск — задача переедет на следующий тик).
 */
export async function getUserSubscriptions(userId: string): Promise<PushSubscriptionRow[]> {
    return requirePushPostgres('getUserSubscriptions', async (client) => {
        const result = await client.query<{
            id: string | number;
            user_id: string;
            endpoint: string;
            p256dh: string;
            auth: string;
            user_agent: string | null;
            created_at: Date;
            last_seen_at: Date;
        }>(
            `
                select id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at
                from app_push_subscriptions
                where user_id = $1
                order by last_seen_at desc
            `,
            [userId]
        );
        return result.rows.map(rowToSubscription);
    });
}

/**
 * Upsert подписки по (userId, endpoint). При повторной отправке тех же ключей
 * обновляем `last_seen_at` и (если изменились) сами ключи. Это позволяет
 * клиенту вызывать /subscribe регулярно как keep-alive, без накопления дублей.
 */
export async function upsertSubscription(
    userId: string,
    sub: PushSubscriptionInput,
    userAgent?: string | null
): Promise<PushSubscriptionRow> {
    return requirePushPostgres('upsertSubscription', async (client) => {
        const now = new Date();
        const result = await client.query<{
            id: string | number;
            user_id: string;
            endpoint: string;
            p256dh: string;
            auth: string;
            user_agent: string | null;
            created_at: Date;
            last_seen_at: Date;
        }>(
            `
                insert into app_push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at)
                values ($1, $2, $3, $4, $5, $6, $6)
                on conflict (user_id, endpoint)
                do update set
                    p256dh = excluded.p256dh,
                    auth = excluded.auth,
                    user_agent = coalesce(excluded.user_agent, app_push_subscriptions.user_agent),
                    last_seen_at = excluded.last_seen_at
                returning id, user_id, endpoint, p256dh, auth, user_agent, created_at, last_seen_at
            `,
            [
                userId,
                sub.endpoint,
                sub.keys.p256dh,
                sub.keys.auth,
                userAgent ?? null,
                now,
            ]
        );
        return rowToSubscription(result.rows[0]);
    });
}

/**
 * Удаление одной подписки только в рамках конкретного пользователя — это
 * важная гарантия безопасности: один пользователь не может отписать чужой
 * endpoint, даже если знает его.
 */
export async function deleteSubscription(userId: string, endpoint: string): Promise<boolean> {
    return requirePushPostgres('deleteSubscription', async (client) => {
        const result = await client.query(
            `delete from app_push_subscriptions where user_id = $1 and endpoint = $2`,
            [userId, endpoint]
        );
        return Boolean(result.rowCount && result.rowCount > 0);
    });
}

/**
 * Idempotent INSERT в журнал отправок. Если запись для (userId, examId, kind)
 * уже есть — ничего не делаем и возвращаем false. Это страховка от двойных
 * отправок при перезапуске scheduler-а.
 */
export async function recordSend(
    userId: string,
    examId: string,
    kind: PushKind,
    status: string
): Promise<boolean> {
    return requirePushPostgres('recordSend', async (client) => {
        const result = await client.query(
            `
                insert into app_push_sends (user_id, exam_id, kind, sent_at, status)
                values ($1, $2, $3, $4, $5)
                on conflict (user_id, exam_id, kind) do nothing
            `,
            [userId, examId, kind, new Date(), status]
        );
        return Boolean(result.rowCount && result.rowCount > 0);
    });
}

export async function hasBeenSent(userId: string, examId: string, kind: PushKind): Promise<boolean> {
    return requirePushPostgres('hasBeenSent', async (client) => {
        const result = await client.query<{ exists: boolean }>(
            `
                select exists(
                    select 1 from app_push_sends
                    where user_id = $1 and exam_id = $2 and kind = $3
                ) as exists
            `,
            [userId, examId, kind]
        );
        return Boolean(result.rows[0]?.exists);
    });
}

/**
 * Отправка одной web-push нотификации. Контракт:
 * - При HTTP 404/410 (endpoint мёртв или истёк) — `{ ok: false, expired: true }`.
 *   Вызывающий код обязан удалить подписку из БД.
 * - При любой другой ошибке — `{ ok: false, expired: false }` без выброса.
 *   Логируем только тип/статус, никаких ключей или payload в лог не уходит.
 * - При успехе — `{ ok: true, expired: false }`.
 */
export async function sendPushNotification(
    sub: PushSubscriptionRow | WebPushSubscription,
    payload: PushPayload,
    options?: RequestOptions
): Promise<SendResult> {
    if (!vapidConfigured) {
        return { ok: false, expired: false };
    }

    const subscription: WebPushSubscription = 'endpoint' in sub && 'keys' in sub
        ? (sub as WebPushSubscription)
        : {
            endpoint: (sub as PushSubscriptionRow).endpoint,
            keys: {
                p256dh: (sub as PushSubscriptionRow).p256dh,
                auth: (sub as PushSubscriptionRow).auth,
            },
        };

    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), options);
        return { ok: true, expired: false };
    } catch (error) {
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
            return { ok: false, expired: true };
        }
        console.warn(`[Push] sendNotification failed (status=${statusCode ?? 'n/a'})`);
        return { ok: false, expired: false };
    }
}
