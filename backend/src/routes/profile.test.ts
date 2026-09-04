import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../services/profile.js', () => ({ getProfile: vi.fn() }));
vi.mock('../utils/actionLog.js', () => ({ logAction: vi.fn() }));

const { hasRichProfileCache, profileRoutes } = await import('./profile.js');
const profileService = await import('../services/profile.js');

const CALLER = 'student-1';

async function buildApp() {
    const app = Fastify();
    app.decorate('authenticate', async (request: any) => {
        request.user = { userId: CALLER };
    });
    await app.register(profileRoutes);
    await app.ready();
    return app;
}

const platonusOnlyProfile = () => ({
    profile: null,
    iup: null,
    attestation: null,
    transcript: null,
    recbook: null,
    practice: null,
    advisor: null,
    educPlan: null,
    academicOptions: null,
    source: 'platonus' as const,
    platonus: { personID: '42', gpa: 3.4, overallGpa: 3.4, groupName: 'G', termGpaMap: {}, courseGpaMap: {}, semesters: [], fetchedAt: 'x' },
    platonusStatus: 'ok' as const,
    unavailableSections: ['profile', 'iup', 'attestation', 'transcript', 'recbook', 'practice', 'advisor', 'educPlan', 'academicOptions'] as any,
    errorCode: 'PROFILE_SOURCE_UNAVAILABLE' as const,
    message: 'Источник профиля univer.kstu.kz отключён.',
    meta: { parsedAt: 'x', userId: CALLER },
    cachedAt: 'x',
    expiresAt: 'y',
});

describe('GET /profile — Univer отключён', () => {
    // Маршрут больше не логинится в univer.kstu.kz и не требует пароль:
    // всё, что есть, собирает services/profile.ts (кэш + Platonus).
    beforeEach(() => vi.clearAllMocks());

    it('отдаёт 200 с source platonus и errorCode PROFILE_SOURCE_UNAVAILABLE, когда legacy-профиля нет', async () => {
        vi.mocked(profileService.getProfile).mockResolvedValue(platonusOnlyProfile());
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/profile' });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.success).toBe(true);
        expect(body.cached).toBe(false);
        expect(body.data.source).toBe('platonus');
        expect(body.data.profile).toBeNull();
        expect(body.data.errorCode).toBe('PROFILE_SOURCE_UNAVAILABLE');
        expect(body.data.platonus.gpa).toBe(3.4);
        expect(vi.mocked(profileService.getProfile)).toHaveBeenCalledWith(CALLER, false);
    });

    it('refresh=true прокидывается в сервис как forceRefresh', async () => {
        vi.mocked(profileService.getProfile).mockResolvedValue({ ...platonusOnlyProfile(), source: 'cache' });
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/profile?refresh=true' });

        expect(res.statusCode).toBe(200);
        expect(res.json().cached).toBe(true);
        expect(vi.mocked(profileService.getProfile)).toHaveBeenCalledWith(CALLER, true);
    });

    it('исключение сервиса → 500 с фиксированным текстом', async () => {
        vi.mocked(profileService.getProfile).mockRejectedValue(new Error('pg down'));
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/profile' });

        expect(res.statusCode).toBe(500);
        expect(res.json()).toEqual({ success: false, error: 'Ошибка получения профиля' });
    });

    it('POST /profile/refresh редиректит на GET ?refresh=true', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'POST', url: '/profile/refresh' });

        expect(res.statusCode).toBe(302);
        expect(res.headers.location).toBe('/api/v3/profile?refresh=true');
    });
});

describe('hasRichProfileCache', () => {
    // Decides whether the cached profile blob is "complete enough" to return as-is
    // (diagnostic only now — Univer is gone, nothing can be re-fetched). All 5 sub-objects must be present
    // AND non-null:
    //   - profile.questionnaire (truthy check, not just hasOwnProperty)
    //   - transcript
    //   - recbook
    //   - practice
    //   - advisor
    //
    // Lock in the contract so logs keep telling complete legacy caches from partial ones.

    const fullCache = () => ({
        profile: { questionnaire: { summary: {} } },
        transcript: { summary: {} },
        recbook: { summary: {} },
        practice: [],
        advisor: { name: 'A' },
    });

    it('returns true when all 5 fields are set', () => {
        expect(hasRichProfileCache(fullCache())).toBe(true);
    });

    it('returns false when profile.questionnaire is missing', () => {
        const cached = fullCache();
        // @ts-expect-error - intentionally setting to null
        cached.profile.questionnaire = null;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when profile is missing entirely', () => {
        const cached = fullCache();
        // @ts-expect-error
        delete cached.profile;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when transcript is null', () => {
        const cached = fullCache();
        // @ts-expect-error
        cached.transcript = null;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when transcript is undefined', () => {
        const cached = fullCache();
        // @ts-expect-error
        cached.transcript = undefined;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when transcript key is missing entirely (hasOwnProperty fails)', () => {
        // The function uses Object.prototype.hasOwnProperty.call — locks in the
        // contract that a key simply not appearing is also a "miss" (not just null).
        const cached = fullCache();
        // @ts-expect-error
        delete cached.transcript;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when recbook is missing', () => {
        const cached = fullCache();
        // @ts-expect-error
        delete cached.recbook;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when practice is missing', () => {
        const cached = fullCache();
        // @ts-expect-error
        delete cached.practice;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('returns false when advisor is missing', () => {
        const cached = fullCache();
        // @ts-expect-error
        delete cached.advisor;
        expect(hasRichProfileCache(cached)).toBe(false);
    });

    it('empty array IS considered present (truthy after null/undefined checks)', () => {
        // A student who hasn't done any practice yet would have practice=[] — that's
        // still "complete data", not "missing data". Lock this in so a future
        // refactor doesn't accidentally treat empty-array as missing.
        const cached = fullCache();
        cached.practice = [];
        expect(hasRichProfileCache(cached)).toBe(true);
    });

    it('returns false for null/undefined/non-object input', () => {
        expect(hasRichProfileCache(null)).toBe(false);
        expect(hasRichProfileCache(undefined)).toBe(false);
        expect(hasRichProfileCache({})).toBe(false);
    });
});
