import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    approveLoginChallenge,
    createLoginChallenge,
    createPushLoginChallenge,
    inspectLoginChallenge,
    login,
    pollLoginChallenge,
    register,
} from './auth';
import { API_URL } from './core';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

let localStorage: MemoryStorage;
let sessionStorage: MemoryStorage;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

beforeEach(() => {
    localStorage = new MemoryStorage();
    sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

function lastRequest(): { url: string; init: RequestInit } {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) throw new Error('fetch was not called');
    return { url: String(call[0]), init: (call[1] ?? {}) as RequestInit };
}

describe('register', () => {
    it('posts login/password/referralCode and stores the token on success', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            success: true,
            token: 'jwt-1',
            user: { userId: 'u-1' },
            referral: { status: 'applied' },
        }));

        const result = await register('ivanov.ivan', 'secret', 'REF123');

        const { url, init } = lastRequest();
        expect(url).toBe(`${API_URL}/api/v3/auth/register`);
        expect(init.method).toBe('POST');
        expect(init.credentials).toBe('include');
        expect(JSON.parse(String(init.body))).toEqual({ login: 'ivanov.ivan', password: 'secret', referralCode: 'REF123' });

        expect(result.success).toBe(true);
        expect(result.statusCode).toBe(200);
        expect(result.referral?.status).toBe('applied');
        expect(localStorage.getItem('token')).toBe('jwt-1');
        expect(localStorage.getItem('userId')).toBe('u-1');
    });

    it('sends referralCode: null when no code is given', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, token: 't', user: { userId: 'u' } }));
        await register('a', 'b');
        expect(JSON.parse(String(lastRequest().init.body))).toEqual({ login: 'a', password: 'b', referralCode: null });
    });

    it('surfaces AUTH_ALREADY_REGISTERED (409) without storing a token', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(409, {
            success: false,
            error: 'Аккаунт уже зарегистрирован, войдите',
            errorCode: 'AUTH_ALREADY_REGISTERED',
        }));

        const result = await register('ivanov.ivan', 'secret');

        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(409);
        expect(result.errorCode).toBe('AUTH_ALREADY_REGISTERED');
        expect(result.error).toBe('Аккаунт уже зарегистрирован, войдите');
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('surfaces AUTH_INVALID_CREDENTIALS (401)', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(401, { success: false, error: 'bad', errorCode: 'AUTH_INVALID_CREDENTIALS' }));
        const result = await register('x', 'y');
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('returns a friendly error when the network is down', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const result = await register('x', 'y');
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(0);
        expect(result.error).toBeTruthy();
    });
});

describe('login', () => {
    it('propagates AUTH_NOT_REGISTERED (404) so the form can offer registration', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(404, {
            success: false,
            error: 'Аккаунт не найден. Сначала зарегистрируйтесь',
            errorCode: 'AUTH_NOT_REGISTERED',
        }));

        const result = await login('ivanov.ivan', 'secret');

        expect(JSON.parse(String(lastRequest().init.body))).toEqual({ username: 'ivanov.ivan', password: 'secret' });
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('AUTH_NOT_REGISTERED');
        expect(result.statusCode).toBe(404);
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('stores the token on success', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, token: 'jwt-2', user: { userId: 'u-2' } }));
        const result = await login('a', 'b');
        expect(result.success).toBe(true);
        expect(localStorage.getItem('token')).toBe('jwt-2');
        expect(localStorage.getItem('userId')).toBe('u-2');
    });
});

describe('createLoginChallenge / createPushLoginChallenge', () => {
    it('returns the QR challenge payload', async () => {
        const payload = {
            challengeId: 'ch-1',
            approveSecret: 'ABCDEFGHJKMN',
            manualCode: 'ABCD-EFGH-JKMN',
            pollSecret: 'poll',
            qrUrl: 'https://univerkstu.app/login/approve?c=ch-1&s=ABCDEFGHJKMN',
            expiresAt: '2026-09-04T10:02:00.000Z',
        };
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, data: payload }));

        const result = await createLoginChallenge();

        expect(lastRequest().url).toBe(`${API_URL}/api/v3/auth/login/challenge`);
        expect(lastRequest().init.headers).not.toHaveProperty('Authorization');
        expect(result.success).toBe(true);
        expect(result.data).toEqual(payload);
    });

    it('maps a rate-limit failure to success:false with the server message', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(429, { success: false, error: 'Слишком много запросов' }));
        const result = await createLoginChallenge();
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(429);
        expect(result.error).toBe('Слишком много запросов');
    });

    it('posts the username for a push challenge and passes delivered:false through', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            success: true,
            data: { challengeId: null, pollSecret: null, expiresAt: null, delivered: false },
        }));

        const result = await createPushLoginChallenge('ivanov.ivan');

        expect(lastRequest().url).toBe(`${API_URL}/api/v3/auth/login/push/challenge`);
        expect(JSON.parse(String(lastRequest().init.body))).toEqual({ username: 'ivanov.ivan' });
        expect(result.success).toBe(true);
        expect(result.data?.delivered).toBe(false);
        expect(result.data?.challengeId).toBeNull();
    });
});

describe('pollLoginChallenge', () => {
    it('sends challengeId + pollSecret as query params and reports pending', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, data: { status: 'pending' } }));

        const result = await pollLoginChallenge('ch-1', 'poll+secret/=');

        const { url, init } = lastRequest();
        const parsed = new URL(url);
        expect(parsed.pathname).toBe('/api/v3/auth/login/challenge/status');
        expect(parsed.searchParams.get('challengeId')).toBe('ch-1');
        expect(parsed.searchParams.get('pollSecret')).toBe('poll+secret/=');
        expect(init.method).toBe('GET');
        expect(init.credentials).toBe('include');
        expect(result).toMatchObject({ success: true, status: 'pending' });
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('stores the token and userId when the challenge is approved (top-level token)', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            success: true,
            data: { status: 'approved' },
            token: 'jwt-qr',
            user: { userId: 'u-qr' },
        }));

        const result = await pollLoginChallenge('ch-1', 'poll', 'qr');

        expect(result.success).toBe(true);
        expect(result.status).toBe('approved');
        expect(result.user).toEqual({ userId: 'u-qr' });
        expect(localStorage.getItem('token')).toBe('jwt-qr');
        expect(localStorage.getItem('userId')).toBe('u-qr');
    });

    it('also accepts token/user nested inside data', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            success: true,
            data: { status: 'approved', token: 'jwt-nested', user: { userId: 'u-nested' } },
        }));

        const result = await pollLoginChallenge('ch-1', 'poll', 'push');

        expect(result.status).toBe('approved');
        expect(localStorage.getItem('token')).toBe('jwt-nested');
        expect(localStorage.getItem('userId')).toBe('u-nested');
    });

    it('does not store anything for consumed/denied/expired', async () => {
        for (const status of ['consumed', 'denied', 'expired'] as const) {
            fetchMock.mockResolvedValueOnce(jsonResponse(200, { success: true, data: { status } }));
            const result = await pollLoginChallenge('ch-1', 'poll');
            expect(result).toMatchObject({ success: true, status });
        }
        expect(localStorage.getItem('token')).toBeNull();
    });

    it('returns success:false with errorCode for LOGIN_CHALLENGE_NOT_FOUND', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(404, { success: false, error: 'nope', errorCode: 'LOGIN_CHALLENGE_NOT_FOUND' }));
        const result = await pollLoginChallenge('ch-x', 'bad');
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('LOGIN_CHALLENGE_NOT_FOUND');
        expect(result.statusCode).toBe(404);
    });

    it('reports statusCode 0 on network failure so callers keep polling', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const result = await pollLoginChallenge('ch-1', 'poll');
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(0);
    });
});

describe('inspect / approve (authenticated)', () => {
    it('sends the bearer token and the challenge pair', async () => {
        localStorage.setItem('token', 'jwt-approver');
        fetchMock.mockResolvedValueOnce(jsonResponse(200, {
            success: true,
            data: {
                challengeId: 'ch-1',
                kind: 'qr',
                status: 'pending',
                requesterDeviceName: 'Windows · Chrome',
                requesterIp: '10.0.0.1',
                createdAt: '2026-09-04T10:00:00.000Z',
                expiresAt: '2026-09-04T10:02:00.000Z',
            },
        }));

        const result = await inspectLoginChallenge('ch-1', 'ABCDEFGHJKMN');

        const { url, init } = lastRequest();
        expect(url).toBe(`${API_URL}/api/v3/auth/login/challenge/inspect`);
        expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer jwt-approver');
        expect(JSON.parse(String(init.body))).toEqual({ challengeId: 'ch-1', approveSecret: 'ABCDEFGHJKMN' });
        expect(result.success).toBe(true);
        expect(result.data?.requesterDeviceName).toBe('Windows · Chrome');
    });

    it('passes the current status through on LOGIN_CHALLENGE_NOT_PENDING (409)', async () => {
        localStorage.setItem('token', 'jwt-approver');
        fetchMock.mockResolvedValueOnce(jsonResponse(409, {
            success: false,
            error: 'already handled',
            errorCode: 'LOGIN_CHALLENGE_NOT_PENDING',
            data: { status: 'expired' },
        }));

        const result = await approveLoginChallenge('ch-1', 'ABCDEFGHJKMN');

        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('LOGIN_CHALLENGE_NOT_PENDING');
        expect(result.data?.status).toBe('expired');
    });
});
