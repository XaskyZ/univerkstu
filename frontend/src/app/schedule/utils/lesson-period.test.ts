import { describe, it, expect } from 'vitest';
import { formatLessonPeriod, isLessonPeriodActive } from './lesson-period';

describe('formatLessonPeriod', () => {
    it('returns null for null / empty / sentinel values', () => {
        expect(formatLessonPeriod(null, 'ru')).toBeNull();
        expect(formatLessonPeriod(undefined, 'ru')).toBeNull();
        expect(formatLessonPeriod('', 'ru')).toBeNull();
        expect(formatLessonPeriod('   ', 'ru')).toBeNull();
        expect(formatLessonPeriod('all', 'ru')).toBeNull();
        expect(formatLessonPeriod('ALL', 'ru')).toBeNull();
        expect(formatLessonPeriod('-', 'ru')).toBeNull();
    });

    it('compacts week ranges with localized suffix', () => {
        expect(formatLessonPeriod('1-8 неделя', 'ru')).toEqual({
            label: '1–8 нед.',
            title: '1-8 неделя',
        });
        expect(formatLessonPeriod('5 - 10 нед', 'ru')?.label).toBe('5–10 нед.');
        expect(formatLessonPeriod('1-8 week', 'en')?.label).toBe('1–8 wk');
    });

    it('compacts dotted date ranges, stripping the year', () => {
        expect(formatLessonPeriod('с 01.09 по 15.10', 'ru')).toEqual({
            label: '01.09 – 15.10',
            title: 'с 01.09 по 15.10',
        });
        expect(formatLessonPeriod('01.09.2024 - 15.10.2024', 'ru')?.label).toBe('01.09 – 15.10');
    });

    it('falls back to raw (truncated) value for unrecognized shapes', () => {
        const result = formatLessonPeriod('подгруппа A', 'ru');
        expect(result).not.toBeNull();
        expect(result?.label).toBe('подгруппа A');
        expect(result?.title).toBe('подгруппа A');
    });

    it('truncates very long raw values in the label but keeps full title', () => {
        const long = 'очень длинный период который точно не помещается в чип';
        const result = formatLessonPeriod(long, 'ru');
        expect(result?.label.endsWith('…')).toBe(true);
        expect(result?.label.length).toBeLessThanOrEqual(28);
        expect(result?.title).toBe(long);
    });
});

describe('isLessonPeriodActive', () => {
    const at = (iso: string) => new Date(iso);

    it('treats null / empty / sentinel periods as active (no restriction)', () => {
        const ctx = { now: at('2026-11-20T10:00:00'), semesterWeek: 12 };
        expect(isLessonPeriodActive(null, ctx)).toBe(true);
        expect(isLessonPeriodActive(undefined, ctx)).toBe(true);
        expect(isLessonPeriodActive('', ctx)).toBe(true);
        expect(isLessonPeriodActive('   ', ctx)).toBe(true);
        expect(isLessonPeriodActive('all', ctx)).toBe(true);
        expect(isLessonPeriodActive('ALL', ctx)).toBe(true);
        expect(isLessonPeriodActive('-', ctx)).toBe(true);
    });

    describe('week ranges', () => {
        const now = at('2026-11-20T10:00:00');

        it('is active when semesterWeek falls inside the range (inclusive)', () => {
            expect(isLessonPeriodActive('1-8 неделя', { now, semesterWeek: 1 })).toBe(true);
            expect(isLessonPeriodActive('1-8 неделя', { now, semesterWeek: 8 })).toBe(true);
            expect(isLessonPeriodActive('5 - 10 нед', { now, semesterWeek: 7 })).toBe(true);
            expect(isLessonPeriodActive('1-8 week', { now, semesterWeek: 3 })).toBe(true);
        });

        it('is inactive when semesterWeek is outside the range', () => {
            expect(isLessonPeriodActive('1-8 неделя', { now, semesterWeek: 9 })).toBe(false);
            expect(isLessonPeriodActive('5-10 нед', { now, semesterWeek: 4 })).toBe(false);
        });

        it('stays active when semesterWeek is unknown (conservative)', () => {
            expect(isLessonPeriodActive('1-8 неделя', { now, semesterWeek: null })).toBe(true);
            expect(isLessonPeriodActive('1-8 неделя', { now })).toBe(true);
            expect(isLessonPeriodActive('1-8 неделя', { now, semesterWeek: 0 })).toBe(true);
        });
    });

    describe('date ranges without an explicit year', () => {
        it('is active inside the range and inactive after it ends', () => {
            expect(isLessonPeriodActive('с 01.09 по 15.10', { now: at('2026-10-01T09:00:00') })).toBe(true);
            expect(isLessonPeriodActive('с 01.09 по 15.10', { now: at('2026-10-15T23:00:00') })).toBe(true);
            // Ноябрь: пара «до 15.10» закончилась — сценарий из логик-аудита №10
            expect(isLessonPeriodActive('с 01.09 по 15.10', { now: at('2026-11-20T10:00:00') })).toBe(false);
        });

        it('is inactive before the range starts', () => {
            expect(isLessonPeriodActive('Период с 26.01 по 09.05', { now: at('2026-11-20T10:00:00') })).toBe(false);
            expect(isLessonPeriodActive('Период с 26.01 по 09.05', { now: at('2026-03-10T10:00:00') })).toBe(true);
        });

        it('handles ranges crossing the New Year', () => {
            expect(isLessonPeriodActive('с 01.12 по 15.02', { now: at('2027-01-10T10:00:00') })).toBe(true);
            expect(isLessonPeriodActive('с 01.12 по 15.02', { now: at('2026-12-05T10:00:00') })).toBe(true);
            expect(isLessonPeriodActive('с 01.12 по 15.02', { now: at('2026-06-05T10:00:00') })).toBe(false);
        });
    });

    describe('date ranges with explicit years', () => {
        it('respects explicit years exactly', () => {
            expect(isLessonPeriodActive('01.09.2026 - 15.10.2026', { now: at('2026-10-01T09:00:00') })).toBe(true);
            expect(isLessonPeriodActive('01.09.2025 - 15.10.2025', { now: at('2026-10-01T09:00:00') })).toBe(false);
        });

        it('supports two-digit years', () => {
            expect(isLessonPeriodActive('01.09.26 - 15.10.26', { now: at('2026-10-01T09:00:00') })).toBe(true);
        });
    });

    it('treats unrecognized shapes as active (conservative fallback)', () => {
        const ctx = { now: at('2026-11-20T10:00:00'), semesterWeek: 12 };
        expect(isLessonPeriodActive('подгруппа A', ctx)).toBe(true);
        // Открытый период «с даты» без конца намеренно не фильтруем
        expect(isLessonPeriodActive('с 1 февраля', ctx)).toBe(true);
    });
});
