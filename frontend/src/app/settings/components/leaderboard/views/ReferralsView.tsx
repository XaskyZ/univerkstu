'use client';

import type { Dispatch, SetStateAction } from 'react';
import FriendActionButton from '@/components/FriendActionButton';
import type { ReferralLeaderboardEntry, ReferralOverview } from '@/lib/api';
import {
    getReferralBadgeTier,
    getUnlockedReferralThemes,
    REFERRAL_BADGE_TIERS,
    REFERRAL_THEME_UNLOCKS,
} from '@/lib/referral-rewards';
import { HeroStat, ReferralPodiumCard } from '../components';
import { formatUpdatedAt } from '../formatters';
import {
    hintChipStyle,
    rankBubbleStyle,
    secondaryButtonStyle,
    surfaceBoxStyle,
    tinyCapsStyle,
} from '../styles';
import type { LeaderboardUiCopy } from '../types';

interface ReferralsViewProps {
    referralLoading: boolean;
    referralError: string;
    referralData: ReferralOverview | null;
    ui: LeaderboardUiCopy;
    lang: string;
    visibleReferralEntries: ReferralLeaderboardEntry[];
    showAllReferrals: boolean;
    setShowAllReferrals: Dispatch<SetStateAction<boolean>>;
    referralPodiumTitle: string;
}

export function ReferralsView({
    referralLoading,
    referralError,
    referralData,
    ui,
    lang,
    visibleReferralEntries,
    showAllReferrals,
    setShowAllReferrals,
    referralPodiumTitle,
}: ReferralsViewProps) {
    if (referralLoading) {
        return <p style={{ margin: '24px 0 6px', color: 'var(--muted)', fontSize: '14px' }}>{ui.loading}</p>;
    }
    if (referralError) {
        return <p style={{ margin: '24px 0 6px', color: '#fda4af', fontSize: '14px' }}>{referralError}</p>;
    }
    if (!referralData) {
        return <p style={{ margin: '24px 0 6px', color: 'var(--muted)', fontSize: '14px' }}>{ui.referralsEmpty}</p>;
    }

    const badge = getReferralBadgeTier(referralData.referralCount);
    const unlockedThemes = getUnlockedReferralThemes(referralData.referralCount);
    const badgeLabel = badge
        ? badge.id === 'legend'
            ? 'Legend'
            : badge.id === 'ambassador'
                ? 'Ambassador'
                : badge.id === 'connector'
                    ? 'Connector'
                    : 'Scout'
        : '—';

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
                <HeroStat label={ui.referralTotalUsers} value={String(referralData.totalRankedUsers)} accent="linear-gradient(135deg, #f97316, #fb7185)" emoji="🎁" />
                <HeroStat label={ui.yourReferralPlace} value={referralData.myRank ? `#${referralData.myRank}` : '—'} accent="linear-gradient(135deg, #60a5fa, #2563eb)" emoji="🚀" />
                <HeroStat label={ui.yourReferralPoints} value={String(referralData.totalPoints)} accent="linear-gradient(135deg, #a78bfa, #8b5cf6)" emoji="✨" />
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-4 mt-5">
                <div style={surfaceBoxStyle}>
                    <div style={tinyCapsStyle}>🎖️ {ui.rewardsTitle}</div>
                    <div style={{ color: 'var(--text)', fontSize: '20px', fontWeight: 800, marginTop: '10px' }}>
                        {badge ? `${badge.icon} ${badgeLabel}` : '—'}
                    </div>
                    <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '13px', maxWidth: '640px' }}>
                        {ui.rewardsHint}
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                        {REFERRAL_BADGE_TIERS.toSorted((left, right) => left.minReferrals - right.minReferrals).map((tier) => (
                            <div key={tier.id} className="rounded-2xl p-3" style={{ border: '1px solid var(--leaderboard-surface-border)', background: 'var(--leaderboard-row-bg)' }}>
                                <div style={{ color: 'var(--leaderboard-text)', fontWeight: 700 }}>{tier.icon} {tier.id}</div>
                                <div className="mt-1 text-sm" style={{ color: 'var(--leaderboard-muted)' }}>{tier.minReferrals}+ {ui.rewardRefs}</div>
                            </div>
                        ))}
                        {REFERRAL_THEME_UNLOCKS.map((unlock) => (
                            <div key={unlock.theme} className="rounded-2xl p-3" style={{ border: '1px solid var(--leaderboard-surface-border)', background: 'var(--leaderboard-row-bg)' }}>
                                <div style={{ color: 'var(--leaderboard-text)', fontWeight: 700 }}>
                                    {unlock.theme === 'referral-sherbet' ? '🍊' : '🪐'} {unlock.theme === 'referral-sherbet' ? ui.rewardThemeSherbet : ui.rewardThemeNebula}
                                </div>
                                <div className="mt-1 text-sm" style={{ color: 'var(--leaderboard-muted)' }}>{unlock.minReferrals}+ {ui.rewardRefs}</div>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={surfaceBoxStyle}>
                    <div style={tinyCapsStyle}>{referralPodiumTitle}</div>
                    <div style={{ color: 'var(--text)', fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>Top 3</div>
                    <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '8px' }}>
                        {ui.updated}: {formatUpdatedAt(referralData.updatedAt, lang)}
                    </div>

                    {referralData.leaderboard.length === 0 ? (
                        <p style={{ margin: '20px 0 0', color: 'var(--muted)', fontSize: '14px' }}>{ui.referralsEmpty}</p>
                    ) : (
                        <div className="grid grid-cols-1 gap-3 mt-4">
                            {referralData.leaderboard.slice(0, 3).map((entry, index) => (
                                <ReferralPodiumCard key={entry.userId} entry={entry} index={index} ui={ui} />
                            ))}
                        </div>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                        <span style={hintChipStyle}>{ui.referralsTitle}: {referralData.referralCount}</span>
                        <span style={hintChipStyle}>{ui.yourReferralPoints}: {referralData.totalPoints}</span>
                        <span style={hintChipStyle}>{ui.rewardsTitle}: {unlockedThemes.length}</span>
                    </div>
                </div>
            </div>

            {referralData.leaderboard.length > 3 ? (
                <div className="mt-5" style={surfaceBoxStyle}>
                    <div className="space-y-2">
                        {visibleReferralEntries.map((entry) => (
                            <div key={entry.userId} className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3" style={{ border: '1px solid var(--border)', background: entry.isCurrentUser ? 'rgba(var(--primary-rgb), 0.12)' : 'var(--bg-secondary)' }}>
                                <div className="flex items-center gap-3 min-w-0">
                                    <div style={rankBubbleStyle}>#{entry.rank}</div>
                                    <div className="min-w-0">
                                        <div className="truncate" style={{ color: 'var(--text)', fontWeight: 700 }}>{entry.displayName}</div>
                                        <div style={{ color: entry.isCurrentUser ? 'var(--leaderboard-warm-text)' : 'var(--muted)', fontSize: '11px', marginTop: '2px' }}>
                                            {entry.referralCount} {ui.referralsCount}
                                        </div>
                                        <div style={{ marginTop: '10px' }}>
                                            <FriendActionButton targetUserId={entry.userId} compact />
                                        </div>
                                    </div>
                                </div>
                                <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                                    {entry.totalPoints} {ui.referralPoints}
                                </div>
                            </div>
                        ))}
                    </div>

                    {referralData.leaderboard.length > 10 ? (
                        <div className="mt-4 flex justify-center">
                            <button type="button" onClick={() => setShowAllReferrals((current) => !current)} className="transition" style={secondaryButtonStyle}>
                                {showAllReferrals ? ui.collapse : `${ui.showAll} (${referralData.totalRankedUsers})`}
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : null}
        </>
    );
}
