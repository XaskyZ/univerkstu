import { describe, it, expect } from 'vitest';
import type { SocialEntityView } from '@/lib/api/social';
import {
    socialEntityToEventView,
    readRsvpMap,
    tallyRsvpCounts,
} from './social-entity-to-event';

/**
 * Builds a minimal `SocialEntityView` (kind=event) with sane defaults.
 * Tests override only the fields they care about so each assertion focuses on
 * the mapping rule under test.
 */
function makeView(overrides: {
    entity?: Partial<SocialEntityView['entity']>;
    reactions?: SocialEntityView['reactions'];
    myReactions?: SocialEntityView['myReactions'];
} = {}): SocialEntityView {
    return {
        entity: {
            id: 'event-1',
            kind: 'event',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'organizer',
            payload: {
                title: 'Lab meeting',
                startsAt: '2026-06-01T10:00:00Z',
                endsAt: '2026-06-01T12:00:00Z',
                location: 'Room 305',
            },
            pinned: false,
            createdAt: '2026-05-01T00:00:00Z',
            updatedAt: '2026-05-02T00:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...overrides.entity,
        },
        reactions: overrides.reactions ?? [],
        myReactions: overrides.myReactions ?? [],
        commentCount: 0,
        attachmentCount: 0,
        isPinned: false,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('readRsvpMap (pure)', () => {
    it('returns a clean record when every entry is valid', () => {
        const map = readRsvpMap({ rsvpStatus: { a: 'yes', b: 'no', c: 'maybe' } });
        expect(map).toEqual({ a: 'yes', b: 'no', c: 'maybe' });
    });

    it('drops invalid status values', () => {
        const map = readRsvpMap({
            rsvpStatus: { a: 'yes', b: 'attending', c: 42, d: null },
        });
        expect(map).toEqual({ a: 'yes' });
    });

    it('returns {} when rsvpStatus is missing or wrong shape', () => {
        expect(readRsvpMap({})).toEqual({});
        expect(readRsvpMap({ rsvpStatus: 'oops' })).toEqual({});
        expect(readRsvpMap({ rsvpStatus: null })).toEqual({});
    });
});

describe('tallyRsvpCounts (pure)', () => {
    it('counts yes/no/maybe entries', () => {
        expect(tallyRsvpCounts({ a: 'yes', b: 'yes', c: 'no', d: 'maybe' })).toEqual({
            yes: 2,
            no: 1,
            maybe: 1,
        });
    });

    it('returns zeros for an empty map', () => {
        expect(tallyRsvpCounts({})).toEqual({ yes: 0, no: 0, maybe: 0 });
    });
});

describe('socialEntityToEventView', () => {
    it('maps a fully-populated event entity into EventAdapterShape', () => {
        // Full happy-path mapping — every field EventCard relies on is
        // populated from the universal entity. Locks the contract for the
        // beta read surface.
        const view = makeView({
            entity: {
                id: 'event-abc',
                authorUserId: 'curator-9',
                pinned: true,
                payload: {
                    title: 'Group photo',
                    body: 'Wear the team t-shirt',
                    startsAt: '2026-06-15T18:00:00Z',
                    endsAt: '2026-06-15T19:00:00Z',
                    location: 'Quad',
                    rsvpStatus: { alice: 'yes', bob: 'maybe' },
                },
            },
            reactions: [{ emoji: '👍', count: 2 }],
            myReactions: ['👍'],
        });
        const event = socialEntityToEventView(view, 'alice');
        expect(event).toMatchObject({
            id: 'event-abc',
            groupKey: 'ITS-21',
            title: 'Group photo',
            body: 'Wear the team t-shirt',
            startsAt: '2026-06-15T18:00:00Z',
            endsAt: '2026-06-15T19:00:00Z',
            location: 'Quad',
            authorUserId: 'curator-9',
            pinned: true,
            createdAt: '2026-05-01T00:00:00Z',
            updatedAt: '2026-05-02T00:00:00Z',
            deletedAt: null,
            deletedBy: null,
            myRsvp: 'yes',
            rsvpCounts: { yes: 1, no: 0, maybe: 1 },
        });
        expect(event.reactions).toEqual({
            items: [{ emoji: '👍', count: 2 }],
            mine: ['👍'],
        });
    });

    it('defaults missing optional payload fields to undefined', () => {
        // body / endsAt / location are optional on the event payload — the
        // adapter should NEVER surface the literal `undefined` as a string.
        const view = makeView({
            entity: {
                payload: {
                    title: 'Brief stand-up',
                    startsAt: '2026-06-01T09:00:00Z',
                },
            },
        });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.body).toBeUndefined();
        expect(event.endsAt).toBeUndefined();
        expect(event.location).toBeUndefined();
        expect(event.rsvpCounts).toEqual({ yes: 0, no: 0, maybe: 0 });
        expect(event.myRsvp).toBeNull();
    });

    it('strips the `group:` prefix from scopeId to recover the bare key', () => {
        const view = makeView({ entity: { scopeId: 'group:CSE-22A' } });
        expect(socialEntityToEventView(view, 'alice').groupKey).toBe('CSE-22A');
    });

    it('returns myRsvp = null when the viewer is anonymous (empty viewerUserId)', () => {
        // Pre-auth SSR pass — the adapter must never highlight a button when
        // there is no current viewer id.
        const view = makeView({
            entity: {
                payload: {
                    title: 'Brief',
                    startsAt: '2026-06-01T09:00:00Z',
                    rsvpStatus: { alice: 'yes' },
                },
            },
        });
        expect(socialEntityToEventView(view, '').myRsvp).toBeNull();
        // Counts still tally from the map regardless of viewer identity.
        expect(socialEntityToEventView(view, '').rsvpCounts).toEqual({
            yes: 1,
            no: 0,
            maybe: 0,
        });
    });

    it('clones myReactions so caller mutations do not leak into the source view', () => {
        // Mirrors the contract baked into the post adapter — optimistic UI
        // updates patch the cloned array, never the source view.
        const source = ['👍'];
        const view = makeView({ myReactions: source });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.reactions.mine).toEqual(['👍']);
        expect(event.reactions.mine).not.toBe(source);
    });

    it('preserves soft-delete fields (deletedAt + deletedByUserId → deletedBy)', () => {
        // The field rename (`deletedByUserId` → `deletedBy`) is intentional —
        // mirrors how the post and task adapters re-key for the legacy-shaped
        // trash UI.
        const view = makeView({
            entity: {
                deletedAt: '2026-02-15T10:00:00Z',
                deletedByUserId: 'moderator-9',
                deletedReason: 'duplicate',
            },
        });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.deletedAt).toBe('2026-02-15T10:00:00Z');
        expect(event.deletedBy).toBe('moderator-9');
    });

    it('falls back to "" for missing required string fields (title/startsAt)', () => {
        // Backend schema requires both — but if the upstream row ever lands
        // here with corrupt jsonb we surface empty strings instead of crashing
        // the render.
        const view = makeView({ entity: { payload: {} } });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.title).toBe('');
        expect(event.startsAt).toBe('');
    });
});

describe('socialEntityToEventView — recurrence / series', () => {
    it('seriesId and recurrenceKind default to undefined for one-off events', () => {
        const event = socialEntityToEventView(makeView(), 'alice');
        expect(event.seriesId).toBeUndefined();
        expect(event.recurrenceKind).toBeUndefined();
    });

    it('surfaces seriesId from the payload when present', () => {
        const view = makeView({
            entity: {
                payload: {
                    title: 't',
                    startsAt: '2026-06-01T10:00:00Z',
                    seriesId: 'series-abc',
                },
            },
        });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.seriesId).toBe('series-abc');
    });

    it('surfaces recurrenceKind="weekly" when payload carries the recurrence descriptor', () => {
        const view = makeView({
            entity: {
                payload: {
                    title: 't',
                    startsAt: '2026-06-01T10:00:00Z',
                    seriesId: 'series-abc',
                    recurrence: { kind: 'weekly', occurrencesAhead: 12 },
                },
            },
        });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.recurrenceKind).toBe('weekly');
    });

    it('surfaces recurrenceKind="monthly" when payload carries a monthly descriptor', () => {
        const view = makeView({
            entity: {
                payload: {
                    title: 't',
                    startsAt: '2026-06-01T10:00:00Z',
                    seriesId: 'series-abc',
                    recurrence: { kind: 'monthly' },
                },
            },
        });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.recurrenceKind).toBe('monthly');
    });

    it('ignores unknown recurrence.kind values (returns undefined)', () => {
        const view = makeView({
            entity: {
                payload: {
                    title: 't',
                    startsAt: '2026-06-01T10:00:00Z',
                    seriesId: 'series-abc',
                    // @ts-expect-error — deliberately invalid kind
                    recurrence: { kind: 'daily' },
                },
            },
        });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.recurrenceKind).toBeUndefined();
    });

    it('returns undefined recurrenceKind when payload lacks a recurrence object even with seriesId set (follow-up occurrence)', () => {
        // Follow-up occurrences of a series share the seriesId but do NOT
        // carry the recurrence descriptor — only the first row does. The
        // EventCard uses this asymmetry to render `seriesMemberBadge` instead
        // of the cadence-specific badge on the anchor.
        const view = makeView({
            entity: {
                payload: {
                    title: 't',
                    startsAt: '2026-06-08T10:00:00Z',
                    seriesId: 'series-abc',
                },
            },
        });
        const event = socialEntityToEventView(view, 'alice');
        expect(event.seriesId).toBe('series-abc');
        expect(event.recurrenceKind).toBeUndefined();
    });
});
