/**
 * Phase 1c — backward-compatibility shim for global chat messages.
 *
 * Mirrors every legacy write into `app_global_chat_messages` (via
 * services/global-chat.ts) into the universal `app_social_entity` store under
 * `kind='global_message'`. Legacy is still source-of-truth for reads; the
 * universal store is being populated in parallel so Phase 1d's read-flip has no
 * gaps.
 *
 * Failure mode: **non-fatal**. If any new-store call throws, we log and
 * swallow — the caller's legacy write already succeeded. This is deliberate so
 * a bug in the universal layer cannot break production global-chat writes.
 *
 * Legacy → payload mapping (kind='global_message'):
 *   - legacy `body`     → payload.body
 *   - (legacy table has no reply_to_message_id column today; if it returns,
 *      the helper signature already accepts replyToMessageId so callers can
 *      pass it through without a new arg.)
 *
 * Scope decision: the global chat is a single fixed channel — there is no
 * per-room concept like DMs have. We use scopeType='global' with the literal
 * scopeId 'global:chat'. All global-chat mirrors land in this one scope so the
 * universal `(scope_type, scope_id)` index stays small and predictable.
 *
 * Operations covered:
 *   - create  → universal createEntity
 *   - soft-delete → universal softDeleteEntity (legacy admin delete maps here;
 *     the actor passed in MUST be the original author because the social
 *     service enforces owner-only on soft-delete in Phase 1b. Callers (the
 *     legacy delete route is admin-only) must look up the message author and
 *     pass that as actorUserId.)
 *   - restore → universal restoreEntity (no legacy un-delete route today, but
 *     the helper is kept for the Phase 1d migration script.)
 *   - permanent-delete → soft-delete with the reason 'permanent-delete', kept
 *     symmetric with the other shims even though no legacy route exposes it.
 *
 * Pin/unpin (`setGlobalChatMessagePinned`) was removed in the /chat rewrite
 * and is therefore NOT shimmed here — there is no write path to mirror. When
 * the route returns, this shim should grow a `shimMirrorPinGlobalChatMessage`
 * helper that calls `pinEntity(socialEntityId, actorUserId, pinned)` from
 * services/social.js.
 *
 * User-state operations (mute, report, review-report) are NOT mirrored — they
 * are not "post-like" entities and belong to the legacy moderation surface.
 */

import { withSupabasePostgres } from '../db/postgres.js';
import {
    buildScopeId,
    createEntity,
    restoreEntity,
    softDeleteEntity,
    updateEntity,
} from './social.js';

const GLOBAL_CHAT_SCOPE_RAW = 'chat';

async function fetchSocialEntityIdForLegacyGlobalMessage(messageId: string): Promise<string | null> {
    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{ social_entity_id: string | null }>(
            `select social_entity_id from app_global_chat_messages where id = $1 limit 1`,
            [messageId]
        );
        return rows.rows[0]?.social_entity_id ?? null;
    });
    return result ?? null;
}

async function persistSocialEntityIdOnLegacyGlobalMessage(
    messageId: string,
    socialEntityId: string,
): Promise<void> {
    await withSupabasePostgres(async (client) => {
        await client.query(
            `update app_global_chat_messages set social_entity_id = $2 where id = $1`,
            [messageId, socialEntityId]
        );
        return null;
    });
}

function logShimFailure(operation: string, legacyId: string, error: unknown): void {
    console.error(`[social shim] dual-write ${operation} failed for global_chat_messages`, {
        legacyId,
        error: error instanceof Error ? error.message : String(error),
    });
}

interface GlobalMessageShimPayload {
    body: string;
    replyToMessageId?: string;
    editedAt?: string;
}

function buildPayload(args: {
    body: string;
    replyToMessageId?: string | null;
    editedAt?: string | null;
}): GlobalMessageShimPayload {
    const payload: GlobalMessageShimPayload = { body: args.body };
    if (args.replyToMessageId) {
        payload.replyToMessageId = args.replyToMessageId;
    }
    if (args.editedAt) {
        payload.editedAt = args.editedAt;
    }
    return payload;
}

export async function shimMirrorCreateGlobalChatMessage(args: {
    legacyId: string;
    authorUserId: string;
    body: string;
    replyToMessageId?: string | null;
}): Promise<void> {
    try {
        const entity = await createEntity({
            kind: 'global_message',
            scopeType: 'global',
            scopeId: buildScopeId('global', GLOBAL_CHAT_SCOPE_RAW),
            authorUserId: args.authorUserId,
            payload: buildPayload(args),
        });
        await persistSocialEntityIdOnLegacyGlobalMessage(args.legacyId, entity.id);
    } catch (error) {
        // Non-fatal: legacy write already succeeded; mirror is best-effort.
        logShimFailure('create', args.legacyId, error);
    }
}

/**
 * Update helper. The current /chat surface does not expose a global-message
 * edit endpoint, but the helper is kept for symmetry with the other shims and
 * so the Phase 1d migration can replay revisions cleanly if needed. When a
 * legacy edit endpoint returns, callers should pass `editedAt` so the mirror
 * payload preserves the timestamp alongside the body.
 */
export async function shimMirrorUpdateGlobalChatMessage(args: {
    legacyId: string;
    authorUserId: string;
    body: string;
    replyToMessageId?: string | null;
    editedAt?: string | null;
}): Promise<void> {
    try {
        const payload = buildPayload(args);
        const existingSocialId = await fetchSocialEntityIdForLegacyGlobalMessage(args.legacyId);
        if (existingSocialId) {
            await updateEntity(existingSocialId, args.authorUserId, payload);
            return;
        }
        // Rare case: legacy row predates the shim, so there's no mirror yet.
        // Create one now so subsequent writes can update it normally.
        const entity = await createEntity({
            kind: 'global_message',
            scopeType: 'global',
            scopeId: buildScopeId('global', GLOBAL_CHAT_SCOPE_RAW),
            authorUserId: args.authorUserId,
            payload,
        });
        await persistSocialEntityIdOnLegacyGlobalMessage(args.legacyId, entity.id);
    } catch (error) {
        logShimFailure('update', args.legacyId, error);
    }
}

export async function shimMirrorSoftDeleteGlobalChatMessage(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyGlobalMessage(args.legacyId);
        if (!socialId) return; // nothing to mirror
        await softDeleteEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('soft-delete', args.legacyId, error);
    }
}

export async function shimMirrorRestoreGlobalChatMessage(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyGlobalMessage(args.legacyId);
        if (!socialId) return;
        await restoreEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('restore', args.legacyId, error);
    }
}

// Permanent delete: we intentionally do NOT hard-delete the mirror entity.
// Leaving it soft-deleted preserves the audit trail in app_social_revision.
// The legacy global-chat route layer doesn't expose a permanent-delete
// operation either, but the helper is kept symmetric with the other shims.
export async function shimMirrorPermanentDeleteGlobalChatMessage(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyGlobalMessage(args.legacyId);
        if (!socialId) return;
        await softDeleteEntity(socialId, args.actorUserId, 'permanent-delete');
    } catch (error) {
        logShimFailure('permanent-delete', args.legacyId, error);
    }
}
