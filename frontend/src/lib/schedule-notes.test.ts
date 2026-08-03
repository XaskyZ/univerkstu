import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Lesson, TimeSlot } from './types';
import {
    buildScheduleLessonNoteKey,
    getScheduleNotes,
    removeScheduleNote,
    saveScheduleNote,
} from './schedule-notes';

function makeLesson(overrides: Partial<Lesson> = {}): Lesson {
    return {
        title: 'Algorithms',
        type: 'lecture',
        teacher: 'Иванов И.И.',
        teacherName: 'Иванов Иван Иванович',
        room: 'A101',
        faculty: null,
        parity: 'all',
        period: null,
        ...overrides,
    };
}

function makeSlot(overrides: Partial<TimeSlot> = {}): TimeSlot {
    return { start: '09:00', end: '10:30', raw: '09:00-10:30', ...overrides };
}

describe('buildScheduleLessonNoteKey', () => {
    it('returns a stable pipe-joined key', () => {
        const key = buildScheduleLessonNoteKey({
            dayKey: 'mon',
            slot: makeSlot(),
            lesson: makeLesson(),
            lessonIndex: 0,
        });
        expect(key.split('|')).toHaveLength(8);
        expect(key.startsWith('mon|09:00-10:30|0|all|algorithms|')).toBe(true);
    });

    it('produces identical keys for identical inputs (idempotent)', () => {
        const args = { dayKey: 'tue', slot: makeSlot(), lesson: makeLesson(), lessonIndex: 1 };
        expect(buildScheduleLessonNoteKey(args)).toBe(buildScheduleLessonNoteKey(args));
    });

    it('differentiates by lessonIndex', () => {
        const base = { dayKey: 'mon', slot: makeSlot(), lesson: makeLesson() };
        const a = buildScheduleLessonNoteKey({ ...base, lessonIndex: 0 });
        const b = buildScheduleLessonNoteKey({ ...base, lessonIndex: 1 });
        expect(a).not.toBe(b);
    });

    it('differentiates by parity (num vs den)', () => {
        const base = { dayKey: 'mon', slot: makeSlot(), lessonIndex: 0 };
        const num = buildScheduleLessonNoteKey({ ...base, lesson: makeLesson({ parity: 'num' }) });
        const den = buildScheduleLessonNoteKey({ ...base, lesson: makeLesson({ parity: 'den' }) });
        expect(num).not.toBe(den);
    });

    it('normalizes whitespace and case in part fields', () => {
        const a = buildScheduleLessonNoteKey({
            dayKey: 'mon', slot: makeSlot(), lessonIndex: 0,
            lesson: makeLesson({ title: '  Algorithms ' }),
        });
        const b = buildScheduleLessonNoteKey({
            dayKey: 'mon', slot: makeSlot(), lessonIndex: 0,
            lesson: makeLesson({ title: 'algorithms' }),
        });
        expect(a).toBe(b);
    });

    it('prefers teacherName over teacher when both are present', () => {
        // teacherName 'A' should produce a different key than teacherName 'B'
        const a = buildScheduleLessonNoteKey({
            dayKey: 'mon', slot: makeSlot(), lessonIndex: 0,
            lesson: makeLesson({ teacherName: 'A' }),
        });
        const b = buildScheduleLessonNoteKey({
            dayKey: 'mon', slot: makeSlot(), lessonIndex: 0,
            lesson: makeLesson({ teacherName: 'B' }),
        });
        expect(a).not.toBe(b);
    });

    it('falls back to teacher when teacherName is missing', () => {
        const key = buildScheduleLessonNoteKey({
            dayKey: 'mon', slot: makeSlot(), lessonIndex: 0,
            lesson: makeLesson({ teacherName: undefined, teacher: 'Petrov P.P.' }),
        });
        expect(key.toLowerCase()).toContain('petrov');
    });

    it('encodes rawParams custom-id when prefixed', () => {
        const a = buildScheduleLessonNoteKey({
            dayKey: 'mon', slot: makeSlot(), lessonIndex: 0,
            lesson: makeLesson({ rawParams: '__custom__:my-lesson-1' }),
        });
        const b = buildScheduleLessonNoteKey({
            dayKey: 'mon', slot: makeSlot(), lessonIndex: 0,
            lesson: makeLesson({ rawParams: '__custom__:my-lesson-2' }),
        });
        expect(a).not.toBe(b);
        expect(a.toLowerCase()).toContain('my-lesson-1');
    });
});

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

describe('schedule notes storage', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        vi.stubGlobal('window', { localStorage: storage });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('getScheduleNotes returns {} when no data stored', () => {
        expect(getScheduleNotes('alice')).toEqual({});
    });

    it('getScheduleNotes returns {} when stored payload is corrupt JSON', () => {
        storage.setItem('schedule-notes:alice', 'not-json');
        expect(getScheduleNotes('alice')).toEqual({});
    });

    it('saveScheduleNote stores a single note', () => {
        saveScheduleNote('alice', 'k1', 'My note');
        expect(getScheduleNotes('alice')).toEqual({ k1: 'My note' });
    });

    it('saveScheduleNote trims input and caps at 500 chars', () => {
        const long = 'x'.repeat(600);
        saveScheduleNote('alice', 'k1', `  ${long}  `);
        const notes = getScheduleNotes('alice');
        expect(notes.k1).toHaveLength(500);
    });

    it('saveScheduleNote with empty value removes the key', () => {
        saveScheduleNote('alice', 'k1', 'hi');
        saveScheduleNote('alice', 'k1', '   '); // trim → empty → delete
        expect(getScheduleNotes('alice')).toEqual({});
    });

    it('removeScheduleNote drops the given key only', () => {
        saveScheduleNote('alice', 'k1', 'one');
        saveScheduleNote('alice', 'k2', 'two');
        const remaining = removeScheduleNote('alice', 'k1');
        expect(remaining).toEqual({ k2: 'two' });
    });

    it('keeps user-namespaced notes independent', () => {
        saveScheduleNote('alice', 'k1', 'alice note');
        saveScheduleNote('bob', 'k1', 'bob note');
        expect(getScheduleNotes('alice')).toEqual({ k1: 'alice note' });
        expect(getScheduleNotes('bob')).toEqual({ k1: 'bob note' });
    });

    it('ignores empty userId', () => {
        saveScheduleNote('', 'k1', 'noop');
        expect(getScheduleNotes('')).toEqual({});
    });
});
