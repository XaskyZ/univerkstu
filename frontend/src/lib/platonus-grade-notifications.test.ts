import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PlatonusGradesData } from './api';
import {
    buildGradesSnapshot,
    detectAndStoreGradeChanges,
    detectGradeChanges,
    gradesNotifiedSnapshotKey,
    gradesSeenSnapshotKey,
    gradesSnapshotKey,
    markGradesAsSeen,
    type GradeSnapshotValue,
} from './platonus-grade-notifications';

function makeData(subjects: Array<Partial<PlatonusGradesData['subjects'][number]> & { name: string }>): PlatonusGradesData {
    return {
        meta: { parsedAt: '', year: 2025, semester: 1, totalSubjects: subjects.length },
        subjects: subjects.map((s) => ({
            rk1: '-',
            rk2: '-',
            rating: '-',
            exam: '-',
            total: '-',
            ...s,
        })),
    };
}

function makeSnapshotValue(overrides: Partial<GradeSnapshotValue> & { name: string }): GradeSnapshotValue {
    return {
        name: overrides.name,
        rk1: overrides.rk1 ?? '-',
        rk2: overrides.rk2 ?? '-',
        rating: overrides.rating ?? '-',
        exam: overrides.exam ?? '-',
        total: overrides.total ?? '-',
    };
}

describe('snapshot keys', () => {
    it('default keys without user have predictable shape', () => {
        expect(gradesSnapshotKey(2025, 1)).toBe('platonus_grades_snapshot_2025_1');
        expect(gradesSeenSnapshotKey(2025, 1)).toBe('platonus_grades_seen_2025_1');
        expect(gradesNotifiedSnapshotKey(2025, 1)).toBe('platonus_grades_notified_2025_1');
    });

    it('appends user suffix when provided', () => {
        expect(gradesSnapshotKey(2025, 2, 'user42')).toBe('platonus_grades_snapshot_2025_2_user42');
        expect(gradesSeenSnapshotKey(2025, 2, 'user42')).toBe('platonus_grades_seen_2025_2_user42');
    });

    it('treats empty/null user as no-suffix', () => {
        expect(gradesSnapshotKey(2025, 1, null)).toBe('platonus_grades_snapshot_2025_1');
        expect(gradesSnapshotKey(2025, 1, '')).toBe('platonus_grades_snapshot_2025_1');
    });
});

describe('buildGradesSnapshot', () => {
    it('returns empty object for empty subjects', () => {
        expect(buildGradesSnapshot(makeData([]))).toEqual({});
    });

    it('uses subject.code as key when present', () => {
        const snap = buildGradesSnapshot(makeData([
            { name: 'Math', code: 'MATH-101', rk1: '85' },
        ]));
        expect(Object.keys(snap)).toEqual(['MATH-101']);
        expect(snap['MATH-101'].rk1).toBe('85');
        expect(snap['MATH-101'].name).toBe('Math');
    });

    it('falls back to subject.name when code is missing', () => {
        const snap = buildGradesSnapshot(makeData([{ name: 'Math' }]));
        expect(Object.keys(snap)).toEqual(['Math']);
    });

    it('normalizes whitespace/empty values to "-"', () => {
        const snap = buildGradesSnapshot(makeData([
            { name: 'Math', rk1: '  ', rk2: '', rating: '85', exam: '-', total: '-' },
        ]));
        expect(snap.Math.rk1).toBe('-');
        expect(snap.Math.rk2).toBe('-');
        expect(snap.Math.rating).toBe('85');
    });
});

describe('detectGradeChanges', () => {
    it('returns zero changes when snapshots are equal', () => {
        const same = { math: makeSnapshotValue({ name: 'Math', rk1: '80' }) };
        const result = detectGradeChanges(same, same);
        expect(result.count).toBe(0);
        expect(result.sample).toBeNull();
        expect(result.changes).toEqual([]);
    });

    it('detects a brand-new subject (no previous entry)', () => {
        const previous = {};
        const next = { math: makeSnapshotValue({ name: 'Math', rk1: '80' }) };
        const result = detectGradeChanges(previous, next);
        expect(result.count).toBe(1);
        expect(result.changes[0].subject).toBe('Math');
        expect(result.changes[0].preview).toContain('80');
        expect(result.sample).toContain('Math');
    });

    it('skips a brand-new subject with no visible fields', () => {
        const previous = {};
        const next = { math: makeSnapshotValue({ name: 'Math' }) }; // all '-'
        expect(detectGradeChanges(previous, next).count).toBe(0);
    });

    it('detects a changed field on an existing subject', () => {
        const previous = { math: makeSnapshotValue({ name: 'Math', rk1: '70' }) };
        const next = { math: makeSnapshotValue({ name: 'Math', rk1: '85' }) };
        const result = detectGradeChanges(previous, next);
        expect(result.count).toBe(1);
        expect(result.changes[0].preview).toContain('85');
    });

    it('describes removed grade differently from a new one', () => {
        const previous = { math: makeSnapshotValue({ name: 'Math', rk1: '80' }) };
        const next = { math: makeSnapshotValue({ name: 'Math', rk1: '-' }) };
        const result = detectGradeChanges(previous, next);
        expect(result.count).toBe(1);
        // ru default — `${label} удалена`
        expect(result.changes[0].preview).toContain('удалена');
    });

    it('reports only the first changed field per subject', () => {
        const previous = { math: makeSnapshotValue({ name: 'Math', rk1: '70', rk2: '70' }) };
        const next = { math: makeSnapshotValue({ name: 'Math', rk1: '85', rk2: '85' }) };
        const result = detectGradeChanges(previous, next);
        expect(result.count).toBe(1); // 1 change record per subject even though both rk1 and rk2 changed
    });
});

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void {
        this.store.set(key, value);
    }
    removeItem(key: string): void {
        this.store.delete(key);
    }
    clear(): void {
        this.store.clear();
    }
    get length(): number {
        return this.store.size;
    }
    key(index: number): string | null {
        return Array.from(this.store.keys())[index] ?? null;
    }
}

describe('storage-coupled helpers', () => {
    let storage: MemoryStorage;

    beforeEach(() => {
        storage = new MemoryStorage();
        vi.stubGlobal('window', { localStorage: storage });
        vi.stubGlobal('localStorage', storage);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('markGradesAsSeen writes all three snapshot keys', () => {
        const data = makeData([{ name: 'Math', rk1: '80' }]);
        markGradesAsSeen(data, 2025, 1);
        expect(storage.getItem(gradesSnapshotKey(2025, 1))).not.toBeNull();
        expect(storage.getItem(gradesSeenSnapshotKey(2025, 1))).not.toBeNull();
        expect(storage.getItem(gradesNotifiedSnapshotKey(2025, 1))).not.toBeNull();
    });

    it('detectAndStoreGradeChanges seeds baseline on first observation, returns 0', () => {
        const data = makeData([{ name: 'Math', rk1: '80' }]);
        const result = detectAndStoreGradeChanges(data, 2025, 1);
        expect(result.count).toBe(0);
        // Baseline written: subsequent calls compare against this
        expect(storage.getItem(gradesSeenSnapshotKey(2025, 1))).not.toBeNull();
    });

    it('detectAndStoreGradeChanges reports a real change after baseline is seeded', () => {
        // Seed baseline
        detectAndStoreGradeChanges(makeData([{ name: 'Math', rk1: '70' }]), 2025, 1);
        // Now grade went up
        const result = detectAndStoreGradeChanges(makeData([{ name: 'Math', rk1: '85' }]), 2025, 1);
        expect(result.count).toBe(1);
        expect(result.changes[0].preview).toContain('85');
    });

    it('does not notify twice for the same change (notified-snapshot dedupe)', () => {
        detectAndStoreGradeChanges(makeData([{ name: 'Math', rk1: '70' }]), 2025, 1);
        const first = detectAndStoreGradeChanges(makeData([{ name: 'Math', rk1: '85' }]), 2025, 1);
        const second = detectAndStoreGradeChanges(makeData([{ name: 'Math', rk1: '85' }]), 2025, 1);
        expect(first.count).toBe(1);
        // Second call with the same data: notifiedSnapshot now equals next → no delta
        expect(second.count).toBe(0);
    });

    it('keeps user-namespaced snapshots independent', () => {
        detectAndStoreGradeChanges(makeData([{ name: 'Math', rk1: '70' }]), 2025, 1, 'alice');
        // Bob never had a baseline — first call for bob seeds, returns 0
        const bobFirst = detectAndStoreGradeChanges(makeData([{ name: 'Math', rk1: '99' }]), 2025, 1, 'bob');
        expect(bobFirst.count).toBe(0);
        // Alice's baseline is independent
        expect(storage.getItem(gradesSeenSnapshotKey(2025, 1, 'alice'))).not.toBeNull();
        expect(storage.getItem(gradesSeenSnapshotKey(2025, 1, 'bob'))).not.toBeNull();
        const aliceSeen = storage.getItem(gradesSeenSnapshotKey(2025, 1, 'alice'));
        const bobSeen = storage.getItem(gradesSeenSnapshotKey(2025, 1, 'bob'));
        expect(aliceSeen).not.toBe(bobSeen);
    });
});
