import type { CustomLesson } from '@/lib/custom-lessons';
import type { TimeSlot } from '@/lib/types';
import { MINUTES, type LessonFormState } from './types';

export function toMinutes(value: string): number | null {
    const match = value.match(/^(\d{2}):(\d{2})$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

export function parseTimeParts(value: string): { hour: string; minute: string } {
    const match = value.match(/^(\d{2}):(\d{2})$/);
    if (!match) return { hour: '', minute: '' };
    return { hour: match[1], minute: match[2] };
}

export function composeTime(hour: string, minute: string): string {
    if (!hour || !minute) return '';
    return `${hour}:${minute}`;
}

function mod(value: number, base: number): number {
    return ((value % base) + base) % base;
}

export function shiftTimePart(value: string, part: 'hour' | 'minute', delta: number, fallback: string): string {
    const current = value || fallback;
    const parsed = parseTimeParts(current);
    const hour = parsed.hour || fallback.slice(0, 2);
    const minute = parsed.minute || fallback.slice(3, 5);

    if (part === 'hour') {
        const nextHour = String(mod(Number(hour) + delta, 24)).padStart(2, '0');
        return composeTime(nextHour, minute);
    }

    const minuteIndex = Math.max(0, MINUTES.indexOf(minute));
    const nextMinute = MINUTES[mod(minuteIndex + delta, MINUTES.length)];
    return composeTime(hour, nextMinute);
}

export function getClosestTimeSlotIndex(startTime: string, timeSlots: TimeSlot[]): number {
    const target = toMinutes(startTime);
    if (target === null || timeSlots.length === 0) return 0;

    let bestIndex = 0;
    let bestDiff = Number.POSITIVE_INFINITY;

    timeSlots.forEach((slot, i) => {
        const slotStart = toMinutes(slot.start);
        if (slotStart === null) return;
        const diff = Math.abs(slotStart - target);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestIndex = i;
        }
    });

    return bestIndex;
}

export function createInitialFormState(editLesson: CustomLesson | null, defaultDayIndex: number): LessonFormState {
    if (editLesson) {
        return {
            title: editLesson.title,
            type: editLesson.type,
            teacher: editLesson.teacher,
            room: editLesson.room,
            dayIndex: editLesson.dayIndex,
            timeSlotIndex: editLesson.timeSlotIndex,
            timeMode: editLesson.customStart && editLesson.customEnd ? 'custom' : 'slot',
            customStart: editLesson.customStart ?? '',
            customEnd: editLesson.customEnd ?? '',
            parity: editLesson.parity,
        };
    }

    return {
        title: '',
        type: 'srsp',
        teacher: '',
        room: '',
        dayIndex: defaultDayIndex,
        timeSlotIndex: 0,
        timeMode: 'slot',
        customStart: '',
        customEnd: '',
        parity: 'all',
    };
}
