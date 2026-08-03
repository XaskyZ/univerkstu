/**
 * Centralized theme gating rules.
 *
 * Themes split into three states from the user's perspective:
 *   - free      → no gate, anyone can apply
 *   - locked    → gated and not yet earned by this user
 *   - unlocked  → gated and the user has met the requirement
 *
 * Only gated themes appear in `THEME_UNLOCK_REQUIREMENTS`. Anything missing
 * from the table is treated as `free` (default-on, no gate).
 *
 * The frontend uses these helpers for UX hints; the actual enforcement lives
 * on the backend persistence path (so client tampering cannot bypass the
 * gate). See `backend/src/routes/status.ts` PATCH /status/settings.
 */
import type { Theme } from './theme-context';
import type { SupportTierId } from './api';

export type ThemeUnlockState = 'free' | 'locked' | 'unlocked';

export interface ThemeUnlockContext {
    referralCount: number;
    /** Highest verified supporter tier, or `null` if not a supporter. */
    supporterTier: SupportTierId | null;
}

export type ThemeUnlockRequirement =
    | { kind: 'referrals'; minReferrals: number }
    | { kind: 'supporter'; minTier: SupportTierId };

/**
 * Supporter tiers ranked by strength. Used for `>=` comparisons when a theme
 * requires a minimum tier (e.g. boost+ would accept boost or hero, but not
 * friend). Mirrors `SUPPORT_TIERS` ranks in `backend/src/services/support.ts`.
 */
const SUPPORTER_TIER_RANK: Record<SupportTierId, number> = {
    friend: 1,
    boost: 2,
    hero: 3,
};

/**
 * Both supporter themes unlock at `friend+` (any verified supporter).
 * Rationale: the `/support` page itself treats supporter themes as a single
 * unlock keyed off `supporter.enabled`, so this picker matches that contract.
 * If we later split per tier (e.g. midnight = hero), bump `minTier` here —
 * the comparison is rank-based and will Just Work.
 */
export const THEME_UNLOCK_REQUIREMENTS: Partial<Record<Theme, ThemeUnlockRequirement>> = {
    'referral-sherbet': { kind: 'referrals', minReferrals: 3 },
    'referral-nebula': { kind: 'referrals', minReferrals: 7 },
    'supporter-paper': { kind: 'supporter', minTier: 'friend' },
    'supporter-midnight': { kind: 'supporter', minTier: 'friend' },
};

export function getThemeUnlockRequirement(theme: Theme): ThemeUnlockRequirement | null {
    return THEME_UNLOCK_REQUIREMENTS[theme] || null;
}

export function isThemeUnlocked(theme: Theme, ctx: ThemeUnlockContext): boolean {
    const requirement = getThemeUnlockRequirement(theme);
    if (!requirement) return true;
    if (requirement.kind === 'referrals') {
        return ctx.referralCount >= requirement.minReferrals;
    }
    // supporter: rank-based >= comparison; non-supporters always fail.
    if (!ctx.supporterTier) return false;
    return SUPPORTER_TIER_RANK[ctx.supporterTier] >= SUPPORTER_TIER_RANK[requirement.minTier];
}

export function getThemeUnlockState(theme: Theme, ctx: ThemeUnlockContext): ThemeUnlockState {
    if (!getThemeUnlockRequirement(theme)) return 'free';
    return isThemeUnlocked(theme, ctx) ? 'unlocked' : 'locked';
}

/**
 * Short, user-facing label describing how to unlock a gated theme. Used in
 * tile subtitles and lock toasts. Returns plain text — no markup — so the
 * caller decides styling.
 */
export function describeThemeUnlock(
    requirement: ThemeUnlockRequirement,
    lang: 'ru' | 'kz' | 'en'
): string {
    if (requirement.kind === 'referrals') {
        const count = requirement.minReferrals;
        if (lang === 'kz') return `${count} реферал қажет`;
        if (lang === 'en') return `${count} referrals required`;
        return `Нужно ${count} рефералов`;
    }
    // supporter
    const tierLabel = requirement.minTier === 'friend'
        ? 'Friend+'
        : requirement.minTier === 'boost'
            ? 'Boost+'
            : 'Hero';
    if (lang === 'kz') return `Жобаны қолдау қажет (${tierLabel})`;
    if (lang === 'en') return `Project support required (${tierLabel})`;
    return `Нужна поддержка проекта (${tierLabel})`;
}
