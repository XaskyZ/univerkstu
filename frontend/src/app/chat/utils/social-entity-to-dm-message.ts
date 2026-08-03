/**
 * Adapter from `SocialEntityView` (universal social store) → a DM-message
 * shaped view consumed by the `DialogsPanel` thread renderer.
 *
 * Used by the `socialFeedBeta` opt-in path: when enabled, the DM thread is
 * read from
 * `/api/v3/social/scope/dm/dm:<roomId>/entities?kind=dm_message` instead of
 * `/api/v3/chat/rooms/<roomId>` (the legacy detail endpoint). The adapter
 * keeps the existing UI components — including the `ChatThread` props
 * contract — unchanged.
 *
 * Mapping rules (mirror the Phase 1c shim in
 * `backend/src/services/chat-dm-shim.ts` and the migration described in
 * `docs/SOCIAL_STORE.md`):
 *  - `scopeId` is `dm:<roomId>`; we strip the `dm:` prefix to recover the
 *    bare room id consumed by the UI / read-state code.
 *  - `payload` for a `dm_message` entity is
 *    `{ body, replyToMessageId?, editedAt? }`.
 *  - `editedAt` is also surfaced at the top level (legacy `ChatMessageView`
 *    treats edit state as a top-level field). Both spellings are accepted on
 *    read — we prefer the entity's `updatedAt` when the payload omits it but
 *    the entity has been touched after creation, matching the legacy
 *    behaviour where `editedAt` flips to a non-null timestamp on every
 *    server-side patch.
 *  - Soft-delete fields (`deletedAt`) survive. Legacy DM does NOT expose
 *    tombstones to the thread renderer, but the field is surfaced so a
 *    future "deleted message" UI can read it without re-plumbing the API.
 *
 * Pure function — no React, no fetch. Used by the hook AND by tests directly.
 */
import type { ReactionAggregate } from '@/lib/api';
import type { SocialEntityView } from '@/lib/api/social';

const SCOPE_PREFIX = 'dm:';

function readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value ? value : undefined;
}

function stripDmPrefix(scopeId: string): string {
    return scopeId.startsWith(SCOPE_PREFIX) ? scopeId.slice(SCOPE_PREFIX.length) : scopeId;
}

/**
 * DM-message shaped view returned by the adapter. Intentionally lightweight —
 * mirrors the subset of fields the universal payload tracks today. Carries
 * the universal `body` / `replyToMessageId` / `editedAt` shape directly;
 * downstream code that needs the legacy `ChatMessageView` shape (e.g. the
 * `roomKind`, `authorLabel`, or `isOwn` flags) is responsible for projecting
 * it — those fields are not stored on the social entity at all and must be
 * derived from request context.
 */
export interface DmMessageAdapterShape {
    id: string;
    /** Bare room id (scope prefix stripped). */
    roomId: string;
    authorUserId: string;
    body: string;
    /** Present only when this message is a reply to another DM message. */
    replyToMessageId?: string;
    /**
     * ISO 8601 timestamp of the last edit. Undefined when the message has
     * never been edited. Falls back to the entity's `updatedAt` when the
     * payload omits an explicit `editedAt` but the entity has been touched
     * post-creation (legacy parity).
     */
    editedAt?: string;
    createdAt: string;
    /**
     * Mirrors `app_social_entity.pinned`. Boolean — the universal entity
     * does not carry a separate `pinned_at` timestamp. Drives the sticky
     * "pinned messages" rail above the thread and the inline pin chip on
     * each bubble. Either DM peer can flip this via the universal pin
     * endpoint.
     */
    pinned: boolean;
    deletedAt: string | null;
    /**
     * Aggregated reaction counts surfaced by `listSocialEntitiesByScope`. Pure
     * pass-through — the social-store toggle endpoint owns the canonical state
     * and the read endpoint joins the aggregate in for free. Always present (an
     * empty array when nobody has reacted) so callers can pass the field
     * directly to `ReactionsBar` without a null-check.
     */
    reactions: ReactionAggregate[];
    /**
     * Emojis the **viewer** has already picked, surfaced from `myReactions`.
     * `ReactionsBar` toggles active state off this set.
     */
    mine: string[];
}

export function socialEntityToDmMessageView(view: SocialEntityView): DmMessageAdapterShape {
    const entity = view.entity;
    const payload = entity.payload || {};
    // Prefer the payload-level `editedAt` because Phase 1c writes a fresh
    // timestamp there on every edit. Fall back to entity.updatedAt only when
    // the entity row was touched after creation (signals a soft-delete /
    // restore as well; the renderer will distinguish via `deletedAt`).
    const payloadEditedAt = readOptionalString(payload, 'editedAt');
    const entityWasTouched = entity.updatedAt && entity.updatedAt !== entity.createdAt;
    const editedAt = payloadEditedAt ?? (entityWasTouched ? entity.updatedAt : undefined);
    return {
        id: entity.id,
        roomId: stripDmPrefix(entity.scopeId),
        authorUserId: entity.authorUserId,
        body: readString(payload, 'body'),
        replyToMessageId: readOptionalString(payload, 'replyToMessageId'),
        editedAt,
        createdAt: entity.createdAt,
        pinned: entity.pinned === true,
        deletedAt: entity.deletedAt,
        reactions: view.reactions.map((aggregate) => ({
            emoji: aggregate.emoji,
            count: aggregate.count,
        })),
        mine: [...view.myReactions],
    };
}
