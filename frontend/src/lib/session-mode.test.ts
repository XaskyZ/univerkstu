import { describe, it, expect } from 'vitest';
import type { AcademicContext, AcademicContextPeriod } from './api';
import {
    formatSessionDate,
    formatSessionRange,
    getActiveSessionPeriod,
    getSessionDaysRemaining,
    isExamSessionContext,
    isExamSessionKind,
    parsePeriodDate,
} from './session-mode';

function makePeriod(overrides: Partial<AcademicContextPeriod>): AcademicContextPeriod {
    return {
        label: 'Период',
        kind: 'exams',
        weeks: null,
        start: '01.01.2025',
        end: '15.01.2025',
        segmentLabel: 'Основной период обучения',
        ...overrides,
    };
}

function makeContext(overrides: Partial<AcademicContext>): AcademicContext {
    return {
        source: 'platonus_calendar',
        userId: 'test-user',
        formOfEducation: null,
        educationLevel: null,
        specialty: null,
        totalSemesters: null,
        admissionYear: null,
        currentSemesterNumber: null,
        currentSemesterLabel: null,
        semesterStart: null,
        semesterEnd: null,
        semesterWeek: null,
        weekLabel: null,
        weekParity: null,
        activePeriodLabel: null,
        activePeriodKind: null,
        periods: [],
        semesters: [],
        cachedAt: '2025-01-01T00:00:00Z',
        expiresAt: '2025-12-31T00:00:00Z',
        ...overrides,
    };
}

describe('isExamSessionKind', () => {
    it('accepts the two exam kinds', () => {
        expect(isExamSessionKind('exams')).toBe(true);
        expect(isExamSessionKind('state_exams')).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isExamSessionKind('theory')).toBe(false);
        expect(isExamSessionKind('practice')).toBe(false);
        expect(isExamSessionKind('midterm_1')).toBe(false);
        expect(isExamSessionKind(null)).toBe(false);
        expect(isExamSessionKind(undefined)).toBe(false);
        expect(isExamSessionKind('')).toBe(false);
    });
});

describe('isExamSessionContext', () => {
    it('returns false for null/undefined context', () => {
        expect(isExamSessionContext(null)).toBe(false);
        expect(isExamSessionContext(undefined)).toBe(false);
    });

    it('returns true only when activePeriodKind is an exam kind', () => {
        expect(isExamSessionContext(makeContext({ activePeriodKind: 'exams' }))).toBe(true);
        expect(isExamSessionContext(makeContext({ activePeriodKind: 'state_exams' }))).toBe(true);
        expect(isExamSessionContext(makeContext({ activePeriodKind: 'theory' }))).toBe(false);
        expect(isExamSessionContext(makeContext({ activePeriodKind: null }))).toBe(false);
    });
});

describe('parsePeriodDate', () => {
    it('parses DD.MM.YYYY', () => {
        const date = parsePeriodDate('15.06.2025');
        expect(date).not.toBeNull();
        expect(date?.getFullYear()).toBe(2025);
        expect(date?.getMonth()).toBe(5); // June (0-indexed)
        expect(date?.getDate()).toBe(15);
    });

    it('accepts single-digit day/month', () => {
        const date = parsePeriodDate('5.6.2025');
        expect(date?.getDate()).toBe(5);
        expect(date?.getMonth()).toBe(5);
    });

    it('trims whitespace', () => {
        expect(parsePeriodDate('  15.06.2025  ')?.getDate()).toBe(15);
    });

    it('returns null for falsy inputs', () => {
        expect(parsePeriodDate(undefined)).toBeNull();
        expect(parsePeriodDate(null)).toBeNull();
        expect(parsePeriodDate('')).toBeNull();
    });

    it('returns null for non-matching formats', () => {
        expect(parsePeriodDate('2025-06-15')).toBeNull();
        expect(parsePeriodDate('15/06/2025')).toBeNull();
        expect(parsePeriodDate('not a date')).toBeNull();
    });
});

describe('getActiveSessionPeriod', () => {
    it('returns null when context is missing', () => {
        expect(getActiveSessionPeriod(null)).toBeNull();
        expect(getActiveSessionPeriod(undefined)).toBeNull();
    });

    it('returns null when active kind is not an exam kind', () => {
        const context = makeContext({
            activePeriodKind: 'theory',
            periods: [makePeriod({ kind: 'exams' })],
        });
        expect(getActiveSessionPeriod(context)).toBeNull();
    });

    it('returns null when there are no matching periods', () => {
        const context = makeContext({
            activePeriodKind: 'exams',
            periods: [makePeriod({ kind: 'theory' })],
        });
        expect(getActiveSessionPeriod(context)).toBeNull();
    });

    it('picks the period containing today', () => {
        const periods = [
            makePeriod({ kind: 'exams', start: '01.01.2025', end: '10.01.2025', label: 'past' }),
            makePeriod({ kind: 'exams', start: '15.06.2025', end: '30.06.2025', label: 'current' }),
            makePeriod({ kind: 'exams', start: '01.12.2025', end: '15.12.2025', label: 'future' }),
        ];
        const context = makeContext({ activePeriodKind: 'exams', periods });
        // Today = 20 June 2025
        const today = new Date(2025, 5, 20).getTime();
        const picked = getActiveSessionPeriod(context, today);
        expect(picked?.label).toBe('current');
    });

    it('falls back to earliest future period when today is between periods', () => {
        const periods = [
            makePeriod({ kind: 'exams', start: '01.01.2025', end: '10.01.2025', label: 'past' }),
            makePeriod({ kind: 'exams', start: '15.06.2025', end: '30.06.2025', label: 'next' }),
            makePeriod({ kind: 'exams', start: '01.12.2025', end: '15.12.2025', label: 'later' }),
        ];
        const context = makeContext({ activePeriodKind: 'exams', periods });
        // Today = 1 May 2025 (between past and next)
        const today = new Date(2025, 4, 1).getTime();
        const picked = getActiveSessionPeriod(context, today);
        expect(picked?.label).toBe('next');
    });

    it('falls back to first candidate when all periods are in the past', () => {
        const periods = [
            makePeriod({ kind: 'exams', start: '01.01.2025', end: '10.01.2025', label: 'first' }),
            makePeriod({ kind: 'exams', start: '15.02.2025', end: '28.02.2025', label: 'second' }),
        ];
        const context = makeContext({ activePeriodKind: 'exams', periods });
        // Today = 1 Dec 2025 — both periods are over
        const today = new Date(2025, 11, 1).getTime();
        const picked = getActiveSessionPeriod(context, today);
        expect(picked?.label).toBe('first');
    });

    it('handles state_exams kind the same way', () => {
        const periods = [
            makePeriod({ kind: 'state_exams', start: '15.06.2025', end: '30.06.2025', label: 'state' }),
        ];
        const context = makeContext({ activePeriodKind: 'state_exams', periods });
        const today = new Date(2025, 5, 20).getTime();
        expect(getActiveSessionPeriod(context, today)?.label).toBe('state');
    });
});

describe('getSessionDaysRemaining', () => {
    it('returns null when period is missing', () => {
        expect(getSessionDaysRemaining(null)).toBeNull();
        expect(getSessionDaysRemaining(undefined)).toBeNull();
    });

    it('returns null when end date cannot be parsed', () => {
        const period = makePeriod({ end: 'garbage' });
        expect(getSessionDaysRemaining(period)).toBeNull();
    });

    it('returns 0 when the period has already ended', () => {
        const period = makePeriod({ end: '15.06.2025' });
        // Today = 16 June 2025 (after end)
        const after = new Date(2025, 5, 16, 12, 0, 0).getTime();
        expect(getSessionDaysRemaining(period, after)).toBe(0);
    });

    it('returns 1 on the last day of the period', () => {
        const period = makePeriod({ end: '15.06.2025' });
        // Today = 15 June 2025 mid-day
        const lastDay = new Date(2025, 5, 15, 12, 0, 0).getTime();
        expect(getSessionDaysRemaining(period, lastDay)).toBe(1);
    });

    it('counts inclusive days remaining', () => {
        const period = makePeriod({ end: '20.06.2025' });
        // Today = 15 June 2025 midday → 5 more midnights then last day = 6 calendar days
        const today = new Date(2025, 5, 15, 12, 0, 0).getTime();
        const remaining = getSessionDaysRemaining(period, today);
        expect(remaining).toBe(6);
    });
});

describe('formatSessionDate', () => {
    it('returns null for unparseable input', () => {
        expect(formatSessionDate(null, 'ru')).toBeNull();
        expect(formatSessionDate('garbage', 'en')).toBeNull();
    });

    it('formats date with abbreviated month per language', () => {
        expect(formatSessionDate('15.06.2025', 'ru')).toBe('15 июн');
        expect(formatSessionDate('15.06.2025', 'kz')).toBe('15 мау');
        expect(formatSessionDate('15.06.2025', 'en')).toBe('15 Jun');
    });

    it('handles December (last month index)', () => {
        expect(formatSessionDate('31.12.2025', 'ru')).toBe('31 дек');
        expect(formatSessionDate('31.12.2025', 'en')).toBe('31 Dec');
    });
});

describe('formatSessionRange', () => {
    it('returns null when period missing or dates invalid', () => {
        expect(formatSessionRange(null, 'ru')).toBeNull();
        expect(formatSessionRange(undefined, 'ru')).toBeNull();
        expect(formatSessionRange(makePeriod({ start: 'garbage' }), 'ru')).toBeNull();
        expect(formatSessionRange(makePeriod({ end: 'garbage' }), 'ru')).toBeNull();
    });

    it('formats same-year range with single year suffix', () => {
        const period = makePeriod({ start: '15.06.2025', end: '30.06.2025' });
        expect(formatSessionRange(period, 'ru')).toBe('15 июн — 30 июн 2025');
    });

    it('formats cross-year range with year on both sides', () => {
        const period = makePeriod({ start: '20.12.2025', end: '10.01.2026' });
        expect(formatSessionRange(period, 'en')).toBe('20 Dec 2025 — 10 Jan 2026');
    });
});
