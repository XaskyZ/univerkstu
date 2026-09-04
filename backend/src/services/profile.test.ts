/**
 * services/profile.ts — профиль без Univer.
 *
 *   - legacy-разделы берутся только из сохранённого кэша (даже просроченного)
 *     и при отдаче продлеваются;
 *   - Platonus дополняет их GPA/группой/семестрами через существующий клиент;
 *   - без кэша разделы null, source 'platonus', errorCode PROFILE_SOURCE_UNAVAILABLE;
 *   - никаких обращений к univer.kstu.kz (parsers/http-client не импортируется).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db/mongo.js', () => ({ getCacheEntry: vi.fn(), setCachedData: vi.fn() }));
vi.mock('../parsers/platonus-client.js', () => ({
    fetchTranscriptGPA: vi.fn(),
    fetchAvailableSemesters: vi.fn(),
}));
vi.mock('../services/platonus.js', () => ({
    getActivePlatonusSession: vi.fn(),
    forceRefreshSession: vi.fn(),
}));

const mongo = await import('../db/mongo.js');
const platonusClient = await import('../parsers/platonus-client.js');
const platonusService = await import('../services/platonus.js');
const {
    getProfile,
    LEGACY_PROFILE_SECTIONS,
    PROFILE_CACHE_TTL,
    PROFILE_SOURCE_UNAVAILABLE,
    listUnavailableSections,
} = await import('./profile.js');

const USER = 'student-1';
const SESSION = { token: 't', sid: 's', personID: '42' };
const TRANSCRIPT = {
    gpa: 3.4,
    overallGpa: 3.4,
    groupName: 'ВТ-21-1',
    termGpaMap: { '1': 3.2 },
    courseGpaMap: { '1': 3.4 },
};
const SEMESTERS = [{ year: 2025, semester: 1, label: '2025/2026 — Осенний' }];

const legacyProfile = () => ({
    profile: { fullName: 'Иванов Иван', course: 2, questionnaire: { sections: [], orders: [], summary: {} } },
    iup: { semesters: [] },
    attestation: { currentGPA: 3.1, currentYear: '2025', creditsEarned: 60, grades: [] },
    transcript: { summary: {}, subjects: [] },
    recbook: { summary: {}, records: [] },
    practice: { groups: [] },
    advisor: { fullName: 'Петров', email: null, workPhone: null },
    educPlan: null,
    academicOptions: null,
    cachedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-02T00:00:00.000Z',
});

const entry = (data: unknown, expiresAt: Date) => ({
    key: `profile_${USER}`,
    data,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt,
});

const past = () => new Date(Date.now() - 60_000);
const future = () => new Date(Date.now() + 60 * 60_000);

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mongo.setCachedData).mockResolvedValue(undefined);
    vi.mocked(platonusService.getActivePlatonusSession).mockResolvedValue(SESSION as any);
    vi.mocked(platonusService.forceRefreshSession).mockResolvedValue(null);
    vi.mocked(platonusClient.fetchTranscriptGPA).mockResolvedValue(TRANSCRIPT as any);
    vi.mocked(platonusClient.fetchAvailableSemesters).mockResolvedValue(SEMESTERS as any);
});

describe('getProfile — без кэша', () => {
    it('отдаёт null-разделы, source platonus, сводку Platonus и errorCode', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(null);

        const result = await getProfile(USER);

        for (const key of LEGACY_PROFILE_SECTIONS) {
            expect(result[key]).toBeNull();
        }
        expect(result.source).toBe('platonus');
        expect(result.platonusStatus).toBe('ok');
        expect(result.platonus).toMatchObject({
            personID: '42',
            gpa: 3.4,
            groupName: 'ВТ-21-1',
            termGpaMap: { '1': 3.2 },
            semesters: SEMESTERS,
        });
        expect(result.unavailableSections).toEqual([...LEGACY_PROFILE_SECTIONS]);
        expect(result.errorCode).toBe(PROFILE_SOURCE_UNAVAILABLE);
        expect(result.message).toContain('univer.kstu.kz');
        expect(result.meta.userId).toBe(USER);

        expect(vi.mocked(mongo.setCachedData)).toHaveBeenCalledWith(
            `profile_${USER}`,
            expect.objectContaining({ source: 'platonus' }),
            PROFILE_CACHE_TTL,
        );
    });

    it('Platonus не подключён → platonusStatus not_connected, platonus null, без исключений', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(null);
        vi.mocked(platonusService.getActivePlatonusSession).mockResolvedValue(null);

        const result = await getProfile(USER);

        expect(result.platonusStatus).toBe('not_connected');
        expect(result.platonus).toBeNull();
        expect(result.source).toBe('platonus');
        expect(result.errorCode).toBe(PROFILE_SOURCE_UNAVAILABLE);
        expect(vi.mocked(platonusClient.fetchTranscriptGPA)).not.toHaveBeenCalled();
    });

    it('падение Platonus-слоя → platonusStatus unavailable, профиль всё равно отдаётся', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(null);
        vi.mocked(platonusService.getActivePlatonusSession).mockRejectedValue(new Error('pg down'));

        const result = await getProfile(USER);

        expect(result.platonusStatus).toBe('unavailable');
        expect(result.platonus).toBeNull();
    });

    it('транскрипт null → один принудительный релогин и повтор', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(null);
        vi.mocked(platonusClient.fetchTranscriptGPA)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(TRANSCRIPT as any);
        vi.mocked(platonusService.forceRefreshSession).mockResolvedValue({ ...SESSION, personID: '43' } as any);

        const result = await getProfile(USER);

        expect(vi.mocked(platonusService.forceRefreshSession)).toHaveBeenCalledWith(USER);
        expect(vi.mocked(platonusClient.fetchTranscriptGPA)).toHaveBeenCalledTimes(2);
        expect(result.platonusStatus).toBe('ok');
        expect(result.platonus?.personID).toBe('43');
    });
});

describe('getProfile — legacy-кэш Univer', () => {
    it('просроченный legacy-кэш всё равно отдаётся, дополняется Platonus и продлевается', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(legacyProfile(), past()) as any);

        const result = await getProfile(USER);

        expect(result.source).toBe('cache');
        expect(result.profile).toMatchObject({ fullName: 'Иванов Иван' });
        expect(result.transcript).toEqual({ summary: {}, subjects: [] });
        expect(result.advisor?.fullName).toBe('Петров');
        expect(result.unavailableSections).toEqual(['educPlan', 'academicOptions']);
        expect(result.errorCode).toBe(PROFILE_SOURCE_UNAVAILABLE);
        expect(result.platonusStatus).toBe('ok');
        expect(result.platonus?.gpa).toBe(3.4);

        expect(vi.mocked(mongo.setCachedData)).toHaveBeenCalledWith(
            `profile_${USER}`,
            expect.objectContaining({ source: 'cache', profile: expect.objectContaining({ fullName: 'Иванов Иван' }) }),
            PROFILE_CACHE_TTL,
        );
    });

    it('полный legacy-кэш без пропусков → без errorCode', async () => {
        const full = { ...legacyProfile(), educPlan: { summary: {}, cycleCounts: {}, semesters: [] }, academicOptions: { retake: {}, fx: {}, gpaIncrease: {} } };
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(full, past()) as any);

        const result = await getProfile(USER);

        expect(result.unavailableSections).toEqual([]);
        expect(result.errorCode).toBeUndefined();
        expect(result.message).toBeUndefined();
    });

    it('свежий кэш нового формата отдаётся без обращений к Platonus', async () => {
        const stored = {
            ...legacyProfile(),
            source: 'cache',
            platonus: { personID: '42', gpa: 3.0, overallGpa: 3.0, groupName: null, termGpaMap: {}, courseGpaMap: {}, semesters: [], fetchedAt: 'x' },
            platonusStatus: 'ok',
            unavailableSections: ['educPlan', 'academicOptions'],
            meta: { parsedAt: 'x', userId: USER },
        };
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(stored, future()) as any);

        const result = await getProfile(USER);

        expect(result.platonus?.gpa).toBe(3.0);
        expect(vi.mocked(platonusService.getActivePlatonusSession)).not.toHaveBeenCalled();
        expect(vi.mocked(mongo.setCachedData)).not.toHaveBeenCalled();
    });

    it('forceRefresh с кэшем нового формата → Platonus перезапрашивается, legacy-разделы сохраняются', async () => {
        const stored = {
            ...legacyProfile(),
            source: 'cache',
            platonus: { personID: '42', gpa: 3.0, overallGpa: 3.0, groupName: null, termGpaMap: {}, courseGpaMap: {}, semesters: [], fetchedAt: 'x' },
            platonusStatus: 'ok',
            unavailableSections: [],
            meta: { parsedAt: 'x', userId: USER },
        };
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(stored, future()) as any);

        const result = await getProfile(USER, true);

        expect(vi.mocked(platonusClient.fetchTranscriptGPA)).toHaveBeenCalled();
        expect(result.platonus?.gpa).toBe(3.4);
        expect(result.profile).toMatchObject({ fullName: 'Иванов Иван' });
        expect(result.source).toBe('cache');
    });

    it('при недоступном Platonus прошлая сводка не теряется', async () => {
        const stored = {
            ...legacyProfile(),
            source: 'cache',
            platonus: { personID: '42', gpa: 3.0, overallGpa: 3.0, groupName: 'G', termGpaMap: {}, courseGpaMap: {}, semesters: [], fetchedAt: 'x' },
            platonusStatus: 'ok',
            unavailableSections: [],
            meta: { parsedAt: 'x', userId: USER },
        };
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(stored, past()) as any);
        vi.mocked(platonusClient.fetchTranscriptGPA).mockResolvedValue(null);
        vi.mocked(platonusClient.fetchAvailableSemesters).mockResolvedValue(null);

        const result = await getProfile(USER, true);

        expect(result.platonusStatus).toBe('unavailable');
        expect(result.platonus?.gpa).toBe(3.0);
    });

    it('ошибка записи кэша не ломает ответ', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(null);
        vi.mocked(mongo.setCachedData).mockRejectedValue(new Error('pg down'));

        await expect(getProfile(USER)).resolves.toMatchObject({ source: 'platonus' });
    });
});

describe('listUnavailableSections', () => {
    it('null/undefined/отсутствующие ключи считаются недоступными', () => {
        expect(listUnavailableSections(null)).toEqual([...LEGACY_PROFILE_SECTIONS]);
        expect(listUnavailableSections({ profile: { fullName: 'x' } as any, practice: { groups: [] } })).toEqual(
            LEGACY_PROFILE_SECTIONS.filter((k) => k !== 'profile' && k !== 'practice'),
        );
    });
});
