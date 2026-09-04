import { describe, it, expect } from 'vitest';
import {
    buildLoginRedirect,
    formatCountdown,
    formatManualCode,
    isCompleteManualCode,
    isTerminalChallengeStatus,
    normalizeManualCode,
    parseApproveParams,
    readStoredLoginMode,
    resolvePostLoginPath,
    sanitizeNextPath,
    secondsUntil,
    storeLoginMode,
    LOGIN_MODE_STORAGE_KEY,
} from './login-challenge';

describe('normalizeManualCode', () => {
    it('uppercases and strips dashes/spaces', () => {
        expect(normalizeManualCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN');
        expect(normalizeManualCode(' abcd efgh jkmn ')).toBe('ABCDEFGHJKMN');
    });

    it('maps ambiguous glyphs O→0 and I/L→1', () => {
        expect(normalizeManualCode('oOiIlL')).toBe('001111');
    });

    it('drops characters outside the Crockford alphabet and caps at 12', () => {
        expect(normalizeManualCode('AB!CD_EF*GH')).toBe('ABCDEFGH');
        expect(normalizeManualCode('ABCDEFGHJKMNPQRS')).toBe('ABCDEFGHJKMN');
        expect(normalizeManualCode('UUUU')).toBe(''); // U is not in the alphabet
    });

    it('returns empty string for non-strings', () => {
        expect(normalizeManualCode(null)).toBe('');
        expect(normalizeManualCode(42)).toBe('');
    });
});

describe('formatManualCode', () => {
    it('groups into XXXX-XXXX-XXXX', () => {
        expect(formatManualCode('abcdefghjkmn')).toBe('ABCD-EFGH-JKMN');
    });

    it('groups partial input as far as it goes (typing on the fly)', () => {
        expect(formatManualCode('a')).toBe('A');
        expect(formatManualCode('abcde')).toBe('ABCD-E');
        expect(formatManualCode('ABCD-EFGH-J')).toBe('ABCD-EFGH-J');
        expect(formatManualCode('')).toBe('');
    });

    it('round-trips with normalizeManualCode', () => {
        expect(normalizeManualCode(formatManualCode('0123456789ab'))).toBe('0123456789AB');
    });
});

describe('isCompleteManualCode', () => {
    it('is true only for exactly 12 valid characters', () => {
        expect(isCompleteManualCode('ABCD-EFGH-JKMN')).toBe(true);
        expect(isCompleteManualCode('ABCD-EFGH-JKM')).toBe(false);
        expect(isCompleteManualCode('')).toBe(false);
    });
});

describe('countdown helpers', () => {
    it('formatCountdown renders m:ss', () => {
        expect(formatCountdown(119)).toBe('1:59');
        expect(formatCountdown(5)).toBe('0:05');
        expect(formatCountdown(0)).toBe('0:00');
        expect(formatCountdown(-3)).toBe('0:00');
        expect(formatCountdown(600)).toBe('10:00');
        expect(formatCountdown(Number.NaN)).toBe('0:00');
    });

    it('secondsUntil rounds up and never goes negative', () => {
        const now = Date.parse('2026-09-04T10:00:00Z');
        expect(secondsUntil('2026-09-04T10:02:00Z', now)).toBe(120);
        expect(secondsUntil('2026-09-04T10:00:00.400Z', now)).toBe(1);
        expect(secondsUntil('2026-09-04T09:59:00Z', now)).toBe(0);
        expect(secondsUntil('not-a-date', now)).toBe(0);
        expect(secondsUntil(null, now)).toBe(0);
    });
});

describe('sanitizeNextPath / resolvePostLoginPath', () => {
    it('accepts same-origin relative paths', () => {
        expect(sanitizeNextPath('/login/approve?c=1&s=ABCD')).toBe('/login/approve?c=1&s=ABCD');
        expect(sanitizeNextPath('/schedule')).toBe('/schedule');
        expect(sanitizeNextPath('  /exams ')).toBe('/exams');
    });

    it('rejects absolute URLs, protocol-relative paths and junk', () => {
        expect(sanitizeNextPath('https://evil.example/x')).toBeNull();
        expect(sanitizeNextPath('//evil.example/x')).toBeNull();
        expect(sanitizeNextPath('/\\evil.example')).toBeNull();
        expect(sanitizeNextPath('javascript:alert(1)')).toBeNull();
        expect(sanitizeNextPath('/foo\nbar')).toBeNull();
        expect(sanitizeNextPath('schedule')).toBeNull();
        expect(sanitizeNextPath('')).toBeNull();
        expect(sanitizeNextPath(null)).toBeNull();
        expect(sanitizeNextPath(undefined)).toBeNull();
        expect(sanitizeNextPath('/' + 'a'.repeat(3000))).toBeNull();
    });

    it('resolvePostLoginPath falls back to /schedule', () => {
        expect(resolvePostLoginPath('/login/approve')).toBe('/login/approve');
        expect(resolvePostLoginPath('https://evil.example')).toBe('/schedule');
        expect(resolvePostLoginPath(null)).toBe('/schedule');
    });

    it('buildLoginRedirect encodes the return path', () => {
        expect(buildLoginRedirect('/login/approve?c=abc&s=ABCD-EFGH-JKMN')).toBe('/login?next=%2Flogin%2Fapprove%3Fc%3Dabc%26s%3DABCD-EFGH-JKMN');
        expect(buildLoginRedirect('/')).toBe('/login');
        expect(buildLoginRedirect('https://evil.example')).toBe('/login');
    });
});

describe('parseApproveParams', () => {
    it('reads c + s from query params and normalizes the secret', () => {
        expect(parseApproveParams(new URLSearchParams('c=ch-1&s=abcd-efgh-jkmn'))).toEqual({ challengeId: 'ch-1', approveSecret: 'ABCDEFGHJKMN' });
    });

    it('returns null when either param is missing or the secret is incomplete', () => {
        expect(parseApproveParams(new URLSearchParams('c=ch-1'))).toBeNull();
        expect(parseApproveParams(new URLSearchParams('s=ABCDEFGHJKMN'))).toBeNull();
        expect(parseApproveParams(new URLSearchParams('c=ch-1&s=ABC'))).toBeNull();
        expect(parseApproveParams(null)).toBeNull();
    });
});

describe('login mode storage', () => {
    it('reads only known modes and swallows storage errors', () => {
        const store = new Map<string, string>();
        const storage = {
            getItem: (key: string) => store.get(key) ?? null,
            setItem: (key: string, value: string) => { store.set(key, value); },
        };
        expect(readStoredLoginMode(storage)).toBeNull();
        storeLoginMode(storage, 'qr');
        expect(store.get(LOGIN_MODE_STORAGE_KEY)).toBe('qr');
        expect(readStoredLoginMode(storage)).toBe('qr');
        store.set(LOGIN_MODE_STORAGE_KEY, 'bogus');
        expect(readStoredLoginMode(storage)).toBeNull();

        const throwing = {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); },
        };
        expect(readStoredLoginMode(throwing)).toBeNull();
        expect(() => storeLoginMode(throwing, 'push')).not.toThrow();
        expect(readStoredLoginMode(null)).toBeNull();
    });
});

describe('isTerminalChallengeStatus', () => {
    it('treats approved/consumed/denied/expired as terminal', () => {
        expect(isTerminalChallengeStatus('approved')).toBe(true);
        expect(isTerminalChallengeStatus('consumed')).toBe(true);
        expect(isTerminalChallengeStatus('denied')).toBe(true);
        expect(isTerminalChallengeStatus('expired')).toBe(true);
        expect(isTerminalChallengeStatus('pending')).toBe(false);
        expect(isTerminalChallengeStatus(undefined)).toBe(false);
    });
});
