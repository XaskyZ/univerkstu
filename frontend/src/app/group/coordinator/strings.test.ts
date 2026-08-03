import { describe, it, expect } from 'vitest';
import { getUi, getStatLabels } from './strings';

describe('getUi (coordinator)', () => {
    const ru = getUi('ru');
    const kz = getUi('kz');
    const en = getUi('en');

    it('returns an object for each of ru/kz/en', () => {
        for (const obj of [ru, kz, en]) {
            expect(obj).toBeTypeOf('object');
            expect(obj).not.toBeNull();
        }
    });

    it('all three languages produce the same keys (translation parity)', () => {
        const ruKeys = Object.keys(ru).sort();
        expect(Object.keys(kz).sort()).toEqual(ruKeys);
        expect(Object.keys(en).sort()).toEqual(ruKeys);
    });

    it('string-typed entries differ between ru and en (<10% identical)', () => {
        const ruRec = ru as unknown as Record<string, unknown>;
        const enRec = en as unknown as Record<string, unknown>;
        const stringKeys = Object.keys(ru).filter((k) => typeof ruRec[k] === 'string');
        const identical = stringKeys.filter((k) => ruRec[k] === enRec[k]);
        expect(identical.length / stringKeys.length).toBeLessThan(0.1);
    });

    it('snapshot a couple of known UI strings', () => {
        // Top of each language: the panel title — translated three distinct ways.
        expect(en.title).toBe('Coordinator workspace');
        expect(typeof ru.title).toBe('string');
        expect(typeof kz.title).toBe('string');
        expect(en.title).not.toBe(ru.title);
        expect(en.title).not.toBe(kz.title);
    });

    it('every value is either string or array — no nested object leaks', () => {
        for (const obj of [ru, kz, en]) {
            for (const [key, value] of Object.entries(obj)) {
                const ok = typeof value === 'string' || Array.isArray(value) || typeof value === 'function';
                expect(ok, `${key} should be string|array|fn, got ${typeof value}`).toBe(true);
            }
        }
    });
});

describe('getStatLabels (coordinator)', () => {
    const ru = getStatLabels('ru');
    const kz = getStatLabels('kz');
    const en = getStatLabels('en');

    it('returns an object for each of ru/kz/en', () => {
        for (const obj of [ru, kz, en]) {
            expect(obj).toBeTypeOf('object');
            expect(obj).not.toBeNull();
        }
    });

    it('all three languages produce the same keys', () => {
        const ruKeys = Object.keys(ru).sort();
        expect(Object.keys(kz).sort()).toEqual(ruKeys);
        expect(Object.keys(en).sort()).toEqual(ruKeys);
    });

    it('string-typed entries differ between ru and en', () => {
        const ruRec = ru as unknown as Record<string, unknown>;
        const enRec = en as unknown as Record<string, unknown>;
        const stringKeys = Object.keys(ru).filter((k) => typeof ruRec[k] === 'string');
        const identical = stringKeys.filter((k) => ruRec[k] === enRec[k]);
        expect(identical.length / stringKeys.length).toBeLessThan(0.5);
    });
});
