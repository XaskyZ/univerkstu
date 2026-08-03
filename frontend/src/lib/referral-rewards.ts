import type { Theme } from './theme-context';

export type ReferralBadgeId = 'scout' | 'connector' | 'ambassador' | 'legend';

export interface ReferralBadgeTier {
    id: ReferralBadgeId;
    minReferrals: number;
    icon: string;
}

export interface ReferralThemeUnlock {
    theme: Theme;
    minReferrals: number;
}

export const REFERRAL_BADGE_TIERS: ReferralBadgeTier[] = [
    { id: 'legend', minReferrals: 15, icon: '👑' },
    { id: 'ambassador', minReferrals: 7, icon: '🏆' },
    { id: 'connector', minReferrals: 3, icon: '⚡' },
    { id: 'scout', minReferrals: 1, icon: '🎖️' },
];

export const REFERRAL_THEME_UNLOCKS: ReferralThemeUnlock[] = [
    { theme: 'referral-sherbet', minReferrals: 3 },
    { theme: 'referral-nebula', minReferrals: 7 },
];

export function getReferralBadgeTier(referralCount: number): ReferralBadgeTier | null {
    return REFERRAL_BADGE_TIERS.find((tier) => referralCount >= tier.minReferrals) || null;
}

export function getUnlockedReferralThemes(referralCount: number): Theme[] {
    return REFERRAL_THEME_UNLOCKS
        .filter((entry) => referralCount >= entry.minReferrals)
        .map((entry) => entry.theme);
}
