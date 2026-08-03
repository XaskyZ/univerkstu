'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Lock } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { THEMES, useTheme, type Theme } from '@/lib/theme-context';
import {
    describeThemeUnlock,
    getThemeUnlockRequirement,
    isThemeUnlocked,
    type ThemeUnlockContext,
    type ThemeUnlockRequirement,
} from '@/lib/theme-unlocks';
import { getReferralOverview, getSupportOverview, updateThemeSetting, type SupportTierId } from '@/lib/api';
import { PageMain, PageShell } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';

/**
 * Theme picker sub-screen. Replaces the old SettingsThemeCard inline picker.
 * Shows every theme registered in THEMES (light/dark/deep-blue/aurora/sunset/
 * matrix/pastel + referral and supporter palettes) as a tappable swatch tile.
 *
 * Selection writes through useTheme().setTheme, which persists to localStorage
 * and applies CSS variables globally via the ThemeProvider. Gated themes
 * (referral / supporter) render as locked tiles with a Lock icon overlay and
 * a CTA toast pointing to the screen that unlocks them. The backend is the
 * source of truth — see `backend/src/routes/status.ts` PATCH /status/settings.
 */
export default function SettingsThemePage() {
    const { isAuth, loading } = useAuth();
    const { messages, language } = useLanguage();
    const { theme, setTheme } = useTheme();
    const router = useRouter();
    const ui = messages.settings.appearance;
    const [toast, setToast] = useState<{ kind: 'applied' | 'locked'; requirement: ThemeUnlockRequirement | null } | null>(null);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Earned-status context. We default to "nothing unlocked" so locked tiles
    // stay locked while we wait for the API — better than briefly flashing
    // them as available, which would invite a confused tap.
    const [unlockCtx, setUnlockCtx] = useState<ThemeUnlockContext>({
        referralCount: 0,
        supporterTier: null,
    });

    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    useEffect(() => {
        return () => {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        };
    }, []);

    useEffect(() => {
        if (!isAuth) return;
        let cancelled = false;
        (async () => {
            const [referralResult, supportResult] = await Promise.all([
                getReferralOverview(),
                getSupportOverview(),
            ]);
            if (cancelled) return;
            const referralCount = referralResult.success && referralResult.data
                ? referralResult.data.referralCount
                : 0;
            const supporterTier: SupportTierId | null = supportResult.success && supportResult.data && supportResult.data.supporter.enabled
                ? supportResult.data.supporter.highestTierId
                : null;
            setUnlockCtx({ referralCount, supporterTier });
        })();
        return () => {
            cancelled = true;
        };
    }, [isAuth]);

    const labelFor = useMemo<Record<Theme, string>>(() => ({
        light: ui.themeLight,
        dark: ui.themeDark,
        'deep-blue': ui.themeDeepBlue,
        aurora: ui.themeAurora,
        sunset: ui.themeSunset,
        matrix: ui.themeMatrix,
        pastel: ui.themePastel,
        'referral-nebula': ui.themeReferralNebula,
        'referral-sherbet': ui.themeReferralSherbet,
        'supporter-midnight': ui.themeSupporterMidnight,
        'supporter-paper': ui.themeSupporterPaper,
    }), [ui]);

    if (loading || !isAuth) return null;

    const handleSelect = async (next: Theme) => {
        if (next === theme) return;
        const requirement = getThemeUnlockRequirement(next);
        const unlocked = isThemeUnlocked(next, unlockCtx);
        if (requirement && !unlocked) {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            setToast({ kind: 'locked', requirement });
            toastTimerRef.current = setTimeout(() => setToast(null), 4000);
            return;
        }
        // Optimistic: apply immediately for snappy UX, then persist server-side.
        // If the backend rejects with THEME_LOCKED (e.g. tampered referralCount
        // cache, or supporter status was just revoked), roll back to previous.
        const previous = theme;
        setTheme(next);
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast({ kind: 'applied', requirement: null });
        toastTimerRef.current = setTimeout(() => setToast(null), 1600);

        const result = await updateThemeSetting(next);
        if (!result.success && result.errorCode === 'THEME_LOCKED') {
            setTheme(previous);
            const serverRequirement = requirement || getThemeUnlockRequirement(next);
            if (serverRequirement) {
                if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                setToast({ kind: 'locked', requirement: serverRequirement });
                toastTimerRef.current = setTimeout(() => setToast(null), 4000);
            }
        }
    };

    const formatLockedToastMessage = (requirement: ThemeUnlockRequirement): string => {
        if (requirement.kind === 'referrals') {
            return ui.themeLockedReferrals.replace('{count}', String(requirement.minReferrals));
        }
        return ui.themeLockedSupporter;
    };

    return (
        <PageShell>
            <SubScreenHeader
                title={ui.themeScreenTitle}
                subtitle={ui.themeScreenSubtitle}
            />
            <PageMain className="space-y-4" spacing="md">
                <div
                    role="radiogroup"
                    aria-label={ui.themeScreenTitle}
                    className="grid gap-3"
                    style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}
                >
                    {THEMES.map((item) => {
                        const selected = item.value === theme;
                        const requirement = getThemeUnlockRequirement(item.value);
                        const unlocked = isThemeUnlocked(item.value, unlockCtx);
                        const isLocked = Boolean(requirement) && !unlocked;
                        const requirementLabel = requirement
                            ? describeThemeUnlock(requirement, language)
                            : null;
                        return (
                            <button
                                key={item.value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                aria-disabled={isLocked}
                                onClick={() => handleSelect(item.value)}
                                className="relative card card-interactive flex flex-col items-stretch text-left transition focus-visible:outline-none focus-visible:ring-2"
                                style={{
                                    padding: 0,
                                    overflow: 'hidden',
                                    borderColor: selected ? 'var(--primary)' : 'var(--border)',
                                    boxShadow: selected
                                        ? '0 0 0 2px rgba(var(--primary-rgb), 0.45), var(--shadow-sm)'
                                        : undefined,
                                    cursor: 'pointer',
                                    opacity: isLocked ? 0.55 : 1,
                                }}
                            >
                                <ThemePreview themeKey={item.value} icon={item.icon} />
                                {isLocked ? (
                                    <span
                                        aria-hidden
                                        className="absolute inline-flex items-center justify-center rounded-full"
                                        style={{
                                            top: 8,
                                            right: 8,
                                            width: 26,
                                            height: 26,
                                            background: 'var(--card)',
                                            color: 'var(--text)',
                                            border: '1px solid var(--border)',
                                            boxShadow: 'var(--shadow-sm)',
                                        }}
                                    >
                                        <Lock className="w-3.5 h-3.5" strokeWidth={2.5} />
                                    </span>
                                ) : null}
                                <div className="flex items-start justify-between gap-2 px-3 py-3">
                                    <div className="min-w-0 flex-1">
                                        <span
                                            className="text-sm font-semibold truncate block"
                                            style={{ color: 'var(--text)' }}
                                        >
                                            {labelFor[item.value]}
                                        </span>
                                        {isLocked && requirementLabel ? (
                                            <span
                                                className="text-xs mt-1 block"
                                                style={{ color: 'var(--muted-fg, var(--text))', opacity: 0.85 }}
                                            >
                                                {requirementLabel}
                                            </span>
                                        ) : null}
                                    </div>
                                    {selected ? (
                                        <span
                                            aria-hidden
                                            className="inline-flex items-center justify-center rounded-full"
                                            style={{
                                                width: 22,
                                                height: 22,
                                                background: 'var(--primary)',
                                                color: 'white',
                                                flexShrink: 0,
                                            }}
                                        >
                                            <Check className="w-3.5 h-3.5" strokeWidth={3} />
                                        </span>
                                    ) : null}
                                </div>
                            </button>
                        );
                    })}
                </div>

                {toast?.kind === 'applied' ? (
                    <div
                        role="status"
                        aria-live="polite"
                        className="text-center text-sm font-medium"
                        style={{ color: 'var(--good)' }}
                    >
                        {ui.themeAppliedToast}
                    </div>
                ) : null}

                {toast?.kind === 'locked' && toast.requirement ? (
                    <div
                        role="status"
                        aria-live="polite"
                        className="flex flex-col items-center gap-2 rounded-3xl px-4 py-3 text-center text-sm"
                        style={{
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            color: 'var(--text)',
                        }}
                    >
                        <span className="font-semibold">{ui.themeLockedTitle}</span>
                        <span style={{ color: 'var(--muted-fg, var(--text))' }}>
                            {formatLockedToastMessage(toast.requirement)}
                        </span>
                        {toast.requirement.kind === 'referrals' ? (
                            <Link
                                href="/settings/referrals"
                                className="text-sm font-semibold"
                                style={{ color: 'var(--primary)' }}
                            >
                                {ui.themeLockedCtaReferrals}
                            </Link>
                        ) : (
                            <Link
                                href="/support"
                                className="text-sm font-semibold"
                                style={{ color: 'var(--primary)' }}
                            >
                                {ui.themeLockedCtaSupporter}
                            </Link>
                        )}
                    </div>
                ) : null}
            </PageMain>
        </PageShell>
    );
}

interface ThemePreviewProps {
    themeKey: Theme;
    icon: string;
}

/**
 * Mini preview tile. We render a div with `data-theme` overriding the CSS
 * variables for just this subtree so each swatch shows the actual palette of
 * the theme it represents, not the currently active one.
 */
function ThemePreview({ themeKey, icon }: ThemePreviewProps) {
    return (
        <div
            data-theme={themeKey}
            className="relative flex items-center justify-center"
            style={{
                height: 84,
                background: 'var(--app-bg, var(--bg))',
                borderBottom: '1px solid var(--border)',
            }}
        >
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    inset: 12,
                    borderRadius: 12,
                    background: 'var(--gradient-card, var(--card))',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow-sm, 0 4px 14px rgba(0,0,0,0.12))',
                }}
            />
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    right: 16,
                    bottom: 14,
                    width: 28,
                    height: 28,
                    borderRadius: 10,
                    background: 'var(--gradient-primary, var(--primary))',
                    boxShadow: '0 6px 14px rgba(var(--primary-rgb), 0.32)',
                }}
            />
            <span
                aria-hidden
                style={{
                    position: 'relative',
                    fontSize: 26,
                    lineHeight: 1,
                    textShadow: '0 2px 8px rgba(0,0,0,0.25)',
                }}
            >
                {icon}
            </span>
        </div>
    );
}
