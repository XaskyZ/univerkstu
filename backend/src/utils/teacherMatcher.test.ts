import { describe, it, expect } from 'vitest';
import { boundedLevenshtein, findTeacherInDb, fuzzyMatchTeacherName } from './teacherMatcher.js';

// Happy-path tests depend on entries actually present in
// `backend/src/data/kstu_staff_data.json`. The names below were picked from
// the first faculty in the file and are stable as of writing.

describe('findTeacherInDb — negative paths', () => {
    it('returns null for empty string', () => {
        expect(findTeacherInDb('')).toBeNull();
    });

    it('returns null for a surname that does not exist in DB', () => {
        expect(findTeacherInDb('Несуществующая Ф.И.')).toBeNull();
    });

    it('returns null when initials disagree with DB', () => {
        // "Абдиева Лаззат Макашевна" → initials Л.М. — wrong initials should fail
        expect(findTeacherInDb('Абдиева Х.Я.')).toBeNull();
    });

    it('returns null when schedule provides more initials than DB has names', () => {
        // DB has "Абдиева Лаззат Макашевна" — 2 name parts after surname.
        // Schedule passing 3 initials cannot match (initials must align positionally).
        expect(findTeacherInDb('Абдиева Л.М.К.')).toBeNull();
    });
});

describe('findTeacherInDb — happy paths', () => {
    it('matches surname + both initials (typical schedule format)', () => {
        // "Абдиева Л.М." → surname "АБДИЕВА", initials [Л, М]
        // Match against "Абдиева Лаззат Макашевна" → initials [Л, М] ✓
        const match = findTeacherInDb('Абдиева Л.М.');
        expect(match).not.toBeNull();
        expect(match?.name).toContain('Абдиева');
        expect(match?.url).toContain('person.kstu.kz');
    });

    it('preserves faculty + department on matched profiles', () => {
        // "Абдиева Лаззат Макашевна" sits under "Горный факультет" → "Кафедра
        // «Разработка месторождений полезных ископаемых»" in the source JSON.
        // The matcher used to flatten that hierarchy and lose both labels; now
        // they should round-trip onto the returned StaffProfile.
        const match = findTeacherInDb('Абдиева Л.М.');
        expect(match).not.toBeNull();
        expect(typeof match?.faculty).toBe('string');
        expect(match?.faculty?.length || 0).toBeGreaterThan(0);
        expect(typeof match?.department).toBe('string');
        expect(match?.department?.length || 0).toBeGreaterThan(0);
    });

    it('exposes faculty/department as optional fields (interface stays backwards compatible)', () => {
        const match = findTeacherInDb('Абдиева');
        expect(match).not.toBeNull();
        // Existing consumers can still destructure {name, url} only — those
        // keys remain present and required.
        expect(match?.name).toBeTruthy();
        expect(match?.url).toBeTruthy();
    });

    it('matches surname + single initial when DB has more name parts', () => {
        // "Абдиева Л." → initials [Л] only — should match since first DB initial is Л
        const match = findTeacherInDb('Абдиева Л.');
        expect(match).not.toBeNull();
        expect(match?.name).toContain('Абдиева');
    });

    it('matches when surname appears as substring inside DB full name', () => {
        // Test the substring-include path: pass the surname only.
        // Schedule "Абдиева" → lastName "АБДИЕВА", no initials → match by substring.
        const match = findTeacherInDb('Абдиева');
        expect(match).not.toBeNull();
        expect(match?.name).toContain('Абдиева');
    });

    it('is case-insensitive on the surname', () => {
        // Both upper and lower case should match — parser uppercases internally.
        const upper = findTeacherInDb('АБДИЕВА Л.М.');
        const lower = findTeacherInDb('абдиева Л.М.');
        expect(upper?.name).toContain('Абдиева');
        expect(lower?.name).toContain('Абдиева');
    });

    it('handles dotted-initial format identically to space-separated', () => {
        // "Абдиева Л.М." (dots become spaces internally) vs "Абдиева Л М"
        const dotted = findTeacherInDb('Абдиева Л.М.');
        const spaced = findTeacherInDb('Абдиева Л М');
        expect(dotted?.name).toBe(spaced?.name);
    });

    it('handles complex (multi-word) surnames via substring include', () => {
        // The parser collects all non-single-char parts into the lastName.
        // For complex surnames like "Қыдырғали ұлы Д." → lastName "ҚЫДЫРҒАЛИ ҰЛЫ" — only
        // matches if DB entry contains that exact substring. Cover the path itself by
        // confirming that a non-existent compound name returns null safely.
        expect(findTeacherInDb('ВыдуманныйСурСурнамыПоиск Х.')).toBeNull();
    });
});

describe('boundedLevenshtein', () => {
    it('returns 0 for identical strings', () => {
        expect(boundedLevenshtein('иванов', 'иванов', 2)).toBe(0);
    });

    it('counts a single substitution', () => {
        expect(boundedLevenshtein('иванов', 'иваноы', 2)).toBe(1);
    });

    it('returns Infinity when distance exceeds threshold', () => {
        expect(boundedLevenshtein('abcdef', 'zyxwvu', 2)).toBe(Infinity);
    });

    it('uses length-delta early-exit', () => {
        expect(boundedLevenshtein('a', 'abcdef', 2)).toBe(Infinity);
    });

    it('handles empty-string cases', () => {
        expect(boundedLevenshtein('', 'ab', 2)).toBe(2);
        expect(boundedLevenshtein('ab', '', 2)).toBe(2);
        expect(boundedLevenshtein('', 'abc', 2)).toBe(Infinity);
    });
});

describe('fuzzyMatchTeacherName', () => {
    const SCHED_RU = ['Иванов И.И.', 'Петров П.П.'];

    it('exact match returns similarity 1', () => {
        const result = fuzzyMatchTeacherName('Иванов И.И.', SCHED_RU);
        expect(result.matched).toBe(true);
        expect(result.similarity).toBe(1);
        expect(result.canonicalCandidate).toBe('Иванов И.И.');
    });

    it('case differs — still matches with similarity 1', () => {
        const result = fuzzyMatchTeacherName('иванов и и', SCHED_RU);
        expect(result.matched).toBe(true);
        expect(result.similarity).toBe(1);
        expect(result.canonicalCandidate).toBe('Иванов И.И.');
    });

    it('initial order swap "И.И. Иванов" matches with sim >= 0.9', () => {
        const result = fuzzyMatchTeacherName('И.И. Иванов', SCHED_RU);
        expect(result.matched).toBe(true);
        expect(result.similarity).toBeGreaterThanOrEqual(0.9);
        expect(result.canonicalCandidate).toBe('Иванов И.И.');
    });

    it('typo in surname "Иваонов И.И" matches with sim >= 0.85', () => {
        const result = fuzzyMatchTeacherName('Иваонов И.И', SCHED_RU);
        expect(result.matched).toBe(true);
        expect(result.similarity).toBeGreaterThanOrEqual(0.85);
        expect(result.canonicalCandidate).toBe('Иванов И.И.');
    });

    it('missing dots "Иванов ИИ" matches with sim >= 0.9', () => {
        const result = fuzzyMatchTeacherName('Иванов ИИ', SCHED_RU);
        expect(result.matched).toBe(true);
        expect(result.similarity).toBeGreaterThanOrEqual(0.9);
        expect(result.canonicalCandidate).toBe('Иванов И.И.');
    });

    it('"Sean Combs" against Russian schedule → not matched', () => {
        const result = fuzzyMatchTeacherName('Sean Combs', SCHED_RU);
        expect(result.matched).toBe(false);
        expect(result.canonicalCandidate).toBeNull();
        expect(result.similarity).toBe(0);
    });

    it('Kazakh letters: "Әсет Н.Қ" matches itself', () => {
        const result = fuzzyMatchTeacherName('Әсет Н.Қ', ['Әсет Н.Қ']);
        expect(result.matched).toBe(true);
        expect(result.similarity).toBe(1);
        expect(result.canonicalCandidate).toBe('Әсет Н.Қ');
    });

    it('empty candidates list returns not matched without crashing', () => {
        const result = fuzzyMatchTeacherName('Иванов И.И.', []);
        expect(result.matched).toBe(false);
        expect(result.canonicalCandidate).toBeNull();
    });

    it('empty input returns not matched', () => {
        const result = fuzzyMatchTeacherName('', SCHED_RU);
        expect(result.matched).toBe(false);
    });

    it('surname-only with distance ≤ 1 matches (handles "Иванов" vs "Иванова")', () => {
        const result = fuzzyMatchTeacherName('Иванова', ['Иванов И.И.']);
        expect(result.matched).toBe(true);
        expect(result.canonicalCandidate).toBe('Иванов И.И.');
    });

    it('different surnames with same initial do not match', () => {
        const result = fuzzyMatchTeacherName('Сидоров И.И.', SCHED_RU);
        expect(result.matched).toBe(false);
    });

    it('picks the best candidate when several pass the threshold', () => {
        const result = fuzzyMatchTeacherName('Иванов И.И.', ['Иваонов И.И.', 'Иванов И.И.']);
        expect(result.matched).toBe(true);
        expect(result.canonicalCandidate).toBe('Иванов И.И.');
        expect(result.similarity).toBe(1);
    });
});
