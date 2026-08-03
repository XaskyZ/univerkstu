/**
 * Pure helpers for the chat pin-message feature (DM + global chat).
 *
 * Two surfaces:
 *  - `isMessagePinnable` decides whether the viewer is allowed to flip the
 *    pin state for a given message. The matrix differs by chat kind:
 *      * `dm`     — either DM peer may pin. The viewer must be authenticated
 *                   AND match the message author or the room's peer user id.
 *      * `global` — only moderators / admins may pin. The viewer must carry
 *                   `canModerate: true` (sourced from the legacy global-chat
 *                   viewer state).
 *    The function also rejects pending optimistic ids (`__pending_*`) and
 *    requires a non-empty message id so callers can pass a raw message object
 *    without a defensive null check.
 *  - `formatPinnedSnippet` builds the short body preview rendered in the
 *    sticky pinned rail above the message list. Collapses whitespace and
 *    truncates to a configurable limit (default 80 chars, matching the spec).
 *
 * `getPinUi(language)` returns the localized strings for ru / kz / en used by
 * tooltips and the rail header. Keeps the per-locale literals in one place so
 * the chat panel JSX stays readable.
 *
 * Pure module — no React, no fetch. Safe to import from tests.
 */

export type ChatPinKind = 'dm' | 'global';

/**
 * Subset of viewer context required by `isMessagePinnable`. We accept a
 * lightweight bag instead of importing the full `useAuth` / `useGlobalChat`
 * types so the helper can be unit-tested without React.
 */
export interface PinViewerContext {
    /** Authenticated viewer id, or null when unauthenticated. */
    userId: string | null | undefined;
    /**
     * Whether the viewer carries moderator/admin powers. Only consulted for
     * the `global` chat path — DM ignores this flag entirely (peers pin
     * regardless of mod status).
     */
    canModerate?: boolean;
    /**
     * For `dm` only — the user id of the room's peer. Used so non-author
     * participants can still pin a peer's message. Undefined / null when the
     * room hasn't loaded yet; in that case the helper falls back to the
     * author-match branch.
     */
    peerUserId?: string | null;
}

/**
 * Subset of the message required by `isMessagePinnable`. Both `DmMessageAdapterShape`
 * and `GlobalMessageAdapterShape` provide these fields.
 */
export interface PinMessageContext {
    id: string;
    authorUserId: string;
}

/**
 * Returns `true` when the viewer is allowed to flip the pin state of the
 * given message. False for unauthenticated viewers, pending optimistic ids,
 * empty ids, and the global-chat-but-not-moderator case.
 *
 * DM rule: either peer may pin. The viewer is "either peer" when the message
 * author matches the viewer (own message) OR the room's peer is set and the
 * viewer is the peer's counterpart (which by construction means the viewer
 * is one of the two room participants).
 *
 * Global rule: viewer must have `canModerate: true`.
 */
export function isMessagePinnable(
    kind: ChatPinKind,
    message: PinMessageContext,
    viewer: PinViewerContext,
): boolean {
    if (!viewer.userId) return false;
    if (!message.id) return false;
    if (message.id.startsWith('__pending_')) return false;
    if (kind === 'global') {
        return viewer.canModerate === true;
    }
    // DM: viewer must be a participant. The chat shell only opens a DM room
    // for one of the two participants, so either the viewer is the author
    // (own outbound) or the viewer is the receiver of the peer's message.
    // When `peerUserId` is provided we accept "viewer is author OR author is
    // the peer" as the participant check. When `peerUserId` is missing we
    // fall back to author-equality only — the safer of the two defaults.
    if (message.authorUserId === viewer.userId) return true;
    if (viewer.peerUserId && message.authorUserId === viewer.peerUserId) return true;
    return false;
}

/**
 * Trim and collapse whitespace, then clip to `limit` chars with a trailing
 * ellipsis. Returns an empty string when the input has no visible content.
 *
 * `limit` defaults to 80 (matches the spec: "first 80 chars body" in the
 * pinned rail mini-card). The ellipsis character `…` consumes one character
 * from the budget so the visible output is at most `limit` codepoints total.
 */
export function formatPinnedSnippet(body: string | null | undefined, limit = 80): string {
    const normalized = (body || '').replace(/\s+/g, ' ').trim();
    if (normalized.length === 0) return '';
    if (normalized.length <= limit) return normalized;
    if (limit <= 1) return '…';
    return `${normalized.slice(0, limit - 1)}…`;
}

/**
 * Pick the pinned messages out of a thread list. Preserves the input order,
 * which the rail caller can subsequently re-sort if it wants newest-pinned
 * first. Pure passthrough — exposed for unit testing.
 */
export function pickPinnedMessages<T extends { pinned?: boolean }>(messages: T[]): T[] {
    return messages.filter((message) => message.pinned === true);
}

/**
 * Locale-aware tooltips + labels for the pin feature. The keys are tested
 * for parity by the dedicated suite at the bottom of this file's companion
 * `.test.ts`; if you add a key here, also add it to the locale parity test.
 *
 * `language` follows the project-wide `AppLanguage` triple (`ru` | `kz` | `en`).
 */
export interface PinUi {
    /** Action tooltip when the message is not yet pinned (e.g. "Pin"). */
    pin: string;
    /** Action tooltip when the message is already pinned. */
    unpin: string;
    /** Header shown above the sticky pinned-messages rail. */
    pinnedHeader: string;
    /** Hint shown when the viewer is not allowed to pin (e.g. global chat non-mod). */
    notAllowed: string;
    /**
     * "Show all (N)" expand affordance shown when the pinned rail has more
     * than the default visible cap (3 cards). `{count}` is a literal token
     * the caller `String.replace`s with the actual number.
     */
    showAll: string;
    /** "Collapse" / "Show less" toggle paired with `showAll`. */
    collapse: string;
}

const PIN_UI: Record<'ru' | 'kz' | 'en', PinUi> = {
    ru: {
        pin: 'Закрепить',
        unpin: 'Открепить',
        pinnedHeader: 'Закреплённые',
        notAllowed: 'Закреплять может только модератор',
        showAll: 'Показать все ({count})',
        collapse: 'Свернуть',
    },
    kz: {
        pin: 'Бекіту',
        unpin: 'Бекітуден шығару',
        pinnedHeader: 'Бекітілген',
        notAllowed: 'Тек модератор бекіте алады',
        showAll: 'Барлығын көрсету ({count})',
        collapse: 'Жасыру',
    },
    en: {
        pin: 'Pin',
        unpin: 'Unpin',
        pinnedHeader: 'Pinned',
        notAllowed: 'Only moderators can pin',
        showAll: 'Show all ({count})',
        collapse: 'Collapse',
    },
};

export function getPinUi(language: 'ru' | 'kz' | 'en'): PinUi {
    return PIN_UI[language] || PIN_UI.ru;
}
