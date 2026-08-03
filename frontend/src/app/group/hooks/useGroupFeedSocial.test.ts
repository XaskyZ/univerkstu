import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import type { SocialEntityView, ListSocialEntitiesOptions, SocialScopeType } from '@/lib/api/social';
import { loadGroupFeedSocial } from './useGroupFeedSocial';

// Module-isolated tests for the pure data-flow primitive that backs
// `useGroupFeedSocial`. The hook itself wraps this with React state — see
// CLAUDE.md "What not to test in unit tests: React hooks" — so we exercise
// the load logic directly with an injected fetcher.

type Fetcher = (
    scopeType: SocialScopeType,
    scopeId: string,
    opts?: ListSocialEntitiesOptions,
) => Promise<ApiResponse<{ entities: SocialEntityView[] }>>;

function makeView(id: string, payloadBody: string, pinned = false): SocialEntityView {
    return {
        entity: {
            id,
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'u-1',
            payload: { title: id, body: payloadBody },
            pinned,
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
        isPinned: pinned,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('loadGroupFeedSocial', () => {
    it('builds the scopeId `group:<key>` and asks for kind=post with pinnedFirst', async () => {
        // Locks the contract that the hook always hits `kind: post` and
        // `pinnedFirst: true`. A regression that dropped pinnedFirst would
        // silently reorder the feed below the legacy layout.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        await loadGroupFeedSocial('ITS-21', fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('group', 'group:ITS-21', {
            kind: 'post',
            limit: 50,
            pinnedFirst: true,
        });
    });

    it('maps each returned entity through `socialEntityToPostView`', async () => {
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: true,
            data: { entities: [makeView('a', 'hello', true), makeView('b', 'world')] },
        });
        const result = await loadGroupFeedSocial('ITS-21', fetcher);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected ok');
        expect(result.posts).toHaveLength(2);
        expect(result.posts[0]).toMatchObject({ id: 'a', body: 'hello', pinned: true, groupKey: 'ITS-21' });
        expect(result.posts[1]).toMatchObject({ id: 'b', body: 'world', pinned: false, groupKey: 'ITS-21' });
    });

    it('returns an error result with the API message when the call fails', async () => {
        // Error mapping is critical — `useGroupFeed` shows the raw `error`
        // string in the UI. Make sure we surface what fetchWithAuth returned.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: false,
            error: 'Server unavailable',
            errorCode: 'NETWORK_ERROR',
        });
        const result = await loadGroupFeedSocial('ITS-21', fetcher);
        expect(result).toEqual({ ok: false, error: 'Server unavailable' });
    });

    it('falls back to a generic message when the API result omits `error`', async () => {
        // Defensive: a non-success ApiResponse without `error` should still
        // produce a user-visible string rather than `undefined`.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: false });
        const result = await loadGroupFeedSocial('ITS-21', fetcher);
        expect(result).toEqual({ ok: false, error: 'Failed to load feed' });
    });

    it('returns an empty post array when the backend returns no entities', async () => {
        // Empty feed is not an error — explicit assertion so we never
        // accidentally rebrand "empty" as "failure" in the UI.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        const result = await loadGroupFeedSocial('CSE-22', fetcher);
        expect(result).toEqual({ ok: true, posts: [] });
    });
});
