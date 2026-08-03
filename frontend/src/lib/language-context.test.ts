import { describe, it, expect } from 'vitest';
import { formatMessage } from './language-context';

describe('formatMessage', () => {
    it('replaces a single placeholder', () => {
        expect(formatMessage('Hello {name}', { name: 'Alice' })).toBe('Hello Alice');
    });

    it('replaces multiple placeholders', () => {
        expect(formatMessage('{a} + {b} = {c}', { a: 1, b: 2, c: 3 })).toBe('1 + 2 = 3');
    });

    it('coerces numbers to strings', () => {
        expect(formatMessage('count: {n}', { n: 42 })).toBe('count: 42');
        expect(formatMessage('zero: {n}', { n: 0 })).toBe('zero: 0');
    });

    it('returns the template unchanged when values map is empty', () => {
        expect(formatMessage('Hello {name}', {})).toBe('Hello {name}');
    });

    it('ignores values whose placeholder is not in the template', () => {
        expect(formatMessage('Hi {a}', { a: 'X', b: 'unused' })).toBe('Hi X');
    });

    it('only replaces the first occurrence per key (String.prototype.replace semantics)', () => {
        // `String.replace(literal, value)` replaces only the first match. The current
        // implementation relies on this — covering it lets us catch regressions if
        // someone migrates to `replaceAll` without thinking through the contract.
        expect(formatMessage('{x} and {x}', { x: 'X' })).toBe('X and {x}');
    });

    it('handles unicode + emoji in both template and value', () => {
        expect(formatMessage('Привет, {name}! 🎉', { name: 'Әбілай' })).toBe('Привет, Әбілай! 🎉');
    });

    it('returns the template unchanged when placeholder is missing from template', () => {
        expect(formatMessage('No placeholders here', { x: 1, y: 2 })).toBe('No placeholders here');
    });

    it('treats {key} as literal text — partial / surrounding text preserved', () => {
        expect(formatMessage('[before] {key} [after]', { key: 'MID' })).toBe('[before] MID [after]');
    });

    it('preserves curly braces if no matching key', () => {
        expect(formatMessage('keep {this} as-is', {})).toBe('keep {this} as-is');
    });
});
