import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

// Phase 1c dual-write shim tests for friendships. Mirrors the structure
// of the other shim test files (group-posts-shim / chat-messages-shim /
// global-chat-shim): mock the postgres bridge so legacy lookups/updates
// are observable without a real DB, and mock the universal social-friends
// service so failure modes are deterministic. Contract under test: the
// shim is non-fatal — callers never see throws from the new-store path
// even when it explodes.

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

interface PgRow {
    social_friendship_id: string | null;
}

// In-memory legacy table: legacyRequestId -> social_friendship_id.
const legacyById = new Map<string, string | null>();
// Captured SQL for status-update assertions.
const capturedUpdates: Array<{ sql: string; params: unknown[] }> = [];

const fakeClient: FakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();
        if (text.startsWith('select social_friendship_id from app_friend_requests')) {
            const [legacyId] = params as [string];
            if (!legacyById.has(legacyId)) {
                return { rows: [] as PgRow[], rowCount: 0 };
            }
            return {
                rows: [{ social_friendship_id: legacyById.get(legacyId) ?? null }] as PgRow[],
                rowCount: 1,
            };
        }
        if (text.startsWith('update app_friend_requests set social_friendship_id')) {
            const [legacyId, socialId] = params as [string, string];
            legacyById.set(legacyId, socialId);
            return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('update app_social_friendship')) {
            capturedUpdates.push({ sql, params });
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unmocked SQL: ${sql}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

// Mock the universal social-friends service. The fake error class lives
// inside the factory because `vi.mock` is hoisted to the top of the file
// — top-level class declarations are not yet evaluated when the factory
// runs, so a `class` outside the factory would TDZ-explode.
const sendUniversalMock = vi.fn();
const removeUniversalMock = vi.fn();

vi.mock('./social-friends.js', () => {
    class FakeSocialFriendshipError extends Error {
        statusCode: number;
        code: string;

        constructor(message: string, statusCode = 400, code = 'SOCIAL_FRIENDSHIP_ERROR') {
            super(message);
            this.statusCode = statusCode;
            this.code = code;
        }
    }
    return {
        sendFriendRequest: (...args: unknown[]) => sendUniversalMock(...args),
        removeFriend: (...args: unknown[]) => removeUniversalMock(...args),
        canonicalPairKey: (a: string, b: string) => (a < b ? `${a}::${b}` : `${b}::${a}`),
        SocialFriendshipError: FakeSocialFriendshipError,
    };
});

// Re-export the fake class via a deferred import for use in test assertions.
// Vitest will share the same class instance between the mock and this import.
let FakeSocialFriendshipError: typeof import('./social-friends.js')['SocialFriendshipError'];
beforeAll(async () => {
    const mod = await import('./social-friends.js');
    FakeSocialFriendshipError = mod.SocialFriendshipError;
});

import {
    shimMirrorCancel,
    shimMirrorRemove,
    shimMirrorRespond,
    shimMirrorSendFriendRequest,
} from './friends-shim.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    legacyById.clear();
    capturedUpdates.length = 0;
    fakeClient.query.mockClear();
    sendUniversalMock.mockReset();
    removeUniversalMock.mockReset();
    // Silence the intentional shim error logs so the test output stays clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

describe('shimMirrorSendFriendRequest', () => {
    it('creates a universal friendship and stamps the back-link onto the legacy row', async () => {
        legacyById.set('legacy-1', null);
        sendUniversalMock.mockResolvedValueOnce({ id: 'social-1' });

        await shimMirrorSendFriendRequest({
            legacyId: 'legacy-1',
            requesterUserId: 'alice',
            addresseeUserId: 'bob',
        });

        expect(sendUniversalMock).toHaveBeenCalledWith('alice', 'bob', null);
        expect(legacyById.get('legacy-1')).toBe('social-1');
    });

    it('passes the optional note through to the universal service', async () => {
        legacyById.set('legacy-2', null);
        sendUniversalMock.mockResolvedValueOnce({ id: 'social-2' });

        await shimMirrorSendFriendRequest({
            legacyId: 'legacy-2',
            requesterUserId: 'alice',
            addresseeUserId: 'bob',
            note: 'meet me later',
        });

        expect(sendUniversalMock).toHaveBeenCalledWith('alice', 'bob', 'meet me later');
    });

    it('swallows SOCIAL_FRIENDSHIP_EXISTS without logging', async () => {
        legacyById.set('legacy-3', null);
        sendUniversalMock.mockRejectedValueOnce(
            new FakeSocialFriendshipError('exists', 409, 'SOCIAL_FRIENDSHIP_EXISTS'),
        );

        await expect(
            shimMirrorSendFriendRequest({
                legacyId: 'legacy-3',
                requesterUserId: 'alice',
                addresseeUserId: 'bob',
            }),
        ).resolves.toBeUndefined();
        expect(legacyById.get('legacy-3')).toBe(null);
        // No log for the expected steady-state conflict.
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('swallows SOCIAL_FRIENDSHIP_ALREADY_FRIENDS without logging', async () => {
        legacyById.set('legacy-3b', null);
        sendUniversalMock.mockRejectedValueOnce(
            new FakeSocialFriendshipError('already friends', 409, 'SOCIAL_FRIENDSHIP_ALREADY_FRIENDS'),
        );

        await expect(
            shimMirrorSendFriendRequest({
                legacyId: 'legacy-3b',
                requesterUserId: 'alice',
                addresseeUserId: 'bob',
            }),
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('logs and swallows other errors (does NOT throw to the caller)', async () => {
        legacyById.set('legacy-4', null);
        sendUniversalMock.mockRejectedValueOnce(new Error('postgres unavailable'));

        await expect(
            shimMirrorSendFriendRequest({
                legacyId: 'legacy-4',
                requesterUserId: 'alice',
                addresseeUserId: 'bob',
            }),
        ).resolves.toBeUndefined();
        expect(legacyById.get('legacy-4')).toBe(null);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('send failed for friendships'),
            expect.objectContaining({ legacyId: 'legacy-4' }),
        );
    });
});

describe('shimMirrorRespond', () => {
    it('updates the universal status to accepted on the linked row', async () => {
        legacyById.set('legacy-5', 'social-5');
        await shimMirrorRespond({
            legacyId: 'legacy-5',
            response: 'accepted',
            requesterUserId: 'alice',
            addresseeUserId: 'bob',
        });
        expect(capturedUpdates).toHaveLength(1);
        expect(capturedUpdates[0].sql.toLowerCase()).toContain('update app_social_friendship');
        expect(capturedUpdates[0].params[0]).toBe('social-5');
        expect(capturedUpdates[0].params[1]).toBe('accepted');
    });

    it('updates the universal status to rejected on the linked row', async () => {
        legacyById.set('legacy-6', 'social-6');
        await shimMirrorRespond({
            legacyId: 'legacy-6',
            response: 'rejected',
            requesterUserId: 'alice',
            addresseeUserId: 'bob',
        });
        expect(capturedUpdates[0].params[1]).toBe('rejected');
    });

    it('is a no-op when the back-link is missing (pre-shim row)', async () => {
        legacyById.set('legacy-7', null);
        await shimMirrorRespond({
            legacyId: 'legacy-7',
            response: 'accepted',
            requesterUserId: 'alice',
            addresseeUserId: 'bob',
        });
        expect(capturedUpdates).toHaveLength(0);
    });
});

describe('shimMirrorCancel', () => {
    it('updates the universal row to cancelled when linked', async () => {
        legacyById.set('legacy-8', 'social-8');
        await shimMirrorCancel({ legacyId: 'legacy-8' });
        expect(capturedUpdates).toHaveLength(1);
        expect(capturedUpdates[0].sql.toLowerCase()).toContain("status = 'cancelled'");
    });

    it('is a no-op when the back-link is missing', async () => {
        legacyById.set('legacy-9', null);
        await shimMirrorCancel({ legacyId: 'legacy-9' });
        expect(capturedUpdates).toHaveLength(0);
    });
});

describe('shimMirrorRemove', () => {
    it('calls the universal removeFriend with the viewer + other id', async () => {
        removeUniversalMock.mockResolvedValueOnce({ id: 'social-10', status: 'removed' });
        await shimMirrorRemove({ viewerUserId: 'alice', otherUserId: 'bob' });
        expect(removeUniversalMock).toHaveBeenCalledWith('alice', 'bob');
    });

    it('silently no-ops on SOCIAL_FRIENDSHIP_NOT_FOUND (pre-shim friendship)', async () => {
        removeUniversalMock.mockRejectedValueOnce(
            new FakeSocialFriendshipError('not found', 404, 'SOCIAL_FRIENDSHIP_NOT_FOUND'),
        );
        await expect(
            shimMirrorRemove({ viewerUserId: 'alice', otherUserId: 'bob' }),
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('logs and swallows other errors', async () => {
        removeUniversalMock.mockRejectedValueOnce(new Error('db down'));
        await expect(
            shimMirrorRemove({ viewerUserId: 'alice', otherUserId: 'bob' }),
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('remove failed for friendships'),
            expect.objectContaining({ legacyId: 'alice::bob' }),
        );
    });
});
