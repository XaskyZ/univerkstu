/**
 * Unified write-path wrappers for the DM (direct message) POC.
 *
 * Each function decides — based on the `useSocialBeta` flag the caller passes
 * in — whether to write through the **legacy** chat API
 * (`/api/v3/chat/rooms/<roomId>/messages`, Phase 1c shim mirrors the change
 * into `app_social_entity` server-side) or **directly** through the universal
 * social store (`/api/v3/social/*`). This validates that the universal store
 * can serve the DM write path end-to-end while the legacy table is still
 * source of truth for room metadata (unread counts, peer info, canWrite).
 *
 * Boundaries:
 *  - Wrappers are pure: the flag is an argument, not a global lookup. Lets
 *    callers (and tests) flip it without re-rendering React state.
 *  - APIs are injected via the last `deps` argument so tests can pass fakes
 *    instead of monkey-patching ESM bindings (the repo convention — see
 *    `social-feed-actions.ts`).
 *  - Returned envelope is `ApiResponse<unknown>` — handlers downstream only
 *    branch on `success` + `error`; reusing the legacy shape avoids changing
 *    `DialogsPanel` error / refresh logic.
 *
 * **ID mapping rule** when `useSocialBeta` is on:
 *  - `messageId` is the **`app_social_entity.id`** (uuid). The read path
 *    (`useDmMessagesSocial` → `socialEntityToDmMessageView`) already surfaces
 *    `entity.id` as `message.id`, so the value coming back into edit / delete
 *    handlers is the social id, not the legacy `app_chat_messages.id`.
 *  - Conversely, when `useSocialBeta` is off, `messageId` is the legacy id —
 *    matches the existing `useDialogs` contract.
 *
 * **Delete handling**: legacy DM does NOT support soft-delete for messages —
 * `lib/api/chat.ts` only exposes `createChatRoomMessage` and
 * `editChatRoomMessage`. The legacy `deleteDmMessageUnified` therefore returns
 * a non-fatal `ApiResponse` failure with the `DM_DELETE_LEGACY_UNSUPPORTED`
 * error code rather than silently no-opping. Beta mode routes through
 * `deleteSocialEntity` which performs a real soft-delete in the universal
 * store. Pre-cutover, callers should hide / disable the delete affordance
 * when the beta flag is off.
 */
import {
    createChatRoomMessage as createChatRoomMessageLegacy,
    editChatRoomMessage as editChatRoomMessageLegacy,
} from '@/lib/api/chat';
import type { ApiResponse } from '@/lib/api/core';
import {
    createSocialEntity as createSocialEntityDefault,
    deleteSocialEntity as deleteSocialEntityDefault,
    updateSocialEntity as updateSocialEntityDefault,
} from '@/lib/api/social';

// === Shared types ===========================================================

export interface DmMessageInput {
    body: string;
    /**
     * Optional id of the message being replied to. Stored under
     * `payload.replyToMessageId` in the universal entity; mirrored to the
     * legacy `replyToMessageId` field on the create call.
     */
    replyToMessageId?: string;
}

/**
 * Surface every API binding the wrappers need so tests can inject fakes
 * piecemeal without satisfying the entire shape every time.
 */
export interface SocialDmActionDeps {
    // social (universal store)
    createSocialEntity?: typeof createSocialEntityDefault;
    updateSocialEntity?: typeof updateSocialEntityDefault;
    deleteSocialEntity?: typeof deleteSocialEntityDefault;
    // legacy (chat DM)
    createChatRoomMessage?: typeof createChatRoomMessageLegacy;
    editChatRoomMessage?: typeof editChatRoomMessageLegacy;
}

// === Helpers ================================================================

/**
 * Build the social-entity payload from a `DmMessageInput`. Drops `undefined`
 * fields so the backend AJV validator does not reject the body for
 * explicit-undefined keys.
 */
function buildDmPayload(input: DmMessageInput): Record<string, unknown> {
    const payload: Record<string, unknown> = { body: input.body };
    if (typeof input.replyToMessageId === 'string' && input.replyToMessageId) {
        payload.replyToMessageId = input.replyToMessageId;
    }
    return payload;
}

// === Send ===================================================================

/**
 * `sendDmMessageUnified` — beta path POSTs a `dm_message`-kind entity into the
 * social store under `dm:<roomId>`; legacy path calls the existing
 * `createChatRoomMessage`. The legacy variant accepts `replyToMessageId` as a
 * top-level body field; the social variant nests it inside `payload`.
 */
export async function sendDmMessageUnified(
    roomId: string,
    input: DmMessageInput,
    useSocialBeta: boolean,
    deps: SocialDmActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const createSocial = deps.createSocialEntity ?? createSocialEntityDefault;
        return createSocial({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: `dm:${roomId}`,
            payload: buildDmPayload(input),
        });
    }
    const createLegacy = deps.createChatRoomMessage ?? createChatRoomMessageLegacy;
    return createLegacy(roomId, {
        body: input.body,
        replyToMessageId: input.replyToMessageId ?? null,
    });
}

// === Edit ===================================================================

/**
 * `editDmMessageUnified` — beta path PATCHes the entity payload's `body`
 * field (and stamps `editedAt` server-side); legacy path calls
 * `editChatRoomMessage`. Only the body is editable in either mode — replies
 * cannot be retargeted post-send (legacy parity).
 */
export async function editDmMessageUnified(
    messageId: string,
    newBody: string,
    useSocialBeta: boolean,
    deps: SocialDmActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const updateSocial = deps.updateSocialEntity ?? updateSocialEntityDefault;
        return updateSocial(messageId, { payload: { body: newBody } });
    }
    const editLegacy = deps.editChatRoomMessage ?? editChatRoomMessageLegacy;
    return editLegacy(messageId, newBody);
}

// === Delete (soft) ==========================================================

/**
 * `deleteDmMessageUnified` — beta path soft-deletes via the universal store;
 * legacy path has no equivalent endpoint and therefore returns a non-success
 * `ApiResponse` with `DM_DELETE_LEGACY_UNSUPPORTED`. The reason string only
 * flows through on the beta path.
 *
 * Pre-cutover, `DialogsPanel` should hide / disable any delete affordance
 * when the beta flag is off — otherwise a click will surface the
 * unsupported error to the user. Surfacing the limitation as an explicit
 * error (rather than silently no-opping) keeps callers honest.
 */
export async function deleteDmMessageUnified(
    messageId: string,
    reason: string | undefined,
    useSocialBeta: boolean,
    deps: SocialDmActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(messageId, reason);
    }
    return {
        success: false,
        error: 'Legacy DM has no soft-delete endpoint; enable socialFeedBeta to delete messages.',
        errorCode: 'DM_DELETE_LEGACY_UNSUPPORTED',
    };
}
