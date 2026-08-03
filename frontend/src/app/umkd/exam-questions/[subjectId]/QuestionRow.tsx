'use client';

import { useState } from 'react';
import { CheckSquare, Square } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

const TRUNCATE_THRESHOLD = 280;

interface QuestionRowProps {
    fileId: string;
    index: number;
    text: string;
    section?: string;
    reviewed: boolean;
    onToggle: () => void;
}

/**
 * Single parsed question rendered inside `<QuestionList />`.
 *
 * Layout (mobile-first):
 *   [checkbox] [#index] [text...]                   (with optional "Раздел" chip)
 *
 * Long text (>280 chars) is collapsed behind a "Показать больше" toggle so the
 * list stays scannable on small screens.
 */
export function QuestionRow({
    fileId,
    index,
    text,
    section,
    reviewed,
    onToggle,
}: QuestionRowProps) {
    const { messages } = useLanguage();
    const t = messages.umkd.examQuestions;

    const [expanded, setExpanded] = useState(false);
    const needsTruncation = text.length > TRUNCATE_THRESHOLD;
    const visibleText = !needsTruncation || expanded
        ? text
        : `${text.slice(0, TRUNCATE_THRESHOLD).trimEnd()}…`;

    const Checkbox = reviewed ? CheckSquare : Square;
    const checkboxLabel = reviewed ? t.unmarkReviewed : t.markReviewed;
    const expandLabel = expanded ? t.parseQuestionCollapse : t.parseQuestionExpand;

    // The unused `fileId` is part of the public prop contract for parity with
    // `ExamQuestionFileRow` and to make it ergonomic for future analytics —
    // reference it on the `data-file-id` attribute so it's not dead.
    return (
        <div
            data-file-id={fileId}
            className="flex items-start gap-3 px-3 py-3"
            style={{
                borderTop: '1px solid var(--border)',
            }}
        >
            <button
                type="button"
                onClick={onToggle}
                aria-label={checkboxLabel}
                aria-pressed={reviewed}
                className="flex-shrink-0 mt-0.5 focus:outline-none focus-visible:ring-2 rounded"
                style={{
                    color: reviewed ? 'var(--primary)' : 'var(--muted)',
                    cursor: 'pointer',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                }}
                title={checkboxLabel}
            >
                <Checkbox className="w-5 h-5" strokeWidth={2} aria-hidden />
            </button>

            <div className="flex-1 min-w-0 flex flex-col gap-1">
                {section ? (
                    <span
                        className="chip text-[10px] font-semibold self-start"
                        style={{
                            padding: '2px 8px',
                            borderRadius: '999px',
                            background: 'var(--surface-overlay-2)',
                            color: 'var(--muted)',
                            border: '1px solid var(--border)',
                        }}
                    >
                        {t.parseSectionLabel} {section}
                    </span>
                ) : null}

                <p
                    className="text-sm leading-snug"
                    style={{
                        color: 'var(--text)',
                        textDecoration: reviewed ? 'line-through' : 'none',
                        textDecorationColor: 'var(--muted)',
                        wordBreak: 'break-word',
                    }}
                >
                    <span
                        className="font-semibold mr-1.5"
                        style={{ color: 'var(--muted)' }}
                        aria-hidden
                    >
                        {index}.
                    </span>
                    {visibleText}
                </p>

                {needsTruncation ? (
                    <button
                        type="button"
                        onClick={() => setExpanded((v) => !v)}
                        className="text-xs font-semibold self-start"
                        style={{
                            background: 'transparent',
                            border: 'none',
                            padding: '4px 0 0',
                            color: 'var(--primary)',
                            cursor: 'pointer',
                        }}
                    >
                        {expandLabel}
                    </button>
                ) : null}
            </div>
        </div>
    );
}
