/**
 * Phase 1c — backward-compatibility shim for group tasks.
 *
 * Mirrors every legacy write into `app_group_tasks` (via services/group-space.ts)
 * into the universal `app_social_entity` store under `kind='task'`. Legacy is
 * still source-of-truth for reads; the universal store is being populated in
 * parallel so Phase 1d's read-flip has no gaps.
 *
 * Failure mode: **non-fatal**. If any new-store call throws, we log and
 * swallow — the caller's legacy write already succeeded. This is deliberate so
 * a bug in the universal layer cannot break production task writes.
 *
 * Legacy → payload mapping (kind='task'):
 *   - legacy `title`        → payload.title
 *   - legacy `description`  → payload.body (`description ?? subject ?? ''`)
 *   - legacy `deadline`     → payload.dueAt (ISO string when present)
 *
 * Per-user completion (payload.completedByUserIds / assignedUserIds) is
 * intentionally NOT mirrored in Phase 1c — the legacy schema stores a single
 * `completed` boolean which is not equivalent to a per-user set, and reconciling
 * the two models belongs to the Phase 1d copy-write migration. Toggle-completion
 * calls in group-space.ts deliberately skip the shim. See docs/SOCIAL_STORE.md.
 */

import { withSupabasePostgres } from '../db/postgres.js';
import {
    buildScopeId,
    createEntity,
    restoreEntity,
    softDeleteEntity,
    updateEntity,
} from './social.js';

async function fetchSocialEntityIdForLegacyTask(taskId: string): Promise<string | null> {
    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{ social_entity_id: string | null }>(
            `select social_entity_id from app_group_tasks where id = $1 limit 1`,
            [taskId]
        );
        return rows.rows[0]?.social_entity_id ?? null;
    });
    return result ?? null;
}

async function persistSocialEntityIdOnLegacyTask(taskId: string, socialEntityId: string): Promise<void> {
    await withSupabasePostgres(async (client) => {
        await client.query(
            `update app_group_tasks set social_entity_id = $2 where id = $1`,
            [taskId, socialEntityId]
        );
        return null;
    });
}

function logShimFailure(operation: string, legacyId: string, error: unknown): void {
    console.error(`[social shim] dual-write ${operation} failed for group_tasks`, {
        legacyId,
        error: error instanceof Error ? error.message : String(error),
    });
}

export async function shimMirrorCreateGroupTask(args: {
    legacyId: string;
    groupKey: string;
    authorUserId: string;
    title: string;
    body: string;
    dueAt?: string | null;
}): Promise<void> {
    try {
        const payload: { title: string; body: string; dueAt?: string } = {
            title: args.title,
            body: args.body,
        };
        if (args.dueAt) payload.dueAt = args.dueAt;
        const entity = await createEntity({
            kind: 'task',
            scopeType: 'group',
            scopeId: buildScopeId('group', args.groupKey),
            authorUserId: args.authorUserId,
            payload,
        });
        await persistSocialEntityIdOnLegacyTask(args.legacyId, entity.id);
    } catch (error) {
        // Non-fatal: legacy write already succeeded; mirror is best-effort.
        logShimFailure('create', args.legacyId, error);
    }
}

export async function shimMirrorUpdateGroupTask(args: {
    legacyId: string;
    groupKey: string;
    authorUserId: string;
    title: string;
    body: string;
    dueAt?: string | null;
}): Promise<void> {
    try {
        const patch: { title: string; body: string; dueAt?: string } = {
            title: args.title,
            body: args.body,
        };
        if (args.dueAt) patch.dueAt = args.dueAt;

        const existingSocialId = await fetchSocialEntityIdForLegacyTask(args.legacyId);
        if (existingSocialId) {
            await updateEntity(existingSocialId, args.authorUserId, patch);
            return;
        }
        // Rare case: legacy row predates the shim, so there's no mirror yet.
        // Create one now so subsequent writes can update it normally.
        const entity = await createEntity({
            kind: 'task',
            scopeType: 'group',
            scopeId: buildScopeId('group', args.groupKey),
            authorUserId: args.authorUserId,
            payload: patch,
        });
        await persistSocialEntityIdOnLegacyTask(args.legacyId, entity.id);
    } catch (error) {
        logShimFailure('update', args.legacyId, error);
    }
}

export async function shimMirrorSoftDeleteGroupTask(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyTask(args.legacyId);
        if (!socialId) return; // nothing to mirror
        await softDeleteEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('soft-delete', args.legacyId, error);
    }
}

export async function shimMirrorRestoreGroupTask(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyTask(args.legacyId);
        if (!socialId) return;
        await restoreEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('restore', args.legacyId, error);
    }
}

// Permanent delete: we intentionally do NOT hard-delete the mirror entity.
// Leaving it soft-deleted preserves the audit trail in app_social_revision
// (revision rows reference the entity). The legacy task tables don't currently
// expose a permanent-delete operation at the route layer, but the helper is
// kept symmetric with group-posts-shim for when that lands.
export async function shimMirrorPermanentDeleteGroupTask(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyTask(args.legacyId);
        if (!socialId) return;
        await softDeleteEntity(socialId, args.actorUserId, 'permanent-delete');
    } catch (error) {
        logShimFailure('permanent-delete', args.legacyId, error);
    }
}
