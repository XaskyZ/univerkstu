'use client';

import { useMemo, useRef, useCallback, useState } from 'react';
import dynamic from 'next/dynamic';
import { Bell, BellOff, CalendarDays, List, RefreshCw, Search, X } from 'lucide-react';
import { Schedule, Lesson, Exams } from '@/lib/types';
import type { AcademicContext } from '@/lib/api';
import { useNotifications } from '@/lib/use-notifications';
import { formatMessage, useLanguage, type AppLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { motion } from 'framer-motion';
import { useSwipeable } from 'react-swipeable';
import WeekendAnimation from './WeekendAnimation';
import { CustomLesson } from '@/lib/custom-lessons';
import { buildScheduleLessonNoteKey } from '@/lib/schedule-notes';
import { PageMain, PageShell } from './PageShell';
import {
    addDays,
    formatBreak,
    formatCompactDate,
    getBetweenSlotBreak,
    getCurrentDayIndex,
    getInternalBreaks,
    parseDateOnly,
} from '@/app/schedule/utils/time-helpers';
import { getWeekInfo } from '@/app/schedule/utils/week-info';
import { isLessonPeriodActive } from '@/app/schedule/utils/lesson-period';
import { searchLessons } from '@/app/schedule/utils/search-lessons';
import { LessonCardWithModal } from '@/app/schedule/components/LessonCardMobile';
import { useScheduleClock } from '@/app/schedule/hooks/useScheduleClock';
import { useCustomLessons } from '@/app/schedule/hooks/useCustomLessons';
import { useScheduleViewMode } from '@/app/schedule/hooks/useScheduleViewMode';
import { useScheduleParity } from '@/app/schedule/hooks/useScheduleParity';
import SessionPanel from '@/app/schedule/components/SessionPanel';
import HideToggle from '@/app/schedule/components/HideToggle';
import SessionDecoration from '@/app/schedule/components/SessionDecoration';
import NextUpCard from '@/app/schedule/components/NextUpCard';
import { downloadScheduleIcs } from '@/lib/api/schedule-export';
import { useScheduleSecondaryCollapse } from '@/app/schedule/hooks/useScheduleSecondaryCollapse';
import { usePracticePeriodOverride } from '@/app/schedule/hooks/usePracticePeriodOverride';
import { getActiveSessionPeriod } from '@/lib/session-mode';

// Personal manual lessons are disabled in the main schedule UI.
// The implementation stays in the codebase for a future group space.
const ENABLE_PERSONAL_CUSTOM_LESSONS = false;
const AddLessonModal = dynamic(() => import('./AddLessonModal'), { ssr: false });
const WeatherMoodCard = dynamic(() => import('./WeatherMoodCard'), { ssr: false });

interface ScheduleViewProps {
    schedule: Schedule;
    academicContext?: AcademicContext | null;
    onRefresh: () => void;
    refreshing: boolean;
    isStale?: boolean;      // Данные из кеша?
    cacheAge?: number | null; // Возраст кеша в минутах
    // True when activePeriodKind is exams|state_exams. Re-prioritizes the page:
    // session card + upcoming exams move to the top, the class schedule becomes
    // a secondary "Расписание занятий" section below.
    sessionMode?: boolean;
    sessionExams?: Exams | null;
}

// Все дни недели (включая воскресенье!)
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_RANGE_LABELS = {
    ru: { start: 'Пн', end: 'Вс' },
    kz: { start: 'Дс', end: 'Жс' },
    en: { start: 'Mon', end: 'Sun' },
} as const;

// Copy for the plan-wide "Практика" disambiguation toggle. The academic
// calendar can't tell whether this student actually does practice or is on
// vacation during the plan's practice window, so we ask.
function getPracticePeriodUi(language: AppLanguage) {
    if (language === 'en') {
        return {
            question: 'Your plan shows practice now — does it apply to you?',
            hint: "The academic calendar lists practice for the whole plan, so we can't tell automatically.",
            practice: 'I have practice',
            vacation: "I'm on vacation",
            vacationLabel: 'Vacation',
        };
    }
    if (language === 'kz') {
        return {
            question: 'Жоспар бойынша қазір практика — бұл сізге қатысты ма?',
            hint: 'Академиялық күнтізбе практиканы бүкіл жоспарға көрсетеді, сондықтан автоматты түрде анықтау мүмкін емес.',
            practice: 'Практикам бар',
            vacation: 'Демалыстамын',
            vacationLabel: 'Демалыс',
        };
    }
    return {
        question: 'По плану сейчас практика — это про вас?',
        hint: 'В академическом календаре практика указана для всего учебного плана, поэтому определить автоматически нельзя.',
        practice: 'У меня практика',
        vacation: 'Я на каникулах',
        vacationLabel: 'Каникулы',
    };
}


export default function ScheduleView({ schedule, academicContext, onRefresh, refreshing, isStale, cacheAge, sessionMode = false, sessionExams = null }: ScheduleViewProps) {
    const { messages, language } = useLanguage();
    const sessionPeriod = useMemo(
        () => (sessionMode ? getActiveSessionPeriod(academicContext) : null),
        [academicContext, sessionMode]
    );
    const sessionSecondaryHeading = sessionMode
        ? language === 'en'
            ? 'Class schedule'
            : language === 'kz'
                ? 'Сабақ кестесі'
                : 'Расписание занятий'
        : null;
    const sessionSecondaryDescription = sessionMode
        ? language === 'en'
            ? 'Stays available for consultations, retakes, and unfinished topics'
            : language === 'kz'
                ? 'Кеңестер, қайта тапсырулар және аяқталмаған тақырыптар үшін қолжетімді'
                : 'Остаётся доступным для консультаций, пересдач и незакрытых тем'
        : null;
    const cachedAt = new Date(schedule.cachedAt);
    const currentTimestamp = useScheduleClock();
    const cacheAgeMinutes = Math.max(0, Math.floor((currentTimestamp - cachedAt.getTime()) / 60000));
    const currentDayIndex = getCurrentDayIndex();
    const currentDayKey = DAY_KEYS[currentDayIndex];
    const daysContainerRef = useRef<HTMLDivElement>(null);
    const lastUpdateStr = useMemo(
        () => new Date(schedule.cachedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        [schedule.cachedAt]
    );
    const dayNames = useMemo<Record<string, string>>(() => ({
        mon: language === 'en' ? 'Monday' : language === 'kz' ? 'Дүйсенбі' : 'Понедельник',
        tue: language === 'en' ? 'Tuesday' : language === 'kz' ? 'Сейсенбі' : 'Вторник',
        wed: language === 'en' ? 'Wednesday' : language === 'kz' ? 'Сәрсенбі' : 'Среда',
        thu: language === 'en' ? 'Thursday' : language === 'kz' ? 'Бейсенбі' : 'Четверг',
        fri: language === 'en' ? 'Friday' : language === 'kz' ? 'Жұма' : 'Пятница',
        sat: language === 'en' ? 'Saturday' : language === 'kz' ? 'Сенбі' : 'Суббота',
        sun: language === 'en' ? 'Sunday' : language === 'kz' ? 'Жексенбі' : 'Воскресенье',
    }), [language]);
    const dayNamesShort = useMemo<Record<string, string>>(() => ({
        mon: language === 'en' ? 'MON' : language === 'kz' ? 'ДС' : 'ПН',
        tue: language === 'en' ? 'TUE' : language === 'kz' ? 'СС' : 'ВТ',
        wed: language === 'en' ? 'WED' : language === 'kz' ? 'СР' : 'СР',
        thu: language === 'en' ? 'THU' : language === 'kz' ? 'БС' : 'ЧТ',
        fri: language === 'en' ? 'FRI' : language === 'kz' ? 'ЖМ' : 'ПТ',
        sat: language === 'en' ? 'SAT' : language === 'kz' ? 'СН' : 'СБ',
        sun: language === 'en' ? 'SUN' : language === 'kz' ? 'ЖС' : 'ВС',
    }), [language]);

    const {
        customLessons,
        lessonNotes,
        addModalOpen,
        editingLesson,
        addModalDefaultDay,
        refreshCustomLessons,
        saveLessonNote,
        deleteLessonNote,
        openAddModal,
        openEditModal,
        closeModal,
    } = useCustomLessons(schedule.meta.userId);

    const customLessonTypeLabel = useCallback((type: CustomLesson['type']) => {
        if (type === 'srsp') return 'СРСП';
        if (type === 'curator_hour') {
            return language === 'en' ? 'Curator hour' : language === 'kz' ? 'Куратор сағаты' : 'Кураторский час';
        }
        return language === 'en' ? 'Other' : language === 'kz' ? 'Басқа' : 'Другое';
    }, [language]);

    // Информация о неделе
    const weekInfo = useMemo(() => getWeekInfo(messages, academicContext), [academicContext, messages]);
    const weekDateRangeLabel = useMemo(() => {
        if (!academicContext?.semesterStart || !academicContext.semesterWeek || academicContext.semesterWeek < 1) {
            return null;
        }

        const semesterStart = parseDateOnly(academicContext.semesterStart);
        if (!semesterStart) return null;

        const weekStart = addDays(semesterStart, (academicContext.semesterWeek - 1) * 7);
        const weekEnd = addDays(weekStart, 6);
        const labels = WEEKDAY_RANGE_LABELS[language];

        return `${labels.start} ${formatCompactDate(weekStart)} - ${labels.end} ${formatCompactDate(weekEnd)}`;
    }, [academicContext, language]);

    // Enable notifications
    const notifications = useNotifications(schedule, weekInfo.type, { watchSchedule: false });

    const getNotificationErrorMessage = (reason: 'unsupported' | 'ios_pwa_required' | 'denied' | 'error') => {
        if (reason === 'ios_pwa_required') {
            return messages.schedule.iosPwaNotificationsRequired;
        }
        if (reason === 'unsupported') {
            return messages.schedule.unsupportedNotifications;
        }
        if (reason === 'error') {
            return messages.schedule.notificationBrowserError;
        }
        return messages.schedule.notificationDenied;
    };

    const { viewMode, setViewMode, selectedDay, setSelectedDay } = useScheduleViewMode(currentDayKey, daysContainerRef);
    const { parityMode, setParityMode: handleParityModeChange } = useScheduleParity(weekInfo.type, currentTimestamp);
    const { collapsed: secondaryCollapsed, toggle: toggleSecondaryCollapsed } = useScheduleSecondaryCollapse();

    // Plan-wide practice period: the academic calendar lists "Практика" for the
    // whole learning plan, so it can't tell whether THIS student does practice or
    // is on vacation during that window. Offer a per-student toggle and let a
    // "vacation" answer override the displayed period label.
    const isPracticePeriod = academicContext?.activePeriodKind === 'practice';
    const semesterKey = academicContext
        ? `${academicContext.currentSemesterNumber ?? 'x'}:${academicContext.semesterStart ?? 'x'}`
        : null;
    const practiceUi = useMemo(() => getPracticePeriodUi(language), [language]);
    const { choice: practiceChoice, setChoice: setPracticeChoice } = usePracticePeriodOverride(
        isPracticePeriod ? semesterKey : null,
    );
    const showAsVacation = isPracticePeriod && practiceChoice === 'vacation';

    const effectiveWeekInfo = useMemo(() => {
        if (!showAsVacation) return weekInfo;
        const semesterLabel = academicContext?.currentSemesterLabel
            ? `${academicContext.currentSemesterLabel} • ${practiceUi.vacationLabel}`
            : practiceUi.vacationLabel;
        return { ...weekInfo, weekLabel: practiceUi.vacationLabel, semesterLabel, activePeriodLabel: practiceUi.vacationLabel };
    }, [showAsVacation, weekInfo, academicContext?.currentSemesterLabel, practiceUi.vacationLabel]);

    // Убедимся, что все 7 дней есть в структуре + мержим кастомные пары
    const allDays = useMemo(() => {
        const daysMap = new Map<string, { name: string; lessons: Lesson[][] }>();

        schedule.days.forEach(d => {
            // Deep copy lessons so we can safely inject custom ones
            daysMap.set(d.name, { name: d.name, lessons: d.lessons.map(slot => [...slot]) });
        });

        const result = DAY_KEYS.map(key => {
            const existing = daysMap.get(key);
            if (existing) return existing;
            return {
                name: key,
                lessons: schedule.timeSlots.map(() => [] as Lesson[])
            };
        });

        if (ENABLE_PERSONAL_CUSTOM_LESSONS) {
            for (const cl of customLessons) {
                const day = result[cl.dayIndex];
                if (!day || cl.timeSlotIndex >= schedule.timeSlots.length) continue;
                const slot = day.lessons[cl.timeSlotIndex];
                if (!slot) continue;
                slot.push({
                    title: cl.title,
                    type: customLessonTypeLabel(cl.type),
                    teacher: cl.teacher,
                    room: cl.room || null,
                    faculty: null,
                    parity: cl.parity,
                    period: null,
                    rawParams: `__custom__:${cl.id}`,
                    customTime: cl.customStart && cl.customEnd ? { start: cl.customStart, end: cl.customEnd } : null,
                });
            }
        }

        return result;
    }, [customLessonTypeLabel, customLessons, schedule.days, schedule.timeSlots]);

    // №11 (логик-аудит): семестр сейчас не идёт — каникулы между семестрами
    // (weekParity = null) или календарные каникулы внутри семестра. В этом
    // режиме не изображаем «идущую» учебную неделю: прячем «Сейчас/Далее»,
    // обнуляем «сегодня N пар», бейдж чётности показываем нейтральным.
    // Сама сетка остаётся доступной для просмотра.
    const scheduleDormant = Boolean(
        academicContext
        && (academicContext.activePeriodKind === 'vacation' || !academicContext.weekParity)
    );

    // №10 (логик-аудит): пара с периодом действия («1-8 неделя»,
    // «с 01.09 по 15.10») вне своего периода не должна попадать в счётчик
    // «сегодня N пар», превью и «Сейчас/Далее». В сетке недели она остаётся.
    const semesterWeek = academicContext?.semesterWeek ?? null;
    const isLessonActiveToday = useCallback(
        (l: Lesson) =>
            (l.parity === 'all' || l.parity === parityMode)
            && isLessonPeriodActive(l.period, { now: new Date(currentTimestamp), semesterWeek }),
        [parityMode, currentTimestamp, semesterWeek]
    );

    // Подсчитываем занятия на сегодня с учётом режима
    const todaySchedule = allDays.find(d => d.name === currentDayKey);
    const todayLessonsCount = useMemo(() => {
        if (!todaySchedule || scheduleDormant) return 0;
        return todaySchedule.lessons.reduce((acc, slot) => {
            const filtered = slot.filter(isLessonActiveToday);
            return acc + filtered.length;
        }, 0);
    }, [todaySchedule, scheduleDormant, isLessonActiveToday]);

    // Фильтрованные пары на сегодня для отображения
    const todayFilteredLessons = useMemo(() => {
        if (!todaySchedule || scheduleDormant) return [];
        return todaySchedule.lessons.map((slot, slotIndex) => ({
            slotIndex,
            timeSlot: schedule.timeSlots[slotIndex],
            lessons: slot.filter(isLessonActiveToday)
        })).filter(item => item.lessons.length > 0);
    }, [todaySchedule, scheduleDormant, isLessonActiveToday, schedule.timeSlots]);

    // Данные для выбранного дня в горизонтальном режиме
    const selectedDayData = useMemo(() => {
        const day = allDays.find(d => d.name === selectedDay);
        if (!day) return { lessons: [], count: 0 };

        const filteredLessons = day.lessons.map(slot =>
            slot.filter(l => l.parity === 'all' || l.parity === parityMode)
        );
        const count = filteredLessons.reduce((acc, slot) => acc + slot.length, 0);

        return { lessons: filteredLessons, count };
    }, [allDays, selectedDay, parityMode]);

    const selectedDayEntries = useMemo(() => {
        return schedule.timeSlots
            .map((timeSlot, slotIndex) => ({
                slotIndex,
                timeSlot,
                lessons: selectedDayData.lessons[slotIndex] || [],
            }))
            .filter(item => item.lessons.length > 0);
    }, [schedule.timeSlots, selectedDayData.lessons]);
    const horizontalDays = useMemo(() => allDays.slice(0, 6), [allDays]);
    const selectedDayHorizontalIndex = useMemo(
        () => horizontalDays.findIndex((day) => day.name === selectedDay),
        [horizontalDays, selectedDay]
    );
    const canSwipeToPrevDay = selectedDayHorizontalIndex > 0;
    const canSwipeToNextDay = selectedDayHorizontalIndex >= 0 && selectedDayHorizontalIndex < horizontalDays.length - 1;
    const swipeToPrevDay = useCallback(() => {
        if (!canSwipeToPrevDay) return;
        setSelectedDay(horizontalDays[selectedDayHorizontalIndex - 1].name);
    }, [canSwipeToPrevDay, horizontalDays, selectedDayHorizontalIndex, setSelectedDay]);
    const swipeToNextDay = useCallback(() => {
        if (!canSwipeToNextDay) return;
        setSelectedDay(horizontalDays[selectedDayHorizontalIndex + 1].name);
    }, [canSwipeToNextDay, horizontalDays, selectedDayHorizontalIndex, setSelectedDay]);
    const horizontalSwipeHandlers = useSwipeable({
        onSwipedLeft: ({ deltaX }) => {
            if (viewMode !== 'horizontal') return;
            if (Math.abs(deltaX) < 35) return;
            swipeToNextDay();
        },
        onSwipedRight: ({ deltaX }) => {
            if (viewMode !== 'horizontal') return;
            if (Math.abs(deltaX) < 35) return;
            swipeToPrevDay();
        },
        trackMouse: false,
        trackTouch: true,
        preventScrollOnSwipe: false,
        delta: 35,
    });
    const lessonCountLabel = useCallback((count: number) => {
        if (count === 1) return `${count} ${messages.schedule.lessonSingle}`;
        if (language === 'ru' && count < 5) return `${count} ${messages.schedule.lessonFew}`;
        return `${count} ${messages.schedule.lessonMany}`;
    }, [language, messages.schedule.lessonFew, messages.schedule.lessonMany, messages.schedule.lessonSingle]);

    // Cross-week lesson search (subject / teacher / room). Active only outside
    // session mode; when searching we replace the weekly/daily views with a flat
    // result list so the user can find a class without flipping through days.
    const [searchQuery, setSearchQuery] = useState('');
    const isSearching = !sessionMode && searchQuery.trim().length > 0;
    const searchHits = useMemo(() => searchLessons(allDays, searchQuery), [allDays, searchQuery]);

    return (
        <PageShell className="schedule-page-shell" data-no-page-swipe>
            {/* Header */}
            <header className="app-header">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="app-header-title">
                            {sessionMode ? messages.bottomNav.session : messages.schedule.title}
                        </h1>
                        <p className="app-header-subtitle">
                            {isStale ? (
                                <span className="flex items-center gap-1">
                                    <span className="theme-status-dot theme-status-dot-warning animate-pulse"></span>
                                    {messages.schedule.stalePrefix}
                                    {cacheAge ? ` (${formatBreak(cacheAge, messages)})` : ''}, {messages.schedule.staleRefreshing}
                                </span>
                            ) : (<>
                                {messages.schedule.updatedAt} {lastUpdateStr}
                                <span className="opacity-50 mx-1">•</span>
                                {cacheAgeMinutes < 60
                                    ? formatMessage(messages.schedule.minutesAgo, { value: cacheAgeMinutes })
                                    : formatMessage(messages.schedule.hoursAgo, { value: Math.floor(cacheAgeMinutes / 60) })}
                            </>
                            )}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={async () => {
                                const result = await downloadScheduleIcs();
                                if (result.success) {
                                    toast.success(messages.schedule.exportIcsSuccess);
                                } else {
                                    toast.error(result.error || messages.schedule.fallbackLoadError);
                                }
                            }}
                            className="btn btn-secondary schedule-export-btn"
                            title={messages.schedule.exportIcs}
                            type="button"
                        >
                            {messages.schedule.exportIcs}
                        </button>
                        <button
                            onClick={onRefresh}
                            disabled={refreshing}
                            className="refresh-btn"
                        >
                            <RefreshCw
                                className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`}
                                strokeWidth={2}
                                aria-hidden
                            />
                            {refreshing ? '' : messages.schedule.refresh}
                        </button>
                    </div>
                </div>
            </header>

            {/* Content */}
            <PageMain className="px-3 py-3">
                {!sessionMode && (
                    <div className="grades-search-bar mb-3">
                        <div className="grades-search-input-wrap">
                            <Search size={16} strokeWidth={2} aria-hidden className="grades-search-icon" />
                            <input
                                type="search"
                                className="grades-search-input"
                                placeholder={messages.schedule.searchPlaceholder}
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
                                    aria-label={messages.schedule.searchClear}
                                >
                                    <X size={14} strokeWidth={2} aria-hidden />
                                </button>
                            ) : null}
                        </div>
                    </div>
                )}

                {isSearching && (
                    <div className="space-y-3">
                        {searchHits.length === 0 ? (
                            <div className="empty-state">
                                <Search className="empty-state-icon" strokeWidth={2} aria-hidden />
                                <h3 className="empty-state-title">{messages.schedule.searchNoResults}</h3>
                            </div>
                        ) : (
                            searchHits.map((hit) => {
                                const slot = schedule.timeSlots[hit.slotIndex];
                                if (!slot) return null;
                                const noteKey = buildScheduleLessonNoteKey({
                                    dayKey: hit.dayKey,
                                    slot,
                                    lesson: hit.lesson,
                                    lessonIndex: hit.lessonIndex,
                                });
                                return (
                                    <div key={noteKey}>
                                        <div className="text-xs font-semibold mb-1 px-1 text-muted-fg">
                                            {dayNames[hit.dayKey]} · {slot.start}–{slot.end}
                                        </div>
                                        <LessonCardWithModal
                                            lesson={hit.lesson}
                                            timeSlot={slot}
                                            dayKey={hit.dayKey}
                                            currentDayKey={currentDayKey}
                                            nowMs={currentTimestamp}
                                            noteText={lessonNotes[noteKey] || ''}
                                            onNoteSave={(value) => saveLessonNote(noteKey, value)}
                                            onNoteDelete={() => deleteLessonNote(noteKey)}
                                            onCustomClick={(id) => {
                                                const cl = customLessons.find((item) => item.id === id);
                                                if (cl) openEditModal(cl);
                                            }}
                                        />
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {sessionMode && (
                    <SessionPanel
                        period={sessionPeriod}
                        periodLabel={academicContext?.activePeriodLabel ?? null}
                        exams={sessionExams}
                        nowMs={currentTimestamp}
                        language={language}
                    />
                )}

                {sessionMode && sessionSecondaryHeading && (
                    <div className="mb-3">
                        <h2 className="text-base font-semibold text-fg">{sessionSecondaryHeading}</h2>
                        {sessionSecondaryDescription && (
                            <p className="text-xs mt-1 text-muted-fg">{sessionSecondaryDescription}</p>
                        )}
                    </div>
                )}

                {sessionMode && (
                    <HideToggle
                        expanded={!secondaryCollapsed}
                        onToggle={toggleSecondaryCollapsed}
                        labelExpanded={messages.schedule.hideSecondaryHide}
                        labelCollapsed={messages.schedule.hideSecondaryShow}
                        sublabel={messages.schedule.hideSecondarySublabel}
                    />
                )}

                {sessionMode && secondaryCollapsed && (
                    <SessionDecoration language={language} />
                )}

                {!isSearching && (!sessionMode || !secondaryCollapsed) && (<>
                {/* №11: в каникулы/вне семестра «Сейчас/Далее» не показываем —
                    занятий нет, карточка по мёртвой сетке вводит в заблуждение */}
                {!sessionMode && !scheduleDormant && (
                    <NextUpCard schedule={schedule} parityMode={parityMode} semesterWeek={semesterWeek} />
                )}

                {/* Practice-vs-vacation disambiguation (plan-wide practice period only) */}
                {isPracticePeriod && (
                    <div className="card p-3 mb-3 animate-fadeInUp">
                        <p className="text-sm font-medium text-fg">{practiceUi.question}</p>
                        <p className="text-xs mt-1 text-muted-fg">{practiceUi.hint}</p>
                        <div className="parity-toggle mt-2.5">
                            <button
                                type="button"
                                className={`parity-btn ${practiceChoice !== 'vacation' ? 'active' : ''}`}
                                onClick={() => setPracticeChoice('practice')}
                            >
                                {practiceUi.practice}
                            </button>
                            <button
                                type="button"
                                className={`parity-btn ${practiceChoice === 'vacation' ? 'active' : ''}`}
                                onClick={() => setPracticeChoice('vacation')}
                            >
                                {practiceUi.vacation}
                            </button>
                        </div>
                    </div>
                )}

                {/* Week Info & Controls */}
                <div className="week-info-card animate-fadeInUp">
                    <div className="week-info-header">
                        <div className="week-number">
                            <span className="week-number-value">{effectiveWeekInfo.weekLabel}</span>
                            {!showAsVacation && weekDateRangeLabel ? (
                                <span className="week-date-range">{weekDateRangeLabel}</span>
                            ) : null}
                            <span className="week-semester">{effectiveWeekInfo.semesterLabel}</span>
                        </div>
                        {/* parityKnown=false (каникулы/нет контекста) → нейтральный
                            бейдж «—» вместо ложного «Числителя» (№11) */}
                        <div
                            className="week-type-badge"
                            data-type={weekInfo.parityKnown ? weekInfo.type : 'none'}
                            title={weekInfo.textTitle}
                            aria-label={weekInfo.textTitle}
                        >
                            {weekInfo.text}
                        </div>
                    </div>

                    {/* Controls Row */}
                    <div className="schedule-controls">
                        {/* Parity Toggle */}
                        <div className="parity-toggle-container">
                            <span className="parity-toggle-label">{messages.schedule.weekLabel}</span>
                            <div className="parity-toggle">
                                <button
                                    className={`parity-btn ${parityMode === 'num' ? 'active' : ''}`}
                                    onClick={() => handleParityModeChange('num')}
                                    title={messages.schedule.numeratorTitle}
                                    aria-label={messages.schedule.numeratorTitle}
                                >
                                    {messages.schedule.numeratorShort}
                                </button>
                                <button
                                    className={`parity-btn ${parityMode === 'den' ? 'active' : ''}`}
                                    onClick={() => handleParityModeChange('den')}
                                    title={messages.schedule.denominatorTitle}
                                    aria-label={messages.schedule.denominatorTitle}
                                >
                                    {messages.schedule.denominatorShort}
                                </button>
                            </div>
                        </div>

                        {/* View Mode Toggle */}
                        <div className="view-toggle">
                            {/* Notification Toggle */}
                            <button
                                className={`view-btn ${notifications.enabled ? 'active' : ''}`}
                                onClick={async () => {
                                    const result = await notifications.toggle();
                                    if (!result.success) {
                                        toast.error(getNotificationErrorMessage(result.reason));
                                    }
                                }}
                                title={notifications.enabled ? messages.schedule.notificationsEnabled : messages.schedule.notificationsEnable}
                                aria-label={notifications.enabled ? messages.schedule.notificationsEnabled : messages.schedule.notificationsEnable}
                            >
                                {notifications.enabled
                                    ? <Bell className="w-4 h-4" strokeWidth={2} aria-hidden />
                                    : <BellOff className="w-4 h-4" strokeWidth={2} aria-hidden />}
                            </button>
                            <button
                                className={`view-btn ${viewMode === 'horizontal' ? 'active' : ''}`}
                                onClick={() => setViewMode('horizontal')}
                                title={messages.schedule.viewByDays}
                                aria-label={messages.schedule.viewByDays}
                            >
                                <CalendarDays className="w-4 h-4" strokeWidth={2} aria-hidden />
                            </button>
                            <button
                                className={`view-btn ${viewMode === 'vertical' ? 'active' : ''}`}
                                onClick={() => setViewMode('vertical')}
                                title={messages.schedule.viewWholeWeek}
                                aria-label={messages.schedule.viewWholeWeek}
                            >
                                <List className="w-4 h-4" strokeWidth={2} aria-hidden />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Today Highlight (only in vertical mode) */}
                {viewMode === 'vertical' && (
                    <div className="today-highlight animate-fadeInUp" style={{ animationDelay: '50ms' }}>
                        <div className="today-title">
                            <span>{scheduleDormant ? '🏖️' : todayLessonsCount > 0 ? '📅' : '🎉'}</span>
                            <span>{messages.schedule.today} — {dayNames[currentDayKey]}</span>
                        </div>
                        <p className="today-info">
                            {scheduleDormant ? (
                                // №11: не «Выходной!», а честные «Каникулы» —
                                // семестр не идёт, занятий нет
                                <>{messages.schedule.vacationToday}</>
                            ) : todayLessonsCount > 0 ? (
                                <>
                                    {lessonCountLabel(todayLessonsCount)}
                                </>
                            ) : (
                                <>{messages.schedule.dayOff}</>
                            )}
                        </p>

                        {todayFilteredLessons.length > 0 && (
                            <div className="today-lessons-preview">
                                {todayFilteredLessons.slice(0, 3).map(({ slotIndex, timeSlot, lessons }) => (
                                    <div key={slotIndex} className="today-lesson-item">
                                        <span className="today-lesson-time">{timeSlot.start}</span>
                                        <span className="today-lesson-title">{lessons[0]?.title}</span>
                                    </div>
                                ))}
                                {todayFilteredLessons.length > 3 && (
                                    <div className="today-lesson-more">{formatMessage(messages.schedule.moreLessons, { count: todayFilteredLessons.length - 3 })}</div>
                                )}
                            </div>
                        )}
                    </div>
                )}



                {viewMode === 'vertical' && (
                    <motion.div
                        className="space-y-2"
                        initial="hidden"
                        animate="show"
                        variants={{
                            hidden: { opacity: 0 },
                            show: {
                                opacity: 1,
                                transition: {
                                    staggerChildren: 0.1
                                }
                            }
                        }}
                    >
                        {allDays.map((day) => {
                            const filteredLessons = day.lessons.map(slot =>
                                slot.filter(l => l.parity === 'all' || l.parity === parityMode)
                            );
                            const hasLessons = filteredLessons.some(slot => slot.length > 0);
                            const isToday = day.name === currentDayKey;
                            const lessonsCount = filteredLessons.reduce((acc, slot) => acc + slot.length, 0);

                            return (
                                <motion.div
                                    key={day.name}
                                    variants={{
                                        hidden: { opacity: 0, y: 20 },
                                        show: { opacity: 1, y: 0 }
                                    }}
                                    className={`day-card ${isToday ? 'today' : ''}`}
                                >
                                    <div className={`day-header ${isToday ? 'today' : ''}`}>
                                        <div className="day-name">
                                            {isToday && <span className="mr-2">📍</span>}
                                            {dayNames[day.name] || day.name}
                                        </div>
                                        <span className="day-count">
                                            {hasLessons ? lessonCountLabel(lessonsCount) : messages.schedule.dayOff}
                                        </span>
                                    </div>

                                    <div className="day-lessons">
                                        {hasLessons ? (
                                            schedule.timeSlots
                                                .map((timeSlot, slotIndex) => ({
                                                    slotIndex,
                                                    timeSlot,
                                                    lessons: filteredLessons[slotIndex] || [],
                                                }))
                                                .filter(item => item.lessons.length > 0)
                                                .map((entry, entryIndex, entries) => {
                                                    const internalBreaks = getInternalBreaks(entry.timeSlot);
                                                    const nextEntry = entries[entryIndex + 1];
                                                    const betweenBreak = nextEntry
                                                        ? getBetweenSlotBreak(entry.timeSlot, nextEntry.timeSlot)
                                                        : null;

                                                    return (
                                                        <div key={entry.slotIndex}>
                                                            <div className="flex gap-2 mb-2">
                                                                <div className="time-slot rounded-lg">
                                                                    <span className="time-start">{entry.timeSlot.start}</span>
                                                                    <span className="time-divider">—</span>
                                                                    <span className="time-end">{entry.timeSlot.end}</span>
                                                                </div>

                                                                <div className="flex-1">
                                                                    {entry.lessons.map((lesson, lessonIndex) => {
                                                                        const noteKey = buildScheduleLessonNoteKey({
                                                                            dayKey: day.name,
                                                                            slot: entry.timeSlot,
                                                                            lesson,
                                                                            lessonIndex,
                                                                        });
                                                                        return (
                                                                            <LessonCardWithModal
                                                                                key={noteKey}
                                                                                lesson={lesson}
                                                                                timeSlot={entry.timeSlot}
                                                                                dayKey={day.name}
                                                                                currentDayKey={currentDayKey}
                                                                                nowMs={currentTimestamp}
                                                                                noteText={lessonNotes[noteKey] || ''}
                                                                                onNoteSave={(value) => saveLessonNote(noteKey, value)}
                                                                                onNoteDelete={() => deleteLessonNote(noteKey)}
                                                                                onCustomClick={(id) => {
                                                                                    const cl = customLessons.find((item) => item.id === id);
                                                                                    if (cl) openEditModal(cl);
                                                                                }}
                                                                            />
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>

                                                            {internalBreaks.map((item, i) => (
                                                                <div key={`intra-${entry.slotIndex}-${i}`} className="break-row">
                                                                    <div className="break-line" />
                                                                    <span className="break-badge">{formatMessage(messages.schedule.breakLabel, { start: item.start, end: item.end, duration: formatBreak(item.minutes, messages) })}</span>
                                                                    <div className="break-line" />
                                                                </div>
                                                            ))}

                                                            {betweenBreak !== null && (
                                                                <div className="break-row">
                                                                    <div className="break-line" />
                                                                    <span className="break-badge">{formatMessage(messages.schedule.breakLabel, { start: betweenBreak.start, end: betweenBreak.end, duration: formatBreak(betweenBreak.minutes, messages) })}</span>
                                                                    <div className="break-line" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })
                                        ) : (
                                            <WeekendAnimation selectedDayLabel={dayNames[day.name]} />
                                        )}
                                    </div>
                                </motion.div>
                            );
                        })}
                    </motion.div>
                )}

                {/* Horizontal View (Day Selector + Lessons) */}
                {viewMode === 'horizontal' && (
                    <div className="horizontal-view animate-fadeInUp" {...horizontalSwipeHandlers}>
                        {/* Day Selector */}
                        <div className="day-selector" ref={daysContainerRef}>
                            {horizontalDays.map((day) => {
                                const isToday = day.name === currentDayKey;
                                const isSelected = day.name === selectedDay;
                                const filteredLessons = day.lessons.map(slot =>
                                    slot.filter(l => l.parity === 'all' || l.parity === parityMode)
                                );
                                const lessonsCount = filteredLessons.reduce((acc, slot) => acc + slot.length, 0);

                                return (
                                    <button
                                        key={day.name}
                                        data-day={day.name}
                                        className={`day-selector-btn ${isSelected ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                                        onClick={() => setSelectedDay(day.name)}
                                    >
                                        <span className="day-selector-name">{dayNamesShort[day.name]}</span>
                                        {lessonsCount > 0 ? (
                                            <span className="day-selector-count">{lessonsCount}</span>
                                        ) : (
                                            // Consistent count column: an empty day reads as "0 lessons",
                                            // not as a dash that looks like missing data.
                                            <span className="day-selector-free">0</span>
                                        )}
                                        {isToday && <span className="day-selector-dot" />}
                                    </button>
                                );
                            })}
                        </div>

                        {/* Selected Day Header */}
                        <div className="selected-day-header">
                            <h2 className="selected-day-title">
                                {selectedDay === currentDayKey && <span className="mr-2">📍</span>}
                                {dayNames[selectedDay]}
                            </h2>
                            <span className="selected-day-count">
                                {selectedDayData.count > 0
                                    ? lessonCountLabel(selectedDayData.count)
                                    : messages.schedule.dayOff
                                }
                            </span>
                        </div>

                        {/* Selected Day Lessons */}
                        <motion.div
                            key={selectedDay} // Re-animate when changing day
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            className={`selected-day-lessons ${selectedDayData.count === 0 ? 'selected-day-lessons--empty' : ''}`}
                        >
                            {selectedDayData.count > 0 ? (
                                selectedDayEntries.map((entry, entryIndex) => {
                                    const internalBreaks = getInternalBreaks(entry.timeSlot);
                                    const nextEntry = selectedDayEntries[entryIndex + 1];
                                    const betweenBreak = nextEntry
                                        ? getBetweenSlotBreak(entry.timeSlot, nextEntry.timeSlot)
                                        : null;

                                    return (
                                        <div key={entry.slotIndex}>
                                            <div className="flex gap-2 mb-2">
                                                <div className="time-slot rounded-lg">
                                                    <span className="time-start">{entry.timeSlot.start}</span>
                                                    <span className="time-divider">—</span>
                                                    <span className="time-end">{entry.timeSlot.end}</span>
                                                </div>

                                                <div className="flex-1">
                                                    {entry.lessons.map((lesson, lessonIndex) => {
                                                        const noteKey = buildScheduleLessonNoteKey({
                                                            dayKey: selectedDay,
                                                            slot: entry.timeSlot,
                                                            lesson,
                                                            lessonIndex,
                                                        });
                                                        return (
                                                            <LessonCardWithModal
                                                                key={noteKey}
                                                                lesson={lesson}
                                                                timeSlot={entry.timeSlot}
                                                                dayKey={selectedDay}
                                                                currentDayKey={currentDayKey}
                                                                nowMs={currentTimestamp}
                                                                noteText={lessonNotes[noteKey] || ''}
                                                                onNoteSave={(value) => saveLessonNote(noteKey, value)}
                                                                onNoteDelete={() => deleteLessonNote(noteKey)}
                                                                onCustomClick={(id) => {
                                                                    const cl = customLessons.find((item) => item.id === id);
                                                                    if (cl) openEditModal(cl);
                                                                }}
                                                            />
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            {internalBreaks.map((item, i) => (
                                                <div key={`intra-h-${entry.slotIndex}-${i}`} className="break-row">
                                                    <div className="break-line" />
                                                    <span className="break-badge">{formatMessage(messages.schedule.breakLabel, { start: item.start, end: item.end, duration: formatBreak(item.minutes, messages) })}</span>
                                                    <div className="break-line" />
                                                </div>
                                            ))}

                                            {betweenBreak !== null && (
                                                <div className="break-row">
                                                    <div className="break-line" />
                                                    <span className="break-badge">{formatMessage(messages.schedule.breakLabel, { start: betweenBreak.start, end: betweenBreak.end, duration: formatBreak(betweenBreak.minutes, messages) })}</span>
                                                    <div className="break-line" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })
                            ) : (
                                <WeekendAnimation selectedDayLabel={dayNames[selectedDay]} />
                            )}

                            {ENABLE_PERSONAL_CUSTOM_LESSONS && (
                                <button
                                    onClick={() => openAddModal(DAY_KEYS.indexOf(selectedDay))}
                                    className="add-lesson-btn"
                                >
                                    <span>+</span>
                                    <span>{language === 'en' ? 'Add lesson' : language === 'kz' ? 'Сабақ қосу' : 'Добавить пару'}</span>
                                </button>
                            )}
                        </motion.div>
                    </div>
                )}
                </>)}

                {!isSearching && <WeatherMoodCard />}
            </PageMain>

            {/* Custom Lesson Modal */}
            {ENABLE_PERSONAL_CUSTOM_LESSONS && (
                <AddLessonModal
                    isOpen={addModalOpen}
                    onClose={closeModal}
                    onSaved={refreshCustomLessons}
                    timeSlots={schedule.timeSlots}
                    defaultDayIndex={addModalDefaultDay}
                    editLesson={editingLesson}
                />
            )}
        </PageShell>
    );
}
