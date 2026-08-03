import { describe, it, expect } from 'vitest';
import {
    toMinutes,
    parseTimeParts,
    composeTime,
    shiftTimePart,
    getClosestTimeSlotIndex,
    createInitialFormState,
} from './utils';
import { MINUTES } from './types';
import type { TimeSlot } from '@/lib/types';
import type { CustomLesson } from '@/lib/custom-lessons';

const slot = (start: string, end: string): TimeSlot => ({
    start,
    end,
    raw: `${start}-${end}`,
});

describe('toMinutes', () => {
    it('parses HH:MM into total minutes', () => {
        expect(toMinutes('00:00')).toBe(0);
        expect(toMinutes('09:30')).toBe(570);
        expect(toMinutes('23:59')).toBe(23 * 60 + 59);
    });

    it('returns null for malformed', () => {
        expect(toMinutes('9:30')).toBe(null);
        expect(toMinutes('')).toBe(null);
        expect(toMinutes('garbage')).toBe(null);
    });
});

describe('parseTimeParts', () => {
    it('returns separated hour/minute strings', () => {
        expect(parseTimeParts('09:30')).toEqual({ hour: '09', minute: '30' });
        expect(parseTimeParts('23:00')).toEqual({ hour: '23', minute: '00' });
    });

    it('returns empties on malformed input', () => {
        expect(parseTimeParts('9:30')).toEqual({ hour: '', minute: '' });
        expect(parseTimeParts('')).toEqual({ hour: '', minute: '' });
        expect(parseTimeParts('25-00')).toEqual({ hour: '', minute: '' });
    });
});

describe('composeTime', () => {
    it('joins valid hour/minute with colon', () => {
        expect(composeTime('09', '30')).toBe('09:30');
        expect(composeTime('00', '00')).toBe('00:00');
    });

    it('returns empty string when either part missing', () => {
        expect(composeTime('', '30')).toBe('');
        expect(composeTime('09', '')).toBe('');
        expect(composeTime('', '')).toBe('');
    });
});

describe('shiftTimePart', () => {
    it('increments hour wrapping 23 → 00 (mod 24)', () => {
        expect(shiftTimePart('23:30', 'hour', 1, '00:00')).toBe('00:30');
        expect(shiftTimePart('00:30', 'hour', -1, '00:00')).toBe('23:30');
    });

    it('decrements hour with negative delta', () => {
        expect(shiftTimePart('10:00', 'hour', -3, '00:00')).toBe('07:00');
    });

    it('handles large deltas via modular arithmetic', () => {
        expect(shiftTimePart('12:00', 'hour', 25, '00:00')).toBe('13:00');
        expect(shiftTimePart('12:00', 'hour', -25, '00:00')).toBe('11:00');
    });

    it('shifts minute through the MINUTES array', () => {
        expect(shiftTimePart('09:00', 'minute', 1, '09:00')).toBe(`09:${MINUTES[1]}`);
        expect(shiftTimePart('09:00', 'minute', -1, '09:00')).toBe(`09:${MINUTES[MINUTES.length - 1]}`);
    });

    it('snaps to closest known minute when input is off-grid', () => {
        // '09:07' is not in MINUTES — `indexOf` returns -1 then `Math.max(0, -1) = 0` ⇒ treats as index 0 = '00'.
        // Then +1 ⇒ index 1 ⇒ '05'.
        expect(shiftTimePart('09:07', 'minute', 1, '09:00')).toBe(`09:${MINUTES[1]}`);
    });

    it('uses fallback when value is empty', () => {
        expect(shiftTimePart('', 'hour', 1, '08:00')).toBe('09:00');
        expect(shiftTimePart('', 'minute', 1, '08:00')).toBe(`08:${MINUTES[1]}`);
    });

    it('uses fallback parts when value parses partially', () => {
        // Malformed value with non-empty fallback: each missing part filled from fallback slice.
        expect(shiftTimePart('garbage', 'hour', 0, '14:30')).toBe('14:30');
    });
});

describe('getClosestTimeSlotIndex', () => {
    it('returns 0 when timeSlots is empty', () => {
        expect(getClosestTimeSlotIndex('09:00', [])).toBe(0);
    });

    it('returns 0 when startTime is malformed', () => {
        expect(getClosestTimeSlotIndex('garbage', [slot('09:00', '10:00')])).toBe(0);
    });

    it('returns exact match index when slot start matches', () => {
        const slots = [slot('08:00', '09:00'), slot('10:00', '11:00'), slot('12:00', '13:00')];
        expect(getClosestTimeSlotIndex('10:00', slots)).toBe(1);
    });

    it('picks the slot with smallest absolute difference', () => {
        const slots = [slot('08:00', '09:00'), slot('10:00', '11:00'), slot('12:00', '13:00')];
        expect(getClosestTimeSlotIndex('09:50', slots)).toBe(1); // 10 mins away from 10:00 vs 110 from 08:00
        expect(getClosestTimeSlotIndex('11:01', slots)).toBe(2); // 61 from 10:00 vs 59 from 12:00 → 12 wins
    });

    it('ties go to the first encountered (earliest)', () => {
        // 09:00 is equidistant from 08:00 (60) and 10:00 (60) — first one wins.
        const slots = [slot('08:00', '09:00'), slot('10:00', '11:00')];
        expect(getClosestTimeSlotIndex('09:00', slots)).toBe(0);
    });

    it('ignores slots with malformed start', () => {
        const slots = [
            { start: 'bad', end: 'also-bad', raw: 'x' } as TimeSlot,
            slot('10:00', '11:00'),
        ];
        expect(getClosestTimeSlotIndex('10:00', slots)).toBe(1);
    });
});

describe('createInitialFormState', () => {
    it('returns default state when editLesson is null', () => {
        const state = createInitialFormState(null, 3);
        expect(state).toEqual({
            title: '',
            type: 'srsp',
            teacher: '',
            room: '',
            dayIndex: 3,
            timeSlotIndex: 0,
            timeMode: 'slot',
            customStart: '',
            customEnd: '',
            parity: 'all',
        });
    });

    it('mirrors the editLesson fields when present, slot mode when no custom times', () => {
        const lesson: CustomLesson = {
            id: 'x',
            title: 'My SRSP',
            type: 'srsp',
            teacher: 'Иванов',
            room: '101',
            dayIndex: 2,
            timeSlotIndex: 4,
            customStart: undefined,
            customEnd: undefined,
            parity: 'num',
            createdAt: Date.now(),
        };

        const state = createInitialFormState(lesson, 0);
        expect(state).toEqual({
            title: 'My SRSP',
            type: 'srsp',
            teacher: 'Иванов',
            room: '101',
            dayIndex: 2,
            timeSlotIndex: 4,
            timeMode: 'slot',
            customStart: '',
            customEnd: '',
            parity: 'num',
        });
    });

    it('uses custom timeMode when both customStart and customEnd are present', () => {
        const lesson: CustomLesson = {
            id: 'x',
            title: 'Custom',
            type: 'other',
            teacher: '',
            room: '',
            dayIndex: 1,
            timeSlotIndex: 0,
            customStart: '11:30',
            customEnd: '12:15',
            parity: 'all',
            createdAt: Date.now(),
        };

        const state = createInitialFormState(lesson, 0);
        expect(state.timeMode).toBe('custom');
        expect(state.customStart).toBe('11:30');
        expect(state.customEnd).toBe('12:15');
    });

    it('falls back to slot mode if only one of customStart/customEnd is set', () => {
        const lesson: CustomLesson = {
            id: 'x',
            title: 'Half custom',
            type: 'curator_hour',
            teacher: '',
            room: '',
            dayIndex: 0,
            timeSlotIndex: 1,
            customStart: '11:30',
            customEnd: undefined,
            parity: 'all',
            createdAt: Date.now(),
        };
        expect(createInitialFormState(lesson, 0).timeMode).toBe('slot');
        expect(createInitialFormState(lesson, 0).customStart).toBe('11:30');
        expect(createInitialFormState(lesson, 0).customEnd).toBe('');
    });
});
