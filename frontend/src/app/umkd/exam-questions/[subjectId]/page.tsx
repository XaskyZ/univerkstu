'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage, formatMessage } from '@/lib/language-context';
import type { UMKD, UmkdExamQuestionFile, UmkdExamQuestionsForSubject } from '@/lib/types';
import { SubScreenHeader } from '@/components/SubScreenHeader';
import { ExamQuestionFileRow } from '../../components/ExamQuestionFileRow';
import { useExamProgress } from '../../lib/exam-progress';
import { useParsedExamQuestions } from '@/lib/hooks/use-parsed-exam-questions';
import { QuestionList } from './QuestionList';

const UMKD_CACHE_KEY = 'umkd_cache_v2';
const MIN_QUESTIONS_FOR_LIST = 2;

/**
 * Detail page for one subject's exam-question files.
 *
 * Mirrors the data-loading strategy of `/umkd/[courseId]`: reads the cached
 * `UMKD` blob written by the index page. If the user lands here cold (direct
 * URL paste, no cache), we show a "back to UMKD" empty state — the index will
 * then refresh and warm the cache.
 */
export default function ExamQuestionsSubjectDetailPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const params = useParams<{ subjectId: string }>();

    const subjectId = useMemo(() => {
        const raw = params?.subjectId;
        if (!raw) return '';
        return Array.isArray(raw) ? raw[0] : raw;
    }, [params]);

    // Read UMKD cache at init, like the sibling course-detail route.
    const [umkd] = useState<UMKD | null>(() => {
        if (typeof window === 'undefined') return null;
        const cached = window.localStorage.getItem(UMKD_CACHE_KEY);
        if (!cached) return null;
        try {
            return JSON.parse(cached) as UMKD;
        } catch {
            return null;
        }
    });

    // Auth guard — same pattern as /settings/password and /umkd.
    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    const subject: UmkdExamQuestionsForSubject | undefined = useMemo(() => {
        if (!umkd || !subjectId) return undefined;
        const buckets = umkd.examQuestionsBySubject ?? [];
        const decoded = decodeURIComponent(subjectId);
        return buckets.find(
            (s) =>
                s.subjectId === decoded
                || s.subjectId === subjectId
                || s.subjectName === decoded
        );
    }, [umkd, subjectId]);

    const allFileIds = useMemo(
        () =>
            (subject?.files ?? [])
                .map((file) => file.id)
                .filter((id): id is string => Boolean(id)),
        [subject?.files]
    );

    const { progress, summary, toggle } = useExamProgress(allFileIds);

    // Weak-confidence files are collapsed under a toggle (default OFF) so we
    // don't push every fuzzy match to the top of the page.
    const [showWeak, setShowWeak] = useState(false);

    const t = messages.umkd.examQuestions;

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div
                    className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
                    style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
                />
            </div>
        );
    }

    if (!isAuth) {
        return null;
    }

    if (!subject) {
        return (
            <div className="animate-fadeIn">
                <SubScreenHeader
                    title={t.tabExamFull}
                    subtitle={messages.umkd.subtitle}
                    backHref="/umkd"
                />
                <main className="px-4 py-4">
                    <div className="card p-6 flex flex-col items-center gap-3 text-center">
                        <p style={{ color: 'var(--text)' }}>{t.emptyTitle}</p>
                        <p className="text-sm" style={{ color: 'var(--muted)' }}>
                            {t.emptyDesc}
                        </p>
                        <button
                            type="button"
                            onClick={() => router.push('/umkd')}
                            className="btn btn-primary"
                        >
                            {messages.umkd.detailBack}
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    const { strongAndMedium, weak } = splitByConfidence(subject.files);
    const progressText = formatMessage(t.subjectProgress, {
        done: summary.done,
        total: summary.total,
    });
    const progressPercent = summary.total > 0
        ? Math.round((summary.done / summary.total) * 100)
        : 0;

    return (
        <div className="animate-fadeIn">
            <SubScreenHeader
                title={subject.subjectName}
                subtitle={t.tabExamFull}
                backHref="/umkd"
            />
            <main className="px-4 py-4 space-y-4">
                {summary.total > 0 ? (
                    <section className="card p-4 space-y-2">
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                {progressText}
                            </span>
                            <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
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
                        <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                            {t.progressDeviceNote}
                        </p>
                    </section>
                ) : null}

                <section className="space-y-2">
                    {strongAndMedium.length === 0 && weak.length === 0 ? (
                        <div className="card p-6 text-center">
                            <p style={{ color: 'var(--text)' }}>{t.emptyTitle}</p>
                            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
                                {t.emptyDesc}
                            </p>
                        </div>
                    ) : (
                        strongAndMedium.map((file, index) => (
                            <CollapsibleFileCard
                                key={file.id || `${file.title}-${index}`}
                                file={file}
                                defaultOpen={index === 0}
                                reviewed={file.id ? Boolean(progress[file.id]) : false}
                                onToggleReviewed={() => {
                                    if (file.id) toggle(file.id);
                                }}
                            />
                        ))
                    )}
                </section>

                {weak.length > 0 ? (
                    <section className="space-y-2">
                        <button
                            type="button"
                            onClick={() => setShowWeak((v) => !v)}
                            aria-expanded={showWeak}
                            className="btn inline-flex items-center gap-1.5 text-xs font-semibold"
                            style={{
                                padding: '8px 14px',
                                borderRadius: '12px',
                                border: '1px solid var(--border)',
                                background: 'var(--card)',
                                color: 'var(--text)',
                                cursor: 'pointer',
                            }}
                        >
                            <span aria-hidden>{showWeak ? '▴' : '▾'}</span>
                            <span>
                                {showWeak
                                    ? t.hideWeak
                                    : formatMessage(t.showWeak, { count: weak.length })}
                            </span>
                        </button>

                        {showWeak ? (
                            <div className="space-y-2">
                                {weak.map((file, index) => (
                                    <ExamQuestionFileRow
                                        key={file.id || `${file.title}-weak-${index}`}
                                        file={file}
                                        reviewed={file.id ? Boolean(progress[file.id]) : false}
                                        onToggleReviewed={() => {
                                            if (file.id) toggle(file.id);
                                        }}
                                    />
                                ))}
                            </div>
                        ) : null}
                    </section>
                ) : null}
            </main>
        </div>
    );
}

interface CollapsibleFileCardProps {
    file: UmkdExamQuestionFile;
    defaultOpen: boolean;
    reviewed: boolean;
    onToggleReviewed: () => void;
}

/**
 * Wraps a single strong/medium file with a collapsible header. When opened
 * and the file has a `fileId`, lazy-fetches the parsed question list via
 * `useParsedExamQuestions` and decides whether to show the inline list or
 * fall back to the legacy `<ExamQuestionFileRow />`.
 */
function CollapsibleFileCard({
    file,
    defaultOpen,
    reviewed,
    onToggleReviewed,
}: CollapsibleFileCardProps) {
    const [open, setOpen] = useState(defaultOpen);

    // Lazy-fetch parsed content only when card is open AND file has a storage id.
    // Use `fileId` (storage ObjectId), NOT `id` (KSTU row id) — the /parsed
    // endpoint resolves files by storage id. No mode toggle — list view is the
    // only view when parse succeeded; file fallback shown only when parse failed.
    const fileId = file.fileId ?? '';
    const shouldFetch = open && Boolean(fileId);
    const { data: parsed } = useParsedExamQuestions(shouldFetch ? fileId : null);

    const hasUsableList = Boolean(
        parsed?.ok && parsed.questions.length >= MIN_QUESTIONS_FOR_LIST,
    );

    const ChevronIcon = open ? ChevronDown : ChevronRight;

    return (
        <div
            className="card"
            style={{
                padding: 0,
                overflow: 'hidden',
                border: '1px solid var(--border)',
            }}
        >
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                className="flex items-center gap-2 w-full text-left"
                style={{
                    padding: '10px 12px',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--text)',
                }}
            >
                <ChevronIcon
                    className="w-4 h-4 flex-shrink-0"
                    strokeWidth={2.25}
                    aria-hidden
                    style={{ color: 'var(--muted)' }}
                />
                <span
                    className="text-sm font-semibold flex-1 min-w-0"
                    style={{
                        color: 'var(--text)',
                        wordBreak: 'break-word',
                    }}
                >
                    {file.title}
                </span>
            </button>

            {open ? (
                <div style={{ borderTop: '1px solid var(--border)' }}>
                    {hasUsableList && parsed ? (
                        <QuestionList
                            file={file}
                            fileId={fileId}
                            questions={parsed.questions}
                        />
                    ) : (
                        <div className="p-3">
                            <ExamQuestionFileRow
                                file={file}
                                reviewed={reviewed}
                                onToggleReviewed={onToggleReviewed}
                            />
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function splitByConfidence(files: UmkdExamQuestionFile[]): {
    strongAndMedium: UmkdExamQuestionFile[];
    weak: UmkdExamQuestionFile[];
} {
    const strongAndMedium: UmkdExamQuestionFile[] = [];
    const weak: UmkdExamQuestionFile[] = [];
    for (const file of files) {
        if (file.confidence === 'weak') {
            weak.push(file);
        } else {
            strongAndMedium.push(file);
        }
    }
    return { strongAndMedium, weak };
}
