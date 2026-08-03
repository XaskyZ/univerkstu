import { describe, it, expect } from 'vitest';
import { filterExams } from './filter-exams';
import type { Exam } from '@/lib/types';

function makeExam(over: Partial<Exam>): Exam {
    return {
        subject: '',
        teacher: '',
        type: '',
        format: '',
        building: '',
        room: '',
        locationRaw: '',
        groupType: '',
        datetime: null,
        ...over,
    };
}

const exams: Exam[] = [
    makeExam({ subject: 'Математический анализ', teacher: 'Иванов И.И.', room: '305', building: 'ГК' }),
    makeExam({ subject: 'Физика', teacher: 'Петров П.П.', room: '110', building: 'ЛК' }),
    makeExam({ subject: 'Базы данных', teacher: 'Иванова А.А.', room: '305', building: 'ГК', type: 'Государственный' }),
];

describe('filterExams', () => {
    it('returns all exams for an empty query', () => {
        expect(filterExams(exams, '')).toHaveLength(3);
        expect(filterExams(exams, '   ')).toHaveLength(3);
    });

    it('matches on subject (case-insensitive)', () => {
        const result = filterExams(exams, 'физика');
        expect(result).toHaveLength(1);
        expect(result[0]!.subject).toBe('Физика');
    });

    it('matches on teacher and room', () => {
        expect(filterExams(exams, 'петров')).toHaveLength(1);
        expect(filterExams(exams, '110')).toHaveLength(1);
    });

    it('matches the room across multiple exams', () => {
        expect(filterExams(exams, '305')).toHaveLength(2);
    });

    it('requires every token to match (AND)', () => {
        expect(filterExams(exams, 'иванов 305')).toHaveLength(2); // "Иванов" and "Иванова" both contain "иванов"
        expect(filterExams(exams, 'физика 305')).toHaveLength(0);
    });

    it('matches on exam type', () => {
        expect(filterExams(exams, 'государственный')).toHaveLength(1);
    });

    it('returns an empty array when nothing matches', () => {
        expect(filterExams(exams, 'химия')).toEqual([]);
    });
});
