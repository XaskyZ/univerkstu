'use client';

/**
 * Universal report sheet for the social moderation surface.
 *
 * Mirrors the legacy `ReasonModal` in `app/chat/components/ReasonModal.tsx`
 * but consumes the universal-store `reportSocialEntity` API client function
 * directly. Used wherever a social entity (post / dm message / global message
 * / announcement) needs a "report" affordance, gated behind the
 * `socialFeedBeta` flag in the host UI.
 *
 * The component is intentionally generic — the host page passes the entity id
 * + a localized title and the sheet handles:
 *   - reason textarea with optional submit (backend accepts empty reason)
 *   - cap validation via `sanitizeModerationReason`
 *   - submit + toast wiring via the supplied callback
 *   - cancel / backdrop close via `SettingsBottomSheet`
 *
 * No theme-sensitive color is hardcoded — see CLAUDE.md rule #1. Surface
 * styling reuses the same CSS variables / classes as the legacy ReasonModal.
 */
import { useEffect, useRef, useState } from 'react';
import { SettingsBottomSheet } from '@/components/SettingsBottomSheet';
import {
    reportSocialEntity,
    sanitizeModerationReason,
    SOCIAL_REPORT_REASON_MAX_LENGTH,
} from '@/lib/api/social';
import { useLanguage } from '@/lib/language-context';

export interface SocialReportSheetProps {
    /** Whether the sheet is rendered. Host controls open/close state. */
    open: boolean;
    /** Universal social entity id under report (post / message / etc). */
    entityId: string | null;
    /** Sheet title — pass a localised label so the action is unambiguous. */
    title: string;
    /** Optional subtitle for context (e.g. "Это поможет модераторам"). */
    subtitle?: string;
    /** Called on success after the server returns 201. */
    onSubmitted?: () => void;
    /** Called when the user cancels or backdrop-dismisses. */
    onClose: () => void;
    /**
     * Optional reporter callback so the host can surface success / error
     * toasts. Falls back to a no-op when not provided.
     */
    onError?: (message: string) => void;
}

export function SocialReportSheet({
    open,
    entityId,
    title,
    subtitle,
    onSubmitted,
    onClose,
    onError,
}: SocialReportSheetProps) {
    const { messages } = useLanguage();
    return (
        <SettingsBottomSheet
            open={open}
            onClose={onClose}
            title={title}
            subtitle={subtitle}
            closeAriaLabel={messages.common.close}
        >
            {open && entityId ? (
                <SocialReportForm
                    key={`${entityId}-${String(open)}`}
                    entityId={entityId}
                    onSubmitted={onSubmitted}
                    onClose={onClose}
                    onError={onError}
                />
            ) : null}
        </SettingsBottomSheet>
    );
}

interface SocialReportFormProps {
    entityId: string;
    onSubmitted?: () => void;
    onClose: () => void;
    onError?: (message: string) => void;
}

function SocialReportForm({
    entityId,
    onSubmitted,
    onClose,
    onError,
}: SocialReportFormProps) {
    const { messages } = useLanguage();
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        const raf = requestAnimationFrame(() => textareaRef.current?.focus());
        return () => cancelAnimationFrame(raf);
    }, []);

    const handleSubmit = async () => {
        if (busy) return;
        let cleaned: string | null;
        try {
            cleaned = sanitizeModerationReason(reason);
        } catch {
            // Reason too long — bubble a simple inline message through the
            // host onError callback. We deliberately do NOT introduce new
            // locale keys for this edge case; the textarea `maxLength`
            // attribute prevents it in practice.
            onError?.('reason too long');
            return;
        }
        setBusy(true);
        try {
            const result = await reportSocialEntity(entityId, cleaned ?? undefined);
            if (result.success) {
                onSubmitted?.();
                onClose();
            } else {
                onError?.(result.error || 'report failed');
            }
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="px-5 pt-2 pb-4 flex flex-col gap-3">
            <textarea
                ref={textareaRef}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={messages.chat.reasonModal.placeholder}
                rows={4}
                maxLength={SOCIAL_REPORT_REASON_MAX_LENGTH}
                className="reason-modal-textarea"
                style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    background: 'var(--surface-overlay-1)',
                    color: 'var(--text)',
                    fontSize: 'var(--text-md)',
                    lineHeight: 1.45,
                    resize: 'vertical',
                    minHeight: 96,
                }}
            />
            <div className="flex items-center justify-end gap-2">
                <button
                    type="button"
                    onClick={onClose}
                    disabled={busy}
                    className="peoplev2-btn peoplev2-btn-ghost"
                >
                    {messages.chat.reasonModal.cancel}
                </button>
                <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={busy}
                    className="peoplev2-btn peoplev2-btn-primary"
                >
                    {messages.chat.reasonModal.submit}
                </button>
            </div>
        </div>
    );
}
