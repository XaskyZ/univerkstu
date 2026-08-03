import { describe, it, expect, vi } from 'vitest';
import {
    checkThemeEntitlement,
    getThemeUnlockRequirement,
    isThemeUnlocked,
    THEME_UNLOCK_REQUIREMENTS,
} from './theme-unlocks.js';

describe('getThemeUnlockRequirement', () => {
    it('returns null for free themes', () => {
        expect(getThemeUnlockRequirement('light')).toBeNull();
        expect(getThemeUnlockRequirement('dark')).toBeNull();
        expect(getThemeUnlockRequirement('pastel')).toBeNull();
        expect(getThemeUnlockRequirement('matrix')).toBeNull();
    });

    it('returns referral requirement for referral themes', () => {
        expect(getThemeUnlockRequirement('referral-sherbet')).toEqual({
            kind: 'referrals',
            minReferrals: 3,
        });
        expect(getThemeUnlockRequirement('referral-nebula')).toEqual({
            kind: 'referrals',
            minReferrals: 7,
        });
    });

    it('returns supporter requirement for supporter themes', () => {
        expect(getThemeUnlockRequirement('supporter-paper')).toEqual({
            kind: 'supporter',
            minTier: 'friend',
        });
        expect(getThemeUnlockRequirement('supporter-midnight')).toEqual({
            kind: 'supporter',
            minTier: 'friend',
        });
    });
});

describe('isThemeUnlocked', () => {
    const noReferrals = { referralCount: 0, supporterTier: null };
    const fullyEarned = { referralCount: 100, supporterTier: 'hero' as const };

    describe('free themes', () => {
        // Anything not in THEME_UNLOCK_REQUIREMENTS must pass for everyone —
        // we don't want the gate to accidentally lock baseline UX themes.
        it('accepts free themes for any context', () => {
            expect(isThemeUnlocked('light', noReferrals)).toBe(true);
            expect(isThemeUnlocked('dark', noReferrals)).toBe(true);
            expect(isThemeUnlocked('system', noReferrals)).toBe(true);
            expect(isThemeUnlocked('pastel', noReferrals)).toBe(true);
            expect(isThemeUnlocked('aurora', noReferrals)).toBe(true);
        });
    });

    describe('referral themes', () => {
        // Threshold is inclusive (>=). Set this in stone — a regression that
        // shifts to strict > would silently lock users at exactly 3 or 7.
        it('locks sherbet below 3 referrals', () => {
            expect(isThemeUnlocked('referral-sherbet', { referralCount: 0, supporterTier: null })).toBe(false);
            expect(isThemeUnlocked('referral-sherbet', { referralCount: 2, supporterTier: null })).toBe(false);
        });

        it('unlocks sherbet at exactly 3 referrals', () => {
            expect(isThemeUnlocked('referral-sherbet', { referralCount: 3, supporterTier: null })).toBe(true);
            expect(isThemeUnlocked('referral-sherbet', { referralCount: 10, supporterTier: null })).toBe(true);
        });

        it('locks nebula below 7 referrals (even if sherbet unlocked)', () => {
            expect(isThemeUnlocked('referral-nebula', { referralCount: 6, supporterTier: null })).toBe(false);
        });

        it('unlocks nebula at exactly 7 referrals', () => {
            expect(isThemeUnlocked('referral-nebula', { referralCount: 7, supporterTier: null })).toBe(true);
        });

        it('supporter status does not satisfy referral gate', () => {
            // Cross-kind: a hero supporter with zero referrals still cannot
            // wear a referral theme. Each gate is independent.
            expect(isThemeUnlocked('referral-sherbet', { referralCount: 0, supporterTier: 'hero' })).toBe(false);
        });
    });

    describe('supporter themes', () => {
        it('locks both supporter themes for non-supporters', () => {
            expect(isThemeUnlocked('supporter-paper', noReferrals)).toBe(false);
            expect(isThemeUnlocked('supporter-midnight', noReferrals)).toBe(false);
        });

        it('unlocks supporter themes for any verified tier (friend+)', () => {
            // Product decision: both supporter themes share a single unlock
            // at any supporter tier. If we later split per tier, this test
            // should encode the new ranks.
            expect(isThemeUnlocked('supporter-paper', { referralCount: 0, supporterTier: 'friend' })).toBe(true);
            expect(isThemeUnlocked('supporter-paper', { referralCount: 0, supporterTier: 'boost' })).toBe(true);
            expect(isThemeUnlocked('supporter-paper', { referralCount: 0, supporterTier: 'hero' })).toBe(true);
            expect(isThemeUnlocked('supporter-midnight', { referralCount: 0, supporterTier: 'friend' })).toBe(true);
        });

        it('referral count does not satisfy supporter gate', () => {
            expect(isThemeUnlocked('supporter-midnight', { referralCount: 100, supporterTier: null })).toBe(false);
        });
    });

    it('fully-earned context unlocks everything', () => {
        for (const key of Object.keys(THEME_UNLOCK_REQUIREMENTS) as Array<keyof typeof THEME_UNLOCK_REQUIREMENTS>) {
            expect(isThemeUnlocked(key, fullyEarned)).toBe(true);
        }
    });
});

describe('checkThemeEntitlement', () => {
    // Exercises the persistence-path guard. Spec spells out five required cases
    // (a) free theme accepted; (b) unlocked referral theme accepted; (c) locked
    // referral theme rejected; (d) supporter theme accepted for supporter;
    // (e) supporter theme rejected for non-supporter.

    const makeProviders = (referralCount: number, supporterTier: 'friend' | 'boost' | 'hero' | null) => ({
        getReferralCount: vi.fn().mockResolvedValue(referralCount),
        getSupporterTier: vi.fn().mockResolvedValue(supporterTier),
    });

    it('(a) accepts free theme without touching entitlement providers', async () => {
        const providers = makeProviders(0, null);
        const result = await checkThemeEntitlement('alice', 'light', providers);
        expect(result).toEqual({ ok: true });
        // Free themes must not hit the DB — otherwise every settings PATCH
        // would do extra round-trips for no reason.
        expect(providers.getReferralCount).not.toHaveBeenCalled();
        expect(providers.getSupporterTier).not.toHaveBeenCalled();
    });

    it('(b) accepts referral theme when count meets threshold', async () => {
        const providers = makeProviders(5, null);
        const result = await checkThemeEntitlement('alice', 'referral-sherbet', providers);
        expect(result).toEqual({ ok: true });
        expect(providers.getReferralCount).toHaveBeenCalledWith('alice');
        // Referral-kind path must not ask for supporter tier.
        expect(providers.getSupporterTier).not.toHaveBeenCalled();
    });

    it('(c) rejects referral theme when count is below threshold', async () => {
        const providers = makeProviders(2, null);
        const result = await checkThemeEntitlement('alice', 'referral-sherbet', providers);
        expect(result).toEqual({
            ok: false,
            reason: 'locked',
            requirement: { kind: 'referrals', minReferrals: 3 },
        });
    });

    it('(d) accepts supporter theme for any verified supporter', async () => {
        const friendProviders = makeProviders(0, 'friend');
        expect(await checkThemeEntitlement('alice', 'supporter-midnight', friendProviders)).toEqual({ ok: true });

        const heroProviders = makeProviders(0, 'hero');
        expect(await checkThemeEntitlement('alice', 'supporter-paper', heroProviders)).toEqual({ ok: true });
    });

    it('(e) rejects supporter theme when user is not a supporter', async () => {
        const providers = makeProviders(100, null);
        const result = await checkThemeEntitlement('alice', 'supporter-midnight', providers);
        expect(result).toEqual({
            ok: false,
            reason: 'locked',
            requirement: { kind: 'supporter', minTier: 'friend' },
        });
        // High referral count must not satisfy a supporter gate.
        expect(providers.getSupporterTier).toHaveBeenCalledWith('alice');
    });

    it('fail-closed: provider throw → unavailable (not silently allowed)', async () => {
        // If we cannot verify entitlement (DB outage), the route returns 503
        // so the user keeps their prior theme rather than persisting a gated
        // one without proof.
        const providers = {
            getReferralCount: vi.fn().mockRejectedValue(new Error('db down')),
            getSupporterTier: vi.fn().mockResolvedValue(null),
        };
        const result = await checkThemeEntitlement('alice', 'referral-nebula', providers);
        expect(result).toEqual({ ok: false, reason: 'unavailable' });
    });
});
