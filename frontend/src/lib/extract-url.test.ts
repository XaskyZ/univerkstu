import { describe, it, expect } from 'vitest';
import { extractFirstUrl } from './extract-url';

describe('extractFirstUrl', () => {
    it('returns null for empty / null / undefined input', () => {
        expect(extractFirstUrl(null)).toBeNull();
        expect(extractFirstUrl(undefined)).toBeNull();
        expect(extractFirstUrl('')).toBeNull();
    });

    it('returns null when no URL is present', () => {
        expect(extractFirstUrl('plain text with no links')).toBeNull();
        expect(extractFirstUrl('email@example.com is not a URL')).toBeNull();
    });

    it('extracts a simple https URL', () => {
        expect(extractFirstUrl('see https://example.com here')).toBe('https://example.com');
    });

    it('extracts http URLs (not only https)', () => {
        expect(extractFirstUrl('legacy http://example.com link')).toBe('http://example.com');
    });

    it('returns only the first URL when multiple are present', () => {
        expect(extractFirstUrl('https://a.com and https://b.com')).toBe('https://a.com');
    });

    it('strips trailing sentence punctuation', () => {
        expect(extractFirstUrl('see https://example.com.')).toBe('https://example.com');
        expect(extractFirstUrl('see https://example.com,')).toBe('https://example.com');
        expect(extractFirstUrl('see https://example.com!')).toBe('https://example.com');
        expect(extractFirstUrl('see https://example.com?')).toBe('https://example.com');
    });

    it('strips a single trailing closing paren', () => {
        expect(extractFirstUrl('(https://example.com)')).toBe('https://example.com');
    });

    it('preserves query strings + paths', () => {
        expect(extractFirstUrl('check https://example.com/a/b?x=1&y=2'))
            .toBe('https://example.com/a/b?x=1&y=2');
    });

    it('ignores non-http schemes', () => {
        expect(extractFirstUrl('ftp://example.com path')).toBeNull();
        expect(extractFirstUrl('mailto:user@example.com')).toBeNull();
        expect(extractFirstUrl('javascript:alert(1)')).toBeNull();
    });

    it('handles URLs at the start of the string', () => {
        expect(extractFirstUrl('https://start.example.com is first'))
            .toBe('https://start.example.com');
    });

    it('handles URLs at the end of the string', () => {
        expect(extractFirstUrl('end with https://end.example.com'))
            .toBe('https://end.example.com');
    });

    it('handles URLs followed by quotes', () => {
        expect(extractFirstUrl('"https://example.com" is quoted')).toBe('https://example.com');
    });

    it('handles non-string input gracefully', () => {
        // @ts-expect-error — runtime safety check: callers may pass arbitrary
        // values through React render guards; we treat anything non-string as
        // "no URL present".
        expect(extractFirstUrl(42)).toBeNull();
        // @ts-expect-error — same as above for plain objects
        expect(extractFirstUrl({})).toBeNull();
    });
});
