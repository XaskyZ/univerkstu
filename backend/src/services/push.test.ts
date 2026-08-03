import { describe, it, expect, vi, beforeEach } from 'vitest';

// VAPID env vars must be set BEFORE importing services/push.js because
// setVapidDetails() runs at module import. vi.hoisted runs before any imports,
// even before vi.mock factories. Without this, vapidConfigured stays false and
// sendPushNotification returns { ok: false } unconditionally.
vi.hoisted(() => {
    process.env.VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
        || 'BDfWBPyXKtLvDXY3sNGB-N7QbN5y2yj5G3RoMHaG5p3PXrA34CgI60dURm05Eh63qg-Ts7YgL5gxBl4OZmrlQYg';
    process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
        || 'iL66qNlD1q1KhO6Hh5ER_LF6JxhSv2OEt7eDtOcUBek';
    process.env.VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@univerkstu.app';
});

// In-memory shim that mimics PG queries used by push.ts.
type Row = Record<string, unknown>;
interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

const subs = new Map<string, Row>();    // key = `${userId}::${endpoint}`
const sends = new Map<string, Row>();   // key = `${userId}::${examId}::${kind}`

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();
            if (text.startsWith('insert into app_push_subscriptions')) {
                const [userId, endpoint, p256dh, auth, userAgent, now] = params as [
                    string, string, string, string, string | null, Date
                ];
                const key = `${userId}::${endpoint}`;
                const existing = subs.get(key);
                if (existing) {
                    existing.p256dh = p256dh;
                    existing.auth = auth;
                    existing.user_agent = userAgent ?? existing.user_agent;
                    existing.last_seen_at = now;
                    return { rows: [existing], rowCount: 1 };
                }
                const row: Row = {
                    id: subs.size + 1,
                    user_id: userId,
                    endpoint,
                    p256dh,
                    auth,
                    user_agent: userAgent,
                    created_at: now,
                    last_seen_at: now,
                };
                subs.set(key, row);
                return { rows: [row], rowCount: 1 };
            }
            if (text.startsWith('select id, user_id, endpoint, p256dh, auth, user_agent')) {
                const [userId] = params as [string];
                return {
                    rows: Array.from(subs.values()).filter((r) => r.user_id === userId),
                    rowCount: 0,
                };
            }
            if (text.startsWith('delete from app_push_subscriptions')) {
                const [userId, endpoint] = params as [string, string];
                const key = `${userId}::${endpoint}`;
                const had = subs.delete(key);
                return { rows: [], rowCount: had ? 1 : 0 };
            }
            if (text.startsWith('insert into app_push_sends')) {
                const [userId, examId, kind, sentAt, status] = params as [
                    string, string, string, Date, string
                ];
                const key = `${userId}::${examId}::${kind}`;
                if (sends.has(key)) {
                    return { rows: [], rowCount: 0 };
                }
                sends.set(key, { user_id: userId, exam_id: examId, kind, sent_at: sentAt, status });
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('select exists(')) {
                const [userId, examId, kind] = params as [string, string, string];
                const exists = sends.has(`${userId}::${examId}::${kind}`);
                return { rows: [{ exists }], rowCount: 1 };
            }
            throw new Error(`Unmocked SQL: ${sql}`);
        }),
    };
}

const fakeClient = makeClient();

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

// Mock web-push to control sendNotification outcomes without making network calls.
const mockSendNotification = vi.fn();
vi.mock('web-push', () => ({
    default: {
        setVapidDetails: vi.fn(),
        sendNotification: (...args: unknown[]) => mockSendNotification(...args),
    },
}));

import {
    upsertSubscription,
    deleteSubscription,
    getUserSubscriptions,
    recordSend,
    hasBeenSent,
    sendPushNotification,
} from './push.js';

describe('services/push', () => {
    beforeEach(() => {
        subs.clear();
        sends.clear();
        mockSendNotification.mockReset();
    });

    it('upsertSubscription updates last_seen_at on conflict (single row, refreshed timestamp)', async () => {
        // First insert.
        const first = await upsertSubscription('alice', {
            endpoint: 'https://fcm.example/abc',
            keys: { p256dh: 'P1', auth: 'A1' },
        }, 'UA-1');
        // Force a measurable delay so the second timestamp differs.
        await new Promise((resolve) => setTimeout(resolve, 5));

        const second = await upsertSubscription('alice', {
            endpoint: 'https://fcm.example/abc',
            keys: { p256dh: 'P1-updated', auth: 'A1-updated' },
        }, 'UA-2');

        const all = await getUserSubscriptions('alice');
        expect(all.length).toBe(1);
        // Контракт: upsert не плодит дубли + обновляет ключи + last_seen_at двигается вперёд.
        expect(all[0].p256dh).toBe('P1-updated');
        expect(second.lastSeenAt.getTime()).toBeGreaterThanOrEqual(first.lastSeenAt.getTime());
    });

    it('recordSend is idempotent: second call with same (user, exam, kind) does not insert', async () => {
        const firstInserted = await recordSend('alice', 'exam-42', '1day', 'success');
        const secondInserted = await recordSend('alice', 'exam-42', '1day', 'success');
        expect(firstInserted).toBe(true);
        expect(secondInserted).toBe(false);
    });

    it('hasBeenSent returns true after recordSend, false otherwise', async () => {
        expect(await hasBeenSent('alice', 'exam-42', '1hour')).toBe(false);
        await recordSend('alice', 'exam-42', '1hour', 'success');
        expect(await hasBeenSent('alice', 'exam-42', '1hour')).toBe(true);
        // Разные kind не должны путаться.
        expect(await hasBeenSent('alice', 'exam-42', '1day')).toBe(false);
    });

    it('sendPushNotification returns { expired: true } on 404', async () => {
        const err: Error & { statusCode?: number } = new Error('Gone');
        err.statusCode = 404;
        mockSendNotification.mockRejectedValueOnce(err);

        const result = await sendPushNotification(
            { id: 1, userId: 'alice', endpoint: 'https://e/1', p256dh: 'P', auth: 'A',
                userAgent: null, createdAt: new Date(), lastSeenAt: new Date() },
            { title: 't', body: 'b' }
        );
        expect(result).toEqual({ ok: false, expired: true });
    });

    it('sendPushNotification returns { expired: true } on 410', async () => {
        const err: Error & { statusCode?: number } = new Error('Gone');
        err.statusCode = 410;
        mockSendNotification.mockRejectedValueOnce(err);

        const result = await sendPushNotification(
            { id: 2, userId: 'alice', endpoint: 'https://e/2', p256dh: 'P', auth: 'A',
                userAgent: null, createdAt: new Date(), lastSeenAt: new Date() },
            { title: 't', body: 'b' }
        );
        expect(result.expired).toBe(true);
        expect(result.ok).toBe(false);
    });

    it('sendPushNotification returns { ok: true } on success', async () => {
        mockSendNotification.mockResolvedValueOnce({ statusCode: 201 });
        const result = await sendPushNotification(
            { id: 3, userId: 'alice', endpoint: 'https://e/3', p256dh: 'P', auth: 'A',
                userAgent: null, createdAt: new Date(), lastSeenAt: new Date() },
            { title: 't', body: 'b' }
        );
        expect(result).toEqual({ ok: true, expired: false });
    });

    it('deleteSubscription removes only the matching row', async () => {
        await upsertSubscription('alice', { endpoint: 'e1', keys: { p256dh: 'P', auth: 'A' } });
        await upsertSubscription('alice', { endpoint: 'e2', keys: { p256dh: 'P', auth: 'A' } });
        await upsertSubscription('bob',   { endpoint: 'e1', keys: { p256dh: 'P', auth: 'A' } });
        const removed = await deleteSubscription('alice', 'e1');
        expect(removed).toBe(true);
        const aliceLeft = await getUserSubscriptions('alice');
        const bobLeft = await getUserSubscriptions('bob');
        expect(aliceLeft.map((s) => s.endpoint)).toEqual(['e2']);
        expect(bobLeft.length).toBe(1); // bob's e1 untouched
    });
});
