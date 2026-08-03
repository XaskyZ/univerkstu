/**
 * `useSocialFriends` — read-only friendships hook backed by the universal
 * social-friends store (`/api/v3/social/friends/*`).
 *
 * Phase 1c POC entry point for the friends-migration leg of the social
 * store rollout. Gated by the `socialFeedBeta` feature flag (see
 * `ProfileFriendsStrip` / `AddFriendSheet` / `FriendRequestsSheet`) and
 * wired alongside the legacy `useFriends` so the two can be toggled at
 * runtime.
 *
 * Important boundaries:
 *  - **Reads** come from the new store; **writes** still flow through
 *    `useFriends` → legacy `/api/v3/chat/friends/*` so the friends-shim
 *    dual-write keeps both stores in sync. We will flip writes in Phase 1e.
 *  - The adapter (`socialFriendToFriendView`) mirrors the legacy
 *    `FriendView` shape so existing UI keeps working — `roomId` is
 *    rebuilt from the canonical direct-room pair, `label` falls back to
 *    `userId`, and we don't surface unread counts (no source-of-truth
 *    yet in the universal store).
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import type { FriendView } from '@/lib/api';
import {
    getSocialFriendRequests,
    getSocialFriends,
    type SocialFriend,
    type SocialFriendRequest,
} from '@/lib/api/social-friends';

/**
 * Build the canonical direct-room id used by the legacy chat surface.
 * Mirrors `backend/src/services/messaging.ts#buildDirectRoomId` so the
 * adapter result drops in next to legacy `FriendView` rows without UI
 * changes.
 */
export function buildDirectRoomIdClient(userA: string, userB: string): string {
    const a = userA.trim();
    const b = userB.trim();
    const [low, high] = a < b ? [a, b] : [b, a];
    return `direct:${low}::${high}`;
}

/**
 * Adapter: `SocialFriend` (universal store) → legacy `FriendView`. Used
 * by `ProfileFriendsStrip` and any other component still wired to the
 * legacy shape during the rollout. Exported for unit tests.
 */
export function socialFriendToFriendView(
    viewerUserId: string,
    friend: SocialFriend,
): FriendView {
    const createdAt = friend.acceptedAt ?? friend.createdAt;
    return {
        userId: friend.userId,
        // We don't have a label resolver in the universal store yet — fall
        // back to userId. Phase 2 will plug into `services/social-users.ts`.
        label: friend.userId,
        roomId: buildDirectRoomIdClient(viewerUserId, friend.userId),
        createdAt,
        // No last-message/unread plumbing in the universal friendship
        // surface yet. UI treats null/0 as "no signal" today.
        lastMessageAt: null,
        unreadCount: 0,
    } satisfies FriendView;
}

export interface UseSocialFriendsResult {
    friends: SocialFriend[];
    pendingIncoming: SocialFriendRequest[];
    pendingOutgoing: SocialFriendRequest[];
    loading: boolean;
    error: string;
    refresh: () => Promise<void>;
    /**
     * Convenience adapter that bridges the universal payload back to the
     * legacy `FriendView[]` shape — components that haven't migrated to
     * `SocialFriend` yet can read this instead.
     */
    friendsAsLegacyView: FriendView[];
}

export interface UseSocialFriendsOptions {
    /**
     * Gate the network calls. Defaults to `true`. When `false` the hook
     * clears its state and skips fetching — used by the feed component to
     * avoid paying for both legacy + social requests when the beta flag
     * is off.
     */
    enabled?: boolean;
    /**
     * Viewer userId. Needed by the adapter to canonicalise the direct
     * room id. When undefined the hook short-circuits (same as
     * `enabled=false`).
     */
    viewerUserId?: string;
}

/**
 * Pure data-flow primitive for the social-friends read. Exposed for unit
 * testing — the hook below just lifts the result into React state.
 * Returns a discriminated result so a failure does not need to throw
 * across the hook boundary.
 *
 * `fetchers` is parameterised so tests can supply fakes without touching
 * the default-export module-level binding.
 */
export async function loadSocialFriends(
    fetchers: {
        getFriends: typeof getSocialFriends;
        getRequests: typeof getSocialFriendRequests;
    } = { getFriends: getSocialFriends, getRequests: getSocialFriendRequests },
): Promise<
    | { ok: true; friends: SocialFriend[]; incoming: SocialFriendRequest[]; outgoing: SocialFriendRequest[] }
    | { ok: false; error: string }
> {
    // The three fetches are independent — Promise.all keeps the latency
    // capped at the slowest leg instead of triple-stacking serial waits.
    const [friendsRes, incomingRes, outgoingRes]: [
        ApiResponse<{ friends: SocialFriend[] }>,
        ApiResponse<{ requests: SocialFriendRequest[] }>,
        ApiResponse<{ requests: SocialFriendRequest[] }>,
    ] = await Promise.all([
        fetchers.getFriends(),
        fetchers.getRequests('incoming'),
        fetchers.getRequests('outgoing'),
    ]);

    if (!friendsRes.success) {
        return { ok: false, error: friendsRes.error || 'Failed to load friends' };
    }
    if (!incomingRes.success) {
        return { ok: false, error: incomingRes.error || 'Failed to load incoming requests' };
    }
    if (!outgoingRes.success) {
        return { ok: false, error: outgoingRes.error || 'Failed to load outgoing requests' };
    }

    return {
        ok: true,
        friends: friendsRes.data?.friends ?? [],
        incoming: incomingRes.data?.requests ?? [],
        outgoing: outgoingRes.data?.requests ?? [],
    };
}

export function useSocialFriends(
    opts: UseSocialFriendsOptions = {},
): UseSocialFriendsResult {
    const enabled = opts.enabled !== false;
    const viewerUserId = (opts.viewerUserId || '').trim();
    const [friends, setFriends] = useState<SocialFriend[]>([]);
    const [pendingIncoming, setPendingIncoming] = useState<SocialFriendRequest[]>([]);
    const [pendingOutgoing, setPendingOutgoing] = useState<SocialFriendRequest[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !viewerUserId) {
            setFriends([]);
            setPendingIncoming([]);
            setPendingOutgoing([]);
            return;
        }

        setLoading(true);
        setError('');
        const result = await loadSocialFriends();
        if (!result.ok) {
            setError(result.error);
            setFriends([]);
            setPendingIncoming([]);
            setPendingOutgoing([]);
            setLoading(false);
            return;
        }
        setFriends(result.friends);
        setPendingIncoming(result.incoming);
        setPendingOutgoing(result.outgoing);
        setLoading(false);
    }, [enabled, viewerUserId]);

    // Wrap the initial fetch in a 0ms timeout so the synchronous setState
    // calls inside `refresh()` don't fire during the effect's commit phase
    // — same pattern as `useGroupFeedSocial`, suppresses the
    // `react-hooks/set-state-in-effect` rule without changing observable
    // behavior.
    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    const friendsAsLegacyView = viewerUserId
        ? friends.map((f) => socialFriendToFriendView(viewerUserId, f))
        : [];

    return {
        friends,
        pendingIncoming,
        pendingOutgoing,
        loading,
        error,
        refresh,
        friendsAsLegacyView,
    };
}
