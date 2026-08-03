import { describe, expect, it } from 'vitest';
import type { PlatonusGradesData } from '@/lib/api';
import type { Schedule } from '@/lib/types';
import {
    computeGradesStats,
    computeScheduleStats,
    scoreToLetter,
} from './stats-helpers';

describe('scoreToLetter', () => {
    it('maps scores to coarse letter bands', () => {
        expect(scoreToLetter(95)).toBe('A');
        expect(scoreToLetter(90)).toBe('A');
        expect(scoreToLetter(89)).toBe('B');
        expect(scoreToLetter(75)).toBe('B');
        expect(scoreToLetter(60)).toBe('C');
        expect(scoreToLetter(59)).toBe('D');
        expect(scoreToLetter(50)).toBe('D');
        expect(scoreToLetter(49)).toBe('F');
        expect(scoreToLetter(0)).toBe('F');
    });
});

describe('computeScheduleStats', () => {
    function lesson(title: string, teacher: string, room: string) {
        return {
            title,
            type: null,
            teacher,
            room,
            faculty: null,
            parity: 'all' as const,
            period: null,
        };
    }

    const schedule: Schedule = {
        meta: { tz: 'Asia/Almaty', parsedAt: '2026-05-20', userId: 'u1' },
        timeSlots: [],
        days: [
            {
                name: 'mon',
                lessons: [
                    [lesson('Math', 'Ivanov', '301')],
                    [lesson('Math', 'Ivanov', '301')],
                    [lesson('Physics', 'Petrov', '205')],
                ],
            },
            {
                name: 'tue',
                lessons: [[lesson('Chemistry', 'Sidorov', '301')]],
            },
            {
                name: 'wed',
                lessons: [[]],
            },
        ],
        cachedAt: '',
        expiresAt: '',
    };

    it('counts unique subjects, total lessons, per-day load and tops', () => {
        const stats = computeScheduleStats(schedule);
        expect(stats).not.toBeNull();
        if (!stats) return;

        expect(stats.totalSubjects).toBe(3);
        expect(stats.totalLessonsPerWeek).toBe(4);
        expect(stats.perDay).toEqual([
            { day: 'mon', count: 3 },
            { day: 'tue', count: 1 },
            { day: 'wed', count: 0 },
        ]);

        // Ivanov has 2 lessons, the other two have 1 each.
        expect(stats.topTeachers[0]).toEqual({ name: 'Ivanov', count: 2 });
        // Room 301 appears 3 times (mon x2 + tue x1).
        expect(stats.topRooms[0]).toEqual({ room: '301', count: 3 });
    });

    it('returns null for a fully empty schedule', () => {
        const empty: Schedule = {
            meta: { tz: '', parsedAt: '', userId: '' },
            timeSlots: [],
            days: [{ name: 'mon', lessons: [] }],
            cachedAt: '',
            expiresAt: '',
        };
        expect(computeScheduleStats(empty)).toBeNull();
    });
});

describe('computeGradesStats', () => {
    const seasonLabels = { autumn: 'Autumn', spring: 'Spring' };

    function subject(name: string, total: string, rating = '') {
        return {
            name,
            rk1: '',
            rk2: '',
            rating,
            exam: '',
            total,
        };
    }

    it('aggregates numeric totals into average / letters / top / worst', () => {
        const data: PlatonusGradesData = {
            meta: {
                parsedAt: '2026-05-20',
                year: 2025,
                semester: 2,
                totalSubjects: 4,
                gpa: 3.5,
            },
            subjects: [
                subject('Math', '95'),
                subject('Physics', '72'),
                subject('Chemistry', '55'),
                // No total but has rating — picked up via fallback.
                subject('History', '', '80'),
            ],
        };

        const stats = computeGradesStats(data, seasonLabels);
        expect(stats).not.toBeNull();
        if (!stats) return;

        expect(stats.totalSubjects).toBe(4);
        expect(stats.averageScore).toBeCloseTo((95 + 72 + 55 + 80) / 4, 2);
        expect(stats.topSubjects[0]).toEqual({ name: 'Math', score: 95 });
        expect(stats.worstSubjects[0]).toEqual({ name: 'Chemistry', score: 55 });
        expect(stats.excellentCount).toBe(1); // only Math is >= 90
        const letters = Object.fromEntries(
            stats.letterDistribution.map((entry) => [entry.letter, entry.count])
        );
        // 95 -> A, 80 -> B (>=75), 72 -> C (>=60), 55 -> D (>=50).
        expect(letters.A).toBe(1);
        expect(letters.B).toBe(1);
        expect(letters.C).toBe(1);
        expect(letters.D).toBe(1);
        expect(letters.F).toBe(0);
        expect(stats.semesterLabel).toContain('Spring');
    });

    it('returns null when no subject has a numeric score', () => {
        const data: PlatonusGradesData = {
            meta: { parsedAt: '', year: 2024, semester: 1, totalSubjects: 1 },
            subjects: [subject('Empty', '-')],
        };
        expect(computeGradesStats(data, seasonLabels)).toBeNull();
    });

    it('returns null for empty/missing payload', () => {
        expect(computeGradesStats(null, seasonLabels)).toBeNull();
    });
});
