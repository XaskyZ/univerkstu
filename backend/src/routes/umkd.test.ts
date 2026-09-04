import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import type { AcademicContextResponse } from '../services/academic-context.js';

vi.mock('../db/mongo.js', () => ({ getCacheEntry: vi.fn(), setCachedData: vi.fn() }));
vi.mock('../utils/actionLog.js', () => ({ logAction: vi.fn() }));
vi.mock('../services/file-access.js', () => ({ canAccessFile: vi.fn() }));
vi.mock('../services/umkd-parse-questions.js', () => ({ getOrParseExamQuestions: vi.fn() }));

const { getUmkdPeriodOverrides, umkdRoutes } = await import('./umkd.js');
const mongo = await import('../db/mongo.js');
const actionLog = await import('../utils/actionLog.js');

const CALLER = 'student-1';

async function buildApp() {
    const app = Fastify();
    app.decorate('authenticate', async (request: any) => {
        request.user = { userId: CALLER };
    });
    await app.register(umkdRoutes);
    await app.ready();
    return app;
}

const cachedUmkd = () => ({
    courses: [{ id: 'c1', name: 'Физика', files: [] }],
    examQuestionsBySubject: [],
    meta: { parsedAt: '2026-01-01T00:00:00.000Z', totalCourses: 1, totalFiles: 0, downloadedFiles: 0, deduplicatedFiles: 0, userId: CALLER },
});

const entry = (data: unknown, expiresAt: Date) => ({ key: `umkd:${CALLER}`, data, createdAt: new Date(0), expiresAt });
const parseSse = (body: string) => body
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)));

describe('umkd routes — источник univer.kstu.kz отключён', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(mongo.setCachedData).mockResolvedValue(undefined);
    });

    it('GET /umkd отдаёт сохранённый список (свежий кэш → stale=false, без продления)', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(cachedUmkd(), new Date(Date.now() + 60_000)) as any);
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/umkd' });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({ success: true, cached: true, stale: false });
        expect(res.json().data.courses[0].name).toBe('Физика');
        expect(vi.mocked(mongo.setCachedData)).not.toHaveBeenCalled();
    });

    it('GET /umkd отдаёт даже просроченный кэш и продлевает его — пересобрать негде', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(cachedUmkd(), new Date(Date.now() - 60_000)) as any);
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/umkd' });

        expect(res.statusCode).toBe(200);
        expect(res.json().stale).toBe(true);
        expect(vi.mocked(mongo.setCachedData)).toHaveBeenCalledWith(`umkd:${CALLER}`, expect.objectContaining({ courses: expect.any(Array) }), expect.any(Number));
    });

    it('GET /umkd без кэша → 503 UMKD_SOURCE_UNAVAILABLE с русским текстом', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(null);
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/umkd' });

        expect(res.statusCode).toBe(503);
        expect(res.json()).toMatchObject({ success: false, errorCode: 'UMKD_SOURCE_UNAVAILABLE' });
        expect(res.json().error).toContain('univer.kstu.kz отключён');
    });

    it('GET /umkd?refresh=true → 503 даже при наличии кэша, кэш не читается', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(cachedUmkd(), new Date(Date.now() + 60_000)) as any);
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/umkd?refresh=true' });

        expect(res.statusCode).toBe(503);
        expect(res.json().errorCode).toBe('UMKD_SOURCE_UNAVAILABLE');
        expect(vi.mocked(mongo.getCacheEntry)).not.toHaveBeenCalled();
    });

    it('POST /umkd/refresh → 503 и запись в actionLog', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'POST', url: '/umkd/refresh' });

        expect(res.statusCode).toBe(503);
        expect(res.json().errorCode).toBe('UMKD_SOURCE_UNAVAILABLE');
        expect(vi.mocked(actionLog.logAction)).toHaveBeenCalledWith(CALLER, 'umkd_refresh', expect.stringContaining('UMKD_SOURCE_UNAVAILABLE'), { result: 'failed' });
    });

    it('GET /umkd/stream с кэшем → progress + complete', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(entry(cachedUmkd(), new Date(Date.now() + 60_000)) as any);
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/umkd/stream' });

        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/event-stream');
        const events = parseSse(res.body);
        expect(events.map((e) => e.type)).toEqual(['progress', 'complete']);
        expect(events[1].data.courses).toHaveLength(1);
    });

    it('GET /umkd/stream без кэша и с refresh=true → событие error UMKD_SOURCE_UNAVAILABLE', async () => {
        vi.mocked(mongo.getCacheEntry).mockResolvedValue(null);
        const app = await buildApp();

        for (const url of ['/umkd/stream', '/umkd/stream?refresh=true']) {
            const res = await app.inject({ method: 'GET', url });
            const events = parseSse(res.body);
            expect(events).toEqual([{ type: 'error', error: expect.stringContaining('отключён'), errorCode: 'UMKD_SOURCE_UNAVAILABLE' }]);
        }
    });
});

const ctx = (overrides: Partial<AcademicContextResponse>): AcademicContextResponse => ({
    source: 'platonus_calendar',
    userId: 'u1',
    formOfEducation: null,
    educationLevel: null,
    specialty: null,
    totalSemesters: 8,
    admissionYear: 2024,
    currentSemesterNumber: 1,
    currentSemesterLabel: null,
    semesterStart: '2026-09-01',
    semesterEnd: '2027-01-15',
    semesterWeek: null,
    weekLabel: null,
    weekParity: null,
    activePeriodLabel: null,
    activePeriodKind: null,
    periods: [],
    semesters: [],
    cachedAt: '',
    expiresAt: '',
    ...overrides,
});

describe('getUmkdPeriodOverrides', () => {
    // Resolves the UMKD page's `year`/`semester` query parameters from the user's
    // academic context. Critical: this is the **only** signal that tells KSTU's
    // UMKD endpoint WHICH semester's course list to return.
    //
    // Mapping (semester number → KSTU "semester" param):
    //   - odd semester (1, 3, 5, 7)  → "1" (fall)
    //   - even semester (2, 4, 6, 8) → "2" (spring)
    //
    // Academic year resolution:
    //   - For fall semesters, year = semesterStart.getFullYear()
    //   - For spring semesters, year = semesterStart.getFullYear() - 1
    //     (because a spring semester is in calendar year N+1 of academic year N)

    it('returns {} when context is null', () => {
        expect(getUmkdPeriodOverrides(null)).toEqual({});
    });

    it('returns {} when semesterStart is missing', () => {
        expect(getUmkdPeriodOverrides(ctx({ semesterStart: null }))).toEqual({});
    });

    it('returns {} when currentSemesterNumber is missing', () => {
        expect(getUmkdPeriodOverrides(ctx({ currentSemesterNumber: null }))).toEqual({});
    });

    it('returns {} when semesterStart is unparseable', () => {
        expect(getUmkdPeriodOverrides(ctx({ semesterStart: 'not a date' }))).toEqual({});
    });

    it('semester 1 (fall, 1st-year start) → year=2026, semester="1"', () => {
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 1,
            semesterStart: '2026-09-01',
        }));
        expect(result).toEqual({ year: '2026', semester: '1' });
    });

    it('semester 2 (spring of 1st year) → year=2026, semester="2" (year is academic-year-start, not calendar)', () => {
        // A 1st-year student in spring 2027 has academic year "2026" (Sept 2026 to June 2027).
        // The function subtracts 1 from semesterStart's calendar year because the spring
        // semester runs in calendar year N+1 of the academic year.
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 2,
            semesterStart: '2027-02-01',
        }));
        expect(result).toEqual({ year: '2026', semester: '2' });
    });

    it('semester 3 (fall, 2nd-year) → year=2027, semester="1"', () => {
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 3,
            semesterStart: '2027-09-01',
        }));
        expect(result).toEqual({ year: '2027', semester: '1' });
    });

    it('semester 4 (spring, 2nd-year) → year=2027, semester="2"', () => {
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 4,
            semesterStart: '2028-02-01',
        }));
        expect(result).toEqual({ year: '2027', semester: '2' });
    });

    it('semester 8 (graduating senior) → year=2030, semester="2"', () => {
        const result = getUmkdPeriodOverrides(ctx({
            currentSemesterNumber: 8,
            semesterStart: '2031-02-01',
        }));
        expect(result).toEqual({ year: '2030', semester: '2' });
    });

    it('locks in the odd→fall (sem "1") / even→spring (sem "2") mapping across all 8 semesters', () => {
        // Regression guard. Flipping the modulo check would invert every student's
        // UMKD view and they'd silently see the wrong course list.
        for (let n = 1; n <= 8; n += 1) {
            const result = getUmkdPeriodOverrides(ctx({
                currentSemesterNumber: n,
                semesterStart: n % 2 === 1 ? '2026-09-01' : '2027-02-01',
            }));
            expect(result.semester).toBe(n % 2 === 1 ? '1' : '2');
        }
    });
});
