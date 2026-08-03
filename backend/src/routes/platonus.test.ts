import { describe, it, expect } from 'vitest';
import { collectPreviewKeys } from './platonus.js';

describe('collectPreviewKeys', () => {
    // Admin-diagnostics helper: returns the first 12 (alphabetically sorted) keys of
    // an object. Used to surface a stable preview of arbitrary JSON payloads in
    // diagnostic logs without leaking unbounded data.

    it('returns sorted keys of a plain object', () => {
        expect(collectPreviewKeys({ b: 1, a: 2, c: 3 })).toEqual(['a', 'b', 'c']);
    });

    it('caps output at 12 keys', () => {
        const obj: Record<string, number> = {};
        for (let i = 0; i < 20; i += 1) {
            obj[`k${String(i).padStart(2, '0')}`] = i;
        }
        const result = collectPreviewKeys(obj);
        expect(result).toHaveLength(12);
        expect(result[0]).toBe('k00');
        expect(result[11]).toBe('k11');
    });

    it('returns [] for non-object inputs', () => {
        expect(collectPreviewKeys(null)).toEqual([]);
        expect(collectPreviewKeys(undefined)).toEqual([]);
        expect(collectPreviewKeys('string')).toEqual([]);
        expect(collectPreviewKeys(42)).toEqual([]);
        expect(collectPreviewKeys(true)).toEqual([]);
    });

    it('returns [] for arrays (deliberate — only Records get key preview)', () => {
        // Documents the contract: arrays are NOT treated as objects to preview because
        // their keys are numeric indices, which would be useless in a diagnostic log.
        expect(collectPreviewKeys([1, 2, 3])).toEqual([]);
        expect(collectPreviewKeys([])).toEqual([]);
    });

    it('returns [] for empty object', () => {
        expect(collectPreviewKeys({})).toEqual([]);
    });

    it('preserves Cyrillic + special-char keys verbatim in sorted order', () => {
        // Keys with non-ASCII characters get the same .sort() as ASCII keys.
        // Documents that the sort is lexicographic on UTF-16 code units.
        const result = collectPreviewKeys({
            'Группа': 1,
            'a_field': 2,
            '_underscore': 3,
        });
        expect(result).toHaveLength(3);
        // ASCII sorts before Cyrillic; '_' (0x5F) before letters.
        expect(result[0]).toBe('_underscore');
        expect(result[1]).toBe('a_field');
        expect(result[2]).toBe('Группа');
    });
});
