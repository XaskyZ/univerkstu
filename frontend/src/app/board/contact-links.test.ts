import { describe, expect, it } from 'vitest';
import { buildInstagramHref, buildPhoneHref, buildTelegramHref } from './contact-links';

describe('board contact links', () => {
    it('normalizes Telegram handles and links', () => {
        expect(buildTelegramHref('@student_kstu')).toBe('https://t.me/student_kstu');
        expect(buildTelegramHref('t.me/student_kstu?start=abc')).toBe('https://t.me/student_kstu');
        expect(buildTelegramHref('https://telegram.me/student.kstu')).toBe('https://t.me/student.kstu');
    });

    it('normalizes Instagram handles and links', () => {
        expect(buildInstagramHref('@student.kstu')).toBe('https://instagram.com/student.kstu');
        expect(buildInstagramHref('instagram.com/student_kstu/')).toBe('https://instagram.com/student_kstu');
        expect(buildInstagramHref('https://www.instagram.com/student-kstu?igsh=1')).toBe('https://instagram.com/student-kstu');
    });

    it('returns null for blank social contacts', () => {
        expect(buildTelegramHref('   ')).toBeNull();
        expect(buildInstagramHref(undefined)).toBeNull();
    });

    it('normalizes phone links', () => {
        expect(buildPhoneHref('+7 (777) 123-45-67')).toBe('tel:+77771234567');
        expect(buildPhoneHref('8 700 000 00 00')).toBe('tel:87000000000');
        expect(buildPhoneHref('   ')).toBeNull();
    });
});
