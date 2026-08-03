import { describe, it, expect } from 'vitest';
import {
    classifySubjectKind,
    extractDetailedGrades,
    extractExamMarks,
    extractTotalMark,
    getDetailedGradeType,
    normalizeExamMatchValue,
    parseDetailedGradeMark,
    getDetailedGradeTitle,
    getDetailedGradeTeacher,
    getDetailedGradeMarkTitle,
    getDetailedGradeMarkTeacher,
    getDetailedGradeComment,
    getDetailedGradeMonthLabel,
    resolveCalendarExamDate,
} from './grades.js';
import type { PlatonusCalendarEvent } from './platonus-client.js';

describe('normalizeExamMatchValue', () => {
    it('lowercases and collapses whitespace', () => {
        expect(normalizeExamMatchValue('  Высшая   Математика  ')).toBe('высшая математика');
    });

    it('returns empty string for null/undefined', () => {
        expect(normalizeExamMatchValue(null)).toBe('');
        expect(normalizeExamMatchValue(undefined)).toBe('');
        expect(normalizeExamMatchValue('')).toBe('');
    });

    it('strips parentheses (turns them into spaces)', () => {
        expect(normalizeExamMatchValue('Алгоритмы (лекция)')).toBe('алгоритмы лекция');
    });

    it('strips punctuation but keeps letters and digits and hyphens', () => {
        expect(normalizeExamMatchValue('IT-101: programming basics!')).toBe('it-101 programming basics');
    });
});

describe('extractTotalMark', () => {
    it('uses totalMark when present', () => {
        // @ts-expect-error - we pass minimal shape, the real Subject has more fields
        expect(extractTotalMark({ totalMark: '85' })).toBe('85');
    });

    it('falls back to centerMark when totalMark is dash', () => {
        // @ts-expect-error - minimal shape for testing
        expect(extractTotalMark({ totalMark: '-', centerMark: '90' })).toBe('90');
    });

    it('falls back to totalScore when previous fields are dash/empty', () => {
        // @ts-expect-error - minimal shape for testing
        expect(extractTotalMark({ totalMark: '-', centerMark: '-', totalScore: '75' })).toBe('75');
    });

    it('falls back to total field as last resort', () => {
        // @ts-expect-error - minimal shape for testing
        expect(extractTotalMark({ total: '60' })).toBe('60');
    });

    it('returns "-" when nothing usable', () => {
        // @ts-expect-error - minimal shape for testing
        expect(extractTotalMark({})).toBe('-');
        // @ts-expect-error - minimal shape for testing
        expect(extractTotalMark({ totalMark: '-', centerMark: '-' })).toBe('-');
    });
});

describe('extractExamMarks', () => {
    it('returns dashes when input is not an array', () => {
        // @ts-expect-error - testing runtime behavior with bad input
        expect(extractExamMarks(null)).toEqual({ rk1: '-', rk2: '-', rating: '-', exam: '-', inferredKind: null });
        // @ts-expect-error - testing runtime behavior
        expect(extractExamMarks(undefined)).toEqual({ rk1: '-', rk2: '-', rating: '-', exam: '-', inferredKind: null });
    });

    it('extracts РК 1, РК 2, Рейтинг, Экз. by exact name', () => {
        const result = extractExamMarks([
            { name: 'РК 1', mark: 78 },
            { name: 'РК 2', mark: 82 },
            { name: 'Рейтинг', mark: 80 },
            { name: 'Экз.', mark: 90 },
        ]);
        expect(result).toEqual({ rk1: '78', rk2: '82', rating: '80', exam: '90', inferredKind: null });
    });

    it('treats Курс.р. slot as coursework signal (does not pollute exam)', () => {
        const result = extractExamMarks([{ name: 'Курс.р.', mark: 0 }]);
        expect(result.exam).toBe('-');
        expect(result.inferredKind).toBe('coursework');
    });

    it('lifts a meaningful Курс.р. value into rating when rating is empty', () => {
        const result = extractExamMarks([
            { name: 'РК 1', mark: 80 },
            { name: 'РК 2', mark: 85 },
            { name: 'Курс.р.', mark: 95 },
        ]);
        expect(result.exam).toBe('-');
        expect(result.rating).toBe('95');
        expect(result.inferredKind).toBe('coursework');
    });

    it('does not override an already populated rating with Курс.р.', () => {
        const result = extractExamMarks([
            { name: 'Рейтинг', mark: 88 },
            { name: 'Курс.р.', mark: 95 },
        ]);
        expect(result.rating).toBe('88');
        expect(result.inferredKind).toBe('coursework');
    });

    it('still flags coursework when Курс.р. is the placeholder 0', () => {
        const result = extractExamMarks([
            { name: 'РК 1', mark: 80 },
            { name: 'РК 2', mark: 85 },
            { name: 'Рейтинг', mark: 90 },
            { name: 'Курс.р.', mark: '0' },
        ]);
        expect(result.inferredKind).toBe('coursework');
        expect(result.exam).toBe('-');
        expect(result.rating).toBe('90');
    });

    it('coerces non-string marks to strings', () => {
        const result = extractExamMarks([{ name: 'РК 1', mark: 0 }]);
        expect(result.rk1).toBe('-'); // mark 0 falls into "|| '-'", documenting current behavior
    });

    it('ignores unrecognized exam types', () => {
        const result = extractExamMarks([
            { name: 'Промежуточный', mark: 50 },
            { name: 'Лаб', mark: 70 },
        ]);
        expect(result).toEqual({ rk1: '-', rk2: '-', rating: '-', exam: '-', inferredKind: null });
    });
});

describe('parseDetailedGradeMark', () => {
    it('returns Mark when it is a finite number', () => {
        expect(parseDetailedGradeMark({ Mark: 85 })).toBe(85);
        expect(parseDetailedGradeMark({ Mark: 0 })).toBe(0);
    });

    it('parses MarkName as fallback', () => {
        expect(parseDetailedGradeMark({ MarkName: '90' })).toBe(90);
    });

    it('handles comma decimals', () => {
        expect(parseDetailedGradeMark({ MarkName: '4,5' })).toBe(4.5);
    });

    it('returns null for non-numeric MarkName text', () => {
        expect(parseDetailedGradeMark({ MarkName: 'н/я' })).toBeNull();
    });

    it('returns 0 for empty/missing input (current behavior — Number("") is 0)', () => {
        // Documents existing behavior: Number('') === 0 so the function returns 0, not null.
        expect(parseDetailedGradeMark({})).toBe(0);
        expect(parseDetailedGradeMark(null)).toBe(0);
    });
});

describe('classifySubjectKind', () => {
    it('classifies regular subjects', () => {
        expect(classifySubjectKind('Высшая математика', 'MATH 1110-30--L')).toBe('regular');
        expect(classifySubjectKind('Физика', 'PHYS 2210-60--L')).toBe('regular');
        expect(classifySubjectKind('Программирование на Python')).toBe('regular');
    });

    it('classifies coursework by Russian markers', () => {
        expect(classifySubjectKind('Курсовая работа по программированию')).toBe('coursework');
        expect(classifySubjectKind('Программирование (курсовой проект)')).toBe('coursework');
        expect(classifySubjectKind('Курсовое проектирование')).toBe('coursework');
    });

    it('classifies coursework by Kazakh markers', () => {
        expect(classifySubjectKind('Бағдарламалау бойынша курстық жұмыс')).toBe('coursework');
        expect(classifySubjectKind('Курстық жоба')).toBe('coursework');
    });

    it('classifies coursework by English markers', () => {
        expect(classifySubjectKind('Algorithms Coursework')).toBe('coursework');
        expect(classifySubjectKind('Networking Course Project')).toBe('coursework');
    });

    it('classifies coursework by code/abbreviation markers', () => {
        expect(classifySubjectKind('Программирование II', 'PROG 2110-90--КП')).toBe('coursework');
        expect(classifySubjectKind('Базы данных КП.')).toBe('coursework');
    });

    it('classifies practice subjects', () => {
        expect(classifySubjectKind('Учебная практика')).toBe('practice');
        expect(classifySubjectKind('Производственная практика')).toBe('practice');
        expect(classifySubjectKind('Преддипломная практика')).toBe('practice');
        expect(classifySubjectKind('Профессиональная практика')).toBe('practice');
    });

    it('classifies practice in Kazakh', () => {
        expect(classifySubjectKind('Оқу тәжірибесі')).toBe('practice');
        expect(classifySubjectKind('Өндірістік тәжірибе')).toBe('practice');
    });

    it('does not mistake practicum for practice', () => {
        // "практикум" is a regular subject genre, not standalone practice
        expect(classifySubjectKind('Практикум по программированию')).toBe('regular');
    });

    it('coursework wins over practice when both markers present', () => {
        // A coursework named "Курсовая по производственной практике" — unlikely, but be explicit
        expect(classifySubjectKind('Курсовая работа на практике')).toBe('coursework');
    });
});

describe('getDetailedGradeType', () => {
    it('uses MarkTypeName when present', () => {
        expect(getDetailedGradeType({ MarkTypeName: 'Лабораторная' })).toBe('Лабораторная');
    });

    it('falls back to TypeName, ControlTypeName, WorkTypeName in order', () => {
        expect(getDetailedGradeType({ TypeName: 'Семинар' })).toBe('Семинар');
        expect(getDetailedGradeType({ ControlTypeName: 'РК' })).toBe('РК');
        expect(getDetailedGradeType({ WorkTypeName: 'Курсовая' })).toBe('Курсовая');
    });

    it('maps numeric MarkType: 1 → Текущая, 2 → РК, 3 → Экзамен', () => {
        expect(getDetailedGradeType({ MarkType: 1 })).toBe('Текущая');
        expect(getDetailedGradeType({ MarkType: 2 })).toBe('РК');
        expect(getDetailedGradeType({ MarkType: 3 })).toBe('Экзамен');
    });

    it('falls back to "Оценка" for unknown shapes', () => {
        expect(getDetailedGradeType({})).toBe('Оценка');
        expect(getDetailedGradeType({ MarkType: 99 })).toBe('Оценка');
    });

    it('skips empty strings in named fields', () => {
        expect(getDetailedGradeType({ MarkTypeName: '   ', TypeName: 'Семинар' })).toBe('Семинар');
    });
});

describe('extractDetailedGrades', () => {
    const subjectShell = (overrides: Record<string, unknown> = {}) => ({
        Title: 'Криптография',
        Teacher: 'Иванов И.И.',
        Marks: {},
        ...overrides,
    });

    const markObj = (overrides: Record<string, unknown> = {}) => ({
        Mark: 90,
        MarkType: 1,
        MarkDate: { DisplayedValue: '15-05-2026' },
        ...overrides,
    });

    it('returns [] for non-array input', () => {
        expect(extractDetailedGrades(null as unknown as unknown[])).toEqual([]);
        expect(extractDetailedGrades(undefined as unknown as unknown[])).toEqual([]);
        expect(extractDetailedGrades({} as unknown as unknown[])).toEqual([]);
    });

    it('returns [] for empty array', () => {
        expect(extractDetailedGrades([])).toEqual([]);
    });

    it('skips subjects with no Marks', () => {
        expect(extractDetailedGrades([{ Title: 'X' }])).toEqual([]);
    });

    it('extracts a single mark from a nested month/day structure', () => {
        const data = [
            subjectShell({
                Marks: {
                    '5': {
                        Title: 'Май',
                        Marks: {
                            '15': [markObj({ Mark: 90 })],
                        },
                    },
                },
            }),
        ];
        const result = extractDetailedGrades(data);
        expect(result).toHaveLength(1);
        expect(result[0].mark).toBe(90);
        expect(result[0].date).toBe('15-05-2026');
        expect(result[0].title).toBe('Криптография');
        expect(result[0].teacher).toBe('Иванов И.И.');
    });

    it('skips marks where parseDetailedGradeMark returns null', () => {
        // MarkName with no numeric content yields null.
        const data = [
            subjectShell({
                Marks: {
                    '5': {
                        Marks: {
                            '15': [
                                markObj({ Mark: undefined, MarkName: 'без оценки' }),
                                markObj({ Mark: 75 }),
                            ],
                        },
                    },
                },
            }),
        ];
        const result = extractDetailedGrades(data);
        expect(result).toHaveLength(1);
        expect(result[0].mark).toBe(75);
    });

    it('sorts marks newest-first by DD-MM-YYYY date', () => {
        const data = [
            subjectShell({
                Marks: {
                    '4': {
                        Marks: {
                            '10': [markObj({ Mark: 1, MarkDate: { DisplayedValue: '10-04-2026' } })],
                            '20': [markObj({ Mark: 2, MarkDate: { DisplayedValue: '20-04-2026' } })],
                        },
                    },
                    '5': {
                        Marks: {
                            '15': [markObj({ Mark: 3, MarkDate: { DisplayedValue: '15-05-2026' } })],
                        },
                    },
                },
            }),
        ];
        const result = extractDetailedGrades(data);
        expect(result.map((d) => d.mark)).toEqual([3, 2, 1]);
    });

    it('falls back to {day}-{month}-XXXX when DisplayedValue is missing', () => {
        const data = [
            subjectShell({
                Marks: {
                    '5': {
                        Marks: {
                            '15': [{ Mark: 90, MarkDate: {} }],
                        },
                    },
                },
            }),
        ];
        const result = extractDetailedGrades(data);
        expect(result[0].date).toBe('15-5-XXXX');
    });

    it('skips empty/invalid month or day buckets without throwing', () => {
        const data = [
            subjectShell({
                Marks: {
                    '5': null,
                    '6': { Marks: null },
                    '7': { Marks: { '20': 'not-an-array' } },
                    '8': { Marks: { '25': [markObj({ Mark: 50 })] } },
                },
            }),
        ];
        const result = extractDetailedGrades(data);
        expect(result).toHaveLength(1);
        expect(result[0].mark).toBe(50);
    });

    it('mark-level title/teacher overrides subject-level when present', () => {
        const data = [
            subjectShell({
                Title: 'Subject Title',
                Teacher: 'Subject Teacher',
                Marks: {
                    '5': {
                        Marks: {
                            '15': [markObj({ Mark: 90, Name: 'Mark Title', Teacher: 'Mark Teacher' })],
                        },
                    },
                },
            }),
        ];
        const result = extractDetailedGrades(data);
        expect(result[0].title).toBe('Mark Title');
        expect(result[0].teacher).toBe('Mark Teacher');
    });
});

describe('getDetailedGradeTitle', () => {
    // Field-cascade extractor used to pick a non-empty title from any of 10
    // possible Platonus field names (Name/Title/SubjectName/WorkName/ControlName,
    // both PascalCase and camelCase). Documents the cascade order.

    it('returns null when no fields are set', () => {
        expect(getDetailedGradeTitle({})).toBe(null);
        expect(getDetailedGradeTitle(null)).toBe(null);
        expect(getDetailedGradeTitle(undefined)).toBe(null);
    });

    it('prefers Name (PascalCase) when set', () => {
        expect(getDetailedGradeTitle({ Name: 'PascalName', name: 'camelName' })).toBe('PascalName');
    });

    it('falls back through camelCase + Title + SubjectName + WorkName + ControlName', () => {
        expect(getDetailedGradeTitle({ name: 'camelName' })).toBe('camelName');
        expect(getDetailedGradeTitle({ Title: 'TitleVal' })).toBe('TitleVal');
        expect(getDetailedGradeTitle({ SubjectName: 'SubjectVal' })).toBe('SubjectVal');
        expect(getDetailedGradeTitle({ WorkName: 'WorkVal' })).toBe('WorkVal');
        expect(getDetailedGradeTitle({ ControlName: 'ControlVal' })).toBe('ControlVal');
    });

    it('skips empty + whitespace-only fields and trims the result', () => {
        expect(getDetailedGradeTitle({ Name: '', name: '  realName  ' })).toBe('realName');
        expect(getDetailedGradeTitle({ Name: '   ', Title: 'TitleVal' })).toBe('TitleVal');
    });

    it('skips non-string fields', () => {
        expect(getDetailedGradeTitle({ Name: 42, Title: 'TitleVal' })).toBe('TitleVal');
    });
});

describe('getDetailedGradeMarkTitle', () => {
    // Same pattern as getDetailedGradeTitle but with mark-level field names
    // (LessonTopic, TaskName, etc.). Used per-mark inside detailed grades.

    it('returns null for empty input', () => {
        expect(getDetailedGradeMarkTitle({})).toBe(null);
    });

    it('extracts from LessonTopic / TaskName / Topic cascade', () => {
        expect(getDetailedGradeMarkTitle({ LessonTopic: 'Topic A' })).toBe('Topic A');
        expect(getDetailedGradeMarkTitle({ TaskName: 'Task B' })).toBe('Task B');
        expect(getDetailedGradeMarkTitle({ Topic: 'Just Topic' })).toBe('Just Topic');
    });

    it('Name wins over LessonTopic (earlier in cascade)', () => {
        expect(getDetailedGradeMarkTitle({ Name: 'first', LessonTopic: 'second' })).toBe('first');
    });
});

describe('getDetailedGradeComment', () => {
    // Comment / description / note field on a mark. 8 possible field names.

    it('returns null for empty input', () => {
        expect(getDetailedGradeComment({})).toBe(null);
        expect(getDetailedGradeComment(null)).toBe(null);
    });

    it('extracts Comment / Description / Note / Reason cascade', () => {
        expect(getDetailedGradeComment({ Comment: 'A' })).toBe('A');
        expect(getDetailedGradeComment({ Description: 'B' })).toBe('B');
        expect(getDetailedGradeComment({ Note: 'C' })).toBe('C');
        expect(getDetailedGradeComment({ Reason: 'D' })).toBe('D');
    });

    it('trims whitespace from the result', () => {
        expect(getDetailedGradeComment({ Comment: '  bug fix  ' })).toBe('bug fix');
    });
});

describe('getDetailedGradeMonthLabel', () => {
    // Resolves a human-readable month label for grouping detailed grades by month.
    // Cascade: object fields → Russian month name from numeric key → raw fallback key.
    // This is what surfaces in the UI when users browse detailed marks by month.

    it('extracts MonthName when present', () => {
        expect(getDetailedGradeMonthLabel({ MonthName: 'Сентябрь' }, '9')).toBe('Сентябрь');
    });

    it('falls back to numeric fallbackKey → Russian month name (1-12 → Январь-Декабрь)', () => {
        expect(getDetailedGradeMonthLabel({}, '1')).toBe('Январь');
        expect(getDetailedGradeMonthLabel({}, '9')).toBe('Сентябрь');
        expect(getDetailedGradeMonthLabel({}, '12')).toBe('Декабрь');
    });

    it('locks in all 12 Russian month names (load-bearing for UI display)', () => {
        // Regression guard. A typo in any month name (e.g. "Февраль" → "Февральй") would
        // be silently visible to every user browsing detailed marks for that month.
        const expected = [
            'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
            'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
        ];
        for (let i = 0; i < 12; i += 1) {
            expect(getDetailedGradeMonthLabel({}, String(i + 1))).toBe(expected[i]);
        }
    });

    it('numeric out-of-range falls through to raw fallback key', () => {
        // 0, 13, negative → not a valid month index → raw fallbackKey returned.
        expect(getDetailedGradeMonthLabel({}, '0')).toBe('0');
        expect(getDetailedGradeMonthLabel({}, '13')).toBe('13');
        expect(getDetailedGradeMonthLabel({}, '-1')).toBe('-1');
    });

    it('non-numeric fallbackKey returned verbatim (non-empty)', () => {
        expect(getDetailedGradeMonthLabel({}, 'unknown')).toBe('unknown');
    });

    it('empty fallbackKey + no fields → null', () => {
        expect(getDetailedGradeMonthLabel({}, '')).toBe(null);
    });

    it('Title field takes precedence over numeric fallback (cascade priority)', () => {
        // Documents that object fields beat the fallback even when the fallback would
        // produce a valid Russian month name.
        expect(getDetailedGradeMonthLabel({ Title: 'Specific Period' }, '9')).toBe('Specific Period');
    });
});

describe('resolveCalendarExamDate', () => {
    // Matches a subject to its exam-date event in the Platonus calendar. The match
    // is by normalized code OR normalized name in the event's combined title+description
    // haystack. Used to surface exam dates next to subject cards on the grades page.

    // Platonus calendar events use numeric ms-since-epoch for `start`, NOT ISO strings.
    // The function does `Number(start)` coercion — ISO strings would coerce to NaN and
    // return undefined. Lock in this contract with numeric defaults.
    const examStartMs = new Date('2026-06-15T09:00:00Z').getTime();
    const examEvent = (overrides: Partial<PlatonusCalendarEvent>): PlatonusCalendarEvent => ({
        type: 'exam',
        title: '',
        description: '',
        start: examStartMs,
        ...overrides,
    });

    it('returns undefined when events is null or empty', () => {
        expect(resolveCalendarExamDate('Высшая математика', 'MATH101', null)).toBe(undefined);
        expect(resolveCalendarExamDate('Высшая математика', 'MATH101', [])).toBe(undefined);
    });

    it('matches by subject code in event title', () => {
        const result = resolveCalendarExamDate('Высшая математика', 'MATH101', [
            examEvent({ title: 'Экзамен MATH101' }),
        ]);
        expect(result).toBe(new Date(examStartMs).toISOString());
    });

    it('matches by subject code in event description', () => {
        const result = resolveCalendarExamDate('Высшая математика', 'MATH101', [
            examEvent({ title: 'Экзамен', description: 'Курс MATH101' }),
        ]);
        expect(result).toBeDefined();
    });

    it('matches by subject name when code does NOT match', () => {
        const result = resolveCalendarExamDate('Высшая математика', undefined, [
            examEvent({ title: 'Экзамен Высшая математика' }),
        ]);
        expect(result).toBeDefined();
    });

    it('ignores non-exam events', () => {
        // Skips events whose type is not 'exam' (case-insensitive).
        const result = resolveCalendarExamDate('Math', undefined, [
            examEvent({ type: 'lecture', title: 'Math lecture' }),
            examEvent({ type: 'midterm', title: 'Math midterm' }),
        ]);
        expect(result).toBe(undefined);
    });

    it('event type matches case-insensitively', () => {
        // "Exam" (uppercase) still qualifies because the function lowercases before compare.
        const result = resolveCalendarExamDate('Math', undefined, [
            examEvent({ type: 'Exam', title: 'Math' }),
        ]);
        expect(result).toBeDefined();
    });

    it('returns undefined when no event matches the subject', () => {
        const result = resolveCalendarExamDate('Math', 'MATH', [
            examEvent({ title: 'Physics 101' }),
        ]);
        expect(result).toBe(undefined);
    });

    it('first matching event wins (Array.find semantics)', () => {
        const juneMs = new Date('2026-06-15T09:00:00Z').getTime();
        const julyMs = new Date('2026-07-20T09:00:00Z').getTime();
        const result = resolveCalendarExamDate('Math', undefined, [
            examEvent({ title: 'Math', start: juneMs }),
            examEvent({ title: 'Math retake', start: julyMs }),
        ]);
        // First match wins → June, not July.
        expect(result).toBe(new Date(juneMs).toISOString());
    });

    it('returns undefined when matched event has no start', () => {
        const result = resolveCalendarExamDate('Math', undefined, [
            examEvent({ title: 'Math', start: undefined }),
        ]);
        expect(result).toBe(undefined);
    });

    it('returns undefined when matched event start is non-finite number', () => {
        const result = resolveCalendarExamDate('Math', undefined, [
            examEvent({ title: 'Math', start: NaN }),
        ]);
        expect(result).toBe(undefined);
    });

    it('accepts numeric start (ms-since-epoch)', () => {
        const ms = new Date('2026-06-15T09:00:00Z').getTime();
        const result = resolveCalendarExamDate('Math', undefined, [
            examEvent({ title: 'Math', start: ms }),
        ]);
        expect(result).toBe(new Date(ms).toISOString());
    });

    it('returns undefined when empty subjectName + no code (no normalized strings to match against)', () => {
        // Edge case: normalizeExamMatchValue('') = '', so both normalizedCode and
        // normalizedName are empty → match condition fails for all events.
        const result = resolveCalendarExamDate('', undefined, [
            examEvent({ title: 'Any exam' }),
        ]);
        expect(result).toBe(undefined);
    });
});

describe('getDetailedGradeTeacher', () => {
    // Field-cascade extractor for the teacher name at the subject level. Walks 12
    // possible field names (Teacher/teacher/TeacherName/.../EmployeeName/employeeName)
    // to find the first non-empty string. Powers the teacher-attribution display
    // next to each detailed grade.

    it('returns null when no fields are set', () => {
        expect(getDetailedGradeTeacher({})).toBe(null);
        expect(getDetailedGradeTeacher(null)).toBe(null);
        expect(getDetailedGradeTeacher(undefined)).toBe(null);
    });

    it('prefers Teacher (PascalCase) over later cascade entries', () => {
        expect(getDetailedGradeTeacher({ Teacher: 'PascalCase', teacher: 'camelCase' })).toBe('PascalCase');
    });

    it('falls back through the full cascade order', () => {
        expect(getDetailedGradeTeacher({ teacher: 'B' })).toBe('B');
        expect(getDetailedGradeTeacher({ TeacherName: 'C' })).toBe('C');
        expect(getDetailedGradeTeacher({ TutorFullName: 'D' })).toBe('D');
        expect(getDetailedGradeTeacher({ TutorName: 'E' })).toBe('E');
        expect(getDetailedGradeTeacher({ Tutor: 'F' })).toBe('F');
        expect(getDetailedGradeTeacher({ EmployeeName: 'G' })).toBe('G');
    });

    it('skips whitespace-only and non-string entries', () => {
        expect(getDetailedGradeTeacher({ Teacher: '   ', teacher: 'real' })).toBe('real');
        expect(getDetailedGradeTeacher({ Teacher: 42, teacher: 'real' })).toBe('real');
    });

    it('trims the result', () => {
        expect(getDetailedGradeTeacher({ Teacher: '  Иванов И.И.  ' })).toBe('Иванов И.И.');
    });
});

describe('getDetailedGradeMarkTeacher', () => {
    // Same cascade pattern as getDetailedGradeTeacher BUT scoped to per-mark
    // teacher fields. Adds CreatedByName/createdByName/CreatedEmployeeName/
    // createdEmployeeName to the search list (these only appear on individual
    // marks, not at the subject level).

    it('returns null when no fields are set', () => {
        expect(getDetailedGradeMarkTeacher({})).toBe(null);
    });

    it('extracts standard Teacher field', () => {
        expect(getDetailedGradeMarkTeacher({ Teacher: 'Иванов' })).toBe('Иванов');
    });

    it('supports per-mark CreatedByName field (not in subject-level cascade)', () => {
        // Locks in the contract: marks can carry "who entered the mark" via
        // CreatedByName which a subject-level teacher field wouldn't have.
        expect(getDetailedGradeMarkTeacher({ CreatedByName: 'Sub Teacher' })).toBe('Sub Teacher');
    });

    it('Teacher wins over CreatedByName (earlier in cascade)', () => {
        // Documents the priority: the explicit Teacher attribution beats the
        // creator-attribution metadata.
        expect(getDetailedGradeMarkTeacher({ Teacher: 'Main', CreatedByName: 'Substitute' })).toBe('Main');
    });

    it('skips empty entries and trims result', () => {
        expect(getDetailedGradeMarkTeacher({ Teacher: '', teacher: '  Петров  ' })).toBe('Петров');
    });
});
