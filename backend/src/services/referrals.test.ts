import { describe, it, expect, beforeEach, vi } from 'vitest';

// The claim path is DB-coupled, so drive it through an in-memory client that
// mimics the subset of SQL `claimReferralInternal` issues. This is what lets us
// reproduce the two-inviters-race deterministically without Postgres.
vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(),
}));

import { withSupabasePostgres } from '../db/postgres.js';
import {
    normalizeReferralCode,
    buildReferralCode,
    maskDisplayName,
    explicitDisplayName,
    canStillClaimReferral,
    claimReferralCode,
} from './referrals.js';

describe('normalizeReferralCode', () => {
    it('returns empty string for non-string inputs', () => {
        expect(normalizeReferralCode(null)).toBe('');
        expect(normalizeReferralCode(undefined)).toBe('');
        expect(normalizeReferralCode(42)).toBe('');
        expect(normalizeReferralCode({})).toBe('');
        expect(normalizeReferralCode([])).toBe('');
    });

    it('uppercases the input', () => {
        expect(normalizeReferralCode('abcd1234')).toBe('ABCD1234');
        expect(normalizeReferralCode('mixed123')).toBe('MIXED123');
    });

    it('trims surrounding whitespace before processing', () => {
        expect(normalizeReferralCode('  abc  ')).toBe('ABC');
    });

    it('strips non-alphanumeric characters (after uppercase)', () => {
        expect(normalizeReferralCode('a-b_c d')).toBe('ABCD');
        expect(normalizeReferralCode('abc!@#$%^&*()def')).toBe('ABCDEF');
    });

    it('strips Cyrillic (only A-Z and 0-9 are kept)', () => {
        expect(normalizeReferralCode('Иванов123')).toBe('123');
        expect(normalizeReferralCode('абвXYZ')).toBe('XYZ');
    });

    it('strips emoji and other non-ASCII', () => {
        expect(normalizeReferralCode('ABC🎉123')).toBe('ABC123');
    });

    it('caps output at 16 chars', () => {
        expect(normalizeReferralCode('A'.repeat(20))).toBe('AAAAAAAAAAAAAAAA');
        expect(normalizeReferralCode('A'.repeat(20)).length).toBe(16);
    });

    it('empty/whitespace-only input → empty string', () => {
        expect(normalizeReferralCode('')).toBe('');
        expect(normalizeReferralCode('   ')).toBe('');
    });

    it('all-invalid characters → empty string', () => {
        expect(normalizeReferralCode('!!!')).toBe('');
        expect(normalizeReferralCode('абв')).toBe('');
    });

    it('idempotent: applying twice yields the same result', () => {
        const once = normalizeReferralCode('  abc-def!ghi  ');
        expect(normalizeReferralCode(once)).toBe(once);
    });
});

describe('buildReferralCode', () => {
    // The alphabet deliberately omits I/O/0/1 to avoid OCR confusion when the
    // code is read off a screen and typed in. Length is 8.
    const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

    it('returns an 8-character code', () => {
        expect(buildReferralCode()).toHaveLength(8);
    });

    it('only contains characters from the unambiguous alphabet (no I/O/0/1)', () => {
        // Run 100 trials to make the alphabet violation likelihood near 100% if it existed.
        for (let i = 0; i < 100; i += 1) {
            const code = buildReferralCode();
            for (const char of code) {
                expect(CODE_ALPHABET).toContain(char);
            }
            // Explicit anti-assertions to make the intent loud-and-clear:
            expect(code).not.toMatch(/[IO01]/);
        }
    });

    it('produces different codes across calls (collision exceedingly unlikely)', () => {
        const codes = new Set<string>();
        for (let i = 0; i < 50; i += 1) {
            codes.add(buildReferralCode());
        }
        // 50 random 8-char codes from 32-char alphabet → collision space is 32^8 = 1.1e12.
        // Probability of any duplicate among 50 codes is < 1e-9.
        expect(codes.size).toBe(50);
    });

    it('round-trips through normalizeReferralCode unchanged (already canonical)', () => {
        for (let i = 0; i < 20; i += 1) {
            const code = buildReferralCode();
            expect(normalizeReferralCode(code)).toBe(code);
        }
    });
});

describe('maskDisplayName', () => {
    // Leaderboard "FirstName L." mask. Privacy-aware: avoids exposing the full
    // last name in public leaderboard listings.

    it('falls back to "Студент <userId-prefix>" when value is empty/null/undefined', () => {
        expect(maskDisplayName(null, 'user12345')).toBe('Студент user');
        expect(maskDisplayName(undefined, 'user12345')).toBe('Студент user');
        expect(maskDisplayName('', 'abcdefgh')).toBe('Студент abcd');
        expect(maskDisplayName('   ', 'shorts')).toBe('Студент shor');
    });

    it('single-token name uses the only token, no initial', () => {
        expect(maskDisplayName('Иван', 'x')).toBe('Иван');
    });

    it('"Surname FirstName" → "FirstName S."', () => {
        // The KSTU full-name order is Surname-First-Middle. Mask exposes the first name
        // (more humane) and just the surname initial.
        expect(maskDisplayName('Иванов Иван', 'x')).toBe('Иван И.');
        expect(maskDisplayName('Смит Джон', 'x')).toBe('Джон С.');
    });

    it('"Surname FirstName Patronymic" → still "FirstName S." (only surname is masked)', () => {
        expect(maskDisplayName('Иванов Иван Петрович', 'x')).toBe('Иван И.');
    });

    it('collapses extra whitespace', () => {
        expect(maskDisplayName('  Иванов   Иван  ', 'x')).toBe('Иван И.');
    });

    it('handles Latin names', () => {
        expect(maskDisplayName('Smith John', 'x')).toBe('John S.');
    });
});

describe('explicitDisplayName', () => {
    // Reads the user-set leaderboard display name from their settings.
    // Cap at 40 chars to prevent abuse; collapse whitespace; reject non-strings.

    it('returns null for non-string inputs', () => {
        expect(explicitDisplayName(null)).toBe(null);
        expect(explicitDisplayName(undefined)).toBe(null);
        expect(explicitDisplayName(42)).toBe(null);
        expect(explicitDisplayName({})).toBe(null);
    });

    it('returns null for empty/whitespace-only strings', () => {
        expect(explicitDisplayName('')).toBe(null);
        expect(explicitDisplayName('   ')).toBe(null);
    });

    it('trims and collapses internal whitespace', () => {
        expect(explicitDisplayName('  Ник  имя  ')).toBe('Ник имя');
    });

    it('caps output at 40 chars', () => {
        const longName = 'A'.repeat(50);
        const result = explicitDisplayName(longName);
        expect(result).toBe('A'.repeat(40));
        expect(result!.length).toBe(40);
    });

    it('preserves Cyrillic and emoji within the cap', () => {
        expect(explicitDisplayName('Гений 🧠')).toBe('Гений 🧠');
    });
});

describe('canStillClaimReferral', () => {
    // 7-day claim window from account creation. After expiry, users can no
    // longer claim a referral inviter. Already-claimed users always return false.

    const CLAIM_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

    it('returns false when user has already been referred (any non-empty inviter blocks future claims)', () => {
        const fresh = new Date(Date.now() - 60 * 1000);
        expect(canStillClaimReferral(fresh, 'inviter-id')).toBe(false);
    });

    it('returns true within the 7-day window when not yet referred', () => {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        expect(canStillClaimReferral(oneDayAgo, null)).toBe(true);
        expect(canStillClaimReferral(oneDayAgo, undefined)).toBe(true);
        expect(canStillClaimReferral(oneDayAgo, '')).toBe(true); // empty inviter treated as null
    });

    it('returns true exactly at the 7-day boundary (inclusive)', () => {
        const exactlyOnLimit = new Date(Date.now() - CLAIM_WINDOW_MS);
        expect(canStillClaimReferral(exactlyOnLimit, null)).toBe(true);
    });

    it('returns false past the 7-day window', () => {
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
        expect(canStillClaimReferral(eightDaysAgo, null)).toBe(false);
    });

    it('inviter-set takes precedence over window check (already claimed even within window)', () => {
        const fresh = new Date();
        expect(canStillClaimReferral(fresh, 'inviter-id')).toBe(false);
    });
});

describe('claimReferralCode — concurrent-claim guard', () => {
    // The claim UPDATE carries `and referred_by_user_id is null`, so exactly one
    // of two simultaneous claims wins the row. The loser's UPDATE matches zero
    // rows, but re-reading the row afterwards returns the WINNER's inviter — so
    // the post-update guard must compare identity, not truthiness. If it only
    // checked truthiness, the loser would proceed to award 100 points to ITS own
    // inviter plus a second 25-point welcome bonus to the invited user, and the
    // `on conflict (user_id, reward_type, referral_user_id)` dedupe would not
    // catch it because `referral_user_id` differs between the two inviters.

    const INVITED = 'invited-user';
    const MY_INVITER = 'inviter-alpha';
    const WINNER_INVITER = 'inviter-beta';

    interface Recorded { sql: string; params: unknown[] }

    function buildClient(outcome: 'win' | 'lose') {
        const recorded: Recorded[] = [];
        const profile = {
            user_id: INVITED,
            code: 'INVITEDX',
            created_at: new Date(),
            updated_at: new Date(),
            referred_by_user_id: null as string | null,
            referred_by_code: null as string | null,
            referred_at: null as Date | null,
            referred_source: null as string | null,
        };

        const query = vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().replace(/\s+/g, ' ').toLowerCase();
            recorded.push({ sql: text, params });

            if (text === 'begin' || text === 'commit' || text === 'rollback') {
                return { rows: [], rowCount: 0 };
            }
            if (text.includes('from app_users where user_id')) {
                // Fresh account → inside the 7-day manual-claim window.
                return { rows: [{ created_at: new Date() }], rowCount: 1 };
            }
            if (text.includes('from app_user_referrals where code =')) {
                return {
                    rows: [{ ...profile, user_id: MY_INVITER, code: 'ALPHA123', referred_by_user_id: null }],
                    rowCount: 1,
                };
            }
            if (text.includes('from app_user_referrals where user_id =')) {
                return { rows: [{ ...profile }], rowCount: 1 };
            }
            if (text.startsWith('update app_user_referrals')) {
                if (outcome === 'win') {
                    profile.referred_by_user_id = params[1] as string;
                    return { rows: [], rowCount: 1 };
                }
                // Lost the race: our UPDATE matched nothing because a concurrent
                // claim already set a DIFFERENT inviter on the same row.
                profile.referred_by_user_id = WINNER_INVITER;
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('insert into app_referral_reward_events')) {
                return { rows: [], rowCount: 1 };
            }
            throw new Error(`unexpected SQL in test: ${text}`);
        });

        return { client: { query } as never, recorded, query };
    }

    function rewardInserts(recorded: Recorded[]): Recorded[] {
        return recorded.filter((entry) => entry.sql.startsWith('insert into app_referral_reward_events'));
    }

    beforeEach(() => {
        vi.mocked(withSupabasePostgres).mockReset();
    });

    it('the winning claim applies and awards both reward rows', async () => {
        const { client, recorded } = buildClient('win');
        vi.mocked(withSupabasePostgres).mockImplementation(async (handler: never) =>
            (handler as unknown as (c: unknown) => Promise<unknown>)(client));

        const status = await claimReferralCode(INVITED, 'ALPHA123');

        expect(status).toBe('applied');
        expect(rewardInserts(recorded)).toHaveLength(2);
        expect(recorded.some((entry) => entry.sql === 'commit')).toBe(true);
    });

    it('the LOSING claim returns already_claimed and awards nothing', async () => {
        const { client, recorded } = buildClient('lose');
        vi.mocked(withSupabasePostgres).mockImplementation(async (handler: never) =>
            (handler as unknown as (c: unknown) => Promise<unknown>)(client));

        const status = await claimReferralCode(INVITED, 'ALPHA123');

        // Regression guard: with a truthiness-only check this returned 'applied'.
        expect(status).toBe('already_claimed');
        expect(rewardInserts(recorded)).toHaveLength(0);
    });

    it('the loser never writes a reward row naming its own inviter', async () => {
        const { client, recorded } = buildClient('lose');
        vi.mocked(withSupabasePostgres).mockImplementation(async (handler: never) =>
            (handler as unknown as (c: unknown) => Promise<unknown>)(client));

        await claimReferralCode(INVITED, 'ALPHA123');

        const mentionsLoserInviter = recorded.some(
            (entry) => entry.sql.startsWith('insert into app_referral_reward_events')
                && entry.params.includes(MY_INVITER),
        );
        expect(mentionsLoserInviter).toBe(false);
    });
});
