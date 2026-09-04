import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { academicRoutes } from './academic.js';
import * as academicContext from '../services/academic-context.js';

vi.mock('../services/academic-context.js', () => ({
    getAcademicContext: vi.fn(),
}));

vi.mock('../utils/adminDiagnostics.js', () => ({
    pushAdminDiagnostic: vi.fn(),
}));

vi.mock('../utils/runtimeTrace.js', () => ({
    traceRuntime: vi.fn(),
}));

async function buildApp(userId: string) {
    const app = Fastify();
    app.decorate('authenticate', async (req: any) => {
        req.user = { userId };
    });
    await app.register(academicRoutes);
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('GET /academic/context', () => {
    it('200 + returns context when service succeeds', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: { group: 'IS-21-1', semester: 4, year: 2026 } as any,
            cached: false,
            stale: false,
        } as any);

        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/academic/context' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body).toEqual({
            success: true,
            data: { group: 'IS-21-1', semester: 4, year: 2026 },
            cached: false,
            stale: false,
        });
        expect(academicContext.getAcademicContext).toHaveBeenCalledWith('alice', false);
    });

    it('passes refresh=true through to the service', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: { group: 'X' } as any,
            cached: false,
            stale: false,
        } as any);

        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/academic/context?refresh=true' });
        expect(academicContext.getAcademicContext).toHaveBeenCalledWith('alice', true);
    });

    it('ignores refresh values other than the literal "true"', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: { group: 'X' } as any,
            cached: true,
            stale: false,
        } as any);

        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/academic/context?refresh=1' });
        expect(academicContext.getAcademicContext).toHaveBeenCalledWith('alice', false);
    });

    it('exposes stale flag from the service result', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: { group: 'X' } as any,
            cached: true,
            stale: true,
        } as any);

        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/academic/context' });
        expect(res.json()).toMatchObject({ stale: true, cached: true });
    });

    it('defaults stale to false when service omits it', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: { group: 'X' } as any,
            cached: false,
        } as any);

        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/academic/context' });
        expect(res.json().stale).toBe(false);
    });

    it('returns 200 with degraded payload on PLATONUS_NOT_CONNECTED', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: null,
            error: 'Platonus не подключён. Необходимо авторизоваться.',
            errorCode: 'PLATONUS_NOT_CONNECTED',
        } as any);

        const app = await buildApp('bob');
        const res = await app.inject({ method: 'GET', url: '/academic/context' });
        // Critical: this case must NOT 502 - frontend treats 502 as a hard
        // failure, but Platonus-not-connected is a soft state that should
        // surface as data: null + degraded so the UI can prompt re-login.
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            success: true,
            degraded: true,
            stale: false,
            authRequired: true,
            errorCode: 'PLATONUS_NOT_CONNECTED',
            error: 'Platonus не подключён. Необходимо авторизоваться.',
            data: null,
        });
    });

    it('returns 404 when user not found', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: null,
            error: 'Пользователь не найден в базе',
        } as any);

        const app = await buildApp('ghost');
        const res = await app.inject({ method: 'GET', url: '/academic/context' });
        expect(res.statusCode).toBe(404);
        expect(res.json()).toEqual({
            success: false,
            error: 'Пользователь не найден в базе',
        });
    });

    it('returns 502 on generic upstream error', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: null,
            error: 'Parser timed out',
        } as any);

        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/academic/context' });
        expect(res.statusCode).toBe(502);
        expect(res.json()).toEqual({
            success: false,
            error: 'Parser timed out',
        });
    });

    it('falls back to generic message when service supplies no error', async () => {
        vi.mocked(academicContext.getAcademicContext).mockResolvedValueOnce({
            context: null,
        } as any);

        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/academic/context' });
        expect(res.statusCode).toBe(502);
        expect(res.json().error).toBe('Не удалось получить академический контекст');
    });
});
