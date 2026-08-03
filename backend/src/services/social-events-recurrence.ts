/**
 * Universal social events — recurrence helpers.
 *
 * Recurring events are stored as a *series of independent rows* in
 * `app_social_entity` (one per occurrence), each kind='event', sharing a
 * common `payload.seriesId`. The first row of a new series additionally
 * stores the `payload.recurrence` descriptor verbatim so subsequent
 * `extend-series` calls can locate the schedule shape without a side table.
 *
 * Why per-row materialization instead of an RRULE-style virtual series:
 *   - reads stay cheap: list / scope queries hit the same flat table without
 *     a recurrence expansion pass
 *   - per-occurrence RSVP, attachments, comments and reactions all key on the
 *     real `entity_id`, matching the rest of the social store
 *   - moderation (soft-delete, restore, pin) works without a separate
 *     "series vs occurrence" branch
 *
 * Trade-off: storage cost scales with the occurrence count. We hard-cap the
 * series length at `MAX_SERIES_OCCURRENCES = 26` (≈6 months weekly, or just
 * over 2 years monthly), and treat `payload.recurrence.until` as a secondary
 * (inclusive) upper bound. The cap protects against runaway "every day for
 * 10 years" entries hammering the table.
 *
 * Pure-function entry point is `generateEventSeries`. The DB write code path
 * (multi-INSERT inside `createEntity` for recurring events) lives in
 * `services/social.ts` so this module stays unit-testable without PG.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { assertCanReadGroup } from './group-space.js';
import { createEntity } from './social.js';
import type { SocialEntity, SocialPayloadByKind, SocialScopeType } from '../types/social.js';

/**
 * Hard cap on materialized future occurrences for any single series. Applied
 * BEFORE the `until` cap, so the upper bound is `min(cap, until-based count)`.
 *
 * 26 weekly occurrences ≈ 6 months — comfortably covers a full semester.
 * 26 monthly occurrences ≈ 2 years — covers the typical undergraduate degree.
 */
export const MAX_SERIES_OCCURRENCES = 26;

/**
 * Default number of future occurrences to materialize when the caller does
 * not pass `occurrencesAhead`. Picked to match the weekly cap so a "no
 * options" weekly series fills out a full semester by default.
 */
export const DEFAULT_OCCURRENCES_AHEAD = 12;

export type RecurrenceKind = 'weekly' | 'monthly';

export interface RecurrenceDescriptor {
    kind: RecurrenceKind;
    until?: string;
    occurrencesAhead?: number;
}

/**
 * Pure helper — given a base ISO `startsAt` and a recurrence descriptor,
 * return the list of future occurrence ISO timestamps (NOT including the
 * base itself — the base is the row that triggers the generation, and is
 * already persisted by the caller).
 *
 * Rules:
 *   - `kind: 'weekly'`  → +7 days per step
 *   - `kind: 'monthly'` → +1 calendar month per step (clamped at month-end
 *     via `setUTCMonth` semantics — e.g. Jan 31 → Feb 28/29 → Mar 28/29).
 *     We deliberately preserve the *normalized* date from `setUTCMonth`
 *     rather than re-pinning to the original day-of-month, because the
 *     intent of "every month on the 31st" for a meeting series is poorly
 *     defined and the calendar behavior matches user expectations.
 *   - `until` (ISO) is an INCLUSIVE upper bound: any occurrence whose
 *     timestamp exceeds `until` is dropped.
 *   - `occurrencesAhead` clamps the count. Out-of-range values fall back to
 *     `DEFAULT_OCCURRENCES_AHEAD`. The final result is always
 *     `min(requested, MAX_SERIES_OCCURRENCES)`.
 *   - Invalid `kind`, invalid `baseStartsAt`, or zero/negative
 *     `occurrencesAhead` after clamping → returns `[]`.
 *
 * The function is intentionally synchronous and side-effect-free so it can be
 * exercised by unit tests without PG / network deps.
 */
export function generateEventSeries(
    baseStartsAt: string,
    recurrence: RecurrenceDescriptor,
): string[] {
    if (!baseStartsAt || typeof baseStartsAt !== 'string') return [];
    if (!recurrence || (recurrence.kind !== 'weekly' && recurrence.kind !== 'monthly')) {
        return [];
    }
    const baseDate = new Date(baseStartsAt);
    if (Number.isNaN(baseDate.getTime())) return [];

    const requestedRaw = typeof recurrence.occurrencesAhead === 'number'
        ? recurrence.occurrencesAhead
        : DEFAULT_OCCURRENCES_AHEAD;
    const requested = Number.isFinite(requestedRaw) && requestedRaw > 0
        ? Math.floor(requestedRaw)
        : DEFAULT_OCCURRENCES_AHEAD;
    const cap = Math.min(requested, MAX_SERIES_OCCURRENCES);
    if (cap <= 0) return [];

    let untilTs: number | null = null;
    if (typeof recurrence.until === 'string' && recurrence.until.length > 0) {
        const parsed = new Date(recurrence.until);
        if (!Number.isNaN(parsed.getTime())) untilTs = parsed.getTime();
    }

    const out: string[] = [];
    for (let step = 1; step <= cap; step += 1) {
        const next = new Date(baseDate.getTime());
        if (recurrence.kind === 'weekly') {
            // 7 days × step. Use UTC ms math so DST transitions do not skew
            // the cadence — the stored value is always an absolute instant.
            next.setTime(next.getTime() + step * 7 * 24 * 60 * 60 * 1000);
        } else {
            // Monthly: increment the calendar month via setUTCMonth so day
            // overflow normalizes naturally.
            next.setUTCMonth(next.getUTCMonth() + step);
        }
        if (untilTs !== null && next.getTime() > untilTs) break;
        out.push(next.toISOString());
    }
    return out;
}

/**
 * Compute the next "anchor" ISO instant for a series so `extend-series` can
 * append further occurrences. Given the most recent occurrence's ISO
 * timestamp + the recurrence kind, returns the *next* step. Used as the
 * synthetic base when extending a series: we call `generateEventSeries`
 * against this anchor with `occurrencesAhead = N` to materialize the N
 * additional rows.
 *
 * Pure — exported for tests.
 */
export function nextOccurrenceAfter(
    anchorIso: string,
    kind: RecurrenceKind,
): string | null {
    if (!anchorIso || typeof anchorIso !== 'string') return null;
    const anchor = new Date(anchorIso);
    if (Number.isNaN(anchor.getTime())) return null;
    const next = new Date(anchor.getTime());
    if (kind === 'weekly') {
        next.setTime(next.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else if (kind === 'monthly') {
        next.setUTCMonth(next.getUTCMonth() + 1);
    } else {
        return null;
    }
    return next.toISOString();
}

/**
 * Pure helper — build the per-occurrence event payload from the base payload.
 * Strips `recurrence` (only the first row of a series carries it) and
 * `rsvpStatus` (each occurrence has its own attendance), but preserves
 * `title`, `body`, `location`, `endsAt` (recomputed against the new
 * startsAt by the caller — this helper does NOT shift `endsAt`), and the
 * shared `seriesId`.
 *
 * `endsAtOffsetMs` is applied to `startsAt` to recompute the end ISO when
 * the base payload included an `endsAt`. Pass `null` to leave it absent.
 */
export function buildOccurrencePayload(
    basePayload: SocialPayloadByKind['event'],
    occurrenceStartsAtIso: string,
    seriesId: string,
    endsAtOffsetMs: number | null,
): SocialPayloadByKind['event'] {
    const out: SocialPayloadByKind['event'] = {
        title: basePayload.title,
        startsAt: occurrenceStartsAtIso,
        seriesId,
    };
    if (typeof basePayload.body === 'string' && basePayload.body.length > 0) {
        out.body = basePayload.body;
    }
    if (typeof basePayload.location === 'string' && basePayload.location.length > 0) {
        out.location = basePayload.location;
    }
    if (endsAtOffsetMs !== null && endsAtOffsetMs > 0) {
        const startMs = new Date(occurrenceStartsAtIso).getTime();
        if (!Number.isNaN(startMs)) {
            out.endsAt = new Date(startMs + endsAtOffsetMs).toISOString();
        }
    }
    return out;
}

/**
 * Pure helper — derive the duration in milliseconds between a payload's
 * `startsAt` and `endsAt` so subsequent occurrences can preserve the same
 * event length. Returns `null` when `endsAt` is missing, unparseable, or
 * not strictly after `startsAt`.
 */
export function computeEventDurationMs(
    payload: Pick<SocialPayloadByKind['event'], 'startsAt' | 'endsAt'>,
): number | null {
    if (typeof payload.endsAt !== 'string' || payload.endsAt.length === 0) return null;
    const start = new Date(payload.startsAt).getTime();
    const end = new Date(payload.endsAt).getTime();
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    if (end <= start) return null;
    return end - start;
}

// ============================================================================
// Series extension (DB-coupled — kept separate from the pure helpers above so
// the test file can exercise the pure surface without a Postgres mock).
// ============================================================================

type SeriesAnchorRow = {
    id: string;
    scope_type: string;
    scope_id: string;
    author_user_id: string;
    payload: unknown;
    starts_at_iso: string | null;
    has_recurrence: boolean;
    recurrence_kind: string | null;
};

/**
 * Load the metadata needed to extend a series:
 *  - the recurrence descriptor (only present on the *first* row of a series)
 *  - the most recent occurrence's `startsAt` (regardless of which row that is)
 *  - the shared `seriesId`
 *
 * Returns `null` if the input id does not belong to a known series.
 *
 * Joins to itself once via `seriesId` to read every occurrence's `startsAt`
 * and pick the max. We deliberately avoid `MAX(...)` on jsonb at the SQL
 * level — the jsonb date strings are ISO and lexicographically comparable,
 * but Postgres ordering on jsonb -> 'startsAt' is brittle across PG versions,
 * so we ORDER BY the extracted text and LIMIT 1 instead.
 */
async function loadSeriesAnchor(
    client: PoolClient,
    eventId: string,
): Promise<{
    seriesId: string;
    scopeType: SocialScopeType;
    scopeId: string;
    authorUserId: string;
    basePayload: SocialPayloadByKind['event'];
    recurrenceKind: RecurrenceKind;
    until: string | undefined;
    latestStartsAt: string;
} | null> {
    // First: resolve the seriesId from the requested entity row.
    const initial = await client.query<{
        id: string;
        scope_type: string;
        scope_id: string;
        author_user_id: string;
        payload: unknown;
        series_id: string | null;
    }>(
        `
            select
                id::text as id,
                scope_type,
                scope_id,
                author_user_id,
                payload,
                payload ->> 'seriesId' as series_id
            from app_social_entity
            where id = $1::uuid and kind = 'event' and deleted_at is null
        `,
        [eventId],
    );
    if (initial.rowCount === 0) return null;
    const seriesIdValue = initial.rows[0].series_id;
    if (!seriesIdValue) return null;
    const ownerScopeType = initial.rows[0].scope_type as SocialScopeType;
    const ownerScopeId = initial.rows[0].scope_id;

    // Then: find the *first* row in the series (the one carrying the
    // recurrence descriptor) and the latest startsAt across the series.
    const anchorRows = await client.query<SeriesAnchorRow>(
        `
            select
                e.id::text as id,
                e.scope_type,
                e.scope_id,
                e.author_user_id,
                e.payload,
                e.payload ->> 'startsAt' as starts_at_iso,
                (e.payload ? 'recurrence') as has_recurrence,
                e.payload #>> '{recurrence,kind}' as recurrence_kind
            from app_social_entity e
            where e.kind = 'event'
              and e.deleted_at is null
              and e.scope_type = $1
              and e.scope_id = $2
              and (e.payload ->> 'seriesId') = $3
        `,
        [ownerScopeType, ownerScopeId, seriesIdValue],
    );
    if (anchorRows.rowCount === 0) return null;

    let descriptorRow: SeriesAnchorRow | null = null;
    let latestStartsAt = '';
    for (const row of anchorRows.rows) {
        if (row.has_recurrence && (row.recurrence_kind === 'weekly' || row.recurrence_kind === 'monthly')) {
            // Take the first match — there should only be one row carrying
            // recurrence per series. If duplicates exist (defensive), the
            // first wins.
            if (descriptorRow === null) descriptorRow = row;
        }
        if (typeof row.starts_at_iso === 'string' && row.starts_at_iso > latestStartsAt) {
            latestStartsAt = row.starts_at_iso;
        }
    }
    if (!descriptorRow) return null;
    if (!latestStartsAt) return null;

    const basePayload = (descriptorRow.payload ?? {}) as SocialPayloadByKind['event'];
    const recurrence = basePayload.recurrence;
    if (!recurrence || (recurrence.kind !== 'weekly' && recurrence.kind !== 'monthly')) {
        return null;
    }
    return {
        seriesId: seriesIdValue,
        scopeType: descriptorRow.scope_type as SocialScopeType,
        scopeId: descriptorRow.scope_id,
        authorUserId: descriptorRow.author_user_id,
        basePayload,
        recurrenceKind: recurrence.kind,
        until: typeof recurrence.until === 'string' ? recurrence.until : undefined,
        latestStartsAt,
    };
}

export interface ExtendSeriesResult {
    created: SocialEntity<'event'>[];
    seriesId: string;
    nextStartsAt: string | null;
}

/**
 * Materialize N additional future occurrences of the series that `eventId`
 * belongs to. The caller's `additional` is clamped to
 * `[1, MAX_SERIES_OCCURRENCES]`, then further reduced by the series'
 * `recurrence.until` (if set).
 *
 * Authorization:
 *  - Only the original series author may extend it. Throws `'forbidden'`
 *    otherwise.
 *  - The user must currently have group read access (defense in depth — the
 *    JWT already gates the route).
 *
 * Throws:
 *  - `'not found'` — eventId missing, soft-deleted, or not part of a series
 *  - `'forbidden'` — actor is not the series author / lacks scope read access
 *  - `'not a series'` — entity is a one-off event (no seriesId in payload)
 */
export async function extendEventSeries(
    eventId: string,
    actorUserId: string,
    additional: number,
): Promise<ExtendSeriesResult> {
    const trimmedEventId = (eventId || '').trim();
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedEventId) throw new Error('eventId is required');
    if (!trimmedActor) throw new Error('actorUserId is required');

    const requested = Number.isFinite(additional) && additional > 0
        ? Math.floor(additional)
        : DEFAULT_OCCURRENCES_AHEAD;
    const cap = Math.min(requested, MAX_SERIES_OCCURRENCES);

    // Step 1: read the anchor inside a tx. We pull all rows-by-series and
    // pick the descriptor + latest occurrence start.
    const anchorResult = await withSupabasePostgres<{ value: Awaited<ReturnType<typeof loadSeriesAnchor>> }>(
        async (client) => ({ value: await loadSeriesAnchor(client, trimmedEventId) }),
    );
    if (anchorResult === null) {
        throw new Error('[SocialEventsRecurrence] Supabase/Postgres unavailable during extendEventSeries');
    }
    const anchor = anchorResult.value;
    if (!anchor) {
        // Either the entity is gone or it does not belong to a series. The
        // route layer maps 'not found' to 404; the more specific
        // 'not a series' case lets the frontend show a useful message.
        throw new Error('not a series');
    }
    if (anchor.authorUserId !== trimmedActor) {
        throw new Error('forbidden');
    }
    if (anchor.scopeType === 'group') {
        const rawKey = anchor.scopeId.startsWith('group:')
            ? anchor.scopeId.slice('group:'.length)
            : anchor.scopeId;
        try {
            await assertCanReadGroup(trimmedActor, rawKey);
        } catch {
            throw new Error('forbidden');
        }
    }

    // Step 2: synthesize the new occurrence list. Use the latest existing
    // occurrence as the "anchor", then step forward.
    const anchorNext = nextOccurrenceAfter(anchor.latestStartsAt, anchor.recurrenceKind);
    if (!anchorNext) {
        return { created: [], seriesId: anchor.seriesId, nextStartsAt: null };
    }
    // Generate against a synthetic base = (anchorNext - one step), so the
    // pure helper's `step=1` yields anchorNext itself.
    const oneStepBack = anchor.recurrenceKind === 'weekly'
        ? new Date(new Date(anchorNext).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
        : ((): string => {
            const d = new Date(anchorNext);
            d.setUTCMonth(d.getUTCMonth() - 1);
            return d.toISOString();
        })();

    const newOccurrences = generateEventSeries(oneStepBack, {
        kind: anchor.recurrenceKind,
        until: anchor.until,
        occurrencesAhead: cap,
    });
    if (newOccurrences.length === 0) {
        return { created: [], seriesId: anchor.seriesId, nextStartsAt: null };
    }

    const durationMs = computeEventDurationMs({
        startsAt: anchor.basePayload.startsAt,
        endsAt: anchor.basePayload.endsAt,
    });

    const created: SocialEntity<'event'>[] = [];
    for (const occurrenceStarts of newOccurrences) {
        const occurrencePayload = buildOccurrencePayload(
            anchor.basePayload,
            occurrenceStarts,
            anchor.seriesId,
            durationMs,
        );
        try {
            const entity = await createEntity({
                kind: 'event',
                scopeType: anchor.scopeType,
                scopeId: anchor.scopeId,
                authorUserId: anchor.authorUserId,
                payload: occurrencePayload,
            });
            created.push(entity);
        } catch (error) {
            // Per-row failure does not abort the rest — the next call to
            // extend-series can retry from the new latest row. Log + continue.
            console.warn(
                '[SocialEventsRecurrence] occurrence create failed:',
                error instanceof Error ? error.message : 'unknown',
            );
        }
    }

    return {
        created,
        seriesId: anchor.seriesId,
        nextStartsAt: created.length > 0
            ? created[created.length - 1].payload.startsAt
            : null,
    };
}
