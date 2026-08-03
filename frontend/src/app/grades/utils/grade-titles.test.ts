import { describe, it, expect } from 'vitest';
import { getReadableDetailedGradeTitle, extractAcademicCodeParts, humanizeAcademicSuffix } from './grade-titles';
import type { DetailedPlatonusGrade, PlatonusSubjectGrade } from '@/lib/api';

const subject = (overrides: Partial<PlatonusSubjectGrade> = {}): PlatonusSubjectGrade => ({
    code: 'KRIP-1',
    name: 'Криптография',
    rk1: '',
    rk2: '',
    exam: '',
    total: '',
    ...overrides,
});

const detailed = (overrides: Partial<DetailedPlatonusGrade> = {}): DetailedPlatonusGrade => ({
    date: '',
    mark: 0,
    title: '',
    ...overrides,
});

describe('getReadableDetailedGradeTitle', () => {
    describe('when title is empty/missing', () => {
        it('falls back to type when set', () => {
            expect(getReadableDetailedGradeTitle(detailed({ title: '', type: 'РК 1' }), subject(), 'ru')).toBe('РК 1');
        });

        it('falls back to subject name when type missing', () => {
            expect(getReadableDetailedGradeTitle(detailed({ title: '' }), subject({ name: 'Физика' }), 'ru')).toBe('Физика');
        });

        it('trims whitespace-only title as empty', () => {
            expect(getReadableDetailedGradeTitle(detailed({ title: '   ', type: 'РК 2' }), subject(), 'ru')).toBe('РК 2');
        });
    });

    describe('when title has no academic suffix', () => {
        it('returns the raw title unchanged', () => {
            expect(getReadableDetailedGradeTitle(detailed({ title: 'Текущая оценка' }), subject(), 'ru')).toBe('Текущая оценка');
        });

        it('trims the raw title before returning', () => {
            expect(getReadableDetailedGradeTitle(detailed({ title: '  Что-то  ' }), subject(), 'ru')).toBe('Что-то');
        });
    });

    describe('when title has an academic suffix', () => {
        // The function maps `Foo--SRSP` / `Foo--Lab` / `Foo--P` / `Foo--L` → a localized label.

        it.each([
            ['SRSP', 'ru', 'СРСП'],
            ['SRSP', 'kz', 'Оқытушымен СӨЖ'],
            ['SRSP', 'en', 'SRSP'],
            ['Lab', 'ru', 'Лабораторная работа'],
            ['Lab', 'kz', 'Зертханалық жұмыс'],
            ['Lab', 'en', 'Lab work'],
            ['P', 'ru', 'Практика'],
            ['P', 'kz', 'Практика'],
            ['P', 'en', 'Practice'],
            ['L', 'ru', 'Лекция'],
            ['L', 'kz', 'Дәріс'],
            ['L', 'en', 'Lecture'],
        ] as const)('replaces "--%s" suffix with localized label (%s)', (suffix, language, expected) => {
            const title = `KRIP-3220-11--${suffix}`;
            const result = getReadableDetailedGradeTitle(detailed({ title }), subject(), language);
            expect(result).toBe(expected);
        });

        it('handles single-dash separator', () => {
            const result = getReadableDetailedGradeTitle(detailed({ title: 'KRIP-3220-SRSP' }), subject(), 'ru');
            expect(result).toBe('СРСП');
        });

        it('suffix match is case-insensitive', () => {
            expect(getReadableDetailedGradeTitle(detailed({ title: 'X--srsp' }), subject(), 'ru')).toBe('СРСП');
            expect(getReadableDetailedGradeTitle(detailed({ title: 'X--LAB' }), subject(), 'ru')).toBe('Лабораторная работа');
        });

        it('unknown suffix (e.g. Z) is preserved as raw title (no match)', () => {
            // Regex only matches SRSP|Lab|P|L (case-insensitive). Anything else doesn't match
            // → title passes through unchanged.
            const result = getReadableDetailedGradeTitle(detailed({ title: 'X--Z' }), subject(), 'ru');
            expect(result).toBe('X--Z');
        });

        it('returns raw title when suffix is at the start (regex needs a base before suffix)', () => {
            // The regex `^(.*?)(?:--?)(SRSP|...)$` requires anything (possibly empty) before the dash.
            // Pure suffix `SRSP` has no dash → no match → raw passes through.
            expect(getReadableDetailedGradeTitle(detailed({ title: 'SRSP' }), subject(), 'ru')).toBe('SRSP');
        });

        it('returns just the label, not base+label', () => {
            // Implementation explicitly discards the base part — only the humanized suffix is returned.
            const result = getReadableDetailedGradeTitle(detailed({ title: 'Some long course name--SRSP' }), subject(), 'en');
            expect(result).toBe('SRSP'); // EN label for SRSP
        });
    });
});

describe('extractAcademicCodeParts', () => {
    // Splits an academic title like "ETK 1110-60--SRSP" into base + suffix.
    // The base is the course code, the suffix indicates the lesson type
    // (SRSP/Lab/P/L). Used to humanize lesson titles in detailed-grades view.

    it('returns empty base + null suffix for empty/null input', () => {
        expect(extractAcademicCodeParts(null)).toEqual({ base: '', suffix: null });
        expect(extractAcademicCodeParts(undefined)).toEqual({ base: '', suffix: null });
        expect(extractAcademicCodeParts('')).toEqual({ base: '', suffix: null });
    });

    it('extracts SRSP suffix from --SRSP format', () => {
        expect(extractAcademicCodeParts('ETK 1110-60--SRSP')).toEqual({
            base: 'ETK 1110-60',
            suffix: 'SRSP',
        });
    });

    it('extracts Lab suffix from --Lab format (uppercases)', () => {
        expect(extractAcademicCodeParts('PHYS-101--Lab')).toEqual({
            base: 'PHYS-101',
            suffix: 'LAB',
        });
    });

    it('accepts single-dash separator (-SRSP)', () => {
        // The regex allows either `--` or `-` before the suffix.
        const result = extractAcademicCodeParts('KRIP-3220-SRSP');
        expect(result.suffix).toBe('SRSP');
        // Base strips trailing dashes/whitespace.
        expect(result.base).toBe('KRIP-3220');
    });

    it('case-insensitive suffix detection (lowercase "srsp" matches)', () => {
        expect(extractAcademicCodeParts('course--srsp').suffix).toBe('SRSP');
        expect(extractAcademicCodeParts('course--lab').suffix).toBe('LAB');
    });

    it('unknown suffix returns null with trimmed base', () => {
        // "UNKNOWN" is not in the SRSP|Lab|P|L set → no match.
        const result = extractAcademicCodeParts('course--UNKNOWN');
        expect(result.suffix).toBe(null);
        expect(result.base).toBe('course--UNKNOWN');
    });

    it('trims surrounding whitespace from input', () => {
        const result = extractAcademicCodeParts('  ETK 1110-60--SRSP  ');
        expect(result.base).toBe('ETK 1110-60');
        expect(result.suffix).toBe('SRSP');
    });

    it('strips trailing dashes + spaces from base', () => {
        // The base post-process regex /[-\s]+$/ cleans up the trailing separator.
        expect(extractAcademicCodeParts('CODE  -  --P').base).toBe('CODE');
    });

    it('returns single-letter suffixes P + L', () => {
        // The 4-letter set includes single-letter codes "P" (practice) and "L" (lecture).
        expect(extractAcademicCodeParts('CODE--P').suffix).toBe('P');
        expect(extractAcademicCodeParts('CODE--L').suffix).toBe('L');
    });

    it('returns trimmed value as base when no suffix matches at all', () => {
        // No "--" or "-" separator before a recognized suffix → entire string is base.
        expect(extractAcademicCodeParts('Just a name')).toEqual({
            base: 'Just a name',
            suffix: null,
        });
    });
});

describe('humanizeAcademicSuffix', () => {
    // Maps the parsed suffix (uppercase) to a language-aware label.

    it('returns null for null suffix', () => {
        expect(humanizeAcademicSuffix(null, 'ru')).toBe(null);
    });

    it('SRSP → Russian "СРСП"', () => {
        expect(humanizeAcademicSuffix('SRSP', 'ru')).toBe('СРСП');
    });

    it('SRSP → Kazakh "Оқытушымен СӨЖ"', () => {
        expect(humanizeAcademicSuffix('SRSP', 'kz')).toBe('Оқытушымен СӨЖ');
    });

    it('SRSP → English "SRSP" (no translation, the term is universal)', () => {
        expect(humanizeAcademicSuffix('SRSP', 'en')).toBe('SRSP');
    });

    it('LAB → "Лабораторная работа" / "Зертханалық жұмыс" / "Lab work"', () => {
        expect(humanizeAcademicSuffix('LAB', 'ru')).toBe('Лабораторная работа');
        expect(humanizeAcademicSuffix('LAB', 'kz')).toBe('Зертханалық жұмыс');
        expect(humanizeAcademicSuffix('LAB', 'en')).toBe('Lab work');
    });

    it('P → "Практика" in RU + KZ, "Practice" in EN', () => {
        expect(humanizeAcademicSuffix('P', 'ru')).toBe('Практика');
        expect(humanizeAcademicSuffix('P', 'kz')).toBe('Практика');
        expect(humanizeAcademicSuffix('P', 'en')).toBe('Practice');
    });

    it('L → "Лекция" / "Дәріс" / "Lecture"', () => {
        expect(humanizeAcademicSuffix('L', 'ru')).toBe('Лекция');
        expect(humanizeAcademicSuffix('L', 'kz')).toBe('Дәріс');
        expect(humanizeAcademicSuffix('L', 'en')).toBe('Lecture');
    });

    it('unknown suffix returns input verbatim (no translation, no crash)', () => {
        // Defensive: a future KSTU suffix we don't know about passes through.
        expect(humanizeAcademicSuffix('XYZ', 'ru')).toBe('XYZ');
    });
});
