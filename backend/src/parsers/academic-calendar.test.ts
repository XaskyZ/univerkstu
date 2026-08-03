import { describe, it, expect } from 'vitest';
import { classifyPeriod, extractField, normalizeText, parseDate, toDate } from './academic-calendar.js';

describe('normalizeText', () => {
    it('collapses whitespace', () => {
        expect(normalizeText('  foo   bar\n\tbaz  ')).toBe('foo bar baz');
    });

    it('returns empty string for whitespace-only input', () => {
        expect(normalizeText('   \n\t  ')).toBe('');
    });
});

describe('parseDate', () => {
    it('parses dd.mm.yyyy', () => {
        const date = parseDate('15.01.2026');
        expect(date).not.toBeNull();
        expect(date?.getFullYear()).toBe(2026);
        expect(date?.getMonth()).toBe(0); // January
        expect(date?.getDate()).toBe(15);
    });

    it('returns null for non-matching format', () => {
        expect(parseDate('2026-01-15')).toBeNull();
        expect(parseDate('15/01/2026')).toBeNull();
        expect(parseDate('not a date')).toBeNull();
    });

    it('returns null for shape-matching but invalid components (rolls over)', () => {
        // Note: JS Date constructor rolls over invalid days, so 31.02.2025 becomes 03.03.2025.
        // We document the current behavior; if we ever reject those, this test changes.
        const rolled = parseDate('31.02.2025');
        expect(rolled?.getMonth()).toBe(2); // March (rolled over from invalid Feb 31)
    });
});

describe('classifyPeriod', () => {
    it('classifies semester wrapper label', () => {
        expect(classifyPeriod('Период')).toBe('semester');
        expect(classifyPeriod('период')).toBe('semester');
    });

    it('classifies theoretical study', () => {
        expect(classifyPeriod('Теоретическое обучение')).toBe('theory');
        expect(classifyPeriod('теоретическое обучение по плану')).toBe('theory');
    });

    it('classifies midterms', () => {
        expect(classifyPeriod('Рубежный контроль 1')).toBe('midterm_1');
        expect(classifyPeriod('Рубежный контроль 2')).toBe('midterm_2');
    });

    it('classifies state exams', () => {
        expect(classifyPeriod('Государственные экзамены')).toBe('state_exams');
    });

    it('classifies regular exam session', () => {
        expect(classifyPeriod('Экзаменационная сессия')).toBe('exams');
    });

    it('classifies practice', () => {
        expect(classifyPeriod('Практика')).toBe('practice');
        expect(classifyPeriod('практика')).toBe('practice');
    });

    it('classifies practice grading separately from practice', () => {
        expect(classifyPeriod('Проставление баллов за практику')).toBe('practice_grading');
    });

    it('classifies vacation (any "каникул" variant, case-insensitive)', () => {
        expect(classifyPeriod('Каникулы')).toBe('vacation');
        expect(classifyPeriod('каникулы')).toBe('vacation');
        expect(classifyPeriod('Зимние каникулы')).toBe('vacation');
    });

    it('falls back to other for unrecognized labels', () => {
        expect(classifyPeriod('Неизвестный период')).toBe('other');
        expect(classifyPeriod('')).toBe('other');
    });
});

describe('toDate', () => {
    it('returns null for null input', () => {
        expect(toDate(null)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(toDate('')).toBeNull();
    });

    it('delegates valid date strings to parseDate', () => {
        const date = toDate('15.01.2026');
        expect(date).not.toBeNull();
        expect(date?.getFullYear()).toBe(2026);
        expect(date?.getMonth()).toBe(0);
        expect(date?.getDate()).toBe(15);
    });

    it('returns null for non-matching format (parseDate semantics)', () => {
        expect(toDate('not a date')).toBeNull();
        expect(toDate('2026-01-15')).toBeNull();
    });
});

describe('classifyPeriod (additional edge cases)', () => {
    it('does NOT trim — strict-equality branches ("период"/"практика") need exact match', () => {
        // Documenting current behavior: `classifyPeriod` only lowercases, no trim.
        // The 'период' and 'практика' branches use === so whitespace breaks them.
        // The substring branches (`.includes(...)`) would still work though.
        expect(classifyPeriod('  Период  ')).toBe('other');
        expect(classifyPeriod('  практика  ')).toBe('other');
        // Substring-based branches DO tolerate surrounding whitespace.
        expect(classifyPeriod('  Теоретическое обучение  ')).toBe('theory');
    });

    it('case-insensitive: uppercase variants match', () => {
        expect(classifyPeriod('РУБЕЖНЫЙ КОНТРОЛЬ 1')).toBe('midterm_1');
        expect(classifyPeriod('РУБЕЖНЫЙ КОНТРОЛЬ 2')).toBe('midterm_2');
    });

    it('practice_grading takes precedence over plain practice when "проставление" present', () => {
        // The order matters in the implementation — if practice_grading were checked
        // after practice, "Проставление баллов за практику" would be classified as practice.
        expect(classifyPeriod('Проставление баллов за практику')).toBe('practice_grading');
        expect(classifyPeriod('ПРОСТАВЛЕНИЕ БАЛЛОВ за практику')).toBe('practice_grading');
    });
});

describe('extractField', () => {
    // Used to pull labeled fields from the academic-calendar header text.

    it('returns null when label is absent', () => {
        expect(extractField('Random text without labels', 'Форма обучения')).toBeNull();
    });

    it('extracts value at end of string', () => {
        expect(extractField('Форма обучения: Очная', 'Форма обучения')).toBe('Очная');
    });

    it('stops at the next Cyrillic-uppercase labeled field (default stopPattern)', () => {
        const text = 'Форма обучения: Очная Специальность: ИТ-23';
        expect(extractField(text, 'Форма обучения')).toBe('Очная');
        expect(extractField(text, 'Специальность')).toBe('ИТ-23');
    });

    it('stops at a "N Семестр" boundary (fire-152 fix: now actually fires for Cyrillic)', () => {
        // Before the fix, `Семестр\b` never matched after Cyrillic "р" because JS regex
        // `\b` is ASCII-only. Replaced with `Семестр(?=\s|$)` — locks in correct behavior.
        const text = 'Форма обучения: Очная 1 Семестр Биология';
        expect(extractField(text, 'Форма обучения')).toBe('Очная');
    });

    it('stops at "N Семестр" at end-of-string', () => {
        const text = 'Форма обучения: Очная   1 Семестр';
        expect(extractField(text, 'Форма обучения')).toBe('Очная');
    });

    it('honors a custom stopLabels list (overrides the default Cyrillic-uppercase pattern)', () => {
        // When stopLabels is provided, only those exact labels stop the capture — so a
        // generic "Foo:" wouldn't terminate.
        const text = 'Форма обучения: Очная Специальность: ИТ-23 Курс: 3';
        expect(extractField(text, 'Форма обучения', ['Курс'])).toBe('Очная Специальность: ИТ-23');
    });

    it('escapes regex metacharacters in label AND in stopLabels', () => {
        // Both `escaped` (label) and the stopLabels list apply the same metachar escape.
        const text = '(test): foo (other): bar';
        expect(extractField(text, '(test)', ['(other)'])).toBe('foo');
    });

    it('trims leading/trailing whitespace from the captured value', () => {
        const text = 'Форма обучения:    Очная    Специальность: ИТ';
        expect(extractField(text, 'Форма обучения')).toBe('Очная');
    });

    it('captures multi-word values', () => {
        const text = 'Уровень/направление обучения: Высшее образование (бакалавриат) Специальность: ИТ';
        expect(extractField(text, 'Уровень/направление обучения')).toBe('Высшее образование (бакалавриат)');
    });

    it('default stopPattern includes Kazakh-letter start `#` (used for special markers)', () => {
        // The default stopPattern is `[А-ЯA-Z#][^:]+:` — including `#` so e.g. "#Заметка:"
        // would stop the capture. Locks in that escape hatch.
        const text = 'Форма обучения: Очная #Заметка: внимание';
        expect(extractField(text, 'Форма обучения')).toBe('Очная');
    });
});
