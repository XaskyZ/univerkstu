import { describe, it, expect } from 'vitest';
import { diffSnapshots, type DiffEntry } from './social-diff';

function sortByPath(rows: DiffEntry[]): DiffEntry[] {
    return [...rows].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

describe('diffSnapshots', () => {
    it('returns [] for two identical objects', () => {
        expect(diffSnapshots({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toEqual([]);
    });

    it('detects a single primitive change', () => {
        const out = diffSnapshots({ body: 'v1' }, { body: 'v2' });
        expect(out).toEqual([{ path: 'body', kind: 'changed', before: 'v1', after: 'v2' }]);
    });

    it('detects an added key', () => {
        const out = diffSnapshots({ a: 1 }, { a: 1, b: 2 });
        expect(out).toEqual([{ path: 'b', kind: 'added', before: undefined, after: 2 }]);
    });

    it('detects a removed key', () => {
        const out = diffSnapshots({ a: 1, b: 2 }, { a: 1 });
        expect(out).toEqual([{ path: 'b', kind: 'removed', before: 2, after: undefined }]);
    });

    it('detects multiple changes in one diff', () => {
        const out = diffSnapshots(
            { title: 't', body: 'old', tags: ['a'] },
            { title: 't', body: 'new', tags: ['a', 'b'] },
        );
        const paths = sortByPath(out).map((r) => `${r.kind}:${r.path}`);
        expect(paths).toEqual(['changed:body', 'changed:tags']);
    });

    it('recurses into nested plain objects (path joins with dots)', () => {
        const out = diffSnapshots(
            { meta: { author: 'alice', priority: 'low' } },
            { meta: { author: 'alice', priority: 'high' } },
        );
        expect(out).toEqual([
            { path: 'meta.priority', kind: 'changed', before: 'low', after: 'high' },
        ]);
    });

    it('descends into same-length object arrays (poll options scenario)', () => {
        const out = diffSnapshots(
            { options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'No' }] },
            { options: [{ id: 'a', label: 'Yes' }, { id: 'b', label: 'Maybe' }] },
        );
        expect(out).toEqual([
            { path: 'options.1.label', kind: 'changed', before: 'No', after: 'Maybe' },
        ]);
    });

    it('treats different-length arrays as a single changed row', () => {
        const before = { tags: ['a', 'b'] };
        const after = { tags: ['a', 'b', 'c'] };
        const out = diffSnapshots(before, after);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ path: 'tags', kind: 'changed' });
        expect(out[0].before).toEqual(['a', 'b']);
        expect(out[0].after).toEqual(['a', 'b', 'c']);
    });

    it('compares same-length primitive arrays pairwise', () => {
        const out = diffSnapshots({ nums: [1, 2, 3] }, { nums: [1, 9, 3] });
        expect(out).toEqual([
            { path: 'nums.1', kind: 'changed', before: 2, after: 9 },
        ]);
    });

    it('emits stable diff regardless of repeated calls (no mutation)', () => {
        const before = { a: 1, nested: { b: 2 } };
        const after = { a: 1, nested: { b: 3 } };
        const first = diffSnapshots(before, after);
        const second = diffSnapshots(before, after);
        expect(first).toEqual(second);
        // Source objects untouched.
        expect(before).toEqual({ a: 1, nested: { b: 2 } });
        expect(after).toEqual({ a: 1, nested: { b: 3 } });
    });

    it('null vs missing key shows as removed, not changed', () => {
        // `null` IS a value (kind=changed if present on both, removed if missing on after).
        const out = diffSnapshots({ tag: null }, {});
        expect(out).toEqual([{ path: 'tag', kind: 'removed', before: null, after: undefined }]);
    });

    it('null vs primitive value emits a changed row', () => {
        const out = diffSnapshots({ tag: null }, { tag: 'urgent' });
        expect(out).toEqual([
            { path: 'tag', kind: 'changed', before: null, after: 'urgent' },
        ]);
    });

    it('returns [] for matching nested structure', () => {
        const out = diffSnapshots(
            { options: [{ id: 'a', label: 'Yes' }], votes: { alice: 'a' } },
            { options: [{ id: 'a', label: 'Yes' }], votes: { alice: 'a' } },
        );
        expect(out).toEqual([]);
    });

    it('handles non-object input gracefully without throwing', () => {
        // Defensive: the social store stores `snapshot` as jsonb, but a malformed
        // historical row could in theory be a primitive — we should not crash.
        expect(diffSnapshots(null as unknown as Record<string, unknown>, { a: 1 })).toEqual([
            { path: 'a', kind: 'added', before: undefined, after: 1 },
        ]);
        expect(diffSnapshots({ a: 1 }, undefined as unknown as Record<string, unknown>)).toEqual([
            { path: 'a', kind: 'removed', before: 1, after: undefined },
        ]);
    });

    it('treats class instances (e.g. Date) as opaque scalars', () => {
        const d1 = new Date('2026-01-01T00:00:00Z');
        const d2 = new Date('2026-02-01T00:00:00Z');
        const out = diffSnapshots({ at: d1 }, { at: d2 });
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ path: 'at', kind: 'changed' });
    });

    it('boolean change is detected', () => {
        const out = diffSnapshots({ pinned: false }, { pinned: true });
        expect(out).toEqual([
            { path: 'pinned', kind: 'changed', before: false, after: true },
        ]);
    });
});
