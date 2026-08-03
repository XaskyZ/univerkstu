/**
 * Unified write-path wrappers for the global-chat POC.
 *
 * Each function decides — based on the `useSocialBeta` flag the caller passes
 * in — whether to write through the **legacy** global-chat API
 * (`/api/v3/chat/global/*`, Phase 1c shim mirrors the change into
 * `app_social_entity` server-side) or **directly** through the universal
 * social store (`/api/v3/social/*`). This validates that the universal store
 * can serve the write path end-to-end while the legacy table is still source
 * of truth for everything else.
 *
 * Boundaries:
 *  - Wrappers are pure: the flag is an argument, not a global lookup. Lets
 *    callers (and tests) flip it without re-rendering React state.
 *  - APIs are injected via the second-to-last `deps` argument so tests can
 *    pass fakes instead of monkey-patching ESM bindings (the repo
 *    convention — see `social-announcement-actions.ts`).
 *  - Returned envelope is `ApiResponse<unknown>` — handlers downstream only
 *    branch on `success` + `error`; reusing the legacy shape avoids changing
 *    `GlobalPanel` error / refresh logic.
 *
 * **Scope of the wrappers:**
 *  - `sendGlobalMessageUnified` — POST a new message.
 *  - `deleteGlobalMessageUnified` — soft-delete (moderation or own message).
 *  - `pinGlobalMessageUnified` — toggle the pin chip.
 *
 * **NOT covered** (stays on the legacy path regardless of the flag):
 *  - `reportGlobalChatMessage`, `reviewGlobalChatReport` — moderation queue,
 *    no universal equivalent.
 *  - `muteGlobalChatUser`, `unmuteGlobalChatUser` — viewer mute state, lives
 *    in the chat-specific `app_global_chat_mutes` table.
 *  - View-state read (`canModerate`, `isMuted`, mute expiry) — comes from
 *    `getGlobalChatMessages` and has no universal endpoint.
 *
 * **ID mapping rule** when `useSocialBeta` is on:
 *  - `messageId` is the **`app_social_entity.id`** (uuid). The read path
 *    (`useGlobalChatSocial`) surfaces the universal entity id directly via the
 *    adapter, so any id flowing back into the delete / pin handlers is the
 *    social id, not the legacy `app_global_chat_messages.id`.
 *  - Conversely, when `useSocialBeta` is off, `messageId` is the legacy id —
 *    matches the existing chat API contract.
 *
 * **Reply target rule** (`replyToMessageId` on `sendGlobalMessageUnified`):
 *  - Beta path writes it into `payload.replyToMessageId` verbatim.
 *  - Legacy path silently drops it — `createGlobalChatMessage` accepts only a
 *    body string today. The wrapper logs no warning; if the UI ever exposes
 *    reply targets while the flag is off, the integration layer should hide
 *    the affordance instead of relying on the wrapper to error.
 *
 * **Pin handling decision (legacy support):**
 *  - The legacy `setGlobalChatMessagePinned` endpoint (POST
 *    `/api/v3/chat/global/messages/:id/pin`) is **still present** in
 *    `lib/api/chat.ts` — it has not been removed by the social cleanup
 *    Wave 1, contrary to the prompt's caveat. We therefore implement
 *    `pinGlobalMessageUnified` symmetrically: beta path calls
 *    `pinSocialEntity`, legacy path calls `setGlobalChatMessagePinned`. If a
 *    future cleanup removes the legacy endpoint, the legacy branch will need
 *    to flip to a `GLOBAL_CHAT_PIN_LEGACY_UNSUPPORTED` error code (matching
 *    the announcement-pin precedent).
 */
import {
    createGlobalChatMessage as createGlobalChatMessageLegacy,
    deleteGlobalChatMessage as deleteGlobalChatMessageLegacy,
    setGlobalChatMessagePinned as setGlobalChatMessagePinnedLegacy,
} from '@/lib/api/chat';
import type { ApiResponse } from '@/lib/api/core';
import {
    createSocialEntity as createSocialEntityDefault,
    deleteSocialEntity as deleteSocialEntityDefault,
    pinSocialEntity as pinSocialEntityDefault,
} from '@/lib/api/social';

// === Shared types ===========================================================

/**
 * Input shape for the unified send wrapper. `replyToMessageId` is the social
 * entity id of the message being replied to (when `useSocialBeta` is on) or
 * legacy global-chat-message id (when off — and silently dropped in that
 * case; see header docs).
 */
export interface SendGlobalMessageInput {
    body: string;
    replyToMessageId?: string;
}

/**
 * Surface every API binding the wrappers need so tests can inject fakes
 * piecemeal without satisfying the entire shape every time.
 */
export interface SocialGlobalChatActionDeps {
    // social (universal store)
    createSocialEntity?: typeof createSocialEntityDefault;
    deleteSocialEntity?: typeof deleteSocialEntityDefault;
    pinSocialEntity?: typeof pinSocialEntityDefault;
    // legacy (chat global API)
    createGlobalChatMessage?: typeof createGlobalChatMessageLegacy;
    deleteGlobalChatMessage?: typeof deleteGlobalChatMessageLegacy;
    setGlobalChatMessagePinned?: typeof setGlobalChatMessagePinnedLegacy;
}

// === Helpers ================================================================

/**
 * Build the social-entity payload from a `SendGlobalMessageInput`. Drops
 * `undefined` fields so the backend AJV validator does not reject the body
 * for explicit-undefined keys (it accepts missing keys but not
 * `key: undefined` once stringified).
 */
function buildGlobalMessagePayload(input: SendGlobalMessageInput): Record<string, unknown> {
    const payload: Record<string, unknown> = { body: input.body };
    if (typeof input.replyToMessageId === 'string' && input.replyToMessageId) {
        payload.replyToMessageId = input.replyToMessageId;
    }
    return payload;
}

// === Send ===================================================================

/**
 * `sendGlobalMessageUnified` — beta path POSTs a `global_message`-kind entity
 * into the social store under `global:chat`; legacy path calls the existing
 * `createGlobalChatMessage` endpoint, dropping `replyToMessageId` if present
 * (the legacy endpoint accepts only a body string — see header docs).
 */
export async function sendGlobalMessageUnified(
    input: SendGlobalMessageInput,
    useSocialBeta: boolean,
    deps: SocialGlobalChatActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const createSocial = deps.createSocialEntity ?? createSocialEntityDefault;
        return createSocial({
            kind: 'global_message',
            scopeType: 'global',
            scopeId: 'global:chat',
            payload: buildGlobalMessagePayload(input),
        });
    }
    const createLegacy = deps.createGlobalChatMessage ?? createGlobalChatMessageLegacy;
    return createLegacy(input.body);
}

// === Delete (soft-delete) ===================================================

/**
 * `deleteGlobalMessageUnified` — soft-delete in both modes. The legacy chat
 * route writes `deleted_at` on `app_global_chat_messages` and also resolves
 * any open reports against the message; the social route writes `deleted_at`
 * on the mirror entity. The legacy `deleteGlobalChatMessage` accepts a
 * `reason` (audit string); the social `deleteSocialEntity` also accepts a
 * `reason` querystring, so we pass it through on both paths.
 */
export async function deleteGlobalMessageUnified(
    messageId: string,
    reason: string | null | undefined,
    useSocialBeta: boolean,
    deps: SocialGlobalChatActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(messageId, reason || undefined);
    }
    const deleteLegacy = deps.deleteGlobalChatMessage ?? deleteGlobalChatMessageLegacy;
    return deleteLegacy(messageId, reason || null);
}

// === Pin / unpin ============================================================

/**
 * `pinGlobalMessageUnified` — beta path hits the dedicated `/pin` endpoint on
 * the universal store; legacy path calls `setGlobalChatMessagePinned` on the
 * chat API. Both endpoints take the same `(id, pinned: boolean)` shape, so
 * the wrapper just routes by flag — no enum bridging, no audit-string
 * differences. Symmetry is the entire point.
 *
 * Pin handling decision: see the header comment. Legacy pin remains
 * supported; this wrapper does NOT return a `GLOBAL_CHAT_PIN_LEGACY_UNSUPPORTED`
 * code (unlike `pinAnnouncementUnified`, where legacy has no pin endpoint).
 */
export async function pinGlobalMessageUnified(
    messageId: string,
    pinned: boolean,
    useSocialBeta: boolean,
    deps: SocialGlobalChatActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const pinSocial = deps.pinSocialEntity ?? pinSocialEntityDefault;
        return pinSocial(messageId, pinned);
    }
    const pinLegacy = deps.setGlobalChatMessagePinned ?? setGlobalChatMessagePinnedLegacy;
    return pinLegacy(messageId, pinned);
}
