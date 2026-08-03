import { describe, it, expect } from 'vitest';
import {
    buildFeedbackListOrderBy,
    clampFeedbackListLimit,
    clampFeedbackListOffset,
    clampRating,
    normalizeFeedbackCategoryList,
    normalizeFeedbackSort,
    normalizeFeedbackStatus,
    normalizeFeedbackStatusList,
    parseCsvParam,
} from './feedback.js';

describe('clampRating', () => {
    it('returns input unchanged when in [1, 5] range', () => {
        expect(clampRating(1)).toBe(1);
        expect(clampRating(3)).toBe(3);
        expect(clampRating(5)).toBe(5);
    });

    it('clamps to 1 for inputs below 1', () => {
        expect(clampRating(0)).toBe(1);
        expect(clampRating(-5)).toBe(1);
        expect(clampRating(0.4)).toBe(1); // rounds to 0 → clamps to 1
    });

    it('clamps to 5 for inputs above 5', () => {
        expect(clampRating(6)).toBe(5);
        expect(clampRating(10)).toBe(5);
        expect(clampRating(100)).toBe(5);
    });

    it('rounds fractional values', () => {
        expect(clampRating(3.4)).toBe(3);
        expect(clampRating(3.5)).toBe(4); // half-up
        expect(clampRating(3.6)).toBe(4);
        expect(clampRating(4.5)).toBe(5);
    });

    it('handles boundary rounding into clamp', () => {
        // 5.4 → rounds to 5 → stays 5
        expect(clampRating(5.4)).toBe(5);
        // 5.5 → rounds to 6 → clamps to 5
        expect(clampRating(5.5)).toBe(5);
        // 0.5 → rounds to 1 → stays 1 (Math.round half-up)
        expect(clampRating(0.5)).toBe(1);
    });

    it('handles NaN gracefully (Math.round(NaN) = NaN; min/max bubble NaN through)', () => {
        // Math.min(5, Math.max(1, NaN)) = Math.min(5, NaN) = NaN.
        // Documenting current behavior — caller is responsible for filtering NaN first.
        expect(Number.isNaN(clampRating(NaN))).toBe(true);
    });
});

describe('normalizeFeedbackStatus', () => {
    it('returns the canonical status for valid values', () => {
        expect(normalizeFeedbackStatus('new')).toBe('new');
        expect(normalizeFeedbackStatus('planned')).toBe('planned');
        expect(normalizeFeedbackStatus('done')).toBe('done');
        expect(normalizeFeedbackStatus('wontfix')).toBe('wontfix');
    });

    it('falls back to "new" for unknown/missing values', () => {
        expect(normalizeFeedbackStatus(null)).toBe('new');
        expect(normalizeFeedbackStatus(undefined)).toBe('new');
        expect(normalizeFeedbackStatus('garbage')).toBe('new');
        expect(normalizeFeedbackStatus(42)).toBe('new');
    });
});

describe('normalizeFeedbackStatusList', () => {
    it('returns all statuses when input is empty or missing', () => {
        expect(normalizeFeedbackStatusList(undefined)).toEqual(['new', 'planned', 'done', 'wontfix']);
        expect(normalizeFeedbackStatusList(null)).toEqual(['new', 'planned', 'done', 'wontfix']);
        expect(normalizeFeedbackStatusList([])).toEqual(['new', 'planned', 'done', 'wontfix']);
    });

    it('keeps only known statuses and deduplicates', () => {
        expect(normalizeFeedbackStatusList(['new', 'planned', 'planned', 'bogus'])).toEqual(['new', 'planned']);
    });

    it('falls back to all statuses if every entry is invalid', () => {
        expect(normalizeFeedbackStatusList(['nope', 42 as unknown as string])).toEqual(['new', 'planned', 'done', 'wontfix']);
    });
});

describe('normalizeFeedbackCategoryList', () => {
    it('returns all categories by default', () => {
        expect(normalizeFeedbackCategoryList(undefined)).toEqual(['suggestion', 'bug', 'other']);
        expect(normalizeFeedbackCategoryList([])).toEqual(['suggestion', 'bug', 'other']);
    });

    it('keeps only known categories and deduplicates', () => {
        expect(normalizeFeedbackCategoryList(['bug', 'bug', 'suggestion'])).toEqual(['bug', 'suggestion']);
        expect(normalizeFeedbackCategoryList(['unknown'])).toEqual(['suggestion', 'bug', 'other']);
    });
});

describe('normalizeFeedbackSort', () => {
    it('returns the value if known', () => {
        expect(normalizeFeedbackSort('newest')).toBe('newest');
        expect(normalizeFeedbackSort('oldest')).toBe('oldest');
        expect(normalizeFeedbackSort('user')).toBe('user');
    });

    it('falls back to newest for unknown values', () => {
        expect(normalizeFeedbackSort('garbage')).toBe('newest');
        expect(normalizeFeedbackSort(undefined)).toBe('newest');
    });
});

describe('buildFeedbackListOrderBy', () => {
    it('returns expected SQL fragments for each sort', () => {
        expect(buildFeedbackListOrderBy('oldest')).toBe('order by f.created_at asc');
        expect(buildFeedbackListOrderBy('user')).toBe('order by f.user_id asc, f.created_at desc');
        expect(buildFeedbackListOrderBy('newest')).toBe('order by f.created_at desc');
        expect(buildFeedbackListOrderBy(undefined)).toBe('order by f.created_at desc');
    });
});

describe('clampFeedbackListLimit / clampFeedbackListOffset', () => {
    it('defaults limit to 50 when missing or NaN', () => {
        expect(clampFeedbackListLimit(undefined)).toBe(50);
        expect(clampFeedbackListLimit('abc')).toBe(50);
    });

    it('clamps limit into [1, 200]', () => {
        expect(clampFeedbackListLimit(0)).toBe(1);
        expect(clampFeedbackListLimit(-12)).toBe(1);
        expect(clampFeedbackListLimit(500)).toBe(200);
        expect(clampFeedbackListLimit('25')).toBe(25);
    });

    it('defaults offset to 0 and clamps to >= 0', () => {
        expect(clampFeedbackListOffset(undefined)).toBe(0);
        expect(clampFeedbackListOffset(-5)).toBe(0);
        expect(clampFeedbackListOffset('30')).toBe(30);
    });
});

describe('parseCsvParam', () => {
    it('returns undefined for non-string or empty input', () => {
        expect(parseCsvParam(undefined)).toBeUndefined();
        expect(parseCsvParam(null)).toBeUndefined();
        expect(parseCsvParam('')).toBeUndefined();
        expect(parseCsvParam('   ')).toBeUndefined();
    });

    it('splits comma-separated values and trims whitespace', () => {
        expect(parseCsvParam('new,planned')).toEqual(['new', 'planned']);
        expect(parseCsvParam(' new , planned ,  done')).toEqual(['new', 'planned', 'done']);
    });

    it('drops empty segments', () => {
        expect(parseCsvParam('new,,planned,')).toEqual(['new', 'planned']);
    });
});
