import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import {
    deleteGlobalMessageUnified,
    pinGlobalMessageUnified,
    sendGlobalMessageUnified,
    type SocialGlobalChatActionDeps,
} from './social-global-chat-actions';

// Unit tests for the unified write-path wrappers. Each test injects fakes via
// the `deps` argument (the repo convention — see
// `social-announcement-actions.test.ts`). No `vi.mock` ESM intercepts; the
// wrappers expose every API binding as an explicit dep so fakes are
// first-class.

function ok<T>(data?: T): ApiResponse<T> {
    return { success: true, data: data as T };
}

describe('sendGlobalMessageUnified', () => {
    it('beta path: creates a global_message-kind entity in global:chat scope', async () => {
        // Locks the shape passed into the universal store. A regression that
        // accidentally dropped `scopeType`/`scopeId` would silently land
        // messages in an unrelated scope and they would never appear in the
        // global chat thread.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-msg-1' }));
        const deps: SocialGlobalChatActionDeps = { createSocialEntity };
        const result = await sendGlobalMessageUnified(
            { body: 'Hello world' },
            true,
            deps,
        );
        expect(result.success).toBe(true);
        expect(createSocialEntity).toHaveBeenCalledTimes(1);
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'global_message',
            scopeType: 'global',
            scopeId: 'global:chat',
            payload: { body: 'Hello world' },
        });
    });

    it('beta path: includes replyToMessageId in payload when provided', async () => {
        // The universal payload carries the reply target verbatim. Verify it
        // makes it onto the wire — a regression that dropped the field would
        // silently strip the reply semantics in beta mode.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-msg-2' }));
        await sendGlobalMessageUnified(
            { body: 'Replying', replyToMessageId: 'parent-msg-1' },
            true,
            { createSocialEntity },
        );
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'global_message',
            scopeType: 'global',
            scopeId: 'global:chat',
            payload: { body: 'Replying', replyToMessageId: 'parent-msg-1' },
        });
    });

    it('beta path: omits replyToMessageId from payload when empty string', async () => {
        // Empty string is treated as "no reply target" — the wrapper must not
        // write a falsy key, otherwise the universal schema would carry an
        // empty `replyToMessageId` and the UI would render a phantom reply
        // chip pointing at nothing.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-msg-3' }));
        await sendGlobalMessageUnified(
            { body: 'Top-level', replyToMessageId: '' },
            true,
            { createSocialEntity },
        );
        const [args] = createSocialEntity.mock.calls[0] as [{ payload: Record<string, unknown> }];
        expect(args.payload.replyToMessageId).toBeUndefined();
    });

    it('legacy path: calls createGlobalChatMessage with the body string', async () => {
        // The legacy endpoint accepts only a body string — no replies, no
        // metadata. Verify the wrapper unwraps `input.body` rather than
        // forwarding the whole input object (which would JSON-stringify into
        // an unexpected shape on the wire).
        const createGlobalChatMessage = vi.fn().mockResolvedValue(ok({ id: 'legacy-msg-1' }));
        await sendGlobalMessageUnified(
            { body: 'Hi from legacy' },
            false,
            { createGlobalChatMessage },
        );
        expect(createGlobalChatMessage).toHaveBeenCalledTimes(1);
        expect(createGlobalChatMessage).toHaveBeenCalledWith('Hi from legacy');
    });

    it('legacy path: silently drops replyToMessageId (documented gap)', async () => {
        // Documented gap — the legacy endpoint takes only a body. The
        // wrapper drops the reply target. UI should hide the reply
        // affordance in legacy mode; this test locks the wrapper's behaviour
        // when the affordance leaks through anyway.
        const createGlobalChatMessage = vi.fn().mockResolvedValue(ok({ id: 'legacy-msg-2' }));
        await sendGlobalMessageUnified(
            { body: 'Reply attempt', replyToMessageId: 'parent-1' },
            false,
            { createGlobalChatMessage },
        );
        expect(createGlobalChatMessage).toHaveBeenCalledTimes(1);
        // Body only — no reply propagated.
        expect(createGlobalChatMessage).toHaveBeenCalledWith('Reply attempt');
    });
});

describe('deleteGlobalMessageUnified', () => {
    it('beta path: calls deleteSocialEntity with the entity id and reason', async () => {
        // Soft-delete on the universal entity. Both endpoints take a reason
        // — universal route as a querystring, legacy as a body field. The
        // wrapper passes the reason through on either path.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deleteGlobalMessageUnified(
            'social-msg-9',
            'Spam',
            true,
            { deleteSocialEntity },
        );
        expect(deleteSocialEntity).toHaveBeenCalledWith('social-msg-9', 'Spam');
    });

    it('beta path: passes undefined reason when reason is null/empty', async () => {
        // The universal `deleteSocialEntity` signature treats `undefined` as
        // "no reason"; an empty string would append `?reason=` to the URL
        // with no value. Verify we normalize empty/null to `undefined`.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deleteGlobalMessageUnified('social-msg-10', null, true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('social-msg-10', undefined);

        deleteSocialEntity.mockClear();
        await deleteGlobalMessageUnified('social-msg-11', '', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('social-msg-11', undefined);
    });

    it('legacy path: calls deleteGlobalChatMessage with the legacy id and reason', async () => {
        // The legacy endpoint accepts `(messageId, reason | null)`. Verify
        // the wrapper forwards the reason verbatim.
        const deleteGlobalChatMessage = vi.fn().mockResolvedValue(ok({ messageId: 'legacy-msg-9', resolvedReports: 0 }));
        await deleteGlobalMessageUnified(
            'legacy-msg-9',
            'Inappropriate',
            false,
            { deleteGlobalChatMessage },
        );
        expect(deleteGlobalChatMessage).toHaveBeenCalledWith('legacy-msg-9', 'Inappropriate');
    });

    it('legacy path: passes null reason when reason is null/empty', async () => {
        // The legacy endpoint expects `null` (not `undefined`) for "no
        // reason" — the JSON body explicitly serializes `reason: null`.
        // Verify the wrapper normalizes both null and empty-string inputs.
        const deleteGlobalChatMessage = vi.fn().mockResolvedValue(ok({ messageId: 'legacy-msg-10', resolvedReports: 0 }));
        await deleteGlobalMessageUnified('legacy-msg-10', null, false, { deleteGlobalChatMessage });
        expect(deleteGlobalChatMessage).toHaveBeenCalledWith('legacy-msg-10', null);

        deleteGlobalChatMessage.mockClear();
        await deleteGlobalMessageUnified('legacy-msg-11', '', false, { deleteGlobalChatMessage });
        expect(deleteGlobalChatMessage).toHaveBeenCalledWith('legacy-msg-11', null);
    });
});

describe('pinGlobalMessageUnified', () => {
    it('beta path: calls pinSocialEntity with (id, pinned=true)', async () => {
        const pinSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await pinGlobalMessageUnified('social-msg-20', true, true, { pinSocialEntity });
        expect(pinSocialEntity).toHaveBeenCalledWith('social-msg-20', true);
    });

    it('beta path: forwards pinned=false for unpin', async () => {
        // Same endpoint handles unpin via the flag — make sure we don't
        // accidentally hard-code `true`.
        const pinSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await pinGlobalMessageUnified('social-msg-21', false, true, { pinSocialEntity });
        expect(pinSocialEntity).toHaveBeenCalledWith('social-msg-21', false);
    });

    it('legacy path: calls setGlobalChatMessagePinned with (id, pinned=true)', async () => {
        // The legacy endpoint mirrors the social signature exactly — same
        // pin chip behaviour either way. Verify the wrapper routes by flag
        // and forwards both arguments.
        const setGlobalChatMessagePinned = vi.fn().mockResolvedValue(ok(null));
        await pinGlobalMessageUnified('legacy-msg-20', true, false, { setGlobalChatMessagePinned });
        expect(setGlobalChatMessagePinned).toHaveBeenCalledWith('legacy-msg-20', true);
    });

    it('legacy path: forwards pinned=false for unpin', async () => {
        const setGlobalChatMessagePinned = vi.fn().mockResolvedValue(ok(null));
        await pinGlobalMessageUnified('legacy-msg-21', false, false, { setGlobalChatMessagePinned });
        expect(setGlobalChatMessagePinned).toHaveBeenCalledWith('legacy-msg-21', false);
    });

    it('does NOT return GLOBAL_CHAT_PIN_LEGACY_UNSUPPORTED in legacy mode (pin endpoint exists)', async () => {
        // Unlike `pinAnnouncementUnified` (where legacy has no pin endpoint),
        // the global-chat legacy API exposes `setGlobalChatMessagePinned`.
        // The wrapper must NOT short-circuit with an unsupported-error in
        // legacy mode — it must call through to the legacy endpoint.
        const setGlobalChatMessagePinned = vi.fn().mockResolvedValue(ok(null));
        const result = await pinGlobalMessageUnified(
            'legacy-msg-22',
            true,
            false,
            { setGlobalChatMessagePinned },
        );
        expect(result.success).toBe(true);
        expect(result.errorCode).toBeUndefined();
        expect(setGlobalChatMessagePinned).toHaveBeenCalledTimes(1);
    });

    it('propagates a non-success response from the underlying API verbatim', async () => {
        // Error envelopes must flow through unchanged — the integration
        // layer reads `result.error` and `result.errorCode` directly.
        const pinSocialEntity = vi.fn().mockResolvedValue({
            success: false,
            error: 'Forbidden',
            errorCode: 'SOCIAL_FORBIDDEN',
        });
        const result = await pinGlobalMessageUnified('social-msg-22', true, true, { pinSocialEntity });
        expect(result).toEqual({
            success: false,
            error: 'Forbidden',
            errorCode: 'SOCIAL_FORBIDDEN',
        });
    });
});
