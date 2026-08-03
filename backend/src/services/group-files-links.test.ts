import { describe, it, expect } from 'vitest';
import {
    MAX_FILE_DESCRIPTION_LENGTH,
    MAX_FILE_TITLE_LENGTH,
    MAX_LINK_DESCRIPTION_LENGTH,
    MAX_LINK_TITLE_LENGTH,
    MAX_LINK_URL_LENGTH,
    validateGroupLinkUrl,
} from './group-files-links.js';

describe('validateGroupLinkUrl', () => {
    it('accepts http URLs', () => {
        expect(validateGroupLinkUrl('http://example.com/path')).toBe('http://example.com/path');
    });

    it('accepts https URLs', () => {
        expect(validateGroupLinkUrl('https://example.com/path')).toBe('https://example.com/path');
    });

    it('trims surrounding whitespace before validating', () => {
        expect(validateGroupLinkUrl('   https://example.com  ')).toBe('https://example.com');
    });

    it('rejects empty / whitespace-only input', () => {
        expect(() => validateGroupLinkUrl('')).toThrow(/required/i);
        expect(() => validateGroupLinkUrl('   ')).toThrow(/required/i);
    });

    it('rejects javascript: URLs (XSS)', () => {
        // The core anti-abuse check — never let user content turn into executable
        // links in the UI. Same rule the spec explicitly calls out.
        expect(() => validateGroupLinkUrl('javascript:alert(1)')).toThrow(/http or https/i);
        expect(() => validateGroupLinkUrl('  JavaScript:alert(1)  ')).toThrow(/http or https/i);
    });

    it('rejects file:// URLs', () => {
        expect(() => validateGroupLinkUrl('file:///etc/passwd')).toThrow(/http or https/i);
    });

    it('rejects data: URLs', () => {
        expect(() => validateGroupLinkUrl('data:text/html,<script>alert(1)</script>')).toThrow(/http or https/i);
    });

    it('rejects ftp/mailto/chrome and other non-web schemes', () => {
        expect(() => validateGroupLinkUrl('ftp://example.com')).toThrow(/http or https/i);
        expect(() => validateGroupLinkUrl('mailto:user@example.com')).toThrow(/http or https/i);
        expect(() => validateGroupLinkUrl('chrome://settings')).toThrow(/http or https/i);
    });

    it('rejects garbage / not-a-URL input', () => {
        expect(() => validateGroupLinkUrl('not a url')).toThrow(/valid url/i);
        expect(() => validateGroupLinkUrl('://broken')).toThrow(/valid url/i);
    });

    it('rejects URLs longer than MAX_LINK_URL_LENGTH', () => {
        const longUrl = `https://example.com/${'a'.repeat(MAX_LINK_URL_LENGTH)}`;
        expect(longUrl.length).toBeGreaterThan(MAX_LINK_URL_LENGTH);
        expect(() => validateGroupLinkUrl(longUrl)).toThrow(/too long/i);
    });
});

describe('group-files-links length bounds (sanity)', () => {
    // These constants are exported so route schemas / tests can stay in sync
    // with the validator. Pin them so accidental loosening is caught here.
    it('keeps the title/description/url limits the spec asked for', () => {
        expect(MAX_LINK_TITLE_LENGTH).toBe(200);
        expect(MAX_LINK_DESCRIPTION_LENGTH).toBe(500);
        expect(MAX_FILE_TITLE_LENGTH).toBe(200);
        expect(MAX_FILE_DESCRIPTION_LENGTH).toBe(500);
        expect(MAX_LINK_URL_LENGTH).toBeGreaterThanOrEqual(1000);
    });
});
