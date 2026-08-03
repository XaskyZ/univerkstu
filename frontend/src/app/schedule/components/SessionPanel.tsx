'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarRange, Clock, FileText, MapPin, User } from 'lucide-react';
import type { Exam, Exams } from '@/lib/types';
import type { AcademicContextPeriod } from '@/lib/api';
import type { AppLanguage } from '@/lib/language-context';
import { getExamBadgesUi, type ExamBadgesUi } from '@/app/exams/utils/exam-badges-i18n';
import {
    formatSessionDate,
    formatSessionRange,
    getSessionDaysRemaining,
    parsePeriodDate,
    SESSION_MONTHS,
} from '@/lib/session-mode';

interface SessionPanelProps {
    /** Active session period derived from academicContext.periods. */
    period: AcademicContextPeriod | null;
    /** activePeriodLabel from academicContext, used as the card title. */
    periodLabel: string | null;
    /** Cached exam list. `null` means not loaded yet, `undefined` means not requested. */
    exams: Exams | null;
    /** Current epoch ms — passed in so we share the schedule view's clock and avoid drift. */
    nowMs: number;
    language: AppLanguage;
}

function pluralizeDays(count: number, language: AppLanguage): string {
    if (language === 'en') {
        return count === 1 ? '1 day' : `${count} days`;
    }
    if (language === 'kz') {
        return `${count} күн`;
    }
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return `${count} день`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} дня`;
    return `${count} дней`;
}

function getSessionUi(language: AppLanguage) {
    return {
        ru: {
            sessionTitle: 'Сессия',
            cardSubtitle: 'Активный период из академического календаря',
            datesLabel: 'Даты',
            daysLeft: (count: number) => `Осталось ${pluralizeDays(count, 'ru')}`,
            upcomingHeading: 'Ближайшие экзамены',
            pastHeading: 'Прошедшие экзамены',
            examsUnavailable: 'Расписание экзаменов пока недоступно',
            examsUnavailableHint: 'Откройте раздел «Экзамены», чтобы попробовать обновить.',
            sessionComplete: 'Сессия завершена',
            sessionCompleteHint: 'Все экзамены сданы.',
            noExams: 'Экзамены не найдены',
            noExamsHint: 'В этой сессии нет запланированных экзаменов.',
            room: 'Ауд.',
            until: 'до',
            nextExamLabel: 'Ближайший',
            nextExamSuffix: (days: number) => days <= 0
                ? 'сегодня'
                : days === 1
                    ? 'завтра'
                    : `через ${pluralizeDays(days, 'ru')}`,
            inMinutes: (mins: number) => `через ${mins} мин`,
            inHoursMinutes: (h: number, m: number) => `через ${h} ч ${m} мин`,
            tomorrowAt: (time: string) => `завтра в ${time}`,
            startingNow: 'начинается сейчас',
        },
        kz: {
            sessionTitle: 'Сессия',
            cardSubtitle: 'Академиялық күнтізбедегі белсенді кезең',
            datesLabel: 'Кезең',
            daysLeft: (count: number) => `Қалғаны ${count} күн`,
            upcomingHeading: 'Алдағы емтихандар',
            pastHeading: 'Өткен емтихандар',
            examsUnavailable: 'Емтихан кестесі әзірге қолжетімсіз',
            examsUnavailableHint: '«Емтихандар» бөлімін ашып, жаңартып көріңіз.',
            sessionComplete: 'Сессия аяқталды',
            sessionCompleteHint: 'Барлық емтихандар тапсырылды.',
            noExams: 'Емтихандар табылмады',
            noExamsHint: 'Бұл сессияда жоспарланған емтихандар жоқ.',
            room: 'Ауд.',
            until: 'дейін',
            nextExamLabel: 'Ең жақын',
            nextExamSuffix: (days: number) => days <= 0
                ? 'бүгін'
                : days === 1
                    ? 'ертең'
                    : `${days} күннен кейін`,
            inMinutes: (mins: number) => `${mins} мин қалды`,
            inHoursMinutes: (h: number, m: number) => `${h} сағ ${m} мин қалды`,
            tomorrowAt: (time: string) => `ертең сағат ${time}`,
            startingNow: 'қазір басталады',
        },
        en: {
            sessionTitle: 'Session',
            cardSubtitle: 'Active period from the academic calendar',
            datesLabel: 'Dates',
            daysLeft: (count: number) => count === 1 ? '1 day left' : `${count} days left`,
            upcomingHeading: 'Upcoming exams',
            pastHeading: 'Past exams',
            examsUnavailable: 'Exam schedule is not available yet',
            examsUnavailableHint: 'Open the Exams page to try refreshing it.',
            sessionComplete: 'Session complete',
            sessionCompleteHint: 'All your exams are done.',
            noExams: 'No exams scheduled',
            noExamsHint: 'You have no exams scheduled for this session.',
            room: 'Room',
            until: 'until',
            nextExamLabel: 'Next',
            nextExamSuffix: (days: number) => days <= 0
                ? 'today'
                : days === 1
                    ? 'tomorrow'
                    : `in ${days} days`,
            inMinutes: (mins: number) => `in ${mins} min`,
            inHoursMinutes: (h: number, m: number) => `in ${h} h ${m} min`,
            tomorrowAt: (time: string) => `tomorrow at ${time}`,
            startingNow: 'starting now',
        },
    }[language];
}

/**
 * Pick the most precise countdown phrase for the next exam.
 * - >= 24h away: fall back to the day-based suffix ("через 2 дня", "in 2 days")
 * - 1h–24h away when the exam is tomorrow (calendar day): "завтра в 09:00"
 *   otherwise just "через {h} ч {m} мин"
 * - < 1h away: "через 47 мин"
 * - <= 0: "начинается сейчас"
 */
function formatExamCountdown(
    examIsoTime: number,
    nowMs: number,
    ui: ReturnType<typeof getSessionUi>,
    daysOut: number,
): string {
    const diffMs = examIsoTime - nowMs;

    if (diffMs <= 0) {
        return ui.startingNow;
    }

    // Within an hour — minute precision only.
    if (diffMs < 60 * 60 * 1000) {
        const mins = Math.max(1, Math.ceil(diffMs / 60_000));
        return ui.inMinutes(mins);
    }

    // Within 24h — hours + minutes; prefer "tomorrow at HH:MM" when applicable.
    if (diffMs < 24 * 60 * 60 * 1000) {
        const totalMinutes = Math.floor(diffMs / 60_000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        const examDate = new Date(examIsoTime);
        const nowDate = new Date(nowMs);
        const tomorrowDate = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() + 1);
        const isTomorrow =
            examDate.getFullYear() === tomorrowDate.getFullYear() &&
            examDate.getMonth() === tomorrowDate.getMonth() &&
            examDate.getDate() === tomorrowDate.getDate();

        if (isTomorrow) {
            const timeLabel = examDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return `${ui.tomorrowAt(timeLabel)} · ${ui.inHoursMinutes(hours, minutes)}`;
        }

        return ui.inHoursMinutes(hours, minutes);
    }

    // >= 24h — fall back to coarse day suffix from the existing API.
    return ui.nextExamSuffix(daysOut);
}

function ExamCard({
    exam,
    index,
    language,
    roomLabel,
    badgesUi,
    isNext = false,
}: {
    exam: Exam;
    index: number;
    language: AppLanguage;
    roomLabel: string;
    badgesUi: ExamBadgesUi;
    isNext?: boolean;
}) {
    const flags = exam.flags;
    const examDate = exam.datetime;
    const months = SESSION_MONTHS[language];
    const dayNumber = examDate ? Number(examDate.displayDate.split('.')[0]) : null;
    const monthNumber = examDate ? Number(examDate.displayDate.split('.')[1]) : null;
    const monthLabel = monthNumber && monthNumber >= 1 && monthNumber <= 12
        ? months[monthNumber - 1]
        : null;

    return (
        <div
            className={`exam-card animate-fadeInUp${isNext ? ' exam-card--next' : ''}`}
            style={{ animationDelay: `${index * 40}ms` }}
        >
            <div className="flex gap-4">
                {examDate && dayNumber !== null && monthLabel && (
                    <div
                        className="exam-date-tile flex-shrink-0 w-16 h-16 rounded-xl flex flex-col items-center justify-center text-white"
                        style={{ background: 'var(--gradient-primary)' }}
                    >
                        <span className="text-2xl font-bold">{dayNumber}</span>
                        <span className="text-xs opacity-80">{monthLabel}</span>
                    </div>
                )}

                <div className="flex-1 min-w-0">
                    <h4 className="exam-subject">{exam.subject}</h4>

                    <div className="exam-meta">
                        {examDate && (
                            <span className="exam-meta-item">
                                <Clock className="w-4 h-4" strokeWidth={2} aria-hidden />
                                {examDate.displayTime}
                            </span>
                        )}
                        {exam.format && (
                            <span className="exam-meta-item">{exam.format}</span>
                        )}
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

                    {exam.teacher && (
                        <div className="lesson-detail mt-2">
                            <User className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                            <span>{exam.teacher}</span>
                        </div>
                    )}

                    {(exam.building || exam.room) && (
                        <div className="lesson-detail">
                            <MapPin className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                            <span>
                                {exam.building && `${exam.building}`}
                                {exam.building && exam.room && ', '}
                                {exam.room && `${roomLabel} ${exam.room}`}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default function SessionPanel({ period, periodLabel, exams, nowMs, language }: SessionPanelProps) {
    const ui = getSessionUi(language);
    const badgesUi = useMemo(() => getExamBadgesUi(language), [language]);

    // Local ticking clock — refreshes every 60s so the countdown stays accurate
    // without waiting for the surrounding page to re-render. We seed it lazily
    // from the `nowMs` prop, then drive it ourselves via an interval. If the
    // upstream clock moves further than 2 minutes ahead (e.g. page resumed from
    // background), the surrounding `nowMs` prop will take over via `Math.max`.
    const [tick, setTick] = useState<number>(() => nowMs);
    useEffect(() => {
        const interval = setInterval(() => setTick(Date.now()), 60_000);
        return () => clearInterval(interval);
    }, []);
    const currentMs = Math.max(tick, nowMs);

    const daysRemaining = getSessionDaysRemaining(period, currentMs);
    const rangeLabel = formatSessionRange(period, language);
    const endShortLabel = formatSessionDate(period?.end ?? null, language);

    // Session progress: 0..1 fraction of how far through the session window we are.
    // `null` when we can't compute a sensible value (no period, malformed dates,
    // or the window has zero length).
    const sessionWindow = (() => {
        if (!period) return null;
        const start = parsePeriodDate(period.start);
        const end = parsePeriodDate(period.end);
        if (!start || !end) return null;
        const startMs = start.getTime();
        const endMs = end.getTime();
        if (endMs <= startMs) return null;
        return { startMs, endMs };
    })();

    const sessionProgress = sessionWindow
        ? Math.max(0, Math.min(1, (currentMs - sessionWindow.startMs) / (sessionWindow.endMs - sessionWindow.startMs)))
        : null;

    // Real-time advance: snapshot the *current* progress + the number of
    // milliseconds left in the session, then hand both to CSS as custom
    // properties so a linear @keyframes animation can crawl the bar from its
    // current position toward 100% over the remaining wall-clock time.
    //
    // The snapshot is memoised against the session window itself, NOT
    // `currentMs`, on purpose: the 60s `tick` interval (driving the textual
    // countdown) would otherwise re-emit new CSS variable values every
    // minute and reset the running animation — causing a tiny visible jitter.
    // By capturing the initial `currentMs` per session window, the CSS
    // animation runs uninterrupted from start to end of the session.
    //
    // We intentionally avoid setInterval for the bar — the animation is
    // driven by the browser's CSS engine, which keeps it in sync with real
    // time even across tab throttling.
    const liveAnimation = useMemo(() => {
        if (!sessionWindow) return null;
        const seededAt = currentMs;
        const remainingMs = Math.max(0, sessionWindow.endMs - seededAt);
        const startProgress = Math.max(0, Math.min(1,
            (seededAt - sessionWindow.startMs) / (sessionWindow.endMs - sessionWindow.startMs),
        ));
        return { startProgress, remainingMs };
        // currentMs is intentionally excluded: see comment above.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionWindow?.startMs, sessionWindow?.endMs]);

    const sessionLive = liveAnimation !== null
        && liveAnimation.startProgress > 0
        && liveAnimation.startProgress < 1
        && liveAnimation.remainingMs > 0;

    const sortedExams = exams
        ? [...exams.exams].sort((a, b) => {
            if (!a.datetime || !b.datetime) return 0;
            return new Date(a.datetime.iso).getTime() - new Date(b.datetime.iso).getTime();
        })
        : null;

    // Milestone ticks: each upcoming/past exam mapped to a position on the bar.
    // Only render when we have a valid session window AND exam data — both are
    // already computed for other reasons so no extra cost.
    const milestones = sessionWindow && sortedExams
        ? sortedExams
            .map((exam) => {
                if (!exam.datetime) return null;
                const ms = new Date(exam.datetime.iso).getTime();
                if (Number.isNaN(ms)) return null;
                const fraction = (ms - sessionWindow.startMs) / (sessionWindow.endMs - sessionWindow.startMs);
                if (fraction < 0 || fraction > 1) return null;
                return {
                    subject: exam.subject,
                    displayDate: exam.datetime.displayDate,
                    fraction,
                    isPast: ms < currentMs,
                };
            })
            .filter((m): m is { subject: string; displayDate: string; fraction: number; isPast: boolean } => m !== null)
        : [];

    const now = new Date(currentMs);
    const upcoming = sortedExams
        ? sortedExams.filter((e) => e.datetime && new Date(e.datetime.iso) >= now)
        : null;

    const nextExam = upcoming && upcoming.length > 0 ? upcoming[0] : null;
    const nextExamMs = nextExam?.datetime ? new Date(nextExam.datetime.iso).getTime() : null;
    const nextExamDaysOut = nextExamMs !== null
        ? Math.max(0, Math.ceil((nextExamMs - currentMs) / 86_400_000))
        : null;
    const nextExamCountdown = nextExamMs !== null && nextExamDaysOut !== null
        ? formatExamCountdown(nextExamMs, currentMs, ui, nextExamDaysOut)
        : null;

    const cardTitle = periodLabel || ui.sessionTitle;

    return (
        <section className="session-panel space-y-4 mb-4">
            <div
                className="card animate-fadeInUp"
                style={{ padding: '1.25rem' }}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <h2 className="text-lg font-semibold text-fg">{cardTitle}</h2>
                        <p className="text-sm mt-1 text-muted-fg">{ui.cardSubtitle}</p>
                    </div>
                    {daysRemaining !== null && (
                        <span
                            className="exam-meta-item shrink-0"
                            style={{
                                background: 'rgba(var(--primary-rgb), 0.14)',
                                color: 'var(--primary)',
                            }}
                        >
                            {daysRemaining === 0 ? ui.sessionComplete : ui.daysLeft(daysRemaining)}
                        </span>
                    )}
                </div>

                {rangeLabel && (
                    <div className="lesson-detail mt-3">
                        <CalendarRange className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                        <span>{rangeLabel}</span>
                    </div>
                )}

                {sessionProgress !== null && (
                    <div
                        className="session-progress-track"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(sessionProgress * 100)}
                        aria-label={ui.datesLabel}
                    >
                        <div
                            className={`session-progress-fill${sessionLive ? ' session-progress-fill--live' : ''}`}
                            style={{
                                // Custom properties drive both the static
                                // (reduced-motion / edge case) transform and
                                // the live @keyframes animation. When live,
                                // we use the seeded snapshot so the values
                                // stay stable across 60s ticks (see
                                // `liveAnimation` memo above).
                                ['--session-start-progress' as string]: sessionLive && liveAnimation
                                    ? liveAnimation.startProgress
                                    : sessionProgress,
                                ['--session-remaining-ms' as string]: `${liveAnimation?.remainingMs ?? 0}ms`,
                            } as React.CSSProperties}
                        />
                        {milestones.map((m, i) => (
                            <span
                                key={`${m.subject}-${i}`}
                                className={`session-progress-tick session-progress-tick--${m.isPast ? 'past' : 'upcoming'}`}
                                style={{ left: `${m.fraction * 100}%` }}
                                title={`${m.subject} · ${m.displayDate}`}
                                aria-hidden
                            />
                        ))}
                    </div>
                )}

                {nextExam && nextExamCountdown && (
                    <div className="lesson-detail">
                        <Clock className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                        <span>
                            {ui.nextExamLabel}: <span className="text-fg font-medium">{nextExam.subject}</span>
                            {' · '}
                            <span className="session-countdown" key={nextExamCountdown}>
                                {nextExamCountdown}
                            </span>
                        </span>
                    </div>
                )}

                {!nextExam && period?.end && endShortLabel && daysRemaining !== null && daysRemaining > 0 && (
                    <div className="lesson-detail">
                        <Clock className="lesson-detail-icon" strokeWidth={2} aria-hidden />
                        <span>{ui.until} {endShortLabel}</span>
                    </div>
                )}
            </div>

            {upcoming && upcoming.length > 0 && (
                <div>
                    <div className="flex items-center gap-2 mb-3">
                        <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: 'var(--good)' }}
                            aria-hidden
                        />
                        <h3 className="font-semibold text-fg">
                            {ui.upcomingHeading} ({upcoming.length})
                        </h3>
                    </div>
                    <div className="space-y-3">
                        {upcoming.map((exam, index) => (
                            <ExamCard
                                key={`${exam.subject}-${exam.datetime?.iso ?? index}`}
                                exam={exam}
                                index={index}
                                language={language}
                                roomLabel={ui.room}
                                badgesUi={badgesUi}
                                isNext={index === 0}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* Exams not loaded yet — genuinely unknown state. */}
            {!exams && (
                <div className="card p-4">
                    <div className="flex items-start gap-3">
                        <FileText
                            className="w-5 h-5 mt-0.5 text-muted-fg shrink-0"
                            strokeWidth={2}
                            aria-hidden
                        />
                        <div>
                            <p className="text-sm font-medium text-fg">{ui.examsUnavailable}</p>
                            <p className="text-xs mt-1 text-muted-fg">{ui.examsUnavailableHint}</p>
                        </div>
                    </div>
                </div>
            )}

            {/*
              Exams loaded but nothing upcoming. Two distinct sub-states:
              - had exams, all now in the past → session is complete (all exams done)
              - no exams in the data at all → none scheduled for this session
              Previously both fell through to "exams unavailable", which read as a
              load failure even after the student had finished every exam.
            */}
            {exams && upcoming && upcoming.length === 0 && (
                <div className="card p-4">
                    <div className="flex items-start gap-3">
                        {exams.exams.length > 0 ? (
                            <CalendarCheck
                                className="w-5 h-5 mt-0.5 shrink-0"
                                style={{ color: 'var(--good)' }}
                                strokeWidth={2}
                                aria-hidden
                            />
                        ) : (
                            <FileText
                                className="w-5 h-5 mt-0.5 text-muted-fg shrink-0"
                                strokeWidth={2}
                                aria-hidden
                            />
                        )}
                        <div>
                            <p className="text-sm font-medium text-fg">
                                {exams.exams.length > 0 ? ui.sessionComplete : ui.noExams}
                            </p>
                            <p className="text-xs mt-1 text-muted-fg">
                                {exams.exams.length > 0 ? ui.sessionCompleteHint : ui.noExamsHint}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </section>
    );
}
