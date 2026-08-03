import { describe, it, expect } from 'vitest';
import { getRevisionHistoryUi } from './revision-history-i18n';

describe('getRevisionHistoryUi', () => {
    const ru = getRevisionHistoryUi('ru');
    const kz = getRevisionHistoryUi('kz');
    const en = getRevisionHistoryUi('en');

    it('returns the same set of keys for ru / kz / en', () => {
        const keys = Object.keys(ru).sort();
        expect(Object.keys(kz).sort()).toEqual(keys);
        expect(Object.keys(en).sort()).toEqual(keys);
    });

    it('every value is a non-empty string', () => {
        for (const obj of [ru, kz, en]) {
            for (const [key, value] of Object.entries(obj)) {
                expect(typeof value, `${key} should be a string`).toBe('string');
                expect((value as string).length, `${key} should be non-empty`).toBeGreaterThan(0);
            }
        }
    });

    it('most ru and en entries differ (not just placeholder copies)', () => {
        const keys = Object.keys(ru) as Array<keyof typeof ru>;
        const identical = keys.filter((k) => ru[k] === en[k]);
        const ratio = identical.length / keys.length;
        expect(ratio, `${identical.length}/${keys.length} ru/en strings identical`).toBeLessThan(0.15);
    });
});
