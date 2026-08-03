/**
 * Adapter from `SocialEntityView` (universal social store) → a global-chat
 * message-shaped view consumed by the `GlobalPanel` / `useGlobalChat` surfaces.
 *
 * Used by the `socialFeedBeta` opt-in path: when enabled, the global chat is
 * read from `/api/v3/social/scope/global/global:chat/entities?kind=global_message`
 * instead of `/api/v3/chat/global`. The adapter intentionally keeps the existing
 * UI components — `GlobalPanel`, `ChatRow` — usable behind a thin re-shape, but
 * the shape returned here mirrors the **social payload directly** rather than
 * the legacy `GlobalChatMessageView`. Callers that need the legacy shape
 * (because they still hand it to `ChatRow`) coerce via the helpers in
 * `social-global-chat-actions.ts`.
 *
 * Mapping rules (mirror the Phase 1c shim in
 * `backend/src/services/global-chat-shim.ts`):
 *  - `scopeId` is `global:chat`; the global-chat scope is the only one
 *    `global_message`-kind entities ever live under in Phase 1, so we don't
 *    surface it back to the UI.
 *  - `payload` for a `global_message` entity is
 *    `{ body, replyToMessageId?, editedAt? }`. Body is coerced to an empty
 *    string when missing so the UI never renders `undefined`.
 *  - `pinned` on the entity is the same field the legacy table exposed via
 *    `pinned_at`. The shim replays the legacy `pinned_at` timestamp onto
 *    `app_social_entity.pinned` during the Phase 1d backfill, so this boolean
 *    is the universal source of truth post-cutover.
 *  - Soft-delete fields survive — `deletedAt` mirrors legacy `deleted_at`,
 *    `deletedReason` surfaces the audit string the moderator set on delete.
 *  - **Moderation metadata (`isReportedByViewer`, `reportCount`, `canDelete`,
 *    `viewer`)** is NOT carried by the universal entity today. Those signals
 *    live in the separate `app_global_chat_reports` table and are joined into
 *    the legacy response server-side. The beta read path returns the raw
 *    entity; the integration layer is responsible for either:
 *      a) running a parallel `getGlobalChatReports` query for viewer state,
 *         or
 *      b) accepting the moderation gap (no flag UI in beta mode).
 *    The POC takes option (b) — moderation stays on the legacy path
 *    regardless of the flag (see `useGlobalChatSocial.ts` header).
 *
 * Pure function — no React, no fetch. Used by the hook AND by tests directly.
 */
import type { GlobalChatMessageView, ReactionAggregate } from '@/lib/api';
import type { SocialEntityView } from '@/lib/api/social';

/**
 * Global-message-shaped view returned by the adapter. Intentionally lightweight
 * — mirrors the **subset** of the social payload that the existing UI surfaces
 * read plus the cross-cutting entity fields (`id`, `authorUserId`, timestamps,
 * pin/soft-delete state).
 *
 * The shape diverges from the legacy `GlobalChatMessageView` on three axes:
 *  - `replyToMessageId` / `editedAt` are first-class fields lifted from the
 *    payload (legacy never exposed these on the global chat — they're new
 *    capabilities the universal store carries for free).
 *  - `pinned` is a plain boolean — legacy used `isPinned` + `pinnedAt`. The
 *    timestamp is dropped because the social entity does not carry it
 *    separately (the boolean is sufficient signal for the UI's pin chip).
 *  - Moderation fields (`canDelete`, `isReportedByViewer`, `reportCount`,
 *    `isOwn`, `authorLabel`) are intentionally **absent** — the universal
 *    store does not own them. The back-mapper fills them with conservative
 *    defaults so legacy-shaped UI keeps compiling.
 */
export interface GlobalMessageAdapterShape {
    id: string;
    authorUserId: string;
    body: string;
    /**
     * Reply target lifted from `payload.replyToMessageId`. Absent for top-level
     * messages. Surfacing it as optional rather than `null` matches the
     * universal payload contract (the shim never writes the key when there is
     * no reply).
     */
    replyToMessageId?: string;
    /**
     * ISO timestamp lifted from `payload.editedAt`, when the message has been
     * edited. Absent for never-edited messages.
     */
    editedAt?: string;
    createdAt: string;
    /**
     * Mirrors `app_social_entity.pinned` — replayed from the legacy
     * `pinned_at` during the Phase 1d backfill and the canonical signal
     * post-cutover. UI pin chips should branch on this boolean.
     */
    pinned: boolean;
    /**
     * Soft-delete tombstone (same as legacy `deleted_at`). Non-null when the
     * message has been moderated away — the UI hides the body in that case.
     */
    deletedAt: string | null;
    /**
     * Optional audit string the moderator attached when soft-deleting the
     * message. Surfaced for the (eventual) admin moderation view; the main
     * chat thread does not render it.
     */
    deletedReason?: string | null;
    /**
     * Aggregated reaction counts surfaced by `listSocialEntitiesByScope`. Pure
     * pass-through — the social-store toggle endpoint owns the canonical state.
     * Always present (an empty array when nobody has reacted) so callers can
     * pass the field directly to `ReactionsBar` without a null-check.
     */
    reactions: ReactionAggregate[];
    /**
     * Emojis the **viewer** has already picked, surfaced from `myReactions`.
     * `ReactionsBar` toggles active state off this set.
     */
    mine: string[];
}

function readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value ? value : undefined;
}

export function socialEntityToGlobalMessageView(view: SocialEntityView): GlobalMessageAdapterShape {
    const entity = view.entity;
    const payload = entity.payload || {};
    const replyToMessageId = readOptionalString(payload, 'replyToMessageId');
    const editedAt = readOptionalString(payload, 'editedAt');
    const result: GlobalMessageAdapterShape = {
        id: entity.id,
        authorUserId: entity.authorUserId,
        body: readString(payload, 'body'),
        createdAt: entity.createdAt,
        pinned: entity.pinned,
        deletedAt: entity.deletedAt,
        deletedReason: entity.deletedReason,
        reactions: view.reactions.map((aggregate) => ({
            emoji: aggregate.emoji,
            count: aggregate.count,
        })),
        mine: [...view.myReactions],
    };
    if (replyToMessageId !== undefined) result.replyToMessageId = replyToMessageId;
    if (editedAt !== undefined) result.editedAt = editedAt;
    return result;
}

/**
 * Back-mapper: re-shape a `GlobalMessageAdapterShape` into the legacy
 * `GlobalChatMessageView` consumed by `GlobalPanel` / `ChatRow`. Used by the
 * integration layer so the existing chat components stay unchanged when the
 * `socialFeedBeta` flag is on.
 *
 * Fields that have no social-store equivalent in Phase 1 get safe defaults:
 *  - `authorLabel`: the universal entity has no display-name field; legacy
 *    builds it from a parallel `app_users` join. The back-mapper accepts an
 *    optional `authorLabel` from the caller (so an integration layer that
 *    has a lookup table can populate it) and falls back to the truncated
 *    `authorUserId`.
 *  - `canDelete`: derived from `viewerUserId === authorUserId`. Moderator
 *    overrides — `canModerate` in the legacy viewer state — are NOT applied
 *    here; the integration layer that knows the viewer's moderator status
 *    should OR them in post-back-mapping.
 *  - `isOwn`: derived from `viewerUserId === authorUserId`.
 *  - `isReportedByViewer` / `reportCount`: hard-coded to `false` / `0` —
 *    moderation metadata lives on the legacy path. Beta mode hides the flag
 *    button (see the integration layer notes).
 *  - `pinnedAt`: null — the universal entity carries only the boolean. Phase
 *    1d backfill discards the timestamp deliberately (the boolean is enough
 *    for the UI's pin chip). If the timestamp becomes a UI requirement in
 *    Phase 2, the social entity schema would have to grow a `pinned_at`
 *    column.
 *
 * The `viewerUserId` arg is optional because some integration paths render
 * messages without an authenticated viewer (e.g. SSR shells). When absent,
 * `isOwn` and `canDelete` default to `false`.
 */
export function socialGlobalMessageToLegacyView(
    message: GlobalMessageAdapterShape,
    viewerUserId?: string | null,
    authorLabel?: string,
): GlobalChatMessageView {
    const isOwn = viewerUserId ? message.authorUserId === viewerUserId : false;
    return {
        id: message.id,
        authorUserId: message.authorUserId,
        authorLabel: authorLabel ?? message.authorUserId,
        body: message.body,
        createdAt: message.createdAt,
        isPinned: message.pinned,
        pinnedAt: null,
        isOwn,
        canDelete: isOwn,
        isReportedByViewer: false,
        reportCount: 0,
    };
}
