'use client';

import { useCallback, useMemo, useState } from 'react';
import { createSocialEntity } from '@/lib/api/social';
import { useLanguage } from '@/lib/language-context';
import { buildDraftKey, useDraft } from '@/lib/use-draft';
import DraftRestoredHint from '@/components/DraftRestoredHint';
import { getPollsUi } from './polls-i18n';

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 8;

/**
 * Generate a short stable id for an option row. The backend stores
 * `payload.options[].id` as an opaque string; we just need uniqueness within
 * the poll. `Math.random()` + a timestamp suffix keeps the generator
 * dependency-free (no uuid library on the frontend bundle).
 */
function makeOptionId(): string {
    return `opt-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/**
 * `CreatePollModal` — modal form for composing a `kind='poll'` social entity
 * into a group scope. Validates locally (min 2 / max 8 options, non-empty
 * question) before round-tripping to the universal store endpoint.
 *
 * The modal owns its own option-list state so the parent only sees the final
 * `(question, options[])` tuple via `onCreated`. No legacy fallback path —
 * polls are only available on the social-store side.
 */
export default function CreatePollModal({
    open,
    groupKey,
    onCancel,
    onCreated,
}: {
    open: boolean;
    groupKey: string;
    onCancel: () => void;
    /**
     * Fires after a successful create. The parent feed component is expected
     * to call its `refresh()` so the new poll appears.
     */
    onCreated: () => void;
}) {
    const { language } = useLanguage();
    const ui = useMemo(() => getPollsUi(language), [language]);

    const [question, setQuestion] = useState('');
    // Two starter rows so the user never sees an unusable single-option form.
    const [options, setOptions] = useState<Array<{ id: string; label: string }>>(
        () => [
            { id: makeOptionId(), label: '' },
            { id: makeOptionId(), label: '' },
        ],
    );
    // Multi-choice toggle. Default off — existing single-choice behavior. The
    // value is forwarded as `payload.multiChoice` so the backend stores it
    // verbatim inside the poll's jsonb payload.
    const [multiChoice, setMultiChoice] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    // Draft autosave — only the question text (per spec; options are
    // intentionally not persisted because they carry per-row ids that would
    // re-generate on remount). The key folds in the group scope so two
    // groups maintain independent drafts. The hook stays inert while the
    // modal is closed because `open === false` short-circuits below; we
    // still wire it so a reopen restores any saved question.
    const pollDraftKey = open ? buildDraftKey('poll-question', groupKey) : '';
    const pollDraft = useDraft({
        key: pollDraftKey,
        value: question,
        onRestore: setQuestion,
    });

    const reset = useCallback(() => {
        setQuestion('');
        setOptions([
            { id: makeOptionId(), label: '' },
            { id: makeOptionId(), label: '' },
        ]);
        setMultiChoice(false);
        setSubmitting(false);
        setError('');
    }, []);

    const handleAddOption = useCallback(() => {
        setOptions((prev) => {
            if (prev.length >= MAX_OPTIONS) {
                setError(ui.maxOptions);
                return prev;
            }
            setError('');
            return [...prev, { id: makeOptionId(), label: '' }];
        });
    }, [ui.maxOptions]);

    const handleRemoveOption = useCallback((id: string) => {
        setOptions((prev) => {
            if (prev.length <= MIN_OPTIONS) {
                setError(ui.minOptions);
                return prev;
            }
            setError('');
            return prev.filter((opt) => opt.id !== id);
        });
    }, [ui.minOptions]);

    const handleLabelChange = useCallback((id: string, label: string) => {
        setOptions((prev) => prev.map((opt) => (opt.id === id ? { ...opt, label } : opt)));
    }, []);

    const handleCancel = useCallback(() => {
        // Drop the persisted draft alongside the in-memory reset so a
        // discarded poll does not resurrect itself on the next open. Spec:
        // "clear на close/submit".
        pollDraft.clearDraft();
        reset();
        onCancel();
    }, [onCancel, reset, pollDraft]);

    const handleSubmit = useCallback(async () => {
        const trimmedQuestion = question.trim();
        if (!trimmedQuestion) {
            setError(ui.questionLabel);
            return;
        }
        const cleanOptions = options
            .map((opt) => ({ id: opt.id, label: opt.label.trim() }))
            .filter((opt) => opt.label.length > 0);
        if (cleanOptions.length < MIN_OPTIONS) {
            setError(ui.minOptions);
            return;
        }
        if (cleanOptions.length > MAX_OPTIONS) {
            setError(ui.maxOptions);
            return;
        }
        setSubmitting(true);
        setError('');
        const result = await createSocialEntity({
            kind: 'poll',
            scopeType: 'group',
            scopeId: `group:${groupKey}`,
            payload: {
                question: trimmedQuestion,
                options: cleanOptions,
                votes: {},
                // Only set the flag when ON — the backend treats `undefined`
                // and `false` identically (single-choice default) and we
                // prefer to keep the payload jsonb minimal.
                ...(multiChoice ? { multiChoice: true } : {}),
            },
        });
        setSubmitting(false);
        if (!result.success) {
            setError(result.error || ui.voteFailed);
            return;
        }
        // Clear persisted draft on successful submit — see handleCancel for
        // the discard mirror.
        pollDraft.clearDraft();
        reset();
        onCreated();
    }, [groupKey, multiChoice, onCreated, options, question, reset, ui.maxOptions, ui.minOptions, ui.questionLabel, ui.voteFailed, pollDraft]);

    if (!open) return null;

    return (
        <div
            // Modal shell mirrors `GroupFormModal` so spacing / overlay match
            // the rest of the group surfaces without pulling in a new shared
            // component on the beta branch.
            role="dialog"
            aria-modal="true"
            aria-label={ui.createPollTitle}
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16,
                zIndex: 50,
            }}
        >
            <div
                className="card p-5 space-y-4"
                style={{ width: '100%', maxWidth: 520, maxHeight: '85vh', overflowY: 'auto' }}
            >
                <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-fg">{ui.createPollTitle}</h3>
                </div>

                <label className="block space-y-1">
                    <span className="text-sm text-muted-fg">{ui.questionLabel}</span>
                    {pollDraft.hasDraft ? (
                        <DraftRestoredHint
                            visible={pollDraft.hasDraft}
                            onDismiss={() => pollDraft.clearDraft()}
                        />
                    ) : null}
                    <textarea
                        value={question}
                        onChange={(e) => setQuestion(e.target.value)}
                        placeholder={ui.questionPlaceholder}
                        className="form-input"
                        rows={2}
                        style={{ width: '100%', resize: 'vertical' }}
                    />
                </label>

                <div className="space-y-2">
                    <span className="text-sm text-muted-fg">{ui.optionsLabel}</span>
                    {options.map((opt, idx) => (
                        <div key={opt.id} className="flex items-center gap-2">
                            <input
                                type="text"
                                value={opt.label}
                                onChange={(e) => handleLabelChange(opt.id, e.target.value)}
                                placeholder={ui.optionPlaceholder(idx)}
                                className="form-input"
                                style={{ flex: 1 }}
                            />
                            {options.length > MIN_OPTIONS ? (
                                <button
                                    type="button"
                                    onClick={() => handleRemoveOption(opt.id)}
                                    className="chip"
                                    data-tone="danger"
                                    aria-label={ui.removeOption}
                                >
                                    {ui.removeOption}
                                </button>
                            ) : null}
                        </div>
                    ))}
                    {options.length < MAX_OPTIONS ? (
                        <button
                            type="button"
                            onClick={handleAddOption}
                            className="chip"
                        >
                            + {ui.addOption}
                        </button>
                    ) : null}
                </div>

                <label className="flex items-start gap-2 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={multiChoice}
                        onChange={(e) => setMultiChoice(e.target.checked)}
                        className="mt-1"
                    />
                    <span className="text-sm">
                        <span className="text-fg font-medium">{ui.multiChoiceToggle}</span>
                        <span className="block text-xs text-muted-fg">{ui.multiChoiceHint}</span>
                    </span>
                </label>

                {error ? <p className="text-sm text-danger-fg">{error}</p> : null}

                <div className="flex items-center justify-end gap-2">
                    <button type="button" onClick={handleCancel} className="btn btn-secondary px-4 py-2 text-sm">
                        {ui.cancel}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleSubmit()}
                        disabled={submitting}
                        className="btn btn-primary px-4 py-2 text-sm"
                    >
                        {ui.submit}
                    </button>
                </div>
            </div>
        </div>
    );
}
