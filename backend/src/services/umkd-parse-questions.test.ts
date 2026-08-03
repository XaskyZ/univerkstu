import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    parseQuestionList,
    normalize,
    isMonotonic,
    extractTextFromBuffer,
    renderPdfPageText,
} from './umkd-parse-questions.js';

describe('normalize', () => {
    it('converts CRLF to LF and strips trailing spaces', () => {
        expect(normalize('a   \r\nb\r\n')).toBe('a\nb\n');
    });

    it('collapses 3+ blank lines to 2', () => {
        expect(normalize('a\n\n\n\nb')).toBe('a\n\nb');
    });

    it('strips soft-hyphens', () => {
        expect(normalize('foo­bar')).toBe('foobar');
    });
});

describe('isMonotonic', () => {
    it('returns true for strictly increasing series', () => {
        expect(isMonotonic([1, 2, 3, 4, 5])).toBe(true);
    });

    it('tolerates up to 2 anomalies', () => {
        expect(isMonotonic([1, 2, 7, 8, 9])).toBe(true);
    });

    it('rejects mostly-decreasing series', () => {
        expect(isMonotonic([5, 1, 2, 1, 1])).toBe(false);
    });
});

describe('parseQuestionList — strict numbered', () => {
    it('splits 5 plain numbered questions ending with period', () => {
        const text = [
            '1. What is sovereignty?',
            '2. Define constitutionalism.',
            '3. List the branches of power.',
            '4. Explain the rule of law.',
            '5. Compare federalism and unitary states.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(5);
        expect(result[0].index).toBe(1);
        expect(result[0].text).toMatch(/sovereignty/i);
        expect(result[4].index).toBe(5);
    });

    it('splits numbered questions ending with closing paren', () => {
        const text = [
            '1) First item body text.',
            '2) Second item body text.',
            '3) Third item body text.',
            '4) Fourth item body text.',
            '5) Fifth item body text.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(5);
        expect(result.map((r) => r.index)).toEqual([1, 2, 3, 4, 5]);
    });

    it('attaches section headers to subsequent questions', () => {
        const text = [
            'Раздел 1 Введение',
            '1. Question one body.',
            '2. Question two body.',
            'Раздел 2 Углублённые темы',
            '3. Question three body.',
            '4. Question four body.',
            '5. Question five body.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(5);
        expect(result[0].section).toMatch(/Раздел 1/);
        expect(result[1].section).toMatch(/Раздел 1/);
        expect(result[2].section).toMatch(/Раздел 2/);
        expect(result[4].section).toMatch(/Раздел 2/);
    });
});

describe('parseQuestionList — prefix-style', () => {
    it('splits Вопрос N: prefix into 5 questions', () => {
        const text = [
            'Вопрос 1: Что такое конституция?',
            'Вопрос 2: Какие виды демократии существуют?',
            'Вопрос 3: Опишите принцип разделения властей.',
            'Вопрос 4: Что такое правовое государство?',
            'Вопрос 5: Объясните понятие гражданского общества.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(5);
        expect(result[0].text).toMatch(/конституция/);
        expect(result[0].text.startsWith('Вопрос')).toBe(false);
    });

    it('splits "Вопрос N" header that lives on its own line (PDF-style)', () => {
        const text = [
            'Уровень 1',
            'Вопрос 1',
            'V 1   Первый вопрос про что-то.',
            'ответ а',
            'Уровень 1',
            'Вопрос 2',
            'V 1   Второй вопрос.',
            'ответ б',
            'Уровень 1',
            'Вопрос 3',
            'V 1   Третий вопрос.',
            'Уровень 1',
            'Вопрос 4',
            'V 1   Четвёртый вопрос.',
            'Уровень 1',
            'Вопрос 5',
            'V 1   Пятый вопрос.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result.length).toBeGreaterThanOrEqual(5);
        expect(result[0].text).toMatch(/Первый вопрос/);
        expect(result[0].text.startsWith('Вопрос')).toBe(false);
    });

    it('splits Kazakh Сұрақ N prefix into 6 questions', () => {
        const text = [
            'Сұрақ 1 Бірінші сұрақтың мәтіні.',
            'Сұрақ 2 Екінші сұрақтың мәтіні.',
            'Сұрақ 3 Үшінші сұрақтың мәтіні.',
            'Сұрақ 4 Төртінші сұрақтың мәтіні.',
            'Сұрақ 5 Бесінші сұрақтың мәтіні.',
            'Сұрақ 6 Алтыншы сұрақтың мәтіні.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(6);
        expect(result[5].index).toBe(6);
    });
});

describe('parseQuestionList — multiline / PDF-like extracts', () => {
    it('collapses mid-sentence line wraps inside a question body', () => {
        const text = [
            '1. This is a long question that was split across',
            'multiple lines by the PDF extractor and should',
            'be re-joined into one sentence.',
            '2. Second question body.',
            '3. Third question body.',
            '4. Fourth question body.',
            '5. Fifth question body.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(5);
        expect(result[0].text).toMatch(/long question that was split across multiple lines/);
        expect(result[0].text.includes('\n')).toBe(false);
    });
});

describe('parseQuestionList — multi-section restarts', () => {
    it('tolerates per-section numbering restarts (1..N, then back to 1..M)', () => {
        // Mirrors the reference Физические основы электроники PDF: several
        // sections each restart numbering at 1. Splitter must NOT bail back to
        // the fallback single-item rule.
        const lines: string[] = [];
        for (let s = 1; s <= 3; s++) {
            lines.push(`${s} Раздел номер ${s}`);
            for (let q = 1; q <= 10; q++) {
                lines.push(`${q}. Section ${s} question ${q} body text.`);
            }
        }
        const result = parseQuestionList(lines.join('\n'));
        // 3 sections × 10 questions = 30 questions total
        expect(result.length).toBeGreaterThanOrEqual(28);
    });
});

describe('parseQuestionList — scale', () => {
    it('splits a 120-question list correctly', () => {
        const lines: string[] = [];
        for (let i = 1; i <= 120; i++) {
            lines.push(`${i}. Question number ${i} body text.`);
        }
        const result = parseQuestionList(lines.join('\n'));
        expect(result).toHaveLength(120);
        expect(result[0].index).toBe(1);
        expect(result[119].index).toBe(120);
        expect(result[119].text).toMatch(/number 120/);
    });
});

describe('parseQuestionList — digit + whitespace (Pattern 1)', () => {
    it('splits a 5-question list numbered with just spaces (no period)', () => {
        const text = [
            '1   First question body.',
            '2   Second question body.',
            '3   Third question body.',
            '4   Fourth question body.',
            '5   Fifth question body.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(5);
        expect(result[0].text).toMatch(/First question/);
        // Leading "1" should be stripped from the question body.
        expect(result[0].text.startsWith('1')).toBe(false);
    });

    it('splits a list numbered with a single space separator', () => {
        const text = [
            '1 Foo bar baz.',
            '2 Quux quuz.',
            '3 Третий вопрос текст.',
            '4 Fourth answer body.',
            '5 Fifth answer body.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(5);
        expect(result[0].text.startsWith('1')).toBe(false);
    });

    it('does NOT misinterpret year tokens (2023 2024 ...) as a list', () => {
        const text = [
            'Просто документ без вопросов.',
            '2023 was a year of changes.',
            '2024 was even more interesting.',
            '2025 even more so.',
            'И никаких вопросов здесь нет.',
        ].join('\n');
        const result = parseQuestionList(text);
        // Should fall through to the single-block fallback, not split on years.
        expect(result).toHaveLength(1);
    });
});

describe('parseQuestionList — unnumbered after heading (Pattern 2)', () => {
    it('splits a paragraph list under "Экзаменационные вопросы" heading', () => {
        const text = [
            'Экзаменационные вопросы',
            '',
            'Question one body.',
            '',
            'Question two body.',
            '',
            'Question three body.',
            '',
            'Question four body.',
            '',
            'Question five body.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result.length).toBeGreaterThanOrEqual(5);
        expect(result[0].text).toMatch(/Question one/);
    });

    it('splits a line-separated list (no blank lines) under heading', () => {
        const text = [
            'Экзаменационные вопросы по Основам геологии',
            'Содержание и задачи дисциплины «Основы геологии».',
            'Форма Земли, параметры и температуры Земли.',
            'Геосфера Земли внутренние и внешние характеристика.',
            'Физические свойства минералов.',
            'Диагностические свойства минералов.',
            'Классификация и краткая характеристика минералов.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result.length).toBeGreaterThanOrEqual(5);
        expect(result[0].text).toMatch(/Содержание/);
    });

    it('matches heading even when embedded mid-line', () => {
        const text = [
            '«Психология» пәні бойынша емтихан сұрақтары',
            '',
            'Психология пәні және оның міндеттері.',
            '',
            'Психология ғылымының даму тарихы.',
            '',
            'Психология ғылымының салалары.',
            '',
            'Психологияның басқа ғылымдармен байланысы.',
            '',
            'Психикалық құбылыстар туралы.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result.length).toBeGreaterThanOrEqual(5);
    });
});

describe('parseQuestionList — exam tickets (Pattern 3)', () => {
    it('splits 3 numbered "Билет №N" blocks', () => {
        const text = [
            'Билет №1',
            'Foo first question body.',
            '',
            'Билет №2',
            'Bar second question body.',
            '',
            'Билет №3',
            'Baz third question body.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result.length).toBeGreaterThanOrEqual(3);
        // The ticket header itself should not start the body.
        expect(result[0].text.startsWith('Билет')).toBe(false);
    });

    it('splits Kazakh "Емтихан билеті №N" tickets', () => {
        const text = [
            'Емтихан билеті №1',
            'Алғашқы билеттің мазмұны.',
            'Емтихан билеті №2',
            'Екінші билеттің мазмұны.',
            'Емтихан билеті №3',
            'Үшінші билеттің мазмұны.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(3);
    });

    it('splits un-numbered "Емтихандық билет" repeated tickets when ≥5', () => {
        const ticket = [
            'Емтихандық билет',
            'Some question body that is long enough.',
            'Another question line.',
            '',
        ].join('\n');
        const text = Array(6).fill(ticket).join('');
        const result = parseQuestionList(text);
        expect(result.length).toBeGreaterThanOrEqual(5);
    });
});

describe('parseQuestionList — boilerplate skip (Pattern 4)', () => {
    it('skips program-code chrome before "Экзаменационные вопросы"', () => {
        const lines = [
            '«КАРАГАНДИНСКИЙ ТЕХНИЧЕСКИЙ УНИВЕРСИТЕТ»',
            '6В07201 – «Геология»,',
            '6В07202 – «Тау-кен ісі»,',
            '6В07203 – «Мұнай-газ ісі»,',
            '6В07206 – «Маркшейдерлік іс»,',
            '',
            'Экзаменационные вопросы:',
            '1. Что такое экзамен?',
            '2. Зачем нужно учиться.',
            '3. Какова цена ошибки.',
            '4. Объясните закон.',
            '5. Опишите эксперимент.',
        ];
        const result = parseQuestionList(lines.join('\n'));
        expect(result.length).toBeGreaterThanOrEqual(5);
        // None of the program codes should leak into the question bodies.
        for (const q of result) {
            expect(q.text).not.toMatch(/6В072\d{2}\s*–\s*«/);
        }
    });
});

describe('parseQuestionList — Вопрос prefix with only 2 matches (Pattern 5)', () => {
    it('splits exactly 2 explicit "Вопрос N:" markers', () => {
        const text = [
            'Дисциплина: Программирование',
            '',
            'Вопрос 1: Что такое переменная?',
            'Поясните на примере.',
            '',
            'Вопрос 2: Что такое функция?',
            'Поясните на примере.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result.length).toBeGreaterThanOrEqual(2);
        // Both bodies should not start with the "Вопрос" word.
        for (const q of result) {
            expect(q.text.startsWith('Вопрос')).toBe(false);
        }
    });
});

describe('parseQuestionList — fallback', () => {
    it('returns a single fallback item for garbage / decoration-only text', () => {
        const text = '===== Title Page =====\n\nProperty of the university.';
        const result = parseQuestionList(text);
        expect(result).toHaveLength(1);
        expect(result[0].index).toBe(1);
        expect(result[0].text.length).toBeGreaterThan(0);
    });

    it('tolerates non-monotonic numbering with ≤2 anomalies', () => {
        const text = [
            '1. First question.',
            '2. Second question.',
            '7. Skipped question.',
            '8. Eighth question.',
            '9. Ninth question.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(5);
    });

    it('splits bulleted list with 5+ items', () => {
        const text = [
            '• First bullet question body.',
            '• Second bullet question body.',
            '• Third bullet question body.',
            '• Fourth bullet question body.',
            '• Fifth bullet question body.',
            '• Sixth bullet question body.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result).toHaveLength(6);
        expect(result[0].text.startsWith('•')).toBe(false);
    });
});

describe('parseQuestionList — quality guards', () => {
    it('caps very long question bodies at 4000 characters', () => {
        const big = 'a'.repeat(6000);
        const text = [
            `1. ${big}`,
            '2. Second question body.',
            '3. Third question body.',
            '4. Fourth question body.',
            '5. Fifth question body.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result[0].text.length).toBeLessThanOrEqual(4000);
    });

    it('drops ALL-CAPS decorative lines under 50 chars from question bodies', () => {
        const text = [
            '1. Question body line one.',
            'HEADER LABEL',
            'continuation of question one.',
            '2. Second question.',
            '3. Third question.',
            '4. Fourth question.',
            '5. Fifth question.',
        ].join('\n');
        const result = parseQuestionList(text);
        expect(result[0].text).not.toMatch(/HEADER LABEL/);
        expect(result[0].text).toMatch(/continuation/);
    });
});

describe('renderPdfPageText', () => {
    it('inserts line breaks when items carry hasEOL', () => {
        const items = [
            { str: '1. First question.', hasEOL: true },
            { str: '2. Second question.', hasEOL: true },
            { str: '3. Third question.', hasEOL: true },
            { str: '4. Fourth question.', hasEOL: true },
            { str: '5. Fifth question.', hasEOL: true },
        ];
        const text = renderPdfPageText(items);
        expect(text.split('\n').filter((l) => l.trim().length > 0)).toHaveLength(5);
        const questions = parseQuestionList(text);
        expect(questions).toHaveLength(5);
    });

    it('falls back to y-coordinate jumps when hasEOL is missing', () => {
        // Simulate pdfjs output with no `hasEOL` flags but distinct baselines.
        const items = [
            { str: '1. First question.', transform: [1, 0, 0, 1, 50, 700] },
            { str: '2. Second question.', transform: [1, 0, 0, 1, 50, 680] },
            { str: '3. Third question.', transform: [1, 0, 0, 1, 50, 660] },
            { str: '4. Fourth question.', transform: [1, 0, 0, 1, 50, 640] },
            { str: '5. Fifth question.', transform: [1, 0, 0, 1, 50, 620] },
        ];
        const text = renderPdfPageText(items);
        expect(text.split('\n').filter((l) => l.trim().length > 0)).toHaveLength(5);
        const questions = parseQuestionList(text);
        expect(questions).toHaveLength(5);
    });

    it('joins items on the same baseline with a single space', () => {
        const items = [
            { str: '1.', transform: [1, 0, 0, 1, 50, 700] },
            { str: 'First', transform: [1, 0, 0, 1, 70, 700] },
            { str: 'question.', transform: [1, 0, 0, 1, 110, 700] },
            { str: '2.', transform: [1, 0, 0, 1, 50, 680] },
            { str: 'Second', transform: [1, 0, 0, 1, 70, 680] },
            { str: 'question.', transform: [1, 0, 0, 1, 110, 680] },
        ];
        const text = renderPdfPageText(items);
        expect(text).toContain('1. First question.');
        expect(text).toContain('2. Second question.');
        expect(text.split('\n').filter((l) => l.trim().length > 0)).toHaveLength(2);
    });

    it('returns empty string for empty input', () => {
        expect(renderPdfPageText([])).toBe('');
    });
});

describe('extractTextFromBuffer', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it('returns unsupported for unknown mime/extension', async () => {
        const result = await extractTextFromBuffer(
            Buffer.from('hello'),
            'text/plain',
            'txt',
        );
        expect(result.ok).toBe(false);
        expect(result.extractor).toBe('unsupported');
    });

    it('returns error on invalid docx buffer', async () => {
        const result = await extractTextFromBuffer(
            Buffer.from('not a real docx'),
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'docx',
        );
        expect(result.ok).toBe(false);
        expect(result.extractor).toBe('mammoth');
    });

    it('routes .doc mime through the word-extractor branch', async () => {
        // Mock the dynamic import so we don't need a real .doc fixture.
        const richBody = '1. Первый вопрос про процессы.\n2. Второй вопрос про потоки.\n3. Третий вопрос про синхронизацию.\n4. Четвёртый вопрос про IPC.\n5. Пятый вопрос про планирование.';
        vi.doMock('word-extractor', () => {
            class FakeExtractor {
                extract(): Promise<{
                    getBody: () => string;
                    getFootnotes: () => string;
                    getEndnotes: () => string;
                    getTextboxes: () => string;
                }> {
                    return Promise.resolve({
                        getBody: () => richBody,
                        getFootnotes: () => '',
                        getEndnotes: () => '',
                        getTextboxes: () => '',
                    });
                }
            }
            return { default: FakeExtractor };
        });
        const fresh = await import('./umkd-parse-questions.js?doc-success');
        const result = await fresh.extractTextFromBuffer(
            Buffer.from('legacy'),
            'application/msword',
            'doc',
        );
        expect(result.extractor).toBe('word-extractor');
        expect(result.ok).toBe(true);
        expect(result.text).toContain('Первый вопрос');
    });

    it('returns ok=false without throwing when .doc extraction fails', async () => {
        vi.doMock('word-extractor', () => {
            class FakeExtractor {
                extract(): Promise<never> {
                    return Promise.reject(new Error('corrupted ole stream'));
                }
            }
            return { default: FakeExtractor };
        });
        const fresh = await import('./umkd-parse-questions.js?doc-fail');
        const result = await fresh.extractTextFromBuffer(
            Buffer.from('legacy'),
            'application/msword',
            'doc',
        );
        expect(result.ok).toBe(false);
        expect(result.extractor).toBe('word-extractor');
        expect(result.error).toMatch(/doc parse failed/);
        expect(result.error).toMatch(/corrupted ole stream/);
    });

    it('reports doc has no extractable text for empty .doc output', async () => {
        vi.doMock('word-extractor', () => {
            class FakeExtractor {
                extract(): Promise<{
                    getBody: () => string;
                    getFootnotes: () => string;
                    getEndnotes: () => string;
                    getTextboxes: () => string;
                }> {
                    return Promise.resolve({
                        getBody: () => '',
                        getFootnotes: () => '',
                        getEndnotes: () => '',
                        getTextboxes: () => '',
                    });
                }
            }
            return { default: FakeExtractor };
        });
        const fresh = await import('./umkd-parse-questions.js?doc-empty');
        const result = await fresh.extractTextFromBuffer(
            Buffer.from('legacy'),
            'application/msword',
            'doc',
        );
        expect(result.ok).toBe(false);
        expect(result.extractor).toBe('word-extractor');
        expect(result.error).toBe('doc has no extractable text');
    });
});
