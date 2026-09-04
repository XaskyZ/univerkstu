import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import { normalizePlatonusLogin, authRoutes } from './auth.js';
import * as platonusClient from '../parsers/platonus-client.js';
import * as platonusService from '../services/platonus.js';
import * as usersService from '../services/users.js';
import * as referralsService from '../services/referrals.js';
import * as sessionsService from '../services/sessions.js';

vi.mock('../parsers/platonus-client.js', () => ({
    platonusLogin: vi.fn(),
}));

vi.mock('../services/platonus.js', () => ({
    savePlatonusSession: vi.fn().mockResolvedValue(undefined),
    findUserIdByPlatonusLogin: vi.fn().mockResolvedValue(null),
}));

vi.mock('../services/users.js', () => ({
    upsertUser: vi.fn(),
    getUser: vi.fn(),
    touchUserLastLogin: vi.fn(),
    verifyStaffPassword: vi.fn(),
}));

vi.mock('../services/referrals.js', () => ({
    ensureReferralProfileForUser: vi.fn().mockResolvedValue(undefined),
    tryApplyReferralOnLogin: vi.fn().mockResolvedValue({ status: 'missing' }),
}));

vi.mock('../services/sessions.js', () => ({
    createUserSession: vi.fn().mockResolvedValue(undefined),
    revokeCurrentSession: vi.fn().mockResolvedValue(undefined),
    ensureSessionExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/group-space.js', () => ({
    getEffectiveAccess: vi.fn(),
}));

vi.mock('../utils/actionLog.js', () => ({
    logAction: vi.fn(),
}));

const PLATONUS_SESSION: platonusClient.PlatonusSession = {
    token: 'tok_abc',
    sid: 'sid_xyz',
    personID: 'p987',
    cookieString: 'plt_sid=sid_xyz',
};

describe('normalizePlatonusLogin', () => {
    // Pre-trim applied to the username before passing to Platonus /rest/api/login.
    // Students who paste their login with a trailing space would otherwise see
    // "wrong credentials" with no hint of what's wrong.

    it('trims leading and trailing whitespace', () => {
        expect(normalizePlatonusLogin('  student  ')).toBe('student');
    });

    it('trims tabs and newlines (common paste artifacts)', () => {
        expect(normalizePlatonusLogin('\tstudent\n')).toBe('student');
    });

    it('returns empty string for whitespace-only input (caller handles empty)', () => {
        expect(normalizePlatonusLogin('   ')).toBe('');
    });

    it('preserves internal characters verbatim (no case conversion, no @-stripping)', () => {
        expect(normalizePlatonusLogin('Student.Name@kstu.kz')).toBe('Student.Name@kstu.kz');
    });

    it('handles empty string', () => {
        expect(normalizePlatonusLogin('')).toBe('');
    });

    it('idempotent: applying twice yields same result', () => {
        expect(normalizePlatonusLogin(normalizePlatonusLogin('  abc  '))).toBe('abc');
    });
});

describe('POST /login (Platonus)', () => {
    // Контракт route: единственный источник идентичности — Platonus. Univer больше
    // не вызывается. userId для старых аккаунтов берётся из app_platonus_sessions
    // по platonus_login (без учёта регистра); для новых — сам логин Platonus.

    async function buildApp() {
        const app = Fastify();
        await app.register(fastifyCookie);
        // Минимальный фейк JWT: route зовёт app.jwt.sign({ userId }).
        app.decorate('jwt', {
            sign: vi.fn((payload: { userId: string }) => `jwt-for-${payload.userId}`),
        } as any);
        app.decorate('authenticate', async () => { });
        await app.register(authRoutes);
        return app;
    }

    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(platonusService.findUserIdByPlatonusLogin).mockResolvedValue(null);
        vi.mocked(platonusService.savePlatonusSession).mockResolvedValue(undefined);
        vi.mocked(referralsService.ensureReferralProfileForUser).mockResolvedValue(undefined);
        vi.mocked(referralsService.tryApplyReferralOnLogin).mockResolvedValue({ status: 'missing' });
        vi.mocked(usersService.upsertUser).mockResolvedValue({} as any);
    });

    it('400 when body is missing fields', async () => {
        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/login',
            payload: { username: 'someone' },
        });
        expect(response.statusCode).toBe(400);
        expect(platonusClient.platonusLogin).not.toHaveBeenCalled();
    });

    it('401 when Platonus rejects the credentials; nothing is persisted', async () => {
        vi.mocked(platonusClient.platonusLogin).mockResolvedValueOnce(null);

        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/login',
            payload: { username: 'new_student', password: 'wrong' },
        });

        expect(response.statusCode).toBe(401);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.errorCode).toBe('AUTH_INVALID_CREDENTIALS');
        expect(platonusClient.platonusLogin).toHaveBeenCalledWith('new_student', 'wrong');
        expect(usersService.upsertUser).not.toHaveBeenCalled();
        expect(platonusService.savePlatonusSession).not.toHaveBeenCalled();
        expect(sessionsService.createUserSession).not.toHaveBeenCalled();
    });

    it('200 for a new user: userId = Platonus login, session cached, JWT issued', async () => {
        vi.mocked(platonusClient.platonusLogin).mockResolvedValueOnce(PLATONUS_SESSION);
        vi.mocked(platonusService.findUserIdByPlatonusLogin).mockResolvedValueOnce(null);

        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/login',
            payload: { username: '  new_student  ', password: 'secret-pass' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);
        expect(body.token).toBe('jwt-for-new_student');
        expect(body.user).toEqual({ userId: 'new_student' });
        expect(body.referral).toEqual({ status: 'missing' });

        // Логин нормализован (trim) до обращения к Platonus.
        expect(platonusClient.platonusLogin).toHaveBeenCalledWith('new_student', 'secret-pass');
        expect(platonusService.findUserIdByPlatonusLogin).toHaveBeenCalledWith('new_student');
        expect(usersService.upsertUser).toHaveBeenCalledWith('new_student', 'secret-pass');
        expect(platonusService.savePlatonusSession).toHaveBeenCalledWith(
            'new_student',
            'new_student',
            'secret-pass',
            PLATONUS_SESSION,
        );
        expect(referralsService.ensureReferralProfileForUser).toHaveBeenCalledWith('new_student');
        expect(sessionsService.createUserSession).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'new_student',
            token: 'jwt-for-new_student',
        }));
        // Cookie с JWT выставлена.
        const setCookie = response.headers['set-cookie'];
        expect(String(setCookie)).toContain('jwt-for-new_student');
    });

    it('200 for an existing Univer-era account: userId mapped via app_platonus_sessions', async () => {
        vi.mocked(platonusClient.platonusLogin).mockResolvedValueOnce(PLATONUS_SESSION);
        // Старый аккаунт: userId = Univer-логин, platonus_login = "Student01".
        vi.mocked(platonusService.findUserIdByPlatonusLogin).mockResolvedValueOnce('Ivanov_Ivan');

        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/login',
            payload: { username: 'student01', password: 'secret-pass', referralCode: 'ABC' },
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.success).toBe(true);
        expect(body.token).toBe('jwt-for-Ivanov_Ivan');
        expect(body.user).toEqual({ userId: 'Ivanov_Ivan' });

        expect(platonusClient.platonusLogin).toHaveBeenCalledWith('student01', 'secret-pass');
        // Все записи привязаны к СТАРОМУ userId, чтобы не потерять историю пользователя.
        expect(usersService.upsertUser).toHaveBeenCalledWith('Ivanov_Ivan', 'secret-pass');
        expect(platonusService.savePlatonusSession).toHaveBeenCalledWith(
            'Ivanov_Ivan',
            'student01',
            'secret-pass',
            PLATONUS_SESSION,
        );
        expect(referralsService.ensureReferralProfileForUser).toHaveBeenCalledWith('Ivanov_Ivan');
        expect(referralsService.tryApplyReferralOnLogin).toHaveBeenCalledWith('Ivanov_Ivan', 'ABC');
        expect(sessionsService.createUserSession).toHaveBeenCalledWith(expect.objectContaining({
            userId: 'Ivanov_Ivan',
        }));
    });

    it('500 when the account lookup throws (no silent duplicate account)', async () => {
        vi.mocked(platonusClient.platonusLogin).mockResolvedValueOnce(PLATONUS_SESSION);
        vi.mocked(platonusService.findUserIdByPlatonusLogin).mockRejectedValueOnce(new Error('db down'));

        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/login',
            payload: { username: 'student01', password: 'secret-pass' },
        });

        expect(response.statusCode).toBe(500);
        expect(usersService.upsertUser).not.toHaveBeenCalled();
        expect(sessionsService.createUserSession).not.toHaveBeenCalled();
    });

    it('login still succeeds when caching the Platonus session fails', async () => {
        vi.mocked(platonusClient.platonusLogin).mockResolvedValueOnce(PLATONUS_SESSION);
        vi.mocked(platonusService.savePlatonusSession).mockRejectedValueOnce(new Error('db flake'));

        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/login',
            payload: { username: 'student02', password: 'secret-pass' },
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().user).toEqual({ userId: 'student02' });
    });

    it('change-password route no longer exists', async () => {
        const app = await buildApp();
        const response = await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: 'a-long-old-one', newPassword: 'a-long-new-one' },
        });
        expect(response.statusCode).toBe(404);
    });
});
