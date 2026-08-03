'use client';

import FriendActionButton from '@/components/FriendActionButton';
import type {
    ActiveLeaderboardEntry,
    ReferralLeaderboardEntry,
    TeacherLeaderboardEntry,
    TeacherTier,
} from '@/lib/api';
import { formatLeaderboardDuration } from './formatters';
import {
    hintChipStyle,
    miniMutedStyle,
    rankBubbleStyle,
    teacherRowButtonStyle,
} from './styles';
import type { LeaderboardUiCopy } from './types';

export function ModePill({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="transition"
            style={{
                borderRadius: '999px',
                border: active ? '1px solid rgba(251,191,36,0.45)' : '1px solid rgba(148,163,184,0.18)',
                background: active ? 'linear-gradient(135deg, rgba(251,191,36,0.22), rgba(99,102,241,0.2))' : 'var(--bg-secondary)',
                color: active ? 'var(--leaderboard-text)' : 'var(--text)',
                padding: '10px 16px',
                fontSize: '13px',
                fontWeight: 800,
                cursor: 'pointer',
            }}
        >
            {label}
        </button>
    );
}

export function HeroStat({ label, value, accent, emoji }: { label: string; value: string; accent: string; emoji: string }) {
    return (
        <div style={{ borderRadius: '22px', border: '1px solid var(--border)', background: 'linear-gradient(180deg, var(--bg-secondary), var(--card))', padding: '16px', position: 'relative', overflow: 'hidden' }}>
            <div aria-hidden style={{ position: 'absolute', inset: 'auto -28px -28px auto', width: '84px', height: '84px', borderRadius: '999px', background: accent, opacity: 0.14, filter: 'blur(6px)' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>{emoji}</span>
                <span style={{ color: 'var(--muted)', fontSize: '12px' }}>{label}</span>
            </div>
            <div style={{ marginTop: '10px', fontSize: '26px', lineHeight: 1.05, fontWeight: 800, background: accent, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
                {value}
            </div>
        </div>
    );
}

const PODIUM_VARIANTS = [
    { bg: 'linear-gradient(180deg, rgba(250,204,21,0.28), rgba(120,53,15,0.24))', border: 'rgba(250,204,21,0.24)', badge: 'var(--leaderboard-warm-gradient)', emoji: '👑', title: 'TOP 1' },
    { bg: 'linear-gradient(180deg, rgba(226,232,240,0.22), rgba(71,85,105,0.2))', border: 'rgba(226,232,240,0.2)', badge: 'linear-gradient(135deg, #e2e8f0, #94a3b8)', emoji: '🥈', title: 'TOP 2' },
    { bg: 'linear-gradient(180deg, rgba(251,146,60,0.24), rgba(124,45,18,0.2))', border: 'rgba(251,146,60,0.22)', badge: 'linear-gradient(135deg, #fdba74, #ea580c)', emoji: '🥉', title: 'TOP 3' },
];

export function StudentPodiumCard({ entry, index, lang, youLabel, timeLabel }: { entry: ActiveLeaderboardEntry; index: number; lang: string; youLabel: string; timeLabel: string }) {
    const variants = PODIUM_VARIANTS[index];

    return (
        <div style={{ borderRadius: '22px', border: `1px solid ${variants.border}`, background: variants.bg, padding: '18px', minHeight: '188px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
            <div aria-hidden style={{ position: 'absolute', inset: 'auto auto -26px -26px', width: '92px', height: '92px', borderRadius: '999px', background: variants.badge, opacity: 0.14, filter: 'blur(8px)' }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '7px 11px', borderRadius: '999px', background: 'rgba(var(--primary-rgb), 0.1)', color: 'var(--text)', fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em' }}>
                        <span>{variants.emoji}</span>
                        <span>{variants.title}</span>
                    </div>
                    <div style={{ width: '42px', height: '42px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: variants.badge, color: index === 1 ? '#0f172a' : '#111827', fontWeight: 900 }}>
                        #{entry.rank}
                    </div>
                </div>

                <div style={{ marginTop: '16px', color: 'var(--text)', fontSize: '20px', fontWeight: 800, lineHeight: 1.15 }}>{entry.displayName}</div>
                <div style={{ marginTop: '6px', color: entry.isCurrentUser ? 'var(--leaderboard-warm-text)' : 'var(--text-secondary)', fontSize: '12px' }}>
                    {entry.isCurrentUser ? youLabel : formatLeaderboardDuration(entry.totalSeconds, lang)}
                </div>
            </div>

            <div style={{ position: 'relative', zIndex: 1, marginTop: '18px' }}>
                <div style={{ color: 'var(--muted)', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{timeLabel}</div>
                <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 900, marginTop: '6px' }}>{formatLeaderboardDuration(entry.totalSeconds, lang)}</div>
            </div>
        </div>
    );
}

export function TeacherPodiumCard({ entry, voteLabel, onSelect }: { entry: TeacherLeaderboardEntry; voteLabel: string; onSelect: () => void }) {
    return (
        <button type="button" onClick={onSelect} style={teacherRowButtonStyle(false)}>
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 text-left">
                    <div style={{ color: 'var(--muted)', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 800 }}>
                        TOP {entry.rank}
                    </div>
                    <div className="truncate" style={{ color: 'var(--text)', fontSize: '18px', fontWeight: 800, marginTop: '6px' }}>{entry.name}</div>
                    <div className="flex flex-wrap gap-2 mt-3">
                        <TeacherTierBadge tier={entry.averageTier} compact />
                        <span style={miniMutedStyle}>{entry.voteCount} {voteLabel}</span>
                    </div>
                    <div className="flex flex-wrap gap-2 mt-3">
                        {entry.topTags.map((tag) => <span key={tag} style={hintChipStyle}>{tag}</span>)}
                    </div>
                </div>
                <div style={{ ...rankBubbleStyle, width: '48px', height: '48px', fontSize: '14px' }}>#{entry.rank}</div>
            </div>
        </button>
    );
}

export function ReferralPodiumCard({ entry, index, ui }: { entry: ReferralLeaderboardEntry; index: number; ui: LeaderboardUiCopy }) {
    const variants = PODIUM_VARIANTS[index];

    return (
        <div style={{ borderRadius: '22px', border: `1px solid ${variants.border}`, background: variants.bg, padding: '18px', minHeight: '188px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative', overflow: 'hidden' }}>
            <div aria-hidden style={{ position: 'absolute', inset: 'auto auto -26px -26px', width: '92px', height: '92px', borderRadius: '999px', background: variants.badge, opacity: 0.14, filter: 'blur(8px)' }} />
            <div style={{ position: 'relative', zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '7px 11px', borderRadius: '999px', background: 'rgba(var(--primary-rgb), 0.1)', color: 'var(--text)', fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em' }}>
                        <span>{variants.emoji}</span>
                        <span>{variants.title}</span>
                    </div>
                    <div style={{ width: '42px', height: '42px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: variants.badge, color: index === 1 ? '#0f172a' : '#111827', fontWeight: 900 }}>
                        #{entry.rank}
                    </div>
                </div>

                <div style={{ marginTop: '16px', color: 'var(--text)', fontSize: '20px', fontWeight: 800, lineHeight: 1.15 }}>{entry.displayName}</div>
                <div style={{ marginTop: '6px', color: entry.isCurrentUser ? 'var(--leaderboard-warm-text)' : 'var(--text-secondary)', fontSize: '12px' }}>
                    {entry.referralCount} {ui.referralsCount}
                </div>
                <div style={{ marginTop: '10px' }}>
                    <FriendActionButton targetUserId={entry.userId} compact />
                </div>
            </div>

            <div style={{ position: 'relative', zIndex: 1, marginTop: '18px' }}>
                <div style={{ color: 'var(--muted)', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{ui.yourReferralPoints}</div>
                <div style={{ color: 'var(--text)', fontSize: '24px', fontWeight: 900, marginTop: '6px' }}>{entry.totalPoints}</div>
            </div>
        </div>
    );
}

export function TeacherTierBadge({ tier, compact = false }: { tier: TeacherTier; compact?: boolean }) {
    const palette = {
        S: { bg: 'var(--leaderboard-tier-s-bg)', color: 'var(--leaderboard-tier-s-color)', border: 'var(--leaderboard-tier-s-border)' },
        A: { bg: 'var(--leaderboard-tier-a-bg)', color: 'var(--leaderboard-tier-a-color)', border: 'var(--leaderboard-tier-a-border)' },
        B: { bg: 'var(--leaderboard-tier-b-bg)', color: 'var(--leaderboard-tier-b-color)', border: 'var(--leaderboard-tier-b-border)' },
        C: { bg: 'var(--leaderboard-tier-c-bg)', color: 'var(--leaderboard-tier-c-color)', border: 'var(--leaderboard-tier-c-border)' },
        D: { bg: 'var(--leaderboard-tier-d-bg)', color: 'var(--leaderboard-tier-d-color)', border: 'var(--leaderboard-tier-d-border)' },
        E: { bg: 'var(--leaderboard-tier-e-bg)', color: 'var(--leaderboard-tier-e-color)', border: 'var(--leaderboard-tier-e-border)' },
        F: { bg: 'var(--bg-secondary)', color: 'var(--text)', border: 'var(--border)' },
    }[tier];

    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '999px', border: `1px solid ${palette.border}`, background: palette.bg, color: palette.color, padding: compact ? '6px 10px' : '10px 14px', fontSize: compact ? '12px' : '14px', fontWeight: 800, minWidth: compact ? undefined : '84px' }}>
            {tier}-tier
        </span>
    );
}
