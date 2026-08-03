import { describe, it, expect } from 'vitest';
import {
    normalizeLeaderboardContacts,
    normalizeSubjectKey,
    formatPublicLeaderboardName,
    parseScore,
    parseTermLabel,
    pseudonymFor,
    selectLeaderboardScore,
} from './subject-grades.js';

describe('parseTermLabel', () => {
    it('parses common transcript term labels', () => {
        expect(parseTermLabel('Семестр 2024-1')).toEqual({ year: 2024, semester: 1 });
        expect(parseTermLabel('2023-2')).toEqual({ year: 2023, semester: 2 });
        expect(parseTermLabel('2025 / 3')).toEqual({ year: 2025, semester: 3 });
    });
    it('rejects junk', () => {
        expect(parseTermLabel('')).toBeNull();
        expect(parseTermLabel('no term')).toBeNull();
        expect(parseTermLabel(null)).toBeNull();
        expect(parseTermLabel('2024-9')).toBeNull();
    });
});

describe('normalizeSubjectKey', () => {
    it('lowercases, strips codes/punctuation, collapses whitespace', () => {
        expect(normalizeSubjectKey('Математический анализ')).toBe('математический анализ');
        expect(normalizeSubjectKey('Математический анализ (MATH101)')).toBe('математический анализ');
        expect(normalizeSubjectKey('  Физика [2024]  ')).toBe('физика');
        expect(normalizeSubjectKey('История, Казахстана!')).toBe('история казахстана');
    });

    it('groups trivial variants to the same key', () => {
        expect(normalizeSubjectKey('Алгебра (АЛГ-1)')).toBe(normalizeSubjectKey('алгебра'));
    });

    it('returns empty for non-strings / blanks', () => {
        expect(normalizeSubjectKey('')).toBe('');
        expect(normalizeSubjectKey('   ')).toBe('');
        expect(normalizeSubjectKey(null)).toBe('');
        expect(normalizeSubjectKey(42)).toBe('');
    });
});

describe('parseScore', () => {
    it('parses numeric strings and numbers in 0..100', () => {
        expect(parseScore('95')).toBe(95);
        expect(parseScore(87)).toBe(87);
        expect(parseScore('88,5')).toBe(88.5);
        expect(parseScore('0')).toBe(0);
        expect(parseScore('100')).toBe(100);
    });

    it('rejects non-scores and out-of-range', () => {
        expect(parseScore('-')).toBeNull();
        expect(parseScore('зачет')).toBeNull();
        expect(parseScore('')).toBeNull();
        expect(parseScore(null)).toBeNull();
        expect(parseScore(-5)).toBeNull();
        expect(parseScore(150)).toBeNull();
        expect(parseScore(NaN)).toBeNull();
    });
});

describe('selectLeaderboardScore', () => {
    it('uses total when it has a real non-zero score', () => {
        expect(selectLeaderboardScore('82.00', '75.00')).toBe(82);
    });

    it('falls back to rating when total is zero but rating is available', () => {
        expect(selectLeaderboardScore('0.0', '74.00')).toBe(74);
    });

    it('keeps zero only when no better score exists', () => {
        expect(selectLeaderboardScore('0.0', '-')).toBe(0);
    });
});

describe('formatPublicLeaderboardName', () => {
    it('shortens full names to surname and initials for public leaderboard output', () => {
        expect(formatPublicLeaderboardName('Шипихин Максим Евгеньевич')).toBe('Шипихин М. Е.');
        expect(formatPublicLeaderboardName('Телеу Диана Сержанкызы')).toBe('Телеу Д. С.');
    });

    it('keeps nicknames and already-short names unchanged', () => {
        expect(formatPublicLeaderboardName('Мейрам')).toBe('Мейрам');
        expect(formatPublicLeaderboardName('Шипихин М. Е.')).toBe('Шипихин М. Е.');
    });
});

describe('pseudonymFor', () => {
    it('uses the explicit display name when set', () => {
        expect(pseudonymFor('user1', 'Аскар Б.')).toBe('Аскар Б.');
        expect(pseudonymFor('user1', '  Ник  ')).toBe('Ник');
    });

    it('falls back to a stable anonymous handle (never the raw id)', () => {
        const a = pseudonymFor('demo.student', '');
        const b = pseudonymFor('demo.student', null);
        expect(a).toBe(b); // stable
        expect(a).toMatch(/^Студент-[0-9A-Z]{4}$/);
        expect(a).not.toContain('demo.student');
    });

    it('different ids get different handles', () => {
        expect(pseudonymFor('userA')).not.toBe(pseudonymFor('userB'));
    });
});

describe('normalizeLeaderboardContacts', () => {
    it('normalizes telegram and instagram handles without leaking junk fields', () => {
        expect(normalizeLeaderboardContacts({
            telegram: ' @student ',
            instagram: 'https://instagram.com/student.page/',
            phone: '+7777',
        })).toEqual({
            telegram: 'student',
            instagram: 'student.page',
        });
    });

    it('returns null when no supported contacts are present', () => {
        expect(normalizeLeaderboardContacts(null)).toBeNull();
        expect(normalizeLeaderboardContacts({ telegram: '  ', instagram: null })).toBeNull();
    });
});
