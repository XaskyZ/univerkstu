import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    NOTIFICATIONS_ENABLED_KEY,
    areNotificationsEnabled,
    setNotificationsEnabled,
} from './use-notifications';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

let storage: MemoryStorage;

beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.stubGlobal('localStorage', storage);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('NOTIFICATIONS_ENABLED_KEY', () => {
    it('exposes the canonical localStorage key', () => {
        expect(NOTIFICATIONS_ENABLED_KEY).toBe('notifications-enabled');
    });
});

describe('areNotificationsEnabled', () => {
    it('returns false by default (no value stored)', () => {
        expect(areNotificationsEnabled()).toBe(false);
    });

    it('returns true only when stored value is the literal string "true"', () => {
        storage.setItem(NOTIFICATIONS_ENABLED_KEY, 'true');
        expect(areNotificationsEnabled()).toBe(true);
    });

    it('returns false for any other stringified value', () => {
        storage.setItem(NOTIFICATIONS_ENABLED_KEY, 'false');
        expect(areNotificationsEnabled()).toBe(false);

        storage.setItem(NOTIFICATIONS_ENABLED_KEY, '1');
        expect(areNotificationsEnabled()).toBe(false);

        storage.setItem(NOTIFICATIONS_ENABLED_KEY, 'TRUE');
        expect(areNotificationsEnabled()).toBe(false); // case-sensitive

        storage.setItem(NOTIFICATIONS_ENABLED_KEY, '');
        expect(areNotificationsEnabled()).toBe(false);
    });
});

describe('setNotificationsEnabled', () => {
    it('stores "true" when called with true', () => {
        setNotificationsEnabled(true);
        expect(storage.getItem(NOTIFICATIONS_ENABLED_KEY)).toBe('true');
        expect(areNotificationsEnabled()).toBe(true);
    });

    it('stores "false" when called with false (does not remove the key)', () => {
        setNotificationsEnabled(false);
        expect(storage.getItem(NOTIFICATIONS_ENABLED_KEY)).toBe('false');
        expect(areNotificationsEnabled()).toBe(false);
    });

    it('toggle round-trip: true → false → true', () => {
        setNotificationsEnabled(true);
        expect(areNotificationsEnabled()).toBe(true);
        setNotificationsEnabled(false);
        expect(areNotificationsEnabled()).toBe(false);
        setNotificationsEnabled(true);
        expect(areNotificationsEnabled()).toBe(true);
    });
});
