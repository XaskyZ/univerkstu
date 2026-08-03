/**
 * Server-side theme gating. Mirrors `frontend/src/lib/theme-unlocks.ts` —
 * keep the two files in sync when adding/removing gated themes.
 *
 * The backend is the authoritative source: the frontend uses the rules for
 * UX hints (locked tiles, lock toasts), but the actual enforcement happens
 * here on the persistence path so client tampering cannot bypass the gate.
 */
import type { AppThemeId } from '../types/index.js';

export type SupportTierId = 'friend' | 'boost' | 'hero';

export type ThemeUnlockRequirement =
    | { kind: 'referrals'; minReferrals: number }
    | { kind: 'supporter'; minTier: SupportTierId };

/** Tier strength ordering. Mirrors `SUPPORT_TIERS` ranks in support.ts. */
const SUPPORTER_TIER_RANK: Record<SupportTierId, number> = {
    friend: 1,
    boost: 2,
    hero: 3,
};

/**
 * Gated theme → requirement. Anything missing is "free" — no gate.
 * Keep aligned with the frontend table.
 */
export const THEME_UNLOCK_REQUIREMENTS: Partial<Record<AppThemeId, ThemeUnlockRequirement>> = {
    'referral-sherbet': { kind: 'referrals', minReferrals: 3 },
    'referral-nebula': { kind: 'referrals', minReferrals: 7 },
    'supporter-paper': { kind: 'supporter', minTier: 'friend' },
    'supporter-midnight': { kind: 'supporter', minTier: 'friend' },
};

export function getThemeUnlockRequirement(theme: AppThemeId): ThemeUnlockRequirement | null {
    return THEME_UNLOCK_REQUIREMENTS[theme] || null;
}

export interface ThemeUnlockContext {
    referralCount: number;
    supporterTier: SupportTierId | null;
}

/**
 * Pure check. Returns `true` for free themes and for gated themes the user
 * has earned; `false` only when the theme is gated AND the user does not
 * meet the requirement. No DB access — caller supplies fresh ctx.
 */
export function isThemeUnlocked(theme: AppThemeId, ctx: ThemeUnlockContext): boolean {
    const requirement = getThemeUnlockRequirement(theme);
    if (!requirement) return true;
    if (requirement.kind === 'referrals') {
        return ctx.referralCount >= requirement.minReferrals;
    }
    if (!ctx.supporterTier) return false;
    return SUPPORTER_TIER_RANK[ctx.supporterTier] >= SUPPORTER_TIER_RANK[requirement.minTier];
}

export interface ThemeUnlockEntitlementProviders {
    /** Returns the user's current referral count (only called when needed). */
    getReferralCount: (userId: string) => Promise<number>;
    /** Returns the user's highest verified supporter tier, or null. */
    getSupporterTier: (userId: string) => Promise<SupportTierId | null>;
}

export type ThemeUnlockCheckResult =
    | { ok: true }
    | { ok: false; reason: 'locked'; requirement: ThemeUnlockRequirement }
    | { ok: false; reason: 'unavailable' };

/**
 * Resolves whether a user is allowed to persist `theme`. Free themes pass
 * without touching the DB; gated themes pull only the entitlement they need
 * (referral count XOR supporter tier). Returns a structured result so the
 * caller can map to HTTP status + errorCode without try/catch noise.
 */
export async function checkThemeEntitlement(
    userId: string,
    theme: AppThemeId,
    providers: ThemeUnlockEntitlementProviders,
): Promise<ThemeUnlockCheckResult> {
    const requirement = getThemeUnlockRequirement(theme);
    if (!requirement) return { ok: true };
    try {
        if (requirement.kind === 'referrals') {
            const count = await providers.getReferralCount(userId);
            const ctx: ThemeUnlockContext = { referralCount: count, supporterTier: null };
            return isThemeUnlocked(theme, ctx)
                ? { ok: true }
                : { ok: false, reason: 'locked', requirement };
        }
        const tier = await providers.getSupporterTier(userId);
        const ctx: ThemeUnlockContext = { referralCount: 0, supporterTier: tier };
        return isThemeUnlocked(theme, ctx)
            ? { ok: true }
            : { ok: false, reason: 'locked', requirement };
    } catch {
        return { ok: false, reason: 'unavailable' };
    }
}
