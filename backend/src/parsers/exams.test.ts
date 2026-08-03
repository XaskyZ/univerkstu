import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    buildSemesterTitle,
    parseExamDatetime,
    parseExamRow,
    resolveTargetTerm,
    type ExamInitialResponse,
} from './exams.js';

describe('parseExamDatetime', () => {
    it('returns null when no date is provided', () => {
        expect(parseExamDatetime(undefined, '10:00-12:00')).toBeNull();
        expect(parseExamDatetime('', '10:00')).toBeNull();
    });

    it('returns null when date has no dd.mm.yyyy match', () => {
        expect(parseExamDatetime('next week', '10:00')).toBeNull();
    });

    it('parses dotted date with time range', () => {
        const result = parseExamDatetime('15.01.2026', '10:00-12:00');
        expect(result).toEqual({
            date: '2026-01-15',
            time: '10:00',
            displayDate: '15.01.2026',
            displayTime: '10:00',
            iso: '2026-01-15T10:00:00',
        });
    });

    it('normalizes dashed date format to dotted', () => {
        const result = parseExamDatetime('05-06-2025', '14:30');
        expect(result?.date).toBe('2025-06-05');
        expect(result?.iso).toBe('2025-06-05T14:30:00');
    });

    it('falls back to 00:00 when time is missing or malformed', () => {
        const result = parseExamDatetime('15.01.2026');
        expect(result?.time).toBe('00:00');
        expect(result?.iso).toBe('2026-01-15T00:00:00');
    });

    it('extracts date from text with surrounding content', () => {
        const result = parseExamDatetime('Экзамен 15.01.2026 утром', '09:00-11:00');
        expect(result?.date).toBe('2026-01-15');
        expect(result?.displayDate).toBe('15.01.2026');
    });

    it('handles single-digit day and month with leading zeros', () => {
        const result = parseExamDatetime('05.06.2025', '08:00');
        expect(result?.date).toBe('2025-06-05');
    });

    it('uses only the first HH:MM in a time range', () => {
        const result = parseExamDatetime('15.01.2026', '23:59-23:59');
        expect(result?.time).toBe('23:59');
        expect(result?.iso).toBe('2026-01-15T23:59:00');
    });
});

describe('parseExamRow', () => {
    it('marks additional exams as Дополнительный', () => {
        const exam = parseExamRow({
            subjectName: 'Математика',
            tutorName: 'Иванов И.И.',
            additional: true,
            examType: 'Письменно',
            buildingName: 'Корпус 1',
            auditoryName: '305',
            studyGroupName: 'Лекция',
        });
        expect(exam.subject).toBe('Математика');
        expect(exam.teacher).toBe('Иванов И.И.');
        expect(exam.type).toBe('Дополнительный');
        expect(exam.format).toBe('Письменно');
        expect(exam.locationRaw).toBe('Корпус 1, 305');
    });

    it('marks online exams as Онлайн', () => {
        const exam = parseExamRow({
            subjectName: 'Алгоритмы',
            onlineExam: true,
        });
        expect(exam.type).toBe('Онлайн');
    });

    it('leaves type empty for regular exams', () => {
        const exam = parseExamRow({
            subjectName: 'Физика',
        });
        expect(exam.type).toBe('');
    });

    it('uses examDate.date2 as primary date source', () => {
        const exam = parseExamRow({
            subjectName: 'История',
            examDate: { date2: '12.06.2025', displayedValue: 'wrong' },
            examTime: '09:00-11:00',
        });
        expect(exam.datetime?.date).toBe('2025-06-12');
        expect(exam.datetime?.time).toBe('09:00');
    });

    it('falls back to displayedValue when date2 is missing', () => {
        const exam = parseExamRow({
            subjectName: 'История',
            examDate: { displayedValue: '12.06.2025' },
        });
        expect(exam.datetime?.date).toBe('2025-06-12');
    });

    it('joins location parts with comma, dropping missing pieces', () => {
        const onlyRoom = parseExamRow({ subjectName: 'X', auditoryName: '305' });
        expect(onlyRoom.locationRaw).toBe('305');
        const onlyBuilding = parseExamRow({ subjectName: 'X', buildingName: 'Корпус 2' });
        expect(onlyBuilding.locationRaw).toBe('Корпус 2');
        const empty = parseExamRow({ subjectName: 'X' });
        expect(empty.locationRaw).toBe('');
    });

    it('omits the flags object entirely when no flag is set', () => {
        const exam = parseExamRow({ subjectName: 'X' });
        expect(exam.flags).toBeUndefined();
    });

    it('propagates row-level online + additional flags', () => {
        const exam = parseExamRow({
            subjectName: 'Y',
            onlineExam: true,
            additional: true,
        });
        expect(exam.flags).toEqual({ online: true, additional: true });
    });

    it('propagates row-level final/state flags', () => {
        const exam = parseExamRow({
            subjectName: 'Z',
            finalExam: true,
            stateExam: true,
        });
        expect(exam.flags).toEqual({ final: true, state: true });
    });

    it('falls back to session-level finalExam/stateExam when row is silent', () => {
        const exam = parseExamRow(
            { subjectName: 'W' },
            { finalExam: true, stateExam: true },
        );
        expect(exam.flags).toEqual({ final: true, state: true });
    });

    it('row-level booleans win over session-level ones', () => {
        const exam = parseExamRow(
            { subjectName: 'W', finalExam: false },
            { finalExam: true },
        );
        // false on the row still resolves to "false" (no flag), session is ignored.
        expect(exam.flags?.final).toBeUndefined();
    });
});

describe('buildSemesterTitle', () => {
    it('builds Russian title for semester 1', () => {
        expect(buildSemesterTitle(2025, 1, 'ru')).toBe('2025/2026 • 1 семестр');
    });

    it('builds Russian title for semester 2', () => {
        expect(buildSemesterTitle(2025, 2, 'ru')).toBe('2025/2026 • 2 семестр');
    });

    it('builds Kazakh title', () => {
        expect(buildSemesterTitle(2024, 2, 'kz')).toBe('2024/2025 • 2 семестр');
    });

    it('builds English title', () => {
        expect(buildSemesterTitle(2025, 1, 'en')).toBe('2025/2026 • Semester 1');
        expect(buildSemesterTitle(2025, 2, 'en')).toBe('2025/2026 • Semester 2');
    });
});

describe('resolveTargetTerm', () => {
    // Decides which (year, semester) tuple to fetch exams for. Resolution cascade
    // per dimension:
    //   1. If current academic period (year/sem) is in the available list → use current
    //   2. Else if initial.selectedYear/selectedTerm is set → use it
    //   3. Else → fall back to current (default)
    //
    // The current academic period comes from getCurrentAcademicPeriod (already tested).
    // We freeze the system time to make the test deterministic.

    beforeEach(() => {
        vi.useFakeTimers();
        // October 2026 → autumn semester of 2026, sem 1.
        vi.setSystemTime(new Date('2026-10-15'));
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses current period when year+semester both available', () => {
        const initial: ExamInitialResponse = {
            yearList: [2024, 2025, 2026],
            termList: [{ ID: 1 }, { ID: 2 }],
        };
        expect(resolveTargetTerm(initial)).toEqual({ year: 2026, semester: 1 });
    });

    it('falls back to initial.selectedYear when current year is NOT in availableYears', () => {
        const initial: ExamInitialResponse = {
            yearList: [2024, 2025],
            selectedYear: 2025,
            termList: [{ ID: 1 }],
        };
        expect(resolveTargetTerm(initial).year).toBe(2025);
    });

    it('falls back to current.year when neither availableYears contains current NOR selectedYear is set', () => {
        const initial: ExamInitialResponse = {
            yearList: [2020, 2021],
            termList: [{ ID: 1 }],
        };
        // current.year is 2026 — neither in list nor in selectedYear → defaults to current.
        expect(resolveTargetTerm(initial).year).toBe(2026);
    });

    it('falls back to initial.selectedTerm when current semester is NOT in availableTerms', () => {
        const initial: ExamInitialResponse = {
            yearList: [2026],
            termList: [{ ID: 2 }], // only sem 2 available
            selectedTerm: 2,
        };
        expect(resolveTargetTerm(initial).semester).toBe(2);
    });

    it('uses `id` (lowercase) field as alias for `ID` in termList', () => {
        // Documents the dual-field tolerance — Platonus sometimes returns lowercase id.
        const initial: ExamInitialResponse = {
            yearList: [2026],
            termList: [{ id: 1 }],
        };
        expect(resolveTargetTerm(initial).semester).toBe(1);
    });

    it('filters out non-1/non-2 term IDs (defense against malformed Platonus response)', () => {
        const initial: ExamInitialResponse = {
            yearList: [2026],
            termList: [{ ID: 3 }, { ID: 99 }], // both invalid
            selectedTerm: 1,
        };
        // current.semester (1) is NOT in filtered availableTerms (empty after filter) →
        // falls through to selectedTerm.
        expect(resolveTargetTerm(initial).semester).toBe(1);
    });

    it('rejects selectedTerm if it is not 1 or 2 (fallback to current)', () => {
        const initial: ExamInitialResponse = {
            yearList: [2020],
            termList: [{ ID: 3 }],
            selectedTerm: 5, // invalid
        };
        // current.year not in list → selectedYear (undefined) → current.year (2026).
        // current.semester not in list → selectedTerm (5) is invalid → current.semester (1).
        expect(resolveTargetTerm(initial)).toEqual({ year: 2026, semester: 1 });
    });

    it('handles missing termList/yearList (defaults to current)', () => {
        expect(resolveTargetTerm({})).toEqual({ year: 2026, semester: 1 });
    });

    it('handles non-array termList (defensively treats as empty)', () => {
        const initial = { yearList: [2026], termList: 'invalid' as unknown } as ExamInitialResponse;
        expect(resolveTargetTerm(initial).semester).toBe(1); // falls through cascade
    });
});
