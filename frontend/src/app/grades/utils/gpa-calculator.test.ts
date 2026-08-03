import { describe, it, expect } from 'vitest';
import {
    DEFAULT_WEIGHTS,
    computeGpaSummary,
    computeSubjectTotal,
    getLetterGrade,
    isValidScore,
    normalizeWeights,
    type GpaSubjectInput,
} from './gpa-calculator';

function makeSubject(overrides: Partial<GpaSubjectInput> = {}): GpaSubjectInput {
    return {
        id: 'test',
        name: 'Test subject',
        rk1: null,
        rk2: null,
        final: null,
        weights: { ...DEFAULT_WEIGHTS },
        ...overrides,
    };
}

describe('isValidScore', () => {
    it('accepts null (not entered)', () => {
        expect(isValidScore(null)).toBe(true);
    });

    it('accepts 0 and 100 (boundary)', () => {
        expect(isValidScore(0)).toBe(true);
        expect(isValidScore(100)).toBe(true);
    });

    it('rejects negative numbers', () => {
        expect(isValidScore(-1)).toBe(false);
    });

    it('rejects values above 100', () => {
        expect(isValidScore(101)).toBe(false);
    });

    it('rejects NaN and Infinity', () => {
        expect(isValidScore(Number.NaN)).toBe(false);
        expect(isValidScore(Number.POSITIVE_INFINITY)).toBe(false);
    });
});

describe('computeSubjectTotal', () => {
    it('returns null when any score is missing', () => {
        expect(computeSubjectTotal(makeSubject({ rk1: 80, rk2: 80 }))).toBeNull();
        expect(computeSubjectTotal(makeSubject({ rk1: 80, final: 80 }))).toBeNull();
        expect(computeSubjectTotal(makeSubject({ rk2: 80, final: 80 }))).toBeNull();
    });

    it('computes weighted total with default 30/30/40 weights', () => {
        const subject = makeSubject({ rk1: 100, rk2: 100, final: 100 });
        expect(computeSubjectTotal(subject)).toBe(100);
    });

    it('computes a mixed-score example correctly', () => {
        // 60 * 0.3 + 70 * 0.3 + 80 * 0.4 = 18 + 21 + 32 = 71
        const subject = makeSubject({ rk1: 60, rk2: 70, final: 80 });
        expect(computeSubjectTotal(subject)).toBe(71);
    });

    it('respects custom weights', () => {
        // 100 * 0.5 + 0 * 0.5 + 0 * 0 = 50
        const subject = makeSubject({
            rk1: 100,
            rk2: 0,
            final: 0,
            weights: { rk1: 0.5, rk2: 0.5, final: 0 },
        });
        expect(computeSubjectTotal(subject)).toBe(50);
    });

    it('returns null when any score is out of [0, 100]', () => {
        expect(computeSubjectTotal(makeSubject({ rk1: 120, rk2: 80, final: 80 }))).toBeNull();
        expect(computeSubjectTotal(makeSubject({ rk1: 80, rk2: -5, final: 80 }))).toBeNull();
    });
});

describe('getLetterGrade', () => {
    it('returns dash for null', () => {
        expect(getLetterGrade(null)).toEqual({ letter: '—', gpa: null });
    });

    it('returns A for 95+', () => {
        expect(getLetterGrade(95)).toEqual({ letter: 'A', gpa: 4.0 });
        expect(getLetterGrade(100)).toEqual({ letter: 'A', gpa: 4.0 });
    });

    it('returns A- for 90..94', () => {
        expect(getLetterGrade(90).letter).toBe('A-');
        expect(getLetterGrade(94).letter).toBe('A-');
    });

    it('returns B-band letters at exact lower bounds', () => {
        // Boundary regression: bumping to a new band must happen exactly at the
        // documented threshold (otherwise students see a different letter than
        // Platonus does for the same total).
        expect(getLetterGrade(85).letter).toBe('B+');
        expect(getLetterGrade(80).letter).toBe('B');
        expect(getLetterGrade(75).letter).toBe('B-');
    });

    it('returns C-band letters at exact lower bounds', () => {
        expect(getLetterGrade(70).letter).toBe('C+');
        expect(getLetterGrade(65).letter).toBe('C');
        expect(getLetterGrade(60).letter).toBe('C-');
    });

    it('returns D for 50..59 and F below 50', () => {
        expect(getLetterGrade(55).letter).toBe('D+');
        expect(getLetterGrade(50).letter).toBe('D');
        expect(getLetterGrade(49).letter).toBe('F');
        expect(getLetterGrade(49)).toEqual({ letter: 'F', gpa: 0 });
        expect(getLetterGrade(0)).toEqual({ letter: 'F', gpa: 0 });
    });
});

describe('computeGpaSummary', () => {
    it('returns null averages for an empty list', () => {
        const summary = computeGpaSummary([]);
        expect(summary.averageGpa).toBeNull();
        expect(summary.averageTotal).toBeNull();
        expect(summary.subjects).toEqual([]);
    });

    it('handles a single 100/100/100 subject', () => {
        const summary = computeGpaSummary([makeSubject({ rk1: 100, rk2: 100, final: 100 })]);
        expect(summary.subjects).toHaveLength(1);
        expect(summary.subjects[0].total).toBe(100);
        expect(summary.subjects[0].letter).toBe('A');
        expect(summary.subjects[0].gpa).toBe(4.0);
        expect(summary.averageTotal).toBe(100);
        expect(summary.averageGpa).toBe(4.0);
    });

    it('averages a mixed list and ignores incomplete subjects', () => {
        const summary = computeGpaSummary([
            // total = 71 → C+ (2.33)
            makeSubject({ id: 'a', rk1: 60, rk2: 70, final: 80 }),
            // total = 100 → A (4.0)
            makeSubject({ id: 'b', rk1: 100, rk2: 100, final: 100 }),
            // incomplete — excluded from averages but still listed
            makeSubject({ id: 'c', rk1: 80 }),
        ]);
        expect(summary.subjects).toHaveLength(3);
        expect(summary.subjects[2].total).toBeNull();
        expect(summary.subjects[2].gpa).toBeNull();
        expect(summary.averageTotal).toBeCloseTo((71 + 100) / 2, 5);
        expect(summary.averageGpa).toBeCloseTo((2.33 + 4.0) / 2, 5);
    });

    it('reports F band when all scores are below admission', () => {
        const summary = computeGpaSummary([
            makeSubject({ id: 'fail-1', rk1: 30, rk2: 40, final: 40 }),
        ]);
        // 30*0.3 + 40*0.3 + 40*0.4 = 9 + 12 + 16 = 37 → F
        expect(summary.subjects[0].total).toBeCloseTo(37, 5);
        expect(summary.subjects[0].letter).toBe('F');
        expect(summary.averageGpa).toBe(0);
    });

    it('honours per-subject custom weights independently', () => {
        const summary = computeGpaSummary([
            makeSubject({
                id: 'equal',
                rk1: 90,
                rk2: 90,
                final: 90,
                weights: { rk1: 1 / 3, rk2: 1 / 3, final: 1 / 3 },
            }),
            makeSubject({
                id: 'final-only',
                rk1: 0,
                rk2: 0,
                final: 100,
                weights: { rk1: 0, rk2: 0, final: 1 },
            }),
        ]);
        expect(summary.subjects[0].total).toBeCloseTo(90, 5);
        expect(summary.subjects[1].total).toBe(100);
    });
});

describe('normalizeWeights', () => {
    it('returns defaults when sum is non-positive or NaN', () => {
        expect(normalizeWeights({ rk1: 0, rk2: 0, final: 0 })).toEqual(DEFAULT_WEIGHTS);
        expect(normalizeWeights({ rk1: Number.NaN, rk2: 0.3, final: 0.4 })).toEqual(DEFAULT_WEIGHTS);
    });

    it('returns the input untouched when it already sums to 1', () => {
        const w = { rk1: 0.2, rk2: 0.3, final: 0.5 };
        expect(normalizeWeights(w)).toEqual(w);
    });

    it('scales values so they sum to 1', () => {
        // 30/30/40 expressed as percents → must come back as 0.3/0.3/0.4
        const normalized = normalizeWeights({ rk1: 30, rk2: 30, final: 40 });
        expect(normalized.rk1).toBeCloseTo(0.3, 5);
        expect(normalized.rk2).toBeCloseTo(0.3, 5);
        expect(normalized.final).toBeCloseTo(0.4, 5);
    });
});
