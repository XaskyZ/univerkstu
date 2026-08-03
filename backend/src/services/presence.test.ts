/**
 * Unit tests for the in-memory presence + typing store.
 *
 * Every test resets the module-scope `Map`s before running so cases stay
 * isolated. Real wall-clock time is not used — most cases pass an explicit
 * `now` to the helpers; the few that don't rely on `vi.useFakeTimers()` so
 * TTL expiration is deterministic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    PRESENCE_TTL_MS,
    TYPING_TTL_MS,
    __resetPresenceStateForTests,
    clearTyping,
    getPresentUserIds,
    getTypingUserIds,
    markTyping,
    markUserPresent,
    presenceMap,
    removeUserPresence,
    sweepExpired,
    typingMap,
} from './presence.js';

beforeEach(() => {
    __resetPresenceStateForTests();
});

afterEach(() => {
    vi.useRealTimers();
});

// ============================================================================
// markUserPresent
// ============================================================================

describe('markUserPresent', () => {
    it('creates a new presence entry and returns all incoming scopes', () => {
        const changed = markUserPresent('alice', ['group:a', 'dm:r1']);
        expect(changed.sort()).toEqual(['dm:r1', 'group:a']);
        expect(presenceMap.get('alice')?.scopes).toEqual(new Set(['group:a', 'dm:r1']));
    });

    it('returns [] for empty userId', () => {
        expect(markUserPresent('', ['group:a'])).toEqual([]);
        expect(presenceMap.size).toBe(0);
    });

    it('refreshes lastSeenAt on subsequent calls', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        markUserPresent('alice', ['group:a']);
        const first = presenceMap.get('alice')?.lastSeenAt;

        vi.setSystemTime(new Date('2026-01-01T00:00:05Z'));
        markUserPresent('alice', ['group:a']);
        const second = presenceMap.get('alice')?.lastSeenAt;

        expect(second).toBeGreaterThan(first!);
    });

    it('returns empty change set when scopes are unchanged', () => {
        markUserPresent('alice', ['group:a', 'dm:r1']);
        const changed = markUserPresent('alice', ['group:a', 'dm:r1']);
        expect(changed).toEqual([]);
    });

    it('returns symmetric diff when scopes change', () => {
        markUserPresent('alice', ['group:a', 'dm:r1']);
        const changed = markUserPresent('alice', ['group:a', 'group:b']).sort();
        // group:b is added, dm:r1 is removed
        expect(changed).toEqual(['dm:r1', 'group:b']);
    });

    it('drops non-string or empty scopes', () => {
        markUserPresent('alice', ['group:a', '', 'group:b']);
        expect(presenceMap.get('alice')?.scopes).toEqual(new Set(['group:a', 'group:b']));
    });
});

// ============================================================================
// removeUserPresence
// ============================================================================

describe('removeUserPresence', () => {
    it('returns [] when user is not present', () => {
        expect(removeUserPresence('nobody')).toEqual([]);
    });

    it('removes the entry and returns the scope list', () => {
        markUserPresent('alice', ['group:a', 'dm:r1']);
        const dropped = removeUserPresence('alice').sort();
        expect(dropped).toEqual(['dm:r1', 'group:a']);
        expect(presenceMap.has('alice')).toBe(false);
    });
});

// ============================================================================
// getPresentUserIds + TTL filtering
// ============================================================================

describe('getPresentUserIds', () => {
    it('returns [] for an empty scope', () => {
        expect(getPresentUserIds('group:unknown')).toEqual([]);
    });

    it('returns only users whose scope set contains the query', () => {
        markUserPresent('alice', ['group:a']);
        markUserPresent('bob', ['group:b']);
        markUserPresent('carol', ['group:a', 'group:b']);
        expect(getPresentUserIds('group:a').sort()).toEqual(['alice', 'carol']);
        expect(getPresentUserIds('group:b').sort()).toEqual(['bob', 'carol']);
    });

    it('excludes users whose lastSeenAt exceeded PRESENCE_TTL_MS', () => {
        const now = 10_000_000;
        // Drop alice manually with stale timestamp
        markUserPresent('alice', ['group:a']);
        const aliceState = presenceMap.get('alice')!;
        aliceState.lastSeenAt = now - PRESENCE_TTL_MS - 1;
        // bob with fresh timestamp
        markUserPresent('bob', ['group:a']);
        const bobState = presenceMap.get('bob')!;
        bobState.lastSeenAt = now - 1;

        expect(getPresentUserIds('group:a', now)).toEqual(['bob']);
    });

    it('returns user exactly at TTL boundary as expired (strict greater-than check)', () => {
        const now = 10_000_000;
        markUserPresent('alice', ['group:a']);
        presenceMap.get('alice')!.lastSeenAt = now - PRESENCE_TTL_MS;
        expect(getPresentUserIds('group:a', now)).toEqual([]);
    });
});

// ============================================================================
// markTyping + getTypingUserIds + clearTyping
// ============================================================================

describe('markTyping', () => {
    it('records a typing entry under `${scope}|${userId}`', () => {
        markTyping('alice', 'dm:r1');
        expect(typingMap.has('dm:r1|alice')).toBe(true);
    });

    it('ignores empty userId or scope', () => {
        markTyping('', 'dm:r1');
        markTyping('alice', '');
        expect(typingMap.size).toBe(0);
    });

    it('refreshes startedAt on subsequent calls', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        markTyping('alice', 'dm:r1');
        const first = typingMap.get('dm:r1|alice')!.startedAt;

        vi.setSystemTime(new Date('2026-01-01T00:00:02Z'));
        markTyping('alice', 'dm:r1');
        const second = typingMap.get('dm:r1|alice')!.startedAt;

        expect(second).toBeGreaterThan(first);
    });
});

describe('getTypingUserIds', () => {
    it('returns users typing in the requested scope, filtered by TTL', () => {
        const now = 10_000_000;
        markTyping('alice', 'dm:r1');
        markTyping('bob', 'dm:r1');
        markTyping('carol', 'dm:r2');

        // Force alice's typing to be stale by mutating the underlying map.
        typingMap.get('dm:r1|alice')!.startedAt = now - TYPING_TTL_MS - 1;
        typingMap.get('dm:r1|bob')!.startedAt = now - 1;
        typingMap.get('dm:r2|carol')!.startedAt = now - 1;

        expect(getTypingUserIds('dm:r1', now)).toEqual(['bob']);
        expect(getTypingUserIds('dm:r2', now)).toEqual(['carol']);
    });

    it('does not bleed across scopes that share a prefix', () => {
        // `dm:r1` vs `dm:r11` — naive prefix matching would conflate the two.
        // The key is `${scope}|${userId}`, so the pipe separator prevents it.
        markTyping('alice', 'dm:r1');
        markTyping('bob', 'dm:r11');
        expect(getTypingUserIds('dm:r1')).toEqual(['alice']);
        expect(getTypingUserIds('dm:r11')).toEqual(['bob']);
    });

    it('returns [] when no one is typing', () => {
        expect(getTypingUserIds('dm:empty')).toEqual([]);
    });
});

describe('clearTyping', () => {
    it('removes a single typing entry', () => {
        markTyping('alice', 'dm:r1');
        clearTyping('alice', 'dm:r1');
        expect(typingMap.has('dm:r1|alice')).toBe(false);
    });

    it('is a no-op when the entry does not exist', () => {
        expect(() => clearTyping('nobody', 'dm:r1')).not.toThrow();
    });
});

// ============================================================================
// sweepExpired
// ============================================================================

describe('sweepExpired', () => {
    it('removes expired presence entries and reports affected scopes', () => {
        const now = 10_000_000;
        markUserPresent('alice', ['group:a']);
        markUserPresent('bob', ['group:b']);
        presenceMap.get('alice')!.lastSeenAt = now - PRESENCE_TTL_MS - 1;
        presenceMap.get('bob')!.lastSeenAt = now - 1;

        const result = sweepExpired(now);
        expect(result.presenceScopesChanged).toEqual(['group:a']);
        expect(presenceMap.has('alice')).toBe(false);
        expect(presenceMap.has('bob')).toBe(true);
    });

    it('removes expired typing entries silently', () => {
        const now = 10_000_000;
        markTyping('alice', 'dm:r1');
        typingMap.get('dm:r1|alice')!.startedAt = now - TYPING_TTL_MS - 1;
        markTyping('bob', 'dm:r1');
        typingMap.get('dm:r1|bob')!.startedAt = now - 1;

        const result = sweepExpired(now);
        expect(typingMap.has('dm:r1|alice')).toBe(false);
        expect(typingMap.has('dm:r1|bob')).toBe(true);
        // typing changes are not surfaced in the return value
        expect(result.presenceScopesChanged).toEqual([]);
    });

    it('returns a deduplicated scope list when multiple users in the same scope expire', () => {
        const now = 10_000_000;
        markUserPresent('alice', ['group:a']);
        markUserPresent('bob', ['group:a']);
        presenceMap.get('alice')!.lastSeenAt = now - PRESENCE_TTL_MS - 1;
        presenceMap.get('bob')!.lastSeenAt = now - PRESENCE_TTL_MS - 1;

        const result = sweepExpired(now);
        expect(result.presenceScopesChanged).toEqual(['group:a']);
    });

    it('is a no-op when everything is fresh', () => {
        const now = 10_000_000;
        markUserPresent('alice', ['group:a']);
        presenceMap.get('alice')!.lastSeenAt = now - 1;
        markTyping('alice', 'dm:r1');
        typingMap.get('dm:r1|alice')!.startedAt = now - 1;

        const result = sweepExpired(now);
        expect(result.presenceScopesChanged).toEqual([]);
        expect(presenceMap.has('alice')).toBe(true);
        expect(typingMap.has('dm:r1|alice')).toBe(true);
    });
});
