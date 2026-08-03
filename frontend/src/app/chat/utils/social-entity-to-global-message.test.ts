import { describe, it, expect } from 'vitest';
import type { SocialEntityView } from '@/lib/api/social';
import {
    socialEntityToGlobalMessageView,
    socialGlobalMessageToLegacyView,
} from './social-entity-to-global-message';

// Builds a minimal `SocialEntityView` for a `global_message` entity with sane
// defaults. Tests override only the fields they care about so each assertion
// focuses on a single mapping rule.
function makeView(overrides: {
    entity?: Partial<SocialEntityView['entity']>;
    reactions?: SocialEntityView['reactions'];
    myReactions?: SocialEntityView['myReactions'];
} = {}): SocialEntityView {
    return {
        entity: {
            id: 'msg-1',
            kind: 'global_message',
            scopeType: 'global',
            scopeId: 'global:chat',
            authorUserId: 'user-1',
            payload: { body: 'Hello world' },
            pinned: false,
            createdAt: '2026-05-20T10:00:00Z',
            updatedAt: '2026-05-20T10:00:00Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...overrides.entity,
        },
        reactions: overrides.reactions ?? [],
        myReactions: overrides.myReactions ?? [],
        commentCount: 0,
        attachmentCount: 0,
        isPinned: false,
        viewCount: 0,
        hasViewed: false,
    };
}

describe('socialEntityToGlobalMessageView', () => {
    it('maps a fully-populated entity into the global-message adapter shape', () => {
        // Full happy-path mapping — locks the contract that the integration
        // layer depends on. A regression that lost any of these fields would
        // either show `undefined` in the DOM or silently strip a reply target.
        const view = makeView({
            entity: {
                id: 'msg-abc',
                authorUserId: 'user-7',
                payload: {
                    body: 'Reply text',
                    replyToMessageId: 'msg-parent',
                    editedAt: '2026-05-20T10:05:00Z',
                },
                pinned: true,
                createdAt: '2026-05-20T10:00:00Z',
            },
        });
        const message = socialEntityToGlobalMessageView(view);
        expect(message).toEqual({
            id: 'msg-abc',
            authorUserId: 'user-7',
            body: 'Reply text',
            replyToMessageId: 'msg-parent',
            editedAt: '2026-05-20T10:05:00Z',
            createdAt: '2026-05-20T10:00:00Z',
            pinned: true,
            deletedAt: null,
            deletedReason: null,
            reactions: [],
            mine: [],
        });
    });

    it('passes through aggregated reactions and the viewer-mine set', () => {
        // Reactions are read straight from the universal entity. The adapter
        // must shallow-copy the arrays so downstream mutations do not leak
        // back into the upstream-cached entity.
        const view = makeView({
            reactions: [
                { emoji: '❤️', count: 5 },
                { emoji: '🎉', count: 2 },
            ],
            myReactions: ['🎉'],
        });
        const message = socialEntityToGlobalMessageView(view);
        expect(message.reactions).toEqual([
            { emoji: '❤️', count: 5 },
            { emoji: '🎉', count: 2 },
        ]);
        expect(message.mine).toEqual(['🎉']);
    });

    it('defaults a missing body to an empty string (never renders `undefined`)', () => {
        // Defensive against a payload missing the required body — the backend
        // validates this, but JSON-loaded data is `unknown` on the client. We
        // never want to leak the literal string `undefined` into the chat
        // bubble.
        const view = makeView({ entity: { payload: {} } });
        expect(socialEntityToGlobalMessageView(view).body).toBe('');
    });

    it('omits replyToMessageId from the result when payload has no entry', () => {
        // The shim only writes `replyToMessageId` when the legacy row has a
        // reply target. The adapter must preserve the absence as `undefined`
        // (not `null`) so the back-mapper / UI can branch on `=== undefined`
        // for "is a top-level message".
        const view = makeView({ entity: { payload: { body: 'Top level' } } });
        const message = socialEntityToGlobalMessageView(view);
        expect(message.replyToMessageId).toBeUndefined();
    });

    it('omits editedAt from the result when payload has no entry', () => {
        // Same omission rule for `editedAt` — never-edited messages must not
        // expose a falsy `editedAt` string to the UI's "(edited)" badge.
        const view = makeView({ entity: { payload: { body: 'Pristine' } } });
        expect(socialEntityToGlobalMessageView(view).editedAt).toBeUndefined();
    });

    it('mirrors entity.pinned as the pinned boolean (legacy pinned_at replayed)', () => {
        // The Phase 1d backfill replays the legacy `pinned_at` timestamp onto
        // `app_social_entity.pinned`. The adapter must read the boolean,
        // not look for a separate timestamp in the payload — otherwise the
        // pin chip never lights up in beta mode.
        const view = makeView({ entity: { pinned: true } });
        expect(socialEntityToGlobalMessageView(view).pinned).toBe(true);
    });

    it('surfaces entity.deletedAt and deletedReason for soft-deleted messages', () => {
        // Soft-deleted messages must keep their tombstone visible to
        // moderation views. The adapter exposes both fields so the UI can
        // hide the body and surface the audit reason in a moderator-only
        // panel.
        const view = makeView({
            entity: {
                deletedAt: '2026-05-21T09:00:00Z',
                deletedReason: 'Spam',
            },
        });
        const message = socialEntityToGlobalMessageView(view);
        expect(message.deletedAt).toBe('2026-05-21T09:00:00Z');
        expect(message.deletedReason).toBe('Spam');
    });

    it('coerces non-string payload values to safe defaults', () => {
        // Hand-crafted payload with wrong types must not crash the adapter or
        // leak typed-as-string-but-actually-object values into the UI.
        const view = makeView({
            entity: {
                payload: {
                    body: 42 as unknown as string,
                    replyToMessageId: { id: 'x' } as unknown as string,
                    editedAt: null as unknown as string,
                },
            },
        });
        const message = socialEntityToGlobalMessageView(view);
        expect(message.body).toBe('');
        expect(message.replyToMessageId).toBeUndefined();
        expect(message.editedAt).toBeUndefined();
    });
});

describe('socialGlobalMessageToLegacyView', () => {
    it('back-maps to the legacy GlobalChatMessageView shape with conservative defaults', () => {
        // Integration layer relies on the back-mapper to keep `GlobalPanel`
        // working. Locks the round-trip: every legacy field is populated,
        // moderation metadata gets safe defaults documented in the header.
        const view = makeView({
            entity: {
                id: 'msg-xyz',
                authorUserId: 'user-3',
                payload: { body: 'Hi' },
                pinned: true,
            },
        });
        const adapter = socialEntityToGlobalMessageView(view);
        const legacy = socialGlobalMessageToLegacyView(adapter, 'user-3', 'Alice');
        expect(legacy).toEqual({
            id: 'msg-xyz',
            authorUserId: 'user-3',
            authorLabel: 'Alice',
            body: 'Hi',
            createdAt: '2026-05-20T10:00:00Z',
            isPinned: true,
            pinnedAt: null,
            isOwn: true,
            canDelete: true,
            isReportedByViewer: false,
            reportCount: 0,
        });
    });

    it('sets isOwn=false and canDelete=false when viewer is a different user', () => {
        // The moderator-override path is documented as out-of-scope for the
        // back-mapper — the integration layer ORs it in. Verify the base
        // mapping is strictly viewer-vs-author here.
        const view = makeView({
            entity: { authorUserId: 'user-3', payload: { body: 'x' } },
        });
        const legacy = socialGlobalMessageToLegacyView(
            socialEntityToGlobalMessageView(view),
            'user-99',
            'Author',
        );
        expect(legacy.isOwn).toBe(false);
        expect(legacy.canDelete).toBe(false);
    });

    it('defaults isOwn and canDelete to false when no viewerUserId is given', () => {
        // SSR / unauthenticated render path — we must not crash on a missing
        // viewer id, and we must not default `isOwn=true` (which would expose
        // delete affordances to nobody).
        const view = makeView({ entity: { payload: { body: 'x' } } });
        const legacy = socialGlobalMessageToLegacyView(socialEntityToGlobalMessageView(view));
        expect(legacy.isOwn).toBe(false);
        expect(legacy.canDelete).toBe(false);
    });

    it('falls back to authorUserId when no authorLabel is provided', () => {
        // The integration layer is allowed to skip the label lookup (e.g. on
        // first paint while the user directory is still loading). The
        // back-mapper produces a non-empty string so the avatar letter logic
        // does not render '?'.
        const view = makeView({ entity: { authorUserId: 'user-77', payload: { body: 'x' } } });
        const legacy = socialGlobalMessageToLegacyView(socialEntityToGlobalMessageView(view));
        expect(legacy.authorLabel).toBe('user-77');
    });

    it('always sets reportCount=0 and isReportedByViewer=false in beta mode', () => {
        // Documented gap: moderation metadata lives on the legacy path; beta
        // surfaces a conservative default so the flag UI is hidden but the
        // shape stays compatible.
        const view = makeView();
        const legacy = socialGlobalMessageToLegacyView(socialEntityToGlobalMessageView(view), 'u');
        expect(legacy.reportCount).toBe(0);
        expect(legacy.isReportedByViewer).toBe(false);
    });

    it('drops pinnedAt to null even when the entity is pinned (boolean is enough)', () => {
        // The social entity carries only `pinned: boolean`, not a timestamp.
        // The Phase 1d backfill discarded the legacy `pinned_at` value
        // deliberately. Verify we don't fabricate a fake timestamp here.
        const view = makeView({ entity: { pinned: true } });
        const legacy = socialGlobalMessageToLegacyView(socialEntityToGlobalMessageView(view), 'u');
        expect(legacy.isPinned).toBe(true);
        expect(legacy.pinnedAt).toBeNull();
    });
});
