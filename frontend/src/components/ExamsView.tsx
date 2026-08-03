'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Clock, Copy, FileText, Layers, MapPin, RefreshCw, Search, User, X } from 'lucide-react';
import { Exams, Exam } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { findNextExam } from '@/app/exams/utils/exam-countdown';
import { filterExams } from '@/app/exams/utils/filter-exams';
import { getExamBadgesUi, type ExamBadgesUi } from '@/app/exams/utils/exam-badges-i18n';
import { PageMain, PageShell } from './PageShell';

interface ExamsViewProps {
    exams: Exams;
    onRefresh: () => void;
    refreshing: boolean;
    isStale?: boolean;
    cacheAge?: number | null;
}

const MONTHS = {
    ru: ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    kz: ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
} as const;

/** Exam meta-flags exposed as one-tap filter chips (only when present in the data). */
type ExamFlagKey = 'final' | 'state' | 'online' | 'additional';
const EXAM_FLAG_ORDER: readonly ExamFlagKey[] = ['final', 'state', 'online', 'additional'];

/**
 * Компаратор списка экзаменов: сначала экзамены с датой (по возрастанию даты),
 * затем экзамены без даты. Раньше компаратор возвращал `0`, как только у одной
 * из сторон не было даты — это ломало транзитивность сравнения, и порядок
 * зависел от исходного расположения элементов. Теперь сортировка детерминированная:
 * недатированные всегда в конце и упорядочены по названию предмета.
 */
export function compareExamsForDisplay(a: Exam, b: Exam): number {
    if (a.datetime && b.datetime) {
        const diff = new Date(a.datetime.iso).getTime() - new Date(b.datetime.iso).getTime();
        if (diff !== 0) return diff;
        return a.subject.localeCompare(b.subject);
    }
    if (a.datetime) return -1;
    if (b.datetime) return 1;
    return a.subject.localeCompare(b.subject);
}

/**
 * Room label formatting differs by word order per language: ru/en prefix the
 * room word ("Ауд. 305" / "Room 305"), while kz puts the number first
 * ("305-аудитория"), matching the form already used in LessonCardMobile.
 */
export function formatExamRoom(room: string, language: 'ru' | 'kz' | 'en', roomWord: string): string {
    if (language === 'kz') return `${room}-${roomWord}`;
    return `${roomWord} ${room}`;
}

export function formatMilestoneRange(
    start: string,
    end: string,
    language: 'ru' | 'kz' | 'en'
) {
    const [sd, sm, sy] = start.split('.');
    const [ed, em, ey] = end.split('.');
    const startLabel = `${sd} ${MONTHS[language][Math.max(0, Number(sm) - 1)]}`;
    const endLabel = `${ed} ${MONTHS[language][Math.max(0, Number(em) - 1)]}`;
    return sy === ey ? `${startLabel} - ${endLabel} ${ey}` : `${startLabel} ${sy} - ${endLabel} ${ey}`;
}

function ExamCard({ exam, index, language, ui, badgesUi, onCopy }: {
    exam: Exam;
    index: number;
    language: 'ru' | 'kz' | 'en';
    ui: {
        room: string;
        copyAria: string;
    };
    badgesUi: ExamBadgesUi;
    onCopy: () => void;
}) {
    const examDate = exam.datetime;
    const isPast = examDate ? new Date(examDate.iso) < new Date() : false;
    const flags = exam.flags;

    return (
        <div
            className={`exam-card animate-fadeInUp ${isPast ? 'opacity-60' : ''}`}
            style={{ animationDelay: `${index * 50}ms`, position: 'relative' }}
        >
            <button
                type="button"
                onClick={onCopy}
                aria-label={ui.copyAria}
                title={ui.copyAria}
                className="absolute top-2 right-2 w-9 h-9 rounded-lg flex items-center justify-center"
                style={{ color: 'var(--muted)', background: 'transparent', border: 'none', cursor: 'pointer' }}
            >
                <Copy className="w-4 h-4" strokeWidth={2} aria-hidden />
            </button>
            <div className="flex gap-4">
                {/* Date Badge */}
                {examDate && (
                    <div
                        className="flex-shrink-0 w-16 h-16 rounded-xl flex flex-col items-center justify-center text-white"
                        style={{ background: 'var(--gradient-primary)' }}
                    >
                        <span className="text-2xl font-bold">{examDate.displayDate.split('.')[0]}</span>
                        <span className="text-xs opacity-80">
                            {MONTHS[language][parseInt(examDate.displayDate.split('.')[1]) - 1]}
                        </span>
                    </div>
                )}

                {/* Content */}
                <div className="flex-1 min-w-0">
                    <h4 className="exam-subject">{exam.subject}</h4>

                    <div className="exam-meta">
                        {/* Time */}
                        {examDate && (
                            <span className="exam-meta-item">
                                <Clock className="w-4 h-4" strokeWidth={2} aria-hidden />
                                {examDate.displayTime}
                            </span>
                        )}

                        {/* Format */}
                        {exam.format && (
                            <span className="exam-meta-item">
                                {exam.format}
                            </span>
                        )}

                        {/* Meta flags from Platonus v7 (onlineExam / additional / finalExam / stateExam) —
                            covers everything the raw `exam.type` string used to say (additional/retake,
                            online), already localized, so `exam.type` is intentionally not rendered here. */}
                        {flags?.online && (
                            <span
                                className="exam-meta-item exam-badge-flag exam-badge-flag-info"
                                title={badgesUi.online}
                            >
                                🌐 {badgesUi.online}
                            </span>
                        )}
                        {flags?.additional && (
                            <span
                                className="exam-meta-item exam-badge-flag exam-badge-flag-warning"
                                title={badgesUi.additional}
                            >
                                ➕ {badgesUi.additional}
                            </span>
                        )}
                        {flags?.final && (
                            <span
                                className="exam-meta-item exam-badge-flag exam-badge-flag-success"
                                title={badgesUi.final}
                            >
                                🏁 {badgesUi.final}
                            </span>
                        )}
                        {flags?.state && (
                            <span
                                className="exam-meta-item exam-badge-flag exam-badge-flag-danger"
                                title={badgesUi.state}
                            >
                                🎓 {badgesUi.state}
                            </span>
                        )}
                    </div>

                    {/* Teacher */}
                    <div className="lesson-detail mt-2">
                        <User className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                        <span>{exam.teacher}</span>
                    </div>

                    {/* Location */}
                    {(exam.building || exam.room) && (
                        <div className="lesson-detail">
                            <MapPin className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                            <span>
                                {exam.building && `${exam.building}`}
                                {exam.building && exam.room && ', '}
                                {exam.room && formatExamRoom(exam.room, language, ui.room)}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function ExamCountdown({
    exams,
    nowTimestamp,
    language,
    ui,
}: {
    exams: Exam[];
    nowTimestamp: number;
    language: 'ru' | 'kz' | 'en';
    ui: {
        upcomingExam: string;
        daysShort: string;
        hoursShort: string;
        minutesShort: string;
        room: string;
    };
}) {
    const next = findNextExam(exams, nowTimestamp);
    if (!next) return null;

    const { exam, parts, severity } = next;
    const accentClass = severity === 'imminent' ? 'text-danger-fg' : severity === 'soon' ? 'text-warning-fg' : 'text-primary';
    const showMinutes = parts.days === 0;

    return (
        <div className="today-highlight mb-5" data-severity={severity} aria-live="polite">
            <div className="today-title">
                <span className="text-xl" aria-hidden="true">⏰</span>
                <span>{ui.upcomingExam}</span>
            </div>
            <p className="text-lg font-semibold mt-2 text-fg">{exam.subject}</p>
            <div className="flex items-center gap-4 mt-3 flex-wrap">
                {parts.days > 0 && (
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-bold ${accentClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{parts.days}</span>
                        <span className="text-sm text-muted-fg">{ui.daysShort}</span>
                    </div>
                )}
                <div className="flex items-baseline gap-2">
                    <span className={`text-3xl font-bold ${accentClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{parts.hours}</span>
                    <span className="text-sm text-muted-fg">{ui.hoursShort}</span>
                </div>
                {showMinutes && (
                    <div className="flex items-baseline gap-2">
                        <span className={`text-3xl font-bold ${accentClass}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{parts.minutes}</span>
                        <span className="text-sm text-muted-fg">{ui.minutesShort}</span>
                    </div>
                )}
            </div>
            {exam.room && (
                <p className="text-sm text-muted-fg mt-2">
                    {formatExamRoom(exam.room, language, ui.room)}
                </p>
            )}
        </div>
    );
}

export default function ExamsView({ exams, onRefresh, refreshing, isStale, cacheAge }: ExamsViewProps) {
    const { language } = useLanguage();
    const badgesUi = useMemo(() => getExamBadgesUi(language), [language]);
    const cachedAt = new Date(exams.cachedAt);
    const [currentTimestamp, setCurrentTimestamp] = useState(() => cachedAt.getTime());
    const [searchQuery, setSearchQuery] = useState('');
    const [flagFilter, setFlagFilter] = useState<ExamFlagKey | 'all'>('all');
    const availableFlags = useMemo<ExamFlagKey[]>(() => {
        const present = new Set<ExamFlagKey>();
        for (const exam of exams.exams) {
            for (const flag of EXAM_FLAG_ORDER) {
                if (exam.flags?.[flag]) present.add(flag);
            }
        }
        return EXAM_FLAG_ORDER.filter((flag) => present.has(flag));
    }, [exams.exams]);
    const cacheAgeMinutes = Math.max(0, Math.floor((currentTimestamp - cachedAt.getTime()) / 60000));
    const ui = {
        ru: {
            title: 'Экзамены',
            countSuffix: 'экзамен(ов)',
            cached: 'Из кеша',
            updating: 'обновляется...',
            updated: 'Обновлено',
            minutesAgo: 'мин. назад',
            hoursAgo: 'ч. назад',
            refresh: 'Обновить',
            upcomingExam: 'Ближайший экзамен',
            daysShort: 'дн.',
            hoursShort: 'ч.',
            minutesShort: 'мин.',
            upcoming: 'Предстоящие',
            past: 'Прошедшие',
            noDate: 'Дата не назначена',
            milestones: 'Контрольные периоды',
            milestonesDescription: 'Рубежки и экзаменационные периоды из академического календаря',
            activeNow: 'Идёт сейчас',
            upcomingSoon: 'Впереди',
            midterm_1: 'Рубежный контроль 1',
            midterm_2: 'Рубежный контроль 2',
            examsPeriod: 'Экзаменационная сессия',
            stateExams: 'Государственные экзамены',
            emptyTitle: 'Нет экзаменов',
            emptyDescription: 'Экзамены появятся здесь, когда будет опубликовано расписание сессии',
            room: 'Ауд.',
            weeksSuffix: 'нед.',
            cacheMinutesShort: 'мин',
            cacheHoursShort: 'ч',
            searchPlaceholder: 'Поиск по предмету, преподавателю, аудитории',
            searchClear: 'Очистить поиск',
            noResults: 'Ничего не найдено',
            copyAria: 'Скопировать данные экзамена',
            copied: 'Скопировано',
            copyFailed: 'Не удалось скопировать',
            filterAll: 'Все',
        },
        kz: {
            title: 'Емтихандар',
            countSuffix: 'емтихан',
            cached: 'Кэштен',
            updating: 'жаңартылуда...',
            updated: 'Жаңартылды',
            minutesAgo: 'мин. бұрын',
            hoursAgo: 'сағ. бұрын',
            refresh: 'Жаңарту',
            upcomingExam: 'Ең жақын емтихан',
            daysShort: 'күн',
            hoursShort: 'сағ',
            minutesShort: 'мин',
            upcoming: 'Алдағы',
            past: 'Өткен',
            noDate: 'Күні белгіленбеген',
            milestones: 'Бақылау кезеңдері',
            milestonesDescription: 'Академиялық күнтізбедегі межелік бақылау мен емтихан кезеңдері',
            activeNow: 'Қазір өтіп жатыр',
            upcomingSoon: 'Алда',
            midterm_1: 'Межелік бақылау 1',
            midterm_2: 'Межелік бақылау 2',
            examsPeriod: 'Емтихан сессиясы',
            stateExams: 'Мемлекеттік емтихандар',
            emptyTitle: 'Емтихан жоқ',
            emptyDescription: 'Сессия кестесі жарияланған кезде емтихандар осында көрінеді',
            room: 'аудитория',
            weeksSuffix: 'апта',
            cacheMinutesShort: 'мин',
            cacheHoursShort: 'сағ',
            searchPlaceholder: 'Пән, оқытушы, аудитория бойынша іздеу',
            searchClear: 'Іздеуді тазалау',
            noResults: 'Ештеңе табылмады',
            copyAria: 'Емтихан деректерін көшіру',
            copied: 'Көшірілді',
            copyFailed: 'Көшіру сәтсіз аяқталды',
            filterAll: 'Барлығы',
        },
        en: {
            title: 'Exams',
            countSuffix: 'exam(s)',
            cached: 'From cache',
            updating: 'updating...',
            updated: 'Updated',
            minutesAgo: 'min ago',
            hoursAgo: 'h ago',
            refresh: 'Refresh',
            upcomingExam: 'Next exam',
            daysShort: 'd',
            hoursShort: 'h',
            minutesShort: 'm',
            upcoming: 'Upcoming',
            past: 'Past',
            noDate: 'Date not set yet',
            milestones: 'Academic checkpoints',
            milestonesDescription: 'Midterms and exam periods from the academic calendar',
            activeNow: 'Active now',
            upcomingSoon: 'Upcoming',
            midterm_1: 'Midterm 1',
            midterm_2: 'Midterm 2',
            examsPeriod: 'Exam session',
            stateExams: 'State exams',
            emptyTitle: 'No exams',
            emptyDescription: 'Exams will appear here when the session schedule is published',
            room: 'Room',
            weeksSuffix: 'wk',
            cacheMinutesShort: 'min',
            cacheHoursShort: 'h',
            searchPlaceholder: 'Search by subject, teacher, room',
            searchClear: 'Clear search',
            noResults: 'Nothing found',
            copyAria: 'Copy exam details',
            copied: 'Copied',
            copyFailed: 'Could not copy',
            filterAll: 'All',
        },
    }[language];

    const handleCopyExam = async (exam: Exam) => {
        const lines = [exam.subject];
        if (exam.datetime) {
            lines.push(`${exam.datetime.displayDate} ${exam.datetime.displayTime}`);
        }
        const location = [exam.building, exam.room ? formatExamRoom(exam.room, language, ui.room) : '']
            .filter(Boolean)
            .join(', ');
        if (location) lines.push(location);
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            toast.success(ui.copied);
        } catch {
            toast.error(ui.copyFailed);
        }
    };

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentTimestamp(Date.now());
        }, 60_000);

        return () => window.clearInterval(timer);
    }, []);

    // Сортируем экзамены по дате (экзамены без даты — стабильно в конце)
    const sortedExams = [...exams.exams].sort(compareExamsForDisplay);

    // Фильтр по поисковому запросу и типу экзамена
    const isFiltered = searchQuery.trim().length > 0 || flagFilter !== 'all';
    const visibleExams = filterExams(sortedExams, searchQuery)
        .filter((exam) => flagFilter === 'all' || Boolean(exam.flags?.[flagFilter]));

    // Разделяем на предстоящие, прошедшие и без назначенной даты.
    // Экзамены без datetime раньше не попадали ни в один раздел и молча
    // исчезали из списка, хотя счётчик в шапке их учитывал (№9 аудита).
    const now = new Date();
    const upcoming = visibleExams.filter(e => e.datetime && new Date(e.datetime.iso) >= now);
    const past = visibleExams.filter(e => e.datetime && new Date(e.datetime.iso) < now);
    const undated = visibleExams.filter(e => !e.datetime);
    const milestones = exams.meta.academicMilestones || [];
    const milestoneLabels = {
        midterm_1: ui.midterm_1,
        midterm_2: ui.midterm_2,
        exams: ui.examsPeriod,
        state_exams: ui.stateExams,
    } as const;

    return (
        <PageShell>
            {/* Header */}
            <header className="app-header">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="app-header-title">{ui.title}</h1>
                        <p className="app-header-subtitle">
                            {exams.meta.totalExams} {ui.countSuffix} • {isStale ? (
                                <span className="inline-flex items-center gap-1">
                                    <span className="theme-status-dot theme-status-dot-warning animate-pulse"></span>
                                    {ui.cached}{cacheAge ? ` (${cacheAge < 60 ? `${cacheAge} ${ui.cacheMinutesShort}` : `${Math.floor(cacheAge / 60)} ${ui.cacheHoursShort}`})` : ''}, {ui.updating}
                                </span>
                            ) : (
                                <>{ui.updated} {cacheAgeMinutes < 60
                                    ? `${cacheAgeMinutes} ${ui.minutesAgo}`
                                    : `${Math.floor(cacheAgeMinutes / 60)} ${ui.hoursAgo}`}</>
                            )}
                        </p>
                    </div>
                    <button
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="refresh-btn"
                    >
                        <RefreshCw
                            className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
                            strokeWidth={2}
                            aria-hidden
                        />
                        {refreshing ? '' : ui.refresh}
                    </button>
                </div>
            </header>

            {/* Content */}
            <PageMain>
                {exams.exams.length > 0 && (
                    <div className="grades-search-bar mb-4">
                        <div className="grades-search-input-wrap">
                            <Search size={16} strokeWidth={2} aria-hidden className="grades-search-icon" />
                            <input
                                type="search"
                                className="grades-search-input"
                                placeholder={ui.searchPlaceholder}
                                value={searchQuery}
                                onChange={(event) => setSearchQuery(event.target.value)}
                                autoCorrect="off"
                                autoCapitalize="none"
                                spellCheck={false}
                            />
                            {searchQuery.length > 0 ? (
                                <button
                                    type="button"
                                    className="grades-search-clear"
                                    onClick={() => setSearchQuery('')}
                                    aria-label={ui.searchClear}
                                >
                                    <X size={14} strokeWidth={2} aria-hidden />
                                </button>
                            ) : null}
                        </div>
                    </div>
                )}

                {availableFlags.length > 0 && (
                    <div className="grades-filter-row mb-4" role="group" aria-label={ui.filterAll}>
                        <button
                            type="button"
                            className={flagFilter === 'all' ? 'grades-filter-chip grades-filter-chip-active' : 'grades-filter-chip'}
                            onClick={() => setFlagFilter('all')}
                            aria-pressed={flagFilter === 'all'}
                        >
                            {ui.filterAll}
                        </button>
                        {availableFlags.map((flag) => (
                            <button
                                key={flag}
                                type="button"
                                className={flagFilter === flag ? 'grades-filter-chip grades-filter-chip-active' : 'grades-filter-chip'}
                                onClick={() => setFlagFilter(flag)}
                                aria-pressed={flagFilter === flag}
                            >
                                {badgesUi[flag]}
                            </button>
                        ))}
                    </div>
                )}

                {!isFiltered && milestones.length > 0 && (
                    <section className="mb-6">
                        <div className="mb-4">
                            <h3 className="font-semibold text-fg">{ui.milestones}</h3>
                            <p className="text-sm mt-1 text-muted-fg">{ui.milestonesDescription}</p>
                        </div>
                        <div className="space-y-3">
                            {milestones.map((milestone, index) => (
                                <div
                                    key={`${milestone.kind}-${milestone.start}-${milestone.end}-${index}`}
                                    className="exam-card animate-fadeInUp"
                                    style={{ animationDelay: `${index * 40}ms` }}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h4 className="exam-subject">
                                                    {milestoneLabels[milestone.kind] || milestone.label}
                                                </h4>
                                                {(milestone.active || milestone.upcoming) && (
                                                    <span className="exam-meta-item" style={{
                                                        background: milestone.active ? 'rgba(var(--good-rgb), 0.14)' : 'rgba(var(--primary-rgb), 0.14)',
                                                        color: milestone.active ? 'var(--good)' : 'var(--primary)'
                                                    }}>
                                                        {milestone.active ? ui.activeNow : ui.upcomingSoon}
                                                    </span>
                                                )}
                                            </div>
                                            <div className="lesson-detail mt-2">
                                                <CalendarRange className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                                                <span>{formatMilestoneRange(milestone.start, milestone.end, language)}</span>
                                            </div>
                                            <div className="lesson-detail">
                                                <Layers className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                                                <span>{milestone.segmentLabel}</span>
                                            </div>
                                        </div>
                                        {typeof milestone.weeks === 'number' && milestone.weeks > 0 && (
                                            <div className="exam-meta-item shrink-0">
                                                {milestone.weeks} {ui.weeksSuffix}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </section>
                )}

                {/* Countdown */}
                {!isFiltered && upcoming.length > 0 && (
                    <ExamCountdown exams={upcoming} nowTimestamp={currentTimestamp} language={language} ui={ui} />
                )}

                {/* Upcoming Exams */}
                {upcoming.length > 0 && (
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--good)' }}></span>
                            <h3 className="font-semibold text-fg">{ui.upcoming} ({upcoming.length})</h3>
                        </div>
                        <div className="space-y-3">
                            {upcoming.map((exam, index) => (
                                <ExamCard key={index} exam={exam} index={index} language={language} ui={ui} badgesUi={badgesUi} onCopy={() => void handleCopyExam(exam)} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Exams without an assigned date — деканат ещё не проставил дату,
                    но экзамен существует и должен быть виден в списке */}
                {undated.length > 0 && (
                    <div className="mb-6">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--status-warning-color)' }}></span>
                            <h3 className="font-semibold text-fg">{ui.noDate} ({undated.length})</h3>
                        </div>
                        <div className="space-y-3">
                            {undated.map((exam, index) => (
                                <ExamCard key={index} exam={exam} index={upcoming.length + index} language={language} ui={ui} badgesUi={badgesUi} onCopy={() => void handleCopyExam(exam)} />
                            ))}
                        </div>
                    </div>
                )}

                {/* Past Exams */}
                {past.length > 0 && (
                    <div>
                        <div className="flex items-center gap-2 mb-4">
                            <span className="w-2 h-2 rounded-full" style={{ background: 'var(--muted)' }}></span>
                            <h3 className="font-semibold text-muted-fg">{ui.past} ({past.length})</h3>
                        </div>
                        <div className="space-y-3">
                            {past.map((exam, index) => (
                                <ExamCard key={index} exam={exam} index={upcoming.length + undated.length + index} language={language} ui={ui} badgesUi={badgesUi} onCopy={() => void handleCopyExam(exam)} />
                            ))}
                        </div>
                    </div>
                )}

                {/* No search results */}
                {isFiltered && visibleExams.length === 0 && exams.exams.length > 0 && (
                    <div className="empty-state">
                        <Search className="empty-state-icon" strokeWidth={2} aria-hidden />
                        <h3 className="empty-state-title">{ui.noResults}</h3>
                    </div>
                )}

                {/* Empty State */}
                {exams.exams.length === 0 && (
                    <div className="empty-state">
                        <FileText className="empty-state-icon" strokeWidth={2} aria-hidden />
                        <h3 className="empty-state-title">{ui.emptyTitle}</h3>
                        <p className="empty-state-description">{ui.emptyDescription}</p>
                    </div>
                )}
            </PageMain>
        </PageShell>
    );
}
