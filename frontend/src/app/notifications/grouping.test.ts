/**
 * Pure-helper tests for the Notification Center grouping logic.
 *
 * Covers:
 *  - bucketing semantics (by (kind, sourceEntityId))
 *  - child + group sort ordering
 *  - unread / actor accumulator correctness
 *  - input hardening (null / undefined / malformed rows)
 *  - Russian plural form helper
 *  - `collectUnreadIds` selector
 */
import { describe, it, expect } from 'vitest';
import type { SocialNotification } from '@/lib/api/social';
import {
    NOTIFICATION_GROUP_ACTOR_DISPLAY_CAP,
    collectUnreadIds,
    groupNotifications,
    pluralForms,
    pluralRu,
} from './grouping';

function makeNotification(overrides: Partial<SocialNotification> = {}): SocialNotification {
    return {
        id: overrides.id ?? 'n1',
        kind: overrides.kind ?? 'mention',
        sourceKind: overrides.sourceKind ?? 'entity',
        sourceEntityId: overrides.sourceEntityId ?? 'entity-A',
        entityId: overrides.entityId ?? 'entity-A',
        actorUserId: overrides.actorUserId ?? 'actor-1',
        summary: overrides.summary ?? '',
        scopeType: overrides.scopeType ?? 'group',
        scopeId: overrides.scopeId ?? 'group:ITS-21',
        entityKind: overrides.entityKind ?? 'post',
        createdAt: overrides.createdAt ?? '2026-05-21T10:00:00.000Z',
        readAt: overrides.readAt ?? null,
    };
}

describe('groupNotifications — bucketing', () => {
    it('returns an empty array for null / undefined / empty input', () => {
        expect(groupNotifications(null)).toEqual([]);
        expect(groupNotifications(undefined)).toEqual([]);
        expect(groupNotifications([])).toEqual([]);
    });

    it('preserves a single notification as a one-child group', () => {
        const groups = groupNotifications([makeNotification({ id: 'n1' })]);
        expect(groups).toHaveLength(1);
        expect(groups[0].notifications).toHaveLength(1);
        expect(groups[0].notifications[0].id).toBe('n1');
        expect(groups[0].keyEntityId).toBe('entity-A');
    });

    it('groups N mentions on the same entity into a single bucket', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'n1', actorUserId: 'actor-1', createdAt: '2026-05-21T10:00:00.000Z' }),
            makeNotification({ id: 'n2', actorUserId: 'actor-2', createdAt: '2026-05-21T10:05:00.000Z' }),
            makeNotification({ id: 'n3', actorUserId: 'actor-3', createdAt: '2026-05-21T10:10:00.000Z' }),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].notifications).toHaveLength(3);
        expect(groups[0].actorUserIds).toEqual(['actor-3', 'actor-2', 'actor-1']);
    });

    it('does not merge across different entities', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'n1', sourceEntityId: 'entity-A' }),
            makeNotification({ id: 'n2', sourceEntityId: 'entity-B' }),
        ]);
        expect(groups).toHaveLength(2);
    });

    it('does not merge across different kinds even on the same entity', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'n1', kind: 'mention', sourceEntityId: 'entity-A' }),
            makeNotification({ id: 'n2', kind: 'comment', sourceEntityId: 'entity-A' }),
        ]);
        expect(groups).toHaveLength(2);
        const keys = groups.map((g) => g.key).sort();
        expect(keys).toEqual(['comment::entity-A', 'mention::entity-A']);
    });

    it('skips malformed rows but keeps the rest', () => {
        const dirty = [
            makeNotification({ id: 'good' }),
            // @ts-expect-error — testing the runtime guard
            null,
            // @ts-expect-error — testing the runtime guard
            { kind: 'mention' }, // missing sourceEntityId / createdAt
            // @ts-expect-error — testing the runtime guard
            { kind: 'mention', sourceEntityId: '', createdAt: '2026-05-21T10:00:00.000Z' },
        ] as SocialNotification[];
        const groups = groupNotifications(dirty);
        expect(groups).toHaveLength(1);
        expect(groups[0].notifications[0].id).toBe('good');
    });
});

describe('groupNotifications — sort ordering', () => {
    it('sorts children inside a group newest-first', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'old', createdAt: '2026-05-21T09:00:00.000Z' }),
            makeNotification({ id: 'new', createdAt: '2026-05-21T11:00:00.000Z' }),
            makeNotification({ id: 'mid', createdAt: '2026-05-21T10:00:00.000Z' }),
        ]);
        expect(groups[0].notifications.map((n) => n.id)).toEqual(['new', 'mid', 'old']);
        expect(groups[0].latestAt).toBe('2026-05-21T11:00:00.000Z');
    });

    it('sorts groups by their latest child desc', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'a1', sourceEntityId: 'A', createdAt: '2026-05-21T08:00:00.000Z' }),
            makeNotification({ id: 'b1', sourceEntityId: 'B', createdAt: '2026-05-21T12:00:00.000Z' }),
            makeNotification({ id: 'c1', sourceEntityId: 'C', createdAt: '2026-05-21T10:00:00.000Z' }),
        ]);
        expect(groups.map((g) => g.keyEntityId)).toEqual(['B', 'C', 'A']);
    });

    it('breaks tied latestAt by composite key for determinism', () => {
        const ts = '2026-05-21T10:00:00.000Z';
        const groups = groupNotifications([
            makeNotification({ id: 'b1', sourceEntityId: 'B', createdAt: ts }),
            makeNotification({ id: 'a1', sourceEntityId: 'A', createdAt: ts }),
        ]);
        expect(groups.map((g) => g.keyEntityId)).toEqual(['A', 'B']);
    });
});

describe('groupNotifications — derived fields', () => {
    it('counts only unread children towards unreadCount', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'n1', readAt: null }),
            makeNotification({ id: 'n2', readAt: '2026-05-21T10:30:00.000Z' }),
            makeNotification({ id: 'n3', readAt: null }),
        ]);
        expect(groups[0].unreadCount).toBe(2);
    });

    it('deduplicates actors and preserves most-recent-first ordering', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'n1', actorUserId: 'alice', createdAt: '2026-05-21T10:00:00.000Z' }),
            makeNotification({ id: 'n2', actorUserId: 'bob', createdAt: '2026-05-21T10:05:00.000Z' }),
            makeNotification({ id: 'n3', actorUserId: 'alice', createdAt: '2026-05-21T10:10:00.000Z' }),
            makeNotification({ id: 'n4', actorUserId: 'carol', createdAt: '2026-05-21T10:15:00.000Z' }),
        ]);
        expect(groups[0].actorUserIds).toEqual(['carol', 'alice', 'bob']);
    });

    it('picks the first non-empty summary as entitySummary', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'n1', summary: '', createdAt: '2026-05-21T10:10:00.000Z' }),
            makeNotification({ id: 'n2', summary: 'Hello world', createdAt: '2026-05-21T10:05:00.000Z' }),
            makeNotification({ id: 'n3', summary: 'Older summary', createdAt: '2026-05-21T10:00:00.000Z' }),
        ]);
        // Newest is the empty one — picker should skip blanks and use the
        // next non-empty child (which after desc sort is n2).
        expect(groups[0].entitySummary).toBe('Hello world');
    });

    it('falls back to empty entitySummary when no child has one', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'n1', summary: '' }),
            makeNotification({ id: 'n2', summary: '   ' }),
        ]);
        expect(groups[0].entitySummary).toBe('');
    });

    it('exposes a stable composite `key` per bucket', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'n1', kind: 'comment', sourceEntityId: 'entity-X' }),
        ]);
        expect(groups[0].key).toBe('comment::entity-X');
    });

    it('caps respect the actor display cap constant (5 actors -> 5 ids stored)', () => {
        // The cap is for *display* — the helper itself still returns every
        // unique actor so the UI can compute "+ N more" downstream.
        const notes = ['a', 'b', 'c', 'd', 'e'].map((actor, i) =>
            makeNotification({
                id: `n-${i}`,
                actorUserId: actor,
                createdAt: `2026-05-21T10:0${i}:00.000Z`,
            }),
        );
        const groups = groupNotifications(notes);
        expect(groups[0].actorUserIds).toHaveLength(5);
        expect(NOTIFICATION_GROUP_ACTOR_DISPLAY_CAP).toBeGreaterThan(0);
        expect(NOTIFICATION_GROUP_ACTOR_DISPLAY_CAP).toBeLessThan(5);
    });
});

describe('pluralRu', () => {
    it('returns "one" for 1, 21, 101', () => {
        expect(pluralRu(1, 'упоминание', 'упоминания', 'упоминаний')).toBe('упоминание');
        expect(pluralRu(21, 'упоминание', 'упоминания', 'упоминаний')).toBe('упоминание');
        expect(pluralRu(101, 'упоминание', 'упоминания', 'упоминаний')).toBe('упоминание');
    });

    it('returns "few" for 2-4, 22-24', () => {
        expect(pluralRu(2, 'упоминание', 'упоминания', 'упоминаний')).toBe('упоминания');
        expect(pluralRu(3, 'упоминание', 'упоминания', 'упоминаний')).toBe('упоминания');
        expect(pluralRu(24, 'упоминание', 'упоминания', 'упоминаний')).toBe('упоминания');
    });

    it('returns "many" for 0, 5-20, 25-30, etc.', () => {
        expect(pluralRu(0, 'one', 'few', 'many')).toBe('many');
        expect(pluralRu(5, 'one', 'few', 'many')).toBe('many');
        expect(pluralRu(11, 'one', 'few', 'many')).toBe('many');
        expect(pluralRu(14, 'one', 'few', 'many')).toBe('many');
        expect(pluralRu(25, 'one', 'few', 'many')).toBe('many');
    });
});

describe('pluralForms', () => {
    it('routes 3-tuple inputs through the ru plural rule', () => {
        const forms = ['упоминание', 'упоминания', 'упоминаний'] as const;
        expect(pluralForms(1, forms)).toBe('упоминание');
        expect(pluralForms(3, forms)).toBe('упоминания');
        expect(pluralForms(7, forms)).toBe('упоминаний');
    });

    it('routes 2-tuple inputs through the English-style plural rule', () => {
        const forms = ['mention', 'mentions'] as const;
        expect(pluralForms(1, forms)).toBe('mention');
        expect(pluralForms(0, forms)).toBe('mentions');
        expect(pluralForms(2, forms)).toBe('mentions');
    });

    it('floors decimals and clamps negatives / NaN', () => {
        const forms = ['mention', 'mentions'] as const;
        expect(pluralForms(1.9, forms)).toBe('mention');
        expect(pluralForms(-3, forms)).toBe('mentions');
        expect(pluralForms(Number.NaN, forms)).toBe('mentions');
    });
});

describe('collectUnreadIds', () => {
    it('returns all unread child ids in order', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'a', readAt: null, createdAt: '2026-05-21T10:00:00.000Z' }),
            makeNotification({ id: 'b', readAt: '2026-05-21T10:10:00.000Z', createdAt: '2026-05-21T10:05:00.000Z' }),
            makeNotification({ id: 'c', readAt: null, createdAt: '2026-05-21T10:10:00.000Z' }),
        ]);
        expect(collectUnreadIds(groups[0])).toEqual(['c', 'a']);
    });

    it('returns an empty array when nothing is unread', () => {
        const groups = groupNotifications([
            makeNotification({ id: 'a', readAt: '2026-05-21T10:30:00.000Z' }),
            makeNotification({ id: 'b', readAt: '2026-05-21T10:40:00.000Z' }),
        ]);
        expect(collectUnreadIds(groups[0])).toEqual([]);
    });
});
