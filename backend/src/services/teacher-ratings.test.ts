import { describe, it, expect } from 'vitest';
import {
    normalizeWhitespace,
    normalizeTeacherName,
    scoreTeacherName,
    valueToTier,
    normalizeTag,
    normalizeTags,
    isTeacherTier,
} from './teacher-ratings.js';

describe('normalizeWhitespace', () => {
    it('trims surrounding whitespace', () => {
        expect(normalizeWhitespace('  hello  ')).toBe('hello');
        expect(normalizeWhitespace('\thello\n')).toBe('hello');
    });

    it('collapses internal whitespace runs to single spaces', () => {
        expect(normalizeWhitespace('hello    world')).toBe('hello world');
        expect(normalizeWhitespace('a\t\tb\n\nc')).toBe('a b c');
    });

    it('returns empty string for empty/whitespace-only input', () => {
        expect(normalizeWhitespace('')).toBe('');
        expect(normalizeWhitespace('   ')).toBe('');
    });

    it('idempotent: applying twice yields same result', () => {
        const once = normalizeWhitespace('  Hello    World  ');
        expect(normalizeWhitespace(once)).toBe(once);
    });
});

describe('normalizeTeacherName', () => {
    it('lowercases and trims', () => {
        expect(normalizeTeacherName('  Иванов И.И.  ')).toBe('иванов и.и.');
    });

    it('normalizes apostrophe variants (smart quote → straight quote)', () => {
        // Important: teacher names like "O’Brien" / "O'Brien" should collide so duplicates
        // get matched in the directory. The smart quote U+2019 is replaced with ASCII '.
        expect(normalizeTeacherName('O’Brien')).toBe(normalizeTeacherName("O'Brien"));
        expect(normalizeTeacherName('O’Brien')).toBe("o'brien");
    });

    it('removes whitespace around dots in initials', () => {
        // "Иванов И . И ." → "иванов и.и." — initials should be tight.
        expect(normalizeTeacherName('Иванов И . И .')).toBe('иванов и.и.');
        expect(normalizeTeacherName('Аубакиров Н . М')).toBe('аубакиров н.м');
    });

    it('idempotent: applying twice yields same result', () => {
        const once = normalizeTeacherName('  Аубакиров Н . М  ');
        expect(normalizeTeacherName(once)).toBe(once);
    });

    it('preserves Cyrillic characters', () => {
        expect(normalizeTeacherName('Нұрмағанбет')).toBe('нұрмағанбет');
    });
});

describe('scoreTeacherName', () => {
    it('returns 0 on empty query', () => {
        expect(scoreTeacherName('Иванов И.И.', '')).toBe(0);
        expect(scoreTeacherName('Иванов И.И.', '   ')).toBe(0);
    });

    it('exact match scores 1000', () => {
        expect(scoreTeacherName('Иванов И.И.', 'Иванов И.И.')).toBe(1000);
        // case-insensitive via normalization
        expect(scoreTeacherName('Иванов И.И.', 'иванов и.и.')).toBe(1000);
    });

    it('prefix match scores 800', () => {
        expect(scoreTeacherName('Иванов Иван Иванович', 'Иванов')).toBe(800);
        expect(scoreTeacherName('Аубакиров Н.М', 'Ауб')).toBe(800);
    });

    it('substring match (not prefix) scores 600', () => {
        // "Петр" appears mid-name, not at the start
        expect(scoreTeacherName('Иван Петрович', 'Петр')).toBe(600);
    });

    it('per-token matches accumulate at 120 each', () => {
        // Query "Иван Петрович" — neither prefix nor exact substring of "Петрович Иван Сергеевич",
        // but both tokens appear individually → 2 × 120 = 240.
        // Wait: "иван петрович" as a whole IS a substring of "петрович иван сергеевич"? No — the
        // substring check uses the normalized query string verbatim, so token order matters.
        // After normalization: name="петрович иван сергеевич", query="иван петрович".
        // "иван петрович" is NOT a substring of "петрович иван сергеевич".
        // Both tokens "иван" and "петрович" ARE present → 2 × 120 = 240.
        expect(scoreTeacherName('Петрович Иван Сергеевич', 'Иван Петрович')).toBe(240);
    });

    it('no match returns 0', () => {
        expect(scoreTeacherName('Иванов', 'Сидоров')).toBe(0);
    });

    it('partial token match (one of two tokens) scores 120', () => {
        expect(scoreTeacherName('Иван Сергеевич', 'Иван Петрович')).toBe(120);
    });

    it('whitespace and case differences do not block matching', () => {
        // Different whitespace + case → still matches as exact via normalization
        expect(scoreTeacherName('  ИВАНОВ   И.И.  ', 'иванов и.и.')).toBe(1000);
    });
});

describe('valueToTier', () => {
    it('maps high values to S tier', () => {
        expect(valueToTier(7)).toBe('S');
        expect(valueToTier(6.5)).toBe('S'); // exact boundary
        expect(valueToTier(100)).toBe('S'); // unbounded above
    });

    it('maps the canonical tier-midpoints correctly', () => {
        // TIER_VALUE: S=7, A=6, B=5, C=4, D=3, E=2, F=1.
        // valueToTier should round-trip each tier's exact value back to itself.
        expect(valueToTier(7)).toBe('S');
        expect(valueToTier(6)).toBe('A');
        expect(valueToTier(5)).toBe('B');
        expect(valueToTier(4)).toBe('C');
        expect(valueToTier(3)).toBe('D');
        expect(valueToTier(2)).toBe('E');
        expect(valueToTier(1)).toBe('F');
    });

    it('thresholds are inclusive lower bounds (>=)', () => {
        // 6.5 → S, 6.49 → A. Boundary check.
        expect(valueToTier(6.5)).toBe('S');
        expect(valueToTier(6.49)).toBe('A');
        expect(valueToTier(5.5)).toBe('A');
        expect(valueToTier(5.49)).toBe('B');
        expect(valueToTier(1.5)).toBe('E');
        expect(valueToTier(1.49)).toBe('F');
    });

    it('values below 1.5 fall to F', () => {
        expect(valueToTier(1)).toBe('F');
        expect(valueToTier(0)).toBe('F');
        expect(valueToTier(-1)).toBe('F');
    });

    it('fractional values within a tier band stay in that tier', () => {
        expect(valueToTier(6.7)).toBe('S');
        expect(valueToTier(5.9)).toBe('A');
        expect(valueToTier(4.8)).toBe('B');
        expect(valueToTier(3.7)).toBe('C');
    });
});

describe('normalizeTag', () => {
    // Tag normalization for teacher rating tags ("Объясняет понятно", "Строгий", etc.)
    // 40-char cap prevents abuse via mega-tags; whitespace collapse keeps display tidy.

    it('returns null for empty/whitespace-only strings', () => {
        expect(normalizeTag('')).toBe(null);
        expect(normalizeTag('   ')).toBe(null);
        expect(normalizeTag('\t\n')).toBe(null);
    });

    it('trims and collapses internal whitespace', () => {
        expect(normalizeTag('  объясняет  понятно  ')).toBe('объясняет понятно');
    });

    it('caps at 40 chars', () => {
        const longTag = 'A'.repeat(60);
        const result = normalizeTag(longTag);
        expect(result).toBe('A'.repeat(40));
        expect(result!.length).toBe(40);
    });

    it('preserves Cyrillic and emoji within the cap', () => {
        expect(normalizeTag('Топ препод 🔥')).toBe('Топ препод 🔥');
    });
});

describe('normalizeTags', () => {
    // Builds the per-rating tag array. Enforces:
    //   1. Up to MAX_TAGS_PER_RATING=5 distinct tags
    //   2. Case-insensitive deduplication
    //   3. Drops non-strings and post-normalize empties
    //   4. Preserves first-occurrence ordering

    it('returns [] for non-array inputs', () => {
        expect(normalizeTags(null)).toEqual([]);
        expect(normalizeTags(undefined)).toEqual([]);
        expect(normalizeTags('one,two')).toEqual([]);
        expect(normalizeTags({ 0: 'tag' })).toEqual([]);
    });

    it('drops non-string entries silently (defense against malformed JSON body)', () => {
        expect(normalizeTags(['ok', 42, null, undefined, {}, 'fine'])).toEqual(['ok', 'fine']);
    });

    it('drops tags that normalize to empty', () => {
        expect(normalizeTags(['valid', '   ', ''])).toEqual(['valid']);
    });

    it('deduplicates case-insensitively (keeps first occurrence verbatim)', () => {
        expect(normalizeTags(['Топ', 'топ', 'ТОП'])).toEqual(['Топ']);
        // "Friendly" comes first, so "FRIENDLY" and "friendly" are deduped against it.
        expect(normalizeTags(['Friendly', 'FRIENDLY', 'friendly'])).toEqual(['Friendly']);
    });

    it('caps the array at MAX_TAGS_PER_RATING=5', () => {
        const result = normalizeTags(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
        expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
        expect(result.length).toBe(5);
    });

    it('preserves first-occurrence order after dedupe', () => {
        expect(normalizeTags(['c', 'a', 'b', 'a', 'c'])).toEqual(['c', 'a', 'b']);
    });

    it('full pipeline: normalize + dedupe + cap on mixed input', () => {
        const input = ['  Тег 1  ', 'другой', 'ТЕГ 1', null, 'X'.repeat(60), '', 'last'];
        const result = normalizeTags(input);
        // First "Тег 1" wins (whitespace-collapsed → "Тег 1"); "другой" passes; 'ТЕГ 1' duped against 'Тег 1';
        // null dropped; long string capped to 40 chars; empty dropped; 'last' added.
        expect(result).toEqual(['Тег 1', 'другой', 'X'.repeat(40), 'last']);
    });
});

describe('isTeacherTier', () => {
    // Type guard for the S/A/B/C/D/E/F tier letters. Used by route input validation
    // before passing to the rating-submit service.

    it('returns true for valid tier letters', () => {
        for (const tier of ['S', 'A', 'B', 'C', 'D', 'E', 'F']) {
            expect(isTeacherTier(tier)).toBe(true);
        }
    });

    it('is case-sensitive — lowercase rejected', () => {
        // Documents the case-sensitive contract — route validation must send uppercase.
        expect(isTeacherTier('s')).toBe(false);
        expect(isTeacherTier('a')).toBe(false);
    });

    it('rejects unknown tier letters', () => {
        expect(isTeacherTier('G')).toBe(false);
        expect(isTeacherTier('Z')).toBe(false);
        expect(isTeacherTier('')).toBe(false);
    });

    it('rejects non-string inputs', () => {
        expect(isTeacherTier(null)).toBe(false);
        expect(isTeacherTier(undefined)).toBe(false);
        expect(isTeacherTier(0)).toBe(false);
        expect(isTeacherTier({})).toBe(false);
        expect(isTeacherTier(['A'])).toBe(false);
    });
});
