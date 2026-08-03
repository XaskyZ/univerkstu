import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { notificationRoutes, mergeExamReminders } from './notifications.js';
import * as pushService from '../services/push.js';
import * as usersService from '../services/users.js';

// Note: routes are exercised via app.inject without a real DB or VAPID
// configuration — все нижние слои подменены через vi.mock.

vi.mock('../services/push.js', () => ({
    getUserSubscriptions: vi.fn(),
    upsertSubscription: vi.fn(),
    deleteSubscription: vi.fn(),
    sendPushNotification: vi.fn(),
    getVapidPublicKey: vi.fn(),
    isPushConfigured: vi.fn(),
    recordSend: vi.fn(),
    hasBeenSent: vi.fn(),
}));

vi.mock('../services/users.js', () => ({
    getUser: vi.fn(),
    updateUserSettings: vi.fn(),
}));

vi.mock('../utils/adminAuth.js', () => ({
    hasRequiredAdminRole: vi.fn().mockReturnValue(false),
}));

// Per-kind notification preferences. We mock the service rather than thread
// real PG behavior through these route tests — that path is covered by
// `services/notification-prefs.test.ts`.
const getNotificationPrefsMock = vi.fn();
const setNotificationPrefsMock = vi.fn();
vi.mock('../services/notification-prefs.js', async () => {
    const actual = await vi.importActual<typeof import('../services/notification-prefs.js')>(
        '../services/notification-prefs.js',
    );
    return {
        ...actual,
        getNotificationPrefs: (...args: unknown[]) => getNotificationPrefsMock(...args as [string]),
        setNotificationPrefs: (...args: unknown[]) =>
            setNotificationPrefsMock(...args as [string, Record<string, boolean>]),
    };
});

async function buildApp(opts: { userId: string | null } = { userId: 'alice' }): Promise<FastifyInstance> {
    const app = Fastify();
    app.decorate('authenticate', async (req: any, reply: any) => {
        if (!opts.userId) {
            reply.status(401).send({ error: 'Unauthorized' });
            return;
        }
        req.user = { userId: opts.userId };
    });
    await app.register(notificationRoutes);
    return app;
}

describe('mergeExamReminders', () => {
    // Контракт PATCH: пропуск поля = «не трогать», явный false должен записаться.
    it('uses defaults when current is undefined', () => {
        expect(mergeExamReminders(undefined, {})).toEqual({ enabled: true, oneDay: true, oneHour: true });
    });

    it('keeps existing values for fields not present in patch', () => {
        const current = { enabled: false, oneDay: true, oneHour: false };
        expect(mergeExamReminders(current, { enabled: true }))
            .toEqual({ enabled: true, oneDay: true, oneHour: false });
    });

    it('honors explicit false (does not collapse to default)', () => {
        const current = { enabled: true, oneDay: true, oneHour: true };
        expect(mergeExamReminders(current, { oneHour: false }))
            .toEqual({ enabled: true, oneDay: true, oneHour: false });
    });
});

describe('GET /public-key', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('200 with publicKey when env is configured', async () => {
        vi.mocked(pushService.isPushConfigured).mockReturnValue(true);
        vi.mocked(pushService.getVapidPublicKey).mockReturnValue('PUBLIC-KEY-XYZ');

        const app = await buildApp();
        const response = await app.inject({ method: 'GET', url: '/public-key' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true, publicKey: 'PUBLIC-KEY-XYZ' });
    });

    it('503 PUSH_NOT_CONFIGURED when env is missing', async () => {
        vi.mocked(pushService.isPushConfigured).mockReturnValue(false);
        vi.mocked(pushService.getVapidPublicKey).mockReturnValue('');

        const app = await buildApp();
        const response = await app.inject({ method: 'GET', url: '/public-key' });
        expect(response.statusCode).toBe(503);
        expect(response.json().errorCode).toBe('PUSH_NOT_CONFIGURED');
    });

    it('401 when not authenticated', async () => {
        const app = await buildApp({ userId: null });
        const response = await app.inject({ method: 'GET', url: '/public-key' });
        expect(response.statusCode).toBe(401);
    });
});

describe('POST /subscribe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('401 when not authenticated', async () => {
        const app = await buildApp({ userId: null });
        const response = await app.inject({
            method: 'POST',
            url: '/subscribe',
            payload: { endpoint: 'https://e', keys: { p256dh: 'P', auth: 'A' } },
        });
        expect(response.statusCode).toBe(401);
        expect(pushService.upsertSubscription).not.toHaveBeenCalled();
    });

    it('400 PUSH_SUBSCRIBE_VALIDATION when body is missing keys', async () => {
        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/subscribe',
            payload: { endpoint: 'https://e' },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().errorCode).toBe('PUSH_SUBSCRIBE_VALIDATION');
        expect(pushService.upsertSubscription).not.toHaveBeenCalled();
    });

    it('200 and upserts subscription with current user', async () => {
        vi.mocked(pushService.upsertSubscription).mockResolvedValueOnce({
            id: 1, userId: 'alice', endpoint: 'https://e',
            p256dh: 'P', auth: 'A', userAgent: 'UA',
            createdAt: new Date(), lastSeenAt: new Date(),
        });

        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/subscribe',
            payload: {
                endpoint: 'https://e',
                keys: { p256dh: 'P', auth: 'A' },
                userAgent: 'TestAgent/1.0',
            },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true });
        expect(pushService.upsertSubscription).toHaveBeenCalledWith(
            'alice',
            { endpoint: 'https://e', keys: { p256dh: 'P', auth: 'A' } },
            'TestAgent/1.0'
        );
    });
});

describe('DELETE /subscribe', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('removes only the caller’s subscription (passes caller userId, not someone else’s)', async () => {
        vi.mocked(pushService.deleteSubscription).mockResolvedValueOnce(true);

        const app = await buildApp({ userId: 'alice' });
        const response = await app.inject({
            method: 'DELETE',
            url: '/subscribe',
            payload: { endpoint: 'https://e' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json().success).toBe(true);
        expect(pushService.deleteSubscription).toHaveBeenCalledWith('alice', 'https://e');
        // Sanity: route never has a way to delete cross-user — userId is taken from JWT.
        expect(pushService.deleteSubscription).not.toHaveBeenCalledWith('bob', expect.anything());
    });

    it('400 on missing endpoint', async () => {
        const app = await buildApp();
        const response = await app.inject({
            method: 'DELETE',
            url: '/subscribe',
            payload: {},
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().errorCode).toBe('PUSH_UNSUBSCRIBE_VALIDATION');
    });
});

describe('GET /prefs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('defaults to enabled/oneDay/oneHour=true for user with no examReminders', async () => {
        vi.mocked(usersService.getUser).mockResolvedValueOnce({
            userId: 'alice',
            passwordEncrypted: 'x',
            createdAt: new Date(),
            lastLogin: new Date(),
            settings: { language: 'ru', notifications: true, theme: 'system' },
        });

        const app = await buildApp();
        const response = await app.inject({ method: 'GET', url: '/prefs' });
        expect(response.statusCode).toBe(200);
        expect(response.json().prefs).toEqual({ enabled: true, oneDay: true, oneHour: true });
    });

    it('returns saved examReminders when present', async () => {
        vi.mocked(usersService.getUser).mockResolvedValueOnce({
            userId: 'alice',
            passwordEncrypted: 'x',
            createdAt: new Date(),
            lastLogin: new Date(),
            settings: {
                language: 'ru', notifications: true, theme: 'system',
                examReminders: { enabled: false, oneDay: true, oneHour: false },
            },
        });

        const app = await buildApp();
        const response = await app.inject({ method: 'GET', url: '/prefs' });
        expect(response.statusCode).toBe(200);
        expect(response.json().prefs).toEqual({ enabled: false, oneDay: true, oneHour: false });
    });
});

describe('PATCH /prefs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('merges partial body into existing settings', async () => {
        vi.mocked(usersService.getUser).mockResolvedValueOnce({
            userId: 'alice',
            passwordEncrypted: 'x',
            createdAt: new Date(),
            lastLogin: new Date(),
            settings: {
                language: 'ru', notifications: true, theme: 'system',
                examReminders: { enabled: true, oneDay: true, oneHour: true },
            },
        });
        vi.mocked(usersService.updateUserSettings).mockResolvedValueOnce(true);

        const app = await buildApp();
        const response = await app.inject({
            method: 'PATCH',
            url: '/prefs',
            payload: { oneHour: false },
        });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.prefs).toEqual({ enabled: true, oneDay: true, oneHour: false });
        expect(usersService.updateUserSettings).toHaveBeenCalledWith('alice', {
            examReminders: { enabled: true, oneDay: true, oneHour: false },
        });
    });

    it('400 PUSH_PREFS_VALIDATION when a field has the wrong type', async () => {
        const app = await buildApp();
        const response = await app.inject({
            method: 'PATCH',
            url: '/prefs',
            // oneHour must be boolean — string should trip Ajv.
            payload: { oneHour: 'yes' } as any,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().errorCode).toBe('PUSH_PREFS_VALIDATION');
    });
});

describe('GET /kind-prefs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('200 with the per-kind prefs envelope for the current user', async () => {
        getNotificationPrefsMock.mockResolvedValueOnce({
            userId: 'alice',
            enabledKinds: { social_mention: false },
            updatedAt: '2025-01-01T00:00:00.000Z',
            createdAt: '2025-01-01T00:00:00.000Z',
        });

        const app = await buildApp();
        const response = await app.inject({ method: 'GET', url: '/kind-prefs' });
        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);
        expect(body.data.userId).toBe('alice');
        expect(body.data.enabledKinds).toEqual({ social_mention: false });
        expect(getNotificationPrefsMock).toHaveBeenCalledWith('alice');
    });

    it('401 when not authenticated', async () => {
        const app = await buildApp({ userId: null });
        const response = await app.inject({ method: 'GET', url: '/kind-prefs' });
        expect(response.statusCode).toBe(401);
        expect(getNotificationPrefsMock).not.toHaveBeenCalled();
    });

    it('500 PUSH_KIND_PREFS_INTERNAL when the service throws', async () => {
        getNotificationPrefsMock.mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp();
        const response = await app.inject({ method: 'GET', url: '/kind-prefs' });
        expect(response.statusCode).toBe(500);
        expect(response.json().errorCode).toBe('PUSH_KIND_PREFS_INTERNAL');
    });
});

describe('PUT /kind-prefs', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('204 and forwards the patch to the service', async () => {
        setNotificationPrefsMock.mockResolvedValueOnce({
            userId: 'alice',
            enabledKinds: { social_mention: false },
            updatedAt: 'x', createdAt: 'x',
        });
        const app = await buildApp();
        const response = await app.inject({
            method: 'PUT',
            url: '/kind-prefs',
            payload: { enabledKinds: { social_mention: false } },
        });
        expect(response.statusCode).toBe(204);
        expect(setNotificationPrefsMock).toHaveBeenCalledWith('alice', { social_mention: false });
    });

    it('400 PUSH_KIND_PREFS_VALIDATION when enabledKinds is missing', async () => {
        const app = await buildApp();
        const response = await app.inject({
            method: 'PUT',
            url: '/kind-prefs',
            payload: {},
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().errorCode).toBe('PUSH_KIND_PREFS_VALIDATION');
        expect(setNotificationPrefsMock).not.toHaveBeenCalled();
    });

    it('400 PUSH_KIND_PREFS_VALIDATION when an unknown kind is included', async () => {
        const app = await buildApp();
        const response = await app.inject({
            method: 'PUT',
            url: '/kind-prefs',
            // `bogus_kind` is not in the PushKind whitelist — Ajv enum should reject.
            payload: { enabledKinds: { bogus_kind: true } } as any,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().errorCode).toBe('PUSH_KIND_PREFS_VALIDATION');
        expect(setNotificationPrefsMock).not.toHaveBeenCalled();
    });

    it('400 PUSH_KIND_PREFS_VALIDATION when a value is the wrong type', async () => {
        const app = await buildApp();
        const response = await app.inject({
            method: 'PUT',
            url: '/kind-prefs',
            payload: { enabledKinds: { social_mention: 'yes' } } as any,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().errorCode).toBe('PUSH_KIND_PREFS_VALIDATION');
    });

    it('401 when not authenticated', async () => {
        const app = await buildApp({ userId: null });
        const response = await app.inject({
            method: 'PUT',
            url: '/kind-prefs',
            payload: { enabledKinds: { social_mention: false } },
        });
        expect(response.statusCode).toBe(401);
        expect(setNotificationPrefsMock).not.toHaveBeenCalled();
    });

    it('500 PUSH_KIND_PREFS_INTERNAL when the service throws', async () => {
        setNotificationPrefsMock.mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp();
        const response = await app.inject({
            method: 'PUT',
            url: '/kind-prefs',
            payload: { enabledKinds: { social_mention: false } },
        });
        expect(response.statusCode).toBe(500);
        expect(response.json().errorCode).toBe('PUSH_KIND_PREFS_INTERNAL');
    });
});
