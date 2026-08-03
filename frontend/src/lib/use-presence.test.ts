/**
 * Unit tests for the pure helpers exported from `use-presence.ts`.
 *
 * Per repo conventions (see `AGENTS.md`), the React hooks themselves are
 * DOM-coupled and not tested directly. We exercise `selectActiveTypers`,
 * `reduceTypingExpiries`, and `forwardPresenceOrTyping` — the pure parts
 * where the interesting behaviour lives.
 */
import { describe, expect, it } from 'vitest';
import {
    PRESENCE_STALE_MS,
    TYPING_DECAY_MS,
    TYPING_PING_THROTTLE_MS,
    forwardPresenceOrTyping,
    reduceTypingExpiries,
    selectActiveTypers,
} from './use-presence';

describe('selectActiveTypers', () => {
    it('returns [] for an empty map', () => {
        expect(selectActiveTypers({})).toEqual([]);
    });

    it('returns users whose expiry is in the future', () => {
        const now = 1_000_000;
        const out = selectActiveTypers(
            { alice: now + 1000, bob: now - 1000, carol: now + 5000 },
            now,
        );
        expect(out.sort()).toEqual(['alice', 'carol']);
    });

    it('treats expiry exactly equal to now as expired (strict greater-than)', () => {
        const now = 1_000_000;
        expect(selectActiveTypers({ alice: now }, now)).toEqual([]);
    });

    it('ignores non-number values defensively', () => {
        const now = 1_000_000;
        const out = selectActiveTypers(
            // @ts-expect-error — deliberate runtime garbage
            { alice: 'soon', bob: now + 1000 },
            now,
        );
        expect(out).toEqual(['bob']);
    });
});

describe('reduceTypingExpiries', () => {
    it('inserts a new entry preserving existing ones', () => {
        const next = reduceTypingExpiries({ alice: 1000 }, 'bob', 2000);
        expect(next).toEqual({ alice: 1000, bob: 2000 + TYPING_DECAY_MS });
    });

    it('overwrites an existing entry with a later startedAt', () => {
        const next = reduceTypingExpiries({ alice: 1000 }, 'alice', 5000);
        expect(next.alice).toBe(5000 + TYPING_DECAY_MS);
    });

    it('honors a custom decayMs argument', () => {
        const next = reduceTypingExpiries({}, 'alice', 1000, 7500);
        expect(next.alice).toBe(8500);
    });

    it('returns a new object so React sees an identity change', () => {
        const before = { alice: 1000 };
        const after = reduceTypingExpiries(before, 'alice', 2000);
        expect(after).not.toBe(before);
    });
});

describe('forwardPresenceOrTyping', () => {
    it('returns null for entity-created frames', () => {
        const out = forwardPresenceOrTyping({
            type: 'entity-created',
            data: {
                id: 'e1',
                kind: 'post',
                scopeType: 'group',
                scopeId: 'group:a',
                authorUserId: 'u1',
                pinned: false,
                createdAt: '2026-01-01T00:00:00Z',
            },
        });
        expect(out).toBeNull();
    });

    it('returns null for comment-created frames', () => {
        const out = forwardPresenceOrTyping({
            type: 'comment-created',
            data: {
                id: 'c1',
                entityId: 'e1',
                parentCommentId: null,
                authorUserId: 'u1',
                createdAt: '2026-01-01T00:00:00Z',
                scopeType: 'group',
                scopeId: 'group:a',
                parentEntity: { id: 'e1', kind: 'post', authorUserId: 'u2' },
            },
        });
        expect(out).toBeNull();
    });

    it('forwards a presence-changed frame with a fresh receivedAt', () => {
        const before = Date.now();
        const out = forwardPresenceOrTyping({
            type: 'presence-changed',
            data: { scope: 'dm:r1', onlineUserIds: ['alice'] },
        });
        const after = Date.now();
        expect(out?.kind).toBe('presence');
        if (out?.kind === 'presence') {
            expect(out.payload.scope).toBe('dm:r1');
            expect(out.payload.onlineUserIds).toEqual(['alice']);
            expect(out.payload.receivedAt).toBeGreaterThanOrEqual(before);
            expect(out.payload.receivedAt).toBeLessThanOrEqual(after);
        }
    });

    it('forwards a typing frame with original startedAt preserved', () => {
        const out = forwardPresenceOrTyping({
            type: 'typing',
            data: { scope: 'dm:r1', userId: 'alice', startedAt: 1_234_567 },
        });
        expect(out?.kind).toBe('typing');
        if (out?.kind === 'typing') {
            expect(out.payload).toEqual({
                scope: 'dm:r1',
                userId: 'alice',
                startedAt: 1_234_567,
            });
        }
    });
});

describe('exports', () => {
    it('exposes presence/typing TTL constants matching backend', () => {
        // These mirror PRESENCE_TTL_MS / TYPING_TTL_MS on the server.
        expect(PRESENCE_STALE_MS).toBe(30_000);
        expect(TYPING_DECAY_MS).toBe(5_000);
    });

    it('exposes the typing-ping throttle as a constant', () => {
        expect(TYPING_PING_THROTTLE_MS).toBe(3_000);
    });
});
