import { describe, it, expect } from 'vitest';
import {
    formatDateTime,
    clipText,
    formatPersonalChatName,
    buildDirectRoomId,
    dedupeRecommendedFriends,
} from './helpers';
import type { FriendOverview, FriendRecommendationView } from '@/lib/api';

const recommended = (userId: string, label = 'X'): FriendRecommendationView => ({
    userId,
    label,
    groupKey: null,
    reason: 'same_group',
});

describe('formatDateTime', () => {
    it('formats a date string with the given locale (DD.MM HH:MM, 2-digit)', () => {
        // RU locale: DD.MM, HH:MM — note we don't assert the exact separator since Intl impl varies,
        // but we do assert all four numeric parts appear.
        const formatted = formatDateTime('2026-05-13T10:05:00Z', 'ru-RU');
        // At least each numeric part should appear somewhere in the output.
        expect(formatted).toMatch(/\d{2}/);
        expect(formatted.split(/[^\d]+/).filter(Boolean)).toHaveLength(4);
    });
});

describe('clipText', () => {
    it('returns empty string for null/undefined/empty input', () => {
        expect(clipText(null)).toBe('');
        expect(clipText(undefined)).toBe('');
        expect(clipText('')).toBe('');
    });

    it('collapses whitespace and trims', () => {
        expect(clipText('  hello\n  world\t')).toBe('hello world');
    });

    it('does not clip when under limit', () => {
        expect(clipText('hello', 84)).toBe('hello');
    });

    it('clips with ellipsis when over the default limit (84)', () => {
        const long = 'a'.repeat(100);
        const result = clipText(long);
        expect(result).toHaveLength(84);
        expect(result.endsWith('…')).toBe(true);
        expect(result.slice(0, 83)).toBe('a'.repeat(83));
    });

    it('honors a custom limit', () => {
        expect(clipText('abcdefghij', 5)).toBe('abcd…'); // 4 chars + ellipsis = 5
        expect(clipText('abc', 5)).toBe('abc'); // shorter than limit
    });
});

describe('formatPersonalChatName', () => {
    it('shortens a full person name to surname and initials', () => {
        expect(formatPersonalChatName('Шайхиев Жиханшах Турарович')).toBe('Шайхиев Ж. Т.');
        expect(formatPersonalChatName('Рыбин Павел Алексеевич')).toBe('Рыбин П. А.');
    });

    it('keeps nicknames, single names, ids and already-short names unchanged', () => {
        expect(formatPersonalChatName('Мейрам')).toBe('Мейрам');
        expect(formatPersonalChatName('demo-student')).toBe('demo-student');
        expect(formatPersonalChatName('24-2')).toBe('24-2');
        expect(formatPersonalChatName('Рыбин П. А.')).toBe('Рыбин П. А.');
    });
});

describe('buildDirectRoomId', () => {
    it('produces the same id regardless of argument order', () => {
        expect(buildDirectRoomId('alice', 'bob')).toBe(buildDirectRoomId('bob', 'alice'));
    });

    it('formats as `direct:<low>::<high>` lexicographically sorted', () => {
        expect(buildDirectRoomId('alice', 'bob')).toBe('direct:alice::bob');
        expect(buildDirectRoomId('zoe', 'alice')).toBe('direct:alice::zoe');
    });

    it('trims whitespace from both inputs before sorting', () => {
        expect(buildDirectRoomId('  alice  ', '\tbob\n')).toBe('direct:alice::bob');
    });

    it('uses locale-aware sort for non-ASCII', () => {
        // Cyrillic А (U+0410) vs Latin A (U+0041) — collation may differ from codepoint order.
        // Just verify the function returns a stable, swap-invariant value.
        const a = buildDirectRoomId('Аня', 'Boris');
        const b = buildDirectRoomId('Boris', 'Аня');
        expect(a).toBe(b);
        expect(a.startsWith('direct:')).toBe(true);
    });
});

describe('dedupeRecommendedFriends', () => {
    const base: FriendOverview = {
        friends: [],
        incoming: [],
        outgoing: [],
        recommended: [],
    };

    it('returns the same object reference when no duplicates', () => {
        const overview: FriendOverview = { ...base, recommended: [recommended('u1'), recommended('u2')] };
        expect(dedupeRecommendedFriends(overview)).toBe(overview);
    });

    it('drops duplicates by userId (case-insensitive, whitespace-trimmed)', () => {
        const overview: FriendOverview = {
            ...base,
            recommended: [recommended('User1'), recommended(' user1 '), recommended('u2')],
        };
        const result = dedupeRecommendedFriends(overview);
        expect(result).not.toBe(overview);
        expect(result.recommended).toHaveLength(2);
        expect(result.recommended.map((r) => r.userId)).toEqual(['User1', 'u2']);
    });

    it('drops entries with empty/whitespace-only userId', () => {
        const overview: FriendOverview = {
            ...base,
            recommended: [recommended(''), recommended('  '), recommended('u1')],
        };
        expect(dedupeRecommendedFriends(overview).recommended).toEqual([recommended('u1')]);
    });

    it('preserves the other overview fields when filtering', () => {
        const overview: FriendOverview = {
            friends: [{ userId: 'f1' } as FriendOverview['friends'][number]],
            incoming: [],
            outgoing: [],
            recommended: [recommended('u1'), recommended('u1')],
        };
        const result = dedupeRecommendedFriends(overview);
        expect(result.friends).toBe(overview.friends);
    });
});
