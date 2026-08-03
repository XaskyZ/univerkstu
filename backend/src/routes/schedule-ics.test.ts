import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { scheduleRoutes } from './schedule.js';
import * as scheduleService from '../services/schedule.js';
import * as ics from '../services/ics.js';

vi.mock('../services/schedule.js', () => ({
    getSchedule: vi.fn(),
    invalidateScheduleCache: vi.fn(),
    getScheduleCacheStatus: vi.fn(),
}));

vi.mock('../services/ics.js', () => ({
    buildIcsFeed: vi.fn(),
}));

vi.mock('../utils/teacherMatcher.js', () => ({
    findTeacherInDb: vi.fn().mockReturnValue(null),
}));

vi.mock('../utils/actionLog.js', () => ({
    logAction: vi.fn(),
}));

async function buildApp(userId: string) {
    const app = Fastify();
    app.decorate('authenticate', async (req: any) => {
        req.user = { userId };
    });
    await app.register(scheduleRoutes);
    return app;
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('GET /schedule/export.ics', () => {
    function stubScheduleOk() {
        vi.mocked(scheduleService.getSchedule).mockResolvedValueOnce({
            schedule: { days: [] } as any,
            error: null,
        } as any);
    }

    it('returns 200 with text/calendar content type', async () => {
        stubScheduleOk();
        vi.mocked(ics.buildIcsFeed).mockReturnValueOnce('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/schedule/export.ics' });
        expect(res.statusCode).toBe(200);
        expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
        expect(res.headers['content-disposition']).toBe('attachment; filename="schedule.ics"');
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.body).toMatch(/^BEGIN:VCALENDAR/);
    });

    it('defaults language to ru when query lang missing', async () => {
        stubScheduleOk();
        vi.mocked(ics.buildIcsFeed).mockReturnValueOnce('OK');
        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/schedule/export.ics' });
        const opts = vi.mocked(ics.buildIcsFeed).mock.calls[0][1];
        expect(opts.language).toBe('ru');
        expect(opts.calendarName).toBe('UniverKstu — Расписание');
    });

    it('uses en calendar name when lang=en', async () => {
        stubScheduleOk();
        vi.mocked(ics.buildIcsFeed).mockReturnValueOnce('OK');
        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/schedule/export.ics?lang=en' });
        const opts = vi.mocked(ics.buildIcsFeed).mock.calls[0][1];
        expect(opts.language).toBe('en');
        expect(opts.calendarName).toBe('UniverKstu — Schedule');
    });

    it('uses kz calendar name when lang=kz', async () => {
        stubScheduleOk();
        vi.mocked(ics.buildIcsFeed).mockReturnValueOnce('OK');
        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/schedule/export.ics?lang=kz' });
        const opts = vi.mocked(ics.buildIcsFeed).mock.calls[0][1];
        expect(opts.language).toBe('kz');
        expect(opts.calendarName).toBe('UniverKstu — Кесте');
    });

    it('falls back to ru for unsupported lang value', async () => {
        stubScheduleOk();
        vi.mocked(ics.buildIcsFeed).mockReturnValueOnce('OK');
        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/schedule/export.ics?lang=fr' });
        const opts = vi.mocked(ics.buildIcsFeed).mock.calls[0][1];
        expect(opts.language).toBe('ru');
    });

    it('is case-insensitive for lang query', async () => {
        stubScheduleOk();
        vi.mocked(ics.buildIcsFeed).mockReturnValueOnce('OK');
        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/schedule/export.ics?lang=EN' });
        expect(vi.mocked(ics.buildIcsFeed).mock.calls[0][1].language).toBe('en');
    });

    it('returns 401 + AUTH_RELOGIN_REQUIRED when schedule reports re-auth', async () => {
        vi.mocked(scheduleService.getSchedule).mockResolvedValueOnce({
            schedule: null,
            error: 'Сессия истекла, попробуйте позже',
        } as any);
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/schedule/export.ics' });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({
            success: false,
            error: 'Сессия истекла, попробуйте позже',
            errorCode: 'AUTH_RELOGIN_REQUIRED',
        });
        expect(ics.buildIcsFeed).not.toHaveBeenCalled();
    });

    it('returns 502 + UPSTREAM_UNAVAILABLE on parser failure', async () => {
        vi.mocked(scheduleService.getSchedule).mockResolvedValueOnce({
            schedule: null,
            error: 'Parser timed out',
        } as any);
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/schedule/export.ics' });
        expect(res.statusCode).toBe(502);
        expect(res.json().errorCode).toBe('UPSTREAM_UNAVAILABLE');
    });

    it('returns 500 when buildIcsFeed throws', async () => {
        stubScheduleOk();
        vi.mocked(ics.buildIcsFeed).mockImplementationOnce(() => {
            throw new Error('formatting bug');
        });
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/schedule/export.ics' });
        expect(res.statusCode).toBe(500);
        expect(res.json().success).toBe(false);
    });

    it('passes userId from request.user to getSchedule', async () => {
        stubScheduleOk();
        vi.mocked(ics.buildIcsFeed).mockReturnValueOnce('OK');
        const app = await buildApp('bob-the-user');
        await app.inject({ method: 'GET', url: '/schedule/export.ics' });
        expect(scheduleService.getSchedule).toHaveBeenCalledWith('bob-the-user', false);
    });
});
