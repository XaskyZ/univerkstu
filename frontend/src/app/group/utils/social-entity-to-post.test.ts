import { describe, it, expect } from 'vitest';
import type { SocialEntityView } from '@/lib/api/social';
import { socialEntityToPostView } from './social-entity-to-post';

// Builds a minimal `SocialEntityView` with sane defaults. Tests override only
// the fields they care about so the assertion focuses on the mapping rule.
function makeView(overrides: {
    entity?: Partial<SocialEntityView['entity']>;
    reactions?: SocialEntityView['reactions'];
    myReactions?: SocialEntityView['myReactions'];
    commentCount?: number;
    attachmentCount?: number;
    isPinned?: boolean;
} = {}): SocialEntityView {
    return {
        entity: {
            id: 'entity-1',
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'user-42',
            payload: { title: 'Hello', body: 'World' },
            pinned: false,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...overrides.entity,
        },
        reactions: overrides.reactions ?? [],
        myReactions: overrides.myReactions ?? [],
        commentCount: overrides.commentCount ?? 0,
        attachmentCount: overrides.attachmentCount ?? 0,
        isPinned: overrides.isPinned ?? false,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('socialEntityToPostView', () => {
    it('maps a fully-populated entity into a GroupPostView shape', () => {
        // Full happy-path mapping — every legacy `GroupPostView` field is
        // populated from the universal entity. Locks the contract that
        // PostCard / FeedTab depend on.
        const view = makeView({
            entity: {
                id: 'abc',
                authorUserId: 'starosta-1',
                pinned: true,
                payload: { title: 'Test exam', body: 'In room 305', tags: ['exam', 'reminder'] },
            },
            reactions: [{ emoji: '👍', count: 3 }, { emoji: '🎉', count: 1 }],
            myReactions: ['👍'],
        });
        const post = socialEntityToPostView(view);
        expect(post).toMatchObject({
            id: 'abc',
            groupKey: 'ITS-21',
            title: 'Test exam',
            body: 'In room 305',
            authorUserId: 'starosta-1',
            pinned: true,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-02T00:00:00Z',
            deletedAt: null,
            deletedBy: null,
            tags: ['exam', 'reminder'],
        });
        expect(post.reactions).toEqual({
            items: [{ emoji: '👍', count: 3 }, { emoji: '🎉', count: 1 }],
            mine: ['👍'],
        });
    });

    it('defaults missing payload fields to empty strings (title/body) and []  (tags)', () => {
        // Backend payload schema marks title as optional; we never want to
        // render the literal `undefined` in the DOM. Tags is similarly opt-in.
        const view = makeView({ entity: { payload: {} } });
        const post = socialEntityToPostView(view);
        expect(post.title).toBe('');
        expect(post.body).toBe('');
        expect(post.tags).toEqual([]);
    });

    it('strips the `group:` prefix from scopeId to recover the bare group key', () => {
        // `scopeId` is namespaced (`group:<key>`). PostCard's authoring UI
        // and `getGroupPostReactions` legacy fallback both expect the bare
        // group key, so we strip eagerly inside the adapter.
        const view = makeView({ entity: { scopeId: 'group:CSE-22A' } });
        expect(socialEntityToPostView(view).groupKey).toBe('CSE-22A');
    });

    it('passes through scopeId unchanged when the `group:` prefix is missing', () => {
        // Defensive: if the backend ever surfaces a non-namespaced scopeId
        // (or we point the adapter at non-group scopes), we don't want to
        // silently slice characters off and corrupt the key.
        const view = makeView({ entity: { scopeId: 'plain-key' } });
        expect(socialEntityToPostView(view).groupKey).toBe('plain-key');
    });

    it('clones `myReactions` so caller mutations do not leak into the source view', () => {
        // The legacy `useGroupFeed.toggleReaction` patches `post.reactions.mine`
        // in-place. If we shared the array reference with the view, a later
        // optimistic update would corrupt the original list and double-count
        // on the next render.
        const source = ['👍'];
        const view = makeView({ myReactions: source });
        const post = socialEntityToPostView(view);
        expect(post.reactions?.mine).toEqual(['👍']);
        expect(post.reactions?.mine).not.toBe(source);
    });

    it('preserves soft-delete fields (deletedAt + deletedByUserId → deletedBy)', () => {
        // Trash list reads on the universal entity rely on these fields. The
        // field rename (`deletedByUserId` → `deletedBy`) was a deliberate
        // legacy-shape choice on `GroupPostView`; we re-key here.
        const view = makeView({
            entity: {
                deletedAt: '2026-02-15T10:00:00Z',
                deletedByUserId: 'moderator-9',
                deletedReason: 'spam',
            },
        });
        const post = socialEntityToPostView(view);
        expect(post.deletedAt).toBe('2026-02-15T10:00:00Z');
        expect(post.deletedBy).toBe('moderator-9');
    });

    it('filters non-string entries out of `tags`', () => {
        // Defensive against an upstream payload that somehow contains a
        // non-string in the tags array. We coerce to a clean string[].
        const view = makeView({
            entity: { payload: { body: 'b', tags: ['ok', 123, null, 'also-ok'] as unknown[] } },
        });
        expect(socialEntityToPostView(view).tags).toEqual(['ok', 'also-ok']);
    });
});
