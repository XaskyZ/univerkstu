/**
 * Adapter from `SocialEntityView` (universal social store) → an event-shaped
 * view consumed by `EventCard` and `FeedTab`.
 *
 * Used by the `socialFeedBeta` opt-in path: when enabled, the group feed reads
 * event entities from `/api/v3/social/scope/group/group:<key>/entities` and
 * funnels every row with `entity.kind === 'event'` through this adapter.
 *
 * Mapping rules (mirror the backend schema in `backend/src/types/social.ts`):
 *  - `scopeId` is `group:<groupKey>`; we strip the `group:` prefix to recover
 *    the bare group key.
 *  - `payload` for an `event` entity is
 *    `{ title, body?, startsAt, endsAt?, location?, rsvpStatus? }`.
 *  - `rsvpStatus` is a `Record<userId, 'yes'|'no'|'maybe'>` — we project it
 *    into `rsvpCounts` (an `{ yes, no, maybe }` tally) plus the viewer's own
 *    pick (`myRsvp`). The raw map is intentionally NOT exposed: the UI must
 *    only ever drive its display from the counts + viewer's status pair.
 *  - Reactions arrive aggregated server-side as
 *    `{ reactions: [{emoji,count}], myReactions: string[] }`; we re-shape
 *    into the `{ items, mine }` envelope shared with PostCard / TaskCard
 *    so the same `ReactionsBar` component drives the surface.
 *
 * Pure function — no React, no fetch. Used by the FeedTab AND by tests
 * directly so the mapping stays unit-testable.
 */
import type { SocialEntityView } from '@/lib/api/social';
import type { EventRsvpStatus } from '@/lib/api/social';

const SCOPE_PREFIX = 'group:';

function readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Defensive read of the `rsvpStatus` jsonb field. Anything that is not a
 * valid `EventRsvpStatus` is silently dropped — the universal payload
 * column is jsonb and can technically hold arbitrary data, so we cannot
 * trust it. Exported for the test file.
 */
export function readRsvpMap(payload: Record<string, unknown>): Record<string, EventRsvpStatus> {
    const raw = payload['rsvpStatus'];
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, EventRsvpStatus> = {};
    for (const [userId, status] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof userId !== 'string' || userId.length === 0) continue;
        if (status === 'yes' || status === 'no' || status === 'maybe') {
            out[userId] = status;
        }
    }
    return out;
}

/**
 * Pure helper — turn an rsvpStatus map into `{ yes, no, maybe }` counts.
 * Exported so EventCard can render counts deterministically in tests too.
 */
export function tallyRsvpCounts(map: Record<string, EventRsvpStatus>): {
    yes: number;
    no: number;
    maybe: number;
} {
    let yes = 0;
    let no = 0;
    let maybe = 0;
    for (const status of Object.values(map)) {
        if (status === 'yes') yes += 1;
        else if (status === 'no') no += 1;
        else if (status === 'maybe') maybe += 1;
    }
    return { yes, no, maybe };
}

function stripGroupPrefix(scopeId: string): string {
    return scopeId.startsWith(SCOPE_PREFIX) ? scopeId.slice(SCOPE_PREFIX.length) : scopeId;
}

/**
 * Event-shaped view returned by the adapter. Mirrors the contract documented
 * in the agent task brief — `rsvpCounts` + `myRsvp` are the canonical surface;
 * `EventCard` should never need the raw rsvpStatus map.
 *
 * Soft-delete fields are intentionally omitted from this shape: trash views
 * for events use the same `GroupTrashSection` as other kinds, but until that
 * is wired up the adapter focuses on the live render path.
 */
export interface EventAdapterShape {
    id: string;
    groupKey: string;
    title: string;
    body?: string;
    startsAt: string;
    endsAt?: string;
    location?: string;
    rsvpCounts: { yes: number; no: number; maybe: number };
    myRsvp: EventRsvpStatus | null;
    authorUserId: string;
    createdAt: string;
    updatedAt: string;
    pinned: boolean;
    deletedAt: string | null;
    deletedBy: string | null;
    /**
     * Shared identifier for every occurrence in a recurring event series.
     * Populated on every row of a series (including the first one) when the
     * series was created via the `payload.recurrence` shortcut on
     * `POST /social/entities`. Absent on one-off events.
     */
    seriesId?: string;
    /**
     * Recurrence cadence — `'weekly'` or `'monthly'`. Only stamped on the
     * *first* row of a series (the row that owns the recurrence descriptor);
     * follow-up occurrences carry only `seriesId`. The card uses this to
     * pick the right badge copy on the series anchor.
     */
    recurrenceKind?: 'weekly' | 'monthly';
    reactions: {
        items: Array<{ emoji: string; count: number }>;
        mine: string[];
    };
}

/**
 * Adapter entry point. `viewerUserId` is required so the adapter can pick the
 * viewer's own RSVP out of the map — `EventCard` then highlights the selected
 * button without doing the lookup itself.
 *
 * When `viewerUserId` is an empty string the adapter sets `myRsvp = null` —
 * useful for SSR / pre-auth renders that should never highlight a button.
 */
export function socialEntityToEventView(
    view: SocialEntityView,
    viewerUserId: string,
): EventAdapterShape {
    const entity = view.entity;
    const payload = entity.payload || {};
    const rsvpMap = readRsvpMap(payload);
    const trimmedViewer = (viewerUserId || '').trim();
    const myRsvp = trimmedViewer ? (rsvpMap[trimmedViewer] ?? null) : null;
    const seriesId = readOptionalString(payload, 'seriesId');
    const recurrenceRaw = (payload as Record<string, unknown>).recurrence;
    const recurrenceKind: 'weekly' | 'monthly' | undefined =
        recurrenceRaw && typeof recurrenceRaw === 'object'
            ? (() => {
                const k = (recurrenceRaw as Record<string, unknown>).kind;
                return k === 'weekly' || k === 'monthly' ? k : undefined;
            })()
            : undefined;
    return {
        id: entity.id,
        groupKey: stripGroupPrefix(entity.scopeId),
        title: readString(payload, 'title'),
        body: readOptionalString(payload, 'body'),
        startsAt: readString(payload, 'startsAt'),
        endsAt: readOptionalString(payload, 'endsAt'),
        location: readOptionalString(payload, 'location'),
        rsvpCounts: tallyRsvpCounts(rsvpMap),
        myRsvp,
        authorUserId: entity.authorUserId,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        pinned: entity.pinned,
        deletedAt: entity.deletedAt,
        deletedBy: entity.deletedByUserId,
        seriesId,
        recurrenceKind,
        reactions: {
            items: view.reactions.map((aggregate) => ({
                emoji: aggregate.emoji,
                count: aggregate.count,
            })),
            mine: [...view.myReactions],
        },
    };
}
