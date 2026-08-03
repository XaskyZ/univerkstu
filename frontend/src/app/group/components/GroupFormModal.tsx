'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { useDraft } from '@/lib/use-draft';
import DraftRestoredHint from '@/components/DraftRestoredHint';
import MentionableTextareaField from './MentionableTextareaField';

export type GroupFormField =
    | { name: string; label: string; type: 'text' | 'date' | 'datetime' | 'time'; placeholder?: string; required?: boolean; defaultValue?: string; disabled?: boolean }
    | {
        name: string;
        label: string;
        type: 'textarea';
        placeholder?: string;
        required?: boolean;
        rows?: number;
        defaultValue?: string;
        disabled?: boolean;
        /** Enables the @mention autocomplete dropdown for this field. */
        mentionScope?: string;
        /**
         * When set, autosaves the textarea value to localStorage under this
         * key (via `useDraft`) and shows a "draft restored" hint on the
         * next reopen. Callers should leave this unset for "edit existing
         * entity" modals — restoring a draft over a pre-filled value would
         * silently overwrite the user's saved data.
         */
        draftKey?: string;
    }
    | { name: string; label: string; type: 'select'; required?: boolean; defaultValue?: string; options: Array<{ label: string; value: string }>; disabled?: boolean }
    | { name: string; label: string; type: 'checkbox'; defaultValue?: boolean; disabled?: boolean };

export default function GroupFormModal({
    open,
    title,
    fields,
    loading = false,
    submitLabel,
    onSubmit,
    onCancel,
}: {
    open: boolean;
    title: string;
    fields: GroupFormField[];
    loading?: boolean;
    submitLabel: string;
    onSubmit: (values: Record<string, string | boolean>) => void | Promise<void>;
    onCancel: () => void;
}) {
    const { messages } = useLanguage();
    const initialValues = useMemo(() => {
        return fields.reduce<Record<string, string | boolean>>((acc, field) => {
            if (field.type === 'checkbox') {
                acc[field.name] = field.defaultValue ?? false;
            } else {
                acc[field.name] = field.defaultValue ?? '';
            }
            return acc;
        }, {});
    }, [fields]);

    const [values, setValues] = useState<Record<string, string | boolean>>(initialValues);
    const dialogRef = useRef<HTMLDialogElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const timer = window.setTimeout(() => {
            setValues(initialValues);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [initialValues, open]);

    const setFieldValue = useCallback((name: string, next: string | boolean) => {
        setValues((current) => ({ ...current, [name]: next }));
    }, []);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (open && !dialog.open) {
            dialog.showModal();
        } else if (!open && dialog.open) {
            dialog.close();
        }
    }, [open]);

    return (
        <dialog
            ref={dialogRef}
            className="group-form-dialog"
            onClick={(event) => {
                if (event.target === event.currentTarget) onCancel();
            }}
            onCancel={(event) => {
                event.preventDefault();
                onCancel();
            }}
            onClose={onCancel}
        >
            <div className="group-form-panel">
                <div className="group-form-head">
                    <h3 className="text-lg font-semibold text-fg">{title}</h3>
                    <button
                        type="button"
                        onClick={onCancel}
                        className="group-form-close"
                        aria-label={messages.common.close}
                    >
                        <X size={16} strokeWidth={2.4} />
                    </button>
                </div>
                <form
                    className="group-form-body"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void onSubmit(values);
                    }}
                >
                    {fields.map((field) => (
                        <label key={field.name} className="block space-y-2">
                            <span className="text-sm font-medium text-fg">{field.label}</span>
                            {field.type === 'textarea' ? (
                                field.draftKey ? (
                                    <DraftableTextareaField
                                        field={field}
                                        value={String(values[field.name] ?? '')}
                                        onChange={(next) => setFieldValue(field.name, next)}
                                        draftKey={field.draftKey}
                                    />
                                ) : field.mentionScope ? (
                                    <MentionableTextareaField
                                        value={String(values[field.name] ?? '')}
                                        onChange={(next) => setFieldValue(field.name, next)}
                                        required={field.required}
                                        rows={field.rows ?? 5}
                                        placeholder={field.placeholder}
                                        disabled={field.disabled}
                                        scope={field.mentionScope}
                                    />
                                ) : (
                                    <textarea
                                        value={String(values[field.name] ?? '')}
                                        required={field.required}
                                        rows={field.rows ?? 5}
                                        placeholder={field.placeholder}
                                        disabled={field.disabled}
                                        onChange={(event) => setFieldValue(field.name, event.target.value)}
                                        className="input resize-y"
                                    />
                                )
                            ) : field.type === 'select' ? (
                                <select
                                    value={String(values[field.name] ?? '')}
                                    required={field.required}
                                    disabled={field.disabled}
                                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                                    className="input"
                                >
                                    {field.options.map((option) => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </select>
                            ) : field.type === 'checkbox' ? (
                                <div className="flex items-center gap-3 rounded-2xl px-3 py-3" style={{ background: 'var(--bg)', border: '1px solid var(--border)' }}>
                                    <input
                                        type="checkbox"
                                        className="checkbox-v2"
                                        checked={Boolean(values[field.name])}
                                        disabled={field.disabled}
                                        onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.checked }))}
                                    />
                                    <span className="text-sm text-muted-fg">{field.label}</span>
                                </div>
                            ) : (
                                <input
                                    type={field.type === 'datetime' ? 'datetime-local' : field.type}
                                    value={String(values[field.name] ?? '')}
                                    required={field.required}
                                    placeholder={field.placeholder}
                                    disabled={field.disabled}
                                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                                    className="input"
                                />
                            )}
                        </label>
                    ))}

                    <div className="flex items-center justify-end gap-3 pt-2">
                        <button type="button" onClick={onCancel} className="px-4 py-2.5 rounded-xl text-muted-fg" style={{ border: '1px solid var(--border)' }}>
                            Cancel
                        </button>
                        <button type="submit" disabled={loading} className="btn btn-primary px-4 py-2.5 disabled:opacity-60">
                            {loading ? 'Loading…' : submitLabel}
                        </button>
                    </div>
                </form>
            </div>
        </dialog>
    );
}

/**
 * Internal helper — renders a textarea (mention-aware or plain) with draft
 * autosave wired in. Split out so the `useDraft` hook stays at a stable
 * position when the field's `draftKey` is set; calling the hook conditionally
 * at the parent would violate the rules of hooks.
 */
function DraftableTextareaField({
    field,
    value,
    onChange,
    draftKey,
}: {
    field: Extract<GroupFormField, { type: 'textarea' }>;
    value: string;
    onChange: (next: string) => void;
    draftKey: string;
}) {
    const draft = useDraft({
        key: draftKey,
        value,
        onRestore: onChange,
    });

    return (
        <>
            {draft.hasDraft ? (
                <DraftRestoredHint
                    visible={draft.hasDraft}
                    onDismiss={() => draft.clearDraft()}
                />
            ) : null}
            {field.mentionScope ? (
                <MentionableTextareaField
                    value={value}
                    onChange={onChange}
                    required={field.required}
                    rows={field.rows ?? 5}
                    placeholder={field.placeholder}
                    disabled={field.disabled}
                    scope={field.mentionScope}
                />
            ) : (
                <textarea
                    value={value}
                    required={field.required}
                    rows={field.rows ?? 5}
                    placeholder={field.placeholder}
                    disabled={field.disabled}
                    onChange={(event) => onChange(event.target.value)}
                    className="input resize-y"
                />
            )}
        </>
    );
}
