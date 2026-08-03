import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory shim that mimics the subset of PG queries used by teacherNotes.ts.
// Lets us drive setTeacherNote/getTeacherNote/listMyTeacherNotes/deleteTeacherNote
// without touching real Postgres. Matches the SQL fragments verbatim (lower-cased)
// because we dispatch on the leading text.

type Row = Record<string, unknown>;

interface NoteRow {
    user_id: string;
    teacher_key: string;
    note: string;
    updated_at: string;
}

const store = new Map<string, NoteRow>(); // key = `${user_id}::${teacher_key}`

function storeKey(userId: string, teacherKey: string): string {
    return `${userId}::${teacherKey}`;
}

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            if (text.startsWith('select note, updated_at')) {
                const [userId, teacherKey] = params as [string, string];
                const row = store.get(storeKey(userId, teacherKey));
                return { rows: row ? [{ note: row.note, updated_at: row.updated_at }] : [], rowCount: row ? 1 : 0 };
            }

            if (text.startsWith('insert into user_teacher_notes')) {
                const [userId, teacherKey, note, now] = params as [string, string, string, string];
                const key = storeKey(userId, teacherKey);
                const row: NoteRow = { user_id: userId, teacher_key: teacherKey, note, updated_at: now };
                store.set(key, row);
                return { rows: [{ updated_at: now }], rowCount: 1 };
            }

            if (text.startsWith('delete from user_teacher_notes')) {
                const [userId, teacherKey] = params as [string, string];
                const had = store.delete(storeKey(userId, teacherKey));
                return { rows: [], rowCount: had ? 1 : 0 };
            }

            if (text.startsWith('select teacher_key, note, updated_at')) {
                const [userId] = params as [string];
                const rows: Row[] = Array.from(store.values())
                    .filter((r) => r.user_id === userId)
                    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
                    .map((r) => ({ teacher_key: r.teacher_key, note: r.note, updated_at: r.updated_at }));
                return { rows, rowCount: rows.length };
            }

            throw new Error(`Unmocked SQL: ${sql}`);
        }),
    };
}

const fakeClient = makeClient();

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

import {
    normalizeTeacherKey,
    validateTeacherNote,
    getTeacherNote,
    setTeacherNote,
    deleteTeacherNote,
    listMyTeacherNotes,
    TEACHER_NOTE_MAX_LENGTH,
    TEACHER_KEY_MAX_LENGTH,
} from './teacherNotes.js';

beforeEach(() => {
    store.clear();
});

describe('normalizeTeacherKey', () => {
    // Reuses the same normalization as the teacher directory so the key is
    // stable across user-typed variants. Critical for upsert semantics.

    it('returns empty string for non-string input', () => {
        expect(normalizeTeacherKey(null)).toBe('');
        expect(normalizeTeacherKey(undefined)).toBe('');
        expect(normalizeTeacherKey(42)).toBe('');
        expect(normalizeTeacherKey({})).toBe('');
    });

    it('returns empty string for empty/whitespace-only input', () => {
        expect(normalizeTeacherKey('')).toBe('');
        expect(normalizeTeacherKey('   ')).toBe('');
        expect(normalizeTeacherKey('\t\n')).toBe('');
    });

    it('lowercases and collapses whitespace', () => {
        expect(normalizeTeacherKey('  ИВАНОВ   И.И.  ')).toBe('иванов и.и.');
    });

    it('tightens initial dots — "И . И ." → "и.и."', () => {
        expect(normalizeTeacherKey('Иванов И . И .')).toBe('иванов и.и.');
    });

    it('treats smart-quote and ASCII-apostrophe variants as the same key', () => {
        expect(normalizeTeacherKey('O’Brien')).toBe(normalizeTeacherKey("O'Brien"));
    });

    it('caps key length to TEACHER_KEY_MAX_LENGTH', () => {
        const huge = 'A'.repeat(TEACHER_KEY_MAX_LENGTH + 50);
        const result = normalizeTeacherKey(huge);
        expect(result.length).toBeLessThanOrEqual(TEACHER_KEY_MAX_LENGTH);
    });
});

describe('validateTeacherNote', () => {
    // Length and trim contract for note bodies.

    it('throws when input is not a string', () => {
        expect(() => validateTeacherNote(null)).toThrow();
        expect(() => validateTeacherNote(undefined)).toThrow();
        expect(() => validateTeacherNote(42)).toThrow();
        expect(() => validateTeacherNote({ note: 'x' })).toThrow();
    });

    it('trims surrounding whitespace', () => {
        expect(validateTeacherNote('   hello   ')).toBe('hello');
        expect(validateTeacherNote('\n\thello\n')).toBe('hello');
    });

    it('returns empty string for whitespace-only input (caller decides what to do)', () => {
        expect(validateTeacherNote('')).toBe('');
        expect(validateTeacherNote('   ')).toBe('');
    });

    it('accepts notes up to TEACHER_NOTE_MAX_LENGTH', () => {
        const exact = 'a'.repeat(TEACHER_NOTE_MAX_LENGTH);
        expect(validateTeacherNote(exact).length).toBe(TEACHER_NOTE_MAX_LENGTH);
    });

    it('rejects notes longer than TEACHER_NOTE_MAX_LENGTH (after trim)', () => {
        const tooLong = 'a'.repeat(TEACHER_NOTE_MAX_LENGTH + 1);
        expect(() => validateTeacherNote(tooLong)).toThrow(/too long/);
    });

    it('measures length AFTER trim — surrounding whitespace does not count', () => {
        // Padding with whitespace then trimming yields exactly the max → must pass.
        const padded = '   ' + 'a'.repeat(TEACHER_NOTE_MAX_LENGTH) + '   ';
        expect(validateTeacherNote(padded).length).toBe(TEACHER_NOTE_MAX_LENGTH);
    });

    it('preserves internal whitespace and Cyrillic', () => {
        const input = 'Строгий препод.\nДомашки каждую пятницу.';
        expect(validateTeacherNote(input)).toBe(input);
    });
});

describe('setTeacherNote / getTeacherNote (storage roundtrip)', () => {
    // End-to-end through the in-memory PG shim. Covers upsert, normalization,
    // and delete-on-empty semantics.

    it('returns null when no note exists yet', async () => {
        expect(await getTeacherNote('alice', 'Иванов И.И.')).toBeNull();
    });

    it('upserts a note and reads it back via normalized key', async () => {
        const saved = await setTeacherNote('alice', 'Иванов И.И.', 'Строгий, но норм');
        expect(saved.note).toBe('Строгий, но норм');

        // Different casing/spacing must hit the same row.
        const read = await getTeacherNote('alice', '  иванов  и . и .  ');
        expect(read).not.toBeNull();
        expect(read!.note).toBe('Строгий, но норм');
    });

    it('overwrites the existing note on second set', async () => {
        await setTeacherNote('alice', 'Иванов И.И.', 'первый вариант');
        await setTeacherNote('alice', 'Иванов И.И.', 'второй вариант');
        const read = await getTeacherNote('alice', 'Иванов И.И.');
        expect(read!.note).toBe('второй вариант');
    });

    it('does not leak between users (per-user privacy)', async () => {
        await setTeacherNote('alice', 'Иванов И.И.', 'alice note');
        await setTeacherNote('bob', 'Иванов И.И.', 'bob note');
        expect((await getTeacherNote('alice', 'Иванов И.И.'))!.note).toBe('alice note');
        expect((await getTeacherNote('bob', 'Иванов И.И.'))!.note).toBe('bob note');
    });

    it('setting an empty/whitespace-only note removes the row', async () => {
        await setTeacherNote('alice', 'Иванов И.И.', 'some note');
        const cleared = await setTeacherNote('alice', 'Иванов И.И.', '   ');
        expect(cleared.note).toBe('');
        expect(await getTeacherNote('alice', 'Иванов И.И.')).toBeNull();
    });

    it('rejects overlong notes', async () => {
        const tooLong = 'a'.repeat(TEACHER_NOTE_MAX_LENGTH + 1);
        await expect(setTeacherNote('alice', 'Иванов И.И.', tooLong)).rejects.toThrow(/too long/);
    });

    it('rejects empty userId / teacherKey', async () => {
        await expect(setTeacherNote('', 'Иванов И.И.', 'x')).rejects.toThrow(/userId/);
        await expect(setTeacherNote('alice', '', 'x')).rejects.toThrow(/teacherKey/);
        await expect(setTeacherNote('alice', '   ', 'x')).rejects.toThrow(/teacherKey/);
    });
});

describe('deleteTeacherNote', () => {
    it('removes an existing note', async () => {
        await setTeacherNote('alice', 'Иванов И.И.', 'note');
        await deleteTeacherNote('alice', 'Иванов И.И.');
        expect(await getTeacherNote('alice', 'Иванов И.И.')).toBeNull();
    });

    it('is a no-op when nothing exists', async () => {
        await expect(deleteTeacherNote('alice', 'Иванов И.И.')).resolves.toBeUndefined();
    });

    it('matches on normalized key', async () => {
        await setTeacherNote('alice', 'Иванов И.И.', 'note');
        // Same identifier with different whitespace + casing must hit the same row.
        await deleteTeacherNote('alice', '  ИВАНОВ  И . И .  ');
        expect(await getTeacherNote('alice', 'Иванов И.И.')).toBeNull();
    });

    it('silently no-ops on empty userId / teacherKey (defensive)', async () => {
        await expect(deleteTeacherNote('', 'x')).resolves.toBeUndefined();
        await expect(deleteTeacherNote('alice', '')).resolves.toBeUndefined();
    });
});

describe('listMyTeacherNotes', () => {
    it('returns [] for a user with no notes', async () => {
        expect(await listMyTeacherNotes('alice')).toEqual([]);
    });

    it('returns [] for empty userId', async () => {
        expect(await listMyTeacherNotes('')).toEqual([]);
    });

    it('returns only the current user notes', async () => {
        await setTeacherNote('alice', 'Иванов И.И.', 'a-1');
        await setTeacherNote('alice', 'Петров П.П.', 'a-2');
        await setTeacherNote('bob', 'Иванов И.И.', 'b-1');

        const aliceNotes = await listMyTeacherNotes('alice');
        expect(aliceNotes).toHaveLength(2);
        const noteValues = aliceNotes.map((n) => n.note).sort();
        expect(noteValues).toEqual(['a-1', 'a-2']);
    });
});
