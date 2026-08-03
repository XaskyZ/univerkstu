import { describe, it, expect } from 'vitest';
import { formatUpdatedAt, formatLeaderboardDuration } from './formatters';

describe('formatUpdatedAt', () => {
    it('returns "—" for unparseable input', () => {
        expect(formatUpdatedAt('garbage', 'ru')).toBe('—');
        expect(formatUpdatedAt('', 'ru')).toBe('—');
    });

    it('returns a non-empty formatted string for valid ISO (any lang)', () => {
        // Locale-specific formatting varies by ICU/Intl impl — assert non-empty + not the fallback.
        for (const lang of ['ru', 'kz', 'en']) {
            const result = formatUpdatedAt('2026-05-13T10:30:00Z', lang);
            expect(result).not.toBe('—');
            expect(result.length).toBeGreaterThan(0);
        }
    });

    it('locale selection: kk-KZ on lang=kz, en-US on lang=en, ru-RU otherwise', () => {
        const ruResult = formatUpdatedAt('2026-05-13T10:30:00Z', 'ru');
        const enResult = formatUpdatedAt('2026-05-13T10:30:00Z', 'en');
        // English typically uses `/` separators, Russian typically uses `.` — these chosen formats
        // differ enough that we can sanity-check they're not byte-identical.
        expect(ruResult).not.toBe(enResult);
    });
});

describe('formatLeaderboardDuration', () => {
    it('always shows hours + minutes, regardless of magnitude', () => {
        expect(formatLeaderboardDuration(0, 'ru')).toBe('0 ч 0 мин');
        expect(formatLeaderboardDuration(45 * 60, 'ru')).toBe('0 ч 45 мин');
        expect(formatLeaderboardDuration(3 * 3600 + 25 * 60, 'ru')).toBe('3 ч 25 мин');
    });

    it('clamps negatives to 0', () => {
        expect(formatLeaderboardDuration(-100, 'ru')).toBe('0 ч 0 мин');
    });

    it('rounds fractional seconds', () => {
        expect(formatLeaderboardDuration(3 * 3600 + 25 * 60 + 0.9, 'ru')).toBe('3 ч 25 мин');
    });

    it('Kazakh labels', () => {
        expect(formatLeaderboardDuration(3 * 3600 + 25 * 60, 'kz')).toBe('3 сағ 25 мин');
    });

    it('English labels', () => {
        expect(formatLeaderboardDuration(3 * 3600 + 25 * 60, 'en')).toBe('3 h 25 min');
    });

    it('unknown language falls through to Russian', () => {
        expect(formatLeaderboardDuration(3 * 3600 + 25 * 60, 'xx')).toBe('3 ч 25 мин');
    });
});
