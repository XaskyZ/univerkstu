import { describe, expect, it } from 'vitest';
import { categorizeUmkdCourse } from './categorize';

describe('categorizeUmkdCourse', () => {
    it('"Математическая физика" → physics (physics noun beats math)', () => {
        expect(categorizeUmkdCourse('Математическая физика')).toBe('physics');
    });

    it('"Физическая химия" → chemistry (chemistry noun beats physics adjective)', () => {
        expect(categorizeUmkdCourse('Физическая химия')).toBe('chemistry');
    });

    it('"Программирование баз данных" → databases (databases beats programming)', () => {
        expect(categorizeUmkdCourse('Программирование баз данных')).toBe('databases');
    });

    it('"Логика" → philosophy', () => {
        expect(categorizeUmkdCourse('Логика')).toBe('philosophy');
    });

    it('generic unknown name → default', () => {
        expect(categorizeUmkdCourse('Нечто совершенно непонятное')).toBe('default');
    });

    it('empty / whitespace input falls back to default', () => {
        expect(categorizeUmkdCourse('')).toBe('default');
        expect(categorizeUmkdCourse('   ')).toBe('default');
    });

    it('matches plain "Математика" → math (no physics keyword present)', () => {
        expect(categorizeUmkdCourse('Математика')).toBe('math');
    });

    it('matches "Английский язык" → english', () => {
        expect(categorizeUmkdCourse('Английский язык')).toBe('english');
    });

    it('matches "Охрана труда" → safety', () => {
        expect(categorizeUmkdCourse('Охрана труда и техника безопасности')).toBe('safety');
    });
});
