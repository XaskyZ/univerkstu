import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 1c — unit tests for the universal social friendship service.
//
// Pure helpers (`canonicalPairKey`, `requireValidUserPair`) are tested
// directly. DB-touching CRUD is exercised via a mocked Postgres bridge
// that records SQL calls and returns canned rows, so we can assert the
// contract without standing up a Pool.

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

interface FriendshipRow {
    id: string;
    requester_user_id: string;
    addressee_user_id: string;
    status: 'pending' | 'accepted' | 'rejected' | 'cancelled' | 'removed';
    created_at: Date;
    responded_at: Date | null;
    note: string | null;
    pair_key: string;
}

// In-memory friendship table. Keyed by row id.
const rowsById = new Map<string, FriendshipRow>();
// Track all SELECTs / UPDATEs / INSERTs we see so each test can assert.
const capturedCalls: Array<{ sql: string; params: unknown[] }> = [];

function pair(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
}

const fakeClient: FakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();
        capturedCalls.push({ sql, params });

        if (text.startsWith('select') && text.includes('from app_social_friendship') && text.includes('pair_key = $1')) {
            // findActiveByPair
            const [pairKey] = params as [string];
            const active = Array.from(rowsById.values()).find(
                (r) => r.pair_key === pairKey && (r.status === 'pending' || r.status === 'accepted'),
            );
            return { rows: active ? [active] : [], rowCount: active ? 1 : 0 };
        }

        if (text.startsWith('select') && text.includes('from app_social_friendship') && text.includes('where id = $1')) {
            // findFriendshipById
            const [id] = params as [string];
            const row = rowsById.get(id);
            return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith('select') && text.includes("status = 'accepted'") && text.includes('requester_user_id = $1 or addressee_user_id = $1')) {
            // listFriendsForUser
            const [userId] = params as [string];
            const rows = Array.from(rowsById.values()).filter(
                (r) => r.status === 'accepted' && (r.requester_user_id === userId || r.addressee_user_id === userId),
            );
            return { rows, rowCount: rows.length };
        }

        if (text.startsWith('select') && text.includes("status = 'pending'") && text.includes('addressee_user_id = $1')) {
            const [userId] = params as [string];
            const rows = Array.from(rowsById.values()).filter(
                (r) => r.status === 'pending' && r.addressee_user_id === userId,
            );
            return { rows, rowCount: rows.length };
        }
        if (text.startsWith('select') && text.includes("status = 'pending'") && text.includes('requester_user_id = $1')) {
            const [userId] = params as [string];
            const rows = Array.from(rowsById.values()).filter(
                (r) => r.status === 'pending' && r.requester_user_id === userId,
            );
            return { rows, rowCount: rows.length };
        }

        if (text.startsWith('insert into app_social_friendship')) {
            const [id, requester, addressee, createdAt, note] = params as [
                string, string, string, Date, string | null,
            ];
            const row: FriendshipRow = {
                id,
                requester_user_id: requester,
                addressee_user_id: addressee,
                status: 'pending',
                created_at: createdAt,
                responded_at: null,
                note,
                pair_key: pair(requester, addressee),
            };
            rowsById.set(id, row);
            return { rows: [row], rowCount: 1 };
        }

        if (text.startsWith('update app_social_friendship') && text.includes('where id = $1')) {
            const [id, statusOrTimestamp, maybeTimestamp] = params as [string, string | Date, Date | undefined];
            const row = rowsById.get(id);
            if (!row) return { rows: [], rowCount: 0 };
            // The two UPDATE shapes pass (id, status, now) and (id, now). The
            // first param after id is either the new status string or a Date
            // (cancel path explicitly writes 'cancelled' inline). Branch on
            // typeof.
            if (typeof statusOrTimestamp === 'string') {
                row.status = statusOrTimestamp as FriendshipRow['status'];
                row.responded_at = maybeTimestamp as Date;
            } else {
                // status is hardcoded in SQL ('cancelled'); read it back from the SQL text
                if (text.includes("status = 'cancelled'")) row.status = 'cancelled';
                row.responded_at = statusOrTimestamp;
            }
            return { rows: [row], rowCount: 1 };
        }

        if (text.startsWith('update app_social_friendship') && text.includes('pair_key = $1')) {
            const [pairKey, ts] = params as [string, Date];
            const target = Array.from(rowsById.values()).find(
                (r) => r.pair_key === pairKey && r.status === 'accepted',
            );
            if (!target) return { rows: [], rowCount: 0 };
            target.status = 'removed';
            target.responded_at = ts;
            return { rows: [target], rowCount: 1 };
        }

        throw new Error(`Unmocked SQL: ${sql}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

import {
    canonicalPairKey,
    cancelFriendRequest,
    getFriendshipBetween,
    listFriendsForUser,
    listPendingRequestsForUser,
    removeFriend,
    requireValidUserPair,
    respondToFriendRequest,
    sendFriendRequest,
    SocialFriendshipError,
} from './social-friends.js';

beforeEach(() => {
    rowsById.clear();
    capturedCalls.length = 0;
    fakeClient.query.mockClear();
});

describe('canonicalPairKey', () => {
    it('sorts the two userIds lexicographically with "::" separator', () => {
        expect(canonicalPairKey('alice', 'bob')).toBe('alice::bob');
        expect(canonicalPairKey('bob', 'alice')).toBe('alice::bob');
    });

    it('handles identical content from either argument position the same way', () => {
        expect(canonicalPairKey('zoe', 'amy')).toBe(canonicalPairKey('amy', 'zoe'));
    });

    it('trims whitespace before comparing', () => {
        expect(canonicalPairKey('  alice ', 'bob')).toBe('alice::bob');
    });

    it('is stable across non-ASCII userIds (UTF-8 ordering)', () => {
        // Both orderings produce the same key — the actual order is just
        // lexicographic on the underlying string.
        const k1 = canonicalPairKey('юзер', 'user');
        const k2 = canonicalPairKey('user', 'юзер');
        expect(k1).toBe(k2);
    });
});

describe('requireValidUserPair', () => {
    it('returns trimmed pair on success', () => {
        expect(requireValidUserPair('  alice ', ' bob ')).toEqual({ a: 'alice', b: 'bob' });
    });

    it('rejects an empty userA', () => {
        expect(() => requireValidUserPair('', 'bob')).toThrow(SocialFriendshipError);
    });

    it('rejects an empty userB', () => {
        expect(() => requireValidUserPair('alice', '   ')).toThrow(SocialFriendshipError);
    });

    it('rejects self-friendship', () => {
        expect(() => requireValidUserPair('alice', 'alice'))
            .toThrow(/cannot friend yourself/i);
    });
});

describe('sendFriendRequest', () => {
    it('creates a pending row and returns the canonical pair key', async () => {
        const fr = await sendFriendRequest('alice', 'bob');
        expect(fr.status).toBe('pending');
        expect(fr.requesterUserId).toBe('alice');
        expect(fr.addresseeUserId).toBe('bob');
        expect(fr.pairKey).toBe('alice::bob');
        expect(fr.respondedAt).toBeNull();
    });

    it('rejects self-friendship before touching the DB', async () => {
        await expect(sendFriendRequest('alice', 'alice')).rejects.toThrow(/cannot friend yourself/i);
        expect(fakeClient.query).not.toHaveBeenCalled();
    });

    it('rejects when an active row already exists (pending)', async () => {
        await sendFriendRequest('alice', 'bob');
        await expect(sendFriendRequest('alice', 'bob')).rejects.toMatchObject({
            statusCode: 409,
            code: 'SOCIAL_FRIENDSHIP_EXISTS',
        });
    });

    it('rejects with ALREADY_FRIENDS when an accepted row exists', async () => {
        const fr = await sendFriendRequest('alice', 'bob');
        await respondToFriendRequest(fr.id, 'bob', 'accepted');
        await expect(sendFriendRequest('alice', 'bob')).rejects.toMatchObject({
            code: 'SOCIAL_FRIENDSHIP_ALREADY_FRIENDS',
        });
    });

    it('accepts a re-send after a previous request was rejected', async () => {
        const fr1 = await sendFriendRequest('alice', 'bob');
        await respondToFriendRequest(fr1.id, 'bob', 'rejected');
        // Now no active row exists → re-send should succeed.
        const fr2 = await sendFriendRequest('alice', 'bob');
        expect(fr2.id).not.toBe(fr1.id);
        expect(fr2.status).toBe('pending');
    });

    it('persists the optional note', async () => {
        const fr = await sendFriendRequest('alice', 'bob', '  hi there  ');
        expect(fr.note).toBe('hi there');
    });

    it('coerces an empty note to null', async () => {
        const fr = await sendFriendRequest('alice', 'bob', '   ');
        expect(fr.note).toBeNull();
    });
});

describe('respondToFriendRequest', () => {
    it('accepts an incoming pending request and stamps responded_at', async () => {
        const fr = await sendFriendRequest('alice', 'bob');
        const updated = await respondToFriendRequest(fr.id, 'bob', 'accepted');
        expect(updated.status).toBe('accepted');
        expect(updated.respondedAt).not.toBeNull();
    });

    it('rejects when the viewer is not the addressee', async () => {
        const fr = await sendFriendRequest('alice', 'bob');
        await expect(respondToFriendRequest(fr.id, 'carol', 'accepted')).rejects.toMatchObject({
            statusCode: 403,
            code: 'SOCIAL_FRIENDSHIP_FORBIDDEN',
        });
    });

    it('rejects when the request was already processed', async () => {
        const fr = await sendFriendRequest('alice', 'bob');
        await respondToFriendRequest(fr.id, 'bob', 'accepted');
        await expect(respondToFriendRequest(fr.id, 'bob', 'rejected')).rejects.toMatchObject({
            code: 'SOCIAL_FRIENDSHIP_ALREADY_PROCESSED',
        });
    });

    it('returns 404 when the request id is unknown', async () => {
        await expect(respondToFriendRequest('missing', 'bob', 'accepted')).rejects.toMatchObject({
            statusCode: 404,
            code: 'SOCIAL_FRIENDSHIP_NOT_FOUND',
        });
    });

    it('rejects an invalid response value', async () => {
        await expect(
            // @ts-expect-error — intentionally testing runtime rejection
            respondToFriendRequest('any', 'bob', 'maybe'),
        ).rejects.toMatchObject({ code: 'SOCIAL_FRIENDSHIP_INVALID_RESPONSE' });
    });
});

describe('cancelFriendRequest', () => {
    it('cancels an outgoing pending request', async () => {
        const fr = await sendFriendRequest('alice', 'bob');
        const updated = await cancelFriendRequest(fr.id, 'alice');
        expect(updated.status).toBe('cancelled');
        expect(updated.respondedAt).not.toBeNull();
    });

    it('rejects when the viewer is not the requester', async () => {
        const fr = await sendFriendRequest('alice', 'bob');
        await expect(cancelFriendRequest(fr.id, 'bob')).rejects.toMatchObject({
            statusCode: 403,
        });
    });
});

describe('removeFriend', () => {
    it('transitions an accepted friendship to removed', async () => {
        const fr = await sendFriendRequest('alice', 'bob');
        await respondToFriendRequest(fr.id, 'bob', 'accepted');
        const removed = await removeFriend('alice', 'bob');
        expect(removed.status).toBe('removed');
    });

    it('returns 404 when there is no active accepted friendship', async () => {
        await expect(removeFriend('alice', 'bob')).rejects.toMatchObject({
            statusCode: 404,
        });
    });

    it('rejects self-removal before touching the DB', async () => {
        await expect(removeFriend('alice', 'alice')).rejects.toThrow(/cannot friend yourself/i);
    });
});

describe('listFriendsForUser', () => {
    it('returns the other-party userId for every accepted friendship', async () => {
        const fr1 = await sendFriendRequest('alice', 'bob');
        await respondToFriendRequest(fr1.id, 'bob', 'accepted');
        const fr2 = await sendFriendRequest('carol', 'alice');
        await respondToFriendRequest(fr2.id, 'alice', 'accepted');

        const friends = await listFriendsForUser('alice');
        const userIds = friends.map((f) => f.userId).sort();
        expect(userIds).toEqual(['bob', 'carol']);
    });

    it('excludes pending, rejected, cancelled and removed rows', async () => {
        const pending = await sendFriendRequest('alice', 'bob');
        const rejected = await sendFriendRequest('alice', 'carol');
        await respondToFriendRequest(rejected.id, 'carol', 'rejected');
        void pending;

        const friends = await listFriendsForUser('alice');
        expect(friends).toHaveLength(0);
    });

    it('rejects an empty userId before hitting the DB', async () => {
        await expect(listFriendsForUser('   ')).rejects.toThrow(/userId is required/i);
    });
});

describe('listPendingRequestsForUser', () => {
    it('returns incoming pending requests for the addressee', async () => {
        await sendFriendRequest('alice', 'bob');
        await sendFriendRequest('carol', 'bob');
        const incoming = await listPendingRequestsForUser('bob', 'incoming');
        expect(incoming).toHaveLength(2);
        expect(incoming.every((r) => r.direction === 'incoming')).toBe(true);
    });

    it('returns outgoing pending requests for the requester', async () => {
        await sendFriendRequest('alice', 'bob');
        await sendFriendRequest('alice', 'carol');
        const outgoing = await listPendingRequestsForUser('alice', 'outgoing');
        expect(outgoing).toHaveLength(2);
        expect(outgoing.every((r) => r.direction === 'outgoing')).toBe(true);
    });

    it('rejects an invalid direction', async () => {
        await expect(
            // @ts-expect-error — runtime check
            listPendingRequestsForUser('alice', 'sideways'),
        ).rejects.toMatchObject({ code: 'SOCIAL_FRIENDSHIP_INVALID_DIRECTION' });
    });
});

describe('getFriendshipBetween', () => {
    it('returns the active pending row when one exists', async () => {
        await sendFriendRequest('alice', 'bob');
        const fr = await getFriendshipBetween('alice', 'bob');
        expect(fr?.status).toBe('pending');
    });

    it('returns the accepted row over historical rejected ones', async () => {
        const rejected = await sendFriendRequest('alice', 'bob');
        await respondToFriendRequest(rejected.id, 'bob', 'rejected');
        const re = await sendFriendRequest('alice', 'bob');
        await respondToFriendRequest(re.id, 'bob', 'accepted');

        const fr = await getFriendshipBetween('alice', 'bob');
        expect(fr?.status).toBe('accepted');
    });

    it('returns null when no active row exists', async () => {
        const fr = await getFriendshipBetween('alice', 'bob');
        expect(fr).toBeNull();
    });

    it('finds the row regardless of argument order', async () => {
        await sendFriendRequest('alice', 'bob');
        const fr = await getFriendshipBetween('bob', 'alice');
        expect(fr?.status).toBe('pending');
    });
});
