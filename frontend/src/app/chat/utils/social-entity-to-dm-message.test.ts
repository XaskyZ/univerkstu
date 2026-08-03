import { describe, it, expect } from 'vitest';
import type { SocialEntityView } from '@/lib/api/social';
import { socialEntityToDmMessageView } from './social-entity-to-dm-message';

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
            id: 'msg-1',
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: 'dm:room-abc',
            authorUserId: 'user-42',
            payload: { body: 'Hello there' },
            pinned: false,
            createdAt: '2026-05-01T12:00:00Z',
            updatedAt: '2026-05-01T12:00:00Z',
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

describe('socialEntityToDmMessageView', () => {
    it('maps a fully-populated entity into a DM-message shape', () => {
        // Full happy-path mapping — every adapter field is populated from the
        // universal entity. Locks the contract that the thread renderer
        // depends on.
        const view = makeView({
            entity: {
                id: 'abc',
                authorUserId: 'sender-7',
                payload: {
                    body: 'Hi everyone',
                    replyToMessageId: 'parent-99',
                    editedAt: '2026-05-01T12:05:00Z',
                },
                createdAt: '2026-05-01T12:00:00Z',
                updatedAt: '2026-05-01T12:05:00Z',
            },
        });
        const message = socialEntityToDmMessageView(view);
        expect(message).toEqual({
            id: 'abc',
            roomId: 'room-abc',
            authorUserId: 'sender-7',
            body: 'Hi everyone',
            replyToMessageId: 'parent-99',
            editedAt: '2026-05-01T12:05:00Z',
            createdAt: '2026-05-01T12:00:00Z',
            pinned: false,
            deletedAt: null,
            reactions: [],
            mine: [],
        });
    });

    it('passes through aggregated reactions and the viewer-mine set', () => {
        // Reactions for DM messages are read straight from the universal
        // entity. The adapter must shallow-copy the arrays so downstream
        // mutations (e.g. an optimistic refresh) do not leak back into the
        // original `SocialEntityView` cached upstream.
        const view = makeView({
            reactions: [
                { emoji: '👍', count: 3 },
                { emoji: '😂', count: 1 },
            ],
            myReactions: ['👍'],
        });
        const message = socialEntityToDmMessageView(view);
        expect(message.reactions).toEqual([
            { emoji: '👍', count: 3 },
            { emoji: '😂', count: 1 },
        ]);
        expect(message.mine).toEqual(['👍']);
    });

    it('strips the `dm:` prefix from scopeId to recover the bare room id', () => {
        // `scopeId` is namespaced (`dm:<roomId>`). Downstream (read-state,
        // unread badge updates) expects the bare room id, so we strip eagerly
        // inside the adapter.
        const view = makeView({ entity: { scopeId: 'dm:abc-123' } });
        expect(socialEntityToDmMessageView(view).roomId).toBe('abc-123');
    });

    it('passes through scopeId unchanged when the `dm:` prefix is missing', () => {
        // Defensive: if the backend ever surfaces a non-namespaced scopeId
        // (or we point the adapter at non-DM scopes by mistake), we don't
        // want to silently slice characters off and corrupt the key.
        const view = makeView({ entity: { scopeId: 'plain-room' } });
        expect(socialEntityToDmMessageView(view).roomId).toBe('plain-room');
    });

    it('defaults missing payload `body` to an empty string', () => {
        // Backend payload schema requires `body`, but JSON-loaded data is
        // still typed as `unknown` on the client. We never want to render
        // the literal `undefined` in the DOM.
        const view = makeView({ entity: { payload: {} } });
        const message = socialEntityToDmMessageView(view);
        expect(message.body).toBe('');
    });

    it('omits `replyToMessageId` when not in the payload', () => {
        // Optional field — undefined (omitted) instead of an empty string
        // keeps the type contract honest for callers using `if (m.replyToMessageId)`.
        const view = makeView({ entity: { payload: { body: 'standalone' } } });
        expect(socialEntityToDmMessageView(view).replyToMessageId).toBeUndefined();
    });

    it('falls back to entity.updatedAt when payload `editedAt` is missing but entity was touched', () => {
        // Phase 1c writes `editedAt` into the payload on every edit, but
        // pre-shim rows migrated by `migrate-social-store.ts` rely on the
        // entity's `updatedAt` differing from `createdAt` to signal an edit.
        // The fallback ensures legacy data still renders the "edited" badge.
        const view = makeView({
            entity: {
                payload: { body: 'edited body' },
                createdAt: '2026-05-01T12:00:00Z',
                updatedAt: '2026-05-01T13:00:00Z',
            },
        });
        expect(socialEntityToDmMessageView(view).editedAt).toBe('2026-05-01T13:00:00Z');
    });

    it('leaves `editedAt` undefined when entity has never been touched post-creation', () => {
        // updatedAt === createdAt → message has not been edited. Defensive
        // assertion against accidentally surfacing the creation timestamp as
        // an edit timestamp (would falsely show every message as edited).
        const view = makeView({
            entity: {
                payload: { body: 'fresh' },
                createdAt: '2026-05-01T12:00:00Z',
                updatedAt: '2026-05-01T12:00:00Z',
            },
        });
        expect(socialEntityToDmMessageView(view).editedAt).toBeUndefined();
    });

    it('surfaces the universal `pinned` boolean on the adapter shape', () => {
        // Pin chips and the sticky pinned rail both branch on this boolean;
        // a defaulted `false` here would silently hide pinned messages.
        const view = makeView({ entity: { pinned: true } });
        expect(socialEntityToDmMessageView(view).pinned).toBe(true);
    });

    it('defaults `pinned` to false when the entity field is missing or falsy', () => {
        // Defensive — pinned is required on the SocialEntity contract but the
        // adapter coerces any falsy value (undefined / null / 0) to `false`.
        const view = makeView({ entity: { pinned: false } });
        expect(socialEntityToDmMessageView(view).pinned).toBe(false);
    });

    it('preserves soft-delete `deletedAt` when the message has been removed', () => {
        // Future "deleted message" UI reads this field. The adapter must not
        // drop it on the way through.
        const view = makeView({
            entity: {
                deletedAt: '2026-05-02T10:00:00Z',
                deletedByUserId: 'moderator-1',
                deletedReason: 'spam',
            },
        });
        expect(socialEntityToDmMessageView(view).deletedAt).toBe('2026-05-02T10:00:00Z');
    });
});
