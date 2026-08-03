/**
 * Unit tests for the pure helpers exported from `use-social-stream.ts`.
 *
 * Per repo conventions (see `AGENTS.md` and `frontend/CLAUDE.md`), the React
 * hook itself is intentionally not tested directly — it is DOM-coupled to
 * `EventSource` + `setTimeout`. We exercise the pure validation, URL
 * construction, scope normalization, and exponential-backoff math here, which
 * is where the interesting behaviour lives.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    MAX_RECONNECT_ATTEMPTS,
    MAX_STREAM_SCOPES,
    buildStreamUrl,
    computeBackoffMs,
    normalizeScopes,
    parseSocialStreamEvent,
    parseSocialStreamPayload,
    toCommentCreatedEvent,
    toEntityCreatedEvent,
    toPresenceChangedEvent,
    toTypingEvent,
} from './use-social-stream';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('parseSocialStreamEvent', () => {
    it('returns null for empty or non-string input', () => {
        expect(parseSocialStreamEvent('')).toBeNull();
        expect(parseSocialStreamEvent(null as unknown as string)).toBeNull();
        expect(parseSocialStreamEvent(undefined as unknown as string)).toBeNull();
    });

    it('returns null for invalid JSON', () => {
        expect(parseSocialStreamEvent('{not json')).toBeNull();
        expect(parseSocialStreamEvent('}{')).toBeNull();
    });

    it('returns null when payload is not an object', () => {
        expect(parseSocialStreamEvent('42')).toBeNull();
        expect(parseSocialStreamEvent('"hello"')).toBeNull();
        expect(parseSocialStreamEvent('[1,2,3]')).toBeNull();
        expect(parseSocialStreamEvent('null')).toBeNull();
    });

    it('returns null when `id` field is missing or empty', () => {
        expect(parseSocialStreamEvent('{}')).toBeNull();
        expect(parseSocialStreamEvent('{"id": ""}')).toBeNull();
        expect(parseSocialStreamEvent('{"id": 42}')).toBeNull();
    });

    it('returns parsed object when JSON has at least an `id` string', () => {
        const out = parseSocialStreamEvent('{"id":"abc","other":1}');
        expect(out).toEqual({ id: 'abc', other: 1 });
    });
});

describe('toEntityCreatedEvent', () => {
    it('returns null for null input', () => {
        expect(toEntityCreatedEvent(null)).toBeNull();
    });

    it('returns null when required fields are missing', () => {
        expect(toEntityCreatedEvent({ id: 'a' })).toBeNull();
        expect(
            toEntityCreatedEvent({
                id: 'a',
                kind: 'post',
                scopeType: 'group',
                scopeId: 'group:abc',
                authorUserId: 'u1',
                // pinned missing
                createdAt: '2024-01-01',
            }),
        ).toBeNull();
    });

    it('returns null when types are wrong', () => {
        expect(
            toEntityCreatedEvent({
                id: 'a',
                kind: 'post',
                scopeType: 'group',
                scopeId: 'group:abc',
                authorUserId: 'u1',
                pinned: 'no', // should be boolean
                createdAt: '2024-01-01',
            }),
        ).toBeNull();
    });

    it('promotes a well-formed payload', () => {
        const event = toEntityCreatedEvent({
            id: 'e1',
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:abc',
            authorUserId: 'u1',
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
        });
        expect(event).not.toBeNull();
        expect(event?.type).toBe('entity-created');
        expect(event?.data.id).toBe('e1');
        expect(event?.data.kind).toBe('post');
    });
});

describe('toCommentCreatedEvent', () => {
    const validBase = {
        id: 'c1',
        entityId: 'e1',
        parentCommentId: null,
        authorUserId: 'u1',
        createdAt: '2026-01-01T00:00:00Z',
        scopeType: 'group',
        scopeId: 'group:abc',
        parentEntity: { id: 'e1', kind: 'post', authorUserId: 'u2' },
    };

    it('returns null for null input', () => {
        expect(toCommentCreatedEvent(null)).toBeNull();
    });

    it('returns null when parentEntity is missing or malformed', () => {
        const noParent = { ...validBase };
        // @ts-expect-error deliberate
        delete noParent.parentEntity;
        expect(toCommentCreatedEvent(noParent)).toBeNull();

        expect(
            toCommentCreatedEvent({ ...validBase, parentEntity: 'not-an-object' }),
        ).toBeNull();

        expect(
            toCommentCreatedEvent({
                ...validBase,
                parentEntity: { id: 'e1', kind: 'post' }, // missing authorUserId
            }),
        ).toBeNull();
    });

    it('returns null when parentCommentId is neither string nor null', () => {
        expect(
            toCommentCreatedEvent({ ...validBase, parentCommentId: 42 }),
        ).toBeNull();
    });

    it('accepts null parentCommentId', () => {
        const event = toCommentCreatedEvent(validBase);
        expect(event?.type).toBe('comment-created');
        expect(event?.data.parentCommentId).toBeNull();
    });

    it('accepts string parentCommentId', () => {
        const event = toCommentCreatedEvent({
            ...validBase,
            parentCommentId: 'c0',
        });
        expect(event?.data.parentCommentId).toBe('c0');
    });
});

describe('normalizeScopes', () => {
    it('returns empty array when input is not an array', () => {
        expect(normalizeScopes(undefined as unknown as string[])).toEqual([]);
        expect(normalizeScopes(null as unknown as string[])).toEqual([]);
        expect(normalizeScopes('group:abc' as unknown as string[])).toEqual([]);
    });

    it('drops empty / whitespace / malformed entries', () => {
        expect(normalizeScopes(['', '   ', 'no-colon', ':no-type', 'no-id:'])).toEqual([]);
    });

    it('drops entries with disallowed scope types', () => {
        expect(normalizeScopes(['cats:meow', 'admin:secret', 'group:ok'])).toEqual(['group:ok']);
    });

    it('dedupes case-sensitive scope ids', () => {
        const out = normalizeScopes(['group:abc', 'group:abc', 'group:ABC']);
        expect(out).toEqual(['group:ABC', 'group:abc']);
    });

    it('sorts the output for stability across renders', () => {
        const out = normalizeScopes(['global:chat', 'group:abc', 'dm:room1']);
        // ASCII sort: 'dm:' < 'global:' < 'group:'
        expect(out).toEqual(['dm:room1', 'global:chat', 'group:abc']);
    });

    it('accepts all four allowed scope types', () => {
        const out = normalizeScopes([
            'group:g1',
            'dm:d1',
            'global:chat',
            'announcement:global',
        ]);
        expect(out).toEqual([
            'announcement:global',
            'dm:d1',
            'global:chat',
            'group:g1',
        ]);
    });

    it('caps the result at MAX_STREAM_SCOPES', () => {
        const many = Array.from({ length: MAX_STREAM_SCOPES + 10 }, (_, i) => `group:g${i.toString().padStart(3, '0')}`);
        const out = normalizeScopes(many);
        expect(out.length).toBe(MAX_STREAM_SCOPES);
    });

    it('trims surrounding whitespace before parsing', () => {
        expect(normalizeScopes(['  group:abc  '])).toEqual(['group:abc']);
    });

    it('handles colons inside the id portion (DM rooms include colons)', () => {
        // `dm:direct:alice::bob` is a real backend example from SOCIAL_STORE.md
        expect(normalizeScopes(['dm:direct:alice::bob'])).toEqual(['dm:direct:alice::bob']);
    });
});

describe('buildStreamUrl', () => {
    it('returns empty string for empty scope list', () => {
        expect(buildStreamUrl([])).toBe('');
        expect(buildStreamUrl(['', '  '])).toBe('');
    });

    it('builds an absolute URL with the encoded scope query', () => {
        const url = buildStreamUrl(['group:abc'], 'https://api.example.com');
        expect(url).toBe('https://api.example.com/api/v3/social/stream?scopes=group%3Aabc');
    });

    it('joins multiple scopes with commas and percent-encodes them', () => {
        const url = buildStreamUrl(['group:abc', 'dm:room1'], 'https://api.example.com');
        // After normalize+sort: dm:room1, group:abc
        // The raw comma-joined value is `dm:room1,group:abc` → encoded version
        expect(url).toBe('https://api.example.com/api/v3/social/stream?scopes=dm%3Aroom1%2Cgroup%3Aabc');
    });

    it('uses the API_URL default when no apiUrl is passed', () => {
        // We can't assert the exact base (it depends on env), but it should at
        // least contain the `/api/v3/social/stream?scopes=` segment.
        const url = buildStreamUrl(['group:abc']);
        expect(url).toContain('/api/v3/social/stream?scopes=');
    });

    it('returns empty string when all scopes are malformed', () => {
        expect(buildStreamUrl(['cats:meow', 'no-colon'])).toBe('');
    });
});

describe('computeBackoffMs', () => {
    it('returns a positive integer for attempt=0', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        // base=1000, factor^0=1, capped=1000, jitter range [500, 1000]
        // 1000 * (0.5 + 0.5*0.5) = 1000 * 0.75 = 750
        expect(computeBackoffMs(0)).toBe(750);
    });

    it('respects the lower jitter bound (random=0 → 50%)', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0);
        // attempt 0: 1000 * 0.5 = 500
        expect(computeBackoffMs(0)).toBe(500);
    });

    it('respects the upper jitter bound (random=1 → 100%)', () => {
        // Math.random() never actually returns 1 — use the closest possible.
        vi.spyOn(Math, 'random').mockReturnValue(0.9999999);
        // attempt 0: 1000 * (0.5 + 0.5) ≈ 1000 → floor(999.9...) = 999
        const result = computeBackoffMs(0);
        expect(result).toBeGreaterThanOrEqual(999);
        expect(result).toBeLessThanOrEqual(1000);
    });

    it('grows exponentially with attempt', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0); // pin to 50% lower bound
        expect(computeBackoffMs(0)).toBe(500); // 1000 * 0.5
        expect(computeBackoffMs(1)).toBe(1000); // 2000 * 0.5
        expect(computeBackoffMs(2)).toBe(2000); // 4000 * 0.5
        expect(computeBackoffMs(3)).toBe(4000); // 8000 * 0.5
        expect(computeBackoffMs(4)).toBe(8000); // 16000 * 0.5
    });

    it('caps the result at 30 seconds (BACKOFF_MAX_MS)', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.9999999);
        // base * 2^10 = 1024000ms, capped to 30000, then jittered to ~30000.
        expect(computeBackoffMs(10)).toBeLessThanOrEqual(30_000);
        expect(computeBackoffMs(20)).toBeLessThanOrEqual(30_000);
        expect(computeBackoffMs(100)).toBeLessThanOrEqual(30_000);
    });

    it('cap holds for negative or non-finite attempts via floor/max guard', () => {
        vi.spyOn(Math, 'random').mockReturnValue(0.5);
        // Negative attempt clamps to 0 → behaves as attempt=0.
        expect(computeBackoffMs(-5)).toBe(750);
        expect(computeBackoffMs(-1)).toBe(750);
        // Non-integer attempts floor down (1.7 → 1).
        expect(computeBackoffMs(1.7)).toBe(1500);
    });

    it('produces a value strictly between 0 and BACKOFF_MAX_MS for any attempt', () => {
        // Don't stub Math.random — let the real RNG drive variance.
        for (let attempt = 0; attempt < 30; attempt += 1) {
            const value = computeBackoffMs(attempt);
            expect(value).toBeGreaterThan(0);
            expect(value).toBeLessThanOrEqual(30_000);
        }
    });
});

describe('exports', () => {
    it('exposes the reconnect attempt cap as a public constant', () => {
        expect(MAX_RECONNECT_ATTEMPTS).toBe(5);
    });

    it('exposes the per-connection scope cap as a public constant', () => {
        expect(MAX_STREAM_SCOPES).toBe(64);
    });
});

// ============================================================================
// parseSocialStreamPayload (lenient parser — no required `id`)
// ============================================================================

describe('parseSocialStreamPayload', () => {
    it('returns null for empty / non-string input', () => {
        expect(parseSocialStreamPayload('')).toBeNull();
        expect(parseSocialStreamPayload(null as unknown as string)).toBeNull();
        expect(parseSocialStreamPayload(undefined as unknown as string)).toBeNull();
    });

    it('returns null for invalid JSON', () => {
        expect(parseSocialStreamPayload('{not json')).toBeNull();
    });

    it('returns null when payload is not a plain object', () => {
        expect(parseSocialStreamPayload('"hi"')).toBeNull();
        expect(parseSocialStreamPayload('[1,2]')).toBeNull();
        expect(parseSocialStreamPayload('null')).toBeNull();
    });

    it('returns the object when payload has no `id` (presence-changed shape)', () => {
        const out = parseSocialStreamPayload('{"scope":"dm:r1","onlineUserIds":["alice"]}');
        expect(out).toEqual({ scope: 'dm:r1', onlineUserIds: ['alice'] });
    });

    it('returns the object when payload has an empty `id` (also valid for typing)', () => {
        // typing frames don't carry id at all, but the parser must not reject
        // arbitrary additional keys.
        const out = parseSocialStreamPayload('{"scope":"dm:r1","userId":"u1","startedAt":42}');
        expect(out).not.toBeNull();
        expect(out?.userId).toBe('u1');
    });
});

// ============================================================================
// toPresenceChangedEvent
// ============================================================================

describe('toPresenceChangedEvent', () => {
    it('returns null for null input', () => {
        expect(toPresenceChangedEvent(null)).toBeNull();
    });

    it('returns null when scope is missing or empty', () => {
        expect(toPresenceChangedEvent({ onlineUserIds: [] })).toBeNull();
        expect(toPresenceChangedEvent({ scope: '', onlineUserIds: [] })).toBeNull();
    });

    it('returns null when onlineUserIds is not an array', () => {
        expect(toPresenceChangedEvent({ scope: 'dm:r1', onlineUserIds: 'alice' })).toBeNull();
    });

    it('returns null when onlineUserIds contains non-strings', () => {
        expect(
            toPresenceChangedEvent({ scope: 'dm:r1', onlineUserIds: ['alice', 42] }),
        ).toBeNull();
    });

    it('accepts an empty onlineUserIds list (everyone disconnected)', () => {
        const event = toPresenceChangedEvent({ scope: 'dm:r1', onlineUserIds: [] });
        expect(event?.type).toBe('presence-changed');
        expect(event?.data.onlineUserIds).toEqual([]);
    });

    it('promotes a well-formed payload', () => {
        const event = toPresenceChangedEvent({
            scope: 'dm:r1',
            onlineUserIds: ['alice', 'bob'],
        });
        expect(event?.type).toBe('presence-changed');
        expect(event?.data.scope).toBe('dm:r1');
        expect(event?.data.onlineUserIds).toEqual(['alice', 'bob']);
    });
});

// ============================================================================
// toTypingEvent
// ============================================================================

describe('toTypingEvent', () => {
    it('returns null for null input', () => {
        expect(toTypingEvent(null)).toBeNull();
    });

    it('returns null when any field is missing', () => {
        expect(toTypingEvent({ userId: 'u1', startedAt: 1 })).toBeNull();
        expect(toTypingEvent({ scope: 'dm:r1', startedAt: 1 })).toBeNull();
        expect(toTypingEvent({ scope: 'dm:r1', userId: 'u1' })).toBeNull();
    });

    it('returns null when startedAt is not a finite number', () => {
        expect(
            toTypingEvent({ scope: 'dm:r1', userId: 'u1', startedAt: 'never' }),
        ).toBeNull();
        expect(
            toTypingEvent({ scope: 'dm:r1', userId: 'u1', startedAt: Number.NaN }),
        ).toBeNull();
        expect(
            toTypingEvent({ scope: 'dm:r1', userId: 'u1', startedAt: Infinity }),
        ).toBeNull();
    });

    it('returns null when scope or userId is an empty string', () => {
        expect(toTypingEvent({ scope: '', userId: 'u1', startedAt: 1 })).toBeNull();
        expect(toTypingEvent({ scope: 'dm:r1', userId: '', startedAt: 1 })).toBeNull();
    });

    it('promotes a well-formed payload', () => {
        const event = toTypingEvent({
            scope: 'dm:r1',
            userId: 'alice',
            startedAt: 1_700_000_000_000,
        });
        expect(event?.type).toBe('typing');
        expect(event?.data).toEqual({
            scope: 'dm:r1',
            userId: 'alice',
            startedAt: 1_700_000_000_000,
        });
    });
});
