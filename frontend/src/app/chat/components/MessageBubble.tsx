'use client';

import { type ReactNode } from 'react';
import { useLanguage } from '@/lib/language-context';
import LinkPreviewCard from '@/components/LinkPreviewCard';
import { extractFirstUrl } from '@/lib/extract-url';

/**
 * Shared message bubble for both DM threads (DialogsPanel) and the global chat
 * (GlobalPanel). Replaces the near-identical `BubbleRow` + `ChatRowV2`
 * implementations.
 *
 * Strictly presentational and self-contained — does not import from
 * DialogsPanel.tsx / GlobalPanel.tsx. All callers pass already-formatted
 * timestamps and already-resolved interactive nodes (avatar / actions) so this
 * stays purely about layout and theme tokens.
 */
export interface MessageBubbleProps {
    /** The body text of the message. Already trimmed; rendered as-is. */
    text: string;
    /** Pre-formatted timestamp string (e.g. "12:34" or "Сегодня в 12:34"). */
    timestamp: string;
    /** True when the message is from the viewer — affects alignment + tail. */
    isOwn: boolean;
    /**
     * True when the previous message is from the same author within ~5min.
     * Suppresses the author header and tightens vertical spacing.
     */
    isContinuation: boolean;
    /** Author display name. Only shown when !isOwn and !isContinuation. */
    authorName?: string;
    /**
     * Optional avatar node (initials circle, gradient blob, etc.). The caller
     * controls clickability — pass a `<UserProfileSheet trigger={...}>` or any
     * other interactive element.
     */
    authorAvatar?: ReactNode;
    /** Greyed-out visual state while the message is sending. */
    pending?: boolean;
    /** Slot for hover/tap action group (Reply, Report, Delete, ...). */
    actions?: ReactNode;
    /** Optional click handler on the bubble content (e.g. to open thread). */
    onClick?: () => void;
}

export function MessageBubble({
    text,
    timestamp,
    isOwn,
    isContinuation,
    authorName,
    authorAvatar,
    pending = false,
    actions,
    onClick,
}: MessageBubbleProps) {
    const { messages } = useLanguage();

    const rowClass = [
        'message-bubble',
        isOwn ? 'message-bubble--own' : 'message-bubble--other',
        isContinuation ? 'message-bubble--continued' : '',
        pending ? 'message-bubble--pending' : '',
    ]
        .filter(Boolean)
        .join(' ');

    const showHeader = !isOwn && !isContinuation && (authorName || authorAvatar);

    return (
        <div className={rowClass}>
            {showHeader ? (
                <div className="message-bubble-header">
                    {authorAvatar ?? null}
                    {authorName ? (
                        <span className="message-bubble-author">{authorName}</span>
                    ) : null}
                </div>
            ) : null}
            <div
                className="message-bubble-content"
                onClick={onClick}
                role={onClick ? 'button' : undefined}
                tabIndex={onClick ? 0 : undefined}
            >
                {text}
                {(() => {
                    // Render an Open Graph unfurl card under the message text
                    // when the body contains an http(s) URL. The card lazy-
                    // fetches its metadata and self-hides on failure, so this
                    // gate is purely a render-skip optimization.
                    const url = extractFirstUrl(text);
                    return url ? <LinkPreviewCard url={url} /> : null;
                })()}
            </div>
            <div className="message-bubble-meta">
                <span>{timestamp}</span>
                {actions ? (
                    <div
                        className="message-bubble-actions"
                        role="group"
                        aria-label={messages.common.actions}
                    >
                        {actions}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
