'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

export type NotifyGroupPriority = 'info' | 'warning' | 'critical';

export interface NotifyGroupModalProps {
    open: boolean;
    onClose: () => void;
    groupKey: string;
    onSubmit: (payload: { title: string; body: string; priority: NotifyGroupPriority }) => Promise<void>;
}

/**
 * Focused composer for a one-off group announcement. No expiry — backend
 * handles `expiresAt: null` gracefully. Wires straight into
 * `createAdminCoordinatorAnnouncement` via the caller's `onSubmit`.
 */
export default function NotifyGroupModal({ open, onClose, groupKey, onSubmit }: NotifyGroupModalProps) {
    const { messages } = useLanguage();
    const ui = messages.curator.notify;
    const dialogRef = useRef<HTMLDialogElement | null>(null);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [priority, setPriority] = useState<NotifyGroupPriority>('info');
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) return;
        setTitle('');
        setBody('');
        setPriority('info');
        setSubmitting(false);
    }, [open]);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) dialog.showModal();
        else if (!open && dialog.open) dialog.close();
    }, [open]);

    async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting || !title.trim() || !body.trim() || !groupKey) return;
        setSubmitting(true);
        try {
            await onSubmit({ title: title.trim(), body: body.trim(), priority });
            onClose();
        } finally {
            setSubmitting(false);
        }
    }

    const priorityOptions: ReadonlyArray<{ value: NotifyGroupPriority; label: string }> = [
        { value: 'info', label: ui.priorityInfo },
        { value: 'warning', label: ui.priorityWarning },
        { value: 'critical', label: ui.priorityCritical },
    ];

    return (
        <dialog
            ref={dialogRef}
            className="group-form-dialog"
            onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
            onCancel={(event) => { event.preventDefault(); onClose(); }}
            onClose={onClose}
        >
            <div className="group-form-panel">
                <div className="group-form-head">
                    <h3 className="text-lg font-semibold text-fg">{ui.modalTitle}</h3>
                    <button type="button" onClick={onClose} className="group-form-close" aria-label={messages.common.close}>
                        <X size={16} strokeWidth={2.4} />
                    </button>
                </div>
                <form className="group-form-body" onSubmit={handleSubmit}>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-fg">{ui.titleLabel}</span>
                        <input
                            type="text"
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            required
                            disabled={submitting}
                            className="input"
                        />
                    </label>
                    <label className="block space-y-2">
                        <span className="text-sm font-medium text-fg">{ui.bodyLabel}</span>
                        <textarea
                            value={body}
                            onChange={(event) => setBody(event.target.value)}
                            rows={6}
                            required
                            disabled={submitting}
                            className="input resize-y"
                        />
                    </label>
                    <div className="block space-y-2">
                        <span className="text-sm font-medium text-fg">{ui.priorityLabel}</span>
                        <div role="radiogroup" aria-label={ui.priorityLabel} className="flex gap-2 flex-wrap">
                            {priorityOptions.map((option) => {
                                const active = priority === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setPriority(option.value)}
                                        disabled={submitting}
                                        className="px-4 py-2 rounded-xl text-sm"
                                        style={{
                                            background: active ? 'var(--gradient-primary)' : 'var(--surface-overlay-2)',
                                            color: active ? '#fff' : 'var(--muted)',
                                            border: '1px solid var(--border)',
                                        }}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="flex items-center justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            disabled={submitting}
                            className="px-4 py-2.5 rounded-xl text-muted-fg"
                            style={{ border: '1px solid var(--border)' }}
                        >
                            {ui.cancelBtn}
                        </button>
                        <button type="submit" disabled={submitting || !title.trim() || !body.trim() || !groupKey} className="btn btn-primary px-4 py-2.5 disabled:opacity-60">
                            {submitting ? messages.common.loading : ui.submitBtn}
                        </button>
                    </div>
                </form>
            </div>
        </dialog>
    );
}
