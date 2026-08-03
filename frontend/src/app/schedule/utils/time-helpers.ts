import { formatMessage, type useLanguage } from '@/lib/language-context';
import type { TimeSlot, Lesson } from '@/lib/types';

export function toMinutes(value: string): number | null {
    const match = value.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

export function getBreakDurationMinutes(from: string, to: string): number | null {
    const fromMin = toMinutes(from);
    const toMin = toMinutes(to);
    if (fromMin === null || toMin === null) return null;
    const diff = toMin - fromMin;
    if (diff <= 0) return null;
    return diff;
}

export function formatBreak(
    minutes: number,
    messages: ReturnType<typeof useLanguage>['messages'],
): string {
    if (minutes < 60) return formatMessage(messages.schedule.breakMinutes, { value: minutes });
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0
        ? formatMessage(messages.schedule.breakHours, { value: h })
        : formatMessage(messages.schedule.breakHoursMinutes, { hours: h, minutes: m });
}

export function getSlotSegments(slot: TimeSlot): Array<{ start: string; end: string }> {
    if (slot.segments && slot.segments.length > 0) return slot.segments;
    return [{ start: slot.start, end: slot.end }];
}

export function getInternalBreaks(slot: TimeSlot): Array<{ start: string; end: string; minutes: number }> {
    const segments = getSlotSegments(slot);
    const breaks: Array<{ start: string; end: string; minutes: number }> = [];

    for (let i = 0; i < segments.length - 1; i++) {
        const current = segments[i];
        const next = segments[i + 1];
        const minutes = getBreakDurationMinutes(current.end, next.start);
        if (minutes !== null) {
            breaks.push({ start: current.end, end: next.start, minutes });
        }
    }

    return breaks;
}

export function getBetweenSlotBreak(
    currentSlot: TimeSlot,
    nextSlot: TimeSlot,
): { start: string; end: string; minutes: number } | null {
    const currentSegments = getSlotSegments(currentSlot);
    const nextSegments = getSlotSegments(nextSlot);
    const currentEnd = currentSegments[currentSegments.length - 1].end;
    const nextStart = nextSegments[0].start;
    const minutes = getBreakDurationMinutes(currentEnd, nextStart);
    if (minutes === null) return null;
    return { start: currentEnd, end: nextStart, minutes };
}

/** 0 = понедельник, 6 = воскресенье */
export function getCurrentDayIndex(): number {
    const jsDay = new Date().getDay();
    return jsDay === 0 ? 6 : jsDay - 1;
}

export function parseDateOnly(value: string | null): Date | null {
    if (!value) return null;
    const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
        return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
    }

    const ruMatch = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (ruMatch) {
        return new Date(Number(ruMatch[3]), Number(ruMatch[2]) - 1, Number(ruMatch[1]));
    }

    return null;
}

export function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

export function formatCompactDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = String(date.getFullYear()).slice(-2);
    return `${day}.${month}.${year}`;
}

export function getLessonDisplayRange(lesson: Lesson, slot: TimeSlot): { start: string; end: string } {
    if (lesson.customTime?.start && lesson.customTime?.end) {
        return { start: lesson.customTime.start, end: lesson.customTime.end };
    }
    return { start: slot.start, end: slot.end };
}

export function getCurrentLessonProgress(
    nowMs: number,
    dayKey: string,
    currentDayKey: string,
    lesson: Lesson,
    slot: TimeSlot,
): {
    ratio: number;
    elapsedMinutes: number;
    remainingMinutes: number;
    totalMinutes: number;
    /** @deprecated Use elapsedMinutes/totalMinutes and format with localized unit at the call site. */
    label: string;
} | null {
    if (dayKey !== currentDayKey) return null;

    const { start, end } = getLessonDisplayRange(lesson, slot);
    const startMinutes = toMinutes(start);
    const endMinutes = toMinutes(end);
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) return null;

    const now = new Date(nowMs);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    if (currentMinutes < startMinutes || currentMinutes >= endMinutes) return null;

    const totalMinutes = endMinutes - startMinutes;
    const elapsedMinutes = Math.max(0, currentMinutes - startMinutes);
    const remainingMinutes = Math.max(0, endMinutes - currentMinutes);
    const ratio = Math.min(1, Math.max(0, elapsedMinutes / totalMinutes));

    return {
        ratio,
        elapsedMinutes,
        remainingMinutes,
        totalMinutes,
        label: `${elapsedMinutes} / ${totalMinutes} мин`,
    };
}
