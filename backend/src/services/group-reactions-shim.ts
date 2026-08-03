/**
 * Phase 1c+d — backward-compatibility shim for group-feed reactions (side-data).
 *
 * Reactions are not a social entity — they're a small `(entity_id, user_id,
 * emoji)` triple that decorates one. Legacy writes go into
 * `app_group_feed_reactions` (post_id-keyed). The universal home is
 * `app_social_reaction` (entity_id-keyed against `app_social_entity`).
 *
 * Every legacy reaction add/remove via `services/group-reactions.ts` is mirrored
 * here. We resolve the mirror entity by reading the legacy post's
 * `social_entity_id` back-link (populated by `group-posts-shim.ts` on create).
 * If the link is absent — i.e. the legacy post predates the post-shim — we
 * log and no-op rather than fabricate a parent entity.
 *
 * Failure mode: **non-fatal**. The legacy reaction write has already succeeded
 * when we get here, so any throw from the universal layer is logged and
 * swallowed. This matches the contract of all six existing entity shims.
 *
 * Mapping decisions:
 *   - Add path: a direct INSERT into `app_social_reaction` with
 *     `ON CONFLICT (entity_id, user_id, emoji) DO NOTHING` so re-adding a
 *     reaction stays idempotent against double-fires.
 *   - Remove path: a direct DELETE keyed on the same composite. We deliberately
 *     do NOT call `services/social.ts#toggleReaction` for this — that helper
 *     toggles state, but we already know whether the legacy row was inserted
 *     or removed (the legacy toggle decided), so we want explicit add/remove
 *     primitives that mirror that decision precisely.
 *
 * See docs/SOCIAL_STORE.md → "Reactions side-data".
 */

import { withSupabasePostgres } from '../db/postgres.js';

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

function logShimFailure(operation: string, legacyPostId: string, error: unknown): void {
    console.error(`[social shim] dual-write ${operation} failed for group_feed_reactions`, {
        legacyPostId,
        error: error instanceof Error ? error.message : String(error),
    });
}

function logMissingLink(operation: string, legacyPostId: string): void {
    // Not an error — pre-shim posts legitimately have no mirror yet. The next
    // group-posts-shim update on the post would back-fill the link; reactions
    // on those orphan rows will be picked up by Phase 1d's backfill instead.
    console.warn(`[social shim] no social_entity_id link for ${operation} on group_feed_reactions`, {
        legacyPostId,
    });
}

/**
 * Mirror a legacy reaction insert into `app_social_reaction`. Called after
 * `services/group-reactions.ts#toggleReaction` has already written the legacy
 * row (the "added" branch).
 *
 * Idempotent at the SQL layer via `ON CONFLICT DO NOTHING` — re-adding the
 * same `(entity_id, user_id, emoji)` triple is a no-op.
 */
export async function shimMirrorAddGroupReaction(
    legacyPostId: string,
    userId: string,
    emoji: string
): Promise<void> {
    try {
        const socialEntityId = await fetchSocialEntityIdForLegacyPost(legacyPostId);
        if (!socialEntityId) {
            logMissingLink('add', legacyPostId);
            return;
        }
        await withSupabasePostgres(async (client) => {
            await client.query(
                `
                    insert into app_social_reaction (entity_id, user_id, emoji)
                    values ($1::uuid, $2, $3)
                    on conflict (entity_id, user_id, emoji) do nothing
                `,
                [socialEntityId, userId, emoji]
            );
            return null;
        });
    } catch (error) {
        logShimFailure('add', legacyPostId, error);
    }
}

/**
 * Mirror a legacy reaction delete into `app_social_reaction`. Called after
 * `services/group-reactions.ts#toggleReaction` has already removed the legacy
 * row (the "removed" branch).
 *
 * We issue an explicit DELETE rather than going through `social.ts#toggleReaction`
 * — toggleReaction would flip state based on current mirror contents, but the
 * legacy table is the source-of-truth during Phase 1, so we mirror the decision
 * verbatim. Deleting a non-existent row is a no-op, so this stays idempotent.
 */
export async function shimMirrorRemoveGroupReaction(
    legacyPostId: string,
    userId: string,
    emoji: string
): Promise<void> {
    try {
        const socialEntityId = await fetchSocialEntityIdForLegacyPost(legacyPostId);
        if (!socialEntityId) {
            logMissingLink('remove', legacyPostId);
            return;
        }
        await withSupabasePostgres(async (client) => {
            await client.query(
                `
                    delete from app_social_reaction
                    where entity_id = $1::uuid and user_id = $2 and emoji = $3
                `,
                [socialEntityId, userId, emoji]
            );
            return null;
        });
    } catch (error) {
        logShimFailure('remove', legacyPostId, error);
    }
}
