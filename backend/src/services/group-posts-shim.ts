/**
 * Phase 1c — backward-compatibility shim for group posts.
 *
 * Every legacy write into `app_group_posts` (via services/group-space.ts) is
 * mirrored into the universal `app_social_entity` store. Legacy is still
 * source-of-truth for reads; the new store is being populated in parallel so
 * Phase 1d's read-flip has no gaps.
 *
 * Failure mode: **non-fatal**. If any new-store call throws, we log and
 * swallow — the caller's legacy write already succeeded and the system stays
 * functional. This is deliberate so a bug in the universal layer cannot break
 * production group-feed writes.
 *
 * Only group posts (`kind='post'`) are shimmed in this phase. Tasks, extra
 * lessons, announcements, DM and global chat messages remain pure-legacy until
 * subsequent iterations. See docs/SOCIAL_STORE.md.
 */

import { withSupabasePostgres } from '../db/postgres.js';
import {
    buildScopeId,
    createEntity,
    restoreEntity,
    softDeleteEntity,
    updateEntity,
} from './social.js';

async function fetchSocialEntityIdForLegacyPost(postId: string): Promise<string | null> {
    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{ social_entity_id: string | null }>(
            `select social_entity_id from app_group_posts where id = $1 limit 1`,
            [postId]
        );
        return rows.rows[0]?.social_entity_id ?? null;
    });
    return result ?? null;
}

async function persistSocialEntityIdOnLegacyPost(postId: string, socialEntityId: string): Promise<void> {
    await withSupabasePostgres(async (client) => {
        await client.query(
            `update app_group_posts set social_entity_id = $2 where id = $1`,
            [postId, socialEntityId]
        );
        return null;
    });
}

function logShimFailure(operation: string, legacyId: string, error: unknown): void {
    console.error(`[social shim] dual-write ${operation} failed for group_posts`, {
        legacyId,
        error: error instanceof Error ? error.message : String(error),
    });
}

export async function shimMirrorCreateGroupPost(args: {
    legacyId: string;
    groupKey: string;
    authorUserId: string;
    title: string;
    body: string;
}): Promise<void> {
    try {
        const entity = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: buildScopeId('group', args.groupKey),
            authorUserId: args.authorUserId,
            payload: { title: args.title, body: args.body },
        });
        await persistSocialEntityIdOnLegacyPost(args.legacyId, entity.id);
    } catch (error) {
        // Non-fatal: legacy write already succeeded; mirror is best-effort.
        logShimFailure('create', args.legacyId, error);
    }
}

export async function shimMirrorUpdateGroupPost(args: {
    legacyId: string;
    groupKey: string;
    authorUserId: string;
    title: string;
    body: string;
}): Promise<void> {
    try {
        const existingSocialId = await fetchSocialEntityIdForLegacyPost(args.legacyId);
        if (existingSocialId) {
            await updateEntity(existingSocialId, args.authorUserId, {
                title: args.title,
                body: args.body,
            });
            return;
        }
        // Rare case: legacy row predates the shim, so there's no mirror yet.
        // Create one now so subsequent writes can update it normally.
        const entity = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: buildScopeId('group', args.groupKey),
            authorUserId: args.authorUserId,
            payload: { title: args.title, body: args.body },
        });
        await persistSocialEntityIdOnLegacyPost(args.legacyId, entity.id);
    } catch (error) {
        logShimFailure('update', args.legacyId, error);
    }
}

export async function shimMirrorSoftDeleteGroupPost(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyPost(args.legacyId);
        if (!socialId) return; // nothing to mirror
        await softDeleteEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('soft-delete', args.legacyId, error);
    }
}

export async function shimMirrorRestoreGroupPost(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyPost(args.legacyId);
        if (!socialId) return;
        await restoreEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('restore', args.legacyId, error);
    }
}

// Permanent delete: we intentionally do NOT hard-delete the mirror entity.
// Leaving it soft-deleted preserves the audit trail in app_social_revision
// (revision rows reference the entity). Phase 1d may revisit this once read
// traffic is on the new store.
export async function shimMirrorPermanentDeleteGroupPost(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyPost(args.legacyId);
        if (!socialId) return;
        await softDeleteEntity(socialId, args.actorUserId, 'permanent-delete');
    } catch (error) {
        logShimFailure('permanent-delete', args.legacyId, error);
    }
}
