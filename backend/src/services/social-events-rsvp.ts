/**
 * Universal social events — RSVP service (Phase 2).
 *
 * Adds per-user RSVP bookkeeping on top of the universal social store for
 * entities with `kind='event'`. The data is stored inside the entity's
 * `payload.rsvpStatus: Record<userId, 'yes' | 'no' | 'maybe'>` field rather
 * than in a sidecar table — events are typically small (group-scoped) so the
 * jsonb path is cheaper than a join, and the surface already mirrors how the
 * poll/event payloads carry per-user state.
 *
 * Authorization model:
 *  - The viewer must be able to read the event's scope. For group-scoped
 *    events this means `assertCanReadGroup(userId, groupKey)` succeeds.
 *  - A viewer may ONLY set / clear their OWN RSVP — the userId parameter is
 *    always sourced from the JWT at the route layer; there is no path to
 *    flip another user's RSVP through this service.
 *  - The event author has no special privilege over RSVP. Authors RSVP for
 *    themselves like every other member.
 *
 * Idempotency:
 *  - Calling `rsvp(eventId, userId, 'yes')` when the user is already 'yes'
 *    is a no-op (does NOT bump updated_at, does NOT write a revision).
 *  - `clearRsvp` is similarly idempotent — clearing an absent entry returns
 *    the current state without touching the row.
 *
 * Past events:
 *  - The service does NOT block RSVP for past events. The decision is left to
 *    the UI (read-only rendering after `endsAt < now`). The backend stays
 *    permissive so a curator can still backfill attendance after the fact.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { assertCanReadGroup } from './group-space.js';
import type { SocialEntity, SocialPayloadByKind, SocialScopeType } from '../types/social.js';

export type RsvpStatus = 'yes' | 'no' | 'maybe';

/**
 * Pure helper — narrow an unknown value to `RsvpStatus`. Exported for tests
 * and used by the route layer to validate user input before reaching the
 * service. Throws so the route handler can map to a 400.
 */
export function assertRsvpStatus(input: unknown): RsvpStatus {
    if (input === 'yes' || input === 'no' || input === 'maybe') return input;
    throw new Error('invalid rsvp status');
}

/**
 * Read the rsvpStatus map from a raw payload object, defensively normalizing
 * stray values to a clean `Record<string, RsvpStatus>`. Anything that is not a
 * valid `RsvpStatus` value is silently dropped — the universal payload column
 * is jsonb and can technically hold arbitrary data, so we cannot trust it.
 *
 * Pure / exported for tests.
 */
export function readRsvpStatusMap(payload: unknown): Record<string, RsvpStatus> {
    if (!payload || typeof payload !== 'object') return {};
    const raw = (payload as Record<string, unknown>).rsvpStatus;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, RsvpStatus> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof key !== 'string' || key.length === 0) continue;
        if (value === 'yes' || value === 'no' || value === 'maybe') {
            out[key] = value;
        }
    }
    return out;
}

type EntityRow = {
    id: string;
    kind: string;
    scope_type: string;
    scope_id: string;
    author_user_id: string;
    payload: unknown;
    pinned: boolean;
    created_at: Date | string;
    updated_at: Date | string;
    deleted_at: Date | string | null;
    deleted_by_user_id: string | null;
    deleted_reason: string | null;
};

async function requireSocialPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[SocialRsvp] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

/**
 * Strip the canonical scope prefix to recover the raw key. `buildScopeId` and
 * `assertCanReadGroup` agree that the bare key (e.g. `ITS-21`) is what the
 * group-space service expects, but the entity row stores the namespaced form.
 */
function unprefix(scopeType: SocialScopeType, scopeId: string): string {
    const prefix = `${scopeType}:`;
    return scopeId.startsWith(prefix) ? scopeId.slice(prefix.length) : scopeId;
}

/**
 * Membership / scope authorization for an RSVP action. The mute / muted-by
 * RBAC layers are out of scope — they are already enforced at the comment /
 * reaction surfaces and an RSVP write doesn't surface to other members in the
 * same way.
 *
 * Currently only `group` scopes are accepted; events on `dm`/`global`/
 * `announcement` scopes throw `'forbidden'`. The service treats those scopes
 * as out-of-band because there's no membership table backing them today
 * (announcements broadcast to a target list, not a roster).
 */
async function assertCanRsvp(
    userId: string,
    scopeType: string,
    scopeId: string,
): Promise<void> {
    if (scopeType !== 'group') {
        throw new Error('forbidden');
    }
    const rawKey = unprefix('group', scopeId);
    await assertCanReadGroup(userId, rawKey);
}

async function loadEventRow(
    client: PoolClient,
    eventId: string,
): Promise<EntityRow> {
    const rows = await client.query<EntityRow>(
        `select * from app_social_entity where id = $1::uuid`,
        [eventId],
    );
    if (rows.rowCount === 0) throw new Error('not found');
    const row = rows.rows[0];
    if (row.deleted_at) throw new Error('not found');
    if (row.kind !== 'event') throw new Error('not an event');
    return row;
}

function rsvpResultFromRow(row: EntityRow, userId: string): {
    rsvpStatus: Record<string, RsvpStatus>;
    mine: RsvpStatus | null;
} {
    const rsvpStatus = readRsvpStatusMap(row.payload);
    const mine = rsvpStatus[userId] ?? null;
    return { rsvpStatus, mine };
}

/**
 * Mark `userId`'s RSVP as `status` on event `eventId`. Idempotent — if the
 * user already has the same status, the row is not touched.
 *
 * Throws:
 *  - `'not found'` — event missing, soft-deleted, or wrong kind
 *  - `'forbidden'` — viewer can't read the event's scope
 *  - `'invalid rsvp status'` — status is not one of yes/no/maybe (route
 *    handler usually rejects first, but the service is defensive)
 */
export async function rsvp(
    eventId: string,
    userId: string,
    status: RsvpStatus,
): Promise<{ rsvpStatus: Record<string, RsvpStatus>; mine: RsvpStatus }> {
    const trimmedEventId = (eventId || '').trim();
    const trimmedUserId = (userId || '').trim();
    if (!trimmedEventId) throw new Error('eventId is required');
    if (!trimmedUserId) throw new Error('userId is required');
    const validated = assertRsvpStatus(status);

    return requireSocialPostgres('rsvp', async (client) => {
        const row = await loadEventRow(client, trimmedEventId);
        await assertCanRsvp(trimmedUserId, row.scope_type, row.scope_id);

        const existingMap = readRsvpStatusMap(row.payload);
        // Idempotent: no write when the status is unchanged. Returning the
        // current state matches the post-write contract so the caller doesn't
        // have to special-case the no-op branch.
        if (existingMap[trimmedUserId] === validated) {
            return { rsvpStatus: existingMap, mine: validated };
        }

        const nextMap: Record<string, RsvpStatus> = { ...existingMap, [trimmedUserId]: validated };
        const existingPayload = (row.payload ?? {}) as Record<string, unknown>;
        const nextPayload = { ...existingPayload, rsvpStatus: nextMap };

        const updated = await client.query<EntityRow>(
            `
                update app_social_entity
                set payload = $2::jsonb, updated_at = now()
                where id = $1::uuid
                returning *
            `,
            [trimmedEventId, JSON.stringify(nextPayload)],
        );
        const updatedRow = updated.rows[0];
        return rsvpResultFromRow(updatedRow, trimmedUserId) as {
            rsvpStatus: Record<string, RsvpStatus>;
            mine: RsvpStatus;
        };
    });
}

/**
 * Remove `userId`'s RSVP from event `eventId`. Idempotent — clearing an
 * absent entry returns the current state without touching the row.
 */
export async function clearRsvp(
    eventId: string,
    userId: string,
): Promise<{ rsvpStatus: Record<string, RsvpStatus>; mine: null }> {
    const trimmedEventId = (eventId || '').trim();
    const trimmedUserId = (userId || '').trim();
    if (!trimmedEventId) throw new Error('eventId is required');
    if (!trimmedUserId) throw new Error('userId is required');

    return requireSocialPostgres('clearRsvp', async (client) => {
        const row = await loadEventRow(client, trimmedEventId);
        await assertCanRsvp(trimmedUserId, row.scope_type, row.scope_id);

        const existingMap = readRsvpStatusMap(row.payload);
        if (!(trimmedUserId in existingMap)) {
            return { rsvpStatus: existingMap, mine: null };
        }

        const nextMap: Record<string, RsvpStatus> = { ...existingMap };
        delete nextMap[trimmedUserId];
        const existingPayload = (row.payload ?? {}) as Record<string, unknown>;
        const nextPayload = { ...existingPayload, rsvpStatus: nextMap };

        const updated = await client.query<EntityRow>(
            `
                update app_social_entity
                set payload = $2::jsonb, updated_at = now()
                where id = $1::uuid
                returning *
            `,
            [trimmedEventId, JSON.stringify(nextPayload)],
        );
        const updatedRow = updated.rows[0];
        const result = readRsvpStatusMap(updatedRow.payload);
        return { rsvpStatus: result, mine: null };
    });
}

/**
 * Convenience type re-export — service consumers don't need to import
 * the SocialEntity generic just to type-check an event entity row.
 */
export type EventEntity = SocialEntity<'event'>;
export type EventPayload = SocialPayloadByKind['event'];
