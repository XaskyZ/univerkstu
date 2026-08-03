import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    consumeRateLimit,
    pruneRateLimitBuckets,
    rateLimitBucketCount,
    resetRateLimitBuckets,
} from './rateLimit.js';

describe('consumeRateLimit', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2025, 5, 1, 12, 0, 0));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('allows the first request and seeds the window', () => {
        const result = consumeRateLimit('test:fresh-1', 5, 60_000);
        expect(result.allowed).toBe(true);
        expect(result.retryAfterSec).toBe(0);
    });

    it('allows subsequent requests within the limit', () => {
        const key = 'test:within-2';
        for (let i = 0; i < 5; i++) {
            const result = consumeRateLimit(key, 5, 60_000);
            expect(result.allowed).toBe(true);
        }
    });

    it('blocks once the limit is exceeded and reports retryAfter', () => {
        const key = 'test:block-3';
        for (let i = 0; i < 3; i++) consumeRateLimit(key, 3, 60_000);
        const blocked = consumeRateLimit(key, 3, 60_000);
        expect(blocked.allowed).toBe(false);
        expect(blocked.retryAfterSec).toBeGreaterThan(0);
        expect(blocked.retryAfterSec).toBeLessThanOrEqual(60);
    });

    it('retryAfterSec decreases as time passes within the window', () => {
        const key = 'test:retry-shrinks-4';
        for (let i = 0; i < 3; i++) consumeRateLimit(key, 3, 60_000);
        const first = consumeRateLimit(key, 3, 60_000);

        vi.advanceTimersByTime(30_000); // 30s later
        const later = consumeRateLimit(key, 3, 60_000);

        expect(later.allowed).toBe(false);
        expect(later.retryAfterSec).toBeLessThan(first.retryAfterSec);
    });

    it('resets the window once windowMs has elapsed', () => {
        const key = 'test:reset-5';
        for (let i = 0; i < 3; i++) consumeRateLimit(key, 3, 60_000);
        // Limit hit
        expect(consumeRateLimit(key, 3, 60_000).allowed).toBe(false);

        // Advance past the window
        vi.advanceTimersByTime(60_000);

        const fresh = consumeRateLimit(key, 3, 60_000);
        expect(fresh.allowed).toBe(true);
        expect(fresh.retryAfterSec).toBe(0);
    });

    it('keys are independent — one bucket exhausted does not affect another', () => {
        const exhausted = 'test:bucket-a-6';
        const fresh = 'test:bucket-b-6';

        for (let i = 0; i < 3; i++) consumeRateLimit(exhausted, 3, 60_000);
        expect(consumeRateLimit(exhausted, 3, 60_000).allowed).toBe(false);

        expect(consumeRateLimit(fresh, 3, 60_000).allowed).toBe(true);
    });

    it('rounds retryAfterSec up via Math.ceil (1ms-left returns 1s, not 0s)', () => {
        const key = 'test:ceil-7';
        for (let i = 0; i < 3; i++) consumeRateLimit(key, 3, 1_000);

        // After 999ms there's 1ms left in the window — must report 1 second to retry.
        vi.advanceTimersByTime(999);
        const result = consumeRateLimit(key, 3, 1_000);
        expect(result.allowed).toBe(false);
        expect(result.retryAfterSec).toBe(1);
    });

    it('honors maxRequests=1 (only one allowed per window)', () => {
        const key = 'test:max-one-8';
        expect(consumeRateLimit(key, 1, 60_000).allowed).toBe(true);
        expect(consumeRateLimit(key, 1, 60_000).allowed).toBe(false);
    });
});

describe('rate-limit bucket eviction', () => {
    // Keys are per-user / per-IP, so without eviction the map grew for the whole
    // process lifetime: every account that ever hit a limited route stayed
    // resident forever. Expired windows are dead weight — the next call for that
    // key resets them anyway — so they are swept out.

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2025, 5, 1, 12, 0, 0));
        resetRateLimitBuckets();
    });

    afterEach(() => {
        vi.useRealTimers();
        resetRateLimitBuckets();
    });

    it('holds one bucket per distinct key', () => {
        consumeRateLimit('evict:a', 5, 60_000);
        consumeRateLimit('evict:b', 5, 60_000);
        consumeRateLimit('evict:a', 5, 60_000);
        expect(rateLimitBucketCount()).toBe(2);
    });

    it('drops buckets whose window has elapsed', () => {
        consumeRateLimit('evict:old-1', 5, 60_000);
        consumeRateLimit('evict:old-2', 5, 60_000);
        expect(rateLimitBucketCount()).toBe(2);

        vi.advanceTimersByTime(60_001);
        expect(pruneRateLimitBuckets()).toBe(0);
        expect(rateLimitBucketCount()).toBe(0);
    });

    it('keeps buckets that are still inside their window', () => {
        consumeRateLimit('evict:short', 5, 10_000);
        consumeRateLimit('evict:long', 5, 10 * 60_000);

        vi.advanceTimersByTime(30_000);
        pruneRateLimitBuckets();

        // The 10s bucket expired; the 10min bucket must survive.
        expect(rateLimitBucketCount()).toBe(1);
        expect(consumeRateLimit('evict:long', 5, 10 * 60_000).allowed).toBe(true);
    });

    it('sweeps automatically once the sweep interval passes, without a timer', () => {
        for (let i = 0; i < 50; i += 1) {
            consumeRateLimit(`evict:auto-${i}`, 5, 30_000);
        }
        expect(rateLimitBucketCount()).toBe(50);

        // All 50 windows are long dead by now; the next call triggers the sweep.
        vi.advanceTimersByTime(5 * 60_000);
        consumeRateLimit('evict:trigger', 5, 30_000);

        // Only the key that triggered the sweep remains.
        expect(rateLimitBucketCount()).toBe(1);
    });

    it('eviction does not weaken an active limit', () => {
        const key = 'evict:still-limited';
        for (let i = 0; i < 3; i += 1) consumeRateLimit(key, 3, 60_000);

        vi.advanceTimersByTime(1_000);
        pruneRateLimitBuckets();

        // The window is still open, so the bucket survived and still blocks.
        expect(consumeRateLimit(key, 3, 60_000).allowed).toBe(false);
    });

    it('an evicted key starts clean (its next request is allowed)', () => {
        const key = 'evict:reusable';
        for (let i = 0; i < 3; i += 1) consumeRateLimit(key, 3, 60_000);
        expect(consumeRateLimit(key, 3, 60_000).allowed).toBe(false);

        vi.advanceTimersByTime(60_001);
        pruneRateLimitBuckets();
        expect(rateLimitBucketCount()).toBe(0);

        expect(consumeRateLimit(key, 3, 60_000).allowed).toBe(true);
    });
});
