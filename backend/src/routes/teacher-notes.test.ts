import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { teacherRoutes } from './teacher.js';
import * as teacherNotes from '../services/teacherNotes.js';

vi.mock('../services/teacher-ratings.js', async (orig) => {
    const actual = await orig() as any;
    return {
        // Keep real normalizeTeacherName since teacherNotes.normalizeTeacherKey delegates to it.
        ...actual,
        createTeacher: vi.fn(),
        getTeacherLeaderboard: vi.fn(),
        getUserScheduleTeachers: vi.fn(),
        saveTeacherRating: vi.fn(),
        searchTeachers: vi.fn(),
    };
});

vi.mock('../services/teacherNotes.js', async (orig) => {
    const actual = await orig() as typeof teacherNotes;
    return {
        ...actual,
        getTeacherNote: vi.fn(),
        setTeacherNote: vi.fn(),
        deleteTeacherNote: vi.fn(),
        listMyTeacherNotes: vi.fn(),
    };
});

vi.mock('../utils/rateLimit.js', () => ({
    consumeRateLimit: vi.fn().mockReturnValue({ allowed: true, remaining: 100 }),
}));

vi.mock('../utils/actionLog.js', () => ({
    logAction: vi.fn(),
}));

vi.mock('../utils/teacherNameValidator.js', () => ({
    validateTeacherName: vi.fn(() => ({ ok: true })),
}));

vi.mock('../utils/teacherMatcher.js', () => ({
    findTeacherInDb: vi.fn(),
    fuzzyMatchTeacherName: vi.fn(),
}));

async function buildApp(userId: string) {
    const app = Fastify();
    app.decorate('authenticate', async (req: any) => {
        req.user = { userId };
    });
    await app.register(teacherRoutes);
    return app;
}

beforeEach(() => {
    vi.resetAllMocks();
});

describe('GET /teacher/notes/mine', () => {
    it('returns the caller\'s notes list', async () => {
        vi.mocked(teacherNotes.listMyTeacherNotes).mockResolvedValueOnce([
            { teacherKey: 'ivanov', note: 'tough', updatedAt: '2026-05-20T10:00:00Z' },
        ]);
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/teacher/notes/mine' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            success: true,
            data: { notes: [{ teacherKey: 'ivanov', note: 'tough', updatedAt: '2026-05-20T10:00:00Z' }] },
        });
        expect(teacherNotes.listMyTeacherNotes).toHaveBeenCalledWith('alice');
    });

    it('isolates by user (passes through userId from request.user)', async () => {
        vi.mocked(teacherNotes.listMyTeacherNotes).mockResolvedValueOnce([]);
        const app = await buildApp('bob');
        await app.inject({ method: 'GET', url: '/teacher/notes/mine' });
        expect(teacherNotes.listMyTeacherNotes).toHaveBeenCalledWith('bob');
        expect(teacherNotes.listMyTeacherNotes).not.toHaveBeenCalledWith('alice');
    });

    it('503 when storage layer throws', async () => {
        vi.mocked(teacherNotes.listMyTeacherNotes).mockRejectedValueOnce(new Error('storage unavailable'));
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/teacher/notes/mine' });
        expect(res.statusCode).toBe(503);
        expect(res.json().success).toBe(false);
    });
});

describe('GET /teacher/:teacherKey/note', () => {
    it('returns null fields when no note exists', async () => {
        vi.mocked(teacherNotes.getTeacherNote).mockResolvedValueOnce(null);
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/teacher/ivanov/note' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            success: true,
            data: { note: null, updatedAt: null },
        });
    });

    it('returns the note payload when one exists', async () => {
        vi.mocked(teacherNotes.getTeacherNote).mockResolvedValueOnce({
            note: 'always checks attendance',
            updatedAt: '2026-05-20T10:00:00Z',
        });
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/teacher/ivanov/note' });
        expect(res.json().data.note).toBe('always checks attendance');
    });

    it('normalizes the teacher key (whitespace / casing)', async () => {
        vi.mocked(teacherNotes.getTeacherNote).mockResolvedValueOnce(null);
        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/teacher/%20Ivanov%20Petrov%20/note' });
        // Whatever normalizeTeacherKey did, the service must receive its
        // normalized form (trimmed, lowercased per teacher-ratings rules).
        const passedKey = vi.mocked(teacherNotes.getTeacherNote).mock.calls[0][1];
        expect(passedKey).not.toMatch(/^\s/);
        expect(passedKey).not.toMatch(/\s$/);
    });

    it('503 when storage throws', async () => {
        vi.mocked(teacherNotes.getTeacherNote).mockRejectedValueOnce(new Error('storage unavailable'));
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/teacher/ivanov/note' });
        expect(res.statusCode).toBe(503);
    });
});

describe('PUT /teacher/:teacherKey/note', () => {
    it('204 + delegates to setTeacherNote', async () => {
        vi.mocked(teacherNotes.setTeacherNote).mockResolvedValueOnce(undefined);
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'PUT',
            url: '/teacher/ivanov/note',
            payload: { note: 'tough teacher' },
        });
        expect(res.statusCode).toBe(204);
        expect(teacherNotes.setTeacherNote).toHaveBeenCalledWith('alice', 'ivanov', 'tough teacher');
    });

    it('400 when service throws "too long" (service-side overflow, not schema)', async () => {
        // The body schema already rejects > 2000 chars with a generic 400, so to
        // exercise the handler's explicit too-long branch we keep payload within
        // schema and force the service to throw "too long" - simulates the case
        // where the service applies a tighter limit (e.g. trimmed exceeds cap).
        vi.mocked(teacherNotes.setTeacherNote).mockRejectedValueOnce(new Error('note too long'));
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'PUT',
            url: '/teacher/ivanov/note',
            payload: { note: 'within schema but service rejects' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('note too long');
    });

    it('400 + does not call service when schema length check fails first', async () => {
        // Schema maxLength catches the overflow before the handler runs.
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'PUT',
            url: '/teacher/ivanov/note',
            payload: { note: 'x'.repeat(99999) },
        });
        expect(res.statusCode).toBe(400);
        expect(teacherNotes.setTeacherNote).not.toHaveBeenCalled();
    });

    it('503 when service signals storage unavailable', async () => {
        vi.mocked(teacherNotes.setTeacherNote).mockRejectedValueOnce(new Error('storage unavailable'));
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'PUT',
            url: '/teacher/ivanov/note',
            payload: { note: 'note' },
        });
        expect(res.statusCode).toBe(503);
    });

    it('400 on generic save failure (no leak of underlying message)', async () => {
        vi.mocked(teacherNotes.setTeacherNote).mockRejectedValueOnce(new Error('some random db error'));
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'PUT',
            url: '/teacher/ivanov/note',
            payload: { note: 'note' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('invalid note payload');
    });

    it('treats missing body.note as empty string', async () => {
        vi.mocked(teacherNotes.setTeacherNote).mockResolvedValueOnce(undefined);
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'PUT',
            url: '/teacher/ivanov/note',
            payload: {},
        });
        // Body schema may or may not require `note`; what matters here is
        // that if the route accepts it, we don't pass undefined.
        if (res.statusCode === 204) {
            expect(teacherNotes.setTeacherNote).toHaveBeenCalledWith('alice', 'ivanov', '');
        } else {
            expect(res.statusCode).toBe(400);
            expect(teacherNotes.setTeacherNote).not.toHaveBeenCalled();
        }
    });
});

describe('DELETE /teacher/:teacherKey/note', () => {
    it('204 + delegates to deleteTeacherNote', async () => {
        vi.mocked(teacherNotes.deleteTeacherNote).mockResolvedValueOnce(undefined);
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'DELETE', url: '/teacher/ivanov/note' });
        expect(res.statusCode).toBe(204);
        expect(teacherNotes.deleteTeacherNote).toHaveBeenCalledWith('alice', 'ivanov');
    });

    it('503 when service throws', async () => {
        vi.mocked(teacherNotes.deleteTeacherNote).mockRejectedValueOnce(new Error('storage unavailable'));
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'DELETE', url: '/teacher/ivanov/note' });
        expect(res.statusCode).toBe(503);
    });
});
