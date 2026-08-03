import { describe, it, expect } from 'vitest';
import {
    cleanText,
    normalizeLabel,
    normalizeSectionTitle,
    parseCourseValue,
    parseEducPlanValue,
    parseIntSafe,
    parseNumberSafe,
    sectionKey,
    pickSectionValue,
    pickEducationSectionValue,
    readPairTableSummary,
    type ProfileSection,
    type StudentQuestionnaire,
} from './profile.js';

describe('cleanText', () => {
    it('returns empty string for null/undefined', () => {
        expect(cleanText(null)).toBe('');
        expect(cleanText(undefined)).toBe('');
    });

    it('replaces non-breaking spaces with regular spaces', () => {
        expect(cleanText('Имя Фамилия')).toBe('Имя Фамилия');
    });

    it('collapses runs of whitespace and trims', () => {
        expect(cleanText('   foo\t\n  bar   ')).toBe('foo bar');
    });
});

describe('normalizeSectionTitle', () => {
    it('drops trailing colon', () => {
        expect(normalizeSectionTitle('Образование:')).toBe('Образование');
    });

    it('drops Chinese-style fullwidth colon', () => {
        expect(normalizeSectionTitle('Контакты：')).toBe('Контакты');
    });

    it('replaces underscores with spaces', () => {
        expect(normalizeSectionTitle('Личные_данные')).toBe('Личные данные');
    });
});

describe('normalizeLabel', () => {
    it('drops bullet markers at start (•, ·, -)', () => {
        expect(normalizeLabel('• Телефон:')).toBe('Телефон');
        expect(normalizeLabel('- Email:')).toBe('Email');
        expect(normalizeLabel('· Адрес:')).toBe('Адрес');
    });

    it('does NOT drop em-dash at start (current behaviour)', () => {
        // The bullet regex covers •, ·, hyphen-minus and U+2022.
        // Em-dash (U+2014) and en-dash (U+2013) currently pass through.
        expect(normalizeLabel('— Email:')).toBe('— Email');
    });

    it('drops trailing colon', () => {
        expect(normalizeLabel('ФИО:')).toBe('ФИО');
    });

    it('keeps content as-is when no decoration', () => {
        expect(normalizeLabel('Группа')).toBe('Группа');
    });
});

describe('sectionKey', () => {
    it('lowercases and slugifies', () => {
        expect(sectionKey('Образование')).toBe('образование');
        expect(sectionKey('Личные данные')).toBe('личные_данные');
    });

    it('strips leading and trailing underscores', () => {
        expect(sectionKey('  Контакты  ')).toBe('контакты');
        expect(sectionKey('___test___')).toBe('test');
    });

    it('keeps digits and trims fullwidth colon', () => {
        expect(sectionKey('Курс 1:')).toBe('курс_1');
    });
});

describe('parseIntSafe', () => {
    it('returns 0 for empty/null', () => {
        expect(parseIntSafe(null)).toBe(0);
        expect(parseIntSafe('')).toBe(0);
        expect(parseIntSafe('   ')).toBe(0);
    });

    it('parses leading integer in mixed text', () => {
        expect(parseIntSafe('Курс 3 семестр')).toBe(3);
        expect(parseIntSafe('Всего: 12345 студентов')).toBe(12345);
    });

    it('parses negative numbers', () => {
        expect(parseIntSafe('-5')).toBe(-5);
    });

    it('returns 0 when no digits present', () => {
        expect(parseIntSafe('никакого числа')).toBe(0);
    });
});

describe('parseNumberSafe', () => {
    it('returns null for empty/null', () => {
        expect(parseNumberSafe(null)).toBeNull();
        expect(parseNumberSafe('')).toBeNull();
        expect(parseNumberSafe('   ')).toBeNull();
    });

    it('parses fractional numbers with comma decimal', () => {
        expect(parseNumberSafe('GPA: 3,75')).toBe(3.75);
    });

    it('parses fractional numbers with dot decimal', () => {
        expect(parseNumberSafe('3.14')).toBe(3.14);
    });

    it('parses integers', () => {
        expect(parseNumberSafe('100')).toBe(100);
    });

    it('parses negatives', () => {
        expect(parseNumberSafe('-1,5')).toBe(-1.5);
    });

    it('returns null when no number present', () => {
        expect(parseNumberSafe('—')).toBeNull();
    });
});

describe('parseCourseValue', () => {
    it('returns null for null/empty', () => {
        expect(parseCourseValue(null)).toBeNull();
        expect(parseCourseValue('')).toBeNull();
    });

    it('extracts first integer', () => {
        expect(parseCourseValue('3 курс')).toBe(3);
        expect(parseCourseValue('Курс №2')).toBe(2);
    });

    it('returns null when text has no digits', () => {
        expect(parseCourseValue('бакалавр')).toBeNull();
    });
});

describe('parseEducPlanValue', () => {
    // This regex-based extractor is the heart of the educ-plan parser.
    // The lookahead chain stops the captured value when it hits the next labeled field,
    // a "N Семестр" boundary, or end-of-string.

    it('returns null when label is absent', () => {
        expect(parseEducPlanValue('Some random text', 'Форма обучения')).toBeNull();
    });

    it('extracts value followed by end-of-string', () => {
        expect(parseEducPlanValue('Форма обучения: Очная', 'Форма обучения')).toBe('Очная');
    });

    it('stops the captured value at the next labeled Cyrillic field', () => {
        // The lookahead `\s+[А-ЯA-ZЁІҚҢҒҮҰӨҺ][^:]{1,60}:` cuts off when the next field starts.
        const text = 'Форма обучения: Очная Специальность: ИТ-23';
        expect(parseEducPlanValue(text, 'Форма обучения')).toBe('Очная');
        expect(parseEducPlanValue(text, 'Специальность')).toBe('ИТ-23');
    });

    it('stops the captured value at the next labeled Latin field', () => {
        const text = 'Форма обучения: Очная English: hello';
        expect(parseEducPlanValue(text, 'Форма обучения')).toBe('Очная');
    });

    it('stops the captured value at a Kazakh-letter field (Қ, Ң, Ғ, etc.)', () => {
        // The lookahead character class includes the Kazakh-specific uppercase letters.
        // Important so that a Kazakh-localized edu-plan still gets parsed correctly.
        const text = 'Форма обучения: Очная Қазақ тілі: ілмек';
        expect(parseEducPlanValue(text, 'Форма обучения')).toBe('Очная');
    });

    it('stops the captured value at a "N Семестр" boundary', () => {
        const text = 'Форма обучения: Очная 1 Семестр Введение';
        expect(parseEducPlanValue(text, 'Форма обучения')).toBe('Очная');
    });

    it('captures multi-word values verbatim until the boundary', () => {
        const text = 'Уровень/направление обучения: Высшее образование (бакалавриат) Специальность: ИТ-23';
        expect(parseEducPlanValue(text, 'Уровень/направление обучения')).toBe('Высшее образование (бакалавриат)');
    });

    it('escapes regex metacharacters in the label (defense against malicious labels)', () => {
        // The function uses `label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` to escape.
        // A hypothetical label containing parens or dots should still match literally.
        const text = '(тест): значение Foo: bar';
        expect(parseEducPlanValue(text, '(тест)')).toBe('значение');
    });

    it('trims surrounding whitespace from the captured value', () => {
        const text = 'Форма обучения:    Очная   1 Семестр';
        expect(parseEducPlanValue(text, 'Форма обучения')).toBe('Очная');
    });

    it('handles Cyrillic labels with spaces verbatim', () => {
        const text = 'Иностранный язык: Английский Специальность: ИТ-23';
        expect(parseEducPlanValue(text, 'Иностранный язык')).toBe('Английский');
    });
});

describe('pickSectionValue', () => {
    // Walks the parsed profile sections (questionnaire) looking for the first
    // matching (section, label) pair. Returns the entry value (or null if no
    // match anywhere). This is the foundation that drives all 30+ questionnaire
    // field extractions — a regression here would silently empty out the entire
    // student questionnaire display in the admin panel.

    const sections: ProfileSection[] = [
        {
            key: 'student',
            title: 'Студент',
            entries: [
                { label: 'Фамилия', value: 'Иванов' },
                { label: 'Имя', value: 'Иван' },
                { label: 'Отчество', value: 'Иванович' },
            ],
        },
        {
            key: 'education_info',
            title: 'Учебная информация',
            entries: [
                { label: 'Форма оплаты', value: 'Грант' },
                { label: 'Специализация', value: 'ИТ' },
            ],
        },
    ];

    it('finds entry by section+label match', () => {
        const result = pickSectionValue(
            sections,
            (title, _key) => title === 'Студент',
            (label) => label === 'Фамилия',
        );
        expect(result).toBe('Иванов');
    });

    it('section matcher receives (title, key) — both can be used', () => {
        // The matcher gets both, so callers can match by key (more stable across
        // KSTU title changes) OR title (case-sensitive substring).
        const result = pickSectionValue(
            sections,
            (_title, key) => key === 'student',
            (label) => label === 'Имя',
        );
        expect(result).toBe('Иван');
    });

    it('returns null when no section matches', () => {
        const result = pickSectionValue(
            sections,
            (title, _key) => title === 'NonExistent',
            (_label) => true,
        );
        expect(result).toBe(null);
    });

    it('returns null when section matches but no label matches', () => {
        const result = pickSectionValue(
            sections,
            (title, _key) => title === 'Студент',
            (label) => label === 'NotARealLabel',
        );
        expect(result).toBe(null);
    });

    it('returns FIRST match (does not search further sections)', () => {
        // Documents the first-match semantics — important when KSTU sometimes
        // duplicates a label across sections (e.g., "Имя" could appear in both
        // student-info and parent-info; we want student-info first).
        const duplicates: ProfileSection[] = [
            {
                key: 'first',
                title: 'First',
                entries: [{ label: 'Имя', value: 'A' }],
            },
            {
                key: 'second',
                title: 'Second',
                entries: [{ label: 'Имя', value: 'B' }],
            },
        ];
        const result = pickSectionValue(
            duplicates,
            (_title, _key) => true, // both match
            (label) => label === 'Имя',
        );
        expect(result).toBe('A');
    });

    it('skips sections that fail sectionMatcher entirely', () => {
        // Even if a non-matching section has the label, it must NOT be considered.
        const result = pickSectionValue(
            sections,
            (_title, key) => key === 'education_info', // only education_info
            (label) => label === 'Фамилия', // exists in 'student' section only
        );
        expect(result).toBe(null);
    });

    it('returns null when value is empty string (the `entry.value || null` fallthrough)', () => {
        // Subtle: the function uses `entry.value || null`, so an empty-string value
        // is treated as missing (returns null), causing the search to STOP at the
        // first matching label (no continuation to other sections).
        const withEmpty: ProfileSection[] = [
            {
                key: 'a',
                title: 'A',
                entries: [{ label: 'X', value: '' }],
            },
            {
                key: 'b',
                title: 'B',
                entries: [{ label: 'X', value: 'real' }],
            },
        ];
        const result = pickSectionValue(
            withEmpty,
            (_title, _key) => true,
            (label) => label === 'X',
        );
        expect(result).toBe(null);
    });

    it('empty sections array → null', () => {
        const result = pickSectionValue([], (_title, _key) => true, (_label) => true);
        expect(result).toBe(null);
    });
});

describe('readPairTableSummary', () => {
    // Parses KSTU's "label-value-label-value" 2-column-pair tables (transcript
    // summary, recbook summary, etc.) into a flat Record<label, value>. KSTU
    // tables typically have 4 or 6 cells per row in the layout [k1, v1, k2, v2].
    // A regression here would silently empty out half the summary cards.

    it('empty input → empty object', () => {
        expect(readPairTableSummary([])).toEqual({});
    });

    it('single row with one pair', () => {
        const result = readPairTableSummary([['ФИО', 'Иванов Иван']]);
        expect(result).toEqual({ 'ФИО': 'Иванов Иван' });
    });

    it('single row with multiple pairs (4 cells = 2 pairs)', () => {
        const result = readPairTableSummary([['Курс', '2', 'Факультет', 'ИТ']]);
        expect(result).toEqual({ 'Курс': '2', 'Факультет': 'ИТ' });
    });

    it('multiple rows accumulate into single object', () => {
        const result = readPairTableSummary([
            ['Курс', '2'],
            ['Факультет', 'ИТ'],
        ]);
        expect(result).toEqual({ 'Курс': '2', 'Факультет': 'ИТ' });
    });

    it('odd-length row drops the trailing unpaired cell', () => {
        // The loop iterates i < cells.length - 1, so an odd-length row [a, b, c]
        // produces only one pair (a→b); the trailing c is discarded.
        const result = readPairTableSummary([['a', 'b', 'c']]);
        expect(result).toEqual({ a: 'b' });
    });

    it('skips entries with empty/normalize-to-empty label', () => {
        // normalizeLabel returns '' for whitespace-only labels — those pairs skip.
        const result = readPairTableSummary([
            ['', 'orphan-value'],
            ['  ', 'whitespace-label'],
            ['ФИО', 'Real'],
        ]);
        expect(result).toEqual({ 'ФИО': 'Real' });
    });

    it('later occurrence overwrites earlier (last-write-wins)', () => {
        // Documents the dedup semantics: if the same label appears twice across
        // rows (or within one row), the latter wins.
        const result = readPairTableSummary([
            ['Курс', '1'],
            ['Курс', '2'],
        ]);
        expect(result).toEqual({ 'Курс': '2' });
    });

    it('applies cleanText to values (NBSP, whitespace collapse)', () => {
        //   is non-breaking space — cleanText converts to regular space.
        const result = readPairTableSummary([['Курс', '2 год']]);
        expect(result['Курс']).toBe('2 год');
    });

    it('applies normalizeLabel to keys (drops bullets/colons)', () => {
        // Labels like "• Курс:" should normalize to "Курс".
        const result = readPairTableSummary([['• Курс:', '2']]);
        expect(result).toEqual({ 'Курс': '2' });
    });

    it('preserves empty value (cleanText of "" is "")', () => {
        // The function only skips when LABEL is empty, not when value is empty.
        // So an empty value still creates a key with "" — useful for "this field
        // exists but is unset" display.
        const result = readPairTableSummary([['Курс', '']]);
        expect(result).toEqual({ 'Курс': '' });
    });
});

describe('pickEducationSectionValue', () => {
    // Convenience wrapper around pickSectionValue scoped to the "обучение"
    // (education) section. Used to extract questionnaire fields by case-insensitive
    // label substring match.

    const questionnaire: StudentQuestionnaire = {
        sections: [
            {
                key: 'education_info_section_обучение',
                title: 'Обучение',
                entries: [
                    { label: 'Форма оплаты', value: 'Грант' },
                    { label: 'Иностранный язык', value: 'Английский' },
                    { label: 'Тип поступления', value: 'ЕНТ' },
                ],
            },
            {
                key: 'student_info_section',
                title: 'Студент',
                entries: [{ label: 'Фамилия', value: 'Иванов' }],
            },
        ],
        orders: [],
        summary: {} as StudentQuestionnaire['summary'],
    };

    it('finds entry in the "обучение" section by case-insensitive needle', () => {
        expect(pickEducationSectionValue(questionnaire, 'форма оплаты')).toBe('Грант');
        expect(pickEducationSectionValue(questionnaire, 'ФОРМА ОПЛАТЫ')).toBe('Грант');
    });

    it('substring match (not exact)', () => {
        // "форма" alone matches "форма оплаты" via includes.
        expect(pickEducationSectionValue(questionnaire, 'форма')).toBe('Грант');
    });

    it('returns null when label not found in education section', () => {
        expect(pickEducationSectionValue(questionnaire, 'nonexistent label')).toBe(null);
    });

    it('does NOT search non-education sections (locks in "обучение" scope)', () => {
        // "Фамилия" is in the Студент section, NOT the Обучение section — so it
        // must NOT be found by this wrapper.
        expect(pickEducationSectionValue(questionnaire, 'фамилия')).toBe(null);
    });

    it('section match is by key.includes("обучение"), not title', () => {
        // The matcher uses section.key (which is the slugified title) to match,
        // so a section title that doesn't contain "обучение" still works as long
        // as the slugified key does.
        const result = pickEducationSectionValue(questionnaire, 'тип поступления');
        expect(result).toBe('ЕНТ');
    });

    it('returns null for empty questionnaire (no sections)', () => {
        const empty: StudentQuestionnaire = {
            sections: [],
            orders: [],
            summary: {} as StudentQuestionnaire['summary'],
        };
        expect(pickEducationSectionValue(empty, 'anything')).toBe(null);
    });
});
