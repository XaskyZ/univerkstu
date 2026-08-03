import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import type { SocialEntityView, ListSocialEntitiesOptions, SocialScopeType } from '@/lib/api/social';
import {
    loadGlobalChatSocial,
    sortGlobalChatEntries,
} from './useGlobalChatSocial';
import type { GlobalMessageAdapterShape } from '../utils/social-entity-to-global-message';

// Module-isolated tests for the pure data-flow primitive that backs
// `useGlobalChatSocial`. The hook itself wraps this with React state — see
// CLAUDE.md "What not to test in unit tests: React hooks" — so we exercise
// the load logic directly with an injected fetcher.

type Fetcher = (
    scopeType: SocialScopeType,
    scopeId: string,
    opts?: ListSocialEntitiesOptions,
) => Promise<ApiResponse<{ entities: SocialEntityView[] }>>;

function makeView(
    id: string,
    body: string,
    overrides: Partial<SocialEntityView['entity']> = {},
): SocialEntityView {
    return {
        entity: {
            id,
            kind: 'global_message',
            scopeType: 'global',
            scopeId: 'global:chat',
            authorUserId: 'user-1',
            payload: { body },
            pinned: false,
            createdAt: '2026-05-20T10:00:00Z',
            updatedAt: '2026-05-20T10:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...overrides,
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

function makeAdapter(
    id: string,
    overrides: Partial<GlobalMessageAdapterShape> = {},
): GlobalMessageAdapterShape {
    return {
        id,
        authorUserId: 'user-1',
        body: `body ${id}`,
        createdAt: '2026-05-20T10:00:00Z',
        pinned: false,
        deletedAt: null,
        deletedReason: null,
        ...overrides,
    };
}

describe('loadGlobalChatSocial', () => {
    it('queries the global:chat scope with kind=global_message, limit=100, pinnedFirst', async () => {
        // Locks the contract that the hook always hits the global:chat scope
        // with the kind discriminator. A regression that dropped the kind
        // would mix DMs and global messages; a regression that flipped the
        // scope would split the global timeline. The pinnedFirst flag matches
        // the legacy chat behaviour (pinned messages stay above the fold).
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        await loadGlobalChatSocial(fetcher);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher).toHaveBeenCalledWith('global', 'global:chat', {
            kind: 'global_message',
            limit: 100,
            pinnedFirst: true,
        });
    });

    it('returns adapter-shaped messages (caller never sees raw SocialEntityView)', async () => {
        // Chat consumers do not have a legitimate reason to read the raw
        // entity — unlike announcements where coordinator/curator/starosta
        // each consume the legacy shape. Verify the load primitive does the
        // mapping inline so the hook surface stays narrow.
        const a = makeView('a', 'Hello');
        const b = makeView('b', 'World');
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: true,
            data: { entities: [a, b] },
        });
        const result = await loadGlobalChatSocial(fetcher);
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error('expected ok');
        expect(result.messages).toHaveLength(2);
        // Both entries should be adapter-shaped (not raw views) — the
        // presence of `body` at the top level rather than under
        // `entity.payload` is the smoking gun.
        expect(result.messages[0].body).toBeDefined();
        expect(result.messages[1].body).toBeDefined();
    });

    it('returns an error result with the API message when the call fails', async () => {
        // Error mapping is critical — the chat page shows the raw `error`
        // string in a `PageStateCard`. Make sure we surface what
        // fetchWithAuth returned.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({
            success: false,
            error: 'Server unavailable',
            errorCode: 'NETWORK_ERROR',
        });
        const result = await loadGlobalChatSocial(fetcher);
        expect(result).toEqual({ ok: false, error: 'Server unavailable' });
    });

    it('falls back to a generic message when the API result omits `error`', async () => {
        // Defensive: a non-success ApiResponse without `error` should still
        // produce a user-visible string rather than `undefined`.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: false });
        const result = await loadGlobalChatSocial(fetcher);
        expect(result).toEqual({ ok: false, error: 'Failed to load global chat' });
    });

    it('returns an empty message array when the backend returns no entities', async () => {
        // Empty list is not an error — explicit assertion so we never
        // accidentally rebrand "empty" as "failure" in the UI.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true, data: { entities: [] } });
        const result = await loadGlobalChatSocial(fetcher);
        expect(result).toEqual({ ok: true, messages: [] });
    });

    it('tolerates a success response missing the `data` envelope', async () => {
        // Defensive: a `success: true` with no `data` (e.g. an empty 204
        // shimmed up to JSON) should not throw on `.entities`. Should treat
        // it the same as an empty list.
        const fetcher = vi.fn<Fetcher>().mockResolvedValue({ success: true });
        const result = await loadGlobalChatSocial(fetcher);
        expect(result).toEqual({ ok: true, messages: [] });
    });
});

describe('sortGlobalChatEntries', () => {
    it('puts pinned messages first, then reverses regular messages to ASC chronological', async () => {
        // The universal endpoint returns DESC by createdAt (newest first);
        // chat reads ASC (oldest first) so the visible thread feels chat-like.
        // Pinned messages stay pinned-first (matching the legacy global-chat
        // ordering) and the rest are flipped to ASC.
        const newest = makeAdapter('newest', { createdAt: '2026-05-20T10:00:00Z' });
        const middle = makeAdapter('middle', { createdAt: '2026-05-20T09:00:00Z' });
        const oldest = makeAdapter('oldest', { createdAt: '2026-05-20T08:00:00Z' });
        const pinnedNew = makeAdapter('pinNew', { pinned: true, createdAt: '2026-05-20T11:00:00Z' });
        const pinnedOld = makeAdapter('pinOld', { pinned: true, createdAt: '2026-05-20T07:00:00Z' });
        // API order (DESC, pinnedFirst): pinned-by-createdAt-DESC, then regular DESC
        const apiOrder = [pinnedNew, pinnedOld, newest, middle, oldest];
        const sorted = sortGlobalChatEntries(apiOrder);
        expect(sorted.map((m) => m.id)).toEqual([
            'pinNew',
            'pinOld',
            'oldest',
            'middle',
            'newest',
        ]);
    });

    it('preserves the API order for pinned messages (most-recently-pinned first)', () => {
        // The pinned section is NOT re-sorted by the helper — we trust the
        // backend's `pinnedFirst` ordering for pinned entries. Verify the
        // helper does not accidentally reverse them along with the regular
        // tail.
        const p1 = makeAdapter('p1', { pinned: true, createdAt: '2026-05-20T11:00:00Z' });
        const p2 = makeAdapter('p2', { pinned: true, createdAt: '2026-05-20T10:00:00Z' });
        const p3 = makeAdapter('p3', { pinned: true, createdAt: '2026-05-20T09:00:00Z' });
        const sorted = sortGlobalChatEntries([p1, p2, p3]);
        expect(sorted.map((m) => m.id)).toEqual(['p1', 'p2', 'p3']);
    });

    it('returns an empty array when given no entries', () => {
        // Edge case — never crashes on an empty thread. The integration layer
        // hands us this directly when the backend returns `entities: []`.
        expect(sortGlobalChatEntries([])).toEqual([]);
    });

    it('handles a single-element pinned or regular list without re-ordering', () => {
        // Sanity check on the single-element fast path.
        const pinned = makeAdapter('only-pin', { pinned: true });
        const regular = makeAdapter('only-reg');
        expect(sortGlobalChatEntries([pinned]).map((m) => m.id)).toEqual(['only-pin']);
        expect(sortGlobalChatEntries([regular]).map((m) => m.id)).toEqual(['only-reg']);
    });

    it('does not mutate the input array', () => {
        // The helper uses Array.prototype.reverse internally, which mutates
        // in place. Verify we operate on a copy so callers can keep their
        // own references stable (the hook stores them in React state).
        const a = makeAdapter('a', { createdAt: '2026-05-20T10:00:00Z' });
        const b = makeAdapter('b', { createdAt: '2026-05-20T09:00:00Z' });
        const input = [a, b];
        const inputSnapshot = [...input];
        sortGlobalChatEntries(input);
        expect(input).toEqual(inputSnapshot);
    });
});
