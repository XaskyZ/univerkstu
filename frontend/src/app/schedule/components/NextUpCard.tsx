'use client';

import { useEffect, useMemo, useState } from 'react';
import type { Schedule, Lesson, TimeSlot } from '@/lib/types';
import { useLanguage, formatMessage } from '@/lib/language-context';
import { getCurrentDayIndex, toMinutes } from '../utils/time-helpers';
import { isLessonPeriodActive } from '../utils/lesson-period';

interface NextUpCardProps {
    schedule: Schedule;
    /**
     * Filter applied to lessons before picking the current/next one. Mirrors the
     * `parityMode` used by ScheduleView so the highlight stays in sync with what
     * the user actually sees below.
     */
    parityMode: 'num' | 'den';
    /**
     * Номер учебной недели из академ-контекста. Нужен, чтобы пара с периодом
     * действия («1-8 неделя», «с 01.09 по 15.10») не светилась в «Сейчас/Далее»
     * вне своего периода (№10 логик-аудита). null — неделя неизвестна,
     * недельные периоды тогда не фильтруются (консервативно).
     */
    semesterWeek?: number | null;
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;

// Highlight an upcoming lesson up to this many minutes in advance.
const SOON_THRESHOLD_MIN = 90;

interface SlotEntry {
    lesson: Lesson;
    slot: TimeSlot;
    startMin: number;
    endMin: number;
}

/**
 * Highlights the lesson the user most likely cares about right now:
 *   - if a class is in progress → "Now: {title}, until {time}"
 *   - else if a class starts within 90 min → "In {N} min: {title} in {room}"
 *   - else if there are still future classes today → "Next today: {time} — {title}"
 *   - else → render nothing
 *
 * The component re-evaluates every minute so the relative time stays accurate
 * without leaning on the parent's clock.
 */
export default function NextUpCard({ schedule, parityMode, semesterWeek = null }: NextUpCardProps) {
    const { messages, language } = useLanguage();

    const [tick, setTick] = useState<number>(() => Date.now());
    useEffect(() => {
        // 60s is enough resolution for "in N minutes" copy; it also matches
        // SessionPanel's cadence, so we don't fan-out timers.
        const interval = window.setInterval(() => setTick(Date.now()), 60_000);
        return () => window.clearInterval(interval);
    }, []);

    const todayKey = DAY_KEYS[getCurrentDayIndex()];

    const todayEntries = useMemo<SlotEntry[]>(() => {
        const day = schedule.days.find((d) => d.name === todayKey);
        if (!day) return [];
        const entries: SlotEntry[] = [];
        schedule.timeSlots.forEach((slot, slotIndex) => {
            const lessons = day.lessons[slotIndex] || [];
            const startMin = toMinutes(slot.start);
            const endMin = toMinutes(slot.end);
            if (startMin === null || endMin === null) return;
            for (const lesson of lessons) {
                if (lesson.parity !== 'all' && lesson.parity !== parityMode) continue;
                // №10: пара вне своего периода действия не должна попадать
                // в «Сейчас/Далее».
                if (!isLessonPeriodActive(lesson.period, { now: new Date(tick), semesterWeek })) continue;
                entries.push({ lesson, slot, startMin, endMin });
            }
        });
        entries.sort((a, b) => a.startMin - b.startMin);
        return entries;
        // `tick` в зависимостях: активность периода зависит от текущей даты,
        // пересборка раз в минуту дёшева.
    }, [schedule.days, schedule.timeSlots, todayKey, parityMode, tick, semesterWeek]);

    if (todayEntries.length === 0) return null;

    const now = new Date(tick);
    const currentMin = now.getHours() * 60 + now.getMinutes();

    const currentLesson = todayEntries.find(
        (entry) => currentMin >= entry.startMin && currentMin < entry.endMin,
    );
    const upcomingLesson = !currentLesson
        ? todayEntries.find((entry) => entry.startMin > currentMin)
        : null;

    // Decide which mode to display. Returning `null` causes the component to
    // render nothing, matching the spec when there's nothing meaningful left
    // today (e.g. evening after the last class).
    let mode: 'now' | 'soon' | 'later' | null = null;
    let target: SlotEntry | null = null;
    let minutesUntil = 0;

    if (currentLesson) {
        mode = 'now';
        target = currentLesson;
    } else if (upcomingLesson) {
        minutesUntil = upcomingLesson.startMin - currentMin;
        target = upcomingLesson;
        mode = minutesUntil <= SOON_THRESHOLD_MIN ? 'soon' : 'later';
    }

    if (!mode || !target) return null;

    const ui = messages.schedule.nextUp;
    const lesson = target.lesson;
    const slot = target.slot;
    const roomLabel = lesson.room
        ? formatMessage(ui.roomTemplate, { room: lesson.room })
        : null;

    let badgeText: string;
    let primaryText: string;
    let metaText: string;

    if (mode === 'now') {
        badgeText = ui.badgeNow;
        primaryText = formatMessage(ui.nowTitle, { title: lesson.title });
        metaText = formatMessage(ui.nowMeta, { end: slot.end });
    } else if (mode === 'soon') {
        badgeText = ui.badgeSoon;
        primaryText = formatMessage(ui.soonTitle, {
            minutes: minutesUntil,
            title: lesson.title,
        });
        metaText = roomLabel
            ? formatMessage(ui.soonMetaWithRoom, { start: slot.start, room: lesson.room ?? '' })
            : formatMessage(ui.soonMetaTimeOnly, { start: slot.start });
    } else {
        badgeText = ui.badgeLater;
        primaryText = formatMessage(ui.laterTitle, {
            start: slot.start,
            title: lesson.title,
        });
        metaText = roomLabel
            ? formatMessage(ui.laterMetaWithRoom, { end: slot.end, room: lesson.room ?? '' })
            : formatMessage(ui.laterMetaTimeOnly, { end: slot.end });
    }

    const teacherText = lesson.teacher?.trim() || null;
    // Aria label collapses the visible bits for screen readers — easier to scan
    // than the gradient/icon layout used visually.
    const ariaLabel = [badgeText, primaryText, metaText, teacherText, language]
        .filter(Boolean)
        .join(' • ');

    return (
        <section className="card next-up-card" aria-label={ariaLabel}>
            <div className="next-up-row">
                <span
                    className={`next-up-badge next-up-badge-${mode}`}
                    aria-hidden
                >
                    {badgeText}
                </span>
                <div className="next-up-body">
                    <p className="next-up-title">{primaryText}</p>
                    <p className="next-up-meta">{metaText}</p>
                    {teacherText && (
                        <p className="next-up-teacher">{teacherText}</p>
                    )}
                </div>
            </div>
        </section>
    );
}
