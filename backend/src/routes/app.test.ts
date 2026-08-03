import { describe, it, expect } from 'vitest';
import { toDate, resolveFreshness } from './app.js';

describe('toDate', () => {
    it('returns null for null/undefined/empty inputs', () => {
        expect(toDate(null)).toBe(null);
        expect(toDate(undefined)).toBe(null);
        expect(toDate('')).toBe(null);
    });

    it('passes through Date instances', () => {
        const d = new Date('2026-05-13T10:00:00Z');
        expect(toDate(d)).toBe(d); // identity, not a clone
    });

    it('parses ISO date strings', () => {
        const result = toDate('2026-05-13T10:00:00Z');
        expect(result).toBeInstanceOf(Date);
        expect(result?.toISOString()).toBe('2026-05-13T10:00:00.000Z');
    });

    it('returns null for unparseable strings', () => {
        expect(toDate('not a date')).toBe(null);
        expect(toDate('hello world')).toBe(null);
    });

    it('returns null for falsy 0 (number-coerced)', () => {
        // 0 is falsy → early-exit `if (!value)` returns null.
        // Note: this is different from `services/group-space.ts:toDateOrNull` which uses
        // the same shape but treats numeric input as String()-parse (also null but for a
        // different reason). Documenting the consistent "0 → null" behavior here.
        expect(toDate(0 as unknown as Date | string)).toBe(null);
    });
});

describe('resolveFreshness', () => {
    const NOW = Date.now();

    it('returns "missing" when neither cachedAt nor expiresAt is set', () => {
        expect(resolveFreshness({})).toBe('missing');
        expect(resolveFreshness({ cachedAt: null, expiresAt: null })).toBe('missing');
        expect(resolveFreshness({ cachedAt: '', expiresAt: '' })).toBe('missing');
    });

    it('returns "cached" when expiresAt is in the future', () => {
        const futureExpiry = new Date(NOW + 5 * 60 * 1000); // +5 min
        expect(resolveFreshness({
            cachedAt: new Date(NOW - 60_000),
            expiresAt: futureExpiry,
        })).toBe('cached');
    });

    it('returns "stale" when expiresAt is in the past', () => {
        const pastExpiry = new Date(NOW - 60_000);
        expect(resolveFreshness({
            cachedAt: new Date(NOW - 5 * 60 * 1000),
            expiresAt: pastExpiry,
        })).toBe('stale');
    });

    it('returns "stale" when only cachedAt is present (no expiresAt at all)', () => {
        // The "cached" branch requires expiresAt > now. Without it, falls through to stale.
        expect(resolveFreshness({
            cachedAt: new Date(NOW - 60_000),
        })).toBe('stale');
    });

    describe('"warm" path (allowWarm + warmReferenceAt + recent cache)', () => {
        it('returns "warm" when allowWarm + cached close to warmReference + recent', () => {
            // warm requires ALL of: allowWarm=true, cachedAt + warmReferenceAt set,
            // cachedAt >= warmReferenceAt - 30s (i.e. cache was created near the reference),
            // and now - cachedAt <= 5 min (i.e. cache is recent).
            const reference = new Date(NOW - 60_000); // 1 min ago
            const cached = new Date(NOW - 50_000); // 10s after reference, still 5min<old
            expect(resolveFreshness({
                cachedAt: cached,
                expiresAt: new Date(NOW + 60_000),
                warmReferenceAt: reference,
                allowWarm: true,
            })).toBe('warm');
        });

        it('does NOT return "warm" when allowWarm=false (falls back to cached/stale)', () => {
            // allowWarm explicitly false → never warm.
            const reference = new Date(NOW - 60_000);
            const cached = new Date(NOW - 50_000);
            expect(resolveFreshness({
                cachedAt: cached,
                expiresAt: new Date(NOW + 60_000),
                warmReferenceAt: reference,
                allowWarm: false,
            })).toBe('cached');
        });

        it('does NOT return "warm" when cache is older than 5 minutes', () => {
            // The "warm" window is 5 minutes — anything older drops to cached/stale.
            const reference = new Date(NOW - 6 * 60 * 1000); // 6 min ago
            const cached = new Date(NOW - 6 * 60 * 1000 + 10_000); // ~6 min ago too
            expect(resolveFreshness({
                cachedAt: cached,
                expiresAt: new Date(NOW + 60_000),
                warmReferenceAt: reference,
                allowWarm: true,
            })).toBe('cached');
        });

        it('does NOT return "warm" when cachedAt is MORE than 30s before warmReferenceAt', () => {
            // The cachedAt >= warmReferenceAt - 30s guard means the cache must have been
            // created within 30s of (or after) the reference point. A cache created 60s
            // before the reference should NOT count as warm.
            const reference = new Date(NOW - 60_000);
            const cached = new Date(NOW - 60_000 - 60_000); // 60s before reference
            expect(resolveFreshness({
                cachedAt: cached,
                expiresAt: new Date(NOW + 60_000),
                warmReferenceAt: reference,
                allowWarm: true,
            })).toBe('cached');
        });

        it('"warm" overrides "cached" when both apply', () => {
            // Important precedence: even though expiresAt > now (which would normally
            // → cached), warm wins because warm is checked first.
            const reference = new Date(NOW - 10_000);
            const cached = new Date(NOW - 5_000);
            const future = new Date(NOW + 10 * 60 * 1000); // 10 min from now (would be cached)
            expect(resolveFreshness({
                cachedAt: cached,
                expiresAt: future,
                warmReferenceAt: reference,
                allowWarm: true,
            })).toBe('warm');
        });
    });

    it('handles ISO-string inputs (not just Date instances)', () => {
        const future = new Date(NOW + 60_000).toISOString();
        const past = new Date(NOW - 60_000).toISOString();
        expect(resolveFreshness({ cachedAt: past, expiresAt: future })).toBe('cached');
    });
});
