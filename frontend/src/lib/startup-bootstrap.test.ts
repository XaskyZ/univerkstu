import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { saveStartupBootstrapMeta } from './cache';
import { hasRecentStartupBootstrap, shouldSkipBootstrapRevalidate } from './startup-bootstrap';

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
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-13T12:00:00Z'));
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('hasRecentStartupBootstrap', () => {
    it('returns false when no meta is stored', () => {
        expect(hasRecentStartupBootstrap()).toBe(false);
    });

    it('returns true when hydratedAt is within default 15s window', () => {
        saveStartupBootstrapMeta({
            userId: 'u1',
            hydratedAt: Date.now() - 5_000,
            issuedAt: '',
            freshness: {},
        });
        expect(hasRecentStartupBootstrap()).toBe(true);
    });

    it('returns false when hydratedAt is past the default 15s window', () => {
        saveStartupBootstrapMeta({
            userId: 'u1',
            hydratedAt: Date.now() - 20_000,
            issuedAt: '',
            freshness: {},
        });
        expect(hasRecentStartupBootstrap()).toBe(false);
    });

    it('respects a custom maxAgeMs argument', () => {
        saveStartupBootstrapMeta({
            userId: 'u1',
            hydratedAt: Date.now() - 30_000,
            issuedAt: '',
            freshness: {},
        });
        expect(hasRecentStartupBootstrap(60_000)).toBe(true);
        expect(hasRecentStartupBootstrap(5_000)).toBe(false);
    });
});

describe('shouldSkipBootstrapRevalidate', () => {
    it('returns false when no meta', () => {
        expect(shouldSkipBootstrapRevalidate('schedule')).toBe(false);
    });

    it('returns false when block is "missing" (treated as not hydrated)', () => {
        saveStartupBootstrapMeta({
            userId: 'u1',
            hydratedAt: Date.now(),
            issuedAt: '',
            freshness: { schedule: 'missing' },
        });
        expect(shouldSkipBootstrapRevalidate('schedule')).toBe(false);
    });

    it('returns true when block is warm/cached/stale within window', () => {
        for (const status of ['warm', 'cached', 'stale'] as const) {
            saveStartupBootstrapMeta({
                userId: 'u1',
                hydratedAt: Date.now(),
                issuedAt: '',
                freshness: { exams: status },
            });
            expect(shouldSkipBootstrapRevalidate('exams')).toBe(true);
        }
    });

    it('returns false when meta is too old', () => {
        saveStartupBootstrapMeta({
            userId: 'u1',
            hydratedAt: Date.now() - 30_000,
            issuedAt: '',
            freshness: { schedule: 'warm' },
        });
        expect(shouldSkipBootstrapRevalidate('schedule')).toBe(false);
    });

    it('returns false for blocks that are not in the meta freshness map', () => {
        saveStartupBootstrapMeta({
            userId: 'u1',
            hydratedAt: Date.now(),
            issuedAt: '',
            freshness: { schedule: 'warm' },
        });
        expect(shouldSkipBootstrapRevalidate('platonusSummary')).toBe(false);
    });
});
