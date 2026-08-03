import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import {
    deleteDmMessageUnified,
    editDmMessageUnified,
    sendDmMessageUnified,
    type SocialDmActionDeps,
} from './social-dm-actions';

// Unit tests for the unified DM write-path wrappers. Each test injects fakes
// via the `deps` argument (the repo convention — see
// `social-feed-actions.test.ts`). No `vi.mock` ESM intercepts; the wrappers
// expose every API binding as an explicit dep so fakes are first-class.

function ok<T>(data?: T): ApiResponse<T> {
    return { success: true, data: data as T };
}

describe('sendDmMessageUnified', () => {
    it('beta path: calls createSocialEntity with kind=dm_message and dm-scoped scopeId', async () => {
        // Locks the shape passed into the universal store. A regression that
        // accidentally dropped `scopeType`/`scopeId` would silently land
        // messages in an empty scope and they would never appear in any
        // thread read.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-1' }));
        const deps: SocialDmActionDeps = { createSocialEntity };
        const result = await sendDmMessageUnified(
            'room-abc',
            { body: 'Hello!' },
            true,
            deps,
        );
        expect(result.success).toBe(true);
        expect(createSocialEntity).toHaveBeenCalledTimes(1);
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: 'dm:room-abc',
            payload: { body: 'Hello!' },
        });
    });

    it('beta path: includes replyToMessageId in payload when provided', async () => {
        // Reply-target nesting lives inside the universal payload — verify
        // we don't surface it at the top level by mistake.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-2' }));
        await sendDmMessageUnified(
            'room-abc',
            { body: 'Replying', replyToMessageId: 'parent-99' },
            true,
            { createSocialEntity },
        );
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: 'dm:room-abc',
            payload: { body: 'Replying', replyToMessageId: 'parent-99' },
        });
    });

    it('beta path: omits replyToMessageId from payload when missing or empty', async () => {
        // Explicit-undefined keys would serialize away in JSON, but the
        // builder pruning is what AJV will rely on for future-strict payloads.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-3' }));
        await sendDmMessageUnified('room-abc', { body: 'plain' }, true, { createSocialEntity });
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: 'dm:room-abc',
            payload: { body: 'plain' },
        });
        // Also make sure empty-string replyToMessageId is dropped, not echoed
        const createSocialEntity2 = vi.fn().mockResolvedValue(ok({ id: 'social-3b' }));
        await sendDmMessageUnified(
            'room-abc',
            { body: 'plain2', replyToMessageId: '' },
            true,
            { createSocialEntity: createSocialEntity2 },
        );
        expect(createSocialEntity2).toHaveBeenCalledWith({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: 'dm:room-abc',
            payload: { body: 'plain2' },
        });
    });

    it('legacy path: calls createChatRoomMessage with roomId and {body, replyToMessageId}', async () => {
        // Verifies that we don't accidentally smuggle the social arg shape
        // into the legacy call. Legacy expects `replyToMessageId: null` for
        // standalone messages — assert that explicit null is forwarded.
        const createChatRoomMessage = vi.fn().mockResolvedValue(ok({ id: 'legacy-1' }));
        await sendDmMessageUnified(
            'room-abc',
            { body: 'Hi', replyToMessageId: 'parent-7' },
            false,
            { createChatRoomMessage },
        );
        expect(createChatRoomMessage).toHaveBeenCalledWith('room-abc', {
            body: 'Hi',
            replyToMessageId: 'parent-7',
        });
    });

    it('legacy path: forwards `replyToMessageId: null` when no reply target is set', async () => {
        // The legacy endpoint distinguishes null (standalone) from omitted —
        // asserting null keeps the existing behaviour stable.
        const createChatRoomMessage = vi.fn().mockResolvedValue(ok({ id: 'legacy-2' }));
        await sendDmMessageUnified('room-abc', { body: 'plain' }, false, { createChatRoomMessage });
        expect(createChatRoomMessage).toHaveBeenCalledWith('room-abc', {
            body: 'plain',
            replyToMessageId: null,
        });
    });
});

describe('editDmMessageUnified', () => {
    it('beta path: PATCHes only the body field inside payload', async () => {
        // The whole point of the social PATCH endpoint is partial updates —
        // verify we don't accidentally clear `replyToMessageId` by sending
        // the full payload shape.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await editDmMessageUnified('msg-1', 'updated body', true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('msg-1', {
            payload: { body: 'updated body' },
        });
    });

    it('legacy path: calls editChatRoomMessage with messageId and new body', async () => {
        const editChatRoomMessage = vi.fn().mockResolvedValue(ok({ id: 'msg-2' }));
        await editDmMessageUnified('msg-2', 'fixed typo', false, { editChatRoomMessage });
        expect(editChatRoomMessage).toHaveBeenCalledWith('msg-2', 'fixed typo');
    });

    it('beta path: forwards empty string bodies through (server validates length)', async () => {
        // Body-length validation lives on the backend. The wrapper must NOT
        // pre-filter empty strings — otherwise the user never sees the
        // backend's localized "message too short" error.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await editDmMessageUnified('msg-3', '', true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('msg-3', {
            payload: { body: '' },
        });
    });
});

describe('deleteDmMessageUnified', () => {
    it('beta path: calls deleteSocialEntity with the reason string when provided', async () => {
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deleteDmMessageUnified('msg-4', 'spam', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('msg-4', 'spam');
    });

    it('beta path: passes `undefined` reason through unchanged', async () => {
        // The social client treats undefined reason as "no querystring" —
        // make sure we don't coerce it to the literal string 'undefined'.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deleteDmMessageUnified('msg-5', undefined, true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('msg-5', undefined);
    });

    it('legacy path: returns a non-success ApiResponse with DM_DELETE_LEGACY_UNSUPPORTED', async () => {
        // Legacy chat API has no soft-delete primitive — confirm we expose
        // the limitation as an explicit error rather than a silent no-op.
        const result = await deleteDmMessageUnified('msg-6', 'whatever', false);
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('DM_DELETE_LEGACY_UNSUPPORTED');
        expect(typeof result.error).toBe('string');
    });

    it('legacy path: does not call any legacy API binding', async () => {
        // Verify the unsupported-error short-circuit happens before any
        // legacy call — otherwise we would silently issue a misnamed request.
        const createChatRoomMessage = vi.fn();
        const editChatRoomMessage = vi.fn();
        await deleteDmMessageUnified('msg-7', undefined, false, {
            createChatRoomMessage,
            editChatRoomMessage,
        });
        expect(createChatRoomMessage).not.toHaveBeenCalled();
        expect(editChatRoomMessage).not.toHaveBeenCalled();
    });
});
