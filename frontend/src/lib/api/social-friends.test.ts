/**
 * Unit tests for the social-friends API client (`./social-friends`).
 * Verifies URL/path/body construction and ApiResponse mapping. `fetch`
 * is fully mocked — no real network. Mirrors the structure of
 * `./social.test.ts` and `./chat.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    cancelSocialFriendRequest,
    getSocialFriendRequests,
    getSocialFriends,
    removeSocialFriend,
    respondToSocialFriendRequest,
    sendSocialFriendRequest,
} from './social-friends';
import { API_URL } from './core';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null {
        return this.store.has(key) ? this.store.get(key)! : null;
    }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

let localStorage: MemoryStorage;
let sessionStorage: MemoryStorage;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
    const status = init.status ?? 200;
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: (name: string) => init.headers?.[name] ?? null,
        },
        json: async () => body,
    } as unknown as Response;
}

beforeEach(() => {
    localStorage = new MemoryStorage();
    sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('crypto', { randomUUID: () => 'test-session-uuid' });
    fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

function getCall(): { url: string; init: RequestInit } {
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [url, init] = calls[0] as [string, RequestInit];
    return { url, init: init ?? {} };
}

describe('sendSocialFriendRequest', () => {
    it('POSTs to /social/friends/requests with addresseeId + null note by default', async () => {
        await sendSocialFriendRequest('bob');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/friends/requests`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({
            addresseeId: 'bob',
            note: null,
        });
    });

    it('passes the optional note through', async () => {
        await sendSocialFriendRequest('bob', 'hi there');
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({
            addresseeId: 'bob',
            note: 'hi there',
        });
    });

    it('surfaces a 409 conflict from the server as an error response', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(
            { success: false, error: 'Friend request already pending', errorCode: 'SOCIAL_FRIENDSHIP_EXISTS' },
            { status: 409 },
        ));
        const result = await sendSocialFriendRequest('bob');
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(409);
        expect(result.errorCode).toBe('SOCIAL_FRIENDSHIP_EXISTS');
    });
});

describe('respondToSocialFriendRequest', () => {
    it('POSTs to /respond with the response value and url-encoded id', async () => {
        await respondToSocialFriendRequest('fr/1', 'accepted');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/friends/requests/fr%2F1/respond`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ response: 'accepted' });
    });

    it('sends "rejected" through', async () => {
        await respondToSocialFriendRequest('fr-2', 'rejected');
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({ response: 'rejected' });
    });
});

describe('cancelSocialFriendRequest', () => {
    it('POSTs to /cancel with an empty body and url-encoded id', async () => {
        await cancelSocialFriendRequest('fr-3 with spaces');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/friends/requests/fr-3%20with%20spaces/cancel`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({});
    });
});

describe('removeSocialFriend', () => {
    it('issues DELETE to /social/friends/:userId with url-encoded id', async () => {
        await removeSocialFriend('bob/charlie');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/friends/bob%2Fcharlie`);
        expect(init.method).toBe('DELETE');
    });

    it('forwards a 404 from the server when the row is missing', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(
            { success: false, error: 'Friendship not found', errorCode: 'SOCIAL_FRIENDSHIP_NOT_FOUND' },
            { status: 404 },
        ));
        const result = await removeSocialFriend('bob');
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(404);
    });
});

describe('getSocialFriends', () => {
    it('issues GET /social/friends/me', async () => {
        await getSocialFriends();
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/friends/me`);
        expect(init.method).toBeUndefined();
    });

    it('returns success=true with the friends array on a 200', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: { friends: [{ userId: 'bob', friendshipId: 'fr-1', createdAt: '2026-01-01', acceptedAt: '2026-01-02' }] },
        }));
        const result = await getSocialFriends();
        expect(result.success).toBe(true);
        expect(result.data?.friends).toHaveLength(1);
    });
});

describe('getSocialFriendRequests', () => {
    it('serialises direction=incoming as a querystring', async () => {
        await getSocialFriendRequests('incoming');
        const { url } = getCall();
        const u = new URL(url);
        expect(u.pathname).toBe('/api/v3/social/friends/requests');
        expect(u.searchParams.get('direction')).toBe('incoming');
    });

    it('serialises direction=outgoing as a querystring', async () => {
        await getSocialFriendRequests('outgoing');
        const { url } = getCall();
        const u = new URL(url);
        expect(u.searchParams.get('direction')).toBe('outgoing');
    });
});
