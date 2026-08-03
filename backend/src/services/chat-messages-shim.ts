/**
 * Phase 1c — backward-compatibility shim for direct chat messages (DMs).
 *
 * Mirrors every legacy write into `app_chat_messages` (via services/messaging.ts)
 * into the universal `app_social_entity` store under `kind='dm_message'`. Legacy
 * is still source-of-truth for reads; the universal store is being populated in
 * parallel so Phase 1d's read-flip has no gaps.
 *
 * Failure mode: **non-fatal**. If any new-store call throws, we log and
 * swallow — the caller's legacy write already succeeded. This is deliberate so
 * a bug in the universal layer cannot break production DM writes.
 *
 * Legacy → payload mapping (kind='dm_message'):
 *   - legacy `body`                 → payload.body
 *   - legacy `reply_to_message_id`  → payload.replyToMessageId (when present)
 *   - legacy `edited_at`            → payload.editedAt (ISO string when set)
 *
 * Scope decision: each DM room is its own scope. The legacy room_id is already
 * namespaced (e.g. `direct:alice::bob`), so we pass it through `buildScopeId`
 * with scopeType='dm'. `buildScopeId` is idempotent on already-prefixed values
 * which preserves the existing room identifiers while still labelling them
 * correctly under the universal model. Example final scopeId: `dm:direct:a::b`.
 *
 * Operations covered: create, update (back-fill mirror when missing — used if
 * an edit endpoint is ever restored; the current /chat surface removed it),
 * soft-delete, restore, permanent-delete. The helpers are kept symmetric with
 * the other shims (group_posts / group_tasks / group_extra_lessons / coordinator
 * announcements) for when the matching legacy routes land.
 *
 * Per Phase 1c rules, user-state operations (mark-read, block, mute) are NOT
 * mirrored — they are not "post-like" entities and belong to the legacy
 * messaging surface untouched.
 */

import { withSupabasePostgres } from '../db/postgres.js';
import {
    buildScopeId,
    createEntity,
    restoreEntity,
    softDeleteEntity,
    updateEntity,
} from './social.js';

async function fetchSocialEntityIdForLegacyChatMessage(messageId: string): Promise<string | null> {
    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{ social_entity_id: string | null }>(
            `select social_entity_id from app_chat_messages where id = $1 limit 1`,
            [messageId]
        );
        return rows.rows[0]?.social_entity_id ?? null;
    });
    return result ?? null;
}

async function persistSocialEntityIdOnLegacyChatMessage(
    messageId: string,
    socialEntityId: string,
): Promise<void> {
    await withSupabasePostgres(async (client) => {
        await client.query(
            `update app_chat_messages set social_entity_id = $2 where id = $1`,
            [messageId, socialEntityId]
        );
        return null;
    });
}

function logShimFailure(operation: string, legacyId: string, error: unknown): void {
    console.error(`[social shim] dual-write ${operation} failed for chat_messages`, {
        legacyId,
        error: error instanceof Error ? error.message : String(error),
    });
}

interface DmMessageShimPayload {
    body: string;
    replyToMessageId?: string;
    editedAt?: string;
}

function buildPayload(args: {
    body: string;
    replyToMessageId?: string | null;
    editedAt?: string | null;
}): DmMessageShimPayload {
    const payload: DmMessageShimPayload = { body: args.body };
    if (args.replyToMessageId) {
        payload.replyToMessageId = args.replyToMessageId;
    }
    if (args.editedAt) {
        payload.editedAt = args.editedAt;
    }
    return payload;
}

export async function shimMirrorCreateChatMessage(args: {
    legacyId: string;
    roomId: string;
    authorUserId: string;
    body: string;
    replyToMessageId?: string | null;
}): Promise<void> {
    try {
        const entity = await createEntity({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: buildScopeId('dm', args.roomId),
            authorUserId: args.authorUserId,
            payload: buildPayload(args),
        });
        await persistSocialEntityIdOnLegacyChatMessage(args.legacyId, entity.id);
    } catch (error) {
        // Non-fatal: legacy write already succeeded; mirror is best-effort.
        logShimFailure('create', args.legacyId, error);
    }
}

export async function shimMirrorUpdateChatMessage(args: {
    legacyId: string;
    roomId: string;
    authorUserId: string;
    body: string;
    replyToMessageId?: string | null;
    editedAt?: string | null;
}): Promise<void> {
    try {
        const payload = buildPayload(args);
        const existingSocialId = await fetchSocialEntityIdForLegacyChatMessage(args.legacyId);
        if (existingSocialId) {
            await updateEntity(existingSocialId, args.authorUserId, payload);
            return;
        }
        // Rare case: legacy row predates the shim, so there's no mirror yet.
        // Create one now so subsequent writes can update it normally.
        const entity = await createEntity({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: buildScopeId('dm', args.roomId),
            authorUserId: args.authorUserId,
            payload,
        });
        await persistSocialEntityIdOnLegacyChatMessage(args.legacyId, entity.id);
    } catch (error) {
        logShimFailure('update', args.legacyId, error);
    }
}

export async function shimMirrorSoftDeleteChatMessage(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyChatMessage(args.legacyId);
        if (!socialId) return; // nothing to mirror
        await softDeleteEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('soft-delete', args.legacyId, error);
    }
}

export async function shimMirrorRestoreChatMessage(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyChatMessage(args.legacyId);
        if (!socialId) return;
        await restoreEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('restore', args.legacyId, error);
    }
}

// Permanent delete: we intentionally do NOT hard-delete the mirror entity.
// Leaving it soft-deleted preserves the audit trail in app_social_revision
// (revision rows reference the entity). The legacy DM route layer doesn't
// currently expose a permanent-delete operation, but the helper is kept
// symmetric with the other shims for when that lands.
export async function shimMirrorPermanentDeleteChatMessage(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyChatMessage(args.legacyId);
        if (!socialId) return;
        await softDeleteEntity(socialId, args.actorUserId, 'permanent-delete');
    } catch (error) {
        logShimFailure('permanent-delete', args.legacyId, error);
    }
}
