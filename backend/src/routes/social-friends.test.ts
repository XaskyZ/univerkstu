import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

// Phase 1c route-layer tests for the universal social friendship surface.
// Service is mocked so we drive deterministic responses; behavioral tests
// for the service itself live in services/social-friends.test.ts.

const sendFriendRequestMock = vi.fn();
const respondMock = vi.fn();
const cancelMock = vi.fn();
const removeFriendMock = vi.fn();
const listFriendsMock = vi.fn();
const listPendingMock = vi.fn();

// The fake error class lives inside the factory because `vi.mock` is
// hoisted to the top of the file — a top-level `class FakeError` would
// TDZ-explode when the factory runs.
vi.mock('../services/social-friends.js', () => {
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
        sendFriendRequest: (...args: unknown[]) => sendFriendRequestMock(...args),
        respondToFriendRequest: (...args: unknown[]) => respondMock(...args),
        cancelFriendRequest: (...args: unknown[]) => cancelMock(...args),
        removeFriend: (...args: unknown[]) => removeFriendMock(...args),
        listFriendsForUser: (...args: unknown[]) => listFriendsMock(...args),
        listPendingRequestsForUser: (...args: unknown[]) => listPendingMock(...args),
        SocialFriendshipError: FakeSocialFriendshipError,
    };
});

// Pull the fake class out of the mocked module so we can throw instances of
// it from `mockRejectedValueOnce` — the route layer's `instanceof` check
// only matches when both sides share the same class reference.
let FakeSocialFriendshipError: typeof import('../services/social-friends.js')['SocialFriendshipError'];
beforeAll(async () => {
    const mod = await import('../services/social-friends.js');
    FakeSocialFriendshipError = mod.SocialFriendshipError;
});

import { socialFriendshipRoutes } from './social-friends.js';

async function buildApp(userId: string) {
    const app = Fastify();
    app.decorate('authenticate', async (req: any) => {
        req.user = { userId };
    });
    await app.register(socialFriendshipRoutes);
    return app;
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('POST /social/friends/requests', () => {
    it('forwards the body to the service and returns 200 with the new friendship', async () => {
        sendFriendRequestMock.mockResolvedValueOnce({
            id: 'fr-1',
            requesterUserId: 'alice',
            addresseeUserId: 'bob',
            status: 'pending',
        });
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests',
            payload: { addresseeId: 'bob' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            success: true,
            data: expect.objectContaining({ id: 'fr-1', status: 'pending' }),
        });
        expect(sendFriendRequestMock).toHaveBeenCalledWith('alice', 'bob', null);
        await app.close();
    });

    it('passes the note through when supplied', async () => {
        sendFriendRequestMock.mockResolvedValueOnce({ id: 'fr-2' });
        const app = await buildApp('alice');
        await app.inject({
            method: 'POST',
            url: '/social/friends/requests',
            payload: { addresseeId: 'bob', note: 'hi' },
        });
        expect(sendFriendRequestMock).toHaveBeenCalledWith('alice', 'bob', 'hi');
        await app.close();
    });

    it('returns 400 when addresseeId is missing', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
        expect(sendFriendRequestMock).not.toHaveBeenCalled();
        await app.close();
    });

    it('maps service SocialFriendshipError to its statusCode + code', async () => {
        sendFriendRequestMock.mockRejectedValueOnce(
            new FakeSocialFriendshipError('Already friends', 409, 'SOCIAL_FRIENDSHIP_ALREADY_FRIENDS'),
        );
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests',
            payload: { addresseeId: 'bob' },
        });
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({
            success: false,
            error: 'Already friends',
            errorCode: 'SOCIAL_FRIENDSHIP_ALREADY_FRIENDS',
        });
        await app.close();
    });

    it('returns 500 on a non-typed thrown error', async () => {
        sendFriendRequestMock.mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests',
            payload: { addresseeId: 'bob' },
        });
        expect(res.statusCode).toBe(500);
        await app.close();
    });
});

describe('POST /social/friends/requests/:id/respond', () => {
    it('accepts a valid response and returns the updated row', async () => {
        respondMock.mockResolvedValueOnce({ id: 'fr-5', status: 'accepted' });
        const app = await buildApp('bob');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests/fr-5/respond',
            payload: { response: 'accepted' },
        });
        expect(res.statusCode).toBe(200);
        expect(respondMock).toHaveBeenCalledWith('fr-5', 'bob', 'accepted');
        await app.close();
    });

    it('rejects an unknown response value', async () => {
        const app = await buildApp('bob');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests/fr-6/respond',
            payload: { response: 'maybe' },
        });
        expect(res.statusCode).toBe(400);
        expect(respondMock).not.toHaveBeenCalled();
        await app.close();
    });

    it('forwards 403 when the viewer is not the addressee', async () => {
        respondMock.mockRejectedValueOnce(
            new FakeSocialFriendshipError('forbidden', 403, 'SOCIAL_FRIENDSHIP_FORBIDDEN'),
        );
        const app = await buildApp('carol');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests/fr-7/respond',
            payload: { response: 'accepted' },
        });
        expect(res.statusCode).toBe(403);
        await app.close();
    });
});

describe('POST /social/friends/requests/:id/cancel', () => {
    it('cancels and returns the updated row', async () => {
        cancelMock.mockResolvedValueOnce({ id: 'fr-8', status: 'cancelled' });
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests/fr-8/cancel',
            payload: {},
        });
        expect(res.statusCode).toBe(200);
        expect(cancelMock).toHaveBeenCalledWith('fr-8', 'alice');
        await app.close();
    });

    it('forwards 404 when the row is missing', async () => {
        cancelMock.mockRejectedValueOnce(
            new FakeSocialFriendshipError('not found', 404, 'SOCIAL_FRIENDSHIP_NOT_FOUND'),
        );
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/friends/requests/missing/cancel',
            payload: {},
        });
        expect(res.statusCode).toBe(404);
        await app.close();
    });
});

describe('DELETE /social/friends/:userId', () => {
    it('removes the friend and returns the universal row', async () => {
        removeFriendMock.mockResolvedValueOnce({ id: 'fr-9', status: 'removed' });
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'DELETE',
            url: '/social/friends/bob',
        });
        expect(res.statusCode).toBe(200);
        expect(removeFriendMock).toHaveBeenCalledWith('alice', 'bob');
        await app.close();
    });

    it('forwards 404 when no accepted row exists', async () => {
        removeFriendMock.mockRejectedValueOnce(
            new FakeSocialFriendshipError('not found', 404, 'SOCIAL_FRIENDSHIP_NOT_FOUND'),
        );
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'DELETE',
            url: '/social/friends/bob',
        });
        expect(res.statusCode).toBe(404);
        await app.close();
    });
});

describe('GET /social/friends/me', () => {
    it('returns the viewer\'s current friends', async () => {
        listFriendsMock.mockResolvedValueOnce([
            { userId: 'bob', friendshipId: 'fr-1', createdAt: new Date(), acceptedAt: new Date() },
        ]);
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/friends/me' });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.data.friends).toHaveLength(1);
        expect(listFriendsMock).toHaveBeenCalledWith('alice');
        await app.close();
    });
});

describe('GET /social/friends/requests', () => {
    it('returns incoming pending requests when direction=incoming', async () => {
        listPendingMock.mockResolvedValueOnce([
            { id: 'fr-1', direction: 'incoming', status: 'pending' },
        ]);
        const app = await buildApp('bob');
        const res = await app.inject({
            method: 'GET',
            url: '/social/friends/requests?direction=incoming',
        });
        expect(res.statusCode).toBe(200);
        expect(listPendingMock).toHaveBeenCalledWith('bob', 'incoming');
        await app.close();
    });

    it('returns outgoing pending requests when direction=outgoing', async () => {
        listPendingMock.mockResolvedValueOnce([]);
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'GET',
            url: '/social/friends/requests?direction=outgoing',
        });
        expect(res.statusCode).toBe(200);
        expect(listPendingMock).toHaveBeenCalledWith('alice', 'outgoing');
        await app.close();
    });

    it('rejects an unknown direction', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'GET',
            url: '/social/friends/requests?direction=sideways',
        });
        expect(res.statusCode).toBe(400);
        expect(listPendingMock).not.toHaveBeenCalled();
        await app.close();
    });
});
