'use client';

import { useEffect, useRef, useState } from 'react';
import { SettingsBottomSheet } from '@/components/SettingsBottomSheet';
import { useLanguage } from '@/lib/language-context';

/**
 * Lightweight moderation-reason prompt that replaces six `window.prompt`
 * callsites in the chat layer (report message, dismiss report, mute author,
 * etc.).
 *
 * Renders as a bottom sheet on mobile and a centered modal on desktop via
 * `SettingsBottomSheet`. The textarea is optional — the backend is being
 * updated to accept an empty reason, so submitting with an empty value is a
 * legitimate UX path.
 */
export interface ReasonModalProps {
    open: boolean;
    /** Sheet title — pass a localised label matching the action. */
    title: string;
    /**
     * Optional descriptive subtitle shown under the title (e.g. "Это поможет
     * модераторам").
     */
    subtitle?: string;
    /** Initial textarea value when the modal opens. */
    initialReason?: string;
    /**
     * Called when the user confirms. `reason` is the trimmed textarea value
     * and may be an empty string.
     */
    onSubmit: (reason: string) => void;
    /** Called when the user cancels or backdrop-dismisses. */
    onClose: () => void;
}

export function ReasonModal({
    open,
    title,
    subtitle,
    initialReason = '',
    onSubmit,
    onClose,
}: ReasonModalProps) {
    const { messages } = useLanguage();

    // We use the `open` flag as the form's React `key` so each opening of the
    // sheet remounts the inner form with a fresh textarea state — no
    // setState-in-effect dance needed to reset stale input.
    return (
        <SettingsBottomSheet
            open={open}
            onClose={onClose}
            title={title}
            subtitle={subtitle}
            closeAriaLabel={messages.common.close}
        >
            {open ? (
                <ReasonForm
                    key={String(open)}
                    initialReason={initialReason}
                    onSubmit={onSubmit}
                    onCancel={onClose}
                />
            ) : null}
        </SettingsBottomSheet>
    );
}

interface ReasonFormProps {
    initialReason: string;
    onSubmit: (reason: string) => void;
    onCancel: () => void;
}

function ReasonForm({ initialReason, onSubmit, onCancel }: ReasonFormProps) {
    const { messages } = useLanguage();
    const [reason, setReason] = useState(initialReason);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Pure side-effect: bring focus to the textarea once the entrance
    // animation has settled. No React state is touched here.
    useEffect(() => {
        const raf = requestAnimationFrame(() => textareaRef.current?.focus());
        return () => cancelAnimationFrame(raf);
    }, []);

    return (
        <div className="px-5 pt-2 pb-4 flex flex-col gap-3">
            <textarea
                ref={textareaRef}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder={messages.chat.reasonModal.placeholder}
                rows={4}
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
                    onClick={onCancel}
                    className="peoplev2-btn peoplev2-btn-ghost"
                >
                    {messages.chat.reasonModal.cancel}
                </button>
                <button
                    type="button"
                    onClick={() => onSubmit(reason.trim())}
                    className="peoplev2-btn peoplev2-btn-primary"
                >
                    {messages.chat.reasonModal.submit}
                </button>
            </div>
        </div>
    );
}
