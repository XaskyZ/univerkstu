/**
 * Universal social friendship API client — Phase 1c foundation for the
 * Phase 2 chat / profile rewrite.
 *
 * Mirrors the backend routes in `backend/src/routes/social-friends.ts`
 * over the `/api/v3/social/friends/*` namespace. Types are duplicated
 * here on purpose — the frontend never imports backend types so the two
 * sides can evolve under a versioned contract.
 *
 * Every function delegates to `fetchWithAuth`, which already handles:
 *  - bearer-token attachment
 *  - timeout / abort
 *  - `Failed to fetch` → server-unavailable mapping
 *  - non-2xx → ApiResponse with `error` + `errorCode`
 *  - analytics tagging (status → api_error event)
 *
 * No UI consumes these yet — this module is intentionally a thin,
 * fully-typed surface that the Phase 2 ProfileFriendsStrip / chat sheets
 * will build on top of behind the `socialFeedBeta` feature flag.
 */
import { fetchWithAuth, type ApiResponse } from './core';

// === Domain types ============================================================

export type SocialFriendshipStatus =
    | 'pending'
    | 'accepted'
    | 'rejected'
    | 'cancelled'
    | 'removed';

export interface SocialFriendship {
    id: string;
    requesterUserId: string;
    addresseeUserId: string;
    status: SocialFriendshipStatus;
    /** ISO timestamp. */
    createdAt: string;
    /** ISO timestamp; null while still pending. */
    respondedAt: string | null;
    note: string | null;
    /** Canonical `least::greatest` pair. Useful as a stable de-dupe key. */
    pairKey: string;
}

export interface SocialFriend {
    /** The "other" user from the viewer's perspective. */
    userId: string;
    friendshipId: string;
    createdAt: string;
    acceptedAt: string | null;
}

export interface SocialFriendRequest extends SocialFriendship {
    direction: 'incoming' | 'outgoing';
}

// === API functions ===========================================================

export async function sendSocialFriendRequest(
    addresseeId: string,
    note?: string | null,
): Promise<ApiResponse<SocialFriendship>> {
    return fetchWithAuth('/api/v3/social/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ addresseeId, note: note ?? null }),
    });
}

export async function respondToSocialFriendRequest(
    requestId: string,
    response: 'accepted' | 'rejected',
): Promise<ApiResponse<SocialFriendship>> {
    return fetchWithAuth(
        `/api/v3/social/friends/requests/${encodeURIComponent(requestId)}/respond`,
        {
            method: 'POST',
            body: JSON.stringify({ response }),
        },
    );
}

export async function cancelSocialFriendRequest(
    requestId: string,
): Promise<ApiResponse<SocialFriendship>> {
    return fetchWithAuth(
        `/api/v3/social/friends/requests/${encodeURIComponent(requestId)}/cancel`,
        {
            method: 'POST',
            body: JSON.stringify({}),
        },
    );
}

export async function removeSocialFriend(
    userId: string,
): Promise<ApiResponse<SocialFriendship>> {
    return fetchWithAuth(`/api/v3/social/friends/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
    });
}

export async function getSocialFriends(): Promise<ApiResponse<{ friends: SocialFriend[] }>> {
    return fetchWithAuth('/api/v3/social/friends/me');
}

export async function getSocialFriendRequests(
    direction: 'incoming' | 'outgoing',
): Promise<ApiResponse<{ requests: SocialFriendRequest[] }>> {
    return fetchWithAuth(
        `/api/v3/social/friends/requests?direction=${encodeURIComponent(direction)}`,
    );
}
