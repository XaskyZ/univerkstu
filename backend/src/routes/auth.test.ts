import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { normalizeUniverLogin, authRoutes } from './auth.js';
import * as httpClient from '../parsers/http-client.js';
import * as usersService from '../services/users.js';
import * as sessionsService from '../services/sessions.js';

vi.mock('../parsers/http-client.js', async (orig) => {
    const actual = await orig() as typeof httpClient;
    return {
        ...actual,
        login: vi.fn(),
        changeUniverPassword: vi.fn(),
    };
});

vi.mock('../services/users.js', () => ({
    upsertUser: vi.fn(),
    getUser: vi.fn(),
    touchUserLastLogin: vi.fn(),
    verifyStaffPassword: vi.fn(),
}));

vi.mock('../services/referrals.js', () => ({
    ensureReferralProfileForUser: vi.fn(),
    tryApplyReferralOnLogin: vi.fn(),
}));

vi.mock('../services/sessions.js', () => ({
    createUserSession: vi.fn().mockResolvedValue(undefined),
    revokeCurrentSession: vi.fn().mockResolvedValue(undefined),
    ensureSessionExists: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/group-space.js', () => ({
    getEffectiveAccess: vi.fn(),
}));

vi.mock('../parsers/schedule.js', () => ({
    parseScheduleWithCookies: vi.fn().mockResolvedValue({ success: false, data: null }),
}));

vi.mock('../services/schedule.js', () => ({
    saveSchedule: vi.fn(),
}));

vi.mock('../utils/actionLog.js', () => ({
    logAction: vi.fn(),
}));

describe('normalizeUniverLogin', () => {
    // Pre-trim applied to the username before passing to KSTU's login endpoint.
    // Critical: KSTU's auth fails silently when the login has leading/trailing
    // whitespace — students who paste their student ID with a space would see
    // "wrong credentials" with no hint of what's wrong without this trim.

    it('trims leading and trailing whitespace', () => {
        expect(normalizeUniverLogin('  student@kstu.kz  ')).toBe('student@kstu.kz');
    });

    it('trims tabs and newlines (common paste artifacts)', () => {
        expect(normalizeUniverLogin('\tstudent@kstu.kz\n')).toBe('student@kstu.kz');
    });

    it('returns empty string for whitespace-only input (caller handles empty)', () => {
        expect(normalizeUniverLogin('   ')).toBe('');
    });

    it('preserves internal characters verbatim (no case conversion, no @-stripping)', () => {
        // Documents that the function does NOT touch case or special chars —
        // KSTU usernames can include @, dots, mixed case. Only outer trim.
        expect(normalizeUniverLogin('Student.Name@kstu.kz')).toBe('Student.Name@kstu.kz');
    });

    it('handles empty string', () => {
        expect(normalizeUniverLogin('')).toBe('');
    });

    it('idempotent: applying twice yields same result', () => {
        expect(normalizeUniverLogin(normalizeUniverLogin('  abc  '))).toBe('abc');
    });
});

describe('POST /change-password', () => {
    // Контракт route: пароль в локальной БД ОБНОВЛЯЕТСЯ только после успешной
    // повторной проверки login(newPassword). Если KSTU «не подтвердил» смену —
    // upsertUser НЕ должен вызываться, иначе клиент окажется заблокирован.

    async function buildApp(userId: string) {
        const app = Fastify();
        // Минимальный фейк аутентификации: подкладываем userId в request.user.
        app.decorate('authenticate', async (req: any) => {
            req.user = { userId };
        });
        await app.register(authRoutes);
        return app;
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('400 when newPassword too short', async () => {
        const app = await buildApp('alice');
        const response = await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: 'long-enough-old', newPassword: 'abc' },
        });
        expect(response.statusCode).toBe(400);
        const body = response.json();
        expect(body.success).toBe(false);
        expect(body.errorCode).toBe('AUTH_CHANGE_PASSWORD_VALIDATION');
        expect(usersService.upsertUser).not.toHaveBeenCalled();
    });

    it('400 when newPassword equals currentPassword', async () => {
        const app = await buildApp('alice');
        const same = 'same-password-x';
        const response = await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: same, newPassword: same },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json().errorCode).toBe('AUTH_CHANGE_PASSWORD_SAME');
        expect(usersService.upsertUser).not.toHaveBeenCalled();
    });

    it('401 when current password does not log into KSTU', async () => {
        vi.mocked(httpClient.login).mockResolvedValueOnce(null);

        const app = await buildApp('bob-unique-1');
        const response = await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: 'wrong-current', newPassword: 'brand-new-pass' },
        });
        expect(response.statusCode).toBe(401);
        expect(response.json().errorCode).toBe('AUTH_INVALID_CURRENT_PASSWORD');
        expect(httpClient.changeUniverPassword).not.toHaveBeenCalled();
        expect(usersService.upsertUser).not.toHaveBeenCalled();
    });

    it('502 + does NOT call upsertUser when KSTU rejects change', async () => {
        vi.mocked(httpClient.login).mockResolvedValueOnce({
            '.ASPXAUTH': 'X', 'ASP.NET_SessionId': 'S',
        } as any);
        vi.mocked(httpClient.changeUniverPassword).mockResolvedValueOnce({ success: false, error: 'pass_post_failed' });

        const app = await buildApp('bob-unique-2');
        const response = await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: 'cur-pass-ok', newPassword: 'brand-new-pass' },
        });
        expect(response.statusCode).toBe(502);
        expect(response.json().errorCode).toBe('AUTH_CHANGE_PASSWORD_UPSTREAM');
        expect(usersService.upsertUser).not.toHaveBeenCalled();
    });

    it('502 + does NOT call upsertUser when new password fails to log in afterwards', async () => {
        // Сценарий: KSTU отдал 200 на POST, но новый пароль не залогинился.
        // Это значит что либо изменение не применилось, либо требования к паролю не соблюдены.
        vi.mocked(httpClient.login)
            .mockResolvedValueOnce({ '.ASPXAUTH': 'X', 'ASP.NET_SessionId': 'S' } as any) // verify current
            .mockResolvedValueOnce(null); // verify new — FAILS
        vi.mocked(httpClient.changeUniverPassword).mockResolvedValueOnce({ success: true, status: 200 });

        const app = await buildApp('bob-unique-3');
        const response = await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: 'cur-pass-ok', newPassword: 'brand-new-pass' },
        });
        expect(response.statusCode).toBe(502);
        expect(response.json().errorCode).toBe('AUTH_CHANGE_PASSWORD_NOT_APPLIED');
        // Критичная проверка: локальный пароль НЕ обновлён.
        expect(usersService.upsertUser).not.toHaveBeenCalled();
    });

    it('200 + upsertUser is called once when full flow succeeds', async () => {
        vi.mocked(httpClient.login)
            .mockResolvedValueOnce({ '.ASPXAUTH': 'X', 'ASP.NET_SessionId': 'S' } as any) // verify current
            .mockResolvedValueOnce({ '.ASPXAUTH': 'Y', 'ASP.NET_SessionId': 'S' } as any); // verify new
        vi.mocked(httpClient.changeUniverPassword).mockResolvedValueOnce({ success: true, status: 200 });
        vi.mocked(usersService.upsertUser).mockResolvedValueOnce({
            userId: 'bob-unique-4',
            passwordEncrypted: 'enc',
            createdAt: new Date(),
            lastLogin: new Date(),
        } as any);

        const app = await buildApp('bob-unique-4');
        const response = await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: 'cur-pass-ok', newPassword: 'brand-new-pass' },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ success: true });
        expect(usersService.upsertUser).toHaveBeenCalledTimes(1);
        // Убеждаемся что новый, а не старый, пароль попал в БД.
        expect(usersService.upsertUser).toHaveBeenCalledWith('bob-unique-4', 'brand-new-pass');
    });

    it('429 after exceeding per-user rate-limit (5 attempts / 5 min)', async () => {
        vi.mocked(httpClient.login).mockResolvedValue(null);
        const app = await buildApp('rate-limited-user-xyz');

        // 5 разрешённых попыток.
        for (let i = 0; i < 5; i++) {
            const r = await app.inject({
                method: 'POST',
                url: '/change-password',
                payload: { currentPassword: 'cur', newPassword: 'newpass1' },
            });
            expect(r.statusCode).toBe(401);
        }

        // 6-я — отказ по лимиту.
        const blocked = await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: 'cur', newPassword: 'newpass1' },
        });
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json().errorCode).toBe('AUTH_CHANGE_PASSWORD_RATE_LIMITED');
    });

    // Sanity-guard: фактически невидимый для теста, но фиксируем что мок sessions
    // не зацепился (route не должен открывать новую сессию при смене пароля).
    it('does not create a new device session during change-password flow', async () => {
        vi.mocked(httpClient.login)
            .mockResolvedValueOnce({ '.ASPXAUTH': 'X', 'ASP.NET_SessionId': 'S' } as any)
            .mockResolvedValueOnce({ '.ASPXAUTH': 'Y', 'ASP.NET_SessionId': 'S' } as any);
        vi.mocked(httpClient.changeUniverPassword).mockResolvedValueOnce({ success: true, status: 200 });
        vi.mocked(usersService.upsertUser).mockResolvedValueOnce({
            userId: 'bob-unique-5',
            passwordEncrypted: 'enc',
            createdAt: new Date(),
            lastLogin: new Date(),
        } as any);

        const app = await buildApp('bob-unique-5');
        await app.inject({
            method: 'POST',
            url: '/change-password',
            payload: { currentPassword: 'cur-pass-ok', newPassword: 'brand-new-pass' },
        });
        expect(sessionsService.createUserSession).not.toHaveBeenCalled();
    });
});
