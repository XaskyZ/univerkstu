import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    EXAM_PROGRESS_STORAGE_KEY,
    getProgress,
    getSubjectProgress,
    isReviewed,
    markReviewed,
    unmarkReviewed,
} from './exam-progress';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

describe('exam-progress storage', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        vi.stubGlobal('window', {
            localStorage: storage,
            addEventListener: () => {},
            removeEventListener: () => {},
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('getProgress returns {} when no data stored', () => {
        expect(getProgress()).toEqual({});
    });

    it('getProgress returns {} when stored payload is corrupt JSON', () => {
        storage.setItem(EXAM_PROGRESS_STORAGE_KEY, 'not-json');
        expect(getProgress()).toEqual({});
    });

    it('getProgress strips entries with invalid shape', () => {
        storage.setItem(
            EXAM_PROGRESS_STORAGE_KEY,
            JSON.stringify({
                good: { reviewedAt: '2025-01-01T00:00:00.000Z' },
                bad: 'not-an-object',
                missing: {},
            })
        );
        const map = getProgress();
        expect(map.good?.reviewedAt).toBe('2025-01-01T00:00:00.000Z');
        expect(map.bad).toBeUndefined();
        expect(map.missing).toBeUndefined();
    });

    it('markReviewed persists an ISO timestamp and isReviewed reads it back', () => {
        const before = Date.now();
        markReviewed('file-1');
        const map = getProgress();
        const stamp = map['file-1']?.reviewedAt;
        expect(typeof stamp).toBe('string');
        expect(Number.isNaN(Date.parse(stamp || ''))).toBe(false);
        expect(Date.parse(stamp || '')).toBeGreaterThanOrEqual(before - 1000);
        expect(isReviewed('file-1')).toBe(true);
        expect(isReviewed('other')).toBe(false);
    });

    it('unmarkReviewed removes the entry but leaves siblings intact', () => {
        markReviewed('file-1');
        markReviewed('file-2');
        unmarkReviewed('file-1');
        const map = getProgress();
        expect(map['file-1']).toBeUndefined();
        expect(map['file-2']).toBeDefined();
        expect(isReviewed('file-1')).toBe(false);
        expect(isReviewed('file-2')).toBe(true);
    });

    it('unmarkReviewed on an unknown id is a no-op', () => {
        markReviewed('file-1');
        unmarkReviewed('does-not-exist');
        expect(isReviewed('file-1')).toBe(true);
    });

    it('markReviewed / unmarkReviewed ignore empty file ids', () => {
        markReviewed('');
        expect(getProgress()).toEqual({});
        unmarkReviewed('');
        expect(getProgress()).toEqual({});
    });

    it('getSubjectProgress counts reviewed ids against the supplied set', () => {
        markReviewed('a');
        markReviewed('b');
        // 'c' is not reviewed; 'd' isn't in the subject at all.
        markReviewed('d');
        const summary = getSubjectProgress(['a', 'b', 'c']);
        expect(summary).toEqual({ done: 2, total: 3 });
    });

    it('getSubjectProgress on empty input returns 0/0', () => {
        expect(getSubjectProgress([])).toEqual({ done: 0, total: 0 });
    });

    it('survives a write failure without throwing', () => {
        const throwing: Storage = {
            getItem: () => null,
            setItem: () => { throw new Error('quota'); },
            removeItem: () => {},
            clear: () => {},
            length: 0,
            key: () => null,
        };
        vi.stubGlobal('window', {
            localStorage: throwing,
            addEventListener: () => {},
            removeEventListener: () => {},
        });
        expect(() => markReviewed('file-x')).not.toThrow();
    });
});
