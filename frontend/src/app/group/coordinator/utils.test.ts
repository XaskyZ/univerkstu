import { describe, it, expect } from 'vitest';
import {
    sortGroups,
    mergeCoordinatorGroups,
    sortMembers,
    filterMembers,
    matchesGroupSearch,
} from './utils';
import type { GroupSpaceSummary, GroupMemberView, GroupCatalogItem } from '@/lib/api';

const summary = (overrides: Partial<GroupSpaceSummary> = {}): GroupSpaceSummary => ({
    groupKey: 'g1',
    title: 'Group 1',
    slug: 'group-1',
    memberCount: 0,
    starostas: [],
    helpers: [],
    ...overrides,
});

const catalogItem = (overrides: Partial<GroupCatalogItem> = {}): GroupCatalogItem => ({
    groupKey: 'g1',
    title: 'Catalog 1',
    slug: 'catalog-1',
    ...(overrides as object),
} as GroupCatalogItem);

const member = (overrides: Partial<GroupMemberView> = {}): GroupMemberView => ({
    userId: 'u1',
    fullName: null,
    source: 'manual',
    joinedAt: '2026-05-13T10:00:00Z',
    roles: [],
    canBeRemovedManually: true,
    ...overrides,
});

describe('sortGroups', () => {
    it('sorts by memberCount descending', () => {
        const groups = [summary({ groupKey: 'a', memberCount: 5 }), summary({ groupKey: 'b', memberCount: 12 })];
        expect(sortGroups(groups).map((g) => g.groupKey)).toEqual(['b', 'a']);
    });

    it('breaks ties with Russian-locale title ascending', () => {
        const groups = [
            summary({ groupKey: 'a', title: 'Б', memberCount: 5 }),
            summary({ groupKey: 'b', title: 'А', memberCount: 5 }),
        ];
        expect(sortGroups(groups).map((g) => g.groupKey)).toEqual(['b', 'a']);
    });

    it('does not mutate the input array', () => {
        const original = [summary({ memberCount: 1 }), summary({ groupKey: 'g2', memberCount: 5 })];
        const snapshot = original.map((g) => g.groupKey);
        sortGroups(original);
        expect(original.map((g) => g.groupKey)).toEqual(snapshot);
    });

    it('returns a copy (different reference) even when already sorted', () => {
        const original = [summary({ memberCount: 5 })];
        const result = sortGroups(original);
        expect(result).not.toBe(original);
        expect(result).toEqual(original);
    });
});

describe('mergeCoordinatorGroups', () => {
    it('catalog entries become summaries with default member counts', () => {
        const result = mergeCoordinatorGroups(
            [catalogItem({ groupKey: 'g1', title: 'C1', slug: 's1' })],
            [],
        );
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({ groupKey: 'g1', title: 'C1', slug: 's1', memberCount: 0 });
    });

    it('adminGroups override catalog title/slug when provided', () => {
        const result = mergeCoordinatorGroups(
            [catalogItem({ groupKey: 'g1', title: 'Old', slug: 'old' })],
            [summary({ groupKey: 'g1', title: 'New', slug: 'new', memberCount: 5 })],
        );
        expect(result[0]).toMatchObject({ title: 'New', slug: 'new', memberCount: 5 });
    });

    it('falls back to catalog when admin fields are blank', () => {
        const result = mergeCoordinatorGroups(
            [catalogItem({ groupKey: 'g1', title: 'Catalog', slug: 'cat-slug' })],
            [summary({ groupKey: 'g1', title: '', slug: '', memberCount: 5 })],
        );
        expect(result[0]).toMatchObject({ title: 'Catalog', slug: 'cat-slug', memberCount: 5 });
    });

    it('groupKey-only admin entry derives slug from lowercased groupKey when catalog missing', () => {
        const result = mergeCoordinatorGroups(
            [],
            [summary({ groupKey: 'G42-XYZ', title: '', slug: '', memberCount: 3 })],
        );
        expect(result[0].title).toBe('G42-XYZ');
        expect(result[0].slug).toBe('g42-xyz');
    });

    it('preserves starostas/helpers when admin provides them', () => {
        const result = mergeCoordinatorGroups(
            [catalogItem({ groupKey: 'g1' })],
            [summary({ groupKey: 'g1', starostas: ['a'], helpers: ['b'] })],
        );
        expect(result[0].starostas).toEqual(['a']);
        expect(result[0].helpers).toEqual(['b']);
    });

    it('result is sorted via sortGroups (memberCount desc)', () => {
        const result = mergeCoordinatorGroups(
            [catalogItem({ groupKey: 'a' }), catalogItem({ groupKey: 'b' })],
            [summary({ groupKey: 'a', memberCount: 1 }), summary({ groupKey: 'b', memberCount: 7 })],
        );
        expect(result.map((g) => g.groupKey)).toEqual(['b', 'a']);
    });
});

describe('sortMembers', () => {
    it('orders starosta < helper < others, then alphabetical', () => {
        const list = [
            member({ userId: 'u3', fullName: 'Иван', roles: [] }),
            member({ userId: 'u1', fullName: 'Аня', roles: ['helper'] }),
            member({ userId: 'u2', fullName: 'Борис', roles: ['starosta'] }),
            member({ userId: 'u4', fullName: 'Захар', roles: ['helper'] }),
        ];
        expect(sortMembers(list).map((m) => m.userId)).toEqual(['u2', 'u1', 'u4', 'u3']);
    });

    it('falls back to userId when fullName is empty', () => {
        const list = [
            member({ userId: 'b', fullName: '' }),
            member({ userId: 'a', fullName: null }),
        ];
        expect(sortMembers(list).map((m) => m.userId)).toEqual(['a', 'b']);
    });

    it('uses Russian-locale alphabetical sort', () => {
        const list = [
            member({ userId: 'u1', fullName: 'Я' }),
            member({ userId: 'u2', fullName: 'А' }),
            member({ userId: 'u3', fullName: 'М' }),
        ];
        expect(sortMembers(list).map((m) => m.userId)).toEqual(['u2', 'u3', 'u1']);
    });

    it('does not mutate the input array', () => {
        const list = [member({ userId: 'u2', roles: [] }), member({ userId: 'u1', roles: ['starosta'] })];
        const before = list.map((m) => m.userId);
        sortMembers(list);
        expect(list.map((m) => m.userId)).toEqual(before);
    });
});

describe('filterMembers', () => {
    const list = [
        member({ userId: 'u1', fullName: 'Анна Иванова' }),
        member({ userId: 'u2', fullName: 'Иван Петров' }),
        member({ userId: 'shortid', fullName: 'Захар Петрович' }),
    ];

    it('returns the original list when query is empty / whitespace', () => {
        expect(filterMembers(list, '')).toBe(list);
        expect(filterMembers(list, '   ')).toBe(list);
    });

    it('matches by fullName substring case-insensitively', () => {
        expect(filterMembers(list, 'иван').map((m) => m.userId)).toEqual(['u1', 'u2']);
        expect(filterMembers(list, 'ИВАН').map((m) => m.userId)).toEqual(['u1', 'u2']);
    });

    it('matches by userId', () => {
        expect(filterMembers(list, 'shortid').map((m) => m.userId)).toEqual(['shortid']);
    });

    it('returns [] when no match', () => {
        expect(filterMembers(list, 'zzz')).toEqual([]);
    });

    it('handles members with null fullName (uses empty string in haystack)', () => {
        const result = filterMembers(
            [member({ userId: 'has-no-name', fullName: null })],
            'has-no',
        );
        expect(result.map((m) => m.userId)).toEqual(['has-no-name']);
    });
});

describe('matchesGroupSearch', () => {
    const g = summary({ groupKey: 'KSTU-2023', title: 'Информатика', slug: 'info-1' });

    it('returns true on empty/whitespace query (no filter)', () => {
        expect(matchesGroupSearch(g, '')).toBe(true);
        expect(matchesGroupSearch(g, '   ')).toBe(true);
    });

    it('matches title substring', () => {
        expect(matchesGroupSearch(g, 'информ')).toBe(true);
        expect(matchesGroupSearch(g, 'ИНФОРМ')).toBe(true);
    });

    it('matches groupKey substring', () => {
        expect(matchesGroupSearch(g, '2023')).toBe(true);
    });

    it('matches slug substring', () => {
        expect(matchesGroupSearch(g, 'info-1')).toBe(true);
    });

    it('returns false on miss', () => {
        expect(matchesGroupSearch(g, 'математика')).toBe(false);
    });
});

