import { describe, it, expect } from 'vitest';
import { detectAccentType } from './LessonCard';

describe('detectAccentType', () => {
    it('returns "other" for null/empty input', () => {
        expect(detectAccentType(null)).toBe('other');
        expect(detectAccentType('')).toBe('other');
    });

    describe('lecture detection', () => {
        it('matches "Лекция" (Russian full form, capitalized)', () => {
            expect(detectAccentType('Лекция')).toBe('lecture');
            expect(detectAccentType('ЛЕКЦИЯ')).toBe('lecture');
        });

        it('matches "lecture" (English)', () => {
            expect(detectAccentType('Lecture')).toBe('lecture');
            expect(detectAccentType('LECTURE')).toBe('lecture');
        });

        it('matches "лек" short prefix (Russian abbreviated)', () => {
            expect(detectAccentType('лек.')).toBe('lecture');
        });
    });

    describe('seminar detection', () => {
        it('matches "Семинар" / "seminar"', () => {
            expect(detectAccentType('Семинар')).toBe('seminar');
            expect(detectAccentType('seminar')).toBe('seminar');
            expect(detectAccentType('Сем.')).toBe('seminar');
        });
    });

    describe('laboratory detection', () => {
        it('matches "Лабораторное занятие" / "Laboratory" / "Lab"', () => {
            expect(detectAccentType('Лабораторное занятие')).toBe('laboratory');
            expect(detectAccentType('Laboratory')).toBe('laboratory');
            expect(detectAccentType('Lab')).toBe('laboratory');
            expect(detectAccentType('лаб')).toBe('laboratory');
        });
    });

    describe('practice detection', () => {
        it('matches "Практика" / "practice"', () => {
            expect(detectAccentType('Практика')).toBe('practice');
            expect(detectAccentType('practice')).toBe('practice');
            expect(detectAccentType('практ')).toBe('practice');
            expect(detectAccentType('Практическое занятие')).toBe('practice');
        });
    });

    describe('SRSP detection', () => {
        it('matches "СРСП" / "srsp" case-insensitively', () => {
            expect(detectAccentType('СРСП')).toBe('srsp');
            expect(detectAccentType('срсп')).toBe('srsp');
            expect(detectAccentType('SRSP')).toBe('srsp');
            expect(detectAccentType('srsp')).toBe('srsp');
        });

        it('matches when SRSP appears inside longer phrases', () => {
            expect(detectAccentType('СРСП по физике')).toBe('srsp');
        });
    });

    describe('detection ORDER (priority traps)', () => {
        it('lecture wins over seminar when both appear', () => {
            // The function uses a chain of `if (...some(includes))` — earlier branches win.
            // Locking that in: a "Лекция / Семинар" type string maps to lecture.
            expect(detectAccentType('Лекция / Семинар')).toBe('lecture');
        });

        it('seminar wins over laboratory when both appear', () => {
            expect(detectAccentType('Семинар + Лабораторное')).toBe('seminar');
        });

        it('laboratory wins over practice', () => {
            expect(detectAccentType('Лаб + Практ')).toBe('laboratory');
        });

        it('SRSP is checked AFTER the 4 main types', () => {
            // The standard 4 types win even if "срсп" appears alongside.
            expect(detectAccentType('Лекция (срсп)')).toBe('lecture');
        });
    });

    describe('false-positive checks (substring traps)', () => {
        it('the short Russian "лек" prefix DOES match non-lecture words that contain it (documented behavior)', () => {
            // 'лек' is used as a 3-letter abbreviation marker for "Лек.". But it's a
            // substring check, so words containing "лек" anywhere will match — e.g.
            // hypothetical lesson titles. Documenting that this is by design (the
            // function is meant for the `lesson.type` field, which Univer uses with
            // a controlled vocabulary, not freeform titles).
            expect(detectAccentType('пролекция')).toBe('lecture');
            expect(detectAccentType('коллектив')).toBe('lecture'); // 'кoлЛЕКтив' contains 'лек'
        });

        it('returns "other" for unknown type strings', () => {
            expect(detectAccentType('Зачёт')).toBe('other');
            expect(detectAccentType('Экзамен')).toBe('other');
            expect(detectAccentType('Random')).toBe('other');
        });
    });
});
