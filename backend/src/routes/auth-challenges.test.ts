import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { authChallengeRoutes } from './auth-challenges.js';
import * as platonusService from '../services/platonus.js';
import * as usersService from '../services/users.js';
import * as sessionsService from '../services/sessions.js';
import * as pushService from '../services/push.js';
import * as actionLog from '../utils/actionLog.js';
import { resetRateLimitBuckets } from '../utils/rateLimit.js';
import { hashSecret, LOGIN_CHALLENGE_TTL_MS } from '../services/login-challenges.js';

// In-memory shim over the SQL app_login_challenges uses (dispatch by leading
// SQL text, как в services/sessions.test.ts). Держит в синхроне с
// services/login-challenges.ts.

interface ChallengeRow {
    challenge_id: string;
    kind: string;
    status: string;
    approve_secret_hash: string;
    poll_secret_hash: string;
    target_user_id: string | null;
    requester_user_agent: string | null;
    requester_ip: string | null;
    requester_device_name: string | null;
    approved_by_user_id: string | null;
    approved_by_session_id: string | null;
    token_encrypted: string | null;
    created_at: Date;
    expires_at: Date;
    approved_at: Date | null;
    consumed_at: Date | null;
}

const store: ChallengeRow[] = [];
const dbState = { available: true };

function normalize(sql: string): string {
    return sql.trim().toLowerCase().replace(/\s+/g, ' ');
}

const fakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = normalize(sql);

        if (text.startsWith('delete from app_login_challenges where created_at <')) {
            const [before] = params as [Date];
            const keep = store.filter((r) => r.created_at.getTime() >= before.getTime());
            const removed = store.length - keep.length;
            store.splice(0, store.length, ...keep);
            return { rows: [], rowCount: removed };
        }

        if (text.startsWith('insert into app_login_challenges')) {
            const [id, kind, approveHash, pollHash, target, ua, ip, device, createdAt, expiresAt] = params as [
                string, string, string, string, string | null, string | null, string | null, string | null, Date, Date,
            ];
            const row: ChallengeRow = {
                challenge_id: id,
                kind,
                status: 'pending',
                approve_secret_hash: approveHash,
                poll_secret_hash: pollHash,
                target_user_id: target,
                requester_user_agent: ua,
                requester_ip: ip,
                requester_device_name: device,
                approved_by_user_id: null,
                approved_by_session_id: null,
                token_encrypted: null,
                created_at: createdAt,
                expires_at: expiresAt,
                approved_at: null,
                consumed_at: null,
            };
            store.push(row);
            return { rows: [{ ...row }], rowCount: 1 };
        }

        if (text.startsWith('select * from app_login_challenges where challenge_id')) {
            const [id] = params as [string];
            const row = store.find((r) => r.challenge_id === id);
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith('select * from app_login_challenges where approve_secret_hash')) {
            const [hash, now] = params as [string, Date];
            const row = [...store]
                .reverse()
                .find((r) => r.approve_secret_hash === hash && r.status === 'pending' && new Date(r.expires_at).getTime() > now.getTime());
            return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith("update app_login_challenges set status = 'expired'")) {
            const [id] = params as [string];
            const row = store.find((r) => r.challenge_id === id && r.status === 'pending');
            if (row) row.status = 'expired';
            return { rows: [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith("update app_login_challenges set status = 'approved'")) {
            const [id, userId, sessionId, tokenEncrypted, now] = params as [string, string, string | null, string, Date];
            const row = store.find((r) =>
                r.challenge_id === id && r.status === 'pending' && r.expires_at.getTime() > now.getTime());
            if (row) {
                row.status = 'approved';
                row.approved_by_user_id = userId;
                row.approved_by_session_id = sessionId;
                row.token_encrypted = tokenEncrypted;
                row.approved_at = now;
            }
            return { rows: [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith("update app_login_challenges set status = 'denied'")) {
            const [id] = params as [string];
            const row = store.find((r) => r.challenge_id === id && r.status === 'pending');
            if (row) row.status = 'denied';
            return { rows: [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith("update app_login_challenges set status = 'consumed'")) {
            const [id, now] = params as [string, Date];
            const row = store.find((r) => r.challenge_id === id && r.status === 'approved');
            if (!row) return { rows: [], rowCount: 0 };
            row.status = 'consumed';
            row.consumed_at = now;
            return {
                rows: [{ token_encrypted: row.token_encrypted, approved_by_user_id: row.approved_by_user_id }],
                rowCount: 1,
            };
        }

        if (text.startsWith('update app_login_challenges set token_encrypted = null')) {
            const [id] = params as [string];
            const row = store.find((r) => r.challenge_id === id);
            if (row) row.token_encrypted = null;
            return { rows: [], rowCount: row ? 1 : 0 };
        }

        throw new Error(`Unexpected SQL in fake client: ${text}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: typeof fakeClient) => Promise<unknown>) => {
        if (!dbState.available) return null;
        try {
            return await handler(fakeClient);
        } catch {
            return null;
        }
    }),
}));

vi.mock('../services/platonus.js', () => ({
    findUserIdByPlatonusLogin: vi.fn().mockResolvedValue(null),
}));

// constantTimeEquals нужен настоящий — им сравниваются хэши секретов.
vi.mock('../services/users.js', async () => {
    const actual = await vi.importActual<typeof import('../services/users.js')>('../services/users.js');
    return { ...actual, getUser: vi.fn().mockResolvedValue(null) };
});

// parsePlatform/parseBrowser/buildDeviceName — настоящие; сессии — подменены.
vi.mock('../services/sessions.js', async () => {
    const actual = await vi.importActual<typeof import('../services/sessions.js')>('../services/sessions.js');
    return {
        ...actual,
        createUserSession: vi.fn().mockResolvedValue(null),
        findSessionIdByToken: vi.fn().mockResolvedValue('sess-approver'),
    };
});

vi.mock('../services/push.js', () => ({
    getUserSubscriptions: vi.fn().mockResolvedValue([]),
    sendPushNotification: vi.fn().mockResolvedValue({ ok: true, expired: false }),
    deleteSubscription: vi.fn().mockResolvedValue(true),
}));

vi.mock('../utils/actionLog.js', () => ({
    logAction: vi.fn(),
}));

const REQUESTER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36';

async function buildApp() {
    const app = Fastify();
    await app.register(fastifyCookie);
    app.decorate('jwt', {
        sign: vi.fn((payload: { userId: string }) => `jwt-for-${payload.userId}`),
    } as any);
    // Тестовый authenticate: пользователь берётся из заголовка x-test-user.
    app.decorate('authenticate', async (request: any, reply: any) => {
        const userId = request.headers['x-test-user'];
        if (typeof userId !== 'string' || !userId) {
            reply.status(401).send({ error: 'Unauthorized' });
            return;
        }
        request.user = { userId };
    });
    await app.register(authChallengeRoutes);
    return app;
}

type App = Awaited<ReturnType<typeof buildApp>>;

async function createQr(app: App) {
    const response = await app.inject({
        method: 'POST',
        url: '/login/challenge',
        headers: { 'user-agent': REQUESTER_UA },
        remoteAddress: '10.0.0.7',
    });
    expect(response.statusCode).toBe(200);
    return response.json().data as {
        challengeId: string;
        approveSecret: string;
        manualCode: string;
        pollSecret: string;
        qrUrl: string;
        expiresAt: string;
    };
}

async function pollStatus(app: App, challengeId: string, pollSecret: string) {
    return app.inject({
        method: 'GET',
        url: '/login/challenge/status',
        query: { challengeId, pollSecret },
    });
}

async function approverCall(
    app: App,
    path: 'inspect' | 'approve' | 'deny',
    userId: string | null,
    body: { challengeId?: string | null; approveSecret: string },
    token = 'approver-token',
) {
    return app.inject({
        method: 'POST',
        url: `/login/challenge/${path}`,
        headers: {
            ...(userId ? { 'x-test-user': userId } : {}),
            authorization: `Bearer ${token}`,
        },
        payload: body,
    });
}

beforeEach(() => {
    vi.clearAllMocks();
    store.splice(0, store.length);
    dbState.available = true;
    resetRateLimitBuckets();
    vi.unstubAllEnvs();
    vi.mocked(platonusService.findUserIdByPlatonusLogin).mockResolvedValue(null);
    vi.mocked(usersService.getUser).mockResolvedValue(null);
    vi.mocked(sessionsService.createUserSession).mockResolvedValue(null);
    vi.mocked(sessionsService.findSessionIdByToken).mockResolvedValue('sess-approver');
    vi.mocked(pushService.getUserSubscriptions).mockResolvedValue([]);
    vi.mocked(pushService.sendPushNotification).mockResolvedValue({ ok: true, expired: false });
    vi.mocked(pushService.deleteSubscription).mockResolvedValue(true);
});

describe('POST /login/challenge (QR)', () => {
    it('creates a pending qr challenge; secrets are returned once and stored only as hashes', async () => {
        vi.stubEnv('PUBLIC_APP_URL', 'https://example.test/');
        const app = await buildApp();
        const before = Date.now();
        const data = await createQr(app);

        expect(data.challengeId).toMatch(/^[0-9a-f-]{36}$/);
        expect(data.approveSecret).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
        expect(data.manualCode).toBe(
            `${data.approveSecret.slice(0, 4)}-${data.approveSecret.slice(4, 8)}-${data.approveSecret.slice(8)}`,
        );
        expect(Buffer.from(data.pollSecret, 'base64url')).toHaveLength(32);
        expect(data.qrUrl).toBe(`https://example.test/login/approve?c=${data.challengeId}&s=${data.approveSecret}`);
        // pollSecret никогда не попадает в QR.
        expect(data.qrUrl).not.toContain(data.pollSecret);

        const expiresAt = Date.parse(data.expiresAt);
        expect(expiresAt - before).toBeGreaterThanOrEqual(LOGIN_CHALLENGE_TTL_MS - 1000);
        expect(expiresAt - before).toBeLessThanOrEqual(LOGIN_CHALLENGE_TTL_MS + 1000);

        expect(store).toHaveLength(1);
        const row = store[0];
        expect(row.kind).toBe('qr');
        expect(row.status).toBe('pending');
        expect(row.target_user_id).toBeNull();
        expect(row.approve_secret_hash).toBe(hashSecret(data.approveSecret));
        expect(row.poll_secret_hash).toBe(hashSecret(data.pollSecret));
        expect(row.requester_user_agent).toBe(REQUESTER_UA);
        expect(row.requester_ip).toBe('10.0.0.7');
        expect(row.requester_device_name).toBe('Windows · Chrome');
        // Ни один секрет не лежит в открытом виде.
        expect(JSON.stringify(row)).not.toContain(data.approveSecret);
        expect(JSON.stringify(row)).not.toContain(data.pollSecret);
    });

    it('purges rows older than 24h on create', async () => {
        store.push({
            challenge_id: 'old',
            kind: 'qr',
            status: 'expired',
            approve_secret_hash: 'x',
            poll_secret_hash: 'y',
            target_user_id: null,
            requester_user_agent: null,
            requester_ip: null,
            requester_device_name: null,
            approved_by_user_id: null,
            approved_by_session_id: null,
            token_encrypted: null,
            created_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
            expires_at: new Date(Date.now() - 25 * 60 * 60 * 1000),
            approved_at: null,
            consumed_at: null,
        });
        const app = await buildApp();
        await createQr(app);
        expect(store.map((r) => r.challenge_id)).not.toContain('old');
        expect(store).toHaveLength(1);
    });

    it('429 after 10 creates per minute from one ip', async () => {
        const app = await buildApp();
        for (let i = 0; i < 10; i += 1) {
            await createQr(app);
        }
        const response = await app.inject({ method: 'POST', url: '/login/challenge', remoteAddress: '10.0.0.7' });
        expect(response.statusCode).toBe(429);
        expect(response.headers['retry-after']).toBeDefined();
    });

    it('500 when the database is unavailable', async () => {
        dbState.available = false;
        const app = await buildApp();
        const response = await app.inject({ method: 'POST', url: '/login/challenge' });
        expect(response.statusCode).toBe(500);
    });
});

describe('QR flow: status → approve → token once → consumed', () => {
    it('walks the happy path and hands the token out exactly once', async () => {
        const app = await buildApp();
        const data = await createQr(app);

        // Pending until someone approves.
        let status = await pollStatus(app, data.challengeId, data.pollSecret);
        expect(status.statusCode).toBe(200);
        expect(status.json()).toEqual({ success: true, data: { status: 'pending' } });

        // Approver inspects with the manual code (lowercase + dashes → normalized).
        const inspect = await approverCall(app, 'inspect', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.manualCode.toLowerCase(),
        });
        expect(inspect.statusCode).toBe(200);
        expect(inspect.json().data).toEqual(expect.objectContaining({
            challengeId: data.challengeId,
            kind: 'qr',
            status: 'pending',
            requesterDeviceName: 'Windows · Chrome',
            requesterIp: '10.0.0.7',
            expiresAt: data.expiresAt,
        }));
        expect(typeof inspect.json().data.createdAt).toBe('string');

        // Approve.
        const approve = await approverCall(app, 'approve', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.approveSecret,
        });
        expect(approve.statusCode).toBe(200);
        expect(approve.json()).toEqual({ success: true, data: { status: 'approved' } });

        // Сессия заведена для устройства-запросчика (его UA/IP), а не approver'а.
        expect(sessionsService.createUserSession).toHaveBeenCalledWith({
            userId: 'alice',
            token: 'jwt-for-alice',
            userAgent: REQUESTER_UA,
            ip: '10.0.0.7',
        });
        expect(sessionsService.findSessionIdByToken).toHaveBeenCalledWith('approver-token');
        const row = store[0];
        expect(row.status).toBe('approved');
        expect(row.approved_by_user_id).toBe('alice');
        expect(row.approved_by_session_id).toBe('sess-approver');
        expect(row.token_encrypted).toBeTruthy();
        expect(row.token_encrypted).not.toBe('jwt-for-alice');
        expect(actionLog.logAction).toHaveBeenCalledWith(
            'alice',
            'login_challenge_approved',
            expect.any(String),
            expect.objectContaining({ entityId: data.challengeId, result: 'approved' }),
        );

        // Requester polls: token exactly once, cookie set, row consumed.
        status = await pollStatus(app, data.challengeId, data.pollSecret);
        expect(status.statusCode).toBe(200);
        expect(status.json()).toEqual({
            success: true,
            data: { status: 'approved', token: 'jwt-for-alice', user: { userId: 'alice' } },
        });
        expect(String(status.headers['set-cookie'])).toContain('jwt-for-alice');
        expect(actionLog.logAction).toHaveBeenCalledWith(
            'alice',
            'login',
            'Login via qr challenge',
            expect.objectContaining({ entityId: data.challengeId }),
        );
        expect(row.status).toBe('consumed');
        expect(row.token_encrypted).toBeNull();

        // Second poll: consumed, no token.
        status = await pollStatus(app, data.challengeId, data.pollSecret);
        expect(status.statusCode).toBe(200);
        expect(status.json()).toEqual({ success: true, data: { status: 'consumed' } });
        expect(status.headers['set-cookie']).toBeUndefined();

        // Approving again is a conflict with the current status.
        const again = await approverCall(app, 'approve', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.approveSecret,
        });
        expect(again.statusCode).toBe(409);
        expect(again.json()).toEqual(expect.objectContaining({
            success: false,
            errorCode: 'LOGIN_CHALLENGE_NOT_PENDING',
            data: { status: 'consumed' },
        }));
    });

    it('manual code alone (no challengeId) resolves the pending challenge', async () => {
        const app = await buildApp();
        const data = await createQr(app);

        const inspect = await approverCall(app, 'inspect', 'alice', {
            approveSecret: data.manualCode.toLowerCase(),
        });
        expect(inspect.statusCode).toBe(200);
        expect(inspect.json().data.challengeId).toBe(data.challengeId);

        const approve = await approverCall(app, 'approve', 'alice', {
            challengeId: '',
            approveSecret: data.manualCode,
        });
        expect(approve.statusCode).toBe(200);

        // Once approved the code no longer resolves without its challengeId.
        const again = await approverCall(app, 'inspect', 'alice', { approveSecret: data.manualCode });
        expect(again.statusCode).toBe(404);

        const status = await pollStatus(app, data.challengeId, data.pollSecret);
        expect(status.json().data.status).toBe('approved');
        expect(typeof status.json().data.token).toBe('string');
    });

    it('approve/inspect/deny require authentication', async () => {
        const app = await buildApp();
        const data = await createQr(app);
        for (const path of ['inspect', 'approve', 'deny'] as const) {
            const response = await approverCall(app, path, null, {
                challengeId: data.challengeId,
                approveSecret: data.approveSecret,
            });
            expect(response.statusCode).toBe(401);
        }
        expect(store[0].status).toBe('pending');
    });
});

describe('deny', () => {
    it('marks the challenge denied; requester sees denied and approve is refused', async () => {
        const app = await buildApp();
        const data = await createQr(app);

        const deny = await approverCall(app, 'deny', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.manualCode,
        });
        expect(deny.statusCode).toBe(200);
        expect(deny.json()).toEqual({ success: true, data: { status: 'denied' } });
        expect(store[0].status).toBe('denied');
        expect(actionLog.logAction).toHaveBeenCalledWith(
            'alice',
            'login_challenge_denied',
            expect.any(String),
            expect.objectContaining({ entityId: data.challengeId, result: 'rejected' }),
        );

        const status = await pollStatus(app, data.challengeId, data.pollSecret);
        expect(status.json()).toEqual({ success: true, data: { status: 'denied' } });

        const approve = await approverCall(app, 'approve', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.approveSecret,
        });
        expect(approve.statusCode).toBe(409);
        expect(approve.json().data).toEqual({ status: 'denied' });
        expect(sessionsService.createUserSession).not.toHaveBeenCalled();

        // Denying twice is idempotent.
        const denyAgain = await approverCall(app, 'deny', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.approveSecret,
        });
        expect(denyAgain.statusCode).toBe(200);
        expect(denyAgain.json().data).toEqual({ status: 'denied' });
    });

    it('cannot deny an already approved challenge', async () => {
        const app = await buildApp();
        const data = await createQr(app);
        await approverCall(app, 'approve', 'alice', { challengeId: data.challengeId, approveSecret: data.approveSecret });

        const deny = await approverCall(app, 'deny', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.approveSecret,
        });
        expect(deny.statusCode).toBe(409);
        expect(deny.json().data).toEqual({ status: 'approved' });
        expect(store[0].status).toBe('approved');
    });
});

describe('expiry', () => {
    it('pending challenge past expires_at reads as expired and is persisted as such', async () => {
        const app = await buildApp();
        const data = await createQr(app);
        store[0].expires_at = new Date(Date.now() - 1000);

        const status = await pollStatus(app, data.challengeId, data.pollSecret);
        expect(status.statusCode).toBe(200);
        expect(status.json()).toEqual({ success: true, data: { status: 'expired' } });
        expect(store[0].status).toBe('expired');

        const approve = await approverCall(app, 'approve', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.approveSecret,
        });
        expect(approve.statusCode).toBe(409);
        expect(approve.json().data).toEqual({ status: 'expired' });
        expect(sessionsService.createUserSession).not.toHaveBeenCalled();
    });

    it('inspect also marks an expired pending challenge', async () => {
        const app = await buildApp();
        const data = await createQr(app);
        store[0].expires_at = new Date(Date.now() - 1000);

        const inspect = await approverCall(app, 'inspect', 'alice', {
            challengeId: data.challengeId,
            approveSecret: data.approveSecret,
        });
        expect(inspect.statusCode).toBe(200);
        expect(inspect.json().data.status).toBe('expired');
        expect(store[0].status).toBe('expired');
    });
});

describe('not found', () => {
    it('404 for a wrong pollSecret', async () => {
        const app = await buildApp();
        const data = await createQr(app);
        const status = await pollStatus(app, data.challengeId, `${data.pollSecret.slice(0, -1)}X`);
        expect(status.statusCode).toBe(404);
        expect(status.json()).toEqual(expect.objectContaining({ success: false, errorCode: 'LOGIN_CHALLENGE_NOT_FOUND' }));
        // approveSecret тоже не годится вместо pollSecret.
        const viaApprove = await pollStatus(app, data.challengeId, data.approveSecret);
        expect(viaApprove.statusCode).toBe(404);
    });

    it('404 for an unknown challengeId and for missing query params', async () => {
        const app = await buildApp();
        const status = await pollStatus(app, 'does-not-exist', 'whatever');
        expect(status.statusCode).toBe(404);
        const missing = await app.inject({ method: 'GET', url: '/login/challenge/status' });
        expect(missing.statusCode).toBe(404);
    });

    it('404 for a wrong approveSecret on inspect/approve/deny (no status change)', async () => {
        const app = await buildApp();
        const data = await createQr(app);
        const wrong = data.approveSecret.startsWith('A') ? `B${data.approveSecret.slice(1)}` : `A${data.approveSecret.slice(1)}`;
        for (const path of ['inspect', 'approve', 'deny'] as const) {
            const response = await approverCall(app, path, 'alice', { challengeId: data.challengeId, approveSecret: wrong });
            expect(response.statusCode).toBe(404);
            expect(response.json().errorCode).toBe('LOGIN_CHALLENGE_NOT_FOUND');
        }
        // pollSecret не подходит как approveSecret.
        const viaPoll = await approverCall(app, 'inspect', 'alice', { challengeId: data.challengeId, approveSecret: data.pollSecret });
        expect(viaPoll.statusCode).toBe(404);
        expect(store[0].status).toBe('pending');
    });
});

describe('POST /login/push/challenge', () => {
    const SUB = {
        id: 1,
        userId: 'bob',
        endpoint: 'https://push.example/sub-1',
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
        createdAt: new Date(),
        lastSeenAt: new Date(),
    };

    async function createPush(app: App, username: string) {
        return app.inject({
            method: 'POST',
            url: '/login/push/challenge',
            headers: { 'user-agent': REQUESTER_UA },
            remoteAddress: '10.0.0.9',
            payload: { username },
        });
    }

    function approveSecretFromPush(): { challengeId: string; approveSecret: string; payload: Record<string, unknown> } {
        const call = vi.mocked(pushService.sendPushNotification).mock.calls[0];
        expect(call).toBeDefined();
        const payload = call![1] as Record<string, unknown>;
        const url = new URL(String(payload.url), 'https://x.test');
        return {
            challengeId: url.searchParams.get('c') as string,
            approveSecret: url.searchParams.get('s') as string,
            payload,
        };
    }

    it('delivered:false with null fields when the user is unknown (no row created)', async () => {
        const app = await buildApp();
        const response = await createPush(app, 'nobody');
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
            success: true,
            data: { challengeId: null, pollSecret: null, expiresAt: null, delivered: false },
        });
        expect(store).toHaveLength(0);
        expect(pushService.sendPushNotification).not.toHaveBeenCalled();
    });

    it('delivered:false when the user has no push subscriptions (no row created)', async () => {
        vi.mocked(platonusService.findUserIdByPlatonusLogin).mockResolvedValue('bob');
        vi.mocked(pushService.getUserSubscriptions).mockResolvedValue([]);
        const app = await buildApp();
        const response = await createPush(app, 'bob');
        expect(response.statusCode).toBe(200);
        expect(response.json().data).toEqual({ challengeId: null, pollSecret: null, expiresAt: null, delivered: false });
        expect(pushService.getUserSubscriptions).toHaveBeenCalledWith('bob');
        expect(store).toHaveLength(0);
    });

    it('delivered:false and challenge expired when every push send fails', async () => {
        vi.mocked(platonusService.findUserIdByPlatonusLogin).mockResolvedValue('bob');
        vi.mocked(pushService.getUserSubscriptions).mockResolvedValue([SUB]);
        vi.mocked(pushService.sendPushNotification).mockResolvedValue({ ok: false, expired: true });
        const app = await buildApp();
        const response = await createPush(app, 'bob');
        expect(response.statusCode).toBe(200);
        expect(response.json().data.delivered).toBe(false);
        expect(store).toHaveLength(1);
        expect(store[0].status).toBe('expired');
        expect(pushService.deleteSubscription).toHaveBeenCalledWith('bob', SUB.endpoint);
    });

    it('sends the approve link via push and only hands the requester the pollSecret', async () => {
        // Пользователь найден через app_users (новый аккаунт), не через маппинг.
        vi.mocked(usersService.getUser).mockResolvedValue({ userId: 'bob' } as any);
        vi.mocked(pushService.getUserSubscriptions).mockResolvedValue([SUB]);
        const app = await buildApp();
        const response = await createPush(app, ' bob ');
        expect(response.statusCode).toBe(200);
        const data = response.json().data;
        expect(data.delivered).toBe(true);
        expect(typeof data.challengeId).toBe('string');
        expect(typeof data.pollSecret).toBe('string');
        expect(typeof data.expiresAt).toBe('string');
        expect(data.approveSecret).toBeUndefined();
        expect(data.manualCode).toBeUndefined();
        expect(data.qrUrl).toBeUndefined();

        expect(usersService.getUser).toHaveBeenCalledWith('bob');
        const { challengeId, approveSecret, payload } = approveSecretFromPush();
        expect(challengeId).toBe(data.challengeId);
        expect(approveSecret).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
        expect(payload.title).toBe('Вход в UniverKstu');
        expect(payload.body).toBe('Подтвердите вход: Windows · Chrome, 10.0.0.9');
        expect(payload.url).toBe(`/login/approve?c=${challengeId}&s=${approveSecret}`);
        expect(payload.data).toEqual(expect.objectContaining({ kind: 'login_approve' }));
        expect(JSON.stringify(payload)).not.toContain(data.pollSecret);

        expect(store[0].kind).toBe('push');
        expect(store[0].target_user_id).toBe('bob');
    });

    it('push challenge is forbidden for anyone but the target user', async () => {
        vi.mocked(platonusService.findUserIdByPlatonusLogin).mockResolvedValue('bob');
        vi.mocked(pushService.getUserSubscriptions).mockResolvedValue([SUB]);
        const app = await buildApp();
        const response = await createPush(app, 'bob');
        const data = response.json().data;
        const { challengeId, approveSecret } = approveSecretFromPush();

        for (const path of ['inspect', 'approve', 'deny'] as const) {
            const other = await approverCall(app, path, 'alice', { challengeId, approveSecret });
            expect(other.statusCode).toBe(403);
            expect(other.json()).toEqual(expect.objectContaining({ success: false, errorCode: 'LOGIN_CHALLENGE_FORBIDDEN' }));
        }
        expect(store[0].status).toBe('pending');
        expect(sessionsService.createUserSession).not.toHaveBeenCalled();

        // The target user can inspect and approve, and the requester gets bob's token.
        const inspect = await approverCall(app, 'inspect', 'bob', { challengeId, approveSecret });
        expect(inspect.statusCode).toBe(200);
        expect(inspect.json().data.kind).toBe('push');

        const approve = await approverCall(app, 'approve', 'bob', { challengeId, approveSecret });
        expect(approve.statusCode).toBe(200);

        const status = await pollStatus(app, challengeId, data.pollSecret);
        expect(status.json()).toEqual({
            success: true,
            data: { status: 'approved', token: 'jwt-for-bob', user: { userId: 'bob' } },
        });
        expect(actionLog.logAction).toHaveBeenCalledWith(
            'bob',
            'login',
            'Login via push challenge',
            expect.objectContaining({ entityId: challengeId }),
        );
    });

    it('400 without username; 429 after 3 requests per username in 10 minutes', async () => {
        const app = await buildApp();
        const missing = await app.inject({ method: 'POST', url: '/login/push/challenge', payload: {} });
        expect(missing.statusCode).toBe(400);

        for (let i = 0; i < 3; i += 1) {
            const ok = await app.inject({
                method: 'POST',
                url: '/login/push/challenge',
                remoteAddress: `10.0.1.${i}`,
                payload: { username: 'Bob' },
            });
            expect(ok.statusCode).toBe(200);
        }
        const limited = await app.inject({
            method: 'POST',
            url: '/login/push/challenge',
            remoteAddress: '10.0.1.99',
            payload: { username: 'bob' },
        });
        expect(limited.statusCode).toBe(429);
    });
});
