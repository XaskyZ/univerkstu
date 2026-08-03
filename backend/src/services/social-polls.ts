/**
 * Universal social polls service.
 *
 * Voting on a poll is conceptually an update to the parent entity's `votes`
 * field, but it CANNOT go through `services/social.ts#updateEntity` — that
 * helper is owner-only (only the poll author could vote on it). Polls have a
 * different authorization model: every member of the scope (e.g. every group
 * member) must be able to add / remove their own vote, but only the poll
 * author may close it.
 *
 * To keep the universal store invariants intact (the payload bag never gets
 * partial writes from non-authors via `updateEntity`), polls get dedicated
 * service helpers + routes (`POST /api/v3/social/polls/:id/vote`, `/unvote`,
 * `/close`). All three perform a SELECT … FOR UPDATE-ish read-then-write
 * sequence under a single client transaction, modify only the `votes`
 * sub-field of the payload, and write a revision so the audit trail mirrors
 * the rest of the social store.
 *
 * Voting semantics
 * ----------------
 * Two modes, controlled by `payload.multiChoice` (defaults to `false`):
 *   - Single-choice (default): casting a vote for option B when the viewer
 *     already voted for option A silently moves them — the viewer does not
 *     have to call `unvote` first.
 *   - Multi-choice (`multiChoice === true`): each option behaves like an
 *     independent toggle. Casting a vote for an option the viewer already
 *     voted for *removes* it (acts as an `unvote` for that option only);
 *     casting a vote for a fresh option *adds* it without touching the rest.
 *     The unvote helper still drops the viewer from every bucket — the
 *     "Clear all" affordance stays mode-independent.
 *
 * The `votes` field shape (`Record<optionId, userIds[]>`) is the same in both
 * modes; only the bucket-update step differs.
 *
 * Scope authorization
 * -------------------
 * Mirrors `searchSocialEntities` group filtering and the SSE stream
 * subscriber rules — group scopes call `assertCanReadGroup`, dm scopes
 * resolve participants via `parseDirectRoomId`, global / announcement
 * scopes are open to any authenticated viewer. A poll outside one of these
 * scope types throws 'forbidden' as a defensive default — Phase 1 does not
 * expect polls in any other scope kind.
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { assertCanReadGroup } from './group-space.js';
import { parseDirectRoomId } from './messaging.js';
import type { SocialEntity, SocialPayloadByKind, SocialScopeType } from '../types/social.js';

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

function toIso(value: Date | string | null): string | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value.toISOString();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString();
}

function mapEntityRow(row: EntityRow): SocialEntity<'poll'> {
    return {
        id: row.id,
        kind: 'poll',
        scopeType: row.scope_type as SocialScopeType,
        scopeId: row.scope_id,
        authorUserId: row.author_user_id,
        payload: (row.payload ?? {}) as SocialPayloadByKind['poll'],
        pinned: Boolean(row.pinned),
        createdAt: toIso(row.created_at) ?? new Date().toISOString(),
        updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
        deletedAt: toIso(row.deleted_at),
        deletedByUserId: row.deleted_by_user_id,
        deletedReason: row.deleted_reason,
    };
}

async function requirePollPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[SocialPolls] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

/**
 * Pure helper — given a viewer + poll entity, verify the viewer has read
 * access to the entity's scope. Throws `'forbidden'` if not. Async because
 * the group check is DB-backed via `assertCanReadGroup`.
 *
 * Exported for tests and re-used by both vote / unvote / close. `close`
 * additionally enforces the owner-only invariant at the call site.
 */
export async function assertCanVoteOnPoll(
    entity: { scopeType: SocialScopeType; scopeId: string },
    viewerUserId: string,
): Promise<void> {
    const viewer = (viewerUserId || '').trim();
    if (!viewer) throw new Error('forbidden');

    switch (entity.scopeType) {
        case 'global':
        case 'announcement':
            return;
        case 'group': {
            const rawKey = entity.scopeId.startsWith('group:') ? entity.scopeId.slice(6) : entity.scopeId;
            try {
                await assertCanReadGroup(viewer, rawKey);
            } catch {
                throw new Error('forbidden');
            }
            return;
        }
        case 'dm': {
            const raw = entity.scopeId.startsWith('dm:') ? entity.scopeId.slice(3) : entity.scopeId;
            const direct = parseDirectRoomId(raw);
            if (!direct) throw new Error('forbidden');
            if (viewer !== direct.low && viewer !== direct.high) throw new Error('forbidden');
            return;
        }
        default:
            throw new Error('forbidden');
    }
}

/**
 * Pure helper — given the existing payload, the option id the viewer voted
 * for, and the viewer's id, return the next `votes` map.
 *
 * Behavior depends on `payload.multiChoice`:
 *   - When unset / `false` (default, single-choice): remove the viewer from
 *     every other bucket and add them to the target. Idempotent re-cast on
 *     the same option is a no-op via the filter-then-add pattern.
 *   - When `true` (multi-choice): act as an independent toggle on the target
 *     bucket only. Re-casting on an option the viewer already voted for
 *     removes them from that option (other buckets untouched).
 *
 * Returns `null` when:
 *   - the option id is not present on the poll, OR
 *   - the poll is already closed (`closedAt` set), OR
 *   - the payload is malformed (no `options` array).
 *
 * On `null` the caller surfaces a 'not found' / 'closed' error.
 */
export function computeNextVotes(
    payload: SocialPayloadByKind['poll'],
    viewerUserId: string,
    optionId: string,
): Record<string, string[]> | null {
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.closedAt === 'string' && payload.closedAt.length > 0) return null;
    const options = Array.isArray(payload.options) ? payload.options : [];
    const known = new Set<string>();
    for (const opt of options) {
        if (opt && typeof opt.id === 'string') known.add(opt.id);
    }
    if (!known.has(optionId)) return null;

    const current = (payload.votes && typeof payload.votes === 'object') ? payload.votes : {};
    const multiChoice = payload.multiChoice === true;
    const next: Record<string, string[]> = {};

    if (multiChoice) {
        // Multi-choice: copy every bucket verbatim, then toggle viewer
        // inside the target bucket only. Touch zero other options so the
        // viewer keeps their independent picks across separate calls.
        for (const id of known) {
            const bucket = Array.isArray((current as Record<string, unknown>)[id])
                ? (current as Record<string, string[]>)[id]
                : [];
            next[id] = [...bucket];
        }
        const targetBucket = next[optionId];
        if (targetBucket.includes(viewerUserId)) {
            next[optionId] = targetBucket.filter((u) => u !== viewerUserId);
        } else {
            next[optionId] = [...targetBucket, viewerUserId];
        }
        return next;
    }

    // Single-choice: remove viewer from every existing bucket; copy buckets
    // verbatim otherwise. Then add viewer to the target option.
    for (const id of known) {
        const bucket = Array.isArray((current as Record<string, unknown>)[id])
            ? (current as Record<string, string[]>)[id]
            : [];
        next[id] = bucket.filter((u) => u !== viewerUserId);
    }
    next[optionId] = [...next[optionId], viewerUserId];
    return next;
}

/**
 * Pure helper — drop the viewer from every option bucket. Used by `unvote`.
 * Returns `null` when the poll is closed or malformed (mirrors
 * `computeNextVotes`).
 */
export function computeUnvotedVotes(
    payload: SocialPayloadByKind['poll'],
    viewerUserId: string,
): Record<string, string[]> | null {
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.closedAt === 'string' && payload.closedAt.length > 0) return null;
    const options = Array.isArray(payload.options) ? payload.options : [];
    const known = new Set<string>();
    for (const opt of options) {
        if (opt && typeof opt.id === 'string') known.add(opt.id);
    }
    const current = (payload.votes && typeof payload.votes === 'object') ? payload.votes : {};
    const next: Record<string, string[]> = {};
    for (const id of known) {
        const bucket = Array.isArray((current as Record<string, unknown>)[id])
            ? (current as Record<string, string[]>)[id]
            : [];
        next[id] = bucket.filter((u) => u !== viewerUserId);
    }
    return next;
}

/**
 * Pure helper — derive the viewer's currently-selected option (single-choice).
 * Returns `null` when the viewer hasn't voted. Used by every public helper as
 * the return-shape contract so the client can re-render the "Unvote"
 * affordance without a follow-up fetch.
 *
 * For multi-choice polls this surfaces the *first* option the viewer is in
 * (insertion order of the votes map) — callers that need every selection
 * should use `deriveMyVotes` (plural) instead.
 */
export function deriveMyVote(
    votes: Record<string, string[]>,
    viewerUserId: string,
): string | null {
    for (const [optionId, voters] of Object.entries(votes)) {
        if (Array.isArray(voters) && voters.includes(viewerUserId)) return optionId;
    }
    return null;
}

/**
 * Pure helper — every option the viewer has voted for. Returns an empty array
 * when the viewer hasn't voted. Same iteration order as `Object.entries`
 * (insertion order). Used by multi-choice polls so the UI can highlight every
 * selected checkbox without a follow-up fetch.
 */
export function deriveMyVotes(
    votes: Record<string, string[]>,
    viewerUserId: string,
): string[] {
    const out: string[] = [];
    for (const [optionId, voters] of Object.entries(votes)) {
        if (Array.isArray(voters) && voters.includes(viewerUserId)) out.push(optionId);
    }
    return out;
}

async function loadPollRow(client: PoolClient, pollId: string): Promise<EntityRow | null> {
    const result = await client.query<EntityRow>(
        `select * from app_social_entity where id = $1::uuid`,
        [pollId],
    );
    if (result.rowCount === 0) return null;
    return result.rows[0];
}

async function persistVotes(
    client: PoolClient,
    entityId: string,
    payload: SocialPayloadByKind['poll'],
    nextVotes: Record<string, string[]>,
    actorUserId: string,
): Promise<SocialPayloadByKind['poll']> {
    const merged: SocialPayloadByKind['poll'] = { ...payload, votes: nextVotes };
    await client.query(
        `
            update app_social_entity
            set payload = $2::jsonb, updated_at = now()
            where id = $1::uuid
        `,
        [entityId, JSON.stringify(merged)],
    );
    // Revision row so the audit trail mirrors regular updates. Note: we
    // deliberately mark the revision as 'update' instead of inventing a new
    // kind — votes ARE a payload change, and downstream consumers (revision
    // viewer) already handle 'update' rows.
    await client.query(
        `
            insert into app_social_revision
                (entity_id, author_user_id, snapshot, revision_kind, note)
            values ($1, $2, $3::jsonb, 'update', $4)
        `,
        [entityId, actorUserId, JSON.stringify(merged), 'vote'],
    );
    return merged;
}

export interface PollVoteResult {
    votes: Record<string, string[]>;
    /**
     * Viewer's currently-selected option for single-choice polls (or the
     * first selection in iteration order for multi-choice). Kept as the
     * legacy contract so existing single-choice clients don't break.
     */
    myVote: string | null;
    /**
     * Every option the viewer has voted for. Always an array — single
     * element for single-choice polls, 0..N for multi-choice. Clients that
     * support multi-choice should drive UI off this field.
     */
    myVotes: string[];
}

/**
 * Cast / move a single-choice vote on a poll.
 *
 * Authorization rules:
 *   - viewer must have scope read access (see `assertCanVoteOnPoll`)
 *   - poll must be the kind='poll' entity (other kinds throw 'not found')
 *   - poll must not be soft-deleted (throws 'not found')
 *   - poll must not be closed (throws 'poll closed')
 *   - optionId must be a known option (throws 'invalid option')
 *
 * Throws on every failure — the route layer maps these to status codes.
 */
export async function vote(
    pollId: string,
    viewerUserId: string,
    optionId: string,
): Promise<PollVoteResult> {
    const trimmedPoll = (pollId || '').trim();
    const trimmedViewer = (viewerUserId || '').trim();
    const trimmedOption = (optionId || '').trim();
    if (!trimmedPoll) throw new Error('pollId is required');
    if (!trimmedViewer) throw new Error('viewerUserId is required');
    if (!trimmedOption) throw new Error('optionId is required');

    return requirePollPostgres('vote', async (client) => {
        const row = await loadPollRow(client, trimmedPoll);
        if (!row) throw new Error('not found');
        if (row.deleted_at) throw new Error('not found');
        if (row.kind !== 'poll') throw new Error('not found');

        const entity = mapEntityRow(row);
        await assertCanVoteOnPoll(entity, trimmedViewer);

        const nextVotes = computeNextVotes(entity.payload, trimmedViewer, trimmedOption);
        if (nextVotes === null) {
            // Distinguish "closed" from "invalid option" using payload state
            // directly so the route layer can pick the right status code.
            const payload = entity.payload;
            if (payload && typeof payload.closedAt === 'string' && payload.closedAt.length > 0) {
                throw new Error('poll closed');
            }
            throw new Error('invalid option');
        }

        await persistVotes(client, entity.id, entity.payload, nextVotes, trimmedViewer);
        return {
            votes: nextVotes,
            myVote: deriveMyVote(nextVotes, trimmedViewer),
            myVotes: deriveMyVotes(nextVotes, trimmedViewer),
        };
    });
}

/**
 * Remove the viewer's vote (if any) from the poll. Idempotent — calling on a
 * poll where the viewer hasn't voted is a no-op success. Same scope / kind /
 * deleted / closed rules as `vote`.
 */
export async function unvote(
    pollId: string,
    viewerUserId: string,
): Promise<PollVoteResult> {
    const trimmedPoll = (pollId || '').trim();
    const trimmedViewer = (viewerUserId || '').trim();
    if (!trimmedPoll) throw new Error('pollId is required');
    if (!trimmedViewer) throw new Error('viewerUserId is required');

    return requirePollPostgres('unvote', async (client) => {
        const row = await loadPollRow(client, trimmedPoll);
        if (!row) throw new Error('not found');
        if (row.deleted_at) throw new Error('not found');
        if (row.kind !== 'poll') throw new Error('not found');

        const entity = mapEntityRow(row);
        await assertCanVoteOnPoll(entity, trimmedViewer);

        const nextVotes = computeUnvotedVotes(entity.payload, trimmedViewer);
        if (nextVotes === null) {
            throw new Error('poll closed');
        }

        await persistVotes(client, entity.id, entity.payload, nextVotes, trimmedViewer);
        return {
            votes: nextVotes,
            myVote: null,
            myVotes: [],
        };
    });
}

/**
 * Close a poll. Author-only — non-authors get 'forbidden'. Idempotent: if the
 * poll is already closed we return without writing a revision.
 *
 * Closing freezes the vote state — subsequent `vote` / `unvote` calls return
 * 'poll closed'. We deliberately do NOT delete the existing votes; the
 * winning option is computed by the UI from the final tally.
 */
export async function closePoll(pollId: string, actorUserId: string): Promise<void> {
    const trimmedPoll = (pollId || '').trim();
    const trimmedActor = (actorUserId || '').trim();
    if (!trimmedPoll) throw new Error('pollId is required');
    if (!trimmedActor) throw new Error('actorUserId is required');

    await requirePollPostgres('closePoll', async (client) => {
        const row = await loadPollRow(client, trimmedPoll);
        if (!row) throw new Error('not found');
        if (row.deleted_at) throw new Error('not found');
        if (row.kind !== 'poll') throw new Error('not found');
        if (row.author_user_id !== trimmedActor) throw new Error('forbidden');

        const entity = mapEntityRow(row);
        const payload = entity.payload;
        if (payload && typeof payload.closedAt === 'string' && payload.closedAt.length > 0) {
            // Already closed — idempotent no-op.
            return;
        }

        const nowIso = new Date().toISOString();
        const merged: SocialPayloadByKind['poll'] = { ...payload, closedAt: nowIso };
        await client.query(
            `
                update app_social_entity
                set payload = $2::jsonb, updated_at = now()
                where id = $1::uuid
            `,
            [trimmedPoll, JSON.stringify(merged)],
        );
        await client.query(
            `
                insert into app_social_revision
                    (entity_id, author_user_id, snapshot, revision_kind, note)
                values ($1, $2, $3::jsonb, 'update', 'close')
            `,
            [trimmedPoll, trimmedActor, JSON.stringify(merged)],
        );
    });
}
