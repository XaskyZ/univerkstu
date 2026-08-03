/**
 * Tests focus on the pure helpers exported alongside `useFocusHighlight`.
 *
 * The hook itself is a thin orchestration layer around `setTimeout`,
 * `scrollIntoView`, and React state — the repo convention is to skip
 * React-hook tests in vitest (see AGENTS.md "What not to test"). The
 * load-bearing pieces are extracted as pure functions / exported
 * constants so they can be covered without a DOM stub.
 */
import { describe, it, expect } from 'vitest';
import {
    ENTITY_HIGHLIGHT_DURATION_MS,
    readFocusFromQuery,
} from './use-focus-highlight';

describe('readFocusFromQuery', () => {
    it('reads the focus id from a URLSearchParams instance', () => {
        const params = new URLSearchParams({ focus: 'abc-123' });
        expect(readFocusFromQuery(params)).toBe('abc-123');
    });

    it('reads the focus id from a raw query string', () => {
        expect(readFocusFromQuery('?focus=abc-123&other=ignored')).toBe('abc-123');
    });

    it('handles a leading-? query string', () => {
        expect(readFocusFromQuery('?focus=abc')).toBe('abc');
    });

    it('returns null when the focus param is missing', () => {
        expect(readFocusFromQuery('?other=1')).toBeNull();
    });

    it('returns null for empty string input', () => {
        expect(readFocusFromQuery('')).toBeNull();
    });

    it('returns null for whitespace-only focus values', () => {
        expect(readFocusFromQuery('?focus=%20%20%20')).toBeNull();
    });

    it('trims surrounding whitespace from a valid focus id', () => {
        const params = new URLSearchParams();
        params.set('focus', '  abc  ');
        expect(readFocusFromQuery(params)).toBe('abc');
    });

    it('returns null when given null/undefined', () => {
        expect(readFocusFromQuery(null)).toBeNull();
        expect(readFocusFromQuery(undefined)).toBeNull();
    });
});

describe('ENTITY_HIGHLIGHT_DURATION_MS', () => {
    it('matches the CSS keyframe duration (3 seconds)', () => {
        // The CSS animation runs for 3s; the JS timer that flips the class
        // off must match. If a future change bumps the keyframe duration
        // the constant must move with it — this test pins them together.
        expect(ENTITY_HIGHLIGHT_DURATION_MS).toBe(3000);
    });
});
