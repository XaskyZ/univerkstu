/**
 * Unit tests for the social-friends hook + pure helpers. React-hook flow
 * is intentionally NOT exercised here (per AGENTS.md testing rules); we
 * test `loadSocialFriends` / `socialFriendToFriendView` /
 * `buildDirectRoomIdClient` directly.
 */
import { describe, expect, it, vi } from 'vitest';
import {
    buildDirectRoomIdClient,
    loadSocialFriends,
    socialFriendToFriendView,
} from './useSocialFriends';

describe('buildDirectRoomIdClient', () => {
    it('produces "direct:<low>::<high>" with lexicographic sort', () => {
        expect(buildDirectRoomIdClient('alice', 'bob')).toBe('direct:alice::bob');
        expect(buildDirectRoomIdClient('bob', 'alice')).toBe('direct:alice::bob');
    });

    it('is stable across whitespace in the inputs', () => {
        expect(buildDirectRoomIdClient(' alice ', 'bob')).toBe('direct:alice::bob');
    });
});

describe('socialFriendToFriendView', () => {
    it('falls back to userId when no label resolver is available', () => {
        const view = socialFriendToFriendView('alice', {
            userId: 'bob',
            friendshipId: 'fr-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            acceptedAt: '2026-01-02T00:00:00.000Z',
        });
        expect(view.userId).toBe('bob');
        expect(view.label).toBe('bob');
    });

    it('uses acceptedAt as the createdAt value (UI sorts by friendship age)', () => {
        const view = socialFriendToFriendView('alice', {
            userId: 'bob',
            friendshipId: 'fr-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            acceptedAt: '2026-01-02T00:00:00.000Z',
        });
        expect(view.createdAt).toBe('2026-01-02T00:00:00.000Z');
    });

    it('falls back to createdAt when acceptedAt is null', () => {
        const view = socialFriendToFriendView('alice', {
            userId: 'bob',
            friendshipId: 'fr-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            acceptedAt: null,
        });
        expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('builds the canonical direct room id', () => {
        const view = socialFriendToFriendView('alice', {
            userId: 'bob',
            friendshipId: 'fr-1',
            createdAt: '2026-01-01',
            acceptedAt: null,
        });
        expect(view.roomId).toBe('direct:alice::bob');
    });

    it('reports no last-message/unread signal from the universal store', () => {
        const view = socialFriendToFriendView('alice', {
            userId: 'bob',
            friendshipId: 'fr-1',
            createdAt: '2026-01-01',
            acceptedAt: null,
        });
        expect(view.lastMessageAt).toBeNull();
        expect(view.unreadCount).toBe(0);
    });
});

describe('loadSocialFriends', () => {
    it('returns the combined payload when all three fetches succeed', async () => {
        const friend = {
            userId: 'bob',
            friendshipId: 'fr-1',
            createdAt: '2026-01-01',
            acceptedAt: '2026-01-02',
        };
        const request = {
            id: 'fr-2',
            requesterUserId: 'carol',
            addresseeUserId: 'alice',
            status: 'pending' as const,
            createdAt: '2026-01-03',
            respondedAt: null,
            note: null,
            pairKey: 'alice::carol',
            direction: 'incoming' as const,
        };

        const getFriends = vi.fn(async () => ({
            success: true as const,
            data: { friends: [friend] },
        }));
        const getRequests = vi.fn(async (direction: 'incoming' | 'outgoing') => ({
            success: true as const,
            data: { requests: direction === 'incoming' ? [request] : [] },
        }));

        const result = await loadSocialFriends({ getFriends, getRequests });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.friends).toEqual([friend]);
            expect(result.incoming).toEqual([request]);
            expect(result.outgoing).toEqual([]);
        }
        // Both directions are requested.
        expect(getRequests).toHaveBeenCalledWith('incoming');
        expect(getRequests).toHaveBeenCalledWith('outgoing');
    });

    it('returns ok=false when the friends fetch fails', async () => {
        const getFriends = vi.fn(async () => ({
            success: false as const,
            error: 'boom',
        }));
        const getRequests = vi.fn(async () => ({
            success: true as const,
            data: { requests: [] },
        }));

        const result = await loadSocialFriends({ getFriends, getRequests });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe('boom');
        }
    });

    it('returns ok=false when the incoming-requests fetch fails', async () => {
        const getFriends = vi.fn(async () => ({
            success: true as const,
            data: { friends: [] },
        }));
        const getRequests = vi.fn(async (direction: 'incoming' | 'outgoing') => ({
            success: direction === 'incoming' ? false as const : true as const,
            error: direction === 'incoming' ? 'incoming-fail' : undefined,
            data: direction === 'outgoing' ? { requests: [] } : undefined,
        }));

        const result = await loadSocialFriends({ getFriends, getRequests });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe('incoming-fail');
        }
    });

    it('returns ok=false when the outgoing-requests fetch fails', async () => {
        const getFriends = vi.fn(async () => ({
            success: true as const,
            data: { friends: [] },
        }));
        const getRequests = vi.fn(async (direction: 'incoming' | 'outgoing') => ({
            success: direction === 'outgoing' ? false as const : true as const,
            error: direction === 'outgoing' ? 'outgoing-fail' : undefined,
            data: direction === 'incoming' ? { requests: [] } : undefined,
        }));

        const result = await loadSocialFriends({ getFriends, getRequests });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toBe('outgoing-fail');
        }
    });

    it('defaults empty arrays when the server returns success without data', async () => {
        const getFriends = vi.fn(async () => ({ success: true as const }));
        const getRequests = vi.fn(async () => ({ success: true as const }));

        const result = await loadSocialFriends({ getFriends, getRequests });
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.friends).toEqual([]);
            expect(result.incoming).toEqual([]);
            expect(result.outgoing).toEqual([]);
        }
    });
});
