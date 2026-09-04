/**
 * Route tests for `GET /api/v3/umkd/exam-questions/:fileId/parsed`.
 *
 *   - S1  — the parsed question text is the file's content, so it goes through
 *           the same `canAccessFile` gate as the raw download;
 *   - S12 — internal exception text (`File not found: <id>`, storage-layer
 *           errors) stays in the log; the client gets a fixed Russian string
 *           plus `errorCode`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

vi.mock('../services/file-access.js', () => ({ canAccessFile: vi.fn() }));
vi.mock('../services/umkd-parse-questions.js', () => ({ getOrParseExamQuestions: vi.fn() }));
vi.mock('../db/mongo.js', () => ({ getCacheEntry: vi.fn(), setCachedData: vi.fn() }));
vi.mock('../services/academic-context.js', () => ({ getAcademicContext: vi.fn() }));
vi.mock('../services/users.js', () => ({ getUserPassword: vi.fn() }));
vi.mock('../utils/actionLog.js', () => ({ logAction: vi.fn() }));

const { umkdRoutes } = await import('./umkd.js');
const fileAccess = await import('../services/file-access.js');
const parser = await import('../services/umkd-parse-questions.js');

const CALLER = 'student-1';
const URL = '/umkd/exam-questions/68f0c0ffee0000000000abcd/parsed';

async function buildApp() {
    const app = Fastify();
    app.decorate('authenticate', async (request: any) => {
        request.user = { userId: CALLER };
    });
    await app.register(umkdRoutes);
    await app.ready();
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(parser.getOrParseExamQuestions).mockResolvedValue({
        fileId: '68f0c0ffee0000000000abcd',
        extractor: 'pdf',
        ok: true,
        questions: [{ index: 1, text: 'Что такое предел?' }],
        parsedAt: '2026-08-01T00:00:00.000Z',
        parserVersion: 1,
    } as any);
});

describe('exam-questions — access control (S1)', () => {
    it('returns the parsed questions for UMKD course material', async () => {
        vi.mocked(fileAccess.canAccessFile).mockResolvedValue({ allowed: true, reason: 'course_material' } as any);
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: URL });

        expect(res.statusCode).toBe(200);
        expect(res.json().data.questions).toHaveLength(1);
        expect(vi.mocked(fileAccess.canAccessFile)).toHaveBeenCalledWith(CALLER, '68f0c0ffee0000000000abcd');
    });

    it('403s a caller with no access and never parses the file', async () => {
        vi.mocked(fileAccess.canAccessFile).mockResolvedValue({ allowed: false, reason: 'denied' } as any);
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: URL });

        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ success: false, errorCode: 'FILE_FORBIDDEN' });
        expect(vi.mocked(parser.getOrParseExamQuestions)).not.toHaveBeenCalled();
    });

    it('404s an unknown fileId', async () => {
        vi.mocked(fileAccess.canAccessFile).mockResolvedValue({ allowed: false, reason: 'file_not_found' } as any);
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: URL });

        expect(res.statusCode).toBe(404);
        expect(res.json().errorCode).toBe('FILE_NOT_FOUND');
    });

    it('400s an empty fileId before any access lookup', async () => {
        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: '/umkd/exam-questions/%20/parsed' });

        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('BAD_REQUEST');
        expect(vi.mocked(fileAccess.canAccessFile)).not.toHaveBeenCalled();
    });
});

describe('exam-questions — error text (S12)', () => {
    it('does not echo the internal exception message to the client', async () => {
        vi.mocked(fileAccess.canAccessFile).mockResolvedValue({ allowed: true, reason: 'course_material' } as any);
        vi.mocked(parser.getOrParseExamQuestions).mockRejectedValue(
            new Error('File not found: 68f0c0ffee0000000000abcd (r2 objectKey umkd/secret/path.pdf)'),
        );
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const app = await buildApp();
        const res = await app.inject({ method: 'GET', url: URL });

        expect(res.statusCode).toBe(500);
        const body = res.json();
        expect(body.errorCode).toBe('PARSE_FAILED');
        expect(body.error).toBe('Не удалось разобрать файл с вопросами');
        expect(body.error).not.toContain('objectKey');
        expect(body.error).not.toContain('68f0c0ffee0000000000abcd');
        // The detail is still available to operators.
        expect(consoleSpy).toHaveBeenCalledWith(
            '[UMKD Route] exam-questions parse failed:',
            expect.stringContaining('objectKey'),
        );
        consoleSpy.mockRestore();
    });
});
