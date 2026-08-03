import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import type { SocialEntityView, ListSocialEntitiesOptions, SocialScopeType } from '@/lib/api/social';
import { loadAnnouncementsSocial } from './useAnnouncementsSocial';

// Module-isolated tests for the pure data-flow primitive that backs
// `useAnnouncementsSocial`. The hook itself wraps this with React state — see
// CLAUDE.md "What not to test in unit tests: React hooks" — so we exercise
// the load logic directly with an injected fetcher.

type Fetcher = (
    scopeType: SocialScopeType,
    scopeId: string,
    opts?: ListSocialEntitiesOptions,
) => Promise<ApiResponse<{ entities: SocialEntityView[] }>>;

function makeView(id: string, title: string, priority: string = 'low'): SocialEntityView {
    return {
        entity: {
            id,
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:global',
            authorUserId: 'coordinator-1',
            payload: { title, body: `Body of ${id}`, priority },
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

describe('loadAnnouncementsSocial', () => {
    it('queries the global announcement scope with kind=announcement, limit=50, pinnedFirst', async () => {
        // Locks the contract that the hook always hits the global scope with
        // the kind discriminator. A regression that dropped the kind would
        // surface unrelated entities; a regression that flipped the scope
        // would split the announcement timeline. The pinnedFirst flag is
        // forward-compat (legacy doesn't pin announcements) but we hold the
        // line so the social pin endpoint actually surfaces above the fold.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        await loadAnnouncementsSocial(fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('announcement', 'announcement:global', {
            kind: 'announcement',
            limit: 50,
            pinnedFirst: true,
        });
    });

    it('returns the raw social entity views (caller chooses adapter)', async () => {
        // Unlike `loadGroupFeedSocial`, this primitive does NOT map through
        // the adapter — pages with different consumer shapes (coordinator
        // reads `CoordinatorAnnouncementView`, fresh code may read the
        // universal entity directly) need access to the unmapped row.
        const a = makeView('a', 'First');
        const b = makeView('b', 'Second', 'critical');
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: true,
            data: { entities: [a, b] },
        });
        const result = await loadAnnouncementsSocial(fetcher);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected ok');
        expect(result.announcements).toHaveLength(2);
        expect(result.announcements[0]).toBe(a);
        expect(result.announcements[1]).toBe(b);
    });

    it('returns an error result with the API message when the call fails', async () => {
        // Error mapping is critical — pages show the raw `error` string in the
        // UI. Make sure we surface what fetchWithAuth returned.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: false,
            error: 'Server unavailable',
            errorCode: 'NETWORK_ERROR',
        });
        const result = await loadAnnouncementsSocial(fetcher);
        expect(result).toEqual({ ok: false, error: 'Server unavailable' });
    });

    it('falls back to a generic message when the API result omits `error`', async () => {
        // Defensive: a non-success ApiResponse without `error` should still
        // produce a user-visible string rather than `undefined`.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: false });
        const result = await loadAnnouncementsSocial(fetcher);
        expect(result).toEqual({ ok: false, error: 'Failed to load announcements' });
    });

    it('returns an empty announcement array when the backend returns no entities', async () => {
        // Empty list is not an error — explicit assertion so we never
        // accidentally rebrand "empty" as "failure" in the UI.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        const result = await loadAnnouncementsSocial(fetcher);
        expect(result).toEqual({ ok: true, announcements: [] });
    });

    it('tolerates a success response missing the `data` envelope', async () => {
        // Defensive: a `success: true` with no `data` (e.g. an empty 204
        // shimmed up to JSON) should not throw on `.entities`. Should treat
        // it the same as an empty list.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true });
        const result = await loadAnnouncementsSocial(fetcher);
        expect(result).toEqual({ ok: true, announcements: [] });
    });
});
