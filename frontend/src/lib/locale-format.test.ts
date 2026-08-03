import { describe, it, expect } from 'vitest';
import { localeTag } from './locale-format';

describe('localeTag', () => {
    it('maps each app language to its BCP-47 tag', () => {
        expect(localeTag('ru')).toBe('ru-RU');
        expect(localeTag('kz')).toBe('kk-KZ');
        expect(localeTag('en')).toBe('en-US');
    });

    it('falls back to Russian for an unknown language', () => {
        expect(localeTag('xx' as never)).toBe('ru-RU');
    });
});
