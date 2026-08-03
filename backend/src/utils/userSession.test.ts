import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
    USER_SESSION_COOKIE,
    clearUserSessionCookie,
    readBearerToken,
    readUserSessionToken,
    setUserSessionCookie,
    runAuthenticate,
    type AuthenticateDeps,
} from './userSession.js';

function makeRequest(opts: {
    authorization?: string | undefined;
    cookies?: Record<string, string> | undefined;
}): FastifyRequest {
    return {
        headers: opts.authorization !== undefined ? { authorization: opts.authorization } : {},
        cookies: opts.cookies ?? {},
    } as unknown as FastifyRequest;
}

function makeReply() {
    const setCookie = vi.fn();
    const clearCookie = vi.fn();
    return {
        reply: { setCookie, clearCookie } as unknown as FastifyReply,
        setCookie,
        clearCookie,
    };
}

describe('readBearerToken', () => {
    it('returns null when Authorization header missing', () => {
        expect(readBearerToken(makeRequest({}))).toBeNull();
    });

    it('returns null when header is not a string', () => {
        const request = { headers: { authorization: ['Bearer x'] as unknown as string } } as unknown as FastifyRequest;
        expect(readBearerToken(request)).toBeNull();
    });

    it('returns null when scheme is not "Bearer "', () => {
        expect(readBearerToken(makeRequest({ authorization: 'Basic foo' }))).toBeNull();
        expect(readBearerToken(makeRequest({ authorization: 'bearer foo' }))).toBeNull(); // case sensitive
    });

    it('returns the token after "Bearer " prefix', () => {
        expect(readBearerToken(makeRequest({ authorization: 'Bearer abc.def.ghi' }))).toBe('abc.def.ghi');
    });

    it('returns null for empty token after trim', () => {
        expect(readBearerToken(makeRequest({ authorization: 'Bearer    ' }))).toBeNull();
    });

    it('trims surrounding whitespace in the token', () => {
        expect(readBearerToken(makeRequest({ authorization: 'Bearer    abc   ' }))).toBe('abc');
    });
});

describe('readUserSessionToken', () => {
    it('returns null when cookies object is missing', () => {
        const request = {} as unknown as FastifyRequest;
        expect(readUserSessionToken(request)).toBeNull();
    });

    it('returns null when the cookie is absent', () => {
        expect(readUserSessionToken(makeRequest({ cookies: {} }))).toBeNull();
    });

    it('returns null when cookie value is empty or whitespace-only', () => {
        expect(readUserSessionToken(makeRequest({ cookies: { [USER_SESSION_COOKIE]: '' } }))).toBeNull();
        expect(readUserSessionToken(makeRequest({ cookies: { [USER_SESSION_COOKIE]: '   ' } }))).toBeNull();
    });

    it('returns the cookie value (without trimming) when present', () => {
        // Implementation tests for trim().truthy but returns the un-trimmed value.
        const result = readUserSessionToken(makeRequest({ cookies: { [USER_SESSION_COOKIE]: '  token-value  ' } }));
        expect(result).toBe('  token-value  ');
    });

    it('exposes the canonical cookie name', () => {
        expect(USER_SESSION_COOKIE).toBe('user_session');
    });
});

describe('setUserSessionCookie / clearUserSessionCookie', () => {
    beforeEach(() => {
        vi.stubEnv('NODE_ENV', 'development');
        vi.stubEnv('USER_SESSION_TTL_DAYS', '7');
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('setUserSessionCookie writes the session cookie with httpOnly + lax in dev', () => {
        const { reply, setCookie } = makeReply();
        setUserSessionCookie(reply, 'jwt-here');
        expect(setCookie).toHaveBeenCalledTimes(1);
        const [name, value, options] = setCookie.mock.calls[0];
        expect(name).toBe(USER_SESSION_COOKIE);
        expect(value).toBe('jwt-here');
        expect(options).toMatchObject({
            path: '/',
            httpOnly: true,
            secure: false,
            sameSite: 'lax',
            maxAge: 7 * 86400,
        });
    });

    it('uses secure + sameSite=none in production', () => {
        vi.stubEnv('NODE_ENV', 'production');
        const { reply, setCookie } = makeReply();
        setUserSessionCookie(reply, 'jwt-here');
        const options = setCookie.mock.calls[0][2];
        expect(options.secure).toBe(true);
        expect(options.sameSite).toBe('none');
    });

    it('falls back to 365 days when neither USER_SESSION_TTL_DAYS nor JWT_COOKIE_TTL_DAYS is set', () => {
        vi.unstubAllEnvs();
        const { reply, setCookie } = makeReply();
        setUserSessionCookie(reply, 'jwt-here');
        const options = setCookie.mock.calls[0][2];
        expect(options.maxAge).toBe(365 * 86400);
    });

    it('reads from JWT_COOKIE_TTL_DAYS when USER_SESSION_TTL_DAYS is unset', () => {
        vi.unstubAllEnvs();
        vi.stubEnv('JWT_COOKIE_TTL_DAYS', '14');
        const { reply, setCookie } = makeReply();
        setUserSessionCookie(reply, 'jwt-here');
        expect(setCookie.mock.calls[0][2].maxAge).toBe(14 * 86400);
    });

    it('clearUserSessionCookie calls clearCookie with the right name and path', () => {
        const { reply, clearCookie } = makeReply();
        clearUserSessionCookie(reply);
        expect(clearCookie).toHaveBeenCalledWith(USER_SESSION_COOKIE, { path: '/' });
    });
});

// ---------------------------------------------------------------------------
// runAuthenticate — тело app.authenticate.
// Цена ошибки здесь — разлогин всех живых пользователей, поэтому покрываем
// каждую развилку: активная сессия, отозванная, отсутствующая (легаси-токен),
// протухший токен на каждом из этих трёх статусов и падение самой проверки.
// ---------------------------------------------------------------------------

function makeAuthRequest(token: string | null): FastifyRequest & { user?: { userId: string } } {
    return {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        cookies: {},
    } as unknown as FastifyRequest & { user?: { userId: string } };
}

function makeAuthReply() {
    const send = vi.fn();
    const status = vi.fn(() => ({ send }));
    const header = vi.fn();
    const setCookie = vi.fn();
    return {
        reply: { status, send, header, setCookie } as unknown as FastifyReply,
        status,
        send,
        header,
        setCookie,
    };
}

class ExpiredTokenError extends Error {
    code = 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED';
    constructor() {
        super('Authorization token expired');
    }
}

function makeDeps(overrides: Partial<AuthenticateDeps> = {}): AuthenticateDeps {
    return {
        verifyToken: vi.fn(() => ({ userId: 'S123' })),
        decodeToken: vi.fn(() => ({ userId: 'S123' })),
        signToken: vi.fn(() => 'new-token'),
        userExists: vi.fn(async () => true),
        isSessionRevoked: vi.fn(async () => false),
        ...overrides,
    };
}

describe('runAuthenticate', () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it('401s when no token is present at all', async () => {
        const request = makeAuthRequest(null);
        const { reply, status, send } = makeAuthReply();
        await runAuthenticate(request, reply, makeDeps());
        expect(status).toHaveBeenCalledWith(401);
        expect(send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(request.user).toBeUndefined();
    });

    it('valid token with an ACTIVE session row passes', async () => {
        const request = makeAuthRequest('good-token');
        const { reply, status } = makeAuthReply();
        const onAuthenticated = vi.fn();
        await runAuthenticate(request, reply, makeDeps({ onAuthenticated }));
        expect(status).not.toHaveBeenCalled();
        expect(request.user).toEqual({ userId: 'S123' });
        expect(onAuthenticated).toHaveBeenCalledTimes(1);
    });

    it('valid token with NO session row (legacy backfill path) still passes', async () => {
        // Токены, выпущенные до фичи сессий, строки не имеют. isSessionRevoked
        // возвращает для них false — такие юзеры остаются залогиненными.
        const request = makeAuthRequest('legacy-token');
        const { reply, status } = makeAuthReply();
        await runAuthenticate(request, reply, makeDeps({ isSessionRevoked: vi.fn(async () => false) }));
        expect(status).not.toHaveBeenCalled();
        expect(request.user).toEqual({ userId: 'S123' });
    });

    it('valid token with a REVOKED session row is rejected with 401', async () => {
        const request = makeAuthRequest('revoked-token');
        const { reply, status, send } = makeAuthReply();
        await runAuthenticate(request, reply, makeDeps({ isSessionRevoked: vi.fn(async () => true) }));
        expect(status).toHaveBeenCalledWith(401);
        expect(send).toHaveBeenCalledWith({ error: 'Unauthorized', errorCode: 'SESSION_REVOKED' });
        expect(request.user).toBeUndefined();
    });

    it('passes the exact token to the revocation check', async () => {
        const isSessionRevoked = vi.fn(async () => false);
        await runAuthenticate(makeAuthRequest('abc.def'), makeAuthReply().reply, makeDeps({ isSessionRevoked }));
        expect(isSessionRevoked).toHaveBeenCalledWith('abc.def');
    });

    it('fails OPEN when the revocation check itself throws (DB outage)', async () => {
        // Блип Postgres не должен превращаться в массовый разлогин.
        const request = makeAuthRequest('good-token');
        const { reply, status } = makeAuthReply();
        await runAuthenticate(request, reply, makeDeps({
            isSessionRevoked: vi.fn(async () => { throw new Error('ECONNREFUSED'); }),
        }));
        expect(status).not.toHaveBeenCalled();
        expect(request.user).toEqual({ userId: 'S123' });
    });

    it('401s on an invalid signature without consulting the session table', async () => {
        const isSessionRevoked = vi.fn(async () => false);
        const request = makeAuthRequest('garbage');
        const { reply, status, send } = makeAuthReply();
        await runAuthenticate(request, reply, makeDeps({
            verifyToken: vi.fn(() => { throw new Error('invalid signature'); }),
            isSessionRevoked,
        }));
        expect(status).toHaveBeenCalledWith(401);
        expect(send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        expect(isSessionRevoked).not.toHaveBeenCalled();
    });

    describe('expired token renewal', () => {
        const expiredDeps = (overrides: Partial<AuthenticateDeps> = {}) => makeDeps({
            verifyToken: vi.fn(() => { throw new ExpiredTokenError(); }),
            ...overrides,
        });

        it('renews an expired token whose session is active', async () => {
            const request = makeAuthRequest('expired-token');
            const { reply, status, header, setCookie } = makeAuthReply();
            const signToken = vi.fn(() => 'fresh-token');
            await runAuthenticate(request, reply, expiredDeps({ signToken }));
            expect(status).not.toHaveBeenCalled();
            expect(signToken).toHaveBeenCalledWith({ userId: 'S123' });
            expect(header).toHaveBeenCalledWith('X-Renewed-Token', 'fresh-token');
            expect(setCookie).toHaveBeenCalledTimes(1);
            expect(request.user).toEqual({ userId: 'S123' });
        });

        it('renews an expired token that has NO session row (legacy)', async () => {
            const request = makeAuthRequest('old-expired-token');
            const { reply, status, header } = makeAuthReply();
            await runAuthenticate(request, reply, expiredDeps({
                isSessionRevoked: vi.fn(async () => false),
            }));
            expect(status).not.toHaveBeenCalled();
            expect(header).toHaveBeenCalledWith('X-Renewed-Token', 'new-token');
            expect(request.user).toEqual({ userId: 'S123' });
        });

        it('does NOT renew an expired token whose session was revoked', async () => {
            const request = makeAuthRequest('expired-revoked-token');
            const { reply, status, send, header, setCookie } = makeAuthReply();
            const signToken = vi.fn(() => 'fresh-token');
            const userExists = vi.fn(async () => true);
            await runAuthenticate(request, reply, expiredDeps({
                isSessionRevoked: vi.fn(async () => true),
                signToken,
                userExists,
            }));
            expect(signToken).not.toHaveBeenCalled();
            expect(userExists).not.toHaveBeenCalled();
            expect(header).not.toHaveBeenCalled();
            expect(setCookie).not.toHaveBeenCalled();
            expect(status).toHaveBeenCalledWith(401);
            expect(send).toHaveBeenCalledWith({ error: 'Unauthorized' });
            expect(request.user).toBeUndefined();
        });

        it('still renews when the revocation check throws (fail-open)', async () => {
            const request = makeAuthRequest('expired-token');
            const { reply, status, header } = makeAuthReply();
            await runAuthenticate(request, reply, expiredDeps({
                isSessionRevoked: vi.fn(async () => { throw new Error('pool exhausted'); }),
            }));
            expect(status).not.toHaveBeenCalled();
            expect(header).toHaveBeenCalledWith('X-Renewed-Token', 'new-token');
            expect(request.user).toEqual({ userId: 'S123' });
        });

        it('does not renew when the user no longer exists', async () => {
            const request = makeAuthRequest('expired-token');
            const { reply, status } = makeAuthReply();
            await runAuthenticate(request, reply, expiredDeps({
                userExists: vi.fn(async () => false),
            }));
            expect(status).toHaveBeenCalledWith(401);
            expect(request.user).toBeUndefined();
        });

        it('does not renew when the payload has no userId', async () => {
            const request = makeAuthRequest('expired-token');
            const { reply, status } = makeAuthReply();
            await runAuthenticate(request, reply, expiredDeps({
                decodeToken: vi.fn(() => null),
            }));
            expect(status).toHaveBeenCalledWith(401);
            expect(request.user).toBeUndefined();
        });

        it('401s (not 500) when renewal itself throws', async () => {
            const request = makeAuthRequest('expired-token');
            const { reply, status, send } = makeAuthReply();
            await runAuthenticate(request, reply, expiredDeps({
                userExists: vi.fn(async () => { throw new Error('boom'); }),
            }));
            expect(status).toHaveBeenCalledWith(401);
            expect(send).toHaveBeenCalledWith({ error: 'Unauthorized' });
        });
    });

    it('reads the token from the session cookie when no bearer header is present', async () => {
        const request = {
            headers: {},
            cookies: { [USER_SESSION_COOKIE]: 'cookie-token' },
        } as unknown as FastifyRequest & { user?: { userId: string } };
        const { reply, status } = makeAuthReply();
        const isSessionRevoked = vi.fn(async () => false);
        await runAuthenticate(request, reply, makeDeps({ isSessionRevoked }));
        expect(status).not.toHaveBeenCalled();
        expect(isSessionRevoked).toHaveBeenCalledWith('cookie-token');
    });
});
