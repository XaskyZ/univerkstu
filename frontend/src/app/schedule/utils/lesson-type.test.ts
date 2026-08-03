import { describe, it, expect } from 'vitest';
import {
    detectLessonTypeKind,
    detectSelfStudyKind,
    getLessonTypeBadge,
    getLessonTypeClass,
    getLessonTypeLabel,
} from './lesson-type';

const FALLBACK = { ru: 'Занятие', kz: 'Сабақ', en: 'Lesson' } as const;

describe('detectLessonTypeKind', () => {
    it('resolves the portal short codes', () => {
        expect(detectLessonTypeKind('Л')).toBe('lecture');
        expect(detectLessonTypeKind('ЛЗ')).toBe('laboratory');
        expect(detectLessonTypeKind('ПЗ')).toBe('practice');
        expect(detectLessonTypeKind('СПЗ')).toBe('practice');
    });

    it('resolves spelled-out forms in ru/en', () => {
        expect(detectLessonTypeKind('Лекция')).toBe('lecture');
        expect(detectLessonTypeKind('сем')).toBe('seminar');
        expect(detectLessonTypeKind('Лабораторное занятие')).toBe('laboratory');
        expect(detectLessonTypeKind('практ')).toBe('practice');
        expect(detectLessonTypeKind('Lecture')).toBe('lecture');
    });

    it('returns other for unknown or empty values', () => {
        expect(detectLessonTypeKind(null)).toBe('other');
        expect(detectLessonTypeKind('')).toBe('other');
        expect(detectLessonTypeKind('Зачёт')).toBe('other');
    });
});

describe('detectSelfStudyKind', () => {
    it('keeps СРСП and СРС distinct', () => {
        expect(detectSelfStudyKind('СРСП')).toBe('srsp');
        expect(detectSelfStudyKind('срсп')).toBe('srsp');
        expect(detectSelfStudyKind('SRSP')).toBe('srsp');
        expect(detectSelfStudyKind('СРС')).toBe('srs');
        expect(detectSelfStudyKind('SRS')).toBe('srs');
    });

    it('returns null when neither marker is present', () => {
        expect(detectSelfStudyKind('Лекция')).toBeNull();
        expect(detectSelfStudyKind(null, '')).toBeNull();
    });
});

describe('getLessonTypeBadge', () => {
    it('never leaks the raw code — unknown values use the fallback', () => {
        expect(getLessonTypeBadge('ЗАЧ', '', 'ru', FALLBACK.ru)).toEqual({ label: 'Занятие', description: null });
    });

    it('returns null when there is no type and no self-study marker', () => {
        expect(getLessonTypeBadge(null, 'Математика', 'ru', FALLBACK.ru)).toBeNull();
    });

    it('expands the short code per language', () => {
        expect(getLessonTypeBadge('Л', '', 'ru', FALLBACK.ru)?.label).toBe('Лекция');
        expect(getLessonTypeBadge('Л', '', 'kz', FALLBACK.kz)?.label).toBe('Дәріс');
        expect(getLessonTypeBadge('Л', '', 'en', FALLBACK.en)?.label).toBe('Lecture');
    });

    it('keeps the ru lab label abbreviated so it fits the 360px badge row', () => {
        expect(getLessonTypeBadge('ЛЗ', '', 'ru', FALLBACK.ru)?.label).toBe('Лаб. занятие');
    });

    it('shows СРСП as its own code with the full wording in the description', () => {
        expect(getLessonTypeBadge('СРСП', '', 'ru', FALLBACK.ru)).toEqual({
            label: 'СРСП',
            description: 'Самостоятельная работа с преподавателем',
        });
        expect(getLessonTypeBadge('СРС', '', 'ru', FALLBACK.ru)).toEqual({
            label: 'СРС',
            description: 'Самостоятельная работа',
        });
        expect(getLessonTypeBadge('СРСП', '', 'kz', FALLBACK.kz)?.label).toBe('СӨЖМ');
        expect(getLessonTypeBadge('СРСП', '', 'en', FALLBACK.en)?.label).toBe('SRSP');
    });
});

describe('getLessonTypeLabel', () => {
    it('resolves a code for plain-text contexts such as notifications', () => {
        expect(getLessonTypeLabel('л', 'ru', FALLBACK.ru)).toBe('Лекция');
        expect(getLessonTypeLabel('срсп', 'en', FALLBACK.en)).toBe('SRSP');
        expect(getLessonTypeLabel('', 'ru', FALLBACK.ru)).toBe('');
    });
});

describe('getLessonTypeClass', () => {
    it('maps kinds to the existing badge accent classes', () => {
        expect(getLessonTypeClass('СРСП', '')).toBe('srs');
        expect(getLessonTypeClass('СРС', '')).toBe('srs');
        expect(getLessonTypeClass('Л', '')).toBe('lecture');
        expect(getLessonTypeClass('ЛЗ', '')).toBe('lab');
        expect(getLessonTypeClass('сем', '')).toBe('seminar');
        expect(getLessonTypeClass('Зачёт', '')).toBe('');
    });
});
