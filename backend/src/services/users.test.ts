import { describe, it, expect } from 'vitest';
import { constantTimeEquals, parseUserSettings, toPgUser } from './users.js';

describe('constantTimeEquals', () => {
    // Used by verifyStaffPassword. `===` on strings short-circuits at the first
    // differing byte, so a wrong password with a longer correct prefix takes
    // measurably longer to reject. Same guard shape as utils/adminSession.ts:
    // timingSafeEqual throws on a length mismatch, so length is checked first.

    it('returns true for identical strings', () => {
        expect(constantTimeEquals('hunter2', 'hunter2')).toBe(true);
    });

    it('returns false for different strings of the same length', () => {
        expect(constantTimeEquals('hunter2', 'hunter3')).toBe(false);
    });

    it('returns false for different lengths (no timingSafeEqual throw)', () => {
        expect(constantTimeEquals('short', 'a-much-longer-secret')).toBe(false);
        expect(constantTimeEquals('a-much-longer-secret', 'short')).toBe(false);
    });

    it('is case sensitive', () => {
        expect(constantTimeEquals('Secret', 'secret')).toBe(false);
    });

    it('treats two empty strings as equal', () => {
        expect(constantTimeEquals('', '')).toBe(true);
    });

    it('returns false when only one side is empty', () => {
        expect(constantTimeEquals('', 'x')).toBe(false);
        expect(constantTimeEquals('x', '')).toBe(false);
    });

    it('handles non-ASCII secrets byte-wise', () => {
        expect(constantTimeEquals('пароль', 'пароль')).toBe(true);
        expect(constantTimeEquals('пароль', 'парол6')).toBe(false);
    });

    it('coerces null/undefined to empty instead of throwing', () => {
        expect(constantTimeEquals(null as unknown as string, '')).toBe(true);
        expect(constantTimeEquals(undefined as unknown as string, 'x')).toBe(false);
    });
});

describe('parseUserSettings', () => {
    it('returns undefined for non-object inputs', () => {
        expect(parseUserSettings(null)).toBe(undefined);
        expect(parseUserSettings(undefined)).toBe(undefined);
        expect(parseUserSettings('string')).toBe(undefined);
        expect(parseUserSettings(42)).toBe(undefined);
        expect(parseUserSettings(true)).toBe(undefined);
    });

    it('returns default settings for empty object', () => {
        // Defaults documented in the parser:
        //   language='ru', notifications=true, theme='system', dmPrivacy='open',
        //   leaderboardDisplayName=undefined
        expect(parseUserSettings({})).toEqual({
            language: 'ru',
            notifications: true,
            theme: 'system',
            leaderboardDisplayName: undefined,
            dmPrivacy: 'open',
        });
    });

    describe('language', () => {
        it('passes through valid languages', () => {
            expect(parseUserSettings({ language: 'kz' })?.language).toBe('kz');
            expect(parseUserSettings({ language: 'en' })?.language).toBe('en');
            expect(parseUserSettings({ language: 'ru' })?.language).toBe('ru');
        });

        it('falls back to ru for invalid/unknown languages', () => {
            expect(parseUserSettings({ language: 'fr' })?.language).toBe('ru');
            expect(parseUserSettings({ language: 'EN' })?.language).toBe('ru'); // case-sensitive
            expect(parseUserSettings({ language: '' })?.language).toBe('ru');
            expect(parseUserSettings({ language: null })?.language).toBe('ru');
            expect(parseUserSettings({ language: 42 })?.language).toBe('ru');
        });
    });

    describe('notifications', () => {
        it('passes through boolean values verbatim', () => {
            expect(parseUserSettings({ notifications: true })?.notifications).toBe(true);
            expect(parseUserSettings({ notifications: false })?.notifications).toBe(false);
        });

        it('falls back to true for non-boolean values', () => {
            // Default-on is the explicit product choice — don't silently disable notifications
            // because the stored value got corrupted to a string/number.
            expect(parseUserSettings({ notifications: 'true' })?.notifications).toBe(true);
            expect(parseUserSettings({ notifications: 1 })?.notifications).toBe(true);
            expect(parseUserSettings({ notifications: null })?.notifications).toBe(true);
            expect(parseUserSettings({ notifications: undefined })?.notifications).toBe(true);
        });
    });

    describe('theme', () => {
        it('passes through valid themes', () => {
            expect(parseUserSettings({ theme: 'light' })?.theme).toBe('light');
            expect(parseUserSettings({ theme: 'dark' })?.theme).toBe('dark');
            expect(parseUserSettings({ theme: 'system' })?.theme).toBe('system');
        });

        it('falls back to system for invalid themes', () => {
            // 'system' is the safe default — let CSS media query decide.
            expect(parseUserSettings({ theme: 'auto' })?.theme).toBe('system');
            expect(parseUserSettings({ theme: 'Light' })?.theme).toBe('system'); // case-sensitive
            expect(parseUserSettings({ theme: '' })?.theme).toBe('system');
            expect(parseUserSettings({ theme: null })?.theme).toBe('system');
        });
    });

    describe('leaderboardDisplayName', () => {
        it('trims and caps to 40 chars', () => {
            expect(parseUserSettings({ leaderboardDisplayName: '  Aibek  ' })?.leaderboardDisplayName).toBe('Aibek');
            // 50 chars → trimmed to 40
            const longName = 'A'.repeat(50);
            expect(parseUserSettings({ leaderboardDisplayName: longName })?.leaderboardDisplayName).toBe('A'.repeat(40));
        });

        it('returns undefined for empty/whitespace-only strings (after trim)', () => {
            // Empty string after trimming → undefined, not '' — so UI shows "no nickname"
            // instead of an empty-string nickname.
            expect(parseUserSettings({ leaderboardDisplayName: '' })?.leaderboardDisplayName).toBe(undefined);
            expect(parseUserSettings({ leaderboardDisplayName: '   ' })?.leaderboardDisplayName).toBe(undefined);
        });

        it('returns undefined for non-string values', () => {
            expect(parseUserSettings({ leaderboardDisplayName: 42 })?.leaderboardDisplayName).toBe(undefined);
            expect(parseUserSettings({ leaderboardDisplayName: null })?.leaderboardDisplayName).toBe(undefined);
        });

        it('preserves unicode (Cyrillic + emoji) within the cap', () => {
            expect(parseUserSettings({ leaderboardDisplayName: 'Айбек 🔥' })?.leaderboardDisplayName).toBe('Айбек 🔥');
        });
    });

    describe('dmPrivacy', () => {
        it('passes through friends_only', () => {
            expect(parseUserSettings({ dmPrivacy: 'friends_only' })?.dmPrivacy).toBe('friends_only');
        });

        it('falls back to open for anything else', () => {
            // 'open' is the documented default — DMs are receivable from anyone unless
            // user explicitly opted into friends_only.
            expect(parseUserSettings({ dmPrivacy: 'open' })?.dmPrivacy).toBe('open');
            expect(parseUserSettings({ dmPrivacy: 'closed' })?.dmPrivacy).toBe('open');
            expect(parseUserSettings({ dmPrivacy: 'FRIENDS_ONLY' })?.dmPrivacy).toBe('open'); // case-sensitive
            expect(parseUserSettings({ dmPrivacy: null })?.dmPrivacy).toBe('open');
            expect(parseUserSettings({})?.dmPrivacy).toBe('open');
        });
    });

    it('ignores unknown extra fields silently', () => {
        const result = parseUserSettings({
            language: 'kz',
            extraField: 'ignored',
            another: 42,
        });
        expect(result).toEqual({
            language: 'kz',
            notifications: true,
            theme: 'system',
            leaderboardDisplayName: undefined,
            dmPrivacy: 'open',
        });
    });

    it('all-valid input round-trips with no surprises', () => {
        const input = {
            language: 'en' as const,
            notifications: false,
            theme: 'dark' as const,
            leaderboardDisplayName: 'Aibek',
            dmPrivacy: 'friends_only' as const,
        };
        expect(parseUserSettings(input)).toEqual(input);
    });
});

describe('toPgUser', () => {
    // Postgres row → typed User object mapper. Wraps timestamps as Date instances
    // and feeds settings_json through parseUserSettings. The mapper is used by
    // every getUser/getAllUsers query — a regression silently corrupts user objects.

    it('maps a complete row correctly', () => {
        const row = {
            user_id: 'user123',
            password_encrypted: 'iv:ct',
            created_at: new Date('2026-01-01T00:00:00.000Z'),
            last_login: new Date('2026-05-13T10:00:00.000Z'),
            settings_json: { language: 'ru', notifications: true, theme: 'system', dmPrivacy: 'open' },
        };
        const result = toPgUser(row);
        expect(result.userId).toBe('user123');
        expect(result.passwordEncrypted).toBe('iv:ct');
        expect(result.createdAt).toBeInstanceOf(Date);
        expect(result.lastLogin).toBeInstanceOf(Date);
        expect(result.settings).toEqual({
            language: 'ru',
            notifications: true,
            theme: 'system',
            dmPrivacy: 'open',
        });
    });

    it('preserves Date instance values (re-wraps via new Date)', () => {
        const createdAt = new Date('2026-01-01T12:34:56.000Z');
        const lastLogin = new Date('2026-05-13T08:00:00.000Z');
        const result = toPgUser({
            user_id: 'u',
            password_encrypted: '',
            created_at: createdAt,
            last_login: lastLogin,
            settings_json: null,
        });
        expect(result.createdAt.toISOString()).toBe(createdAt.toISOString());
        expect(result.lastLogin.toISOString()).toBe(lastLogin.toISOString());
    });

    it('null settings_json produces undefined settings (parseUserSettings contract)', () => {
        // parseUserSettings returns undefined for non-object input, including null.
        const result = toPgUser({
            user_id: 'u',
            password_encrypted: '',
            created_at: new Date(),
            last_login: new Date(),
            settings_json: null,
        });
        expect(result.settings).toBe(undefined);
    });

    it('malformed settings_json produces undefined settings (not crash)', () => {
        // parseUserSettings handles non-object input defensively.
        const result = toPgUser({
            user_id: 'u',
            password_encrypted: '',
            created_at: new Date(),
            last_login: new Date(),
            settings_json: 'string-not-object',
        });
        expect(result.settings).toBe(undefined);
    });

    it('preserves userId verbatim (no normalization)', () => {
        const result = toPgUser({
            user_id: 'User.With@Special#Chars',
            password_encrypted: '',
            created_at: new Date(),
            last_login: new Date(),
            settings_json: null,
        });
        expect(result.userId).toBe('User.With@Special#Chars');
    });
});
