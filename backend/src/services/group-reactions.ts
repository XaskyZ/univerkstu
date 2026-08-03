/**
 * Group Space — Feed post reactions.
 *
 * Limited emoji set (5 fixed emojis), toggle semantics: posting an emoji a user
 * already has removes it, otherwise inserts. Privacy: aggregated reads return
 * only counts; the per-user picks ("mine") are queried separately by userId so
 * we never leak the full reactor list to other group members.
 *
 * Authorization is delegated to the route layer (`assertCanReadGroup`) before
 * calling these helpers — the service itself does not re-check membership.
 */
import { requireGroupSpacePostgres } from './group-space.js';
import {
    shimMirrorAddGroupReaction,
    shimMirrorRemoveGroupReaction,
} from './group-reactions-shim.js';

/**
 * The closed set of emojis the UI exposes. Any other value coming from the
 * client must be rejected at the route schema level AND here as defense in
 * depth — never store an arbitrary client string.
 */
export const ALLOWED_EMOJI = ['👍', '❤️', '😂', '🎉', '😢'] as const;
export type AllowedEmoji = (typeof ALLOWED_EMOJI)[number];

export function isAllowedEmoji(value: unknown): value is AllowedEmoji {
    return typeof value === 'string' && (ALLOWED_EMOJI as readonly string[]).includes(value);
}

export interface ReactionAggregate {
    emoji: string;
    count: number;
}

export interface ToggleReactionResult {
    added: boolean;
}

/**
 * Toggle a reaction: insert if missing, delete if present. Idempotent in the
 * sense that calling it twice returns the original state.
 */
export async function toggleReaction(
    postId: string,
    userId: string,
    emoji: string
): Promise<ToggleReactionResult> {
    if (!isAllowedEmoji(emoji)) {
        throw new Error('Emoji is not allowed');
    }
    const trimmedPostId = (postId || '').trim();
    const trimmedUserId = (userId || '').trim();
    if (!trimmedPostId) {
        throw new Error('postId is required');
    }
    if (!trimmedUserId) {
        throw new Error('userId is required');
    }

    const result = await requireGroupSpacePostgres('toggleReaction', async (client) => {
        const existing = await client.query(
            `select 1 from app_group_feed_reactions where post_id = $1 and user_id = $2 and emoji = $3 limit 1`,
            [trimmedPostId, trimmedUserId, emoji]
        );
        if (existing.rowCount > 0) {
            await client.query(
                `delete from app_group_feed_reactions where post_id = $1 and user_id = $2 and emoji = $3`,
                [trimmedPostId, trimmedUserId, emoji]
            );
            return { added: false };
        }
        await client.query(
            `
                insert into app_group_feed_reactions (post_id, user_id, emoji)
                values ($1, $2, $3)
                on conflict (post_id, user_id, emoji) do nothing
            `,
            [trimmedPostId, trimmedUserId, emoji]
        );
        return { added: true };
    });

    // Phase 1c dual-write: mirror the same decision into app_social_reaction.
    // Non-fatal — failures here must not break the legacy reaction path. The
    // mirror is keyed on the post's social_entity_id back-link; if the link is
    // missing (pre-shim post), the shim logs a warning and no-ops, leaving the
    // backfill in scripts/migrate-social-store.ts to pick it up later.
    if (result.added) {
        await shimMirrorAddGroupReaction(trimmedPostId, trimmedUserId, emoji);
    } else {
        await shimMirrorRemoveGroupReaction(trimmedPostId, trimmedUserId, emoji);
    }

    return result;
}

/**
 * Aggregated reactions for a single post. Returns only `{emoji, count}` —
 * userIds are never returned to keep individual votes private. Use
 * `getMyReactions` to know which emojis the current user toggled.
 */
export async function listReactions(postId: string): Promise<ReactionAggregate[]> {
    const trimmed = (postId || '').trim();
    if (!trimmed) {
        return [];
    }
    return requireGroupSpacePostgres('listReactions', async (client) => {
        const result = await client.query<{ emoji: string; count: string }>(
            `
                select emoji, count(*)::text as count
                from app_group_feed_reactions
                where post_id = $1
                group by emoji
                order by emoji asc
            `,
            [trimmed]
        );
        return result.rows
            .filter((row) => isAllowedEmoji(row.emoji))
            .map((row) => ({ emoji: row.emoji, count: Number(row.count) || 0 }));
    });
}

/**
 * Batch version for feed rendering: returns a Map keyed by postId with the
 * same per-post `{emoji, count}` aggregates. Posts with zero reactions are
 * absent from the map (callers should default to `[]`).
 */
export async function listReactionsForPosts(
    postIds: string[]
): Promise<Map<string, ReactionAggregate[]>> {
    const cleaned = Array.from(
        new Set(
            (postIds || [])
                .map((id) => (typeof id === 'string' ? id.trim() : ''))
                .filter(Boolean)
        )
    );
    const out = new Map<string, ReactionAggregate[]>();
    if (cleaned.length === 0) {
        return out;
    }
    const result = await requireGroupSpacePostgres('listReactionsForPosts', async (client) =>
        client.query<{ post_id: string; emoji: string; count: string }>(
            `
                select post_id::text as post_id, emoji, count(*)::text as count
                from app_group_feed_reactions
                where post_id = any($1::uuid[])
                group by post_id, emoji
                order by emoji asc
            `,
            [cleaned]
        )
    );
    for (const row of result.rows) {
        if (!isAllowedEmoji(row.emoji)) continue;
        const bucket = out.get(row.post_id) || [];
        bucket.push({ emoji: row.emoji, count: Number(row.count) || 0 });
        out.set(row.post_id, bucket);
    }
    return out;
}

/**
 * Per-user "mine" lookup for a batch of posts: which emojis did `userId`
 * toggle for each post. Posts with no reactions from this user are absent
 * from the map.
 */
export async function getMyReactions(
    postIds: string[],
    userId: string
): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    const cleanedUser = (userId || '').trim();
    if (!cleanedUser) return out;
    const cleaned = Array.from(
        new Set(
            (postIds || [])
                .map((id) => (typeof id === 'string' ? id.trim() : ''))
                .filter(Boolean)
        )
    );
    if (cleaned.length === 0) return out;
    const result = await requireGroupSpacePostgres('getMyReactions', async (client) =>
        client.query<{ post_id: string; emoji: string }>(
            `
                select post_id::text as post_id, emoji
                from app_group_feed_reactions
                where user_id = $1 and post_id = any($2::uuid[])
            `,
            [cleanedUser, cleaned]
        )
    );
    for (const row of result.rows) {
        if (!isAllowedEmoji(row.emoji)) continue;
        const bucket = out.get(row.post_id) || [];
        bucket.push(row.emoji);
        out.set(row.post_id, bucket);
    }
    return out;
}
