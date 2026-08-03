/**
 * Unified write-path wrappers for the group-feed POC.
 *
 * Each function decides — based on the `useSocialBeta` flag the caller passes
 * in — whether to write through the **legacy** group API (`/api/v3/group/...`,
 * Phase 1c shim mirrors the change into `app_social_entity` server-side) or
 * **directly** through the universal social store (`/api/v3/social/*`). This
 * validates that the universal store can serve the write path end-to-end while
 * the legacy table is still source of truth for everything else.
 *
 * Boundaries:
 *  - Wrappers are pure: the flag is an argument, not a global lookup. Lets
 *    callers (and tests) flip it without re-rendering React state.
 *  - APIs are injected via the second-to-last `deps` argument so tests can pass
 *    fakes instead of monkey-patching ESM bindings (the repo convention — see
 *    `loadGroupFeedSocial` in `useGroupFeedSocial.ts`).
 *  - Returned envelope is `ApiResponse<unknown>` — handlers downstream only
 *    branch on `success` + `error`; reusing the legacy shape avoids changing
 *    `FeedTab` error / refresh logic.
 *
 * **ID mapping rule** when `useSocialBeta` is on:
 *  - `postId` is the **`app_social_entity.id`** (uuid). The read path
 *    (`useGroupFeedSocial` → `socialEntityToPostView`) already surfaces
 *    `entity.id` as `post.id`, so the value coming back into update / delete /
 *    reaction handlers is the social id, not the legacy `app_group_posts.id`.
 *  - Conversely, when `useSocialBeta` is off, `postId` is the legacy id —
 *    matches the existing `useGroupFeed` contract.
 *
 * **Pin handling**: legacy has no dedicated pin endpoint — the `pinned` field
 * piggybacks on `updateGroupFeedPost`. To keep the wrapper surface uniform,
 * `pinPostUnified` calls `pinSocialEntity` when the flag is on and falls back
 * to a no-op `ApiResponse` with an explanatory error when off (callers should
 * use `updatePostUnified` with the `pinned` flag in legacy mode — that path
 * remains the canonical way to flip pin state pre-cutover).
 */
import {
    createGroupFeedPost as createGroupFeedPostLegacy,
    deleteGroupFeedPost as deleteGroupFeedPostLegacy,
    permanentlyDeleteGroupFeedPost as permanentlyDeleteGroupFeedPostLegacy,
    restoreDeletedGroupFeedPost as restoreDeletedGroupFeedPostLegacy,
    toggleGroupPostReaction as toggleGroupPostReactionLegacy,
    updateGroupFeedPost as updateGroupFeedPostLegacy,
} from '@/lib/api/group';
import type { ApiResponse } from '@/lib/api/core';
import {
    createSocialEntity as createSocialEntityDefault,
    deleteSocialEntity as deleteSocialEntityDefault,
    pinSocialEntity as pinSocialEntityDefault,
    restoreSocialEntity as restoreSocialEntityDefault,
    toggleSocialReaction as toggleSocialReactionDefault,
    updateSocialEntity as updateSocialEntityDefault,
} from '@/lib/api/social';

// === Shared types ===========================================================

export interface PostInput {
    title?: string;
    body: string;
    tags?: string[];
    pinned?: boolean;
}

/**
 * Surface every API binding the wrappers need so tests can inject fakes
 * piecemeal without satisfying the entire shape every time.
 */
export interface SocialFeedActionDeps {
    // social (universal store)
    createSocialEntity?: typeof createSocialEntityDefault;
    updateSocialEntity?: typeof updateSocialEntityDefault;
    deleteSocialEntity?: typeof deleteSocialEntityDefault;
    restoreSocialEntity?: typeof restoreSocialEntityDefault;
    pinSocialEntity?: typeof pinSocialEntityDefault;
    toggleSocialReaction?: typeof toggleSocialReactionDefault;
    // legacy (group feed)
    createGroupFeedPost?: typeof createGroupFeedPostLegacy;
    updateGroupFeedPost?: typeof updateGroupFeedPostLegacy;
    deleteGroupFeedPost?: typeof deleteGroupFeedPostLegacy;
    restoreDeletedGroupFeedPost?: typeof restoreDeletedGroupFeedPostLegacy;
    permanentlyDeleteGroupFeedPost?: typeof permanentlyDeleteGroupFeedPostLegacy;
    toggleGroupPostReaction?: typeof toggleGroupPostReactionLegacy;
}

// === Helpers ================================================================

/**
 * Build the social-entity payload from a `PostInput`. Drops `undefined` fields
 * so the backend AJV validator does not reject the body for explicit-undefined
 * keys (it accepts missing keys but not `key: undefined` once stringified).
 */
function buildPostPayload(input: PostInput): Record<string, unknown> {
    const payload: Record<string, unknown> = { body: input.body };
    if (typeof input.title === 'string') payload.title = input.title;
    if (Array.isArray(input.tags)) payload.tags = input.tags;
    return payload;
}

// === Create =================================================================

/**
 * `createPostUnified` — beta path POSTs a `post`-kind entity into the social
 * store under `group:<groupKey>`; legacy path calls the existing group-feed
 * create. The legacy variant also accepts a `pinned` flag at create time;
 * the social variant has no equivalent shortcut — newly-created entities are
 * never pinned, so callers must follow up with `pinPostUnified` if needed.
 */
export async function createPostUnified(
    groupKey: string,
    input: PostInput,
    useSocialBeta: boolean,
    deps: SocialFeedActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const createSocial = deps.createSocialEntity ?? createSocialEntityDefault;
        return createSocial({
            kind: 'post',
            scopeType: 'group',
            scopeId: `group:${groupKey}`,
            payload: buildPostPayload(input),
        });
    }
    const createLegacy = deps.createGroupFeedPost ?? createGroupFeedPostLegacy;
    return createLegacy(input.title ?? '', input.body, groupKey, input.pinned ?? false);
}

// === Update =================================================================

/**
 * `updatePostUnified` — beta path PATCHes the entity payload (only the diff is
 * sent); legacy path POSTs the full title/body/pinned triple. The legacy API
 * cannot represent "leave field as-is", so we coerce missing fields to empty
 * strings / current pinned state — callers must therefore include `title` and
 * `body` in the patch when in legacy mode.
 */
export async function updatePostUnified(
    postId: string,
    patch: Partial<PostInput>,
    useSocialBeta: boolean,
    deps: SocialFeedActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const updateSocial = deps.updateSocialEntity ?? updateSocialEntityDefault;
        // The social PATCH expects the payload diff under `patch.payload`. The
        // API client wraps the body in `{ patch: ... }`, so we hand it the
        // shape it expects to pass through.
        const socialPatch: Record<string, unknown> = {};
        const payloadDiff: Record<string, unknown> = {};
        if (typeof patch.title === 'string') payloadDiff.title = patch.title;
        if (typeof patch.body === 'string') payloadDiff.body = patch.body;
        if (Array.isArray(patch.tags)) payloadDiff.tags = patch.tags;
        if (Object.keys(payloadDiff).length > 0) socialPatch.payload = payloadDiff;
        if (typeof patch.pinned === 'boolean') socialPatch.pinned = patch.pinned;
        return updateSocial(postId, socialPatch);
    }
    const updateLegacy = deps.updateGroupFeedPost ?? updateGroupFeedPostLegacy;
    return updateLegacy(postId, patch.title ?? '', patch.body ?? '', patch.pinned ?? false);
}

// === Delete (soft) ==========================================================

/**
 * `deletePostUnified` — soft delete in both modes. `reason` only flows through
 * on the beta path (the legacy endpoint has no reason parameter).
 */
export async function deletePostUnified(
    postId: string,
    reason: string | undefined,
    useSocialBeta: boolean,
    deps: SocialFeedActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(postId, reason);
    }
    const deleteLegacy = deps.deleteGroupFeedPost ?? deleteGroupFeedPostLegacy;
    return deleteLegacy(postId);
}

// === Restore ================================================================

export async function restorePostUnified(
    postId: string,
    useSocialBeta: boolean,
    deps: SocialFeedActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const restoreSocial = deps.restoreSocialEntity ?? restoreSocialEntityDefault;
        return restoreSocial(postId);
    }
    const restoreLegacy = deps.restoreDeletedGroupFeedPost ?? restoreDeletedGroupFeedPostLegacy;
    return restoreLegacy(postId);
}

// === Permanent delete (legacy-only) ========================================

/**
 * `permanentlyDeletePostUnified` — the social store has no hard-delete
 * primitive (Phase 1 chose to keep tombstones forever for audit), so when the
 * beta flag is on we call the soft-delete endpoint instead, matching the
 * "trash → empty trash" UX. Legacy keeps its hard delete.
 */
export async function permanentlyDeletePostUnified(
    postId: string,
    useSocialBeta: boolean,
    deps: SocialFeedActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(postId, 'permanent');
    }
    const permLegacy =
        deps.permanentlyDeleteGroupFeedPost ?? permanentlyDeleteGroupFeedPostLegacy;
    return permLegacy(postId);
}

// === Reaction toggle ========================================================

/**
 * `togglePostReactionUnified` — beta path uses the universal toggle endpoint
 * (server returns fresh aggregates), legacy path keeps the per-group endpoint
 * that already populates `useGroupFeed`'s in-place patch. `groupKey` is only
 * meaningful for legacy; beta mode infers it from the entity record.
 */
export async function togglePostReactionUnified(
    groupKey: string,
    postId: string,
    emoji: string,
    useSocialBeta: boolean,
    deps: SocialFeedActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const toggleSocial = deps.toggleSocialReaction ?? toggleSocialReactionDefault;
        return toggleSocial(postId, emoji);
    }
    const toggleLegacy = deps.toggleGroupPostReaction ?? toggleGroupPostReactionLegacy;
    return toggleLegacy(groupKey, postId, emoji);
}

// === Pin / unpin ============================================================

/**
 * `pinPostUnified` — beta path hits the dedicated `/pin` endpoint; legacy has
 * no such endpoint, so we return a non-fatal `ApiResponse` failure with an
 * explanatory error. Pinning in legacy mode happens via `updatePostUnified`
 * with the `pinned` flag in the patch. Surfacing the limitation as an error
 * (rather than silently no-opping) keeps callers honest — if they switch on
 * a pin button while the flag is off they need to route through update.
 */
export async function pinPostUnified(
    postId: string,
    pinned: boolean,
    useSocialBeta: boolean,
    deps: SocialFeedActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const pinSocial = deps.pinSocialEntity ?? pinSocialEntityDefault;
        return pinSocial(postId, pinned);
    }
    return {
        success: false,
        error: 'Dedicated pin endpoint is only available on the social-beta path; use update with pinned flag instead.',
        errorCode: 'PIN_LEGACY_UNSUPPORTED',
    };
}
