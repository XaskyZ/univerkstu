import { describe, it, expect } from 'vitest';
import { formatDateTime, getRoleTone } from './utils';

describe('formatDateTime', () => {
    it('returns "—" for null/undefined/empty', () => {
        expect(formatDateTime(null, 'ru-RU')).toBe('—');
        expect(formatDateTime(undefined, 'ru-RU')).toBe('—');
        expect(formatDateTime('', 'ru-RU')).toBe('—');
    });

    it('returns "—" for unparseable date', () => {
        expect(formatDateTime('not a date', 'ru-RU')).toBe('—');
    });

    it('returns a non-empty localized string for a valid ISO', () => {
        const result = formatDateTime('2026-05-13T10:30:00Z', 'ru-RU');
        expect(result).not.toBe('—');
        expect(result.length).toBeGreaterThan(0);
    });
});

describe('getRoleTone', () => {
    it('returns primary tone for "starosta"', () => {
        expect(getRoleTone('starosta')).toEqual({
            background: 'rgba(var(--primary-rgb), 0.18)',
            color: 'var(--primary)',
        });
    });

    it('returns good tone for "helper"', () => {
        expect(getRoleTone('helper')).toEqual({
            background: 'rgba(var(--good-rgb), 0.16)',
            color: 'var(--good)',
        });
    });

    it('returns neutral tone for any other role string', () => {
        expect(getRoleTone('coordinator')).toEqual({
            background: 'var(--surface-overlay-3)',
            color: 'var(--text)',
        });
        expect(getRoleTone('')).toEqual({
            background: 'var(--surface-overlay-3)',
            color: 'var(--text)',
        });
    });
});
