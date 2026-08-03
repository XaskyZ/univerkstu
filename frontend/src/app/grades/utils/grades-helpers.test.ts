import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlatonusSubjectGrade } from '@/lib/api';
import {
    buildPlatonusLoginFromFullName,
    clampNumber,
    formatExamDateLabel,
    formatGoalNumber,
    formatParsedAt,
    formatRelativeParsedAge,
    getAssistantStatusTone,
    getCachedPlatonusStatus,
    getDefaultSemesters,
    getGradeTone,
    getInitialSemesterSelection,
    getSubjectStatusKey,
    getSuggestedPlatonusLoginFromCache,
    gradesCacheKey,
    hasPublishedSemesterActivity,
    normalizePlatonusLogin,
    parseScoreValue,
} from './grades-helpers';

function makeSubject(overrides: Partial<PlatonusSubjectGrade>): PlatonusSubjectGrade {
    return {
        name: 'Test subject',
        rk1: '-',
        rk2: '-',
        rating: '-',
        exam: '-',
        total: '-',
        ...overrides,
    };
}

describe('buildPlatonusLoginFromFullName', () => {
    it('joins first two words with underscore', () => {
        expect(buildPlatonusLoginFromFullName('Сулейменов Абылай')).toBe('Сулейменов_Абылай');
    });

    it('collapses internal whitespace', () => {
        expect(buildPlatonusLoginFromFullName('  Сулейменов   Абылай  ')).toBe('Сулейменов_Абылай');
    });

    it('returns empty for single-word input', () => {
        expect(buildPlatonusLoginFromFullName('Сулейменов')).toBe('');
    });

    it('returns empty for empty/whitespace input', () => {
        expect(buildPlatonusLoginFromFullName('')).toBe('');
        expect(buildPlatonusLoginFromFullName('   ')).toBe('');
    });

    it('uses only the first two words even if more provided', () => {
        // Patronymic-style input — only фамилия + имя go into login
        expect(buildPlatonusLoginFromFullName('Иванов Иван Иванович')).toBe('Иванов_Иван');
    });
});

describe('normalizePlatonusLogin', () => {
    it('trims surrounding whitespace', () => {
        expect(normalizePlatonusLogin('  user_login  ')).toBe('user_login');
    });

    it('leaves internal characters untouched', () => {
        expect(normalizePlatonusLogin('Сулейменов_Абылай')).toBe('Сулейменов_Абылай');
    });
});

describe('gradesCacheKey', () => {
    it('formats year/semester predictably', () => {
        expect(gradesCacheKey(2025, 2)).toBe('platonus_grades_2025_2');
        expect(gradesCacheKey(2024, 1)).toBe('platonus_grades_2024_1');
    });
});

describe('parseScoreValue', () => {
    it('treats undefined/null/empty as missing', () => {
        expect(parseScoreValue(undefined)).toEqual({ kind: 'missing', raw: '', value: null });
        expect(parseScoreValue(null)).toEqual({ kind: 'missing', raw: '', value: null });
        expect(parseScoreValue('')).toEqual({ kind: 'missing', raw: '', value: null });
    });

    it('treats dash and em dash as missing', () => {
        expect(parseScoreValue('-')).toEqual({ kind: 'missing', raw: '-', value: null });
        expect(parseScoreValue('—')).toEqual({ kind: 'missing', raw: '—', value: null });
    });

    it('parses integer numbers', () => {
        const result = parseScoreValue('85');
        expect(result.kind).toBe('number');
        expect(result.value).toBe(85);
        expect(result.raw).toBe('85');
    });

    it('parses zero as a real number value (not missing)', () => {
        const result = parseScoreValue('0');
        expect(result.kind).toBe('number');
        expect(result.value).toBe(0);
    });

    it('parses floats with comma decimal', () => {
        const result = parseScoreValue('4,5');
        expect(result.kind).toBe('number');
        expect(result.value).toBe(4.5);
    });

    it('parses floats with dot decimal', () => {
        const result = parseScoreValue('4.5');
        expect(result.kind).toBe('number');
        expect(result.value).toBe(4.5);
    });

    it('flags blocked markers (Russian, Latin, English)', () => {
        expect(parseScoreValue('недоп').kind).toBe('blocked');
        expect(parseScoreValue('Недопуск').kind).toBe('blocked');
        expect(parseScoreValue('nedop').kind).toBe('blocked');
        expect(parseScoreValue('not admitted').kind).toBe('blocked');
    });

    it('falls back to text for non-numeric, non-blocked strings', () => {
        const result = parseScoreValue('зачёт');
        expect(result.kind).toBe('text');
        expect(result.value).toBeNull();
    });

    it('trims surrounding whitespace before classifying', () => {
        expect(parseScoreValue('  85  ').value).toBe(85);
        expect(parseScoreValue('  -  ').kind).toBe('missing');
    });
});

describe('hasPublishedSemesterActivity', () => {
    it('returns false for the not-started-semester stub (live autumn 2026/1 shape)', () => {
        // Реальный сырой ответ Platonus для не начавшегося семестра:
        // РК = '-', Рейтинг = '0', в экзамене заранее стоит «недоп.», итог '0'.
        const subject = makeSubject({
            kind: 'regular', rk1: '-', rk2: '-', rating: '0', exam: 'недоп.', total: '0',
        });
        expect(hasPublishedSemesterActivity(subject)).toBe(false);
    });

    it('returns false for the not-started coursework stub', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '-', rk2: '-', rating: '0', exam: '-', total: '0.0',
        });
        expect(hasPublishedSemesterActivity(subject)).toBe(false);
    });

    it('treats a closed RK as activity — including an honest zero', () => {
        // Неопубликованные РК Platonus отдаёт как '-', поэтому число (даже 0) —
        // это реально закрытая рубежка.
        expect(hasPublishedSemesterActivity(makeSubject({ rk1: '0' }))).toBe(true);
        expect(hasPublishedSemesterActivity(makeSubject({ rk2: '30' }))).toBe(true);
    });

    it('treats positive rating/exam/total as activity, but zero as a stub', () => {
        expect(hasPublishedSemesterActivity(makeSubject({ rating: '74.00' }))).toBe(true);
        expect(hasPublishedSemesterActivity(makeSubject({ exam: '70.00' }))).toBe(true);
        expect(hasPublishedSemesterActivity(makeSubject({ total: '72.00' }))).toBe(true);
        expect(hasPublishedSemesterActivity(makeSubject({ rating: '0', total: '0' }))).toBe(false);
    });
});

describe('getSubjectStatusKey — не начавшийся семестр vs реальный недопуск', () => {
    it('not-started regular subject with pre-filled «недоп.» → no-data, not blocked', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '-', rk2: '-', rating: '0', exam: 'недоп.', total: '0',
        });
        expect(getSubjectStatusKey(subject)).toBe('no-data');
    });

    it('not-started coursework stub → no-data, not awaiting-final', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '-', rk2: '-', rating: '0', exam: '-', total: '0.0',
        });
        expect(getSubjectStatusKey(subject)).toBe('no-data');
    });

    it('real blocked: both RKs published with average < 50 → still blocked', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '30', rk2: '40', exam: '-', total: '-',
        });
        expect(getSubjectStatusKey(subject)).toBe('blocked');
    });

    it('real blocked: explicit «Недоп.» with published RKs → still blocked', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '70', rk2: '70', exam: 'Недоп.', total: '0',
        });
        expect(getSubjectStatusKey(subject)).toBe('blocked');
    });

    it('«недоп.» with at least one published RK → blocked (Platonus authoritative)', () => {
        // Например, недопуск по посещаемости, когда вторая РК ещё не закрыта.
        const subject = makeSubject({
            kind: 'regular', rk1: '40', rk2: '-', exam: 'недоп.', total: '0',
        });
        expect(getSubjectStatusKey(subject)).toBe('blocked');
    });

    it('finished spring subject stays final (live 2025/2 shape)', () => {
        const subject = makeSubject({
            kind: 'regular', rk1: '69.60', rk2: '78.00', rating: '74.00', exam: '70.00', total: '72.00',
        });
        expect(getSubjectStatusKey(subject)).toBe('final');
    });

    it('coursework mid-semester with a published RK still awaits the final mark', () => {
        const subject = makeSubject({
            kind: 'coursework', rk1: '80', rk2: '-', rating: '-', total: '-',
        });
        expect(getSubjectStatusKey(subject)).toBe('awaiting-final');
    });
});

describe('clampNumber', () => {
    it('clamps below min', () => {
        expect(clampNumber(-5, 0, 100)).toBe(0);
    });

    it('clamps above max', () => {
        expect(clampNumber(120, 0, 100)).toBe(100);
    });

    it('passes through value within range', () => {
        expect(clampNumber(50, 0, 100)).toBe(50);
    });

    it('respects min/max boundaries inclusively', () => {
        expect(clampNumber(0, 0, 100)).toBe(0);
        expect(clampNumber(100, 0, 100)).toBe(100);
    });
});

describe('formatGoalNumber', () => {
    it('returns em dash for null', () => {
        expect(formatGoalNumber(null)).toBe('—');
    });

    it('formats integers without decimals', () => {
        expect(formatGoalNumber(90)).toBe('90');
        expect(formatGoalNumber(0)).toBe('0');
    });

    it('formats fractional with one decimal', () => {
        expect(formatGoalNumber(85.5)).toBe('85.5');
        expect(formatGoalNumber(85.45)).toBe('85.5');
        expect(formatGoalNumber(85.44)).toBe('85.4');
    });
});

describe('getGradeTone', () => {
    it('flags nedop variants as danger regardless of any number-like content', () => {
        const danger = getGradeTone('Недоп');
        expect(danger.color).toBe('var(--status-danger-color)');
    });

    it('returns muted tone for non-numeric, non-nedop values', () => {
        const muted = getGradeTone('зачёт');
        expect(muted.color).toBe('var(--muted)');
    });

    it('returns success for >=90', () => {
        expect(getGradeTone('90').color).toBe('var(--status-success-color)');
        expect(getGradeTone('100').color).toBe('var(--status-success-color)');
    });

    it('returns info for 70..89', () => {
        expect(getGradeTone('70').color).toBe('var(--status-info-color)');
        expect(getGradeTone('89').color).toBe('var(--status-info-color)');
    });

    it('returns warning for 50..69', () => {
        expect(getGradeTone('50').color).toBe('var(--status-warning-color)');
        expect(getGradeTone('69').color).toBe('var(--status-warning-color)');
    });

    it('returns danger for <50 (including 0)', () => {
        expect(getGradeTone('0').color).toBe('var(--status-danger-color)');
        expect(getGradeTone('49').color).toBe('var(--status-danger-color)');
    });
});

describe('getAssistantStatusTone', () => {
    it('maps statuses to expected CSS variables', () => {
        expect(getAssistantStatusTone('ok').color).toBe('var(--status-success-color)');
        expect(getAssistantStatusTone('achievable').color).toBe('var(--status-info-color)');
        expect(getAssistantStatusTone('risk').color).toBe('var(--status-warning-color)');
        expect(getAssistantStatusTone('impossible').color).toBe('var(--status-danger-color)');
    });
});

describe('formatParsedAt', () => {
    it('returns empty for undefined / empty', () => {
        expect(formatParsedAt(undefined)).toBe('');
        expect(formatParsedAt('')).toBe('');
    });

    it('returns empty for invalid date string', () => {
        expect(formatParsedAt('not-a-date')).toBe('');
    });

    it('formats ISO timestamp in ru-RU locale by default', () => {
        // Pick a fixed timestamp; format includes day/month/hour/minute pairs.
        const result = formatParsedAt('2025-03-15T10:30:00Z');
        // Date components are timezone-sensitive; just check we got a non-empty string with digits.
        expect(result).toMatch(/\d{2}\.\d{2}/);
    });
});

describe('formatExamDateLabel', () => {
    it('returns empty for falsy input', () => {
        expect(formatExamDateLabel(undefined)).toBe('');
        expect(formatExamDateLabel(null)).toBe('');
        expect(formatExamDateLabel('')).toBe('');
    });

    it('returns empty for invalid date string', () => {
        expect(formatExamDateLabel('garbage')).toBe('');
    });

    it('formats valid ISO date', () => {
        const result = formatExamDateLabel('2025-06-10T14:00:00Z');
        expect(result).toMatch(/\d{2}\.\d{2}/);
    });
});

describe('formatRelativeParsedAge', () => {
    const FROZEN_NOW = new Date('2025-05-13T12:00:00Z').getTime();

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(FROZEN_NOW);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns empty for missing input', () => {
        expect(formatRelativeParsedAge(undefined)).toBe('');
        expect(formatRelativeParsedAge('')).toBe('');
    });

    it('returns empty for invalid date', () => {
        expect(formatRelativeParsedAge('not-a-date')).toBe('');
    });

    it('reports "just now" for under a minute in en', () => {
        const tsTwentySecondsAgo = new Date(FROZEN_NOW - 20_000).toISOString();
        expect(formatRelativeParsedAge(tsTwentySecondsAgo, 'en')).toBe('just now');
    });

    it('reports minutes in ru by default', () => {
        const tsTenMinutesAgo = new Date(FROZEN_NOW - 10 * 60_000).toISOString();
        expect(formatRelativeParsedAge(tsTenMinutesAgo)).toBe('10 мин назад');
    });

    it('reports hours in kz', () => {
        const tsTwoHoursAgo = new Date(FROZEN_NOW - 2 * 60 * 60_000).toISOString();
        expect(formatRelativeParsedAge(tsTwoHoursAgo, 'kz')).toBe('2 сағ бұрын');
    });

    it('reports days in en', () => {
        const tsThreeDaysAgo = new Date(FROZEN_NOW - 3 * 24 * 60 * 60_000).toISOString();
        expect(formatRelativeParsedAge(tsThreeDaysAgo, 'en')).toBe('3 d ago');
    });
});

// Cache-coupled helpers — require MemoryStorage stub so we can seed cache reads.
class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

const CACHE_VERSION = 'v1';

function seedCacheEntry(key: string, data: unknown) {
    const entry = { data, timestamp: Date.now(), version: CACHE_VERSION };
    localStorage.setItem(`cache_${key}`, JSON.stringify(entry));
}

let localStorage: MemoryStorage;

describe('cache-coupled helpers', () => {
    beforeEach(() => {
        localStorage = new MemoryStorage();
        vi.stubGlobal('window', { localStorage });
        vi.stubGlobal('localStorage', localStorage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    describe('getSuggestedPlatonusLoginFromCache', () => {
        it('returns empty when no profile cached', () => {
            expect(getSuggestedPlatonusLoginFromCache()).toBe('');
        });

        it('returns empty when cached profile has no fullName', () => {
            seedCacheEntry('profile', { profile: {} });
            expect(getSuggestedPlatonusLoginFromCache()).toBe('');
        });

        it('builds login from cached profile fullName', () => {
            seedCacheEntry('profile', { profile: { fullName: 'Сулейменов Абылай' } });
            expect(getSuggestedPlatonusLoginFromCache()).toBe('Сулейменов_Абылай');
        });

        it('uses only the first two words from a longer cached fullName', () => {
            seedCacheEntry('profile', { profile: { fullName: 'Иванов Иван Иванович' } });
            expect(getSuggestedPlatonusLoginFromCache()).toBe('Иванов_Иван');
        });

        it('returns empty for corrupted cache entry', () => {
            localStorage.setItem('cache_profile', 'not-json');
            expect(getSuggestedPlatonusLoginFromCache()).toBe('');
        });
    });

    describe('getCachedPlatonusStatus', () => {
        it('returns null when no status cached', () => {
            expect(getCachedPlatonusStatus()).toBe(null);
        });

        it('returns the cached status verbatim', () => {
            const status = {
                connected: true,
                active: true,
                availableSemesters: [{ year: 2025, semester: 1, label: 'Осенний 2025' }],
            };
            seedCacheEntry('platonus_status', status);
            expect(getCachedPlatonusStatus()).toEqual(status);
        });
    });

    describe('getInitialSemesterSelection', () => {
        const defaultSemesters = [
            { year: 2025, semester: 1, label: 'Осенний 2025' },
            { year: 2025, semester: 2, label: 'Весенний 2026' },
        ];

        it('uses cached availableSemesters when present', () => {
            const cached = [
                { year: 2024, semester: 1, label: 'Осенний 2024' },
                { year: 2024, semester: 2, label: 'Весенний 2025' },
            ];
            seedCacheEntry('platonus_status', { connected: true, availableSemesters: cached });
            // No academic context cached, so falls through to date-based preference.
            // Either way, the chosen semester must be from the cached list, not defaults.
            const result = getInitialSemesterSelection(defaultSemesters);
            const yearsInCached = new Set(cached.map((s) => s.year));
            expect(yearsInCached.has(result.year)).toBe(true);
        });

        it('falls back to defaults when no cached status', () => {
            const result = getInitialSemesterSelection(defaultSemesters);
            const yearsInDefaults = new Set(defaultSemesters.map((s) => s.year));
            expect(yearsInDefaults.has(result.year)).toBe(true);
        });

        it('falls back to defaults when cached status has empty availableSemesters', () => {
            seedCacheEntry('platonus_status', { connected: true, availableSemesters: [] });
            const result = getInitialSemesterSelection(defaultSemesters);
            const yearsInDefaults = new Set(defaultSemesters.map((s) => s.year));
            expect(yearsInDefaults.has(result.year)).toBe(true);
        });

        it('returns valid year + semester shape', () => {
            const result = getInitialSemesterSelection(defaultSemesters);
            expect(typeof result.year).toBe('number');
            expect(typeof result.semester).toBe('number');
            expect(result.year).toBeGreaterThan(2000);
        });
    });

    describe('getInitialSemesterSelection — default resolves to the CURRENT period', () => {
        // Regression suite for the "grades open last spring by default" bug:
        // no cached status, no academic context → the dynamic default list must
        // contain the current period, and it must be the one selected.
        const messagesStub = {
            grades: {
                spring: 'Весенний',
                autumn: 'Осенний',
                semesterFormat: '{start}/{end} — {season}',
            },
        } as unknown as Parameters<typeof getDefaultSemesters>[0];

        afterEach(() => {
            vi.useRealTimers();
        });

        it('August → upcoming autumn semester', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 7, 2)); // 2 Aug 2026
            const result = getInitialSemesterSelection(getDefaultSemesters(messagesStub));
            expect(result).toEqual({ year: 2026, semester: 1 });
        });

        it('December → still the autumn semester (winter session)', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 10)); // 10 Dec 2026
            const result = getInitialSemesterSelection(getDefaultSemesters(messagesStub));
            expect(result).toEqual({ year: 2026, semester: 1 });
        });

        it('January → autumn semester of the previous calendar year', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2027, 0, 12)); // 12 Jan 2027
            const result = getInitialSemesterSelection(getDefaultSemesters(messagesStub));
            expect(result).toEqual({ year: 2026, semester: 1 });
        });

        it('a stale academic context (>12h) does not override the date-based autumn', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 11, 10)); // Dec 2026 → autumn 2026/1
            // Контекст от мая: currentSemesterNumber = 4 (весна), admissionYear 2024
            // → {2025, 2}. Записан 20 часов назад — обязан игнорироваться по TTL.
            const staleEntry = {
                data: { admissionYear: 2024, currentSemesterNumber: 4 },
                timestamp: Date.now() - 20 * 60 * 60 * 1000,
                version: CACHE_VERSION,
            };
            localStorage.setItem('cache_academic_context', JSON.stringify(staleEntry));
            const result = getInitialSemesterSelection(getDefaultSemesters(messagesStub));
            expect(result).toEqual({ year: 2026, semester: 1 });
        });

        it('September with an OUTDATED cached semester list → nearest past semester, not [0]', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 8, 5)); // Sep 2026 → preferred 2026/1
            // Список из кеша статуса кончается на весне 2025/26 — осени 2026 нет.
            seedCacheEntry('platonus_status', {
                connected: true,
                availableSemesters: [
                    { year: 2025, semester: 2, label: 'Весенний 2025/26' },
                    { year: 2025, semester: 1, label: 'Осенний 2025/26' },
                    { year: 2024, semester: 2, label: 'Весенний 2024/25' },
                ],
            });
            const result = getInitialSemesterSelection(getDefaultSemesters(messagesStub));
            // Ближайший разумный ≤ текущего — последняя весна, не произвольный [0].
            expect(result).toEqual({ year: 2025, semester: 2 });
        });
    });

    describe('getDefaultSemesters', () => {
        // Dynamic fallback list: the current academic period + 3 previous
        // half-years, newest first. Used only when the backend semester list
        // is unavailable — must always contain the current period so the
        // date-based default can be found in it.

        // Minimal stub matching the shape used by getDefaultSemesters.
        const messagesStub = {
            grades: {
                spring: 'Весенний',
                autumn: 'Осенний',
                semesterFormat: '{start}/{end} — {season}',
            },
        } as unknown as Parameters<typeof getDefaultSemesters>[0];

        afterEach(() => {
            vi.useRealTimers();
        });

        it('returns exactly 4 semesters', () => {
            const result = getDefaultSemesters(messagesStub);
            expect(result).toHaveLength(4);
        });

        it('generates current period + 3 previous, newest first (autumn anchor)', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 9, 1)); // Oct 2026 → autumn 2026/1
            const result = getDefaultSemesters(messagesStub);
            expect(result.map((s) => ({ year: s.year, semester: s.semester }))).toEqual([
                { year: 2026, semester: 1 },
                { year: 2025, semester: 2 },
                { year: 2025, semester: 1 },
                { year: 2024, semester: 2 },
            ]);
        });

        it('generates from the spring anchor in Feb-Jun', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 2, 10)); // Mar 2026 → spring 2025/2
            const result = getDefaultSemesters(messagesStub);
            expect(result.map((s) => ({ year: s.year, semester: s.semester }))).toEqual([
                { year: 2025, semester: 2 },
                { year: 2025, semester: 1 },
                { year: 2024, semester: 2 },
                { year: 2024, semester: 1 },
            ]);
        });

        it('always contains the current date-based period (Aug/Dec/Jan boundaries)', () => {
            vi.useFakeTimers();
            for (const [date, expected] of [
                [new Date(2026, 7, 15), { year: 2026, semester: 1 }], // Aug → upcoming autumn
                [new Date(2026, 11, 20), { year: 2026, semester: 1 }], // Dec → autumn session
                [new Date(2027, 0, 10), { year: 2026, semester: 1 }], // Jan → autumn tail
            ] as const) {
                vi.setSystemTime(date);
                const result = getDefaultSemesters(messagesStub);
                expect(result.some((s) => s.year === expected.year && s.semester === expected.semester)).toBe(true);
            }
        });

        it('formats labels using messages.grades.semesterFormat template', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 9, 1)); // Oct 2026
            const result = getDefaultSemesters(messagesStub);
            expect(result[0].label).toBe('2026/2027 — Осенний');
            expect(result[1].label).toBe('2025/2026 — Весенний');
        });

        it('renders different labels per language (uses passed-in messages)', () => {
            vi.useFakeTimers();
            vi.setSystemTime(new Date(2026, 9, 1)); // Oct 2026
            const enStub = {
                grades: {
                    spring: 'Spring',
                    autumn: 'Fall',
                    semesterFormat: '{start}/{end} — {season}',
                },
            } as unknown as Parameters<typeof getDefaultSemesters>[0];
            const result = getDefaultSemesters(enStub);
            expect(result[0].label).toBe('2026/2027 — Fall');
            expect(result[1].label).toBe('2025/2026 — Spring');
        });
    });
});
