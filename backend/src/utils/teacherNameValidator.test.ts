import { describe, it, expect } from 'vitest';
import { validateTeacherName, containsProfanity } from './teacherNameValidator.js';

describe('validateTeacherName', () => {
    it('accepts a valid russian full name with initials', () => {
        expect(validateTeacherName('Аубакиров Н.М')).toEqual({ ok: true });
        expect(validateTeacherName('Иванов Иван')).toEqual({ ok: true });
    });

    it('accepts kazakh names with special letters', () => {
        expect(validateTeacherName('Әсет Н.Қ')).toEqual({ ok: true });
        expect(validateTeacherName('Нұрмағанбет Н.Н.Ж')).toEqual({ ok: true });
    });

    it('accepts latin names', () => {
        expect(validateTeacherName("O'Brien John")).toEqual({ ok: true });
        expect(validateTeacherName('John Smith')).toEqual({ ok: true });
    });

    it('rejects too short input', () => {
        expect(validateTeacherName('ab')).toEqual({ ok: false, reason: 'too_short' });
        expect(validateTeacherName('  ')).toEqual({ ok: false, reason: 'too_short' });
    });

    it('rejects too long input', () => {
        const long = 'И'.repeat(40) + ' ' + 'и'.repeat(50);
        expect(validateTeacherName(long)).toEqual({ ok: false, reason: 'too_long' });
    });

    it('rejects digits and forbidden punctuation', () => {
        expect(validateTeacherName('Иванов 123')).toEqual({ ok: false, reason: 'bad_format' });
        expect(validateTeacherName('Иванов!!! И')).toEqual({ ok: false, reason: 'bad_format' });
        expect(validateTeacherName('Ivan@Petrov')).toEqual({ ok: false, reason: 'bad_format' });
    });

    it('rejects ALL-CAPS strings', () => {
        expect(validateTeacherName('ИВАНОВ И.И')).toEqual({ ok: false, reason: 'bad_format' });
        expect(validateTeacherName('JOHN SMITH')).toEqual({ ok: false, reason: 'bad_format' });
    });

    it('rejects 4+ consecutive uppercase letters (SHOUTING)', () => {
        expect(validateTeacherName('ИВАНов и')).toEqual({ ok: false, reason: 'bad_format' });
    });

    it('rejects single-token input', () => {
        expect(validateTeacherName('Иванов')).toEqual({ ok: false, reason: 'no_tokens' });
        expect(validateTeacherName('John')).toEqual({ ok: false, reason: 'no_tokens' });
    });

    it('rejects profanity', () => {
        expect(validateTeacherName('Хуй Петрович')).toEqual({ ok: false, reason: 'profanity' });
        expect(validateTeacherName('Иванов Пиздец')).toEqual({ ok: false, reason: 'profanity' });
    });

    it('rejects non-string input', () => {
        // @ts-expect-error testing runtime guard
        expect(validateTeacherName(undefined)).toEqual({ ok: false, reason: 'bad_format' });
        // @ts-expect-error testing runtime guard
        expect(validateTeacherName(null)).toEqual({ ok: false, reason: 'bad_format' });
    });

    it('preserves whitespace tolerance', () => {
        expect(validateTeacherName('  Иванов   Иван  ')).toEqual({ ok: true });
    });
});

describe('containsProfanity', () => {
    it('detects obvious russian slurs (substring match)', () => {
        expect(containsProfanity('хуйня какая-то')).toBe(true);
        expect(containsProfanity('какой-то выебон')).toBe(true);
    });

    it('detects transliterated forms', () => {
        expect(containsProfanity('huy tebe')).toBe(true);
    });

    it('passes safe text', () => {
        expect(containsProfanity('Аубакиров Н.М')).toBe(false);
        expect(containsProfanity('хороший преподаватель')).toBe(false);
    });
});
