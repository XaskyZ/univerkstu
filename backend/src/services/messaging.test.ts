import { describe, it, expect } from 'vitest';
import {
    getChatMessageMaxLength,
    buildDirectRoomId,
    normalizeMultiLineText,
    clampMessageLimit,
    parseDirectRoomId,
    normalizeDirectPair,
    normalizeDirectMessagePrivacy,
    dedupeFriendRecommendations,
} from './messaging.js';

describe('getChatMessageMaxLength', () => {
    it('returns the module constant', () => {
        // The constant is `MAX_CHAT_MESSAGE_LENGTH = 2000` per the source. This guards
        // against accidentally changing it without thinking about the routes/UI that
        // depend on this exact value for client-side caps.
        expect(getChatMessageMaxLength()).toBe(2000);
    });

    it('is a positive integer', () => {
        const max = getChatMessageMaxLength();
        expect(Number.isInteger(max)).toBe(true);
        expect(max).toBeGreaterThan(0);
    });
});

describe('buildDirectRoomId', () => {
    it('is symmetric: order of arguments does not matter', () => {
        expect(buildDirectRoomId('alice', 'bob')).toBe(buildDirectRoomId('bob', 'alice'));
    });

    it('produces "direct:<low>::<high>" with lexicographically sorted pair', () => {
        expect(buildDirectRoomId('alice', 'bob')).toBe('direct:alice::bob');
        expect(buildDirectRoomId('zoe', 'alice')).toBe('direct:alice::zoe');
    });

    it('trims whitespace from both inputs before sorting', () => {
        expect(buildDirectRoomId('  alice  ', '\tbob\n')).toBe('direct:alice::bob');
    });

    it('handles non-ASCII identifiers without crashing and stays swap-invariant', () => {
        const a = buildDirectRoomId('Аня', 'Boris');
        const b = buildDirectRoomId('Boris', 'Аня');
        expect(a).toBe(b);
        expect(a.startsWith('direct:')).toBe(true);
    });

    it('two identical users still produce a deterministic room id', () => {
        expect(buildDirectRoomId('same', 'same')).toBe('direct:same::same');
    });
});

describe('normalizeMultiLineText', () => {
    it('normalizes CRLF to LF', () => {
        expect(normalizeMultiLineText('first\r\nsecond')).toBe('first\nsecond');
    });

    it('strips trailing whitespace from each line', () => {
        expect(normalizeMultiLineText('first   \nsecond\t\nthird   ')).toBe('first\nsecond\nthird');
    });

    it('trims leading + trailing whitespace from the whole result', () => {
        expect(normalizeMultiLineText('\n\n  hello  \n\n')).toBe('hello');
    });

    it('preserves intentional blank lines between paragraphs', () => {
        // Blank lines in the middle should survive — only outer trim removes them.
        expect(normalizeMultiLineText('para1\n\npara2')).toBe('para1\n\npara2');
    });

    it('handles mixed CRLF + trailing spaces + outer padding', () => {
        expect(normalizeMultiLineText('\r\n  hi   \r\n  there  \r\n')).toBe('hi\n  there');
    });

    it('empty input → empty string', () => {
        expect(normalizeMultiLineText('')).toBe('');
        expect(normalizeMultiLineText('   ')).toBe('');
    });
});

describe('clampMessageLimit', () => {
    it('returns default when limit is undefined', () => {
        expect(clampMessageLimit(undefined)).toBe(80); // DEFAULT_CHAT_MESSAGE_LIMIT
    });

    it('returns default when limit is NaN', () => {
        expect(clampMessageLimit(NaN)).toBe(80);
    });

    it('returns default when limit is Infinity / -Infinity', () => {
        expect(clampMessageLimit(Infinity)).toBe(80);
        expect(clampMessageLimit(-Infinity)).toBe(80);
    });

    it('clamps to [1, MAX] range', () => {
        expect(clampMessageLimit(0)).toBe(1);
        expect(clampMessageLimit(-5)).toBe(1);
        expect(clampMessageLimit(200)).toBe(150); // MAX_CHAT_MESSAGE_LIMIT
        expect(clampMessageLimit(1_000_000)).toBe(150);
    });

    it('truncates fractional values toward zero', () => {
        expect(clampMessageLimit(42.9)).toBe(42);
        expect(clampMessageLimit(1.5)).toBe(1);
    });

    it('passes through valid values', () => {
        expect(clampMessageLimit(1)).toBe(1);
        expect(clampMessageLimit(50)).toBe(50);
        expect(clampMessageLimit(150)).toBe(150);
    });
});

describe('normalizeDirectPair', () => {
    // The internal helper underneath buildDirectRoomId. Sorts the user pair
    // lexicographically so (a,b) and (b,a) yield the same canonical pair.

    it('sorts lexicographically (low, high)', () => {
        expect(normalizeDirectPair('bob', 'alice')).toEqual(['alice', 'bob']);
        expect(normalizeDirectPair('alice', 'bob')).toEqual(['alice', 'bob']);
    });

    it('trims both inputs before sorting', () => {
        expect(normalizeDirectPair('  bob ', '  alice ')).toEqual(['alice', 'bob']);
    });

    it('identical users still produce a deterministic pair', () => {
        expect(normalizeDirectPair('x', 'x')).toEqual(['x', 'x']);
    });

    it('Cyrillic handled via locale-aware compare', () => {
        const pair = normalizeDirectPair('Боб', 'Алиса');
        expect(pair[0] < pair[1]).toBe(true);
    });
});

describe('parseDirectRoomId', () => {
    // Inverse of buildDirectRoomId. Used to decode room subscriptions on the wire.

    it('parses a valid direct room id', () => {
        expect(parseDirectRoomId('direct:alice::bob')).toEqual({ low: 'alice', high: 'bob' });
    });

    it('round-trips through buildDirectRoomId', () => {
        const id = buildDirectRoomId('bob', 'alice');
        expect(parseDirectRoomId(id)).toEqual({ low: 'alice', high: 'bob' });
    });

    it('returns null when prefix is missing', () => {
        expect(parseDirectRoomId('alice::bob')).toBe(null);
        expect(parseDirectRoomId('group:KEY')).toBe(null);
    });

    it('returns null when "::" separator is missing', () => {
        expect(parseDirectRoomId('direct:alice')).toBe(null);
        expect(parseDirectRoomId('direct:')).toBe(null);
    });

    it('returns null when either side is empty', () => {
        expect(parseDirectRoomId('direct:::bob')).toBe(null); // empty low
        expect(parseDirectRoomId('direct:alice::')).toBe(null); // empty high
    });
});

describe('normalizeDirectMessagePrivacy', () => {
    // Strict whitelist parser. Only 'friends_only' is recognized; everything else
    // defaults to 'open' (the safe-er default — unknown values don't accidentally
    // lock users out of receiving DMs).

    it('passes through valid friends_only', () => {
        expect(normalizeDirectMessagePrivacy('friends_only')).toBe('friends_only');
    });

    it('passes through valid open', () => {
        expect(normalizeDirectMessagePrivacy('open')).toBe('open');
    });

    it('defaults to open for unknown values', () => {
        expect(normalizeDirectMessagePrivacy('Friends_Only')).toBe('open'); // case-sensitive
        expect(normalizeDirectMessagePrivacy('strict')).toBe('open');
        expect(normalizeDirectMessagePrivacy('')).toBe('open');
        expect(normalizeDirectMessagePrivacy(null)).toBe('open');
        expect(normalizeDirectMessagePrivacy(undefined)).toBe('open');
        expect(normalizeDirectMessagePrivacy(42)).toBe('open');
    });
});

describe('dedupeFriendRecommendations', () => {
    // Strips duplicate users from the recommendation feed (case + whitespace insensitive).
    // Drops entries with empty userId (defense against malformed DB rows).

    const rec = (userId: string, extra: Record<string, unknown> = {}) => ({
        userId,
        label: 'User',
        ...extra,
    } as Parameters<typeof dedupeFriendRecommendations>[0][number]);

    it('returns empty array for empty input', () => {
        expect(dedupeFriendRecommendations([])).toEqual([]);
    });

    it('passes through unique entries', () => {
        const input = [rec('a'), rec('b'), rec('c')];
        expect(dedupeFriendRecommendations(input)).toHaveLength(3);
    });

    it('dedupes case-insensitively', () => {
        const input = [rec('alice'), rec('ALICE'), rec('Alice')];
        const result = dedupeFriendRecommendations(input);
        expect(result).toHaveLength(1);
        expect(result[0].userId).toBe('alice');
    });

    it('dedupes whitespace-insensitively (trim before key)', () => {
        const input = [rec('  alice  '), rec('alice')];
        expect(dedupeFriendRecommendations(input)).toHaveLength(1);
    });

    it('drops entries with empty or whitespace-only userId', () => {
        const input = [rec('a'), rec(''), rec('   '), rec('b')];
        const result = dedupeFriendRecommendations(input);
        expect(result.map((r) => r.userId)).toEqual(['a', 'b']);
    });

    it('preserves first-occurrence ordering', () => {
        const input = [rec('c'), rec('a'), rec('b'), rec('A')];
        // 'A' is a dupe of 'a' (which appeared second).
        const result = dedupeFriendRecommendations(input);
        expect(result.map((r) => r.userId)).toEqual(['c', 'a', 'b']);
    });
});
