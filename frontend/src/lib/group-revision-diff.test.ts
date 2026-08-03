import { describe, it, expect } from 'vitest';
import type { GroupContentRevisionView, GroupExtraLessonView, GroupPostView, GroupTaskView } from './api';
import {
    buildCurrentContentSnapshot,
    buildRevisionDiffEntries,
    buildRevisionDiffMap,
} from './group-revision-diff';

function makePost(overrides: Partial<GroupPostView> = {}): GroupPostView {
    return {
        id: 'p1',
        groupKey: 'g',
        title: 'Hello',
        body: 'Body text',
        authorUserId: 'alice',
        pinned: false,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        ...overrides,
    };
}

function makeTask(overrides: Partial<GroupTaskView> = {}): GroupTaskView {
    return {
        id: 't1',
        groupKey: 'g',
        title: 'Submit lab',
        subject: 'Math',
        description: null,
        deadline: '2025-06-15T18:00:00Z',
        priority: 'medium',
        authorUserId: 'alice',
        completed: false,
        completedAt: null,
        completedBy: null,
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        ...overrides,
    };
}

function makeLesson(overrides: Partial<GroupExtraLessonView> = {}): GroupExtraLessonView {
    return {
        id: 'l1',
        groupKey: 'g',
        title: 'Replacement lecture',
        date: '2025-06-10T00:00:00Z',
        startTime: '10:00',
        endTime: '11:30',
        room: 'A101',
        teacher: 'Иванов И.И.',
        note: null,
        authorUserId: 'alice',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
        ...overrides,
    };
}

describe('buildCurrentContentSnapshot', () => {
    it('extracts the right fields for a post', () => {
        const snap = buildCurrentContentSnapshot('post', makePost({ title: 'X', body: 'Y', pinned: true }));
        expect(snap).toEqual({
            title: 'X',
            body: 'Y',
            pinned: true,
            authorUserId: 'alice',
            deletedAt: null,
            deletedBy: null,
        });
    });

    it('extracts the right fields for a task', () => {
        const snap = buildCurrentContentSnapshot('task', makeTask({ priority: 'high', completed: true, completedAt: '2025-02-01T00:00:00Z', completedBy: 'bob' }));
        expect(snap.priority).toBe('high');
        expect(snap.completed).toBe(true);
        expect(snap.completedAt).toBe('2025-02-01T00:00:00Z');
        expect(snap.completedBy).toBe('bob');
    });

    it('extracts the right fields for an extra lesson', () => {
        const snap = buildCurrentContentSnapshot('extra_lesson', makeLesson({ note: 'Extra note' }));
        expect(snap.note).toBe('Extra note');
        expect(snap.startTime).toBe('10:00');
        expect(snap.endTime).toBe('11:30');
    });

    it('normalizes optional nullish fields to null', () => {
        const post = makePost();
        // deletedAt/deletedBy are absent in the source — should normalize to null
        const snap = buildCurrentContentSnapshot('post', post);
        expect(snap.deletedAt).toBeNull();
        expect(snap.deletedBy).toBeNull();
    });
});

describe('buildRevisionDiffEntries', () => {
    const postSnap = (overrides: Record<string, unknown> = {}) => ({
        title: 'Hello', body: 'Body', pinned: false, authorUserId: 'a',
        deletedAt: null, deletedBy: null, ...overrides,
    });

    it('returns empty array when snapshots are identical', () => {
        expect(buildRevisionDiffEntries('post', postSnap(), postSnap())).toEqual([]);
    });

    it('detects a single field change', () => {
        const entries = buildRevisionDiffEntries('post', postSnap(), postSnap({ title: 'New' }));
        expect(entries).toHaveLength(1);
        expect(entries[0].key).toBe('title');
        expect(entries[0].before).toBe('Hello');
        expect(entries[0].after).toBe('New');
    });

    it('detects multiple field changes', () => {
        const entries = buildRevisionDiffEntries('post', postSnap(), postSnap({ title: 'T', body: 'B' }));
        expect(entries).toHaveLength(2);
    });

    it('formats pinned boolean per language', () => {
        const ru = buildRevisionDiffEntries('post', postSnap(), postSnap({ pinned: true }), 'ru');
        expect(ru[0].before).toBe('Нет');
        expect(ru[0].after).toBe('Да');

        const en = buildRevisionDiffEntries('post', postSnap(), postSnap({ pinned: true }), 'en');
        expect(en[0].before).toBe('No');
        expect(en[0].after).toBe('Yes');

        const kz = buildRevisionDiffEntries('post', postSnap(), postSnap({ pinned: true }), 'kz');
        expect(kz[0].before).toBe('Жоқ');
        expect(kz[0].after).toBe('Иә');
    });

    it('formats priority enum per language', () => {
        const taskBase = { title: 'T', subject: null, description: null, deadline: null, priority: 'low', completed: false, completedAt: null, completedBy: null, deletedAt: null, deletedBy: null };
        const entries = buildRevisionDiffEntries('task', taskBase, { ...taskBase, priority: 'high' }, 'ru');
        const priorityEntry = entries.find((e) => e.key === 'priority');
        expect(priorityEntry?.before).toBe('Низкий');
        expect(priorityEntry?.after).toBe('Высокий');
    });

    it('renders missing values as em dash', () => {
        const entries = buildRevisionDiffEntries('post', postSnap({ body: '' }), postSnap());
        expect(entries[0].before).toBe('—');
        expect(entries[0].after).toBe('Body');
    });

    it('uses RU labels by default (no language arg)', () => {
        const entries = buildRevisionDiffEntries('post', postSnap(), postSnap({ title: 'New' }));
        expect(entries[0].label).toBe('Заголовок');
    });

    it('uses EN labels when language=en', () => {
        const entries = buildRevisionDiffEntries('post', postSnap(), postSnap({ title: 'New' }), 'en');
        expect(entries[0].label).toBe('Title');
    });

    it('detects deletedAt timestamp changes via shared common fields', () => {
        const entries = buildRevisionDiffEntries(
            'post',
            postSnap({ deletedAt: null }),
            postSnap({ deletedAt: '2025-02-01T00:00:00Z' })
        );
        expect(entries.find((e) => e.key === 'deletedAt')).toBeDefined();
    });
});

describe('buildRevisionDiffMap', () => {
    function makeRevision(id: string, snapshot: Record<string, unknown>): GroupContentRevisionView {
        return {
            id, groupKey: 'g', contentType: 'post', entityId: 'p1', editedBy: 'a',
            editedAt: '2025-01-01T00:00:00Z', snapshot,
        };
    }

    it('returns an empty map for empty revisions array', () => {
        const result = buildRevisionDiffMap('post', [], { title: 'X', body: 'Y', pinned: false, authorUserId: 'a', deletedAt: null, deletedBy: null });
        expect(result).toEqual({});
    });

    it('diffs each revision against the next-newer one (current state for the most recent)', () => {
        const current = { title: 'C', body: 'C', pinned: false, authorUserId: 'a', deletedAt: null, deletedBy: null };
        const revisions = [
            makeRevision('r2', { title: 'B', body: 'C', pinned: false, authorUserId: 'a', deletedAt: null, deletedBy: null }),
            makeRevision('r1', { title: 'A', body: 'C', pinned: false, authorUserId: 'a', deletedAt: null, deletedBy: null }),
        ];
        const result = buildRevisionDiffMap('post', revisions, current);
        // r2 (newest) diffed vs current → title B → C
        expect(result.r2[0].before).toBe('B');
        expect(result.r2[0].after).toBe('C');
        // r1 diffed vs r2.snapshot → title A → B
        expect(result.r1[0].before).toBe('A');
        expect(result.r1[0].after).toBe('B');
    });
});
