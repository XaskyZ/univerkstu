import { describe, it, expect } from 'vitest';
import type { SocialEntityView } from '@/lib/api/social';
import { socialEntityToTaskView } from './social-entity-to-task';

// Builds a minimal `SocialEntityView` (kind=task) with sane defaults. Tests
// override only the fields they care about so each assertion focuses on the
// mapping rule under test.
function makeView(overrides: {
    entity?: Partial<SocialEntityView['entity']>;
    reactions?: SocialEntityView['reactions'];
    myReactions?: SocialEntityView['myReactions'];
    commentCount?: number;
    attachmentCount?: number;
    isPinned?: boolean;
} = {}): SocialEntityView {
    return {
        entity: {
            id: 'task-1',
            kind: 'task',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'starosta-1',
            payload: { title: 'Read chapter 3', body: 'Pages 40-72' },
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...overrides.entity,
        },
        reactions: overrides.reactions ?? [],
        myReactions: overrides.myReactions ?? [],
        commentCount: overrides.commentCount ?? 0,
        attachmentCount: overrides.attachmentCount ?? 0,
        isPinned: overrides.isPinned ?? false,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('socialEntityToTaskView', () => {
    it('maps a fully-populated task entity (title, body, dueAt) and surfaces reactions', () => {
        // Full happy-path mapping — every field TaskCard relies on is
        // populated from the universal entity. Locks the contract for the
        // beta read surface.
        const view = makeView({
            entity: {
                id: 'task-abc',
                authorUserId: 'curator-9',
                pinned: true,
                payload: {
                    title: 'Submit lab report',
                    body: 'Email PDF to teacher',
                    dueAt: '2026-03-15T18:00:00Z',
                },
            },
            reactions: [{ emoji: '👍', count: 4 }],
            myReactions: ['👍'],
        });
        const task = socialEntityToTaskView(view);
        expect(task).toMatchObject({
            id: 'task-abc',
            groupKey: 'ITS-21',
            title: 'Submit lab report',
            body: 'Email PDF to teacher',
            dueAt: '2026-03-15T18:00:00Z',
            authorUserId: 'curator-9',
            pinned: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            deletedBy: null,
        });
        expect(task.reactions).toEqual({
            items: [{ emoji: '👍', count: 4 }],
            mine: ['👍'],
        });
    });

    it('leaves `dueAt` undefined when the payload omits it', () => {
        // The legacy task UI treats absent deadline as "no due date". The
        // adapter must not coerce missing dueAt to '' (which would render
        // as an Invalid Date in `TaskCard`).
        const view = makeView({ entity: { payload: { title: 'no deadline', body: '' } } });
        const task = socialEntityToTaskView(view);
        expect(task.dueAt).toBeUndefined();
    });

    it('defaults `completed=false` when no `completedByUserIds` array is present', () => {
        // Phase 1c shim skipped completion mirror; legacy-only tasks reach
        // the universal endpoint without the completion array. The adapter
        // should treat that as "not done by anyone".
        const view = makeView({ entity: { payload: { title: 't', body: 'b' } } });
        const task = socialEntityToTaskView(view);
        expect(task.completed).toBe(false);
        expect(task.completedByUserIds).toEqual([]);
        expect(task.completedBy).toBeUndefined();
        expect(task.completedAt).toBeUndefined();
    });

    it('sets `completed=true` when at least one user appears in `completedByUserIds`', () => {
        // Group-level "any completion" semantics — per-user truth is the
        // consumer's job. Asserts the array → boolean derivation rule.
        const view = makeView({
            entity: {
                payload: {
                    title: 't',
                    body: 'b',
                    completedByUserIds: ['user-1', 'user-2'],
                    completedAt: '2026-02-10T12:00:00Z',
                },
            },
        });
        const task = socialEntityToTaskView(view);
        expect(task.completed).toBe(true);
        expect(task.completedByUserIds).toEqual(['user-1', 'user-2']);
        expect(task.completedBy).toBe('user-1');
        expect(task.completedAt).toBe('2026-02-10T12:00:00Z');
    });

    it('strips the `group:` prefix from scopeId to recover the bare group key', () => {
        const view = makeView({ entity: { scopeId: 'group:CSE-22A' } });
        expect(socialEntityToTaskView(view).groupKey).toBe('CSE-22A');
    });

    it('preserves `pinned` from the entity row', () => {
        // Pinned tasks are not a UX feature today, but the universal store
        // tracks the bit at the row level. Surfacing it keeps the adapter
        // shape forward-compatible with any UI that introduces pinning later.
        const view = makeView({ entity: { pinned: true } });
        expect(socialEntityToTaskView(view).pinned).toBe(true);
    });

    it('preserves soft-delete fields (deletedAt + deletedByUserId → deletedBy)', () => {
        // Trash list reads on the universal entity rely on these fields.
        const view = makeView({
            entity: {
                deletedAt: '2026-02-15T10:00:00Z',
                deletedByUserId: 'moderator-9',
                deletedReason: 'duplicate',
            },
        });
        const task = socialEntityToTaskView(view);
        expect(task.deletedAt).toBe('2026-02-15T10:00:00Z');
        expect(task.deletedBy).toBe('moderator-9');
    });
});
