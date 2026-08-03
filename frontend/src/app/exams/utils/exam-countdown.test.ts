import { describe, it, expect } from 'vitest';
import type { Exam } from '@/lib/types';
import {
    classifySeverity,
    findNextExam,
    formatCountdown,
    getExamCountdownUi,
    msToParts,
} from './exam-countdown';

function makeExam(iso: string | null, subject = 'Math'): Exam {
    return {
        subject,
        teacher: 'T',
        type: 'exam',
        format: 'oral',
        building: 'A',
        room: '101',
        locationRaw: 'A-101',
        groupType: 'lecture',
        datetime: iso
            ? { date: '01.01.2026', time: '10:00', displayDate: '01.01', displayTime: '10:00', iso }
            : null,
    };
}

describe('msToParts', () => {
    it('returns zeros for non-positive ms', () => {
        expect(msToParts(0)).toEqual({ days: 0, hours: 0, minutes: 0 });
        expect(msToParts(-1000)).toEqual({ days: 0, hours: 0, minutes: 0 });
    });
    it('splits into days/hours/minutes correctly', () => {
        const ms = (2 * 24 * 60 + 3 * 60 + 15) * 60_000;
        expect(msToParts(ms)).toEqual({ days: 2, hours: 3, minutes: 15 });
    });
    it('handles sub-day intervals', () => {
        expect(msToParts(90 * 60_000)).toEqual({ days: 0, hours: 1, minutes: 30 });
    });
});

describe('classifySeverity', () => {
    it('imminent within 24h', () => {
        expect(classifySeverity(60 * 60_000)).toBe('imminent');
        expect(classifySeverity(24 * 60 * 60_000)).toBe('imminent');
    });
    it('soon within 3 days', () => {
        expect(classifySeverity(2 * 24 * 60 * 60_000)).toBe('soon');
    });
    it('far otherwise', () => {
        expect(classifySeverity(7 * 24 * 60 * 60_000)).toBe('far');
    });
});

describe('findNextExam', () => {
    const now = Date.parse('2026-05-20T10:00:00Z');

    it('returns null on empty list', () => {
        expect(findNextExam([], now)).toBeNull();
    });
    it('skips exams without datetime', () => {
        expect(findNextExam([makeExam(null)], now)).toBeNull();
    });
    it('skips exams in the past', () => {
        expect(findNextExam([makeExam('2026-05-19T10:00:00Z')], now)).toBeNull();
    });
    it('picks the earliest future exam', () => {
        const exams = [
            makeExam('2026-06-10T10:00:00Z', 'Later'),
            makeExam('2026-05-28T09:00:00Z', 'Closer'),
            makeExam('2026-05-19T10:00:00Z', 'Past'),
        ];
        const next = findNextExam(exams, now);
        expect(next?.exam.subject).toBe('Closer');
        expect(next?.severity).toBe('far');
    });
    it('classifies imminent when within 24h', () => {
        const exams = [makeExam('2026-05-20T20:00:00Z', 'Soon')];
        const next = findNextExam(exams, now);
        expect(next?.severity).toBe('imminent');
    });
    it('ignores malformed iso', () => {
        const exam = makeExam('not-a-date');
        expect(findNextExam([exam], now)).toBeNull();
    });
});

describe('getExamCountdownUi', () => {
    it('returns ru by default', () => {
        const ui = getExamCountdownUi('ru');
        expect(ui.inLabel).toBe('через');
        expect(ui.daysShort).toBe('дн');
    });
    it('returns kz strings', () => {
        const ui = getExamCountdownUi('kz');
        expect(ui.daysShort).toBe('күн');
    });
    it('returns en strings', () => {
        const ui = getExamCountdownUi('en');
        expect(ui.inLabel).toBe('in');
    });
});

describe('formatCountdown', () => {
    const ui = getExamCountdownUi('en');
    it('formats sub-hour interval', () => {
        expect(formatCountdown({ days: 0, hours: 0, minutes: 30 }, ui)).toBe('30 m');
    });
    it('formats hour interval with hours token', () => {
        expect(formatCountdown({ days: 0, hours: 2, minutes: 15 }, ui)).toBe('2 h 15 m');
    });
    it('formats day interval with all tokens', () => {
        expect(formatCountdown({ days: 3, hours: 4, minutes: 5 }, ui)).toBe('3 d 4 h 5 m');
    });
});
