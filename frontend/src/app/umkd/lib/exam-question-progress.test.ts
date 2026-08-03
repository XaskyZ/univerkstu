import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    EXAM_QUESTION_PROGRESS_STORAGE_KEY,
    getFileQuestionProgress,
    isQuestionReviewed,
    markQuestionReviewed,
    unmarkQuestionReviewed,
} from './exam-question-progress';
import { EXAM_PROGRESS_STORAGE_KEY } from './exam-progress';

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

describe('exam-question-progress storage', () => {
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

    it('is empty by default', () => {
        expect(isQuestionReviewed('file-1', 0)).toBe(false);
        expect(getFileQuestionProgress('file-1', 5)).toEqual({ done: 0, total: 5 });
    });

    it('markQuestionReviewed persists and isQuestionReviewed reads it back', () => {
        markQuestionReviewed('file-1', 3);
        expect(isQuestionReviewed('file-1', 3)).toBe(true);
        expect(isQuestionReviewed('file-1', 4)).toBe(false);
        expect(isQuestionReviewed('other', 3)).toBe(false);
    });

    it('unmarkQuestionReviewed removes the entry without affecting siblings', () => {
        markQuestionReviewed('file-1', 1);
        markQuestionReviewed('file-1', 2);
        unmarkQuestionReviewed('file-1', 1);
        expect(isQuestionReviewed('file-1', 1)).toBe(false);
        expect(isQuestionReviewed('file-1', 2)).toBe(true);
    });

    it('survives a corrupt JSON payload by returning empty state', () => {
        storage.setItem(EXAM_QUESTION_PROGRESS_STORAGE_KEY, 'not-json{');
        expect(isQuestionReviewed('file-1', 1)).toBe(false);
        expect(getFileQuestionProgress('file-1', 4)).toEqual({ done: 0, total: 4 });
        // A subsequent mutation should overwrite the corrupt value cleanly.
        markQuestionReviewed('file-1', 0);
        expect(isQuestionReviewed('file-1', 0)).toBe(true);
    });

    it('getFileQuestionProgress counts marked questions correctly', () => {
        markQuestionReviewed('file-1', 0);
        markQuestionReviewed('file-1', 1);
        markQuestionReviewed('file-1', 2);
        // marking unrelated file shouldn't leak into this file's count
        markQuestionReviewed('file-2', 0);
        expect(getFileQuestionProgress('file-1', 5)).toEqual({ done: 3, total: 5 });
        expect(getFileQuestionProgress('file-1', 0)).toEqual({ done: 0, total: 0 });
        expect(getFileQuestionProgress('missing-file', 0)).toEqual({ done: 0, total: 0 });
        expect(getFileQuestionProgress('missing-file', 4)).toEqual({ done: 0, total: 4 });
    });

    it('ignores empty fileId on mutations', () => {
        markQuestionReviewed('', 0);
        unmarkQuestionReviewed('', 0);
        expect(isQuestionReviewed('', 0)).toBe(false);
        expect(getFileQuestionProgress('', 3)).toEqual({ done: 0, total: 3 });
    });

    it('does not throw when storage writes fail', () => {
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
        expect(() => markQuestionReviewed('file-x', 0)).not.toThrow();
        expect(() => unmarkQuestionReviewed('file-x', 0)).not.toThrow();
    });

    it('unmark on an unknown index is a no-op', () => {
        markQuestionReviewed('file-1', 0);
        unmarkQuestionReviewed('file-1', 99);
        expect(isQuestionReviewed('file-1', 0)).toBe(true);
        // Removing the last question drops the file entry entirely; sanity check.
        unmarkQuestionReviewed('file-1', 0);
        expect(getFileQuestionProgress('file-1', 1)).toEqual({ done: 0, total: 1 });
    });

    it('strips entries with invalid inner shape', () => {
        storage.setItem(
            EXAM_QUESTION_PROGRESS_STORAGE_KEY,
            JSON.stringify({
                good: { questions: { '0': { reviewedAt: '2026-01-01T00:00:00.000Z' } } },
                badOuter: 'oops',
                missingQuestions: {},
                badInner: { questions: { '0': 'bad', '1': { reviewedAt: 5 } } },
                mixed: { questions: { '0': { reviewedAt: '2026-01-01T00:00:00.000Z' }, 'x': 'no' } },
            }),
        );
        expect(isQuestionReviewed('good', 0)).toBe(true);
        expect(isQuestionReviewed('badOuter', 0)).toBe(false);
        expect(isQuestionReviewed('missingQuestions', 0)).toBe(false);
        expect(isQuestionReviewed('badInner', 0)).toBe(false);
        expect(isQuestionReviewed('badInner', 1)).toBe(false);
        expect(getFileQuestionProgress('mixed', 5)).toEqual({ done: 1, total: 5 });
    });

    it('persists a valid ISO timestamp', () => {
        const before = Date.now();
        markQuestionReviewed('file-1', 0);
        const raw = storage.getItem(EXAM_QUESTION_PROGRESS_STORAGE_KEY);
        expect(raw).toBeTruthy();
        const parsed = JSON.parse(raw || '{}') as Record<string, { questions: Record<string, { reviewedAt: string }> }>;
        const stamp = parsed['file-1']?.questions['0']?.reviewedAt;
        expect(typeof stamp).toBe('string');
        expect(Number.isNaN(Date.parse(stamp || ''))).toBe(false);
        expect(Date.parse(stamp || '')).toBeGreaterThanOrEqual(before - 1000);
    });

    it('does not auto-touch the per-file legacy progress on partial mutations', () => {
        // marking a single question shouldn't write the per-file legacy key
        markQuestionReviewed('file-1', 0);
        expect(storage.getItem(EXAM_PROGRESS_STORAGE_KEY)).toBeNull();
    });
});
