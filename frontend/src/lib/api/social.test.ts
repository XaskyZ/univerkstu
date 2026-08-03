/**
 * Unit tests for the social API client (`./social`). Verifies URL/path/body
 * construction and ApiResponse mapping for every endpoint, plus error paths
 * (HTTP error JSON, 401 + AUTH_RELOGIN_REQUIRED, network failure).
 *
 * `fetch` is fully mocked via `vi.stubGlobal` — no real network. Token and
 * client session id are stubbed through MemoryStorage so the Authorization /
 * X-Client-Session-Id headers can also be asserted.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    addSocialComment,
    ALLOWED_SOCIAL_REACTION_EMOJI,
    attachSocialFile,
    buildSocialSearchQueryString,
    createSocialEntity,
    deleteSocialEntity,
    getSocialAttachments,
    getSocialEntity,
    getSocialEntityViewers,
    listSocialEntitiesByScope,
    pinSocialEntity,
    recordSocialView,
    removeSocialAttachment,
    restoreSocialEntity,
    SOCIAL_SEARCH_MAX_LIMIT,
    searchSocialEntities,
    searchSocialUsers,
    toggleSocialReaction,
    updateSocialEntity,
} from './social';
import { API_URL } from './core';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
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
    // crypto.randomUUID is used inside getClientSessionId — make sure it's deterministic.
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

describe('listSocialEntitiesByScope', () => {
    it('builds the correct URL with no query string when no opts given', async () => {
        await listSocialEntitiesByScope('group', 'CIT-23-1');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/scope/group/CIT-23-1/entities`);
        // GET — fetchWithAuth doesn't add method when options.method absent
        expect(init.method).toBeUndefined();
    });

    it('serialises every supported query option', async () => {
        await listSocialEntitiesByScope('group', 'CIT-23-1', {
            kind: 'task',
            limit: 25,
            offset: 50,
            includeDeleted: true,
            pinnedFirst: false,
        });
        const { url } = getCall();
        const u = new URL(url);
        expect(u.pathname).toBe('/api/v3/social/scope/group/CIT-23-1/entities');
        expect(u.searchParams.get('kind')).toBe('task');
        expect(u.searchParams.get('limit')).toBe('25');
        expect(u.searchParams.get('offset')).toBe('50');
        expect(u.searchParams.get('includeDeleted')).toBe('true');
        expect(u.searchParams.get('pinnedFirst')).toBe('false');
    });

    it('url-encodes scopeId with slashes/spaces and ignores non-numeric limit/offset', async () => {
        await listSocialEntitiesByScope('dm', 'user-a/user b', {
            limit: Number.NaN,
            offset: Number.POSITIVE_INFINITY,
        });
        const { url } = getCall();
        expect(url.startsWith(`${API_URL}/api/v3/social/scope/dm/`)).toBe(true);
        // encoded slash and space
        expect(url).toContain('user-a%2Fuser%20b');
        // NaN/Infinity must NOT appear as query params
        expect(url).not.toContain('limit=');
        expect(url).not.toContain('offset=');
    });

    it('attaches Authorization + X-Client-Session-Id headers when a token is present', async () => {
        localStorage.setItem('token', 'jwt.token.here');
        await listSocialEntitiesByScope('global', 'all');
        const { init } = getCall();
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe('Bearer jwt.token.here');
        expect(headers['X-Client-Session-Id']).toBe('test-session-uuid');
    });

    it('returns success=true with parsed entities payload', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: { entities: [{ entity: { id: 'e1' }, reactions: [], myReactions: [], commentCount: 0, attachmentCount: 0, isPinned: false }] },
        }));
        const result = await listSocialEntitiesByScope('group', 'g1');
        expect(result.success).toBe(true);
        expect(result.statusCode).toBe(200);
        const entities = (result.data as { entities: unknown[] }).entities;
        expect(entities).toHaveLength(1);
    });
});

describe('getSocialEntity', () => {
    it('issues GET /entities/:id with url-encoded id', async () => {
        await getSocialEntity('abc/def 1');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/abc%2Fdef%201`);
        expect(init.method).toBeUndefined();
    });
});

describe('createSocialEntity', () => {
    it('POSTs the kind/scope/payload body to /entities', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 'e9' } }, { status: 201 }));
        const payload = { title: 'hi', body: 'world' };
        const result = await createSocialEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'CIT-23-1',
            payload,
        });
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'CIT-23-1',
            payload,
        });
        expect(result.success).toBe(true);
        expect(result.statusCode).toBe(201);
    });
});

describe('updateSocialEntity', () => {
    it('PATCHes with a { patch } wrapper', async () => {
        await updateSocialEntity('entity-1', { title: 'new title' });
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/entity-1`);
        expect(init.method).toBe('PATCH');
        expect(JSON.parse(init.body as string)).toEqual({ patch: { title: 'new title' } });
    });
});

describe('deleteSocialEntity', () => {
    it('issues DELETE without a reason', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        await deleteSocialEntity('entity-1');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/entity-1`);
        expect(init.method).toBe('DELETE');
        expect(init.body).toBeUndefined();
    });

    it('issues DELETE with an encoded ?reason= when provided', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        await deleteSocialEntity('entity-1', 'spam & abuse');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/entity-1?reason=spam%20%26%20abuse`);
        expect(init.method).toBe('DELETE');
    });
});

describe('restoreSocialEntity', () => {
    it('POSTs /entities/:id/restore with no body', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        await restoreSocialEntity('entity-1');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/entity-1/restore`);
        expect(init.method).toBe('POST');
        expect(init.body).toBeUndefined();
    });
});

describe('pinSocialEntity', () => {
    it('POSTs /pin with { pinned: true }', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        await pinSocialEntity('entity-1', true);
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/entity-1/pin`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ pinned: true });
    });

    it('POSTs /pin with { pinned: false }', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        await pinSocialEntity('entity-1', false);
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({ pinned: false });
    });
});

describe('addSocialComment', () => {
    it('POSTs /comments with just a body when parentCommentId is absent', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 'c1' } }, { status: 201 }));
        await addSocialComment('entity-1', 'first!');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/entity-1/comments`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ body: 'first!' });
    });

    it('POSTs /comments with parentCommentId for threaded replies', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 'c2' } }, { status: 201 }));
        await addSocialComment('entity-1', 'reply', 'c1');
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({ body: 'reply', parentCommentId: 'c1' });
    });
});

describe('toggleSocialReaction', () => {
    it('POSTs /reactions with the chosen emoji and returns the toggle result', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: { added: true, reactions: [{ emoji: '👍', count: 1 }], mine: ['👍'] },
        }));
        const result = await toggleSocialReaction('entity-1', '👍');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/entity-1/reactions`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ emoji: '👍' });
        expect(result.success).toBe(true);
        expect((result.data as { added: boolean }).added).toBe(true);
    });

    it('exposes ALLOWED_SOCIAL_REACTION_EMOJI as the 5-emoji canonical set', () => {
        // Mirror of backend `ALLOWED_EMOJI` in routes/social.ts.
        expect([...ALLOWED_SOCIAL_REACTION_EMOJI]).toEqual(['👍', '❤️', '😂', '🎉', '😢']);
    });
});

describe('attachSocialFile', () => {
    it('POSTs /attachments with just a fileId when optional fields omitted', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 'a1' } }, { status: 201 }));
        await attachSocialFile('entity-1', 'file-xyz');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/entity-1/attachments`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ fileId: 'file-xyz' });
    });

    it('POSTs /attachments with mime/sizeBytes/sortOrder when supplied', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 'a2' } }, { status: 201 }));
        await attachSocialFile('entity-1', 'file-xyz', 'image/png', 1234, 2);
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({
            fileId: 'file-xyz',
            mime: 'image/png',
            sizeBytes: 1234,
            sortOrder: 2,
        });
    });
});

describe('getSocialAttachments', () => {
    it('issues GET /entities/:id/attachments with url-encoded id', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: { attachments: [] },
        }));
        await getSocialAttachments('e1/2 3');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/e1%2F2%203/attachments`);
        expect(init.method).toBeUndefined();
    });

    it('returns the parsed attachments array on success', async () => {
        const att = {
            id: 'a1',
            entityId: 'e1',
            fileId: 'file-1',
            mime: 'image/png',
            sizeBytes: 1024,
            sortOrder: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
        };
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: { attachments: [att] },
        }));
        const result = await getSocialAttachments('e1');
        expect(result.success).toBe(true);
        const attachments = (result.data as { attachments: unknown[] }).attachments;
        expect(attachments).toEqual([att]);
    });
});

describe('removeSocialAttachment', () => {
    it('issues DELETE /entities/:id/attachments/:attachmentId with both ids url-encoded', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        await removeSocialAttachment('e1', 'att 1');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/e1/attachments/att%201`);
        expect(init.method).toBe('DELETE');
        expect(init.body).toBeUndefined();
    });

    it('maps 403 → ApiResponse.success=false + SOCIAL_FORBIDDEN', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            error: 'forbidden',
            errorCode: 'SOCIAL_FORBIDDEN',
        }, { status: 403 }));
        const result = await removeSocialAttachment('e1', 'att-1');
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('SOCIAL_FORBIDDEN');
        expect(result.statusCode).toBe(403);
    });
});

describe('error and network paths', () => {
    it('maps non-2xx JSON to ApiResponse { success: false, error, errorCode, statusCode }', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            error: 'forbidden',
            errorCode: 'SOCIAL_FORBIDDEN',
        }, { status: 403 }));
        const result = await pinSocialEntity('entity-1', true);
        expect(result.success).toBe(false);
        expect(result.error).toBe('forbidden');
        expect(result.errorCode).toBe('SOCIAL_FORBIDDEN');
        expect(result.statusCode).toBe(403);
    });

    it('surfaces 401 + AUTH_RELOGIN_REQUIRED so the UI can trigger relogin', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            error: 'token expired',
            errorCode: 'AUTH_RELOGIN_REQUIRED',
        }, { status: 401 }));
        const result = await getSocialEntity('entity-1');
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(401);
        expect(result.errorCode).toBe('AUTH_RELOGIN_REQUIRED');
    });

    it('maps a TypeError("Failed to fetch") into success=false (server unavailable)', async () => {
        fetchMock.mockImplementationOnce(async () => {
            throw new TypeError('Failed to fetch');
        });
        const result = await listSocialEntitiesByScope('group', 'g1');
        expect(result.success).toBe(false);
        expect(result.statusCode).toBe(0);
        expect(typeof result.error).toBe('string');
        expect(result.error?.length ?? 0).toBeGreaterThan(0);
    });

    it('persists the X-Renewed-Token from the response into localStorage', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(
            { success: true, data: { entities: [] } },
            { headers: { 'X-Renewed-Token': 'rotated.jwt' } },
        ));
        const result = await listSocialEntitiesByScope('group', 'g1');
        expect(result.success).toBe(true);
        expect(localStorage.getItem('token')).toBe('rotated.jwt');
    });
});

describe('searchSocialUsers', () => {
    it('issues GET /users/search with scope + q params', async () => {
        await searchSocialUsers('group:ITS-21', 'al');
        const { url, init } = getCall();
        const u = new URL(url);
        expect(u.pathname).toBe('/api/v3/social/users/search');
        expect(u.searchParams.get('scope')).toBe('group:ITS-21');
        expect(u.searchParams.get('q')).toBe('al');
        expect(u.searchParams.get('limit')).toBeNull();
        expect(init.method).toBeUndefined();
    });

    it('serialises a finite limit', async () => {
        await searchSocialUsers('group:ITS-21', 'al', 5);
        const { url } = getCall();
        expect(new URL(url).searchParams.get('limit')).toBe('5');
    });

    it('drops a non-finite limit', async () => {
        await searchSocialUsers('group:ITS-21', 'al', Number.NaN);
        const { url } = getCall();
        expect(new URL(url).searchParams.get('limit')).toBeNull();
    });

    it('floors fractional limits', async () => {
        await searchSocialUsers('group:ITS-21', 'al', 3.9);
        const { url } = getCall();
        expect(new URL(url).searchParams.get('limit')).toBe('3');
    });

    it('returns the parsed users array', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: { users: [{ userId: 'alice', displayName: 'Alice' }] },
        }));
        const result = await searchSocialUsers('group:ITS-21', 'al');
        expect(result.success).toBe(true);
        expect((result.data as { users: unknown[] }).users).toHaveLength(1);
    });
});

describe('buildSocialSearchQueryString (pure)', () => {
    it('always includes q', () => {
        const qs = buildSocialSearchQueryString('math');
        const u = new URLSearchParams(qs);
        expect(u.get('q')).toBe('math');
        expect(u.get('scopes')).toBeNull();
        expect(u.get('kinds')).toBeNull();
        expect(u.get('limit')).toBeNull();
    });

    it('serialises scope + kind arrays as comma-separated lists', () => {
        const qs = buildSocialSearchQueryString('math', {
            scopes: ['group', 'dm'],
            kinds: ['post', 'task'],
        });
        const u = new URLSearchParams(qs);
        expect(u.get('scopes')).toBe('group,dm');
        expect(u.get('kinds')).toBe('post,task');
    });

    it('omits empty arrays and non-finite limits', () => {
        const qs = buildSocialSearchQueryString('math', {
            scopes: [],
            kinds: [],
            limit: Number.NaN,
        });
        const u = new URLSearchParams(qs);
        expect(u.get('scopes')).toBeNull();
        expect(u.get('kinds')).toBeNull();
        expect(u.get('limit')).toBeNull();
    });

    it('clamps + floors limit at SOCIAL_SEARCH_MAX_LIMIT', () => {
        const qs = buildSocialSearchQueryString('math', { limit: 9999 });
        expect(new URLSearchParams(qs).get('limit')).toBe(String(SOCIAL_SEARCH_MAX_LIMIT));
    });

    it('clamps limit below 1 up to 1', () => {
        const qs = buildSocialSearchQueryString('math', { limit: 0 });
        expect(new URLSearchParams(qs).get('limit')).toBe('1');
    });

    it('floors fractional limits', () => {
        const qs = buildSocialSearchQueryString('math', { limit: 4.9 });
        expect(new URLSearchParams(qs).get('limit')).toBe('4');
    });
});

describe('searchSocialEntities', () => {
    it('issues GET /social/search with the query in `q`', async () => {
        await searchSocialEntities('math');
        const { url, init } = getCall();
        const u = new URL(url);
        expect(u.pathname).toBe('/api/v3/social/search');
        expect(u.searchParams.get('q')).toBe('math');
        expect(init.method).toBeUndefined();
    });

    it('forwards scope, kind and limit filters through the querystring', async () => {
        await searchSocialEntities('math', {
            scopes: ['group'],
            kinds: ['post', 'task'],
            limit: 25,
        });
        const u = new URL(getCall().url);
        expect(u.searchParams.get('scopes')).toBe('group');
        expect(u.searchParams.get('kinds')).toBe('post,task');
        expect(u.searchParams.get('limit')).toBe('25');
    });

    it('returns the parsed { results, total } envelope', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: {
                results: [{
                    entity: { id: 'hit1' },
                    reactions: [],
                    myReactions: [],
                    commentCount: 0,
                    attachmentCount: 0,
                    isPinned: false,
                }],
                total: 1,
            },
        }));
        const result = await searchSocialEntities('math');
        expect(result.success).toBe(true);
        const data = result.data as { results: unknown[]; total: number };
        expect(data.results).toHaveLength(1);
        expect(data.total).toBe(1);
    });
});

describe('recordSocialView', () => {
    it('POSTs to /api/v3/social/entities/:id/view with no body', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        await recordSocialView('ann-1');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/ann-1/view`);
        expect(init.method).toBe('POST');
        expect(init.body).toBeUndefined();
    });

    it('URL-encodes a wonky entity id', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        await recordSocialView('ann/1 weird');
        const { url } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/ann%2F1%20weird/view`);
    });

    it('short-circuits to success when entity id is empty (no fetch)', async () => {
        const result = await recordSocialView('');
        expect(result.success).toBe(true);
        // The whole point of the short-circuit is to keep the hook safe to
        // call with a null/empty id — we must not fire a network request.
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('short-circuits on a whitespace-only id', async () => {
        const result = await recordSocialView('   ');
        expect(result.success).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('surfaces the ApiResponse from the network when the entity id is valid', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(null, { status: 204 }));
        const result = await recordSocialView('ann-1');
        expect(result.success).toBe(true);
        expect(result.statusCode).toBe(204);
    });
});

describe('getSocialEntityViewers', () => {
    it('issues GET /entities/:id/views without limit when omitted', async () => {
        await getSocialEntityViewers('ann-1');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/ann-1/views`);
        // GET — no method override
        expect(init.method).toBeUndefined();
    });

    it('appends a clamped limit to the querystring when provided', async () => {
        await getSocialEntityViewers('ann-1', 9999);
        const { url } = getCall();
        // Backend cap is 2000 — the client clamps before sending so the
        // request never trips the AJV validator.
        const u = new URL(url);
        expect(u.pathname).toBe('/api/v3/social/entities/ann-1/views');
        expect(u.searchParams.get('limit')).toBe('2000');
    });

    it('ignores a non-finite limit', async () => {
        await getSocialEntityViewers('ann-1', Number.POSITIVE_INFINITY);
        const { url } = getCall();
        expect(url).not.toContain('limit=');
    });

    it('returns the parsed { viewers, count } envelope on success', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: {
                viewers: [
                    { userId: 'alice', viewedAt: '2026-05-20T10:00:00.000Z' },
                    { userId: 'bob', viewedAt: '2026-05-20T09:55:00.000Z' },
                ],
                count: 2,
            },
        }));
        const result = await getSocialEntityViewers('ann-1');
        expect(result.success).toBe(true);
        const data = result.data as { viewers: unknown[]; count: number };
        expect(data.viewers).toHaveLength(2);
        expect(data.count).toBe(2);
    });
});

// === Moderation ============================================================

import {
    listSocialReports,
    muteSocialUser,
    reportSocialEntity,
    reviewSocialReport,
    sanitizeModerationReason,
    SOCIAL_REPORT_REASON_MAX_LENGTH,
    unmuteSocialUser,
} from './social';

describe('reportSocialEntity', () => {
    it('POSTs the reason body to /entities/:id/report when present', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: { id: 'r1' } }, { status: 201 }));
        await reportSocialEntity('e1', '  spam  ');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/entities/e1/report`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ reason: 'spam' });
    });

    it('omits the reason key when input is empty/whitespace', async () => {
        await reportSocialEntity('e1', '   ');
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({});
    });

    it('omits the reason key when input is omitted entirely', async () => {
        await reportSocialEntity('e1');
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({});
    });

    it('url-encodes the entity id', async () => {
        await reportSocialEntity('abc/def 1');
        const { url } = getCall();
        expect(url).toContain('abc%2Fdef%201');
    });
});

describe('listSocialReports', () => {
    it('serialises status / limit / offset as query params', async () => {
        await listSocialReports({ status: 'pending', limit: 20, offset: 10 });
        const { url } = getCall();
        const u = new URL(url);
        expect(u.pathname).toBe('/api/v3/social/admin/reports');
        expect(u.searchParams.get('status')).toBe('pending');
        expect(u.searchParams.get('limit')).toBe('20');
        expect(u.searchParams.get('offset')).toBe('10');
    });

    it('omits query string entirely when no opts given', async () => {
        await listSocialReports();
        const { url } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/admin/reports`);
    });

    it('ignores NaN / Infinity for limit/offset', async () => {
        await listSocialReports({ limit: Number.NaN, offset: Number.POSITIVE_INFINITY });
        const { url } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/admin/reports`);
    });
});

describe('reviewSocialReport', () => {
    it('POSTs { action: dismiss } and url-encodes the report id', async () => {
        await reviewSocialReport('r 1', 'dismiss');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/admin/reports/r%201/review`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({ action: 'dismiss' });
    });

    it('POSTs { action: remove } for the destructive variant', async () => {
        await reviewSocialReport('r2', 'remove');
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({ action: 'remove' });
    });
});

describe('muteSocialUser', () => {
    it('POSTs minimal payload when only the scope is provided', async () => {
        await muteSocialUser({ userId: 'alice', scopeType: 'global', scopeId: 'global:chat' });
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/admin/mute`);
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body as string);
        expect(body).toEqual({ userId: 'alice', scopeType: 'global', scopeId: 'global:chat' });
        expect(body.reason).toBeUndefined();
        expect(body.durationMs).toBeUndefined();
    });

    it('serializes a positive durationMs and trimmed reason', async () => {
        await muteSocialUser({
            userId: 'alice',
            scopeType: 'global',
            scopeId: 'global:chat',
            reason: '  spam  ',
            durationMs: 60_000.7,
        });
        const { init } = getCall();
        expect(JSON.parse(init.body as string)).toEqual({
            userId: 'alice',
            scopeType: 'global',
            scopeId: 'global:chat',
            reason: 'spam',
            durationMs: 60_000, // floored
        });
    });

    it('treats durationMs=0 or NaN as a permanent mute (key omitted)', async () => {
        await muteSocialUser({
            userId: 'alice',
            scopeType: 'global',
            scopeId: 'global:chat',
            durationMs: 0,
        });
        const { init: zero } = getCall();
        expect(JSON.parse(zero.body as string).durationMs).toBeUndefined();

        fetchMock.mockClear();
        await muteSocialUser({
            userId: 'alice',
            scopeType: 'global',
            scopeId: 'global:chat',
            durationMs: Number.NaN,
        });
        const { init: nan } = getCall();
        expect(JSON.parse(nan.body as string).durationMs).toBeUndefined();
    });
});

describe('unmuteSocialUser', () => {
    it('POSTs the (userId, scopeType, scopeId) triple to /admin/unmute', async () => {
        await unmuteSocialUser('alice', 'global', 'global:chat');
        const { url, init } = getCall();
        expect(url).toBe(`${API_URL}/api/v3/social/admin/unmute`);
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body as string)).toEqual({
            userId: 'alice',
            scopeType: 'global',
            scopeId: 'global:chat',
        });
    });
});

describe('sanitizeModerationReason (pure)', () => {
    it('returns null for non-string input', () => {
        expect(sanitizeModerationReason(undefined)).toBeNull();
        expect(sanitizeModerationReason(null)).toBeNull();
        expect(sanitizeModerationReason(42)).toBeNull();
    });

    it('returns null for empty / whitespace strings', () => {
        expect(sanitizeModerationReason('')).toBeNull();
        expect(sanitizeModerationReason('   ')).toBeNull();
    });

    it('trims a non-empty reason', () => {
        expect(sanitizeModerationReason('  spam  ')).toBe('spam');
    });

    it('throws when the reason exceeds the cap', () => {
        const tooLong = 'x'.repeat(SOCIAL_REPORT_REASON_MAX_LENGTH + 1);
        expect(() => sanitizeModerationReason(tooLong)).toThrow(/reason too long/);
    });

    it('respects a custom cap argument', () => {
        expect(() => sanitizeModerationReason('abcdef', 5)).toThrow(/reason too long/);
        expect(sanitizeModerationReason('abcde', 5)).toBe('abcde');
    });
});
