/**
 * Route-layer tests for the user-facing report surface:
 *   - POST /social/entities/:id/report           (any authenticated user)
 *
 * The service layer is mocked — behavioural coverage lives in
 * `services/social-moderation.test.ts`. These tests only verify wiring:
 * request parsing, error mapping, status codes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { socialRoutes } from './social.js';
import * as moderationService from '../services/social-moderation.js';

vi.mock('../services/social-moderation.js', async (orig) => {
    const actual = await orig() as typeof moderationService;
    return {
        ...actual,
        reportEntity: vi.fn(),
    };
});

// Stub the other dependencies of socialRoutes so route registration succeeds
// without touching real services. We only exercise the moderation paths here.
vi.mock('../services/social.js', async (orig) => {
    const actual = await orig() as typeof import('../services/social.js');
    return { ...actual };
});

async function buildApp(userId: string) {
    const app = Fastify();
    app.decorate('authenticate', async (req: any) => {
        req.user = { userId };
    });
    await app.register(socialRoutes);
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllEnvs();
});


// ============================================================================
// POST /social/entities/:id/report
// ============================================================================

describe('POST /social/entities/:id/report', () => {
    it('201 + id on happy path', async () => {
        vi.mocked(moderationService.reportEntity).mockResolvedValueOnce({ id: 'rep-1' });
        const app = await buildApp('reporter');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/report',
            payload: { reason: 'spam' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toEqual({ success: true, data: { id: 'rep-1' } });
        expect(moderationService.reportEntity).toHaveBeenCalledWith('e1', 'reporter', 'spam');
    });

    it('201 when reason is omitted', async () => {
        vi.mocked(moderationService.reportEntity).mockResolvedValueOnce({ id: 'rep-2' });
        const app = await buildApp('reporter');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/report',
            payload: {},
        });
        expect(res.statusCode).toBe(201);
        expect(moderationService.reportEntity).toHaveBeenCalledWith('e1', 'reporter', undefined);
    });

    it('404 when service throws not found', async () => {
        vi.mocked(moderationService.reportEntity).mockRejectedValueOnce(new Error('not found'));
        const app = await buildApp('reporter');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/missing/report',
            payload: { reason: 'spam' },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json().errorCode).toBe('SOCIAL_NOT_FOUND');
    });

    it('400 when reason exceeds AJV cap', async () => {
        const app = await buildApp('reporter');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/report',
            payload: { reason: 'x'.repeat(600) },
        });
        expect(res.statusCode).toBe(400);
        expect(moderationService.reportEntity).not.toHaveBeenCalled();
    });
});
