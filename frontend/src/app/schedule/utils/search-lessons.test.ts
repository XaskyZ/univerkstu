import { describe, it, expect } from 'vitest';
import { searchLessons, lessonMatchesQuery } from './search-lessons';
import type { Lesson } from '@/lib/types';

function makeLesson(over: Partial<Lesson>): Lesson {
    return {
        title: '',
        type: null,
        teacher: '',
        room: null,
        faculty: null,
        parity: 'all',
        period: null,
        ...over,
    };
}

const physics = makeLesson({ title: 'Физика', type: 'Лекция', teacher: 'Иванов И.И.', room: '305' });
const math = makeLesson({ title: 'Математика', type: 'Практика', teacher: 'Петров П.П.', room: '110' });
const labPhysics = makeLesson({ title: 'Физика', type: 'Лабораторная', teacher: 'Сидоров С.С.', room: '305' });

// mon: [ [physics], [] ], tue: [ [], [math, labPhysics] ]
const days = [
    { name: 'mon', lessons: [[physics], []] },
    { name: 'tue', lessons: [[], [math, labPhysics]] },
];

describe('lessonMatchesQuery', () => {
    it('matches on title, teacher and room (case-insensitive)', () => {
        expect(lessonMatchesQuery(physics, 'физика')).toBe(true);
        expect(lessonMatchesQuery(physics, 'иванов')).toBe(true);
        expect(lessonMatchesQuery(physics, '305')).toBe(true);
    });

    it('requires every token to match (AND)', () => {
        expect(lessonMatchesQuery(physics, 'физика лекция')).toBe(true);
        expect(lessonMatchesQuery(physics, 'физика практика')).toBe(false);
    });

    it('returns false for an empty query', () => {
        expect(lessonMatchesQuery(physics, '')).toBe(false);
        expect(lessonMatchesQuery(physics, '   ')).toBe(false);
    });
});

describe('searchLessons', () => {
    it('returns nothing for an empty query', () => {
        expect(searchLessons(days, '')).toEqual([]);
    });

    it('flattens matches with day key and slot index in order', () => {
        const hits = searchLessons(days, 'физика');
        expect(hits).toHaveLength(2);
        expect(hits[0]).toMatchObject({ dayKey: 'mon', slotIndex: 0, lessonIndex: 0 });
        // labPhysics is the 2nd lesson (index 1) in tue's slot 1.
        expect(hits[1]).toMatchObject({ dayKey: 'tue', slotIndex: 1, lessonIndex: 1 });
        expect(hits[1]!.lesson.title).toBe('Физика');
    });

    it('matches a single lesson by teacher', () => {
        const hits = searchLessons(days, 'петров');
        expect(hits).toHaveLength(1);
        expect(hits[0]!.lesson.title).toBe('Математика');
    });

    it('returns an empty array when nothing matches', () => {
        expect(searchLessons(days, 'химия')).toEqual([]);
    });
});
