import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import type { SocialEntityView, ListSocialEntitiesOptions, SocialScopeType } from '@/lib/api/social';
import { loadDmMessagesSocial } from './useDmMessagesSocial';

// Module-isolated tests for the pure data-flow primitive that backs
// `useDmMessagesSocial`. The hook itself wraps this with React state — see
// CLAUDE.md "What not to test in unit tests: React hooks" — so we exercise
// the load logic directly with an injected fetcher.

type Fetcher = (
    scopeType: SocialScopeType,
    scopeId: string,
    opts?: ListSocialEntitiesOptions,
) => Promise<ApiResponse<{ entities: SocialEntityView[] }>>;

function makeView(id: string, body: string, createdAt: string, authorUserId = 'u-1'): SocialEntityView {
    return {
        entity: {
            id,
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: 'dm:room-abc',
            authorUserId,
            payload: { body },
            pinned: false,
            createdAt,
            updatedAt: createdAt,
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

describe('loadDmMessagesSocial', () => {
    it('builds the scopeId `dm:<roomId>` and asks for kind=dm_message with pinnedFirst=false', async () => {
        // Locks the contract — DM thread queries the social store with
        // `pinnedFirst: false` (chronological, not feed-style) and a
        // `limit: 100` ceiling that mirrors `getChatRoomDetail(_, 100)`. A
        // regression here would either re-introduce a "pinned messages"
        // section the DM UI does not render, or silently truncate older
        // messages out of the thread.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        await loadDmMessagesSocial('room-abc', fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('dm', 'dm:room-abc', {
            kind: 'dm_message',
            limit: 100,
            pinnedFirst: false,
        });
    });

    it('maps each returned entity through `socialEntityToDmMessageView`', async () => {
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: true,
            data: {
                entities: [
                    makeView('a', 'first', '2026-05-01T12:00:00Z'),
                    makeView('b', 'second', '2026-05-01T12:01:00Z'),
                ],
            },
        });
        const result = await loadDmMessagesSocial('room-abc', fetcher);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected ok');
        expect(result.messages).toHaveLength(2);
        expect(result.messages[0]).toMatchObject({
            id: 'a',
            body: 'first',
            roomId: 'room-abc',
        });
        expect(result.messages[1]).toMatchObject({
            id: 'b',
            body: 'second',
            roomId: 'room-abc',
        });
    });

    it('sorts messages by `createdAt` ASC (chronological / oldest-first) after mapping', async () => {
        // The social list endpoint returns DESC (newest first); the chat
        // thread renders oldest-first with scroll-to-bottom on send. The hook
        // must re-sort, otherwise the thread renders inverted.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: true,
            data: {
                entities: [
                    makeView('newest', '3', '2026-05-01T12:02:00Z'),
                    makeView('oldest', '1', '2026-05-01T12:00:00Z'),
                    makeView('middle', '2', '2026-05-01T12:01:00Z'),
                ],
            },
        });
        const result = await loadDmMessagesSocial('room-abc', fetcher);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected ok');
        expect(result.messages.map((m) => m.id)).toEqual(['oldest', 'middle', 'newest']);
    });

    it('returns an error result with the API message when the call fails', async () => {
        // Error mapping is critical — `DialogsPanel` surfaces the raw string
        // under the existing room-error slot.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: false,
            error: 'Server unavailable',
            errorCode: 'NETWORK_ERROR',
        });
        const result = await loadDmMessagesSocial('room-abc', fetcher);
        expect(result).toEqual({ ok: false, error: 'Server unavailable' });
    });

    it('falls back to a generic message when the API result omits `error`', async () => {
        // Defensive: a non-success ApiResponse without `error` should still
        // produce a user-visible string rather than `undefined`.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: false });
        const result = await loadDmMessagesSocial('room-abc', fetcher);
        expect(result).toEqual({ ok: false, error: 'Failed to load messages' });
    });

    it('returns an empty message array when the backend returns no entities', async () => {
        // Empty thread is not an error — explicit assertion so we never
        // accidentally rebrand "empty" as "failure" in the UI.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        const result = await loadDmMessagesSocial('quiet-room', fetcher);
        expect(result).toEqual({ ok: true, messages: [] });
    });
});
