'use client';

import { useLanguage } from '@/lib/language-context';

export type UmkdViewMode = 'all' | 'exam';

interface ExamModeToggleProps {
    mode: UmkdViewMode;
    onChange: (next: UmkdViewMode) => void;
    /**
     * Number of subjects that have at least one classified exam-question file.
     * Drives the count badge on the "Экз. вопросы" pill.
     */
    examSubjectCount: number;
    /**
     * If true, the exam pill becomes non-clickable and shows a tooltip. The
     * page reaches this state when the backend returns no exam-question
     * subjects in the current semester.
     */
    examDisabled?: boolean;
}

/**
 * Two-pill segmented control on top of /umkd that flips between the legacy
 * tile grid and the new "Экз. вопросы" list.
 *
 * Implemented inline (rather than reusing `SegmentedControl`) so the second
 * pill can host a count badge + disabled-with-tooltip behaviour.
 */
export function ExamModeToggle({
    mode,
    onChange,
    examSubjectCount,
    examDisabled = false,
}: ExamModeToggleProps) {
    const { messages } = useLanguage();
    const t = messages.umkd.examQuestions;

    return (
        <div
            role="radiogroup"
            aria-label={t.tabExamFull}
            className="inline-flex items-center rounded-full p-1"
            style={{
                background: 'var(--surface-overlay-2)',
                border: '1px solid var(--border)',
            }}
        >
            <PillButton
                active={mode === 'all'}
                onClick={() => onChange('all')}
                label={t.tabAll}
            />
            <PillButton
                active={mode === 'exam'}
                onClick={() => onChange('exam')}
                label={t.tabExam}
                badge={examSubjectCount > 0 ? examSubjectCount : undefined}
                disabled={examDisabled}
                disabledTooltip={t.disabledTooltip}
            />
        </div>
    );
}

interface PillButtonProps {
    active: boolean;
    onClick: () => void;
    label: string;
    badge?: number;
    disabled?: boolean;
    disabledTooltip?: string;
}

function PillButton({ active, onClick, label, badge, disabled, disabledTooltip }: PillButtonProps) {
    return (
        <button
            type="button"
            role="radio"
            aria-checked={active}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            onClick={disabled ? undefined : onClick}
            title={disabled ? disabledTooltip : undefined}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-colors disabled:opacity-50"
            style={{
                background: active ? 'var(--primary)' : 'transparent',
                color: active ? 'var(--button-primary-fg, #fff)' : 'var(--text)',
                cursor: disabled ? 'not-allowed' : 'pointer',
                minWidth: 56,
            }}
        >
            <span>{label}</span>
            {typeof badge === 'number' ? (
                <span
                    aria-hidden
                    className="inline-flex items-center justify-center rounded-full text-[10px] font-bold"
                    style={{
                        minWidth: 18,
                        height: 18,
                        padding: '0 5px',
                        background: active ? 'rgba(255,255,255,0.2)' : 'var(--card)',
                        color: active ? 'var(--button-primary-fg, #fff)' : 'var(--text)',
                        border: active ? 'none' : '1px solid var(--border)',
                    }}
                >
                    {badge}
                </span>
            ) : null}
        </button>
    );
}
