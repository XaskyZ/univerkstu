import { describe, it, expect } from 'vitest';
import robots from './robots';

describe('robots()', () => {
    const result = robots();

    it('returns sitemap URL', () => {
        expect(typeof result.sitemap).toBe('string');
        expect(String(result.sitemap)).toMatch(/\/sitemap\.xml$/);
    });

    it('returns host that matches sitemap origin', () => {
        const sitemapValue = String(result.sitemap);
        const sitemapOrigin = new URL(sitemapValue).origin;
        expect(result.host).toBe(sitemapOrigin);
    });

    it('rules is a single object — covering all user agents', () => {
        // The type is `Rules | Rules[]`. Our code uses an array; assert the structure.
        const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
        expect(rules).toHaveLength(1);
        expect(rules[0].userAgent).toBe('*');
    });

    it('allows public landing pages', () => {
        const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
        const allow = rules[0].allow as string[];
        expect(allow).toContain('/');
        expect(allow).toContain('/login');
        expect(allow).toContain('/univer-kstu');
        expect(allow).toContain('/raspisanie-kstu');
    });

    it('disallows private app routes', () => {
        const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
        const disallow = rules[0].disallow as string[];
        // Logged-in surfaces must not be crawled — they require auth and aren't useful to search engines.
        const protectedRoutes = ['/schedule', '/exams', '/grades', '/umkd', '/profile', '/settings', '/support'];
        for (const route of protectedRoutes) {
            expect(disallow).toContain(route);
        }
    });

    it('no route appears in both allow and disallow lists', () => {
        const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
        const allow = new Set(rules[0].allow as string[]);
        const disallow = new Set(rules[0].disallow as string[]);
        for (const path of allow) {
            expect(disallow.has(path)).toBe(false);
        }
    });
});
