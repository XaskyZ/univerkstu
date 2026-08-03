import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import {
    __testing,
    entityScopeKey,
    formatSseEvent,
    parseScopesFromQuery,
    resolveAllowedScopes,
    socialStreamRoutes,
    type ParsedScope,
} from './social-stream.js';
import { __resetPresenceStateForTests, typingMap } from '../services/presence.js';

// Mock the heavy access modules so the tests do not need a live Postgres pool.
vi.mock('../services/group-space.js', () => ({
    assertCanReadGroup: vi.fn(async (_userId: string, groupKey: string) => {
        if (groupKey === 'FORBIDDEN-GROUP') throw new Error('Forbidden');
    }),
}));
vi.mock('../services/messaging.js', () => ({
    parseDirectRoomId: vi.fn((roomId: string) => {
        if (!roomId.startsWith('direct:')) return null;
        const payload = roomId.slice('direct:'.length);
        const sep = payload.indexOf('::');
        if (sep <= 0 || sep === payload.length - 2) return null;
        return { low: payload.slice(0, sep), high: payload.slice(sep + 2) };
    }),
}));

beforeEach(() => {
    vi.clearAllMocks();
    __resetPresenceStateForTests();
});

// ============================================================================
// parseScopesFromQuery (pure)
// ============================================================================

describe('parseScopesFromQuery', () => {
    it('returns [] for missing input', () => {
        expect(parseScopesFromQuery(undefined)).toEqual([]);
        expect(parseScopesFromQuery('')).toEqual([]);
        expect(parseScopesFromQuery(null)).toEqual([]);
    });

    it('parses a single valid scope', () => {
        const parsed = parseScopesFromQuery('group:ITS-21');
        expect(parsed).toHaveLength(1);
        expect(parsed[0]).toEqual({
            scopeType: 'group',
            rawId: 'ITS-21',
            full: 'group:ITS-21',
        });
    });

    it('parses multiple scopes preserving order', () => {
        const parsed = parseScopesFromQuery('group:A,dm:direct:alice::bob,global:chat');
        expect(parsed.map((s) => s.full)).toEqual([
            'group:A',
            'dm:direct:alice::bob',
            'global:chat',
        ]);
    });

    it('drops malformed entries (no separator / empty id / unknown type)', () => {
        const parsed = parseScopesFromQuery('foobar,group:,:noid,banana:x,group:ok');
        expect(parsed.map((s) => s.full)).toEqual(['group:ok']);
    });

    it('collapses duplicates preserving first occurrence', () => {
        const parsed = parseScopesFromQuery('group:A,group:A,group:B,group:A');
        expect(parsed.map((s) => s.full)).toEqual(['group:A', 'group:B']);
    });

    it('caps total scopes to MAX_SCOPES_PER_CONNECTION', () => {
        const many = Array.from({ length: __testing.MAX_SCOPES_PER_CONNECTION + 10 }, (_, i) => `group:g${i}`).join(',');
        const parsed = parseScopesFromQuery(many);
        expect(parsed.length).toBe(__testing.MAX_SCOPES_PER_CONNECTION);
    });

    it('treats non-string input as empty', () => {
        expect(parseScopesFromQuery(123)).toEqual([]);
        expect(parseScopesFromQuery({})).toEqual([]);
        expect(parseScopesFromQuery([])).toEqual([]);
    });
});

// ============================================================================
// entityScopeKey (pure)
// ============================================================================

describe('entityScopeKey', () => {
    it('returns the canonical scopeId untouched when already prefixed', () => {
        expect(entityScopeKey({ scopeType: 'group', scopeId: 'group:ITS-21' })).toBe('group:ITS-21');
    });

    it('prefixes a bare scopeId with the scopeType', () => {
        // (rare in practice — buildScopeId enforces the prefix — but the
        // helper must remain robust if a future caller mis-stores a row).
        expect(entityScopeKey({ scopeType: 'dm', scopeId: 'direct:a::b' })).toBe('dm:direct:a::b');
    });

    it('preserves nested colons in dm scope ids', () => {
        // DM scope ids look like `dm:direct:alice::bob` — the colon after dm
        // is the type/id separator; the colons in `direct:alice::bob` are
        // payload.
        expect(entityScopeKey({ scopeType: 'dm', scopeId: 'dm:direct:alice::bob' })).toBe('dm:direct:alice::bob');
    });
});

// ============================================================================
// formatSseEvent (pure)
// ============================================================================

describe('formatSseEvent', () => {
    it('serialises a basic payload', () => {
        const frame = formatSseEvent('entity-created', { id: 'e1', kind: 'post' });
        expect(frame).toBe('event: entity-created\ndata: {"id":"e1","kind":"post"}\n\n');
    });

    it('strips CR/LF from the event name', () => {
        const frame = formatSseEvent('bad\nname\rhere', { ok: true });
        expect(frame.startsWith('event: badnamehere\n')).toBe(true);
    });

    it('falls back to an error frame on unserializable data', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;
        const frame = formatSseEvent('x', circular);
        expect(frame).toContain('"unserializable payload"');
    });

    it('defaults the event name when missing', () => {
        const frame = formatSseEvent('', { v: 1 });
        expect(frame.startsWith('event: message\n')).toBe(true);
    });
});

// ============================================================================
// resolveAllowedScopes (auth gating)
// ============================================================================

describe('resolveAllowedScopes', () => {
    it('passes global and announcement scopes without lookup', async () => {
        const requested: ParsedScope[] = [
            { scopeType: 'global', rawId: 'chat', full: 'global:chat' },
            { scopeType: 'announcement', rawId: 'global', full: 'announcement:global' },
        ];
        const allowed = await resolveAllowedScopes('alice', requested);
        expect(allowed.map((s) => s.full)).toEqual(['global:chat', 'announcement:global']);
    });

    it('admits a group when assertCanReadGroup does not throw', async () => {
        const requested: ParsedScope[] = [
            { scopeType: 'group', rawId: 'ITS-21', full: 'group:ITS-21' },
        ];
        const allowed = await resolveAllowedScopes('alice', requested);
        expect(allowed.map((s) => s.full)).toEqual(['group:ITS-21']);
    });

    it('drops a group when assertCanReadGroup throws', async () => {
        const requested: ParsedScope[] = [
            { scopeType: 'group', rawId: 'FORBIDDEN-GROUP', full: 'group:FORBIDDEN-GROUP' },
            { scopeType: 'group', rawId: 'OK', full: 'group:OK' },
        ];
        const allowed = await resolveAllowedScopes('alice', requested);
        expect(allowed.map((s) => s.full)).toEqual(['group:OK']);
    });

    it('admits a dm scope only when viewer is a participant', async () => {
        const requested: ParsedScope[] = [
            { scopeType: 'dm', rawId: 'direct:alice::bob', full: 'dm:direct:alice::bob' },
            { scopeType: 'dm', rawId: 'direct:carol::dan', full: 'dm:direct:carol::dan' },
        ];
        const allowed = await resolveAllowedScopes('alice', requested);
        expect(allowed.map((s) => s.full)).toEqual(['dm:direct:alice::bob']);
    });

    it('drops a dm scope with a malformed room id', async () => {
        const requested: ParsedScope[] = [
            { scopeType: 'dm', rawId: 'not-a-direct-room', full: 'dm:not-a-direct-room' },
        ];
        const allowed = await resolveAllowedScopes('alice', requested);
        expect(allowed).toEqual([]);
    });

    it('returns [] when viewerUserId is empty', async () => {
        const requested: ParsedScope[] = [
            { scopeType: 'global', rawId: 'chat', full: 'global:chat' },
        ];
        const allowed = await resolveAllowedScopes('', requested);
        expect(allowed).toEqual([]);
    });
});

// ============================================================================
// Route smoke: 401 / 200 + headers
// ============================================================================

async function buildApp(userId: string | null) {
    const app = Fastify();
    app.decorate('authenticate', async (req: { user?: { userId: string } }) => {
        if (userId) req.user = { userId };
    });
    await app.register(socialStreamRoutes);
    return app;
}

describe('GET /social/stream — smoke', () => {
    let cleanupApp: { close: () => Promise<void> } | null = null;

    afterEach(async () => {
        if (cleanupApp) {
            await cleanupApp.close();
            cleanupApp = null;
        }
    });

    it('rejects unauthenticated connections with 401', async () => {
        const app = await buildApp(null);
        cleanupApp = app;
        const res = await app.inject({
            method: 'GET',
            url: '/social/stream?scopes=global:chat',
        });
        expect(res.statusCode).toBe(401);
        expect(res.json().errorCode).toBe('SOCIAL_UNAUTHENTICATED');
    });

    it('opens the stream with SSE headers and the initial keepalive (200)', async () => {
        const app = await buildApp('alice');
        cleanupApp = app;
        // Listen on an ephemeral port so we can drive a real HTTP request with
        // a controllable abort signal — `inject` does not support hijacked
        // streams cleanly.
        await app.listen({ host: '127.0.0.1', port: 0 });
        const address = app.server.address();
        if (!address || typeof address === 'string') {
            throw new Error('no address');
        }
        const ctrl = new AbortController();
        const url = `http://127.0.0.1:${address.port}/social/stream?scopes=global:chat`;
        const fetchPromise = fetch(url, { signal: ctrl.signal });

        const response = await fetchPromise;
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/event-stream');
        expect(response.headers.get('cache-control')).toContain('no-cache');
        expect(response.headers.get('connection')).toBe('keep-alive');

        // Read the first chunk so we know the stream is flowing — should be the
        // `:ok\n\n` keepalive comment.
        const reader = response.body?.getReader();
        if (!reader) throw new Error('no body reader');
        const { value, done } = await reader.read();
        expect(done).toBe(false);
        const text = new TextDecoder().decode(value);
        expect(text.startsWith(':ok')).toBe(true);

        // Close the client side and tear down.
        ctrl.abort();
        try {
            await reader.cancel();
        } catch {
            // already cancelled
        }
    });
});

// ============================================================================
// POST /social/typing
// ============================================================================

describe('POST /social/typing', () => {
    let cleanupApp: { close: () => Promise<void> } | null = null;

    afterEach(async () => {
        if (cleanupApp) {
            await cleanupApp.close();
            cleanupApp = null;
        }
    });

    it('rejects unauthenticated requests with 401', async () => {
        const app = await buildApp(null);
        cleanupApp = app;
        const res = await app.inject({
            method: 'POST',
            url: '/social/typing',
            payload: { scope: 'global:chat' },
        });
        expect(res.statusCode).toBe(401);
    });

    it('400s when body is missing the scope field', async () => {
        const app = await buildApp('alice');
        cleanupApp = app;
        const res = await app.inject({
            method: 'POST',
            url: '/social/typing',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_TYPING_VALIDATION');
    });

    it('400s when scope has unknown type', async () => {
        const app = await buildApp('alice');
        cleanupApp = app;
        const res = await app.inject({
            method: 'POST',
            url: '/social/typing',
            payload: { scope: 'cats:meow' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_TYPING_VALIDATION');
    });

    it('403s when scope auth check rejects the user', async () => {
        const app = await buildApp('alice');
        cleanupApp = app;
        const res = await app.inject({
            method: 'POST',
            url: '/social/typing',
            payload: { scope: 'group:FORBIDDEN-GROUP' },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().errorCode).toBe('SOCIAL_FORBIDDEN');
    });

    it('200s on a valid global scope and registers the typing entry', async () => {
        const app = await buildApp('alice');
        cleanupApp = app;
        const res = await app.inject({
            method: 'POST',
            url: '/social/typing',
            payload: { scope: 'global:chat' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toMatchObject({
            success: true,
            data: { scope: 'global:chat' },
        });
        // The in-memory typing map should now have an entry for alice.
        expect(typingMap.has('global:chat|alice')).toBe(true);
    });

    it('200s on a valid dm scope where the viewer is a participant', async () => {
        const app = await buildApp('alice');
        cleanupApp = app;
        const res = await app.inject({
            method: 'POST',
            url: '/social/typing',
            payload: { scope: 'dm:direct:alice::bob' },
        });
        expect(res.statusCode).toBe(200);
        expect(typingMap.has('dm:direct:alice::bob|alice')).toBe(true);
    });

    it('403s on a dm scope where the viewer is not a participant', async () => {
        const app = await buildApp('alice');
        cleanupApp = app;
        const res = await app.inject({
            method: 'POST',
            url: '/social/typing',
            payload: { scope: 'dm:direct:carol::dan' },
        });
        expect(res.statusCode).toBe(403);
    });

    it('echoes back the scope and a startedAt timestamp', async () => {
        const app = await buildApp('alice');
        cleanupApp = app;
        const before = Date.now();
        const res = await app.inject({
            method: 'POST',
            url: '/social/typing',
            payload: { scope: 'global:chat' },
        });
        const after = Date.now();
        const body = res.json() as { data: { scope: string; startedAt: number } };
        expect(body.data.scope).toBe('global:chat');
        expect(body.data.startedAt).toBeGreaterThanOrEqual(before);
        expect(body.data.startedAt).toBeLessThanOrEqual(after);
    });
});
