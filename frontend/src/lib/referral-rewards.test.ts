import { describe, it, expect } from 'vitest';
import {
    REFERRAL_BADGE_TIERS,
    REFERRAL_THEME_UNLOCKS,
    getReferralBadgeTier,
    getUnlockedReferralThemes,
} from './referral-rewards';

describe('REFERRAL_BADGE_TIERS', () => {
    it('is sorted by minReferrals descending so first match wins', () => {
        const counts = REFERRAL_BADGE_TIERS.map((t) => t.minReferrals);
        const sorted = [...counts].sort((a, b) => b - a);
        expect(counts).toEqual(sorted);
    });

    it('covers all four badge ids', () => {
        const ids = new Set(REFERRAL_BADGE_TIERS.map((t) => t.id));
        expect(ids).toEqual(new Set(['legend', 'ambassador', 'connector', 'scout']));
    });
});

describe('getReferralBadgeTier', () => {
    it('returns null below the lowest threshold', () => {
        expect(getReferralBadgeTier(0)).toBeNull();
    });

    it('returns scout at 1-2 referrals', () => {
        expect(getReferralBadgeTier(1)?.id).toBe('scout');
        expect(getReferralBadgeTier(2)?.id).toBe('scout');
    });

    it('returns connector at 3-6 referrals', () => {
        expect(getReferralBadgeTier(3)?.id).toBe('connector');
        expect(getReferralBadgeTier(6)?.id).toBe('connector');
    });

    it('returns ambassador at 7-14 referrals', () => {
        expect(getReferralBadgeTier(7)?.id).toBe('ambassador');
        expect(getReferralBadgeTier(14)?.id).toBe('ambassador');
    });

    it('returns legend at 15+ referrals (incl. extremes)', () => {
        expect(getReferralBadgeTier(15)?.id).toBe('legend');
        expect(getReferralBadgeTier(100)?.id).toBe('legend');
    });

    it('attaches the proper icon for each tier', () => {
        expect(getReferralBadgeTier(1)?.icon).toBe('🎖️');
        expect(getReferralBadgeTier(3)?.icon).toBe('⚡');
        expect(getReferralBadgeTier(7)?.icon).toBe('🏆');
        expect(getReferralBadgeTier(15)?.icon).toBe('👑');
    });
});

describe('getUnlockedReferralThemes', () => {
    it('returns empty array below the first theme threshold', () => {
        expect(getUnlockedReferralThemes(0)).toEqual([]);
        expect(getUnlockedReferralThemes(2)).toEqual([]);
    });

    it('unlocks referral-sherbet at 3 referrals', () => {
        expect(getUnlockedReferralThemes(3)).toContain('referral-sherbet');
        expect(getUnlockedReferralThemes(3)).not.toContain('referral-nebula');
    });

    it('unlocks both themes at 7+ referrals', () => {
        const themes = getUnlockedReferralThemes(7);
        expect(themes).toContain('referral-sherbet');
        expect(themes).toContain('referral-nebula');
    });

    it('stays stable at very high counts', () => {
        expect(getUnlockedReferralThemes(100).length).toBe(REFERRAL_THEME_UNLOCKS.length);
    });
});
