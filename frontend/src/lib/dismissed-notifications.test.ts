import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDismissedNotificationIds, addDismissedNotificationIds } from './dismissed-notifications';

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

describe('dismissed-notifications', () => {
    beforeEach(() => {
        storage = new MemoryStorage();
        vi.stubGlobal('window', { localStorage: storage });
        vi.stubGlobal('localStorage', storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('starts empty', () => {
        expect(getDismissedNotificationIds()).toEqual([]);
    });

    it('persists added ids and dedupes', () => {
        addDismissedNotificationIds(['a', 'b']);
        addDismissedNotificationIds(['b', 'c']);
        expect(getDismissedNotificationIds()).toEqual(['a', 'b', 'c']);
    });

    it('ignores empty / non-string ids', () => {
        addDismissedNotificationIds(['', 'x']);
        expect(getDismissedNotificationIds()).toEqual(['x']);
    });

    it('returns the merged list from add', () => {
        const result = addDismissedNotificationIds(['one', 'two']);
        expect(result).toEqual(['one', 'two']);
    });

    it('survives corrupt storage', () => {
        storage.setItem('dismissed-notifications', 'not-json');
        expect(getDismissedNotificationIds()).toEqual([]);
        addDismissedNotificationIds(['ok']);
        expect(getDismissedNotificationIds()).toEqual(['ok']);
    });

    it('caps the stored list to the most recent 1000', () => {
        const ids = Array.from({ length: 1200 }, (_, i) => `n${i}`);
        addDismissedNotificationIds(ids);
        const kept = getDismissedNotificationIds();
        expect(kept).toHaveLength(1000);
        expect(kept[0]).toBe('n200');
        expect(kept[kept.length - 1]).toBe('n1199');
    });
});
