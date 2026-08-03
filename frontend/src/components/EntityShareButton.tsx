'use client';

/**
 * Icon-only share button rendered next to actionable cards (posts,
 * tasks, lessons, events, polls, announcements, DM messages, global
 * chat messages).
 *
 * Behaviour:
 *  - Click → if `navigator.share` is available, opens the native share
 *    sheet with the absolute permalink. Falls back to clipboard copy
 *    with a toast confirmation.
 *  - The permalink is built off `window.location.origin` so we don't
 *    bake a backend URL into the bundle. SSR-safe: the click handler
 *    short-circuits when `window` is missing.
 *
 * The component is intentionally dumb — it does not know what kind of
 * entity it's representing. Callers supply the entity id (must be a
 * `social_entity.id`) and optionally a display title to use as the
 * native-share `title`/`text`.
 *
 * Gate at the call site: each card already gates on `socialFeedBeta` +
 * a valid social id; the button is rendered only when both are true.
 */

import { useCallback } from 'react';
import { Share2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/language-context';
import { buildEntityPermalinkPath } from '@/app/social/e/[id]/resolve';

interface EntityShareButtonProps {
    /**
     * Universal `social_entity.id` to share. Required — the button
     * hides itself when this is empty / falsy.
     */
    entityId: string | null | undefined;
    /**
     * Entity kind. Currently used only as part of the share-sheet
     * `text` payload (helps the OS render a richer preview); the
     * permalink URL is the same shape for every kind. Optional so
     * call-sites that only have the id can still mount the button.
     */
    entityKind?: string;
    /**
     * Display title threaded into the native share sheet (`title` /
     * `text`). Falls back to a generic "Shared link" label when omitted.
     */
    displayTitle?: string;
    /**
     * Additional className appended to the default chip styling. Mostly
     * used to align the button inside a flex row of card actions.
     */
    className?: string;
}

function buildShareUrl(entityId: string): string | null {
    const path = buildEntityPermalinkPath(entityId);
    if (!path) return null;
    if (typeof window === 'undefined' || !window.location || !window.location.origin) {
        return path;
    }
    return `${window.location.origin}${path}`;
}

export default function EntityShareButton({
    entityId,
    entityKind,
    displayTitle,
    className,
}: EntityShareButtonProps) {
    const { messages } = useLanguage();
    const ui = messages.share;

    const onShare = useCallback(async () => {
        if (typeof window === 'undefined') return;
        const trimmed = typeof entityId === 'string' ? entityId.trim() : '';
        if (!trimmed) return;

        const url = buildShareUrl(trimmed);
        if (!url) {
            toast.error(ui.copyFailed);
            return;
        }

        const sharePayload = {
            url,
            title: displayTitle || ui.shareEntity,
            text: displayTitle || ui.shareEntity,
        };

        const nav = window.navigator;
        // `canShare` is not implemented everywhere `share` is, so we
        // only call it defensively when present. Most mobile WebViews
        // expose both as a pair anyway.
        const canUseNative = typeof nav?.share === 'function'
            && (typeof nav.canShare !== 'function' || nav.canShare(sharePayload));

        if (canUseNative) {
            try {
                await nav.share(sharePayload);
                return;
            } catch (err) {
                // User cancellations show up as DOMException(AbortError).
                // Treat them as a no-op so we don't toast on every dismiss.
                if (err && (err as DOMException).name === 'AbortError') {
                    return;
                }
                // Fall through to the clipboard branch on real failures.
            }
        }

        const writer = nav?.clipboard?.writeText;
        try {
            if (writer) {
                await writer.call(nav.clipboard, url);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = url;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            toast.success(ui.copied);
        } catch {
            toast.error(ui.copyFailed);
        }
    }, [displayTitle, entityId, ui.copied, ui.copyFailed, ui.shareEntity]);

    if (typeof entityId !== 'string' || entityId.trim().length === 0) {
        return null;
    }

    // entityKind is forwarded into the data attribute so downstream
    // analytics / e2e tests can target a specific kind without parsing
    // sibling DOM. It is otherwise unused inside the click handler.
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                void onShare();
            }}
            aria-label={ui.shareEntity}
            title={ui.shareEntity}
            data-entity-kind={entityKind || undefined}
            className={`chip ${className ?? ''}`}
            data-size="sm"
        >
            <Share2 className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden />
        </button>
    );
}
