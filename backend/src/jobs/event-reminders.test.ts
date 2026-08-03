/**
 * Unit tests for the social-event reminders scheduler.
 *
 * Strategy mirrors `services/social-events.test.ts`: an in-memory PG shim
 * (`fakeClient`) that handles the slice of SQL the scheduler issues, plus a
 * `vi.mock`ed delivery primitive so per-recipient send semantics can be
 * asserted without touching the real web-push stack.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SocialEntity } from '../types/social.js';

// VAPID env vars BEFORE imports — push.ts checks them at module load time.
vi.hoisted(() => {
    process.env.VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY
        || 'BDfWBPyXKtLvDXY3sNGB-N7QbN5y2yj5G3RoMHaG5p3PXrA34CgI60dURm05Eh63qg-Ts7YgL5gxBl4OZmrlQYg';
    process.env.VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
        || 'iL66qNlD1q1KhO6Hh5ER_LF6JxhSv2OEt7eDtOcUBek';
    process.env.VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@univerkstu.app';
});

// === In-memory PG store =====================================================

interface EventRow {
    id: string;
    kind: string;
    scope_type: string;
    scope_id: string;
    author_user_id: string;
    payload: Record<string, unknown>;
    pinned: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}

interface MembershipRow {
    user_id: string;
    group_key: string;
    active: boolean;
}

const events: EventRow[] = [];
const memberships: MembershipRow[] = [];

const fakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();

        // fetchUpcomingEvents
        if (text.startsWith('select id, kind, scope_type, scope_id, author_user_id')
            && text.includes('from app_social_entity')) {
            const [nowIso, horizonIso] = params as [string, string];
            const rows = events.filter((e) => {
                if (e.deleted_at) return false;
                if (e.kind !== 'event') return false;
                const startsAt = (e.payload as { startsAt?: string }).startsAt;
                if (!startsAt) return false;
                return startsAt > nowIso && startsAt < horizonIso;
            });
            return { rows, rowCount: rows.length };
        }

        // resolveEventRecipients (group membership)
        if (text.startsWith('select distinct user_id')
            && text.includes('from app_group_memberships')) {
            const [groupKey] = params as [string];
            const rows = memberships
                .filter((m) => m.group_key === groupKey && m.active)
                .map((m) => ({ user_id: m.user_id }));
            return { rows, rowCount: rows.length };
        }

        throw new Error(`Unmocked SQL: ${sql}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: typeof fakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

// === Mock the social delivery primitive ====================================
//
// `deliverPushToUser` already encapsulates the opt-out gate + idempotency +
// subscription fetch + expired cleanup. The scheduler delegates to it, so we
// can drive the per-(user, kind) behavior by overriding this single mock.

const deliverPushToUser = vi.fn(async () => 'sent' as const);

vi.mock('../services/social-events.js', () => ({
    deliverPushToUser: (...args: unknown[]) => deliverPushToUser(...args as [never]),
}));

const isPushConfiguredMock = vi.fn(() => true);
vi.mock('../services/push.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../services/push.js')>();
    return {
        ...actual,
        isPushConfigured: () => isPushConfiguredMock(),
    };
});

// === Imports come AFTER mocks ==============================================

import {
    parseEventStart,
    offsetForKind,
    isReminderWindow,
    buildEventFingerprint,
    buildEventReminderPayload,
    resolveEventRecipients,
    tickEventReminders,
    EVENT_REMINDER_TOLERANCE_MS,
    __testing,
    type EventReminderKind,
} from './event-reminders.js';

// === Helpers ================================================================

function makeEvent(overrides?: Partial<EventRow>): EventRow {
    const now = new Date();
    return {
        id: 'event-1',
        kind: 'event',
        scope_type: 'group',
        scope_id: 'group:ITS-21',
        author_user_id: 'author-1',
        payload: {
            title: 'Защита проекта',
            startsAt: '2026-05-22T09:00:00.000Z',
            location: 'Ауд. 5-208',
        },
        pinned: false,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        ...overrides,
    };
}

function makeEventEntity(overrides?: Partial<SocialEntity<'event'>>): SocialEntity<'event'> {
    const now = new Date().toISOString();
    return {
        id: 'event-1',
        kind: 'event',
        scopeType: 'group',
        scopeId: 'group:ITS-21',
        authorUserId: 'author-1',
        payload: {
            title: 'Защита проекта',
            startsAt: '2026-05-22T09:00:00.000Z',
            location: 'Ауд. 5-208',
        },
        pinned: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByUserId: null,
        deletedReason: null,
        ...overrides,
    };
}

beforeEach(() => {
    events.length = 0;
    memberships.length = 0;
    deliverPushToUser.mockReset();
    deliverPushToUser.mockResolvedValue('sent');
    fakeClient.query.mockClear();
    isPushConfiguredMock.mockReset();
    isPushConfiguredMock.mockReturnValue(true);
});

// ===========================================================================
describe('parseEventStart', () => {
    it('parses an ISO string with timezone offset', () => {
        const parsed = parseEventStart('2026-05-22T09:00:00.000Z');
        expect(parsed).not.toBeNull();
        expect(parsed!.toISOString()).toBe('2026-05-22T09:00:00.000Z');
    });

    it('returns null for empty / invalid input', () => {
        expect(parseEventStart('')).toBeNull();
        expect(parseEventStart(null)).toBeNull();
        expect(parseEventStart(undefined)).toBeNull();
        expect(parseEventStart('not-a-date')).toBeNull();
    });
});

// ===========================================================================
describe('offsetForKind', () => {
    it('returns 24h for event_1day', () => {
        expect(offsetForKind('event_1day')).toBe(24 * 60 * 60 * 1000);
    });
    it('returns 1h for event_1hour', () => {
        expect(offsetForKind('event_1hour')).toBe(60 * 60 * 1000);
    });
});

// ===========================================================================
describe('isReminderWindow', () => {
    const startsAt = new Date('2026-05-22T09:00:00.000Z');

    it('event_1day: true exactly 24h before', () => {
        const now = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
        expect(isReminderWindow(now, startsAt, 'event_1day')).toBe(true);
    });

    it('event_1day: true within ±5 min of the 24h mark', () => {
        const t = startsAt.getTime() - 24 * 60 * 60 * 1000;
        expect(isReminderWindow(new Date(t - EVENT_REMINDER_TOLERANCE_MS), startsAt, 'event_1day')).toBe(true);
        expect(isReminderWindow(new Date(t + EVENT_REMINDER_TOLERANCE_MS), startsAt, 'event_1day')).toBe(true);
    });

    it('event_1day: false just outside ±5 min', () => {
        const t = startsAt.getTime() - 24 * 60 * 60 * 1000;
        expect(isReminderWindow(new Date(t - EVENT_REMINDER_TOLERANCE_MS - 1_000), startsAt, 'event_1day')).toBe(false);
        expect(isReminderWindow(new Date(t + EVENT_REMINDER_TOLERANCE_MS + 1_000), startsAt, 'event_1day')).toBe(false);
    });

    it('event_1hour: true exactly 1h before', () => {
        const now = new Date(startsAt.getTime() - 60 * 60 * 1000);
        expect(isReminderWindow(now, startsAt, 'event_1hour')).toBe(true);
    });

    it('event_1hour: false outside ±5 min of the 1h mark', () => {
        const t = startsAt.getTime() - 60 * 60 * 1000;
        expect(isReminderWindow(new Date(t - EVENT_REMINDER_TOLERANCE_MS - 1_000), startsAt, 'event_1hour')).toBe(false);
        expect(isReminderWindow(new Date(t + EVENT_REMINDER_TOLERANCE_MS + 1_000), startsAt, 'event_1hour')).toBe(false);
    });

    it('documents the ±5 min tolerance', () => {
        expect(EVENT_REMINDER_TOLERANCE_MS).toBe(5 * 60 * 1000);
    });
});

// ===========================================================================
describe('buildEventFingerprint', () => {
    it('is composed as event:<id>:<user>', () => {
        expect(buildEventFingerprint('e-1', 'alice')).toBe('event:e-1:alice');
    });

    it('distinguishes recipients on the same event', () => {
        expect(buildEventFingerprint('e-1', 'alice')).not.toBe(buildEventFingerprint('e-1', 'bob'));
    });

    it('distinguishes events for the same recipient', () => {
        expect(buildEventFingerprint('e-1', 'alice')).not.toBe(buildEventFingerprint('e-2', 'alice'));
    });
});

// ===========================================================================
describe('buildEventReminderPayload', () => {
    it('event_1day payload contains "Завтра событие" and the title/time/location', () => {
        const entity = makeEventEntity();
        const startsAt = new Date('2026-05-22T09:00:00.000Z');
        const payload = buildEventReminderPayload({ entity, kind: 'event_1day', startsAt });
        expect(payload.title).toBe('Завтра событие');
        expect(String(payload.body)).toContain('Защита проекта');
        expect(String(payload.body)).toContain('Ауд. 5-208');
        expect(payload.tag).toBe('event-event-1-event_1day');
        expect(payload.url).toBe('/');
    });

    it('event_1hour payload contains "Через час событие" and omits the location separator when blank', () => {
        const entity = makeEventEntity({ payload: { title: 'Защита проекта', startsAt: '2026-05-22T09:00:00.000Z' } });
        const startsAt = new Date('2026-05-22T09:00:00.000Z');
        const payload = buildEventReminderPayload({ entity, kind: 'event_1hour', startsAt });
        expect(payload.title).toBe('Через час событие');
        expect(String(payload.body)).not.toContain(' · ');
    });

    it('falls back to "Событие" when payload.title is empty', () => {
        const entity = makeEventEntity({ payload: { title: '', startsAt: '2026-05-22T09:00:00.000Z' } });
        const startsAt = new Date('2026-05-22T09:00:00.000Z');
        const payload = buildEventReminderPayload({ entity, kind: 'event_1day', startsAt });
        expect(String(payload.body)).toContain('Событие');
    });
});

// ===========================================================================
describe('resolveEventRecipients', () => {
    it('returns RSVP yes + maybe (excludes no)', async () => {
        const entity = makeEventEntity({
            payload: {
                title: 'X', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes', bob: 'maybe', carol: 'no' },
            },
        });
        const result = await resolveEventRecipients(fakeClient as never, entity);
        expect(result).not.toBeNull();
        expect(new Set(result!)).toEqual(new Set(['alice', 'bob']));
    });

    it('falls back to active group members when RSVP map is empty', async () => {
        memberships.push(
            { user_id: 'alice', group_key: 'ITS-21', active: true },
            { user_id: 'bob', group_key: 'ITS-21', active: true },
            { user_id: 'carol', group_key: 'ITS-21', active: false }, // inactive
            { user_id: 'dave', group_key: 'OTHER', active: true },     // wrong group
        );
        const entity = makeEventEntity({
            payload: { title: 'X', startsAt: '2026-05-22T09:00:00.000Z' },
        });
        const result = await resolveEventRecipients(fakeClient as never, entity);
        expect(result).not.toBeNull();
        expect(new Set(result!)).toEqual(new Set(['alice', 'bob']));
    });

    it('returns [] for non-group scopes', async () => {
        const entity = makeEventEntity({ scopeType: 'global', scopeId: 'global:chat' });
        const result = await resolveEventRecipients(fakeClient as never, entity);
        expect(result).toEqual([]);
    });

    it('returns [] when group key cannot be resolved (empty scope)', async () => {
        const entity = makeEventEntity({ scopeId: 'group:' });
        const result = await resolveEventRecipients(fakeClient as never, entity);
        expect(result).toEqual([]);
    });
});

// ===========================================================================
describe('processEvent (tick body)', () => {
    it('fans out to RSVP yes/maybe when in event_1day window', async () => {
        const now = new Date('2026-05-21T09:00:00.000Z'); // exactly 24h before
        const entity = makeEventEntity({
            payload: {
                title: 'Защита', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes', bob: 'maybe', carol: 'no' },
            },
        });
        const counters = await __testing.processEvent(fakeClient as never, entity, now);
        expect(counters.sent).toBe(2);
        expect(deliverPushToUser).toHaveBeenCalledTimes(2);
        const calledUsers = deliverPushToUser.mock.calls
            .map((c) => (c[0] as { userId: string }).userId);
        expect(new Set(calledUsers)).toEqual(new Set(['alice', 'bob']));
    });

    it('skips when no reminder window matches', async () => {
        const now = new Date('2026-05-19T09:00:00.000Z'); // 3 days out
        const entity = makeEventEntity({
            payload: {
                title: 'X', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes' },
            },
        });
        const counters = await __testing.processEvent(fakeClient as never, entity, now);
        expect(counters.sent).toBe(0);
        expect(deliverPushToUser).not.toHaveBeenCalled();
    });

    it('skips past events', async () => {
        const now = new Date('2026-05-23T09:00:00.000Z'); // past
        const entity = makeEventEntity({
            payload: {
                title: 'X', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes' },
            },
        });
        const counters = await __testing.processEvent(fakeClient as never, entity, now);
        expect(counters.sent).toBe(0);
        expect(deliverPushToUser).not.toHaveBeenCalled();
    });

    it('uses group-membership fallback when RSVP map is missing', async () => {
        memberships.push(
            { user_id: 'alice', group_key: 'ITS-21', active: true },
            { user_id: 'bob', group_key: 'ITS-21', active: true },
        );
        const now = new Date('2026-05-21T09:00:00.000Z'); // 24h before
        const entity = makeEventEntity({
            payload: { title: 'X', startsAt: '2026-05-22T09:00:00.000Z' },
        });
        const counters = await __testing.processEvent(fakeClient as never, entity, now);
        expect(counters.sent).toBe(2);
        expect(deliverPushToUser).toHaveBeenCalledTimes(2);
    });

    it('records the duplicate status returned by deliverPushToUser as a skip', async () => {
        deliverPushToUser.mockResolvedValueOnce('duplicate');
        const now = new Date('2026-05-21T09:00:00.000Z');
        const entity = makeEventEntity({
            payload: {
                title: 'X', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes' },
            },
        });
        const counters = await __testing.processEvent(fakeClient as never, entity, now);
        expect(counters.sent).toBe(0);
        expect(counters.skipped).toBe(1);
    });

    it('records the opted_out status returned by deliverPushToUser as a skip', async () => {
        deliverPushToUser.mockResolvedValueOnce('opted_out');
        const now = new Date('2026-05-21T09:00:00.000Z');
        const entity = makeEventEntity({
            payload: {
                title: 'X', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes' },
            },
        });
        const counters = await __testing.processEvent(fakeClient as never, entity, now);
        expect(counters.sent).toBe(0);
        expect(counters.skipped).toBe(1);
    });

    it('forwards the correct fingerprint shape to deliverPushToUser', async () => {
        const now = new Date('2026-05-21T09:00:00.000Z');
        const entity = makeEventEntity({
            id: 'evt-42',
            payload: {
                title: 'X', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes' },
            },
        });
        await __testing.processEvent(fakeClient as never, entity, now);
        expect(deliverPushToUser).toHaveBeenCalledTimes(1);
        const arg = deliverPushToUser.mock.calls[0][0] as {
            userId: string;
            fingerprint: string;
            kind: EventReminderKind;
        };
        expect(arg.userId).toBe('alice');
        expect(arg.fingerprint).toBe('event:evt-42:alice');
        expect(arg.kind).toBe('event_1day');
    });

    it('skips events without a startsAt payload', async () => {
        const now = new Date('2026-05-21T09:00:00.000Z');
        const entity = makeEventEntity({ payload: { title: 'X', startsAt: '' } });
        const counters = await __testing.processEvent(fakeClient as never, entity, now);
        expect(counters.sent).toBe(0);
        expect(deliverPushToUser).not.toHaveBeenCalled();
    });
});

// ===========================================================================
describe('tickEventReminders (end-to-end through the PG shim)', () => {
    it('returns zero counters when VAPID is not configured', async () => {
        isPushConfiguredMock.mockReturnValue(false);
        events.push(makeEvent({
            payload: {
                title: 'X', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes' },
            },
        }));
        const now = new Date('2026-05-21T09:00:00.000Z');
        const counters = await tickEventReminders(now);
        expect(counters).toEqual({ sent: 0, skipped: 0 });
        expect(deliverPushToUser).not.toHaveBeenCalled();
        // No SQL should have run either — short-circuit at the top of the tick.
        expect(fakeClient.query).not.toHaveBeenCalled();
    });

    it('loads upcoming events from PG and fans out to RSVP recipients', async () => {
        events.push(makeEvent({
            id: 'evt-1',
            payload: {
                title: 'Защита', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes', bob: 'maybe', carol: 'no' },
            },
        }));
        const now = new Date('2026-05-21T09:00:00.000Z');
        const counters = await tickEventReminders(now);
        expect(counters.sent).toBe(2);
        expect(deliverPushToUser).toHaveBeenCalledTimes(2);
    });

    it('ignores events outside the 25h look-ahead horizon', async () => {
        events.push(makeEvent({
            id: 'evt-far',
            payload: {
                title: 'Far future', startsAt: '2026-06-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes' },
            },
        }));
        const now = new Date('2026-05-21T09:00:00.000Z');
        const counters = await tickEventReminders(now);
        expect(counters).toEqual({ sent: 0, skipped: 0 });
        expect(deliverPushToUser).not.toHaveBeenCalled();
    });

    it('ignores soft-deleted events', async () => {
        const deletedEvent = makeEvent({
            id: 'evt-dead',
            payload: {
                title: 'Gone', startsAt: '2026-05-22T09:00:00.000Z',
                rsvpStatus: { alice: 'yes' },
            },
            deleted_at: new Date('2026-05-20T00:00:00.000Z'),
        });
        events.push(deletedEvent);
        const now = new Date('2026-05-21T09:00:00.000Z');
        const counters = await tickEventReminders(now);
        expect(counters).toEqual({ sent: 0, skipped: 0 });
        expect(deliverPushToUser).not.toHaveBeenCalled();
    });

    it('handles multiple events in one tick without one failure blocking the rest', async () => {
        events.push(
            makeEvent({
                id: 'evt-1',
                payload: {
                    title: 'A', startsAt: '2026-05-22T09:00:00.000Z',
                    rsvpStatus: { alice: 'yes' },
                },
            }),
            makeEvent({
                id: 'evt-2',
                payload: {
                    title: 'B', startsAt: '2026-05-22T09:00:00.000Z',
                    rsvpStatus: { bob: 'maybe' },
                },
            }),
        );
        // First delivery throws; second succeeds.
        deliverPushToUser.mockRejectedValueOnce(new Error('boom'));
        deliverPushToUser.mockResolvedValueOnce('sent');
        const now = new Date('2026-05-21T09:00:00.000Z');
        const counters = await tickEventReminders(now);
        // sent=1 (second event), skipped=1 (first event's failure)
        expect(counters.sent).toBe(1);
        expect(counters.skipped).toBe(1);
        expect(deliverPushToUser).toHaveBeenCalledTimes(2);
    });
});

// ===========================================================================
describe('helpers (private surface via __testing)', () => {
    it('readRsvpStatus drops invalid values', () => {
        const result = __testing.readRsvpStatus({
            rsvpStatus: { alice: 'yes', bob: 'no', carol: 'maybe', dave: 'invalid', eve: 42 },
        });
        expect(result).toEqual({ alice: 'yes', bob: 'no', carol: 'maybe' });
    });

    it('readRsvpStatus returns empty for missing / malformed payloads', () => {
        expect(__testing.readRsvpStatus(null)).toEqual({});
        expect(__testing.readRsvpStatus(undefined)).toEqual({});
        expect(__testing.readRsvpStatus({})).toEqual({});
        expect(__testing.readRsvpStatus({ rsvpStatus: 'not-an-object' })).toEqual({});
    });

    it('unprefixGroupScope strips the leading "group:" prefix', () => {
        expect(__testing.unprefixGroupScope('group:ITS-21')).toBe('ITS-21');
        expect(__testing.unprefixGroupScope('ITS-21')).toBe('ITS-21');
        expect(__testing.unprefixGroupScope('group:')).toBe('');
    });
});
