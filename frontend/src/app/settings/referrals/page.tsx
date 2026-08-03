'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import FriendActionButton from '@/components/FriendActionButton';
import { PageMain, PageShell, PageStateCard } from '@/components/PageShell';
import { useAuth } from '@/lib/auth-context';
import { checkAdminSession, claimReferralCode, getReferralOverview, type ReferralOverview } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { getReferralBadgeTier, getUnlockedReferralThemes, REFERRAL_BADGE_TIERS, REFERRAL_THEME_UNLOCKS } from '@/lib/referral-rewards';
import { clearPendingReferralCode, getPendingReferralCode, normalizeReferralCode } from '@/lib/referrals';
import { getReferralsUi } from './strings';

function formatDate(value: string | null, language: 'ru' | 'kz' | 'en') {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString(language === 'kz' ? 'kk-KZ' : language === 'en' ? 'en-US' : 'ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export default function SettingsReferralsPage() {
    const { isAuth, loading } = useAuth();
    const { language } = useLanguage();
    const router = useRouter();
    const [overview, setOverview] = useState<ReferralOverview | null>(null);
    const [loadingOverview, setLoadingOverview] = useState(true);
    const [status, setStatus] = useState<string | null>(null);
    const [claimCode, setClaimCode] = useState('');
    const [claiming, setClaiming] = useState(false);
    const [adminPreviewAvailable, setAdminPreviewAvailable] = useState(false);
    const [adminPreviewNewUser, setAdminPreviewNewUser] = useState(false);
    const [origin] = useState(() => typeof window !== 'undefined' ? window.location.origin : 'https://univerkstu.app');

    const ui = useMemo(() => getReferralsUi(language), [language]);

    const pendingCode = useMemo(() => getPendingReferralCode(), []);
    const inviteLink = overview ? `${origin}/?ref=${overview.code}` : '';
    const rewardBadge = getReferralBadgeTier(overview?.referralCount || 0);
    const unlockedThemes = getUnlockedReferralThemes(overview?.referralCount || 0);
    const previewCanClaimManualCode = adminPreviewNewUser || Boolean(overview?.canClaimManualCode);
    const previewReferredBy = adminPreviewNewUser ? null : (overview?.referredBy || null);

    const load = async () => {
        setLoadingOverview(true);
        const result = await getReferralOverview();
        if (result.success && result.data) {
            setOverview(result.data);
            setStatus(null);
            if (!result.data.canClaimManualCode) {
                clearPendingReferralCode();
            }
        } else if (!result.success) {
            setStatus(result.error || null);
        }
        setLoadingOverview(false);
    };

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    useEffect(() => {
        if (!isAuth) return;
        const timer = window.setTimeout(() => {
            setClaimCode(pendingCode);
            void load();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isAuth, pendingCode]);

    useEffect(() => {
        if (!isAuth) return;

        let cancelled = false;
        const loadAdminSession = async () => {
            const result = await checkAdminSession();
            if (cancelled) return;
            const available = Boolean(result.success && result.data?.authenticated);
            setAdminPreviewAvailable(available);
            if (!available) {
                setAdminPreviewNewUser(false);
            }
        };

        void loadAdminSession();
        return () => {
            cancelled = true;
        };
    }, [isAuth]);

    const copy = async (value: string, message: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setStatus(message);
            window.setTimeout(() => setStatus((current) => current === message ? null : current), 1800);
        } catch {
            setStatus(null);
        }
    };

    const share = async () => {
        if (!inviteLink) return;
        try {
            if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
                await navigator.share({ url: inviteLink, title: ui.title, text: ui.subtitle });
                return;
            }
        } catch {
            return;
        }
        await copy(inviteLink, ui.copied);
    };

    const applyCode = async () => {
        if (adminPreviewNewUser) {
            setStatus(ui.adminPreviewManualHint);
            return;
        }
        const normalized = normalizeReferralCode(claimCode);
        if (!normalized) {
            return;
        }
        setClaiming(true);
        const result = await claimReferralCode(normalized);
        setClaiming(false);
        if (result.success && result.data) {
            setOverview(result.data);
            setStatus(language === 'ru' ? 'Реферальный код применён' : language === 'kz' ? 'Реферал коды қолданылды' : 'Referral code applied');
            clearPendingReferralCode();
            setClaimCode('');
            return;
        }
        setStatus(result.error || null);
    };

    if (loading || !isAuth) {
        return null;
    }

    return (
        <PageShell>
            <header className="app-header">
                <div className="app-header-top">
                    <button
                        type="button"
                        onClick={() => router.push('/settings')}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 14px',
                            borderRadius: '14px',
                            border: '1px solid var(--border)',
                            background: 'var(--card)',
                            color: 'var(--text)',
                            fontSize: '13px',
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        <span>←</span>
                        <span>{ui.back}</span>
                    </button>
                </div>
                <div className="mt-4">
                    <h1 className="app-header-title">{ui.title}</h1>
                    <p className="app-header-subtitle">{ui.subtitle}</p>
                </div>
            </header>

            <PageMain className="space-y-4" spacing="lg">
                {status ? <PageStateCard message={status} /> : null}

                {loadingOverview ? (
                    <PageStateCard message={language === 'ru' ? 'Загружаю реферальную систему…' : language === 'kz' ? 'Реферал жүйесі жүктелуде…' : 'Loading referral system…'} />
                ) : !overview ? (
                    <PageStateCard tone="danger" message={language === 'ru' ? 'Не удалось загрузить данные рефералки.' : language === 'kz' ? 'Реферал деректерін жүктеу сәтсіз болды.' : 'Failed to load referral data.'} />
                ) : (
                    <>
                        {adminPreviewAvailable ? (
                            <section className="card p-5">
                                <div className="flex items-start justify-between gap-4 flex-wrap">
                                    <div>
                                        <h2 className="text-lg font-bold text-fg">{ui.adminPreviewTitle}</h2>
                                        <p className="mt-1 text-sm" style={{ color: 'var(--muted)', maxWidth: '720px' }}>
                                            {ui.adminPreviewHint}
                                        </p>
                                        {adminPreviewNewUser ? (
                                            <div className="mt-3 rounded-2xl px-3 py-2 text-sm" style={{ background: 'var(--status-info-bg)', border: '1px solid var(--status-info-border)', color: 'var(--status-info-color)' }}>
                                                {ui.adminPreviewState}
                                            </div>
                                        ) : null}
                                    </div>
                                    <button
                                        type="button"
                                        className={adminPreviewNewUser ? 'btn btn-secondary' : 'btn btn-primary'}
                                        onClick={() => setAdminPreviewNewUser((current) => !current)}
                                    >
                                        {adminPreviewNewUser ? ui.adminPreviewDisable : ui.adminPreviewEnable}
                                    </button>
                                </div>
                            </section>
                        ) : null}

                        <section className="card p-5">
                            <div className="grid gap-4 lg:grid-cols-[1.4fr_0.9fr]">
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-xs uppercase tracking-[0.14em] text-muted-fg">{ui.yourLink}</div>
                                        <div className="mt-2 rounded-2xl px-4 py-4 break-all" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                                            <span className="text-fg">{inviteLink}</span>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-3">
                                        <button type="button" className="btn btn-primary" onClick={() => void copy(inviteLink, ui.copied)}>{ui.copyLink}</button>
                                        <button type="button" className="btn btn-secondary" onClick={() => void copy(overview.code, ui.codeCopied)}>{ui.copyCode}</button>
                                        <button type="button" className="btn btn-secondary" onClick={() => void share()}>{ui.share}</button>
                                    </div>
                                </div>

                                <div className="rounded-3xl p-5" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                                    <div className="text-xs uppercase tracking-[0.14em] text-muted-fg">{ui.yourCode}</div>
                                    <div className="mt-3 text-3xl font-black tracking-[0.18em] text-fg">{overview.code}</div>
                                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                                        <RewardChip label={ui.inviteReward} value={`+${overview.inviteRewardPoints}`} />
                                        <RewardChip label={ui.welcomeReward} value={`+${overview.welcomeRewardPoints}`} />
                                    </div>
                                </div>
                            </div>
                        </section>

                        <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                            <div className="card p-5">
                                <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div>
                                        <h2 className="text-lg font-bold text-fg">{ui.yourStats}</h2>
                                    </div>
                                    {overview.myRank ? (
                                        <div className="text-sm text-muted-fg">#{overview.myRank} / {overview.totalRankedUsers || '—'}</div>
                                    ) : null}
                                </div>
                                <div className="grid gap-3 sm:grid-cols-3 mt-4">
                                    <StatCard label={ui.referrals} value={String(overview.referralCount)} />
                                    <StatCard label={ui.points} value={String(overview.totalPoints)} />
                                    <StatCard label={ui.rank} value={overview.myRank ? `#${overview.myRank}` : '—'} />
                                </div>

                                {previewReferredBy ? (
                                    <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--status-success-bg)', border: '1px solid var(--status-success-border)' }}>
                                        <div className="text-sm font-semibold" style={{ color: 'var(--status-success-color)' }}>{ui.invitedYou}</div>
                                        <div className="mt-2 text-base font-bold text-fg">{previewReferredBy.displayName}</div>
                                        <div className="mt-3">
                                            <FriendActionButton targetUserId={previewReferredBy.userId} compact />
                                        </div>
                                        <div className="mt-1 text-xs text-muted-fg">
                                            {ui.claimedAt}: {formatDate(previewReferredBy.referredAt, language)}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="mt-4 rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                                        <div className="text-sm font-semibold text-fg">{ui.manualClaimTitle}</div>
                                        <p className="mt-2 text-sm text-muted-fg">
                                            {adminPreviewNewUser ? ui.adminPreviewManualHint : previewCanClaimManualCode ? ui.manualClaimHint : ui.manualClaimExpired}
                                        </p>
                                        {pendingCode && previewCanClaimManualCode ? (
                                            <div className="mt-3 rounded-2xl px-3 py-2 text-sm" style={{ background: 'var(--status-info-bg)', border: '1px solid var(--status-info-border)', color: 'var(--status-info-color)' }}>
                                                {ui.pendingCode}: <strong>{pendingCode}</strong>
                                            </div>
                                        ) : null}
                                        {previewCanClaimManualCode ? (
                                            <div className="flex flex-col gap-3 mt-4 sm:flex-row">
                                                <input
                                                    value={claimCode}
                                                    onChange={(event) => setClaimCode(normalizeReferralCode(event.target.value))}
                                                    placeholder={ui.manualInputPlaceholder}
                                                    className="flex-1 rounded-2xl px-4 py-3"
                                                    style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
                                                />
                                                <button
                                                    type="button"
                                                    className={adminPreviewNewUser ? 'btn btn-secondary' : 'btn btn-primary'}
                                                    disabled={adminPreviewNewUser || claiming || !normalizeReferralCode(claimCode)}
                                                    onClick={() => void applyCode()}
                                                >
                                                    {adminPreviewNewUser ? ui.adminPreviewAction : claiming ? ui.manualClaiming : ui.manualClaim}
                                                </button>
                                            </div>
                                        ) : null}
                                    </div>
                                )}
                            </div>

                            <div className="card p-5">
                                <div>
                                    <h2 className="text-lg font-bold text-fg">{ui.top}</h2>
                                    <p className="mt-1 text-sm text-muted-fg">{ui.topHint}</p>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {overview.leaderboard.length === 0 ? (
                                        <p className="text-muted-fg">—</p>
                                    ) : overview.leaderboard.map((entry) => (
                                        <div key={`${entry.rank}-${entry.userId}`} className="rounded-2xl p-4" style={{ border: entry.isCurrentUser ? '1px solid rgba(var(--primary-rgb), 0.36)' : '1px solid var(--border)', background: entry.isCurrentUser ? 'rgba(var(--primary-rgb), 0.08)' : 'var(--card)' }}>
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="text-xs uppercase tracking-[0.14em] text-muted-fg">#{entry.rank}</div>
                                                    <div className="mt-1 font-semibold text-fg">{entry.displayName}</div>
                                                    <div className="mt-3">
                                                        <FriendActionButton targetUserId={entry.userId} compact />
                                                    </div>
                                                </div>
                                                <div className="text-right text-sm text-muted-fg">
                                                    <div>{entry.referralCount} {ui.referrals.toLowerCase()}</div>
                                                    <div>{entry.totalPoints} {ui.points.toLowerCase()}</div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>

                        <section className="card p-5">
                            <h2 className="text-lg font-bold text-fg">{ui.rewardsTitle}</h2>
                            <p className="mt-1 text-sm text-muted-fg">{ui.rewardsHint}</p>
                            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 mt-4">
                                {REFERRAL_BADGE_TIERS.toSorted((left, right) => left.minReferrals - right.minReferrals).map((tier) => {
                                    const unlocked = (overview.referralCount || 0) >= tier.minReferrals;
                                    const levelLabel = tier.id === 'legend'
                                        ? language === 'ru' ? 'Легенда' : language === 'kz' ? 'Аңыз' : 'Legend'
                                        : tier.id === 'ambassador'
                                            ? language === 'ru' ? 'Амбассадор' : language === 'kz' ? 'Амбассадор' : 'Ambassador'
                                            : tier.id === 'connector'
                                                ? language === 'ru' ? 'Коннектор' : language === 'kz' ? 'Байланыстырушы' : 'Connector'
                                                : language === 'ru' ? 'Скаут' : language === 'kz' ? 'Скаут' : 'Scout';
                                    return (
                                        <RewardMilestoneCard
                                            key={tier.id}
                                            title={`${tier.icon} ${ui.rewardBadge}: ${levelLabel}`}
                                            subtitle={language === 'ru'
                                                ? `${tier.minReferrals}+ приглашённых`
                                                : language === 'kz'
                                                    ? `${tier.minReferrals}+ шақырылған`
                                                    : `${tier.minReferrals}+ invites`}
                                            status={unlocked ? ui.unlocked : ui.locked}
                                            active={unlocked && rewardBadge?.id === tier.id}
                                        />
                                    );
                                })}
                                {REFERRAL_THEME_UNLOCKS.map((unlock) => {
                                    const unlocked = unlockedThemes.includes(unlock.theme);
                                    const themeLabel = unlock.theme === 'referral-sherbet' ? 'Sherbet Pop' : 'Nebula Rush';
                                    return (
                                        <RewardMilestoneCard
                                            key={unlock.theme}
                                            title={`${unlock.theme === 'referral-sherbet' ? '🍊' : '🪐'} ${ui.rewardTheme}: ${themeLabel}`}
                                            subtitle={language === 'ru'
                                                ? `${unlock.minReferrals}+ приглашённых`
                                                : language === 'kz'
                                                    ? `${unlock.minReferrals}+ шақырылған`
                                                    : `${unlock.minReferrals}+ invites`}
                                            status={unlocked ? ui.unlocked : ui.locked}
                                            active={unlocked}
                                        />
                                    );
                                })}
                            </div>
                        </section>

                        <section className="grid gap-4 lg:grid-cols-2">
                            <div className="card p-5">
                                <h2 className="text-lg font-bold text-fg">{ui.yourReferrals}</h2>
                                <div className="mt-4 space-y-3">
                                    {overview.recentReferrals.length === 0 ? (
                                        <p className="text-muted-fg">{ui.noReferrals}</p>
                                    ) : overview.recentReferrals.map((entry) => (
                                        <div key={`${entry.userId}-${entry.referredAt}`} className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                                            <div className="font-semibold text-fg">{entry.displayName}</div>
                                            <div className="mt-3">
                                                <FriendActionButton targetUserId={entry.userId} compact />
                                            </div>
                                            <div className="mt-1 text-sm text-muted-fg">{formatDate(entry.referredAt, language)}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="card p-5">
                                <h2 className="text-lg font-bold text-fg">{ui.rewardHistory}</h2>
                                <div className="mt-4 space-y-3">
                                    {overview.rewards.length === 0 ? (
                                        <p className="text-muted-fg">{ui.noRewards}</p>
                                    ) : overview.rewards.map((reward) => (
                                        <div key={reward.id} className="rounded-2xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <div className="font-semibold text-fg">
                                                        {reward.type === 'invite_success' ? ui.rewardInviteSuccess : ui.rewardWelcome}
                                                    </div>
                                                    <div className="mt-1 text-sm text-muted-fg">
                                                        {reward.counterpartDisplayName || '—'} • {formatDate(reward.createdAt, language)}
                                                    </div>
                                                    {reward.counterpartUserId ? (
                                                        <div className="mt-3">
                                                            <FriendActionButton targetUserId={reward.counterpartUserId} compact />
                                                        </div>
                                                    ) : null}
                                                </div>
                                                <div className="text-lg font-black" style={{ color: 'var(--primary)' }}>+{reward.points}</div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </section>
                    </>
                )}
            </PageMain>
        </PageShell>
    );
}

function StatCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-3xl p-4" style={{ border: '1px solid var(--border)', background: 'var(--card)' }}>
            <div className="text-xs uppercase tracking-[0.14em] text-muted-fg">{label}</div>
            <div className="mt-2 text-3xl font-black text-fg">{value}</div>
        </div>
    );
}

function RewardChip({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl px-3 py-3" style={{ border: '1px solid var(--border)', background: 'rgba(var(--primary-rgb), 0.08)' }}>
            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-fg">{label}</div>
            <div className="mt-2 text-xl font-black text-fg">{value}</div>
        </div>
    );
}

function RewardMilestoneCard({
    title,
    subtitle,
    status,
    active,
}: {
    title: string;
    subtitle: string;
    status: string;
    active: boolean;
}) {
    return (
        <div
            className="rounded-3xl p-4"
            style={{
                border: active ? '1px solid rgba(var(--primary-rgb), 0.34)' : '1px solid var(--border)',
                background: active ? 'rgba(var(--primary-rgb), 0.08)' : 'var(--card)',
            }}
        >
            <div className="font-semibold text-fg">{title}</div>
            <div className="mt-2 text-sm text-muted-fg">{subtitle}</div>
            <div className="mt-3 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: active ? 'var(--primary)' : 'var(--muted)' }}>
                {status}
            </div>
        </div>
    );
}
