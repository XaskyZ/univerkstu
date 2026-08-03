/**
 * Universal social friendship service.
 *
 * Phase 1c migration target for the legacy friendship tables
 * (`app_friend_requests` + `app_friends`). The universal home is
 * `app_social_friendship` — a single table with a status discriminator
 * (`pending` | `accepted` | `rejected` | `cancelled` | `removed`) that
 * collapses both legacy aggregates into one cleaner shape.
 *
 * Key design choices:
 *
 *   - **Canonical pair key.** `pair_key` is a stored generated column
 *     (`least(a, b) || '::' || greatest(a, b)`) on the table. Callers
 *     never compute it; they just pass the requester/addressee in any
 *     order and the database enforces uniqueness on (pair_key, status).
 *     The pure `canonicalPairKey` helper here mirrors the SQL for unit
 *     tests so we can assert the contract without touching Postgres.
 *
 *   - **History trail, not in-place mutation.** Lifecycle transitions
 *     (pending → accepted, pending → rejected, pending → cancelled,
 *     accepted → removed) update the existing row's status + stamp
 *     `responded_at` rather than INSERTing a new row. The unique
 *     constraint on (pair_key, status) is deferrable so a future
 *     "re-friend after removal" flow can re-INSERT a pending row in
 *     the same transaction without fighting itself.
 *
 *   - **Owner-only on response/cancel/remove.** Routes call into here
 *     with `viewerUserId` and the service rejects if the viewer is not
 *     a party to the friendship (or, for cancel, not the requester).
 *
 * Phase 1c keeps the legacy tables as the read source-of-truth via the
 * shim in `services/friends-shim.ts`. Nothing else in the codebase
 * reads from `app_social_friendship` yet — these methods exist so the
 * new `/api/v3/social/friends/*` routes and the Phase-2 frontend hook
 * can build on top of them. The Phase-1e cutover will flip reads.
 */

import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';

// === Errors ==================================================================

export class SocialFriendshipError extends Error {
    statusCode: number;
    code: string;

    constructor(message: string, statusCode = 400, code = 'SOCIAL_FRIENDSHIP_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
    }
}

// === Types ===================================================================

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
    createdAt: Date;
    respondedAt: Date | null;
    note: string | null;
    pairKey: string;
}

export interface SocialFriend {
    /** The "other" user from the viewer's perspective. */
    userId: string;
    friendshipId: string;
    /** When the request was originally sent. */
    createdAt: Date;
    /** When it transitioned to `accepted`. */
    acceptedAt: Date | null;
}

export interface SocialFriendRequest extends SocialFriendship {
    direction: 'incoming' | 'outgoing';
}

interface PgFriendshipRow {
    id: string;
    requester_user_id: string;
    addressee_user_id: string;
    status: SocialFriendshipStatus;
    created_at: Date;
    responded_at: Date | null;
    note: string | null;
    pair_key: string;
}

// === Pure helpers ============================================================

/**
 * Compute the canonical pair key for a (userA, userB) pair.
 *
 * Mirrors the SQL stored-generated `pair_key` column:
 * `least(a, b) || '::' || greatest(a, b)`. Exported so unit tests and
 * shim/migration code can assert the canonical identifier without
 * round-tripping the database.
 *
 * Whitespace is trimmed (matches the trim in `requireValidUserPair`).
 * Empty strings are rejected by `requireValidUserPair` so the caller
 * never feeds empty values here; the helper itself just sorts.
 */
export function canonicalPairKey(userA: string, userB: string): string {
    const a = (userA || '').trim();
    const b = (userB || '').trim();
    return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/**
 * Validates that two userIds are non-empty, distinct, and trimmed.
 * Throws SocialFriendshipError on failure — the caller decides the HTTP
 * mapping. Returns `{ a, b }` (both trimmed) on success so the caller
 * doesn't re-trim. Exported for unit tests.
 */
export function requireValidUserPair(userA: string, userB: string): { a: string; b: string } {
    const a = (userA || '').trim();
    const b = (userB || '').trim();
    if (!a || !b) {
        throw new SocialFriendshipError(
            'Both userIds are required',
            400,
            'SOCIAL_FRIENDSHIP_USER_REQUIRED',
        );
    }
    if (a === b) {
        throw new SocialFriendshipError(
            'You cannot friend yourself',
            400,
            'SOCIAL_FRIENDSHIP_SELF',
        );
    }
    return { a, b };
}

// === Mapping =================================================================

function mapRow(row: PgFriendshipRow): SocialFriendship {
    return {
        id: row.id,
        requesterUserId: row.requester_user_id,
        addresseeUserId: row.addressee_user_id,
        status: row.status,
        createdAt: new Date(row.created_at),
        respondedAt: row.responded_at ? new Date(row.responded_at) : null,
        note: row.note,
        pairKey: row.pair_key,
    };
}

// === Postgres bridge =========================================================

async function requirePostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new SocialFriendshipError(
            `Postgres unavailable during ${operation}`,
            503,
            'SOCIAL_FRIENDSHIP_UNAVAILABLE',
        );
    }
    return result.value;
}

async function findActiveByPair(
    client: PoolClient,
    pairKey: string,
): Promise<SocialFriendship | null> {
    // "Active" here means pending or accepted — anything that should block a
    // new send. Rejected/cancelled/removed rows are historical and don't
    // count.
    const result = await client.query<PgFriendshipRow>(
        `
            select id, requester_user_id, addressee_user_id, status,
                   created_at, responded_at, note, pair_key
            from app_social_friendship
            where pair_key = $1
              and status in ('pending', 'accepted')
            order by created_at desc
            limit 1
        `,
        [pairKey],
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
}

async function findFriendshipById(
    client: PoolClient,
    id: string,
): Promise<SocialFriendship | null> {
    const result = await client.query<PgFriendshipRow>(
        `
            select id, requester_user_id, addressee_user_id, status,
                   created_at, responded_at, note, pair_key
            from app_social_friendship
            where id = $1::uuid
            limit 1
        `,
        [id],
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
}

// === Public API ==============================================================

/**
 * Send a friend request. Returns the new friendship row.
 *
 * Rejects with `SOCIAL_FRIENDSHIP_SELF` (400), `SOCIAL_FRIENDSHIP_EXISTS`
 * (409 — there is already an active row), or surfaces a PG unique-violation
 * as `SOCIAL_FRIENDSHIP_EXISTS`.
 *
 * `note` is an optional free-text field the requester can attach.
 */
export async function sendFriendRequest(
    requesterUserId: string,
    addresseeUserId: string,
    note?: string | null,
): Promise<SocialFriendship> {
    const { a: requester, b: addressee } = requireValidUserPair(requesterUserId, addresseeUserId);
    const pair = canonicalPairKey(requester, addressee);
    const trimmedNote = (note || '').trim() || null;

    return requirePostgres('sendFriendRequest', async (client) => {
        const existing = await findActiveByPair(client, pair);
        if (existing) {
            // Either pending or already accepted — both block a new send.
            const code = existing.status === 'accepted'
                ? 'SOCIAL_FRIENDSHIP_ALREADY_FRIENDS'
                : 'SOCIAL_FRIENDSHIP_EXISTS';
            const message = existing.status === 'accepted'
                ? 'Already friends'
                : 'Friend request already pending';
            throw new SocialFriendshipError(message, 409, code);
        }

        try {
            const id = randomUUID();
            const now = new Date();
            const inserted = await client.query<PgFriendshipRow>(
                `
                    insert into app_social_friendship
                        (id, requester_user_id, addressee_user_id, status, created_at, note)
                    values ($1::uuid, $2, $3, 'pending', $4, $5)
                    returning id, requester_user_id, addressee_user_id, status,
                              created_at, responded_at, note, pair_key
                `,
                [id, requester, addressee, now, trimmedNote],
            );
            return mapRow(inserted.rows[0]);
        } catch (error) {
            // Belt-and-braces: in the rare case a concurrent caller raced
            // through `findActiveByPair`, the deferred unique constraint
            // catches the duplicate at commit time.
            if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
                throw new SocialFriendshipError(
                    'Friend request already pending',
                    409,
                    'SOCIAL_FRIENDSHIP_EXISTS',
                );
            }
            throw error;
        }
    });
}

/**
 * Accept or reject an incoming friend request. Only the addressee can do
 * this. The status flips on the same row; we don't INSERT a new history
 * row for response — the `responded_at` stamp gives us the timeline.
 */
export async function respondToFriendRequest(
    requestId: string,
    viewerUserId: string,
    response: 'accepted' | 'rejected',
): Promise<SocialFriendship> {
    const trimmedId = (requestId || '').trim();
    const trimmedViewer = (viewerUserId || '').trim();
    if (!trimmedId) {
        throw new SocialFriendshipError(
            'requestId is required',
            400,
            'SOCIAL_FRIENDSHIP_REQUIRED',
        );
    }
    if (!trimmedViewer) {
        throw new SocialFriendshipError(
            'viewerUserId is required',
            400,
            'SOCIAL_FRIENDSHIP_REQUIRED',
        );
    }
    if (response !== 'accepted' && response !== 'rejected') {
        throw new SocialFriendshipError(
            'response must be "accepted" or "rejected"',
            400,
            'SOCIAL_FRIENDSHIP_INVALID_RESPONSE',
        );
    }

    return requirePostgres('respondToFriendRequest', async (client) => {
        const existing = await findFriendshipById(client, trimmedId);
        if (!existing) {
            throw new SocialFriendshipError(
                'Friend request not found',
                404,
                'SOCIAL_FRIENDSHIP_NOT_FOUND',
            );
        }
        if (existing.addresseeUserId !== trimmedViewer) {
            throw new SocialFriendshipError(
                'Only the addressee can respond',
                403,
                'SOCIAL_FRIENDSHIP_FORBIDDEN',
            );
        }
        if (existing.status !== 'pending') {
            throw new SocialFriendshipError(
                'Friend request is no longer pending',
                409,
                'SOCIAL_FRIENDSHIP_ALREADY_PROCESSED',
            );
        }

        const now = new Date();
        const updated = await client.query<PgFriendshipRow>(
            `
                update app_social_friendship
                set status = $2, responded_at = $3
                where id = $1::uuid
                returning id, requester_user_id, addressee_user_id, status,
                          created_at, responded_at, note, pair_key
            `,
            [trimmedId, response, now],
        );
        return mapRow(updated.rows[0]);
    });
}

/**
 * Cancel an outgoing pending request. Only the requester can do this —
 * use `removeFriend` to undo an accepted friendship.
 */
export async function cancelFriendRequest(
    requestId: string,
    viewerUserId: string,
): Promise<SocialFriendship> {
    const trimmedId = (requestId || '').trim();
    const trimmedViewer = (viewerUserId || '').trim();
    if (!trimmedId || !trimmedViewer) {
        throw new SocialFriendshipError(
            'requestId and viewerUserId are required',
            400,
            'SOCIAL_FRIENDSHIP_REQUIRED',
        );
    }

    return requirePostgres('cancelFriendRequest', async (client) => {
        const existing = await findFriendshipById(client, trimmedId);
        if (!existing) {
            throw new SocialFriendshipError(
                'Friend request not found',
                404,
                'SOCIAL_FRIENDSHIP_NOT_FOUND',
            );
        }
        if (existing.requesterUserId !== trimmedViewer) {
            throw new SocialFriendshipError(
                'Only the requester can cancel',
                403,
                'SOCIAL_FRIENDSHIP_FORBIDDEN',
            );
        }
        if (existing.status !== 'pending') {
            throw new SocialFriendshipError(
                'Friend request is no longer pending',
                409,
                'SOCIAL_FRIENDSHIP_ALREADY_PROCESSED',
            );
        }

        const now = new Date();
        const updated = await client.query<PgFriendshipRow>(
            `
                update app_social_friendship
                set status = 'cancelled', responded_at = $2
                where id = $1::uuid
                returning id, requester_user_id, addressee_user_id, status,
                          created_at, responded_at, note, pair_key
            `,
            [trimmedId, now],
        );
        return mapRow(updated.rows[0]);
    });
}

/**
 * Remove an existing accepted friendship. Either party can do this.
 * Transitions the active `accepted` row to `removed` and stamps
 * `responded_at` (re-used as the "last action" timestamp). Returns
 * the resulting row so the caller can log / push-notify.
 */
export async function removeFriend(
    viewerUserId: string,
    otherUserId: string,
): Promise<SocialFriendship> {
    const { a, b } = requireValidUserPair(viewerUserId, otherUserId);
    const pair = canonicalPairKey(a, b);

    return requirePostgres('removeFriend', async (client) => {
        const result = await client.query<PgFriendshipRow>(
            `
                update app_social_friendship
                set status = 'removed', responded_at = $2
                where pair_key = $1
                  and status = 'accepted'
                returning id, requester_user_id, addressee_user_id, status,
                          created_at, responded_at, note, pair_key
            `,
            [pair, new Date()],
        );
        if (result.rowCount === 0) {
            throw new SocialFriendshipError(
                'Friendship not found',
                404,
                'SOCIAL_FRIENDSHIP_NOT_FOUND',
            );
        }
        return mapRow(result.rows[0]);
    });
}

/**
 * List all accepted friends for `userId`. Returns the "other" party of
 * every active row plus a few timestamps useful for the UI.
 */
export async function listFriendsForUser(userId: string): Promise<SocialFriend[]> {
    const trimmed = (userId || '').trim();
    if (!trimmed) {
        throw new SocialFriendshipError(
            'userId is required',
            400,
            'SOCIAL_FRIENDSHIP_REQUIRED',
        );
    }
    return requirePostgres('listFriendsForUser', async (client) => {
        const result = await client.query<PgFriendshipRow>(
            `
                select id, requester_user_id, addressee_user_id, status,
                       created_at, responded_at, note, pair_key
                from app_social_friendship
                where status = 'accepted'
                  and (requester_user_id = $1 or addressee_user_id = $1)
                order by coalesce(responded_at, created_at) desc
            `,
            [trimmed],
        );
        return result.rows.map((row) => {
            const other = row.requester_user_id === trimmed
                ? row.addressee_user_id
                : row.requester_user_id;
            return {
                userId: other,
                friendshipId: row.id,
                createdAt: new Date(row.created_at),
                acceptedAt: row.responded_at ? new Date(row.responded_at) : null,
            } satisfies SocialFriend;
        });
    });
}

/**
 * List pending requests for `userId`, filtered by `direction`:
 *   - `'incoming'`: rows where the viewer is the addressee (must approve)
 *   - `'outgoing'`: rows where the viewer is the requester (can cancel)
 */
export async function listPendingRequestsForUser(
    userId: string,
    direction: 'incoming' | 'outgoing',
): Promise<SocialFriendRequest[]> {
    const trimmed = (userId || '').trim();
    if (!trimmed) {
        throw new SocialFriendshipError(
            'userId is required',
            400,
            'SOCIAL_FRIENDSHIP_REQUIRED',
        );
    }
    if (direction !== 'incoming' && direction !== 'outgoing') {
        throw new SocialFriendshipError(
            'direction must be "incoming" or "outgoing"',
            400,
            'SOCIAL_FRIENDSHIP_INVALID_DIRECTION',
        );
    }

    return requirePostgres('listPendingRequestsForUser', async (client) => {
        const column = direction === 'incoming' ? 'addressee_user_id' : 'requester_user_id';
        const result = await client.query<PgFriendshipRow>(
            `
                select id, requester_user_id, addressee_user_id, status,
                       created_at, responded_at, note, pair_key
                from app_social_friendship
                where status = 'pending'
                  and ${column} = $1
                order by created_at desc
            `,
            [trimmed],
        );
        return result.rows.map((row) => ({
            ...mapRow(row),
            direction,
        } satisfies SocialFriendRequest));
    });
}

/**
 * Lookup the active (pending|accepted) friendship between two users.
 * Returns null if no active row exists. Historical (rejected, cancelled,
 * removed) rows are intentionally not surfaced here — the caller wants
 * to know if there's a live relationship.
 */
export async function getFriendshipBetween(
    userA: string,
    userB: string,
): Promise<SocialFriendship | null> {
    const { a, b } = requireValidUserPair(userA, userB);
    const pair = canonicalPairKey(a, b);
    return requirePostgres('getFriendshipBetween', async (client) => {
        return await findActiveByPair(client, pair);
    });
}
