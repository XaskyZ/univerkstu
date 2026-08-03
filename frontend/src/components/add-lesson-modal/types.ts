import type { CustomLesson, CustomLessonType } from '@/lib/custom-lessons';

export const LESSON_TYPES: CustomLessonType[] = ['srsp', 'curator_hour', 'other'];
export const MINUTES = ['00', '05', '10', '15', '20', '25', '30', '35', '40', '45', '50', '55'];

export interface LessonFormState {
    title: string;
    type: CustomLesson['type'];
    teacher: string;
    room: string;
    dayIndex: number;
    timeSlotIndex: number;
    timeMode: 'slot' | 'custom';
    customStart: string;
    customEnd: string;
    parity: 'all' | 'num' | 'den';
}
