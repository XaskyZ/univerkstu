import { describe, it, expect } from 'vitest';
import {
    startOfToday,
    daysBetween,
    isDateInRange,
    buildWeekLabel,
    mondayOf,
    pickActivePeriod,
    pickCurrentSemester,
    resolveActivePeriod,
} from './academic-context.js';
import type {
    AcademicCalendarPeriod,
    AcademicCalendarSemester,
    ParsedAcademicCalendar,
} from '../parsers/academic-calendar.js';

describe('startOfToday', () => {
    it('zeroes out hours/minutes/seconds/ms', () => {
        const d = new Date(2026, 4, 13, 15, 47, 23, 456);
        const result = startOfToday(d);
        expect(result.getHours()).toBe(0);
        expect(result.getMinutes()).toBe(0);
        expect(result.getSeconds()).toBe(0);
        expect(result.getMilliseconds()).toBe(0);
    });

    it('preserves the calendar date (year/month/date)', () => {
        const d = new Date(2026, 4, 13, 23, 59, 59);
        const result = startOfToday(d);
        expect(result.getFullYear()).toBe(2026);
        expect(result.getMonth()).toBe(4); // May
        expect(result.getDate()).toBe(13);
    });

    it('uses local timezone (not UTC) — same calendar day regardless of clock time', () => {
        // Local-time constructor means 23:59:59 on the 13th still maps to start-of-day on the 13th
        // (not the 14th, which a UTC-based zeroing might produce in some timezones).
        const lateEvening = new Date(2026, 4, 13, 23, 59, 59);
        const result = startOfToday(lateEvening);
        expect(result.getDate()).toBe(13);
    });

    it('defaults to "now" when no argument given', () => {
        const before = Date.now();
        const result = startOfToday();
        const after = Date.now();
        // result is local-start-of-today: ms <= now
        expect(result.getTime()).toBeLessThanOrEqual(after);
        expect(result.getTime()).toBeLessThanOrEqual(before + 1000);
    });
});

describe('daysBetween', () => {
    it('returns 0 for same calendar day even at different times', () => {
        const morning = new Date(2026, 4, 13, 8, 0, 0);
        const evening = new Date(2026, 4, 13, 22, 0, 0);
        expect(daysBetween(morning, evening)).toBe(0);
    });

    it('returns positive integer for forward range', () => {
        const start = new Date(2026, 4, 1, 10, 0, 0);
        const end = new Date(2026, 4, 8, 10, 0, 0);
        expect(daysBetween(start, end)).toBe(7);
    });

    it('returns negative integer for backward range', () => {
        const start = new Date(2026, 4, 13);
        const end = new Date(2026, 4, 10);
        expect(daysBetween(start, end)).toBe(-3);
    });

    it('uses start-of-day for both endpoints (time-of-day does not matter)', () => {
        // Both inputs normalized to start-of-day, so a 23:59 → next-day 00:01 gap = 1 day.
        const lateNight = new Date(2026, 4, 13, 23, 59);
        const earlyMorning = new Date(2026, 4, 14, 0, 1);
        expect(daysBetween(lateNight, earlyMorning)).toBe(1);
    });

    it('handles month boundaries', () => {
        const apr30 = new Date(2026, 3, 30);
        const may2 = new Date(2026, 4, 2);
        expect(daysBetween(apr30, may2)).toBe(2);
    });

    it('handles year boundaries', () => {
        const dec31 = new Date(2025, 11, 31);
        const jan2 = new Date(2026, 0, 2);
        expect(daysBetween(dec31, jan2)).toBe(2);
    });
});

describe('mondayOf', () => {
    it('returns the same day (at start-of-day) when the date is a Monday', () => {
        const monday = new Date(2025, 8, 1, 15, 30); // 1 Sep 2025 is a Monday
        const result = mondayOf(monday);
        expect([result.getFullYear(), result.getMonth(), result.getDate()]).toEqual([2025, 8, 1]);
        expect(result.getHours()).toBe(0);
    });

    it('snaps mid-week days back to the Monday of the same week', () => {
        const wednesday = new Date(2025, 8, 3); // Wed 3 Sep 2025
        expect(mondayOf(wednesday).getDate()).toBe(1);
        const saturday = new Date(2025, 8, 6); // Sat 6 Sep 2025
        expect(mondayOf(saturday).getDate()).toBe(1);
    });

    it('treats Sunday as the END of the week (snaps back 6 days)', () => {
        const sunday = new Date(2025, 8, 7); // Sun 7 Sep 2025
        expect(mondayOf(sunday).getDate()).toBe(1);
    });

    it('crosses month boundaries correctly', () => {
        const wednesday = new Date(2025, 9, 1); // Wed 1 Oct 2025
        const result = mondayOf(wednesday);
        expect([result.getMonth(), result.getDate()]).toEqual([8, 29]); // Mon 29 Sep
    });
});

describe('isDateInRange', () => {
    it('returns false when start or end is null', () => {
        const d = new Date(2026, 4, 13);
        expect(isDateInRange(d, null, new Date(2026, 4, 20))).toBe(false);
        expect(isDateInRange(d, new Date(2026, 4, 1), null)).toBe(false);
        expect(isDateInRange(d, null, null)).toBe(false);
    });

    it('returns true when date is within (start, end)', () => {
        const d = new Date(2026, 4, 13, 12, 0);
        const start = new Date(2026, 4, 1);
        const end = new Date(2026, 4, 20);
        expect(isDateInRange(d, start, end)).toBe(true);
    });

    it('returns true when date equals start (inclusive lower bound)', () => {
        const d = new Date(2026, 4, 1, 12, 0);
        const start = new Date(2026, 4, 1, 0, 0);
        const end = new Date(2026, 4, 20);
        expect(isDateInRange(d, start, end)).toBe(true);
    });

    it('returns true when date equals end (inclusive upper bound)', () => {
        const d = new Date(2026, 4, 20, 23, 59);
        const start = new Date(2026, 4, 1);
        const end = new Date(2026, 4, 20, 0, 0);
        // Both normalized to start-of-day on the 20th → equal → in-range.
        expect(isDateInRange(d, start, end)).toBe(true);
    });

    it('returns false when date is before start', () => {
        const d = new Date(2026, 3, 30);
        const start = new Date(2026, 4, 1);
        const end = new Date(2026, 4, 20);
        expect(isDateInRange(d, start, end)).toBe(false);
    });

    it('returns false when date is after end', () => {
        const d = new Date(2026, 4, 21);
        const start = new Date(2026, 4, 1);
        const end = new Date(2026, 4, 20);
        expect(isDateInRange(d, start, end)).toBe(false);
    });

    it('time-of-day on the boundary day still counts as in-range', () => {
        // The 20th at 23:59:59 is still within a range ending on the 20th, because
        // both endpoints normalize to start-of-day on the 20th.
        const d = new Date(2026, 4, 20, 23, 59, 59);
        const start = new Date(2026, 4, 20, 10, 0);
        const end = new Date(2026, 4, 20, 14, 0);
        expect(isDateInRange(d, start, end)).toBe(true);
    });
});

describe('buildWeekLabel', () => {
    it('returns null for null/0/negative input', () => {
        expect(buildWeekLabel(null)).toBe(null);
        expect(buildWeekLabel(0)).toBe(null);
        expect(buildWeekLabel(-1)).toBe(null);
    });

    it('returns Russian "{n}-я неделя" format for positive integers', () => {
        expect(buildWeekLabel(1)).toBe('1-я неделя');
        expect(buildWeekLabel(5)).toBe('5-я неделя');
        expect(buildWeekLabel(18)).toBe('18-я неделя');
    });

    it('does not localize — always returns Russian label', () => {
        // This is by design: the label is rendered server-side and passed through
        // to the schedule view's `weekLabel` field. Localization is intentionally
        // not applied here — future i18n would happen at the caller.
        expect(buildWeekLabel(7)).toBe('7-я неделя');
    });
});

// Note: the parser stores dates as DD.MM.YYYY strings (see parsers/academic-calendar.ts:parseDate).
// toDate() applied internally by pickActivePeriod/pickCurrentSemester only parses that format.
function period(overrides: Partial<AcademicCalendarPeriod>): AcademicCalendarPeriod {
    return {
        label: 'Default',
        kind: 'theory',
        weeks: null,
        start: '01.01.2026',
        end: '31.12.2026',
        segmentLabel: '',
        ...overrides,
    };
}

function semester(overrides: Partial<AcademicCalendarSemester>): AcademicCalendarSemester {
    return {
        semesterNumber: 1,
        title: 'Semester 1',
        start: '01.01.2026',
        end: '31.05.2026',
        totalWeeks: null,
        periods: [],
        ...overrides,
    };
}

describe('pickActivePeriod', () => {
    it('returns null when periods array is empty', () => {
        expect(pickActivePeriod([], new Date(2026, 4, 13))).toBe(null);
    });

    it('returns null when no period contains the date', () => {
        const periods = [
            period({ kind: 'theory', start: '01.01.2026', end: '31.03.2026' }),
            period({ kind: 'midterm_1', start: '01.04.2026', end: '15.04.2026' }),
        ];
        const now = new Date(2026, 5, 1); // June 1 — past both
        expect(pickActivePeriod(periods, now)).toBe(null);
    });

    it('picks the period containing the date when there is only one', () => {
        const target = period({ kind: 'theory', start: '01.01.2026', end: '30.04.2026' });
        const result = pickActivePeriod([target], new Date(2026, 2, 15));
        expect(result?.kind).toBe('theory');
    });

    it('prefers a non-semester period over a "semester" period when both contain the date', () => {
        // The "semester" kind is the umbrella period covering the whole semester.
        // Specific phases (theory, midterm_1, etc.) overlap with it — these should win
        // because they tell the user what's actually happening *now*.
        const sem = period({ kind: 'semester', label: 'Semester 1', start: '01.01.2026', end: '31.05.2026' });
        const theory = period({ kind: 'theory', label: 'Theory phase', start: '15.01.2026', end: '30.04.2026' });
        const result = pickActivePeriod([sem, theory], new Date(2026, 2, 15));
        expect(result?.kind).toBe('theory');
        expect(result?.label).toBe('Theory phase');
    });

    it('falls back to the semester period when only the umbrella contains the date', () => {
        // Mid-March: theory ended in Feb, midterm hasn't started — only the umbrella
        // "semester" period still wraps it.
        const sem = period({ kind: 'semester', label: 'Semester 1', start: '01.01.2026', end: '31.05.2026' });
        const theory = period({ kind: 'theory', start: '01.01.2026', end: '15.02.2026' });
        const midterm = period({ kind: 'midterm_1', start: '01.04.2026', end: '15.04.2026' });
        const result = pickActivePeriod([sem, theory, midterm], new Date(2026, 2, 1));
        expect(result?.kind).toBe('semester');
    });

    it('picks the first non-semester period when multiple specific periods overlap', () => {
        const theory = period({ kind: 'theory', label: 'First', start: '01.01.2026', end: '30.04.2026' });
        const midterm = period({ kind: 'midterm_1', label: 'Second', start: '01.03.2026', end: '15.03.2026' });
        // Both contain March 10. The function uses `find`, so first non-semester wins.
        const result = pickActivePeriod([theory, midterm], new Date(2026, 2, 10));
        expect(result?.label).toBe('First');
    });
});

describe('pickCurrentSemester', () => {
    it('returns null when there are no semesters at all', () => {
        const parsed: ParsedAcademicCalendar = {
            formOfEducation: null,
            educationLevel: null,
            specialty: null,
            totalSemesters: null,
            admissionYear: null,
            semesters: [],
        };
        expect(pickCurrentSemester(parsed, new Date(2026, 4, 13))).toBe(null);
    });

    it('picks the semester whose [start, end] contains today', () => {
        const fall = semester({ semesterNumber: 3, title: 'Fall 2025', start: '01.09.2025', end: '31.12.2025' });
        const spring = semester({ semesterNumber: 4, title: 'Spring 2026', start: '01.02.2026', end: '31.05.2026' });
        const parsed: ParsedAcademicCalendar = {
            formOfEducation: null,
            educationLevel: null,
            specialty: null,
            totalSemesters: 8,
            admissionYear: 2023,
            semesters: [fall, spring],
        };
        const result = pickCurrentSemester(parsed, new Date(2026, 3, 15)); // April 15 → spring
        expect(result?.semesterNumber).toBe(4);
        expect(result?.title).toBe('Spring 2026');
    });

    it('falls back to the next future semester when today is between semesters', () => {
        const fall = semester({ semesterNumber: 3, title: 'Fall 2025', start: '01.09.2025', end: '31.12.2025' });
        const spring = semester({ semesterNumber: 4, title: 'Spring 2026', start: '01.02.2026', end: '31.05.2026' });
        const parsed: ParsedAcademicCalendar = {
            formOfEducation: null,
            educationLevel: null,
            specialty: null,
            totalSemesters: 8,
            admissionYear: 2023,
            semesters: [fall, spring],
        };
        // Mid-January 2026: between fall (ended Dec 31) and spring (starts Feb 1) → next is spring.
        const result = pickCurrentSemester(parsed, new Date(2026, 0, 15));
        expect(result?.semesterNumber).toBe(4);
    });

    it('picks the EARLIEST future semester when multiple lie in the future', () => {
        const spring = semester({ semesterNumber: 4, title: 'Spring 2026', start: '01.02.2026', end: '31.05.2026' });
        const fall26 = semester({ semesterNumber: 5, title: 'Fall 2026', start: '01.09.2026', end: '31.12.2026' });
        const parsed: ParsedAcademicCalendar = {
            formOfEducation: null,
            educationLevel: null,
            specialty: null,
            totalSemesters: 8,
            admissionYear: 2023,
            semesters: [fall26, spring], // intentionally out-of-order to test sort
        };
        // Dec 2025 → both lie in future; earliest (spring 2026) wins.
        const result = pickCurrentSemester(parsed, new Date(2025, 11, 15));
        expect(result?.semesterNumber).toBe(4);
    });

    it('falls back to the LAST semester when today is past all of them (graduated student)', () => {
        const fall = semester({ semesterNumber: 7, title: 'Fall 2025', start: '01.09.2025', end: '31.12.2025' });
        const spring = semester({ semesterNumber: 8, title: 'Spring 2026', start: '01.02.2026', end: '31.05.2026' });
        const parsed: ParsedAcademicCalendar = {
            formOfEducation: null,
            educationLevel: null,
            specialty: null,
            totalSemesters: 8,
            admissionYear: 2022,
            semesters: [fall, spring],
        };
        // June 2026 → past all. Fallback: last semester in array.
        const result = pickCurrentSemester(parsed, new Date(2026, 5, 15));
        expect(result?.semesterNumber).toBe(8);
        expect(result?.title).toBe('Spring 2026');
    });

    it('skips semesters with unparseable start dates when looking for future ones', () => {
        // toDate() returns null for non-ISO strings — those entries should be filtered out
        // from the "future semester" candidate list.
        const broken = semester({ semesterNumber: 9, title: 'Broken', start: 'not-a-date', end: '31.12.2027' });
        const valid = semester({ semesterNumber: 10, title: 'Valid Future', start: '01.09.2027', end: '31.12.2027' });
        const parsed: ParsedAcademicCalendar = {
            formOfEducation: null,
            educationLevel: null,
            specialty: null,
            totalSemesters: null,
            admissionYear: null,
            semesters: [broken, valid],
        };
        const result = pickCurrentSemester(parsed, new Date(2026, 0, 1));
        // 'broken' has unparseable start so it's filtered from "future" candidates → 'Valid Future' wins.
        expect(result?.title).toBe('Valid Future');
    });
});

describe('resolveActivePeriod', () => {
    it('computes a week number when today is inside the semester window', () => {
        const sem = semester({ start: '01.09.2025', end: '31.12.2025' });
        // 15 Sep 2025 → 14 days in (14 / 7 = 2, +1 = 3rd week)
        const result = resolveActivePeriod(sem, new Date(2025, 8, 15, 12, 0, 0));
        expect(result.semesterIsCurrent).toBe(true);
        expect(result.semesterWeek).toBe(3);
    });

    it('anchors week boundaries to Monday when the semester starts mid-week', () => {
        // Semester starts Wednesday 3 Sep 2025. По вузовской сетке 2-я неделя
        // начинается уже в понедельник 8 Sep — а не в среду 10 Sep, как давало
        // деление от сырой даты старта (regression guard для чётности Пн-Вт).
        const sem = semester({ start: '03.09.2025', end: '31.12.2025' });

        // Пн 8 Sep — уже 2-я неделя (старый код давал 1-ю до среды).
        expect(resolveActivePeriod(sem, new Date(2025, 8, 8, 9, 0)).semesterWeek).toBe(2);
        // Вт 9 Sep — тоже 2-я.
        expect(resolveActivePeriod(sem, new Date(2025, 8, 9, 9, 0)).semesterWeek).toBe(2);
        // Вс 7 Sep — ещё 1-я (неполная первая неделя целиком считается 1-й).
        expect(resolveActivePeriod(sem, new Date(2025, 8, 7, 9, 0)).semesterWeek).toBe(1);
        // Пн 15 Sep — 3-я.
        expect(resolveActivePeriod(sem, new Date(2025, 8, 15, 9, 0)).semesterWeek).toBe(3);
    });

    it('keeps Monday-start semesters unchanged (weeks flip exactly on Mondays)', () => {
        const sem = semester({ start: '01.09.2025', end: '31.12.2025' }); // Monday
        expect(resolveActivePeriod(sem, new Date(2025, 8, 7)).semesterWeek).toBe(1); // Sun of wk 1
        expect(resolveActivePeriod(sem, new Date(2025, 8, 8)).semesterWeek).toBe(2); // Mon of wk 2
    });

    it('surfaces an in-semester active period (exams) over the bare week', () => {
        const sem = semester({
            start: '01.09.2025',
            end: '15.01.2026',
            periods: [
                period({ kind: 'theory', label: 'Теоретическое обучение', start: '01.09.2025', end: '20.12.2025' }),
                period({ kind: 'exams', label: 'Экзаменационная сессия', start: '05.01.2026', end: '15.01.2026' }),
            ],
        });
        const result = resolveActivePeriod(sem, new Date(2026, 0, 10, 12, 0, 0)); // inside exams
        expect(result.activePeriodKind).toBe('exams');
        expect(result.activePeriodLabel).toBe('Экзаменационная сессия');
    });

    it('does NOT fabricate a week number for a future-semester fallback (between-semesters break)', () => {
        // pickCurrentSemester returns the upcoming semester when today is in the gap;
        // the old code clamped the negative day-diff to "1-я неделя".
        const upcoming = semester({ start: '01.09.2026', end: '31.12.2026' });
        const result = resolveActivePeriod(upcoming, new Date(2026, 6, 20, 12, 0, 0)); // 20 Jul — summer break
        expect(result.semesterIsCurrent).toBe(false);
        expect(result.semesterWeek).toBeNull();
        expect(result.activePeriodKind).toBe('vacation');
        expect(result.activePeriodLabel).toBe('Каникулы');
    });

    it('treats a past-semester fallback (after graduation) as vacation, not a huge week number', () => {
        const last = semester({ start: '01.09.2024', end: '31.12.2024' });
        const result = resolveActivePeriod(last, new Date(2026, 4, 22, 12, 0, 0));
        expect(result.semesterIsCurrent).toBe(false);
        expect(result.semesterWeek).toBeNull();
        expect(result.activePeriodKind).toBe('vacation');
    });

    it('returns a vacation resolution for a null semester', () => {
        const result = resolveActivePeriod(null, new Date(2026, 4, 22));
        expect(result.semesterIsCurrent).toBe(false);
        expect(result.semesterWeek).toBeNull();
        expect(result.activePeriodKind).toBe('vacation');
        expect(result.activePeriodLabel).toBe('Каникулы');
    });

    it('leaves activePeriodKind null for an in-semester gap between sub-periods', () => {
        const sem = semester({
            start: '01.09.2025',
            end: '31.12.2025',
            periods: [period({ kind: 'theory', start: '01.09.2025', end: '01.10.2025' })],
        });
        // 1 Nov — inside the semester window but outside the only sub-period.
        const result = resolveActivePeriod(sem, new Date(2025, 10, 1, 12, 0, 0));
        expect(result.semesterIsCurrent).toBe(true);
        expect(result.semesterWeek).not.toBeNull();
        expect(result.activePeriodKind).toBeNull();
    });
});
