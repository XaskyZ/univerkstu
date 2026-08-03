'use client';

import { useMemo, useState } from 'react';
import { Download, FileText, Search } from 'lucide-react';
import type { UmkdExamQuestionFile } from '@/lib/types';
import type { ParsedExamQuestion } from '@/lib/api/umkd-parsed';
import { useLanguage, formatMessage } from '@/lib/language-context';
import { API_BASE_URL } from '@/lib/api-base';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useFileQuestionProgress } from '../../lib/exam-question-progress';
import { QuestionRow } from './QuestionRow';

const SEARCH_VISIBLE_AT = 30;

interface QuestionListProps {
    file: UmkdExamQuestionFile;
    fileId: string;
    questions: ParsedExamQuestion[];
}

/**
 * Renders the parsed inline question list for a single UMKD exam-question file.
 *
 * No mode toggle — list is the only view when parse succeeded. Download button
 * stays accessible in the header so the user can verify against the original
 * if parsing looks wrong.
 */
export function QuestionList({
    file,
    fileId,
    questions,
}: QuestionListProps) {
    const { messages } = useLanguage();
    const t = messages.umkd.examQuestions;

    const { reviewed, summary, toggle } = useFileQuestionProgress(fileId, questions.length);

    const [query, setQuery] = useState('');
    const showSearch = questions.length >= SEARCH_VISIBLE_AT;

    const filteredQuestions = useMemo(() => {
        if (!showSearch) return questions;
        const trimmed = query.trim().toLowerCase();
        if (!trimmed) return questions;
        return questions.filter((q) => q.text.toLowerCase().includes(trimmed));
    }, [questions, showSearch, query]);

    const downloadHref = useMemo(() => {
        if (!file.downloadUrl) return '';
        const base = file.downloadUrl.startsWith('http')
            ? file.downloadUrl
            : `${API_BASE_URL}${file.downloadUrl}`;
        return `${base}${base.includes('?') ? '&' : '?'}download=1`;
    }, [file.downloadUrl]);

    const progressText = formatMessage(t.subjectProgress, {
        done: summary.done,
        total: summary.total,
    });
    const progressPercent = summary.total > 0
        ? Math.round((summary.done / summary.total) * 100)
        : 0;

    return (
        <section
            className="card"
            style={{
                padding: 0,
                overflow: 'hidden',
            }}
        >
            <header
                className="flex flex-col gap-2 p-4"
                style={{ borderBottom: '1px solid var(--border)' }}
            >
                <div className="flex items-start gap-3">
                    <div
                        className="flex items-center justify-center flex-shrink-0 rounded-lg"
                        style={{
                            width: 36,
                            height: 36,
                            background: 'var(--surface-overlay-2)',
                            color: 'var(--primary)',
                        }}
                        aria-hidden
                    >
                        <FileText className="w-4 h-4" strokeWidth={2} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p
                            className="text-sm font-semibold leading-tight"
                            style={{ color: 'var(--text)', wordBreak: 'break-word' }}
                        >
                            {t.parseListTitle}
                        </p>
                        <p
                            className="text-xs mt-0.5"
                            style={{ color: 'var(--muted)', wordBreak: 'break-word' }}
                        >
                            {file.title}
                        </p>
                    </div>
                </div>

                {downloadHref ? (
                    <a
                        href={downloadHref}
                        download=""
                        onClick={() => {
                            trackAnalyticsEvent('cta_click', {
                                feature: 'umkd_exam_download',
                                label: file.title,
                                status: 'attempt',
                                path: '/umkd/exam-questions',
                            });
                        }}
                        className="btn btn-secondary inline-flex items-center gap-1.5 text-xs font-semibold self-start"
                        style={{
                            padding: '6px 12px',
                            borderRadius: '10px',
                        }}
                    >
                        <Download className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                        <span>{file.title ? `${t.fileDownload}` : t.fileDownload}</span>
                    </a>
                ) : null}

                <div className="flex flex-col gap-1.5">
                    <div className="flex items-baseline justify-between gap-3">
                        <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                            {progressText}
                        </span>
                        <span className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                            {progressPercent}%
                        </span>
                    </div>
                    <div
                        className="relative h-2 rounded-full overflow-hidden"
                        style={{ background: 'var(--surface-overlay-2)' }}
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={summary.total}
                        aria-valuenow={summary.done}
                        aria-label={progressText}
                    >
                        <div
                            className="h-full transition-all duration-300 ease-out"
                            style={{
                                width: `${progressPercent}%`,
                                background: 'var(--primary)',
                            }}
                        />
                    </div>
                </div>

                {showSearch ? (
                    <label
                        className="relative flex items-center gap-2"
                        style={{
                            border: '1px solid var(--border)',
                            background: 'var(--surface-overlay-2)',
                            borderRadius: '10px',
                            padding: '6px 10px',
                        }}
                    >
                        <Search
                            className="w-3.5 h-3.5 flex-shrink-0"
                            strokeWidth={2}
                            aria-hidden
                            style={{ color: 'var(--muted)' }}
                        />
                        <input
                            type="search"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={t.parseSearchPlaceholder}
                            className="input flex-1"
                            style={{
                                background: 'transparent',
                                border: 'none',
                                padding: 0,
                                fontSize: '13px',
                                color: 'var(--text)',
                                outline: 'none',
                            }}
                            aria-label={t.parseSearchPlaceholder}
                        />
                    </label>
                ) : null}
            </header>

            <div>
                {filteredQuestions.length === 0 ? (
                    <p
                        className="text-xs text-center py-6"
                        style={{ color: 'var(--muted)' }}
                    >
                        {t.emptyTitle}
                    </p>
                ) : (
                    filteredQuestions.map((q) => (
                        <QuestionRow
                            key={`${fileId}-${q.index}`}
                            fileId={fileId}
                            index={q.index}
                            text={q.text}
                            section={q.section}
                            reviewed={Boolean(reviewed[q.index])}
                            onToggle={() => toggle(q.index)}
                        />
                    ))
                )}
            </div>

        </section>
    );
}
