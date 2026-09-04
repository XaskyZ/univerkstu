import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHash } from 'crypto';
import {
    APPROVE_SECRET_LENGTH,
    buildApprovePath,
    buildQrUrl,
    formatManualCode,
    generateApproveSecret,
    generatePollSecret,
    getPublicAppUrl,
    hashSecret,
    isChallengeExpired,
    isValidApproveSecret,
    normalizeApproveSecret,
} from './login-challenges.js';

// Чистые функции challenge-входа. Хранилище покрыто в routes/auth-challenges.test.ts
// через шим withSupabasePostgres.

const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]+$/;

describe('generateApproveSecret', () => {
    it('produces 12 Crockford base32 characters (no I, L, O, U)', () => {
        for (let i = 0; i < 200; i += 1) {
            const secret = generateApproveSecret();
            expect(secret).toHaveLength(APPROVE_SECRET_LENGTH);
            expect(secret).toMatch(CROCKFORD);
            expect(secret).not.toMatch(/[ILOU]/);
        }
    });

    it('is random (no two of many samples collide)', () => {
        const samples = new Set(Array.from({ length: 200 }, () => generateApproveSecret()));
        expect(samples.size).toBe(200);
    });
});

describe('generatePollSecret', () => {
    it('is 32 bytes encoded as base64url', () => {
        const secret = generatePollSecret();
        expect(secret).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(Buffer.from(secret, 'base64url')).toHaveLength(32);
    });

    it('is random', () => {
        expect(generatePollSecret()).not.toBe(generatePollSecret());
    });
});

describe('formatManualCode / normalizeApproveSecret', () => {
    it('formats as XXXX-XXXX-XXXX', () => {
        expect(formatManualCode('ABCDEFGHJKMN')).toBe('ABCD-EFGH-JKMN');
    });

    it('strips dashes and whitespace and uppercases', () => {
        expect(normalizeApproveSecret(' abcd-efgh jkmn ')).toBe('ABCDEFGHJKMN');
    });

    it('maps Crockford look-alikes: O→0, I→1, L→1', () => {
        expect(normalizeApproveSecret('OIL0')).toBe('0110');
        expect(normalizeApproveSecret('oil')).toBe('011');
    });

    it('round-trips a generated secret through the manual code', () => {
        for (let i = 0; i < 50; i += 1) {
            const secret = generateApproveSecret();
            expect(normalizeApproveSecret(formatManualCode(secret))).toBe(secret);
            expect(normalizeApproveSecret(formatManualCode(secret).toLowerCase())).toBe(secret);
        }
    });

    it('is idempotent', () => {
        const once = normalizeApproveSecret('ab-cd il o0');
        expect(normalizeApproveSecret(once)).toBe(once);
    });

    it('tolerates non-string input', () => {
        expect(normalizeApproveSecret(undefined as unknown as string)).toBe('');
    });
});

describe('isValidApproveSecret', () => {
    it('accepts a normalized 12-char Crockford secret', () => {
        expect(isValidApproveSecret('0123456789AB')).toBe(true);
        expect(isValidApproveSecret(generateApproveSecret())).toBe(true);
    });

    it('rejects wrong length', () => {
        expect(isValidApproveSecret('0123456789A')).toBe(false);
        expect(isValidApproveSecret('0123456789ABC')).toBe(false);
        expect(isValidApproveSecret('')).toBe(false);
    });

    it('rejects characters outside the alphabet', () => {
        expect(isValidApproveSecret('0123456789AU')).toBe(false);
        expect(isValidApproveSecret('0123456789ab')).toBe(false);
        expect(isValidApproveSecret('0123-4567-89')).toBe(false);
    });
});

describe('hashSecret', () => {
    it('is sha256 hex', () => {
        const expected = createHash('sha256').update('secret').digest('hex');
        expect(hashSecret('secret')).toBe(expected);
        expect(hashSecret('secret')).toHaveLength(64);
    });

    it('differs for different inputs', () => {
        expect(hashSecret('a')).not.toBe(hashSecret('b'));
    });
});

describe('getPublicAppUrl / buildQrUrl / buildApprovePath', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('defaults to the production domain', () => {
        vi.stubEnv('PUBLIC_APP_URL', '');
        expect(getPublicAppUrl()).toBe('https://univerkstu.app');
    });

    it('honours PUBLIC_APP_URL and strips a trailing slash', () => {
        vi.stubEnv('PUBLIC_APP_URL', 'http://localhost:3001/');
        expect(getPublicAppUrl()).toBe('http://localhost:3001');
    });

    it('builds the approve path with url-encoded query', () => {
        expect(buildApprovePath('abc-123', 'ABCDEFGHJKMN')).toBe('/login/approve?c=abc-123&s=ABCDEFGHJKMN');
        expect(buildApprovePath('a b', 'x&y')).toBe('/login/approve?c=a+b&s=x%26y');
    });

    it('QR url = PUBLIC_APP_URL + approve path (approveSecret only, never pollSecret)', () => {
        vi.stubEnv('PUBLIC_APP_URL', 'https://example.test');
        const url = buildQrUrl('id-1', 'ABCDEFGHJKMN');
        expect(url).toBe('https://example.test/login/approve?c=id-1&s=ABCDEFGHJKMN');
        expect(url).not.toContain('poll');
    });
});

describe('isChallengeExpired', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');

    it('true for pending past expires_at', () => {
        expect(isChallengeExpired({ status: 'pending', expiresAt: new Date(now - 1) }, now)).toBe(true);
        expect(isChallengeExpired({ status: 'pending', expiresAt: new Date(now) }, now)).toBe(true);
    });

    it('false for pending in the future', () => {
        expect(isChallengeExpired({ status: 'pending', expiresAt: new Date(now + 1000) }, now)).toBe(false);
    });

    it('false for non-pending statuses even when past expires_at', () => {
        expect(isChallengeExpired({ status: 'approved', expiresAt: new Date(now - 1) }, now)).toBe(false);
        expect(isChallengeExpired({ status: 'consumed', expiresAt: new Date(now - 1) }, now)).toBe(false);
        expect(isChallengeExpired({ status: 'denied', expiresAt: new Date(now - 1) }, now)).toBe(false);
    });
});
