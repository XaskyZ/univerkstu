import { describe, it, expect } from 'vitest';
import { normalizeCategory } from './feedback.js';

describe('normalizeCategory', () => {
    // Whitelist parser for feedback category. Only 'bug' and 'other' pass through;
    // anything else defaults to 'suggestion' — the safer default since most user
    // feedback is suggestion-shaped. A regression that flips the default would
    // mis-categorize the admin feedback dashboard.

    it('passes through valid "bug"', () => {
        expect(normalizeCategory('bug')).toBe('bug');
    });

    it('passes through valid "other"', () => {
        expect(normalizeCategory('other')).toBe('other');
    });

    it('returns "suggestion" for the explicit "suggestion" string', () => {
        // Although 'suggestion' is the default, it's also a valid value — the
        // function still produces 'suggestion' for it (not by passthrough but by
        // fallthrough). Locks in that the default-and-the-real-suggestion-value
        // produce the same output.
        expect(normalizeCategory('suggestion')).toBe('suggestion');
    });

    it('defaults to "suggestion" for unknown strings', () => {
        expect(normalizeCategory('feature')).toBe('suggestion');
        expect(normalizeCategory('complaint')).toBe('suggestion');
        expect(normalizeCategory('')).toBe('suggestion');
    });

    it('is case-sensitive — uppercase falls back to default', () => {
        expect(normalizeCategory('BUG')).toBe('suggestion');
        expect(normalizeCategory('Bug')).toBe('suggestion');
        expect(normalizeCategory('Other')).toBe('suggestion');
    });

    it('defaults to "suggestion" for non-string inputs', () => {
        expect(normalizeCategory(null)).toBe('suggestion');
        expect(normalizeCategory(undefined)).toBe('suggestion');
        expect(normalizeCategory(0)).toBe('suggestion');
        expect(normalizeCategory(true)).toBe('suggestion');
        expect(normalizeCategory({})).toBe('suggestion');
        expect(normalizeCategory([])).toBe('suggestion');
    });

    it('locks in the 3-value contract (bug/other/suggestion)', () => {
        // Regression guard: catches a future addition of a new category without
        // corresponding admin-dashboard support (would silently default).
        const result = ['bug', 'other', 'suggestion', 'feature', null].map(normalizeCategory);
        expect(result).toEqual(['bug', 'other', 'suggestion', 'suggestion', 'suggestion']);
    });
});
