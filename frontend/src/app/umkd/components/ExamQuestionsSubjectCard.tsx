'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from 'lucide-react';
import type { UmkdExamQuestionsForSubject } from '@/lib/types';
import { useLanguage, formatMessage } from '@/lib/language-context';
import { categorizeUmkdCourse, UMKD_CATEGORY_LABEL } from '../lib/categorize';
import { UMKD_CATEGORY_ICONS } from '../icons';
import { useExamProgress } from '../lib/exam-progress';

interface ExamQuestionsSubjectCardProps {
    subject: UmkdExamQuestionsForSubject;
}

/**
 * Returns the language-aware "файлов" / "файл" / "файла" plural form for the
 * `umkd.examQuestions.subjectFileCount{One,Few,Many}` templates.
 */
function pluralizeFiles(
    count: number,
    forms: { one: string; few: string; many: string }
): string {
    const abs = Math.abs(count);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return forms.one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms.few;
    return forms.many;
}

export function ExamQuestionsSubjectCard({ subject }: ExamQuestionsSubjectCardProps) {
    const router = useRouter();
    const { messages, language } = useLanguage();
    const t = messages.umkd.examQuestions;

    const categoryKey = categorizeUmkdCourse(subject.subjectName);
    const Icon = UMKD_CATEGORY_ICONS[categoryKey];
    const categoryLabel = UMKD_CATEGORY_LABEL[categoryKey][language];

    // Progress reflects every file shown on the subject detail page, not just
    // the strong-confidence ones, so the count stays consistent with what the
    // user actually sees and can tick.
    const fileIds = useMemo(
        () =>
            subject.files
                .map((file) => file.id)
                .filter((id): id is string => Boolean(id)),
        [subject.files]
    );
    const { summary } = useExamProgress(fileIds);

    const fileCount = subject.fileCount;
    const fileCountText = formatMessage(
        pluralizeFiles(fileCount, {
            one: t.subjectFileCountOne,
            few: t.subjectFileCountFew,
            many: t.subjectFileCountMany,
        }),
        { count: fileCount }
    );

    const progressText = formatMessage(t.subjectProgress, {
        done: summary.done,
        total: summary.total,
    });
    const progressPercent = summary.total > 0
        ? Math.round((summary.done / summary.total) * 100)
        : 0;

    const targetId = subject.subjectId || subject.subjectName;
    const handleOpen = () => {
        router.push(`/umkd/exam-questions/${encodeURIComponent(targetId)}`);
    };

    return (
        <button
            type="button"
            onClick={handleOpen}
            className="card text-left w-full p-4 flex items-center gap-3 transition-transform hover:scale-[1.01] focus:outline-none focus-visible:ring-2"
            style={{ cursor: 'pointer' }}
            aria-label={`${subject.subjectName} — ${categoryLabel}`}
        >
            <div
                className="flex items-center justify-center w-12 h-12 rounded-xl flex-shrink-0"
                style={{
                    background: 'rgba(var(--primary-rgb), 0.12)',
                    color: 'var(--primary)',
                }}
                aria-hidden
                title={categoryLabel}
            >
                <Icon className="w-7 h-7" />
            </div>

            <div className="flex-1 min-w-0 flex flex-col gap-1.5">
                <div className="flex flex-col gap-0.5">
                    <h3
                        className="text-sm font-semibold leading-tight"
                        style={{
                            color: 'var(--text)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            wordBreak: 'break-word',
                        }}
                    >
                        {subject.subjectName}
                    </h3>
                    <div className="flex items-center gap-1.5 flex-wrap text-xs" style={{ color: 'var(--muted)' }}>
                        {subject.subjectCode ? <span>{subject.subjectCode}</span> : null}
                        {subject.subjectCode ? <span aria-hidden>·</span> : null}
                        <span>{fileCountText}</span>
                    </div>
                </div>

                {summary.total > 0 ? (
                    <div className="flex items-center gap-2">
                        <div
                            className="relative h-1.5 flex-1 rounded-full overflow-hidden"
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
                        <span className="text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                            {summary.done} / {summary.total}
                        </span>
                    </div>
                ) : null}
            </div>

            <div className="flex items-center gap-1 flex-shrink-0" style={{ color: 'var(--muted)' }}>
                <span className="text-xs font-semibold hidden sm:inline">{t.subjectOpen}</span>
                <ChevronRight className="w-4 h-4" strokeWidth={2} aria-hidden />
            </div>
        </button>
    );
}
