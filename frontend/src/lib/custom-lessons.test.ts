import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    addCustomLesson,
    deleteCustomLesson,
    getCustomLessons,
    updateCustomLesson,
    type CustomLesson,
} from './custom-lessons';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
    raw(): string | null { return this.store.get('custom-lessons-v1') ?? null; }
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

const SAMPLE_INPUT: Omit<CustomLesson, 'id' | 'createdAt'> = {
    title: 'Math practice',
    type: 'other',
    teacher: 'Ivanov I.I.',
    room: 'A101',
    dayIndex: 0,
    timeSlotIndex: 2,
    parity: 'all',
};

describe('getCustomLessons', () => {
    it('returns empty array when storage is empty', () => {
        expect(getCustomLessons()).toEqual([]);
    });

    it('returns empty array when storage has corrupt JSON', () => {
        storage.setItem('custom-lessons-v1', 'not-json{{');
        expect(getCustomLessons()).toEqual([]);
    });

    it('returns empty array when stored value is not an array', () => {
        storage.setItem('custom-lessons-v1', '{"not": "array"}');
        expect(getCustomLessons()).toEqual([]);
    });

    it('drops invalid entries (missing id/title) and persists cleaned list', () => {
        storage.setItem('custom-lessons-v1', JSON.stringify([
            { id: 'a', title: 'ok', type: 'other', teacher: '', room: '', dayIndex: 0, timeSlotIndex: 0, parity: 'all', createdAt: 1 },
            { id: 'b' /* missing title */ },
            null,
        ]));
        const result = getCustomLessons();
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe('a');
        // Cleaned form re-written
        const persisted = JSON.parse(storage.raw()!);
        expect(persisted).toHaveLength(1);
    });

    it('maps legacy Russian type strings to canonical codes', () => {
        storage.setItem('custom-lessons-v1', JSON.stringify([
            { id: 'a', title: 'ok', type: 'СРСП', teacher: '', room: '', dayIndex: 0, timeSlotIndex: 0, parity: 'all', createdAt: 1 },
            { id: 'b', title: 'ok', type: 'Кураторский час', teacher: '', room: '', dayIndex: 0, timeSlotIndex: 0, parity: 'all', createdAt: 1 },
            { id: 'c', title: 'ok', type: 'Другое', teacher: '', room: '', dayIndex: 0, timeSlotIndex: 0, parity: 'all', createdAt: 1 },
        ]));
        const result = getCustomLessons();
        expect(result.map((l) => l.type)).toEqual(['srsp', 'curator_hour', 'other']);
    });

    it('falls back unknown type to "other"', () => {
        storage.setItem('custom-lessons-v1', JSON.stringify([
            { id: 'a', title: 'ok', type: 'unknown_type', teacher: '', room: '', dayIndex: 0, timeSlotIndex: 0, parity: 'all', createdAt: 1 },
        ]));
        expect(getCustomLessons()[0].type).toBe('other');
    });

    it('normalizes invalid parity to "all"', () => {
        storage.setItem('custom-lessons-v1', JSON.stringify([
            { id: 'a', title: 'ok', type: 'other', teacher: '', room: '', dayIndex: 0, timeSlotIndex: 0, parity: 'weird', createdAt: 1 },
        ]));
        expect(getCustomLessons()[0].parity).toBe('all');
    });
});

describe('addCustomLesson', () => {
    it('persists and returns the new lesson with generated id+createdAt', () => {
        const created = addCustomLesson(SAMPLE_INPUT);
        expect(created.id).toMatch(/^cl_\d+_[a-z0-9]+$/);
        expect(typeof created.createdAt).toBe('number');
        expect(getCustomLessons()).toHaveLength(1);
        expect(getCustomLessons()[0].title).toBe('Math practice');
    });

    it('preserves the canonical type even when input uses a legacy string', () => {
        const created = addCustomLesson({ ...SAMPLE_INPUT, type: 'СРСП' as unknown as 'other' });
        expect(created.type).toBe('srsp');
    });

    it('appends to existing list rather than overwriting', () => {
        addCustomLesson(SAMPLE_INPUT);
        addCustomLesson({ ...SAMPLE_INPUT, title: 'Second' });
        const all = getCustomLessons();
        expect(all).toHaveLength(2);
        expect(all.map((l) => l.title)).toEqual(['Math practice', 'Second']);
    });
});

describe('updateCustomLesson', () => {
    it('returns null when the id is unknown', () => {
        expect(updateCustomLesson('does-not-exist', { title: 'X' })).toBeNull();
    });

    it('updates fields and persists', () => {
        const created = addCustomLesson(SAMPLE_INPUT);
        const updated = updateCustomLesson(created.id, { title: 'Renamed', room: 'B202' });
        expect(updated?.title).toBe('Renamed');
        expect(updated?.room).toBe('B202');
        const all = getCustomLessons();
        expect(all[0].title).toBe('Renamed');
    });

    it('preserves createdAt across updates', () => {
        const created = addCustomLesson(SAMPLE_INPUT);
        const updated = updateCustomLesson(created.id, { title: 'X' });
        expect(updated?.createdAt).toBe(created.createdAt);
    });

    it('normalizes updated type via legacy map', () => {
        const created = addCustomLesson(SAMPLE_INPUT);
        const updated = updateCustomLesson(created.id, { type: 'Кураторский час' as unknown as 'other' });
        expect(updated?.type).toBe('curator_hour');
    });
});

describe('deleteCustomLesson', () => {
    it('returns false when the id is unknown (no change)', () => {
        addCustomLesson(SAMPLE_INPUT);
        expect(deleteCustomLesson('nope')).toBe(false);
        expect(getCustomLessons()).toHaveLength(1);
    });

    it('drops only the matching lesson and returns true', () => {
        const a = addCustomLesson(SAMPLE_INPUT);
        addCustomLesson({ ...SAMPLE_INPUT, title: 'Second' });
        expect(deleteCustomLesson(a.id)).toBe(true);
        const remaining = getCustomLessons();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].title).toBe('Second');
    });
});
