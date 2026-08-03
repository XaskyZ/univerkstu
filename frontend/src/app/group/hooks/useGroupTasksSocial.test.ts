import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import type { SocialEntityView, ListSocialEntitiesOptions, SocialScopeType } from '@/lib/api/social';
import { loadGroupTasksSocial } from './useGroupTasksSocial';

// Module-isolated tests for the pure data-flow primitive that backs
// `useGroupTasksSocial`. The hook wraps this with React state — see
// CLAUDE.md "What not to test in unit tests: React hooks" — so we exercise
// the load logic directly with an injected fetcher.

type Fetcher = (
    scopeType: SocialScopeType,
    scopeId: string,
    opts?: ListSocialEntitiesOptions,
) => Promise<ApiResponse<{ entities: SocialEntityView[] }>>;

function makeView(id: string, payloadTitle: string, dueAt?: string): SocialEntityView {
    const payload: Record<string, unknown> = { title: payloadTitle, body: '' };
    if (dueAt) payload.dueAt = dueAt;
    return {
        entity: {
            id,
            kind: 'task',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'u-1',
            payload,
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
        },
        reactions: [],
        myReactions: [],
        commentCount: 0,
        attachmentCount: 0,
        isPinned: false,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('loadGroupTasksSocial', () => {
    it('builds the scopeId `group:<key>` and asks for kind=task with pinnedFirst=false', async () => {
        // Locks the contract — tasks query the social store with `pinnedFirst:
        // false` (unlike feed posts) and a higher `limit: 100`. A regression
        // here would either re-introduce a curated section the tasks UI does
        // not render, or silently truncate the list.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        await loadGroupTasksSocial('ITS-21', fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('group', 'group:ITS-21', {
            kind: 'task',
            limit: 100,
            pinnedFirst: false,
        });
    });

    it('maps each returned entity through `socialEntityToTaskView`', async () => {
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: true,
            data: {
                entities: [
                    makeView('a', 'Read chapter 1', '2026-03-01T00:00:00Z'),
                    makeView('b', 'Read chapter 2'),
                ],
            },
        });
        const result = await loadGroupTasksSocial('ITS-21', fetcher);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected ok');
        expect(result.tasks).toHaveLength(2);
        expect(result.tasks[0]).toMatchObject({
            id: 'a',
            title: 'Read chapter 1',
            dueAt: '2026-03-01T00:00:00Z',
            groupKey: 'ITS-21',
        });
        expect(result.tasks[1]).toMatchObject({
            id: 'b',
            title: 'Read chapter 2',
            groupKey: 'ITS-21',
        });
        expect(result.tasks[1].dueAt).toBeUndefined();
    });

    it('returns an error result with the API message when the call fails', async () => {
        // Error mapping is critical — `TasksTab` surfaces the raw string in
        // the UI under the legacy-style `tasksState.error` field.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: false,
            error: 'Server unavailable',
            errorCode: 'NETWORK_ERROR',
        });
        const result = await loadGroupTasksSocial('ITS-21', fetcher);
        expect(result).toEqual({ ok: false, error: 'Server unavailable' });
    });

    it('falls back to a generic message when the API result omits `error`', async () => {
        // Defensive: a non-success ApiResponse without `error` should still
        // produce a user-visible string rather than `undefined`.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: false });
        const result = await loadGroupTasksSocial('ITS-21', fetcher);
        expect(result).toEqual({ ok: false, error: 'Failed to load tasks' });
    });

    it('returns an empty task array when the backend returns no entities', async () => {
        // Empty task list is not an error — explicit assertion so we never
        // accidentally rebrand "empty" as "failure" in the UI.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        const result = await loadGroupTasksSocial('CSE-22', fetcher);
        expect(result).toEqual({ ok: true, tasks: [] });
    });
});
