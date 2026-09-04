'use client';

import { CheckSquare, Download, ExternalLink, FileText, Square } from 'lucide-react';
import type { UmkdExamQuestionConfidence, UmkdExamQuestionFile } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';
import { API_BASE_URL } from '@/lib/api-base';
import { trackAnalyticsEvent } from '@/lib/analytics';

interface ExamQuestionFileRowProps {
    file: UmkdExamQuestionFile;
    reviewed: boolean;
    onToggleReviewed: () => void;
}

/**
 * Single file row inside the per-subject exam-question detail page.
 *
 * Layout (mobile-first):
 *   [checkbox]  [type chip] Title           [confidence chip]
 *               size · date                 [Open] [Download]
 */
export function ExamQuestionFileRow({ file, reviewed, onToggleReviewed }: ExamQuestionFileRowProps) {
    const { messages } = useLanguage();
    const t = messages.umkd.examQuestions;

    const Checkbox = reviewed ? CheckSquare : Square;
    const checkboxLabel = reviewed ? t.unmarkReviewed : t.markReviewed;

    // Backend may pre-sign URLs as absolute or as `/api/v3/...` paths. We
    // prepend `API_BASE_URL` only for relative ones so we don't double-prefix
    // an external link (e.g. a legacy external file host).
    const resolveUrl = (raw?: string): string => {
        if (!raw) return '';
        if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
        return `${API_BASE_URL}${raw}`;
    };

    const openHref = resolveUrl(file.openUrl || file.downloadUrl);
    const downloadHref = file.downloadUrl
        ? `${resolveUrl(file.downloadUrl)}${file.downloadUrl.includes('?') ? '&' : '?'}download=1`
        : '';

    return (
        <div
            className="flex items-start gap-3 p-3 rounded-xl"
            style={{
                border: '1px solid var(--border)',
                background: 'var(--card)',
            }}
        >
            <button
                type="button"
                onClick={onToggleReviewed}
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

            <FileTypeBadge file={file} />

            <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                        <p
                            className="text-sm font-semibold leading-tight"
                            style={{
                                color: 'var(--text)',
                                textDecoration: reviewed ? 'line-through' : 'none',
                                textDecorationColor: 'var(--muted)',
                                wordBreak: 'break-word',
                            }}
                        >
                            {file.title}
                        </p>
                        <div
                            className="flex items-center gap-1.5 flex-wrap text-xs mt-0.5"
                            style={{ color: 'var(--muted)' }}
                        >
                            {file.size ? <span>{file.size}</span> : null}
                            {file.size && file.updatedAt ? <span aria-hidden>·</span> : null}
                            {file.updatedAt ? <span>{file.updatedAt}</span> : null}
                        </div>
                    </div>
                    <ConfidenceChip confidence={file.confidence} />
                </div>

                <div className="flex items-center gap-2 flex-wrap mt-1">
                    {openHref ? (
                        <a
                            href={openHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => {
                                trackAnalyticsEvent('cta_click', {
                                    feature: 'umkd_exam_open',
                                    label: file.title,
                                    status: 'attempt',
                                    path: '/umkd/exam-questions',
                                });
                            }}
                            className="btn inline-flex items-center gap-1.5 text-xs font-semibold"
                            style={{
                                padding: '6px 10px',
                                borderRadius: '10px',
                                border: '1px solid var(--border)',
                                background: 'var(--surface-overlay-2)',
                                color: 'var(--text)',
                            }}
                        >
                            <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                            <span>{t.fileOpen}</span>
                        </a>
                    ) : null}

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
                            className="btn btn-primary inline-flex items-center gap-1.5 text-xs font-semibold"
                            style={{
                                padding: '6px 10px',
                                borderRadius: '10px',
                            }}
                        >
                            <Download className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                            <span>{t.fileDownload}</span>
                        </a>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function FileTypeBadge({ file }: { file: UmkdExamQuestionFile }) {
    const ext = (file.extension || file.filename || '').toLowerCase();
    const label = ext.includes('pdf') ? 'PDF'
        : ext.includes('doc') ? 'DOC'
        : ext.includes('xls') ? 'XLS'
        : ext.includes('ppt') ? 'PPT'
        : ext.includes('zip') || ext.includes('rar') ? 'ZIP'
        : '';

    return (
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
            {label ? (
                <span className="text-[10px] font-bold tracking-wide">{label}</span>
            ) : (
                <FileText className="w-4 h-4" strokeWidth={2} />
            )}
        </div>
    );
}

interface ConfidenceChipProps {
    confidence: UmkdExamQuestionConfidence;
}

function ConfidenceChip({ confidence }: ConfidenceChipProps) {
    const { messages } = useLanguage();
    const t = messages.umkd.examQuestions;

    if (confidence === 'strong') {
        return (
            <span
                className="chip text-[10px] font-bold uppercase tracking-wide flex-shrink-0"
                style={{
                    padding: '3px 8px',
                    borderRadius: '999px',
                    background: 'var(--primary)',
                    color: 'var(--button-primary-fg, #fff)',
                }}
            >
                {t.confidenceStrong}
            </span>
        );
    }
    if (confidence === 'medium') {
        return (
            <span
                className="chip text-[10px] font-bold uppercase tracking-wide flex-shrink-0"
                style={{
                    padding: '3px 8px',
                    borderRadius: '999px',
                    background: 'transparent',
                    color: 'var(--primary)',
                    border: '1px solid var(--primary)',
                }}
            >
                {t.confidenceMedium}
            </span>
        );
    }
    // weak — muted neutral. Weak rows are hidden by default at the page level;
    // when explicitly revealed they still get a low-contrast chip.
    return (
        <span
            className="chip text-[10px] font-bold uppercase tracking-wide flex-shrink-0"
            style={{
                padding: '3px 8px',
                borderRadius: '999px',
                background: 'var(--surface-overlay-2)',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
            }}
        >
            {t.confidenceWeak}
        </span>
    );
}
