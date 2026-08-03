/**
 * Social event reminders scheduler — fan-out push notifications for upcoming
 * universal social entities of `kind='event'`.
 *
 * Mirrors `jobs/exam-reminders.ts` in shape and resilience, but adapted to the
 * universal social store:
 *
 *   - Source table is `app_social_entity` with `kind='event'` and `deleted_at IS NULL`.
 *   - The event start time lives in `payload.startsAt` (ISO 8601 string).
 *   - Each event fan-outs to recipients resolved from RSVP map + group
 *     membership (see `resolveEventRecipients` below).
 *   - Idempotency is keyed on `app_push_sends.(user_id, exam_id, kind)` where
 *     `exam_id` is used as a generic per-event fingerprint:
 *     `event:${entityId}:${userId}` so two recipients of the same event each
 *     consume their own slot.
 *   - Per-kind opt-out is gated by `services/notification-prefs.ts` (default-on).
 *   - Subscription delivery + expired-endpoint cleanup go through
 *     `services/social-events.ts#deliverPushToUser` so the failure-handling
 *     semantics (HTTP 410, soft delete) stay identical to the rest of the
 *     social push surface.
 *
 * Tolerance windows (matched to `exam-reminders.ts` for consistency):
 *   - `event_1day`  → 24h before start, ±5 min tolerance
 *   - `event_1hour` → 1h before start,  ±5 min tolerance
 *
 * Time zones: `payload.startsAt` is expected to be a normal ISO string with a
 * timezone offset (UTC or local). We parse with `new Date()` directly — naive
 * (no-tz) strings are treated as the host JVM's interpretation per the JS
 * Date spec. The universal store stamps RFC3339 with offsets on write, so naive
 * strings are not expected in practice; but we tolerate them rather than skip.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { isPushConfigured, type PushKind, type PushPayload } from '../services/push.js';
import { deliverPushToUser } from '../services/social-events.js';
import type { SocialEntity, SocialPayloadByKind } from '../types/social.js';

// === Public types ===========================================================

export type EventReminderKind = 'event_1day' | 'event_1hour';

const EVENT_REMINDER_KINDS: readonly EventReminderKind[] = ['event_1day', 'event_1hour'] as const;

// === Tunables ===============================================================

const SCHEDULER_INTERVAL_MS = 60_000;             // 1 minute
const WARMUP_DELAY_MS = 15_000;                   // 15 seconds after startup
const LOOK_AHEAD_MS = 25 * 60 * 60 * 1000;        // 25 hours (covers 1day window)

export const EVENT_REMINDER_TOLERANCE_MS = 5 * 60 * 1000; // ±5 minutes

// === Pure helpers (exported for tests) ======================================

/**
 * Parse the `startsAt` ISO string into a Date. Returns null on malformed input
 * (empty string, junk, NaN). Naive strings (no tz suffix) are accepted as-is —
 * JS interprets them in the host timezone. Universal-store writers stamp tz
 * offsets, so a naive string here is a legacy / hand-edited row.
 */
export function parseEventStart(iso: string | null | undefined): Date | null {
    if (!iso || typeof iso !== 'string') return null;
    const trimmed = iso.trim();
    if (!trimmed) return null;
    const date = new Date(trimmed);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

/**
 * Offset between `now` and event-start that defines each reminder kind.
 *   event_1day  → 24h
 *   event_1hour → 1h
 */
export function offsetForKind(kind: EventReminderKind): number {
    return kind === 'event_1day' ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
}

/**
 * Window check: does `now` fall within ±tolerance of (startsAt - offset) for
 * the given reminder kind? Mirrors `isInWindow` from exam-reminders, but uses
 * a uniform ±5min tolerance for both kinds.
 *
 * Past events (startsAt <= now) are excluded BEFORE this is called.
 */
export function isReminderWindow(now: Date, startsAt: Date, kind: EventReminderKind): boolean {
    const target = startsAt.getTime() - offsetForKind(kind);
    return Math.abs(now.getTime() - target) <= EVENT_REMINDER_TOLERANCE_MS;
}

/**
 * Idempotency fingerprint slot. Reuses the `exam_id` column from
 * `app_push_sends`, repurposed as a generic per-(event,user) fingerprint
 * (the column is just a text discriminator at this point).
 *
 * Including userId means two recipients of the same event each consume their
 * own send slot — this is required so a fan-out of N users records N separate
 * rows (without it, the first send would win and the rest silently skip).
 */
export function buildEventFingerprint(eventId: string, userId: string): string {
    return `event:${eventId}:${userId}`;
}

// === Recipient resolution ===================================================

/**
 * Resolve which users should receive a reminder for a given event. Rules:
 *
 *   1. Group-scoped event with at least one RSVP entry: union of users with
 *      RSVP='yes' or RSVP='maybe'. Users with RSVP='no' are excluded.
 *   2. Group-scoped event with NO RSVP entries (or RSVP map empty/missing):
 *      every active member of the group is a candidate recipient.
 *   3. Author of the event is treated like any other member — if they RSVPed
 *      'yes'/'maybe' they get the reminder; if there's no RSVP map yet they
 *      get it via the group-membership default.
 *   4. Non-group scopes are out of scope today and return [].
 *
 * Returns `null` on PG-unavailable so the caller can skip the event cleanly.
 */
export async function resolveEventRecipients(
    client: PoolClient,
    entity: SocialEntity<'event'>,
): Promise<string[] | null> {
    if (entity.scopeType !== 'group') return [];

    const rsvpMap = readRsvpStatus(entity.payload);
    const rsvpEntries = Object.entries(rsvpMap);

    if (rsvpEntries.length > 0) {
        const out: string[] = [];
        for (const [userId, status] of rsvpEntries) {
            if (!userId) continue;
            if (status === 'yes' || status === 'maybe') {
                out.push(userId);
            }
        }
        // Deduplicate while preserving stable order — the RSVP map is already
        // keyed by userId so duplicates shouldn't happen, but defensively dedup.
        return Array.from(new Set(out));
    }

    // No RSVPs yet — broadcast to active group members.
    const groupKey = unprefixGroupScope(entity.scopeId);
    if (!groupKey) return [];
    try {
        const result = await client.query<{ user_id: string }>(
            `
                select distinct user_id
                from app_group_memberships
                where group_key = $1 and active = true
            `,
            [groupKey],
        );
        return result.rows.map((r) => r.user_id).filter((v): v is string => !!v);
    } catch (error) {
        console.warn(
            '[EventReminders] resolveEventRecipients group membership lookup failed:',
            error instanceof Error ? error.message : 'unknown',
        );
        return null;
    }
}

/**
 * Defensive read of `payload.rsvpStatus`. Mirrors the helper in
 * `services/social-events-rsvp.ts` but stays inline to avoid pulling that
 * module (and its `assertCanReadGroup` import graph) into the scheduler.
 */
function readRsvpStatus(payload: unknown): Record<string, 'yes' | 'no' | 'maybe'> {
    if (!payload || typeof payload !== 'object') return {};
    const raw = (payload as { rsvpStatus?: unknown }).rsvpStatus;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, 'yes' | 'no' | 'maybe'> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!key || typeof key !== 'string') continue;
        if (value === 'yes' || value === 'no' || value === 'maybe') {
            out[key] = value;
        }
    }
    return out;
}

function unprefixGroupScope(scopeId: string): string {
    const prefix = 'group:';
    return scopeId.startsWith(prefix) ? scopeId.slice(prefix.length) : scopeId;
}

// === Payload builder ========================================================

/**
 * Build the push payload for one event reminder. Title/body are Russian-only
 * — backend has no per-user language lookup at this layer (same trade-off as
 * `services/social-events.ts`). Frontend renders the event itself in the
 * user's language once they tap through.
 */
export function buildEventReminderPayload(args: {
    entity: SocialEntity<'event'>;
    kind: EventReminderKind;
    startsAt: Date;
}): PushPayload {
    const title = args.kind === 'event_1day' ? 'Завтра событие' : 'Через час событие';
    const eventTitle = (args.entity.payload?.title || '').trim() || 'Событие';
    const location = (args.entity.payload?.location || '').trim();
    const timeStr = formatStartsAt(args.startsAt);
    const locationSuffix = location ? ` · ${location}` : '';
    const body = `${eventTitle} — ${timeStr}${locationSuffix}`;
    return {
        title,
        body,
        data: {
            entityId: args.entity.id,
            kind: args.kind,
            scopeType: args.entity.scopeType,
            scopeId: args.entity.scopeId,
            startsAt: args.entity.payload?.startsAt ?? null,
            location: args.entity.payload?.location ?? null,
        },
        url: '/',
        tag: `event-${args.entity.id}-${args.kind}`,
    };
}

/**
 * Stringify a Date as `HH:mm` in the user's perceived KZ timezone. The host
 * runtime is configured to UTC in production, but the event payload string
 * already carries a tz offset, so taking the local HH:mm of the parsed Date is
 * sufficient — we render `startsAt` exactly as the author wrote it.
 *
 * Pure / exported for tests via the test-only bundle.
 */
function formatStartsAt(date: Date): string {
    // toISOString → 2026-05-21T09:00:00.000Z → take HH:mm from the original
    // ISO if we have it; otherwise default to UTC HH:mm. Since we only get the
    // Date object here, render in the host TZ — this matches how the frontend
    // displays the value (it parses the same string with new Date()).
    const hh = String(date.getUTCHours()).padStart(2, '0');
    const mm = String(date.getUTCMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
}

// === DB read helpers ========================================================

interface EntityRow {
    id: string;
    kind: string;
    scope_type: string;
    scope_id: string;
    author_user_id: string;
    payload: unknown;
    pinned: boolean;
    created_at: Date | string;
    updated_at: Date | string;
}

function rowToEventEntity(row: EntityRow): SocialEntity<'event'> {
    return {
        id: row.id,
        kind: 'event',
        scopeType: row.scope_type as SocialEntity<'event'>['scopeType'],
        scopeId: row.scope_id,
        authorUserId: row.author_user_id,
        payload: (row.payload ?? {}) as SocialPayloadByKind['event'],
        pinned: row.pinned,
        createdAt: row.created_at instanceof Date
            ? row.created_at.toISOString()
            : String(row.created_at),
        updatedAt: row.updated_at instanceof Date
            ? row.updated_at.toISOString()
            : String(row.updated_at),
        deletedAt: null,
        deletedByUserId: null,
        deletedReason: null,
    };
}

/**
 * Load all live events (not soft-deleted) within the look-ahead horizon. We
 * filter by `payload->>'startsAt'` in SQL when possible to keep the result set
 * small even on large feeds; the JS-side window check still re-validates.
 *
 * The startsAt filter is conservative — it accepts rows whose startsAt is in
 * the next 25h. Past events are not loaded.
 */
async function fetchUpcomingEvents(
    client: PoolClient,
    nowIso: string,
    horizonIso: string,
): Promise<SocialEntity<'event'>[]> {
    const result = await client.query<EntityRow>(
        `
            select id, kind, scope_type, scope_id, author_user_id,
                   payload, pinned, created_at, updated_at
            from app_social_entity
            where kind = 'event'
              and deleted_at is null
              and (payload->>'startsAt') is not null
              and (payload->>'startsAt') > $1
              and (payload->>'startsAt') < $2
        `,
        [nowIso, horizonIso],
    );
    return result.rows.map(rowToEventEntity);
}

// === Per-event processing ===================================================

/**
 * Process one event entity: for each reminder kind whose window the current
 * tick lands inside, fan out a push to every resolved recipient via
 * `deliverPushToUser` (which already handles per-kind opt-out, idempotency,
 * subscription fetch, and expired-endpoint cleanup).
 *
 * Exported on the `__testing` bundle so the unit suite can drive this without
 * going through `run`.
 */
async function processEvent(
    client: PoolClient,
    entity: SocialEntity<'event'>,
    now: Date,
): Promise<{ sent: number; skipped: number }> {
    let sent = 0;
    let skipped = 0;

    const startsAt = parseEventStart(entity.payload?.startsAt ?? null);
    if (!startsAt) {
        return { sent: 0, skipped: 0 };
    }
    if (startsAt.getTime() <= now.getTime()) {
        return { sent: 0, skipped: 0 };
    }

    const activeKinds = EVENT_REMINDER_KINDS.filter((kind) => isReminderWindow(now, startsAt, kind));
    if (activeKinds.length === 0) {
        return { sent: 0, skipped: 0 };
    }

    const recipients = await resolveEventRecipients(client, entity);
    if (recipients === null || recipients.length === 0) {
        return { sent: 0, skipped: 0 };
    }

    for (const kind of activeKinds) {
        const payload = buildEventReminderPayload({ entity, kind, startsAt });
        for (const userId of recipients) {
            try {
                const status = await deliverPushToUser({
                    userId,
                    fingerprint: buildEventFingerprint(entity.id, userId),
                    kind: kind as PushKind,
                    payload,
                });
                if (status === 'sent') {
                    sent++;
                } else {
                    skipped++;
                }
            } catch (error) {
                skipped++;
                console.warn(
                    `[EventReminders] deliverPushToUser failed event=${entity.id} kind=${kind}:`,
                    error instanceof Error ? error.message : 'unknown',
                );
            }
        }
    }

    return { sent, skipped };
}

// === Main tick ==============================================================

/**
 * Run one scheduler tick. Returns aggregate counters (sent / skipped) for
 * test assertions and operational logs.
 *
 * Resilience contract:
 *   - One failing event never aborts the rest of the loop.
 *   - PG-unavailable returns `{ sent: 0, skipped: 0 }` and logs a warning.
 *   - VAPID-not-configured returns immediately as a no-op.
 */
export async function tickEventReminders(now: Date = new Date()): Promise<{ sent: number; skipped: number }> {
    if (!isPushConfigured()) {
        return { sent: 0, skipped: 0 };
    }

    const nowIso = now.toISOString();
    const horizonIso = new Date(now.getTime() + LOOK_AHEAD_MS).toISOString();

    let aggregate = { sent: 0, skipped: 0 };

    const result = await withSupabasePostgres<{ sent: number; skipped: number }>(async (client) => {
        const events = await fetchUpcomingEvents(client, nowIso, horizonIso);
        let sent = 0;
        let skipped = 0;
        for (const event of events) {
            try {
                const counters = await processEvent(client, event, now);
                sent += counters.sent;
                skipped += counters.skipped;
            } catch (error) {
                skipped++;
                console.warn(
                    `[EventReminders] processEvent failed for event=${event.id}:`,
                    error instanceof Error ? error.message : 'unknown',
                );
            }
        }
        return { sent, skipped };
    });

    if (result === null) {
        console.warn('[EventReminders] Postgres unavailable, skipping cycle');
        return aggregate;
    }
    aggregate = result;
    return aggregate;
}

// === Lifecycle ==============================================================

let timer: NodeJS.Timeout | null = null;
let warmupTimer: NodeJS.Timeout | null = null;
let running = false;
let started = false;

async function runGuarded(): Promise<void> {
    if (running) return;
    running = true;
    try {
        await tickEventReminders();
    } catch (error) {
        console.error(
            '[EventReminders] Unhandled cycle error:',
            error instanceof Error ? error.message : 'unknown',
        );
    } finally {
        running = false;
    }
}

/**
 * Start the periodic scheduler. Mirrors `startExamRemindersScheduler`: a brief
 * warmup delay so the rest of the bootstrap path settles before the first PG
 * query, then a steady interval.
 *
 * Returns the interval handle for callers that want to manage lifecycle
 * directly (notably tests); the module also keeps its own reference so
 * `stopEventRemindersScheduler` is idempotent.
 */
export function startEventRemindersScheduler(intervalMs: number = SCHEDULER_INTERVAL_MS): NodeJS.Timeout {
    if (started && timer) return timer;
    started = true;

    if (!isPushConfigured()) {
        console.warn('[EventReminders] VAPID not configured — scheduler will idle (no sends).');
    }

    warmupTimer = setTimeout(() => {
        warmupTimer = null;
        void runGuarded();
    }, WARMUP_DELAY_MS);

    timer = setInterval(() => {
        void runGuarded();
    }, intervalMs);

    return timer;
}

export function stopEventRemindersScheduler(): void {
    if (warmupTimer) {
        clearTimeout(warmupTimer);
        warmupTimer = null;
    }
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
    started = false;
}

// === Test-only exports ======================================================

export const __testing = {
    processEvent,
    runGuarded,
    fetchUpcomingEvents,
    readRsvpStatus,
    unprefixGroupScope,
    formatStartsAt,
    LOOK_AHEAD_MS,
    EVENT_REMINDER_KINDS,
};
