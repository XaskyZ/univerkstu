'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, GraduationCap, X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import {
    type DetailedPlatonusGrade,
    getPlatonusDetailedSubject,
    type PlatonusSubjectGrade,
} from '@/lib/api';
import {
    getGradeTone,
    getSubjectStatusKey,
    getSubjectStatusTone,
} from '../utils/grades-helpers';
import {
    getExamDisplayValue,
    getTotalDisplayValue,
    isExamlessSubject,
} from '../utils/goal-assistant';
import type { SubjectStatusKey } from '../types';
import {
    extractAcademicCodeParts,
    getReadableDetailedGradeTitle,
    humanizeAcademicSuffix,
    translateJournalEntryType,
} from '../utils/grade-titles';
import { GradeScoreRing } from './GradeScoreRing';
import { ScoreItem } from './ScoreItem';
import { SubjectGoalAssistant } from './SubjectGoalAssistant';

function statusLabel(
    status: SubjectStatusKey,
    messages: ReturnType<typeof useLanguage>['messages']
): string {
    const labels = messages.grades.statusLabel;
    if (status === 'final') return labels.final;
    if (status === 'awaiting-exam') return labels.awaitingExam;
    if (status === 'awaiting-final') return labels.awaitingFinal;
    if (status === 'blocked') return labels.blocked;
    return labels.noData;
}

const LOCALE_BY_LANGUAGE: Record<'ru' | 'kz' | 'en', string> = {
    ru: 'ru-RU',
    kz: 'kk-KZ',
    en: 'en-US',
};

/**
 * Parse a Platonus `DD-MM-YYYY` (or fallback `DD-MM-XXXX`) date string into
 * `{ day, month, year, valid }`. We tolerate unknown years (`XXXX`) — they get
 * grouped under "unknown" at the bottom.
 */
function parsePlatonusDate(raw: string): { day: number; month: number; year: number | null; valid: boolean } {
    const parts = (raw || '').split('-');
    if (parts.length !== 3) return { day: 0, month: 0, year: null, valid: false };
    const day = Number.parseInt(parts[0], 10);
    const month = Number.parseInt(parts[1], 10);
    const year = Number.parseInt(parts[2], 10);
    if (!Number.isFinite(day) || !Number.isFinite(month) || month < 1 || month > 12 || day < 1 || day > 31) {
        return { day: 0, month: 0, year: null, valid: false };
    }
    return {
        day,
        month,
        year: Number.isFinite(year) ? year : null,
        valid: true,
    };
}

interface JournalMonthGroup {
    key: string;
    label: string;
    items: Array<{
        item: DetailedPlatonusGrade;
        day: number;
        monthShort: string;
        originalIndex: number;
    }>;
}

function groupByMonth(
    details: DetailedPlatonusGrade[],
    language: 'ru' | 'kz' | 'en',
    fallbackMonthLabel: string,
): JournalMonthGroup[] {
    const locale = LOCALE_BY_LANGUAGE[language] ?? 'ru-RU';
    const monthFormatter = new Intl.DateTimeFormat(locale, { month: 'long' });
    const monthShortFormatter = new Intl.DateTimeFormat(locale, { month: 'short' });
    const yearFormatter = new Intl.DateTimeFormat(locale, { year: 'numeric' });

    const groups = new Map<string, JournalMonthGroup>();
    const orderedKeys: string[] = [];

    details.forEach((item, originalIndex) => {
        const parsed = parsePlatonusDate(item.date);
        let key: string;
        let label: string;
        let monthShort: string;

        if (parsed.valid && parsed.year !== null) {
            // Use day 1 to avoid edge cases with timezones / 31st-day months.
            const date = new Date(parsed.year, parsed.month - 1, 1);
            key = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;
            const monthName = monthFormatter.format(date);
            // Capitalise first letter — Intl returns lowercase for ru/kz.
            const monthDisplay = monthName.charAt(0).toUpperCase() + monthName.slice(1);
            label = `${monthDisplay} ${yearFormatter.format(date)}`;
            monthShort = monthShortFormatter.format(date).replace('.', '');
        } else if (parsed.valid) {
            // Year unknown — group per month, but no year suffix.
            const date = new Date(2000, parsed.month - 1, 1);
            key = `unknown-${String(parsed.month).padStart(2, '0')}`;
            const monthName = monthFormatter.format(date);
            label = monthName.charAt(0).toUpperCase() + monthName.slice(1);
            monthShort = monthShortFormatter.format(date).replace('.', '');
        } else {
            key = '__unknown__';
            label = item.month?.trim() || fallbackMonthLabel;
            monthShort = '';
        }

        let group = groups.get(key);
        if (!group) {
            group = { key, label, items: [] };
            groups.set(key, group);
            orderedKeys.push(key);
        }
        group.items.push({
            item,
            day: parsed.valid ? parsed.day : 0,
            monthShort,
            originalIndex,
        });
    });

    // `details` is already pre-sorted newest-first by the backend parser,
    // so preserving insertion order here keeps month groups in that order too.
    return orderedKeys.map((key) => groups.get(key)!).filter(Boolean);
}

export function GradesSubjectDetail({
    subject,
    year,
    semester,
    detailsEnabled,
    onClose,
    onPlatonusDisconnected,
    language,
}: {
    subject: PlatonusSubjectGrade;
    year: number;
    semester: number;
    detailsEnabled: boolean;
    onClose: () => void;
    onPlatonusDisconnected: () => void;
    language: 'ru' | 'kz' | 'en';
}) {
    const { messages } = useLanguage();
    const [details, setDetails] = useState<DetailedPlatonusGrade[] | null>(null);
    const [loading, setLoading] = useState(false);

    const displayTotal = useMemo(() => getTotalDisplayValue(subject), [subject]);
    const displayExam = useMemo(() => getExamDisplayValue(subject), [subject]);
    const examless = useMemo(() => isExamlessSubject(subject), [subject]);
    const statusKey = useMemo(() => getSubjectStatusKey(subject), [subject]);
    const statusTone = useMemo(() => getSubjectStatusTone(statusKey), [statusKey]);
    const codeParts = useMemo(() => extractAcademicCodeParts(subject.code), [subject.code]);
    const codeSuffixLabel = useMemo(
        () => humanizeAcademicSuffix(codeParts.suffix, language),
        [codeParts.suffix, language]
    );

    const canLoadJournal = detailsEnabled && Boolean(subject.subjectID && subject.queryID);

    useEffect(() => {
        if (!canLoadJournal) {
            setDetails(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setDetails(null);
        (async () => {
            try {
                const res = await getPlatonusDetailedSubject(
                    year,
                    semester,
                    subject.subjectID!,
                    subject.queryID!,
                );
                if (cancelled) return;
                if (res.success && res.data) {
                    setDetails(res.data);
                } else if (
                    res.errorCode === 'PLATONUS_NOT_CONNECTED'
                    || res.statusCode === 401
                    || res.statusCode === 403
                ) {
                    onPlatonusDisconnected();
                } else {
                    setDetails([]);
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('Failed to load grade details', error);
                    setDetails([]);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [canLoadJournal, year, semester, subject.subjectID, subject.queryID, onPlatonusDisconnected]);

    useEffect(() => {
        function handleKey(event: KeyboardEvent) {
            if (event.key === 'Escape') onClose();
        }
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [onClose]);

    const tutors = (subject.tutors ?? []).filter((name) => name && name.trim().length > 0);

    const monthGroups = useMemo(() => {
        if (!details || details.length === 0) return [];
        return groupByMonth(details, language, messages.grades.journalTitle);
    }, [details, language, messages.grades.journalTitle]);

    return (
        <section className="grades-detail" aria-label={subject.name}>
            <header className="grades-detail-header">
                <button
                    type="button"
                    className="grades-detail-back"
                    onClick={onClose}
                    aria-label={messages.grades.detailClose}
                >
                    <ArrowLeft size={18} strokeWidth={2} aria-hidden className="grades-detail-back-mobile" />
                    <X size={18} strokeWidth={2} aria-hidden className="grades-detail-back-desktop" />
                </button>
                <div className="grades-detail-heading">
                    <h2 className="grades-detail-title">{subject.name}</h2>
                    {subject.code ? (
                        <p className="grades-detail-code">
                            {codeParts.base || subject.code}
                            {codeSuffixLabel ? (
                                <span style={{ color: 'var(--muted)' }}> · {codeSuffixLabel}</span>
                            ) : null}
                        </p>
                    ) : null}
                </div>
            </header>

            <div className="grades-detail-body">
                <div className="grades-detail-summary">
                    <GradeScoreRing value={displayTotal} size={88} strokeWidth={7} />
                    <div className="grades-detail-summary-text">
                        <span
                            className="grades-detail-status"
                            style={{
                                ['--tone-border' as string]: statusTone.border,
                                ['--tone-bg' as string]: statusTone.bg,
                                ['--tone-color' as string]: statusTone.color,
                            }}
                        >
                            {statusLabel(statusKey, messages)}
                        </span>
                        {tutors.length > 0 ? (
                            <div className="grades-detail-tutors">
                                <GraduationCap size={14} strokeWidth={2} aria-hidden />
                                <span>{tutors.join(', ')}</span>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="score-grid">
                    <ScoreItem
                        label={messages.grades.scoreRk1}
                        value={subject.rk1 || '-'}
                        title={messages.grades.scoreRk1Title}
                        ariaLabel={`${messages.grades.scoreRk1Title}: ${subject.rk1 || '-'}`}
                    />
                    <ScoreItem
                        label={messages.grades.scoreRk2}
                        value={subject.rk2 || '-'}
                        title={messages.grades.scoreRk2Title}
                        ariaLabel={`${messages.grades.scoreRk2Title}: ${subject.rk2 || '-'}`}
                    />
                    <ScoreItem
                        label={messages.grades.scoreRating}
                        value={subject.rating || '-'}
                    />
                    {examless ? null : (
                        <ScoreItem
                            label={messages.grades.scoreExamShort}
                            value={displayExam}
                            title={displayExam === '?' ? messages.grades.examPendingHint : undefined}
                            ariaLabel={displayExam === '?'
                                ? `${messages.grades.scoreExamShort}: ${messages.grades.examPendingHint}`
                                : undefined}
                        />
                    )}
                </div>
                {displayExam === '?' ? (
                    <p className="text-xs" style={{ color: 'var(--muted)', margin: 0 }}>
                        {messages.grades.examPendingHint}
                    </p>
                ) : null}

                <SubjectGoalAssistant subject={subject} language={language} />
            </div>

            <section className="grades-detail-journal" aria-label={messages.grades.journalTitle}>
                <header className="grades-detail-journal-header">
                    <BookOpen size={16} strokeWidth={2} aria-hidden />
                    <h3 className="grades-detail-journal-title">{messages.grades.journalTitle}</h3>
                </header>
                <div className="grades-detail-journal-body">
                    {!canLoadJournal ? (
                        <p className="journal-empty">{messages.grades.journalEmpty}</p>
                    ) : loading ? (
                        <p className="journal-empty">{messages.grades.loadingShort}</p>
                    ) : monthGroups.length > 0 ? (
                        monthGroups.map((group) => (
                            <div key={group.key} className="grades-journal-month">
                                <h4 className="grades-journal-month-title">{group.label}</h4>
                                <div className="grades-journal-month-rows">
                                    {group.items.map(({ item, day, monthShort, originalIndex }) => {
                                        const markText = item.mark.toFixed(2);
                                        const tone = getGradeTone(markText);
                                        const readableTitle = getReadableDetailedGradeTitle(item, subject, language);
                                        const teacherLabel = item.teacher?.trim()
                                            || (subject.tutors?.length === 1 ? subject.tutors[0]?.trim() : null)
                                            || null;
                                        const entryTypeLabel = translateJournalEntryType(item.type, language);
                                        const metaParts = [entryTypeLabel, teacherLabel].filter(Boolean);

                                        return (
                                            <div key={`${item.date}-${originalIndex}`} className="grades-journal-row">
                                                <div className="grades-journal-row-date" aria-hidden>
                                                    <span className="grades-journal-row-day">
                                                        {day > 0 ? String(day).padStart(2, '0') : '—'}
                                                    </span>
                                                    {monthShort ? (
                                                        <span className="grades-journal-row-month">{monthShort}</span>
                                                    ) : null}
                                                </div>
                                                <div className="grades-journal-row-body">
                                                    <div className="grades-journal-row-title">
                                                        {readableTitle || messages.grades.journalItemFallback}
                                                    </div>
                                                    {metaParts.length > 0 ? (
                                                        <div className="grades-journal-row-meta">
                                                            {metaParts.join(' • ')}
                                                        </div>
                                                    ) : null}
                                                    {item.comment ? (
                                                        <div className="grades-journal-row-comment">{item.comment}</div>
                                                    ) : null}
                                                </div>
                                                <span
                                                    className="grades-journal-row-mark"
                                                    style={{
                                                        ['--tone-border' as string]: tone.border,
                                                        ['--tone-bg' as string]: tone.bg,
                                                        ['--tone-color' as string]: tone.color,
                                                    }}
                                                >
                                                    {markText}
                                                </span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    ) : (
                        <p className="journal-empty">{messages.grades.journalEmpty}</p>
                    )}
                </div>
            </section>
        </section>
    );
}
