import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import {
    createPostUnified,
    deletePostUnified,
    permanentlyDeletePostUnified,
    pinPostUnified,
    restorePostUnified,
    togglePostReactionUnified,
    updatePostUnified,
    type SocialFeedActionDeps,
} from './social-feed-actions';

// Unit tests for the unified write-path wrappers. Each test injects fakes via
// the `deps` argument (the repo convention — see
// `useGroupFeedSocial.test.ts`). No `vi.mock` ESM intercepts; the wrappers
// expose every API binding as an explicit dep so fakes are first-class.

// `vi.fn<T>()` infers an empty signature when given a function-type alias, so
// we declare each fake with the resolved value type instead and rely on
// TypeScript to keep the call sites honest via `SocialFeedActionDeps`.

function ok<T>(data?: T): ApiResponse<T> {
    return { success: true, data: data as T };
}

describe('createPostUnified', () => {
    it('beta path: calls createSocialEntity with kind=post and group-scoped scopeId', async () => {
        // Locks the shape passed into the universal store. A regression that
        // accidentally dropped `scopeType`/`scopeId` would silently land posts
        // in an empty scope and they would never appear in any feed read.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-1' }));
        const deps: SocialFeedActionDeps = { createSocialEntity };
        const result = await createPostUnified(
            'ITS-21',
            { title: 'T', body: 'B', tags: ['x'] },
            true,
            deps,
        );
        expect(result.success).toBe(true);
        expect(createSocialEntity).toHaveBeenCalledTimes(1);
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            payload: { body: 'B', title: 'T', tags: ['x'] },
        });
    });

    it('beta path: omits title/tags from payload when not provided (no explicit undefined keys)', async () => {
        // Explicit-undefined keys would serialize away in JSON, but the
        // builder pruning is what the AJV validator actually relies on for
        // future-strict payloads — assert it explicitly.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-2' }));
        await createPostUnified('CSE-22', { body: 'just body' }, true, { createSocialEntity });
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:CSE-22',
            payload: { body: 'just body' },
        });
    });

    it('legacy path: calls createGroupFeedPost with (title, body, groupKey, pinned)', async () => {
        // Verifies that we don't accidentally smuggle the social arg shape
        // into the legacy call.
        const createGroupFeedPost = vi.fn().mockResolvedValue(ok({ id: 'legacy-1' }));
        await createPostUnified(
            'ITS-21',
            { title: 'L', body: 'BL', pinned: true },
            false,
            { createGroupFeedPost },
        );
        expect(createGroupFeedPost).toHaveBeenCalledWith('L', 'BL', 'ITS-21', true);
    });
});

describe('updatePostUnified', () => {
    it('beta path: PATCHes only the provided payload fields', async () => {
        // The whole point of the social PATCH endpoint is partial updates —
        // verify we don't include `title` when the caller didn't ask to
        // change it.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await updatePostUnified('e-1', { body: 'new body' }, true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-1', { payload: { body: 'new body' } });
    });

    it('beta path: forwards the `pinned` flag as a top-level patch field', async () => {
        // `pinned` is not part of the payload bag — it lives on the entity row.
        // Asserting top-level placement protects callers from
        // accidentally nesting it under `payload`.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await updatePostUnified('e-2', { pinned: true }, true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-2', { pinned: true });
    });

    it('legacy path: forwards (postId, title, body, pinned) with empty-string defaults', async () => {
        const updateGroupFeedPost = vi.fn().mockResolvedValue(ok({ id: 'p' }));
        await updatePostUnified('p-1', { title: 'T2', body: 'B2' }, false, { updateGroupFeedPost });
        expect(updateGroupFeedPost).toHaveBeenCalledWith('p-1', 'T2', 'B2', false);
    });
});

describe('deletePostUnified', () => {
    it('beta path: calls deleteSocialEntity with the reason string when provided', async () => {
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deletePostUnified('e-3', 'spam', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-3', 'spam');
    });

    it('beta path: passes `undefined` reason through unchanged', async () => {
        // The social client treats undefined reason as "no querystring" —
        // make sure we don't accidentally coerce it to the literal string
        // 'undefined'.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deletePostUnified('e-4', undefined, true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-4', undefined);
    });

    it('legacy path: ignores reason (the legacy endpoint has no reason param)', async () => {
        const deleteGroupFeedPost = vi.fn().mockResolvedValue(ok({ deleted: true }));
        await deletePostUnified('p-2', 'doesnt-matter', false, { deleteGroupFeedPost });
        expect(deleteGroupFeedPost).toHaveBeenCalledWith('p-2');
    });
});

describe('restorePostUnified', () => {
    it('beta path: calls restoreSocialEntity with the entity id', async () => {
        const restoreSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await restorePostUnified('e-5', true, { restoreSocialEntity });
        expect(restoreSocialEntity).toHaveBeenCalledWith('e-5');
    });

    it('legacy path: calls restoreDeletedGroupFeedPost', async () => {
        const restoreDeletedGroupFeedPost = vi.fn().mockResolvedValue(ok({ id: 'p' }));
        await restorePostUnified('p-3', false, { restoreDeletedGroupFeedPost });
        expect(restoreDeletedGroupFeedPost).toHaveBeenCalledWith('p-3');
    });
});

describe('permanentlyDeletePostUnified', () => {
    it('beta path: routes through deleteSocialEntity with reason=permanent', async () => {
        // Social store has no hard-delete primitive — assert we degrade
        // gracefully to a soft-delete with a discoverable reason instead of
        // silently no-opping.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await permanentlyDeletePostUnified('e-6', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-6', 'permanent');
    });

    it('legacy path: calls permanentlyDeleteGroupFeedPost', async () => {
        const permanentlyDeleteGroupFeedPost = vi.fn().mockResolvedValue(ok({ deleted: true }));
        await permanentlyDeletePostUnified('p-4', false, { permanentlyDeleteGroupFeedPost });
        expect(permanentlyDeleteGroupFeedPost).toHaveBeenCalledWith('p-4');
    });
});

describe('togglePostReactionUnified', () => {
    it('beta path: calls toggleSocialReaction with (postId, emoji) and ignores groupKey', async () => {
        // Universal reactions are keyed on entity id — `groupKey` is only
        // meaningful in legacy mode where reactions live under the group
        // namespace.
        const toggleSocialReaction = vi.fn().mockResolvedValue(ok({ added: true, reactions: [], mine: [] }));
        await togglePostReactionUnified('ITS-21', 'e-7', '👍', true, { toggleSocialReaction });
        expect(toggleSocialReaction).toHaveBeenCalledWith('e-7', '👍');
    });

    it('legacy path: calls toggleGroupPostReaction with (groupKey, postId, emoji)', async () => {
        const toggleGroupPostReaction = vi.fn().mockResolvedValue(ok({ reactions: [], mine: [] }));
        await togglePostReactionUnified('ITS-21', 'p-5', '🎉', false, { toggleGroupPostReaction });
        expect(toggleGroupPostReaction).toHaveBeenCalledWith('ITS-21', 'p-5', '🎉');
    });
});

describe('pinPostUnified', () => {
    it('beta path: calls pinSocialEntity with (postId, pinned)', async () => {
        const pinSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await pinPostUnified('e-8', true, true, { pinSocialEntity });
        expect(pinSocialEntity).toHaveBeenCalledWith('e-8', true);
    });

    it('beta path: forwards `pinned=false` for unpin', async () => {
        // Same endpoint handles unpin via the flag — make sure we don't
        // accidentally hard-code `true`.
        const pinSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await pinPostUnified('e-9', false, true, { pinSocialEntity });
        expect(pinSocialEntity).toHaveBeenCalledWith('e-9', false);
    });

    it('legacy path: returns a non-success ApiResponse with PIN_LEGACY_UNSUPPORTED code', async () => {
        // Legacy has no dedicated pin endpoint — confirm we expose the
        // limitation as an error rather than a silent no-op.
        const result = await pinPostUnified('p-6', true, false);
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('PIN_LEGACY_UNSUPPORTED');
        expect(typeof result.error).toBe('string');
    });
});
