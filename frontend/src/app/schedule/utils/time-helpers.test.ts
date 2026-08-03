import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    toMinutes,
    getBreakDurationMinutes,
    formatBreak,
    getSlotSegments,
    getInternalBreaks,
    getBetweenSlotBreak,
    getCurrentDayIndex,
    parseDateOnly,
    addDays,
    formatCompactDate,
    getLessonDisplayRange,
    getCurrentLessonProgress,
} from './time-helpers';
import type { TimeSlot, Lesson } from '@/lib/types';

const lesson = (overrides: Partial<Lesson> = {}): Lesson => ({
    title: 'X',
    type: null,
    teacher: '',
    room: null,
    faculty: null,
    parity: 'all',
    period: null,
    ...overrides,
});

const slot = (start: string, end: string, segments?: TimeSlot['segments']): TimeSlot => ({
    start,
    end,
    raw: `${start}-${end}`,
    segments,
});

describe('toMinutes', () => {
    it('parses HH:MM into total minutes since 00:00', () => {
        expect(toMinutes('00:00')).toBe(0);
        expect(toMinutes('01:30')).toBe(90);
        expect(toMinutes('23:59')).toBe(23 * 60 + 59);
    });

    it('returns null for malformed inputs', () => {
        expect(toMinutes('1:30')).toBe(null);
        expect(toMinutes('25:99')).toBe(25 * 60 + 99); // regex matches digits, no range check
        expect(toMinutes('garbage')).toBe(null);
        expect(toMinutes('')).toBe(null);
        expect(toMinutes('12-30')).toBe(null);
    });
});

describe('getBreakDurationMinutes', () => {
    it('returns positive duration between valid times', () => {
        expect(getBreakDurationMinutes('09:00', '09:50')).toBe(50);
        expect(getBreakDurationMinutes('10:00', '11:30')).toBe(90);
    });

    it('returns null when input is invalid', () => {
        expect(getBreakDurationMinutes('bad', '10:00')).toBe(null);
        expect(getBreakDurationMinutes('10:00', 'bad')).toBe(null);
    });

    it('returns null for zero or negative differences', () => {
        expect(getBreakDurationMinutes('10:00', '10:00')).toBe(null);
        expect(getBreakDurationMinutes('11:00', '10:00')).toBe(null);
    });
});

describe('formatBreak', () => {
    const messages = {
        schedule: {
            breakMinutes: '{value} мин',
            breakHours: '{value} ч',
            breakHoursMinutes: '{hours} ч {minutes} мин',
        },
    } as unknown as Parameters<typeof formatBreak>[1];

    it('< 60 minutes → minutes form', () => {
        expect(formatBreak(10, messages)).toBe('10 мин');
        expect(formatBreak(59, messages)).toBe('59 мин');
    });

    it('exactly N hours → hours form', () => {
        expect(formatBreak(60, messages)).toBe('1 ч');
        expect(formatBreak(120, messages)).toBe('2 ч');
    });

    it('hours + remainder minutes → combined form', () => {
        expect(formatBreak(75, messages)).toBe('1 ч 15 мин');
        expect(formatBreak(185, messages)).toBe('3 ч 5 мин');
    });
});

describe('getSlotSegments', () => {
    it('returns the raw segments array when present and non-empty', () => {
        const segs = [{ start: '09:00', end: '09:50' }, { start: '09:55', end: '10:45' }];
        expect(getSlotSegments(slot('09:00', '10:45', segs))).toBe(segs);
    });

    it('falls back to a single { start, end } pair when segments missing', () => {
        expect(getSlotSegments(slot('09:00', '10:45'))).toEqual([{ start: '09:00', end: '10:45' }]);
    });

    it('falls back to single pair when segments is empty array', () => {
        expect(getSlotSegments(slot('09:00', '10:45', []))).toEqual([{ start: '09:00', end: '10:45' }]);
    });
});

describe('getInternalBreaks', () => {
    it('returns [] when slot has no internal segments', () => {
        expect(getInternalBreaks(slot('09:00', '10:45'))).toEqual([]);
    });

    it('returns break between two segments', () => {
        const s = slot('09:00', '10:45', [
            { start: '09:00', end: '09:50' },
            { start: '09:55', end: '10:45' },
        ]);
        expect(getInternalBreaks(s)).toEqual([{ start: '09:50', end: '09:55', minutes: 5 }]);
    });

    it('returns breaks between multiple segments', () => {
        const s = slot('09:00', '11:50', [
            { start: '09:00', end: '09:50' },
            { start: '10:00', end: '10:50' },
            { start: '11:00', end: '11:50' },
        ]);
        expect(getInternalBreaks(s)).toEqual([
            { start: '09:50', end: '10:00', minutes: 10 },
            { start: '10:50', end: '11:00', minutes: 10 },
        ]);
    });

    it('skips overlapping or zero-length gaps', () => {
        const s = slot('09:00', '10:00', [
            { start: '09:00', end: '09:30' },
            { start: '09:30', end: '10:00' }, // zero gap
        ]);
        expect(getInternalBreaks(s)).toEqual([]);
    });
});

describe('getBetweenSlotBreak', () => {
    it('returns gap between last segment of slot A and first segment of slot B', () => {
        const a = slot('09:00', '09:50');
        const b = slot('10:00', '10:50');
        expect(getBetweenSlotBreak(a, b)).toEqual({ start: '09:50', end: '10:00', minutes: 10 });
    });

    it('uses last segment of slot A when slot A has segments', () => {
        const a = slot('09:00', '10:45', [
            { start: '09:00', end: '09:50' },
            { start: '09:55', end: '10:45' },
        ]);
        const b = slot('11:00', '11:50');
        expect(getBetweenSlotBreak(a, b)).toEqual({ start: '10:45', end: '11:00', minutes: 15 });
    });

    it('returns null on zero or negative gap', () => {
        const a = slot('09:00', '10:00');
        const b = slot('10:00', '11:00');
        expect(getBetweenSlotBreak(a, b)).toBe(null);
    });
});

describe('getCurrentDayIndex', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('maps Sunday (jsDay=0) → 6', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 17)); // 2026-05-17 is Sunday
        expect(getCurrentDayIndex()).toBe(6);
    });

    it('maps Monday → 0', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 11)); // 2026-05-11 is Monday
        expect(getCurrentDayIndex()).toBe(0);
    });

    it('maps Saturday → 5', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 4, 16)); // 2026-05-16 is Saturday
        expect(getCurrentDayIndex()).toBe(5);
    });
});

describe('parseDateOnly', () => {
    it('returns null on null/empty', () => {
        expect(parseDateOnly(null)).toBe(null);
        expect(parseDateOnly('')).toBe(null);
    });

    it('parses YYYY-MM-DD ISO format', () => {
        const d = parseDateOnly('2026-05-13');
        expect(d).not.toBe(null);
        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(4);
        expect(d!.getDate()).toBe(13);
    });

    it('parses YYYY-MM-DD prefix and ignores trailing content', () => {
        const d = parseDateOnly('2026-05-13T12:34:56Z');
        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(4);
        expect(d!.getDate()).toBe(13);
    });

    it('parses DD.MM.YYYY Russian format', () => {
        const d = parseDateOnly('13.05.2026');
        expect(d!.getFullYear()).toBe(2026);
        expect(d!.getMonth()).toBe(4);
        expect(d!.getDate()).toBe(13);
    });

    it('returns null for unrecognized formats', () => {
        expect(parseDateOnly('2026/05/13')).toBe(null);
        expect(parseDateOnly('13-05-2026')).toBe(null);
        expect(parseDateOnly('garbage')).toBe(null);
    });
});

describe('addDays', () => {
    it('adds N days without mutating the input', () => {
        const original = new Date(2026, 4, 13);
        const next = addDays(original, 5);
        expect(next.getDate()).toBe(18);
        expect(original.getDate()).toBe(13); // unchanged
    });

    it('handles month rollover', () => {
        const next = addDays(new Date(2026, 4, 30), 5); // May 30 + 5 = Jun 4
        expect(next.getMonth()).toBe(5);
        expect(next.getDate()).toBe(4);
    });

    it('handles negative days', () => {
        const prev = addDays(new Date(2026, 4, 13), -3);
        expect(prev.getDate()).toBe(10);
    });
});

describe('formatCompactDate', () => {
    it('formats as DD.MM.YY with zero padding', () => {
        expect(formatCompactDate(new Date(2026, 4, 13))).toBe('13.05.26');
        expect(formatCompactDate(new Date(2026, 0, 1))).toBe('01.01.26');
        expect(formatCompactDate(new Date(2026, 11, 31))).toBe('31.12.26');
    });

    it('truncates year to last 2 digits', () => {
        expect(formatCompactDate(new Date(2099, 4, 13))).toBe('13.05.99');
    });
});

describe('getLessonDisplayRange', () => {
    it('uses slot range when lesson has no customTime', () => {
        expect(getLessonDisplayRange(lesson(), slot('09:00', '10:00'))).toEqual({ start: '09:00', end: '10:00' });
    });

    it('uses customTime when both start and end are set', () => {
        expect(
            getLessonDisplayRange(lesson({ customTime: { start: '11:11', end: '12:12' } }), slot('09:00', '10:00')),
        ).toEqual({ start: '11:11', end: '12:12' });
    });

    it('falls back to slot range when customTime has only one half', () => {
        expect(
            getLessonDisplayRange(lesson({ customTime: { start: '11:11', end: '' } }), slot('09:00', '10:00')),
        ).toEqual({ start: '09:00', end: '10:00' });
    });
});

describe('getCurrentLessonProgress', () => {
    const baseSlot = slot('10:00', '11:00');
    const baseLesson = lesson();

    it('returns null when dayKey != currentDayKey', () => {
        const now = new Date(2026, 4, 13, 10, 30).getTime();
        expect(getCurrentLessonProgress(now, 'monday', 'tuesday', baseLesson, baseSlot)).toBe(null);
    });

    it('returns null when now is before the lesson', () => {
        const now = new Date(2026, 4, 13, 9, 0).getTime();
        expect(getCurrentLessonProgress(now, 'monday', 'monday', baseLesson, baseSlot)).toBe(null);
    });

    it('returns null when now is at or after the lesson end', () => {
        const now = new Date(2026, 4, 13, 11, 0).getTime();
        expect(getCurrentLessonProgress(now, 'monday', 'monday', baseLesson, baseSlot)).toBe(null);
    });

    it('returns ratio + elapsed + remaining when in progress', () => {
        const now = new Date(2026, 4, 13, 10, 30).getTime();
        const result = getCurrentLessonProgress(now, 'monday', 'monday', baseLesson, baseSlot);
        expect(result).not.toBe(null);
        expect(result!.elapsedMinutes).toBe(30);
        expect(result!.remainingMinutes).toBe(30);
        expect(result!.ratio).toBe(0.5);
        expect(result!.label).toBe('30 / 60 мин');
    });

    it('clamps ratio to [0, 1]', () => {
        const now = new Date(2026, 4, 13, 10, 1).getTime();
        const result = getCurrentLessonProgress(now, 'monday', 'monday', baseLesson, baseSlot);
        expect(result!.ratio).toBeGreaterThanOrEqual(0);
        expect(result!.ratio).toBeLessThanOrEqual(1);
    });

    it('returns null when slot times are invalid', () => {
        const now = new Date(2026, 4, 13, 10, 30).getTime();
        expect(getCurrentLessonProgress(now, 'monday', 'monday', baseLesson, slot('bad', '11:00'))).toBe(null);
        expect(getCurrentLessonProgress(now, 'monday', 'monday', baseLesson, slot('10:00', 'bad'))).toBe(null);
    });

    it('returns null when end <= start', () => {
        const now = new Date(2026, 4, 13, 10, 30).getTime();
        expect(getCurrentLessonProgress(now, 'monday', 'monday', baseLesson, slot('11:00', '10:00'))).toBe(null);
    });

    it('honors lesson customTime', () => {
        const now = new Date(2026, 4, 13, 12, 30).getTime();
        const customLesson = lesson({ customTime: { start: '12:00', end: '13:00' } });
        const result = getCurrentLessonProgress(now, 'monday', 'monday', customLesson, baseSlot);
        expect(result).not.toBe(null);
        expect(result!.elapsedMinutes).toBe(30);
    });
});

// Reset fake timers after the whole file (defensive).
beforeEach(() => {
    vi.useRealTimers();
});
