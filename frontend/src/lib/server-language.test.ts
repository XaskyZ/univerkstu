import { describe, it, expect } from 'vitest';
import { getLanguageLocale, LANGUAGE_COOKIE_KEY } from './server-language';

describe('LANGUAGE_COOKIE_KEY', () => {
    it('is the stable cookie name for app language', () => {
        // The cookie name is shared with server + client + middleware. Locking this with
        // a test catches accidental renames that would silently log everyone out of their
        // language preference.
        expect(LANGUAGE_COOKIE_KEY).toBe('app-language');
    });
});

describe('getLanguageLocale', () => {
    it('maps "ru" → "ru_RU"', () => {
        expect(getLanguageLocale('ru')).toBe('ru_RU');
    });

    it('maps "kz" → "kk_KZ" (Kazakh uses BCP-47 "kk", not "kz")', () => {
        expect(getLanguageLocale('kz')).toBe('kk_KZ');
    });

    it('maps "en" → "en_US"', () => {
        expect(getLanguageLocale('en')).toBe('en_US');
    });
});
