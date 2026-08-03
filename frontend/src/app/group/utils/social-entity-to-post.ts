/**
 * Adapter from `SocialEntityView` (universal social store) → `GroupPostView`
 * (legacy group-feed shape consumed by `PostCard` and the feed hook).
 *
 * Used by the `socialFeedBeta` opt-in path: when enabled, the group feed reads
 * from `/api/v3/social/scope/group/group:<key>/entities?kind=post` instead of
 * `/api/v3/group/feed`. The adapter keeps existing UI components — including
 * the `ReactionsBar` and `PostCard` props contract — unchanged.
 *
 * Mapping rules (mirror the Phase 1c shim in `backend/src/services/group-posts-shim.ts`):
 *  - `scopeId` is `group:<groupKey>`; we strip the `group:` prefix to recover
 *    the bare group key.
 *  - `payload` for a `post` entity is `{ title?, body, tags? }`. Title is
 *    coerced to an empty string when missing so the UI does not render
 *    `undefined`.
 *  - Reactions are aggregated server-side and arrive as
 *    `{ reactions: [{emoji,count}], myReactions: string[] }`; we re-shape
 *    them into the `{ items, mine }` envelope that `PostCard` expects.
 *  - Soft-delete fields (`deletedAt`) survive; legacy `deletedBy` is mapped
 *    from `deletedByUserId` so the trash list keeps working.
 *
 * Pure function — no React, no fetch. Used by the hook AND by tests directly.
 */
import type { GroupPostView } from '@/lib/api';
import type { SocialEntityView } from '@/lib/api/social';

const SCOPE_PREFIX = 'group:';

/**
 * Pull a string field from a free-form payload bag, falling back to `''`
 * when it is missing or not a string. The backend schema validates payload
 * shape, but JSON-loaded data is still typed as `unknown` on the client.
 */
function readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
}

function readTags(payload: Record<string, unknown>): string[] {
    const value = payload['tags'];
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is string => typeof item === 'string');
}

function stripGroupPrefix(scopeId: string): string {
    return scopeId.startsWith(SCOPE_PREFIX) ? scopeId.slice(SCOPE_PREFIX.length) : scopeId;
}

/**
 * `GroupPostView` does not currently carry tags, but we surface them via the
 * return type so downstream code can opt-in to read them without another
 * narrowing cast. They are returned alongside the view rather than dropped.
 */
export interface SocialPostAdapterResult extends GroupPostView {
    /**
     * Tags lifted from the social-entity payload. Present even when the
     * legacy feed lacks them, so beta-mode UI can show them without falling
     * back to a separate API call. Empty array when absent.
     */
    tags: string[];
}

export function socialEntityToPostView(view: SocialEntityView): SocialPostAdapterResult {
    const entity = view.entity;
    const payload = entity.payload || {};
    return {
        id: entity.id,
        groupKey: stripGroupPrefix(entity.scopeId),
        title: readString(payload, 'title'),
        body: readString(payload, 'body'),
        authorUserId: entity.authorUserId,
        pinned: entity.pinned,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        deletedAt: entity.deletedAt,
        deletedBy: entity.deletedByUserId,
        reactions: {
            items: view.reactions.map((aggregate) => ({
                emoji: aggregate.emoji,
                count: aggregate.count,
            })),
            mine: [...view.myReactions],
        },
        tags: readTags(payload),
    };
}
