import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCalendarDate, mapAcademicMilestones, endOfCalendarDayKz } from './exams.js';

describe('parseCalendarDate', () => {
    // Parses the DD.MM.YYYY strings that come from KSTU's academic calendar HTML.

    it('parses a valid DD.MM.YYYY string', () => {
        const result = parseCalendarDate('13.05.2026');
        expect(result).not.toBe(null);
        expect(result!.getFullYear()).toBe(2026);
        expect(result!.getMonth()).toBe(4); // May (0-based)
        expect(result!.getDate()).toBe(13);
    });

    it('returns null for non-matching format', () => {
        expect(parseCalendarDate('2026-05-13')).toBe(null);
        expect(parseCalendarDate('13/05/2026')).toBe(null);
        expect(parseCalendarDate('13.5.2026')).toBe(null); // single-digit month not allowed
        expect(parseCalendarDate('5.05.26')).toBe(null);
        expect(parseCalendarDate('')).toBe(null);
        expect(parseCalendarDate('garbage')).toBe(null);
    });

    it('returns null for impossible dates that JS Date does NOT auto-correct silently', () => {
        // The regex matches "32.13.2026" but new Date(2026, 12, 32) auto-rolls to next month/year.
        // Documents that the function does NOT defend against this — only literal-NaN dates fail.
        // The constructor for (year=2026, month=12, day=32) actually produces Feb 1, 2027.
        const result = parseCalendarDate('32.13.2026');
        // The function returns it anyway since the JS Date is "valid" (just shifted).
        // Lock in the actual behavior so a future refactor that adds strict validation
        // is an intentional change.
        expect(result).not.toBe(null);
    });

    it('parses month boundaries correctly (zero-padded)', () => {
        expect(parseCalendarDate('01.01.2026')!.getMonth()).toBe(0); // January
        expect(parseCalendarDate('31.12.2026')!.getMonth()).toBe(11); // December
    });

    it('uses local timezone (not UTC) — first millisecond of the day', () => {
        // The function uses new Date(year, month, day) which constructs in local TZ.
        // Asserts hour/minute/second are zero in local time.
        const date = parseCalendarDate('13.05.2026')!;
        expect(date.getHours()).toBe(0);
        expect(date.getMinutes()).toBe(0);
        expect(date.getSeconds()).toBe(0);
    });
});

describe('endOfCalendarDayKz', () => {
    // Правая граница вехи: 23:59:59.999 последнего дня по времени Казахстана
    // (Asia/Almaty, UTC+5, без DST) — не зависит от таймзоны сервера.

    it('returns 23:59:59.999 +05:00 of the given day (= 18:59:59.999 UTC)', () => {
        const result = endOfCalendarDayKz('15.05.2026');
        expect(result).not.toBe(null);
        expect(result!.toISOString()).toBe('2026-05-15T18:59:59.999Z');
    });

    it('returns null for non-matching format', () => {
        expect(endOfCalendarDayKz('2026-05-15')).toBe(null);
        expect(endOfCalendarDayKz('15/05/2026')).toBe(null);
        expect(endOfCalendarDayKz('')).toBe(null);
        expect(endOfCalendarDayKz('garbage')).toBe(null);
    });

    it('rejects impossible dates (stricter than parseCalendarDate — ISO parsing does not roll over)', () => {
        expect(endOfCalendarDayKz('32.13.2026')).toBe(null);
        expect(endOfCalendarDayKz('32.05.2026')).toBe(null);
    });
});

describe('mapAcademicMilestones', () => {
    // Transforms academic-calendar periods into the API milestone format with
    // active/upcoming flags computed against current time. Drives the exam-period
    // banner on the schedule view.

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    const period = (overrides: Partial<Parameters<typeof mapAcademicMilestones>[0][number]> = {}) => ({
        label: 'Test',
        kind: 'midterm_1',
        start: '01.05.2026',
        end: '15.05.2026',
        weeks: 2,
        segmentLabel: 'P1',
        ...overrides,
    });

    it('filters to only the 4 milestone kinds (midterm_1, midterm_2, exams, state_exams)', () => {
        vi.setSystemTime(new Date(2026, 0, 1));
        const result = mapAcademicMilestones([
            period({ kind: 'theory' }),
            period({ kind: 'midterm_1' }),
            period({ kind: 'midterm_2' }),
            period({ kind: 'exams' }),
            period({ kind: 'state_exams' }),
            period({ kind: 'practice' }),
            period({ kind: 'practice_grading' }),
            period({ kind: 'semester' }),
            period({ kind: 'other' }),
        ]);
        expect(result.map((p) => p.kind)).toEqual(['midterm_1', 'midterm_2', 'exams', 'state_exams']);
    });

    it('marks period as active when now is within [start, end]', () => {
        vi.setSystemTime(new Date(2026, 4, 10)); // May 10 — between May 1 and May 15
        const result = mapAcademicMilestones([period()]);
        expect(result[0].active).toBe(true);
        expect(result[0].upcoming).toBe(false);
    });

    it('marks period as upcoming when now is before start', () => {
        vi.setSystemTime(new Date(2026, 3, 15)); // April 15 — before May 1
        const result = mapAcademicMilestones([period()]);
        expect(result[0].active).toBe(false);
        expect(result[0].upcoming).toBe(true);
    });

    it('marks period as past (neither active nor upcoming) when now is after end', () => {
        vi.setSystemTime(new Date(2026, 5, 1)); // June 1 — after May 15
        const result = mapAcademicMilestones([period()]);
        expect(result[0].active).toBe(false);
        expect(result[0].upcoming).toBe(false);
    });

    it('active at exact start (inclusive boundary)', () => {
        // The check is `now >= start && now <= end` — both boundaries inclusive.
        vi.setSystemTime(new Date(2026, 4, 1)); // exactly May 1
        const result = mapAcademicMilestones([period()]);
        expect(result[0].active).toBe(true);
    });

    it('active at exact end (inclusive boundary)', () => {
        vi.setSystemTime(new Date(2026, 4, 15)); // exactly May 15
        const result = mapAcademicMilestones([period()]);
        expect(result[0].active).toBe(true);
    });

    it('stays active through the whole last day — evening included (№8 аудита)', () => {
        // Раньше конец периода парсился в полночь НАЧАЛА последнего дня,
        // и уже в 00:01 15-го мая веха считалась прошедшей.
        vi.setSystemTime(new Date('2026-05-15T21:30:00+05:00')); // вечер последнего дня по KZ
        const result = mapAcademicMilestones([period()]);
        expect(result[0].active).toBe(true);
        expect(result[0].upcoming).toBe(false);
    });

    it('deactivates only after KZ midnight following the last day', () => {
        vi.setSystemTime(new Date('2026-05-16T00:30:00+05:00'));
        const result = mapAcademicMilestones([period()]);
        expect(result[0].active).toBe(false);
        expect(result[0].upcoming).toBe(false);
    });

    it('forwards label/start/end/weeks/segmentLabel unchanged', () => {
        vi.setSystemTime(new Date(2026, 0, 1));
        const result = mapAcademicMilestones([period({
            label: 'Сессия 1',
            kind: 'exams',
            start: '01.06.2026',
            end: '15.06.2026',
            weeks: 3,
            segmentLabel: 'Семестр 2',
        })]);
        expect(result[0]).toMatchObject({
            label: 'Сессия 1',
            kind: 'exams',
            start: '01.06.2026',
            end: '15.06.2026',
            weeks: 3,
            segmentLabel: 'Семестр 2',
        });
    });

    it('unparseable dates → active=false, upcoming=false (safe defaults)', () => {
        vi.setSystemTime(new Date(2026, 4, 10));
        const result = mapAcademicMilestones([period({ start: 'malformed', end: 'malformed' })]);
        // A milestone with bad dates is rendered as "past" — neither active nor upcoming.
        expect(result[0].active).toBe(false);
        expect(result[0].upcoming).toBe(false);
    });
});
