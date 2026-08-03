import { describe, it, expect } from 'vitest';
import sitemap from './sitemap';

describe('sitemap()', () => {
    const entries = sitemap();

    it('returns an array of route entries', () => {
        expect(Array.isArray(entries)).toBe(true);
        expect(entries.length).toBeGreaterThan(0);
    });

    it('every entry has url + lastModified + changeFrequency + priority', () => {
        for (const entry of entries) {
            expect(typeof entry.url).toBe('string');
            expect(entry.url.length).toBeGreaterThan(0);
            expect(entry.lastModified).toBeInstanceOf(Date);
            expect(typeof entry.changeFrequency).toBe('string');
            expect(typeof entry.priority).toBe('number');
            expect(entry.priority).toBeGreaterThan(0);
            expect(entry.priority).toBeLessThanOrEqual(1);
        }
    });

    it('home route has highest priority (1.0)', () => {
        const home = entries.find((e) => e.url.endsWith('/'));
        expect(home?.priority).toBe(1);
    });

    it('home route is the only "daily" entry — others are "weekly"', () => {
        const dailyEntries = entries.filter((e) => e.changeFrequency === 'daily');
        expect(dailyEntries).toHaveLength(1);
        expect(dailyEntries[0].url).toMatch(/\/$/);

        const weeklyEntries = entries.filter((e) => e.changeFrequency === 'weekly');
        expect(weeklyEntries.length).toBe(entries.length - 1);
    });

    it('includes all SEO landing routes (Russian keyword paths)', () => {
        const urls = entries.map((e) => e.url);
        const required = [
            '/univer-kstu',
            '/raspisanie-kstu',
            '/vhod-univer-kstu',
            '/kstu-raspisanie-par',
            '/raspisanie-zanyatii-kstu',
            '/ocenki-univer-kstu',
            '/ekzameny-kstu',
            '/login',
            '/about',
        ];
        for (const path of required) {
            expect(urls.some((u) => u.endsWith(path))).toBe(true);
        }
    });

    it('all URLs share the same origin (no mixed-origin entries)', () => {
        const origins = new Set(entries.map((e) => new URL(e.url).origin));
        expect(origins.size).toBe(1);
    });
});
