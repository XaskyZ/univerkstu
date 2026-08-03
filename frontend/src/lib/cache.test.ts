import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    CacheKeys,
    clearCache,
    clearStartupBootstrapMeta,
    getCacheAge,
    getFromCache,
    getStartupBootstrapMeta,
    hasRecentStartupBootstrapBlock,
    saveStartupBootstrapMeta,
    saveToCache,
    type StartupBootstrapMeta,
} from './cache';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

let localStorage: MemoryStorage;
let sessionStorage: MemoryStorage;

beforeEach(() => {
    localStorage = new MemoryStorage();
    sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('getFromCache / saveToCache', () => {
    it('round-trips an object', () => {
        saveToCache('schedule', { foo: 'bar', n: 42 });
        expect(getFromCache<{ foo: string; n: number }>('schedule')).toEqual({ foo: 'bar', n: 42 });
    });

    it('returns null when nothing stored', () => {
        expect(getFromCache('unknown-key')).toBeNull();
    });

    it('returns null and removes entry when version mismatch', () => {
        // Simulate a v0 entry in storage
        localStorage.setItem('cache_test', JSON.stringify({ data: 'old', timestamp: Date.now(), version: 'v0' }));
        expect(getFromCache('test')).toBeNull();
        // entry is removed
        expect(localStorage.getItem('cache_test')).toBeNull();
    });

    it('returns null on corrupt JSON', () => {
        localStorage.setItem('cache_test', 'not-json{{');
        expect(getFromCache('test')).toBeNull();
    });

    it('survives localStorage.setItem failures (quota exceeded etc.)', () => {
        // Mock setItem to throw
        const original = localStorage.setItem.bind(localStorage);
        localStorage.setItem = vi.fn(() => { throw new Error('QuotaExceededError'); });
        // Should not throw — just log internally
        expect(() => saveToCache('schedule', { x: 1 })).not.toThrow();
        localStorage.setItem = original;
    });

    it('respects per-key storage isolation', () => {
        saveToCache('schedule', { a: 1 });
        saveToCache('exams', { b: 2 });
        expect(getFromCache('schedule')).toEqual({ a: 1 });
        expect(getFromCache('exams')).toEqual({ b: 2 });
    });
});

describe('getCacheAge', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-05-13T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns null when key missing', () => {
        expect(getCacheAge('nope')).toBeNull();
    });

    it('returns null on corrupt entry', () => {
        localStorage.setItem('cache_bad', 'not-json{{');
        expect(getCacheAge('bad')).toBeNull();
    });

    it('returns 0 minutes for fresh entry', () => {
        saveToCache('fresh', { v: 1 });
        expect(getCacheAge('fresh')).toBe(0);
    });

    it('returns correct floor of minutes for older entries', () => {
        saveToCache('old', { v: 1 });
        vi.advanceTimersByTime(31 * 60 * 1000); // 31 minutes
        expect(getCacheAge('old')).toBe(31);
    });

    it('floors fractional minutes (89 seconds → 1 min)', () => {
        saveToCache('mid', { v: 1 });
        vi.advanceTimersByTime(89_000);
        expect(getCacheAge('mid')).toBe(1);
    });
});

describe('clearCache', () => {
    it('removes only entries with the cache_ prefix', () => {
        saveToCache('a', { v: 1 });
        saveToCache('b', { v: 2 });
        localStorage.setItem('not-cache-key', 'preserved');
        clearCache();
        expect(localStorage.getItem('cache_a')).toBeNull();
        expect(localStorage.getItem('cache_b')).toBeNull();
        expect(localStorage.getItem('not-cache-key')).toBe('preserved');
    });

    it('handles empty storage gracefully', () => {
        expect(() => clearCache()).not.toThrow();
    });
});

describe('CacheKeys constants', () => {
    it('exposes the canonical cache key names', () => {
        expect(CacheKeys.SCHEDULE).toBe('schedule');
        expect(CacheKeys.EXAMS).toBe('exams');
        expect(CacheKeys.UMKD).toBe('umkd');
        expect(CacheKeys.PROFILE).toBe('profile');
        expect(CacheKeys.ACADEMIC_CONTEXT).toBe('academic_context');
        expect(CacheKeys.PLATONUS_STATUS).toBe('platonus_status');
    });
});

describe('startup bootstrap meta', () => {
    const META: StartupBootstrapMeta = {
        userId: 'u1',
        hydratedAt: 1_700_000_000_000,
        issuedAt: '2024-01-01T00:00:00Z',
        freshness: { schedule: 'warm', exams: 'cached' },
    };

    it('save → get → clear round-trips via sessionStorage', () => {
        saveStartupBootstrapMeta(META);
        expect(getStartupBootstrapMeta()).toEqual(META);
        clearStartupBootstrapMeta();
        expect(getStartupBootstrapMeta()).toBeNull();
    });

    it('getStartupBootstrapMeta returns null when nothing stored', () => {
        expect(getStartupBootstrapMeta()).toBeNull();
    });

    it('getStartupBootstrapMeta returns null on corrupt sessionStorage value', () => {
        sessionStorage.setItem('startup_bootstrap_meta_v1', 'not-json{{');
        expect(getStartupBootstrapMeta()).toBeNull();
    });
});

describe('hasRecentStartupBootstrapBlock', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2025-05-13T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns false when meta missing', () => {
        expect(hasRecentStartupBootstrapBlock('schedule', 60_000)).toBe(false);
    });

    it('returns false when block missing from meta', () => {
        saveStartupBootstrapMeta({
            userId: 'u1', hydratedAt: Date.now(), issuedAt: '',
            freshness: { schedule: 'warm' },
        });
        expect(hasRecentStartupBootstrapBlock('platonusSummary', 60_000)).toBe(false);
    });

    it('returns false when block is "missing"', () => {
        saveStartupBootstrapMeta({
            userId: 'u1', hydratedAt: Date.now(), issuedAt: '',
            freshness: { schedule: 'missing' },
        });
        expect(hasRecentStartupBootstrapBlock('schedule', 60_000)).toBe(false);
    });

    it('returns true for warm/cached/stale within age window', () => {
        for (const status of ['warm', 'cached', 'stale'] as const) {
            saveStartupBootstrapMeta({
                userId: 'u1', hydratedAt: Date.now(), issuedAt: '',
                freshness: { schedule: status },
            });
            expect(hasRecentStartupBootstrapBlock('schedule', 60_000)).toBe(true);
        }
    });

    it('returns false when meta is older than maxAgeMs', () => {
        saveStartupBootstrapMeta({
            userId: 'u1', hydratedAt: Date.now() - 120_000, issuedAt: '',
            freshness: { schedule: 'warm' },
        });
        expect(hasRecentStartupBootstrapBlock('schedule', 60_000)).toBe(false);
    });
});
