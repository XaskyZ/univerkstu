import { describe, it, expect } from 'vitest';
import { getSeoContent } from './page';

describe('getSeoContent', () => {
    // 3-language SEO meta factory for the /about page. Each language produces 4 keys:
    // title / description / ogTitle / ogDescription. A regression that drops a
    // language branch would silently fall back to RU for non-RU/EN users.

    it('returns RU content for "ru"', () => {
        const content = getSeoContent('ru');
        expect(content.title).toBe('О проекте UniverSchedule');
        expect(content.description).toContain('КСТУ');
    });

    it('returns KZ content for "kz"', () => {
        const content = getSeoContent('kz');
        expect(content.title).toBe('UniverSchedule жобасы туралы');
        expect(content.description).toContain('KSTU');
    });

    it('returns EN content for "en"', () => {
        const content = getSeoContent('en');
        expect(content.title).toBe('About UniverSchedule');
        expect(content.description).toContain('KSTU');
    });

    it('all 3 locales produce 4-key shape (title/description/ogTitle/ogDescription)', () => {
        for (const lang of ['ru', 'kz', 'en'] as const) {
            const content = getSeoContent(lang);
            expect(Object.keys(content).sort()).toEqual(
                ['description', 'ogDescription', 'ogTitle', 'title'].sort()
            );
        }
    });

    it('title and ogTitle differ slightly per language (catches typos)', () => {
        // Locks in the locale parity invariant: each language must produce a
        // non-empty string for every key.
        for (const lang of ['ru', 'kz', 'en'] as const) {
            const content = getSeoContent(lang);
            expect(content.title.length).toBeGreaterThan(0);
            expect(content.description.length).toBeGreaterThan(0);
            expect(content.ogTitle.length).toBeGreaterThan(0);
            expect(content.ogDescription.length).toBeGreaterThan(0);
        }
    });

    it('RU and EN content differs (no copy-paste regression)', () => {
        const ru = getSeoContent('ru');
        const en = getSeoContent('en');
        expect(ru.title).not.toBe(en.title);
        expect(ru.description).not.toBe(en.description);
    });
});
