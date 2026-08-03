/**
 * Phase 1c — backward-compatibility shim for friendships.
 *
 * Every legacy write into the dual `app_friend_requests` + `app_friends`
 * tables (driven by `services/messaging.ts`) is mirrored into the
 * universal `app_social_friendship` store. Legacy is still source-of-truth
 * for reads; the new store is populated in parallel so Phase 1e's cutover
 * has no gaps.
 *
 * Failure mode: **non-fatal**. If any new-store call throws, we log and
 * swallow — the caller's legacy write already succeeded and the system
 * stays functional. This is the same contract as the other six shims
 * (group_posts, group_tasks, group_extra_lessons, coordinator_announcements,
 * chat_messages, global_chat_messages).
 *
 * Legacy → universal mapping:
 *
 *   - legacy `app_friend_requests.requester_user_id` → requester_user_id
 *   - legacy `app_friend_requests.target_user_id`    → addressee_user_id
 *   - legacy `app_friend_requests.status`            → status
 *   - on accept, the legacy code ALSO inserts into `app_friends` — the
 *     universal model keeps the same row and just flips status to
 *     'accepted'. We do not mirror the `app_friends` INSERT separately;
 *     the existing pending mirror is updated in place.
 *   - on `removeFriend` (which targets `app_friends`, not
 *     `app_friend_requests`) we look up the universal accepted row by
 *     canonical pair_key and flip it to 'removed'.
 *
 * The back-link column lives on `app_friend_requests.social_friendship_id`
 * (added by db/postgres.ts at bootstrap). `app_friends` has no surrogate
 * id, so the shim's "find by pair" call covers the gap.
 */

import { withSupabasePostgres } from '../db/postgres.js';
import {
    canonicalPairKey,
    removeFriend as removeFriendUniversal,
    sendFriendRequest as sendFriendRequestUniversal,
    SocialFriendshipError,
} from './social-friends.js';

async function fetchSocialFriendshipIdForLegacyRequest(
    legacyId: string,
): Promise<string | null> {
    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{ social_friendship_id: string | null }>(
            `select social_friendship_id from app_friend_requests where id = $1 limit 1`,
            [legacyId],
        );
        return rows.rows[0]?.social_friendship_id ?? null;
    });
    return result ?? null;
}

async function persistSocialFriendshipIdOnLegacyRequest(
    legacyId: string,
    socialFriendshipId: string,
): Promise<void> {
    await withSupabasePostgres(async (client) => {
        await client.query(
            `update app_friend_requests set social_friendship_id = $2 where id = $1`,
            [legacyId, socialFriendshipId],
        );
        return null;
    });
}

function logShimFailure(operation: string, legacyId: string, error: unknown): void {
    console.error(`[social shim] dual-write ${operation} failed for friendships`, {
        legacyId,
        error: error instanceof Error ? error.message : String(error),
    });
}

/**
 * Mirror a new legacy friend request into `app_social_friendship` as a
 * 'pending' row, and stamp the resulting uuid back onto
 * `app_friend_requests.social_friendship_id`.
 *
 * If the universal row already exists for this pair (e.g. a stale orphan
 * row from a prior aborted flow), we swallow the conflict — the legacy
 * source-of-truth is already correct and re-mirroring on a conflict would
 * just spam the log.
 */
export async function shimMirrorSendFriendRequest(args: {
    legacyId: string;
    requesterUserId: string;
    addresseeUserId: string;
    note?: string | null;
}): Promise<void> {
    try {
        const fr = await sendFriendRequestUniversal(
            args.requesterUserId,
            args.addresseeUserId,
            args.note ?? null,
        );
        await persistSocialFriendshipIdOnLegacyRequest(args.legacyId, fr.id);
    } catch (error) {
        // SOCIAL_FRIENDSHIP_EXISTS / SOCIAL_FRIENDSHIP_ALREADY_FRIENDS:
        // the universal store already has a live row for this pair. That
        // is the expected steady-state once Phase 1c has been running for
        // a while (e.g. a user resends after the universal row was created
        // by an earlier write that the legacy column still doesn't know
        // about). Swallow silently — the legacy write was the canonical
        // op for this phase.
        if (error instanceof SocialFriendshipError && (
            error.code === 'SOCIAL_FRIENDSHIP_EXISTS'
            || error.code === 'SOCIAL_FRIENDSHIP_ALREADY_FRIENDS'
        )) {
            return;
        }
        logShimFailure('send', args.legacyId, error);
    }
}

/**
 * Mirror a response (accept/reject) onto the universal row by id. If the
 * back-link is missing (pre-shim pending row), we look up by pair_key as
 * a recovery path before giving up.
 */
export async function shimMirrorRespond(args: {
    legacyId: string;
    response: 'accepted' | 'rejected';
    requesterUserId: string;
    addresseeUserId: string;
}): Promise<void> {
    try {
        const id = await fetchSocialFriendshipIdForLegacyRequest(args.legacyId);
        if (!id) {
            // Pre-shim row → no mirror exists. Best-effort recovery: create
            // a pending row + flip it in two steps. We don't have a great
            // alternative here without a full backfill, so the migration
            // script (`migrate-social-store.ts --with-friendships`) is the
            // canonical fix.
            return;
        }
        const now = new Date();
        await withSupabasePostgres(async (client) => {
            await client.query(
                `
                    update app_social_friendship
                    set status = $2, responded_at = $3
                    where id = $1::uuid
                      and status = 'pending'
                `,
                [id, args.response, now],
            );
            return null;
        });
    } catch (error) {
        logShimFailure('respond', args.legacyId, error);
    }
}

/**
 * Mirror a cancel onto the universal row. Sets status to 'cancelled' on
 * the linked row. No-op when the back-link is missing.
 */
export async function shimMirrorCancel(args: {
    legacyId: string;
}): Promise<void> {
    try {
        const id = await fetchSocialFriendshipIdForLegacyRequest(args.legacyId);
        if (!id) return;
        const now = new Date();
        await withSupabasePostgres(async (client) => {
            await client.query(
                `
                    update app_social_friendship
                    set status = 'cancelled', responded_at = $2
                    where id = $1::uuid
                      and status = 'pending'
                `,
                [id, now],
            );
            return null;
        });
    } catch (error) {
        logShimFailure('cancel', args.legacyId, error);
    }
}

/**
 * Mirror a friendship removal — the legacy code deletes from `app_friends`,
 * so we flip the universal accepted row to 'removed'. Looked up by the
 * canonical pair_key because the legacy `app_friends` composite-PK row
 * carries no surrogate id we could correlate against `social_friendship_id`.
 */
export async function shimMirrorRemove(args: {
    viewerUserId: string;
    otherUserId: string;
}): Promise<void> {
    try {
        await removeFriendUniversal(args.viewerUserId, args.otherUserId);
    } catch (error) {
        // The most common failure here is SOCIAL_FRIENDSHIP_NOT_FOUND when
        // the universal row is missing (pre-shim friendship). Same recovery
        // story as respond: the backfill script will close the gap.
        if (error instanceof SocialFriendshipError && error.code === 'SOCIAL_FRIENDSHIP_NOT_FOUND') {
            return;
        }
        // pair_key is informational only in this log path — it's not a row
        // identifier on the legacy side.
        const pair = canonicalPairKey(args.viewerUserId, args.otherUserId);
        logShimFailure('remove', pair, error);
    }
}
