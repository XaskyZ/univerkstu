import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getCanonicalSiteUrl } from './site-url';

const FALLBACK = 'https://univerkstu.app';

beforeEach(() => {
    vi.unstubAllEnvs();
});

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('getCanonicalSiteUrl', () => {
    it('returns fallback when env var unset', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', '');
        expect(getCanonicalSiteUrl()).toBe(FALLBACK);
    });

    it('returns fallback when env var is whitespace-only', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', '   ');
        expect(getCanonicalSiteUrl()).toBe(FALLBACK);
    });

    it('returns fallback when env var is not a valid URL', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'not a url');
        expect(getCanonicalSiteUrl()).toBe(FALLBACK);
    });

    it('passes through a valid https URL', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://example.com');
        expect(getCanonicalSiteUrl()).toBe('https://example.com');
    });

    it('upgrades http to https', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://univerkstu.app');
        expect(getCanonicalSiteUrl()).toBe('https://univerkstu.app');
    });

    it('strips trailing slash', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://univerkstu.app/');
        expect(getCanonicalSiteUrl()).toBe('https://univerkstu.app');
    });

    it('strips hash and query string', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://univerkstu.app/path?utm=1#frag');
        expect(getCanonicalSiteUrl()).toBe('https://univerkstu.app/path');
    });

    it('canonicalizes www.univerkstu.app → univerkstu.app', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.univerkstu.app');
        expect(getCanonicalSiteUrl()).toBe('https://univerkstu.app');
    });

    it('preserves www on other domains (only univerkstu.app is canonicalized)', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://www.example.com');
        expect(getCanonicalSiteUrl()).toBe('https://www.example.com');
    });

    it('trims whitespace around URL', () => {
        vi.stubEnv('NEXT_PUBLIC_SITE_URL', '  https://example.com  ');
        expect(getCanonicalSiteUrl()).toBe('https://example.com');
    });
});
