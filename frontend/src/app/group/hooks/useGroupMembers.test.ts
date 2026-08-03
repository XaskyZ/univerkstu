import { describe, it, expect } from 'vitest';
import { dedupeMembers } from './useGroupMembers';
import type { GroupMemberView } from '@/lib/api';

const member = (overrides: Partial<GroupMemberView>): GroupMemberView => ({
    userId: 'u1',
    fullName: null,
    source: 'manual',
    joinedAt: '2026-01-01T00:00:00Z',
    roles: [],
    canBeRemovedManually: true,
    ...overrides,
});

describe('dedupeMembers', () => {
    // De-duplicates the group-members list when the same userId appears multiple times
    // (e.g., a member who was auto-detected from Platonus AND manually added). The
    // merge resolves each field with a specific rule that preserves the most useful
    // value across duplicates. A regression here corrupts the members tab display.

    it('returns empty array for empty input', () => {
        expect(dedupeMembers([])).toEqual([]);
    });

    it('passes unique members through (sorted by name)', () => {
        const a = member({ userId: 'a', fullName: 'Анна' });
        const b = member({ userId: 'b', fullName: 'Борис' });
        expect(dedupeMembers([b, a]).map((m) => m.userId)).toEqual(['a', 'b']);
    });

    it('deduplicates members by userId (keeps single entry)', () => {
        const result = dedupeMembers([
            member({ userId: 'x', fullName: 'A' }),
            member({ userId: 'x', fullName: 'A' }),
        ]);
        expect(result).toHaveLength(1);
    });

    it('merges fullName: existing wins if set (filled value preferred)', () => {
        const result = dedupeMembers([
            member({ userId: 'x', fullName: 'Иванов И.' }),
            member({ userId: 'x', fullName: 'Different Name' }),
        ]);
        expect(result[0].fullName).toBe('Иванов И.');
    });

    it('merges fullName: empty existing falls back to incoming', () => {
        const result = dedupeMembers([
            member({ userId: 'x', fullName: null }),
            member({ userId: 'x', fullName: 'Иванов И.' }),
        ]);
        expect(result[0].fullName).toBe('Иванов И.');
    });

    it('merges source: platonus_auto wins when it appears on EITHER side', () => {
        // Platonus is the source of truth for university enrollment. If a member is
        // auto-detected by Platonus, that takes precedence over manual entries —
        // they're an "official" group member.
        // Forward direction: manual existing + platonus_auto incoming → platonus_auto.
        const forward = dedupeMembers([
            member({ userId: 'x', source: 'manual' }),
            member({ userId: 'x', source: 'platonus_auto' }),
        ]);
        expect(forward[0].source).toBe('platonus_auto');

        // Reverse direction: platonus_auto existing + manual incoming → still platonus_auto.
        const reverse = dedupeMembers([
            member({ userId: 'x', source: 'platonus_auto' }),
            member({ userId: 'x', source: 'manual' }),
        ]);
        expect(reverse[0].source).toBe('platonus_auto');
    });

    it('merges source: keeps existing when both sides are non-platonus_auto', () => {
        // When neither side is platonus_auto, the first-seen source is preserved.
        // (Documents stability — order of arrival shouldn't flip the source for
        // two manual entries.)
        const result = dedupeMembers([
            member({ userId: 'x', source: 'manual' }),
            member({ userId: 'x', source: 'join_request' }),
        ]);
        expect(result[0].source).toBe('manual');
    });

    it('merges joinedAt: keeps the EARLIEST join date', () => {
        // The "earliest" rule preserves the longest-tenure timestamp. A regression
        // that flipped to "latest" would silently reset everyone's tenure to "today"
        // when Platonus re-syncs.
        const result = dedupeMembers([
            member({ userId: 'x', joinedAt: '2026-05-10T00:00:00Z' }),
            member({ userId: 'x', joinedAt: '2025-09-01T00:00:00Z' }),
        ]);
        expect(result[0].joinedAt).toBe('2025-09-01T00:00:00Z');
    });

    it('merges canBeRemovedManually: AND (only removable if BOTH say so)', () => {
        // Safest default: if any source says the member can't be manually removed
        // (e.g., they're a Platonus-detected official member), the final state is
        // "cannot remove". Defense against admins accidentally removing official members.
        const result = dedupeMembers([
            member({ userId: 'x', canBeRemovedManually: true }),
            member({ userId: 'x', canBeRemovedManually: false }),
        ]);
        expect(result[0].canBeRemovedManually).toBe(false);
    });

    it('merges roles: union (all roles from both occurrences preserved)', () => {
        const result = dedupeMembers([
            member({ userId: 'x', roles: ['starosta'] }),
            member({ userId: 'x', roles: ['helper'] }),
        ]);
        expect(result[0].roles.sort()).toEqual(['helper', 'starosta']);
    });

    it('dedupes roles within single member (Array.from(new Set))', () => {
        // A single member with `roles: ['starosta', 'starosta']` should be cleaned.
        const result = dedupeMembers([
            member({ userId: 'x', roles: ['starosta', 'starosta', 'helper'] }),
        ]);
        expect(result[0].roles.sort()).toEqual(['helper', 'starosta']);
    });

    it('dedupes roles across the union (no duplicates after merge)', () => {
        const result = dedupeMembers([
            member({ userId: 'x', roles: ['starosta'] }),
            member({ userId: 'x', roles: ['starosta'] }),
        ]);
        expect(result[0].roles).toEqual(['starosta']);
    });

    it('sorts output by "${fullName} ${userId}" in Russian locale', () => {
        // Russian alphabet has different ordering than Latin (e.g., Ё after Е).
        // The sort uses `localeCompare(..., 'ru')` — locks that contract.
        const result = dedupeMembers([
            member({ userId: 'c', fullName: 'Виктор' }),
            member({ userId: 'a', fullName: 'Анна' }),
            member({ userId: 'b', fullName: 'Борис' }),
        ]);
        expect(result.map((m) => m.fullName)).toEqual(['Анна', 'Борис', 'Виктор']);
    });

    it('sorts by userId when fullName is null (consistent fallback)', () => {
        const result = dedupeMembers([
            member({ userId: 'c', fullName: null }),
            member({ userId: 'a', fullName: null }),
        ]);
        expect(result.map((m) => m.userId)).toEqual(['a', 'c']);
    });
});
