'use client';

import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { getDraftUi } from '@/lib/drafts-i18n';

interface DraftRestoredHintProps {
    /**
     * Optional explicit visibility flag. When omitted, the hint auto-mounts
     * visible and self-dismisses after `autoDismissMs`. When provided, the
     * caller drives visibility (typical wiring: pass `hasDraft` from
     * `useDraft()`).
     */
    visible?: boolean;
    /**
     * Fires when the user clicks the close affordance OR the auto-dismiss
     * timer fires. Callers typically forward this into a piece of local state
     * so the hint stays hidden for the remainder of the surface mount.
     */
    onDismiss?: () => void;
    /**
     * Auto-dismiss window (ms). Defaults to 10s. Set to 0 to disable the
     * timer (caller controls dismissal exclusively).
     */
    autoDismissMs?: number;
    /** Optional className passthrough — caller may want to nudge spacing. */
    className?: string;
}

/**
 * Subtle one-line banner shown above a composer when an unsent draft has been
 * restored from localStorage. Uses semantic CSS variables (no hardcoded
 * theme-sensitive colors). Auto-dismisses after 10s by default.
 */
export default function DraftRestoredHint({
    visible = true,
    onDismiss,
    autoDismissMs = 10_000,
    className,
}: DraftRestoredHintProps) {
    const { language, messages } = useLanguage();
    const ui = getDraftUi(language);

    // Local "dismissed" guard so the auto-timer can hide the banner even when
    // the caller does not pass through a controlled `visible` prop. The
    // visible-prop flip (e.g. caller calls clearDraft after send) takes
    // precedence and skips the timer altogether.
    const [dismissed, setDismissed] = useState(false);

    // Track the last-seen `visible` value so we can reset `dismissed` at
    // render time (cascading-render-safe — see DialogsPanel for the same
    // pattern). When the caller flips visible from false → true (a fresh
    // draft restore), reset our local dismissed flag so the hint reappears.
    const [lastSeenVisible, setLastSeenVisible] = useState<boolean>(visible);
    if (lastSeenVisible !== visible) {
        setLastSeenVisible(visible);
        if (visible && dismissed) setDismissed(false);
    }

    useEffect(() => {
        if (!visible) return;
        if (autoDismissMs <= 0) return;
        const timer = setTimeout(() => {
            setDismissed(true);
            onDismiss?.();
        }, autoDismissMs);
        return () => clearTimeout(timer);
    }, [visible, autoDismissMs, onDismiss]);

    if (!visible || dismissed) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className={className}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 8px',
                marginBottom: 4,
                borderRadius: 8,
                background: 'var(--surface-overlay-1)',
                border: '1px solid var(--border)',
                color: 'var(--muted)',
                fontSize: 12,
                opacity: 0.7,
                width: 'fit-content',
                maxWidth: '100%',
            }}
        >
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {ui.draftRestoredHint}
            </span>
            <button
                type="button"
                onClick={() => {
                    setDismissed(true);
                    onDismiss?.();
                }}
                aria-label={messages.common.dismiss}
                style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                    display: 'inline-flex',
                    alignItems: 'center',
                }}
            >
                <X size={12} strokeWidth={2.4} aria-hidden />
            </button>
        </div>
    );
}
