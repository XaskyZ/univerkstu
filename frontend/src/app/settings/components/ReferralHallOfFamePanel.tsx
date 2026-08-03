'use client';

import { useEffect, useMemo, useState } from 'react';
import FriendActionButton from '@/components/FriendActionButton';
import { getReferralOverview, type ReferralOverview } from '@/lib/api';
import { getReferralBadgeTier, getUnlockedReferralThemes, REFERRAL_BADGE_TIERS, REFERRAL_THEME_UNLOCKS } from '@/lib/referral-rewards';

function formatDate(value: string | null, lang: 'ru' | 'kz' | 'en') {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString(lang === 'kz' ? 'kk-KZ' : lang === 'en' ? 'en-US' : 'ru-RU', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function ReferralHallOfFamePanel() {
    const lang = typeof document !== 'undefined' ? document.documentElement.lang === 'kz' ? 'kz' : document.documentElement.lang === 'en' ? 'en' : 'ru' : 'ru';
    const [data, setData] = useState<ReferralOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [showAll, setShowAll] = useState(false);

    const ui = useMemo(() => ({
        ru: {
            eyebrow: 'Реферальный зал славы',
            title: 'Топ рефералов',
            subtitle: 'Настоящий список тех, кто приводит новых людей в UniverSchedule.',
            loading: 'Загружаю топ рефералов...',
            empty: 'Пока в топе рефералов тихо.',
            error: 'Не удалось загрузить реферальный топ.',
            yourTier: 'Ваш уровень',
            yourThemes: 'Открыто тем',
            rewardsTitle: 'Награды за рефералов',
            rewardRefs: 'рефералов',
            rewardThemePaper: 'Sherbet Pop',
            rewardThemeMidnight: 'Nebula Rush',
            showAll: 'Показать весь топ',
            collapse: 'Свернуть',
            referrals: 'рефералов',
            points: 'поинтов',
            updated: 'Обновлено',
            topHint: 'Badge в профиле и темы открываются по числу успешных приглашений.',
        },
        kz: {
            eyebrow: 'Реферал даңқ залы',
            title: 'Топ рефералдар',
            subtitle: 'UniverSchedule-ге жаңа адамдарды әкеліп жүргендердің нақты тізімі.',
            loading: 'Реферал топ жүктелуде...',
            empty: 'Әзірге реферал топ бос.',
            error: 'Реферал топты жүктеу мүмкін болмады.',
            yourTier: 'Сіздің деңгейіңіз',
            yourThemes: 'Ашық тақырыптар',
            rewardsTitle: 'Реферал сыйақылары',
            rewardRefs: 'реферал',
            rewardThemePaper: 'Sherbet Pop',
            rewardThemeMidnight: 'Nebula Rush',
            showAll: 'Толық топты ашу',
            collapse: 'Жинау',
            referrals: 'реферал',
            points: 'ұпай',
            updated: 'Жаңартылды',
            topHint: 'Профиль badge-і мен тақырыптар сәтті шақырулар санына қарай ашылады.',
        },
        en: {
            eyebrow: 'Referral hall of fame',
            title: 'Top referrers',
            subtitle: 'The real list of people bringing new users into UniverSchedule.',
            loading: 'Loading referral leaderboard...',
            empty: 'The referral leaderboard is still quiet.',
            error: 'Failed to load referral leaderboard.',
            yourTier: 'Your tier',
            yourThemes: 'Themes unlocked',
            rewardsTitle: 'Referral rewards',
            rewardRefs: 'referrals',
            rewardThemePaper: 'Sherbet Pop',
            rewardThemeMidnight: 'Nebula Rush',
            showAll: 'Show full top',
            collapse: 'Collapse',
            referrals: 'referrals',
            points: 'points',
            updated: 'Updated',
            topHint: 'Profile badges and themes unlock based on successful invites.',
        },
    }[lang]), [lang]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setLoading(true);
            const result = await getReferralOverview();
            if (cancelled) return;
            if (result.success && result.data) {
                setData(result.data);
                setError('');
            } else {
                setError(result.error || ui.error);
            }
            setLoading(false);
        };
        void load();
        return () => {
            cancelled = true;
        };
    }, [ui.error]);

    if (loading) {
        return (
            <section className="card p-5">
                <p className="text-muted-fg">{ui.loading}</p>
            </section>
        );
    }

    if (error) {
        return (
            <section className="card p-5">
                <p style={{ color: 'var(--danger)' }}>{error}</p>
            </section>
        );
    }

    if (!data) {
        return null;
    }

    const visibleEntries = showAll ? data.leaderboard : data.leaderboard.slice(0, 6);
    const badge = getReferralBadgeTier(data.referralCount);
    const unlockedThemes = getUnlockedReferralThemes(data.referralCount);
    const badgeLabel = badge
        ? badge.id === 'legend' ? 'Legend' : badge.id === 'ambassador' ? 'Ambassador' : badge.id === 'connector' ? 'Connector' : 'Scout'
        : '—';

    return (
        <section
            className="card p-5"
            style={{
                border: '1px solid var(--leaderboard-panel-border)',
                background: 'var(--leaderboard-panel-bg)',
                boxShadow: 'var(--leaderboard-panel-shadow)',
            }}
        >
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <div
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '7px 12px',
                            borderRadius: '999px',
                            background: 'var(--leaderboard-panel-eyebrow-bg)',
                            color: 'var(--leaderboard-eyebrow-color)',
                            fontSize: '11px',
                            fontWeight: 700,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                        }}
                    >
                        <span>🎁</span>
                        <span>{ui.eyebrow}</span>
                    </div>
                    <h2 style={{ margin: '14px 0 6px', color: 'var(--leaderboard-panel-title)', fontSize: '30px', lineHeight: 1.05, fontWeight: 800 }}>
                        {ui.title}
                    </h2>
                    <p style={{ margin: 0, color: 'var(--leaderboard-panel-copy)', maxWidth: '640px', fontSize: '14px' }}>
                        {ui.subtitle}
                    </p>
                </div>
                <div style={{ color: 'var(--leaderboard-muted)', fontSize: '12px' }}>
                    {ui.updated}: {formatDate(data.updatedAt, lang)}
                </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3 mt-5">
                <MetricCard label={ui.yourTier} value={badge ? `${badge.icon} ${badgeLabel}` : '—'} />
                <MetricCard label={ui.yourThemes} value={String(unlockedThemes.length)} />
                <MetricCard label={ui.title} value={data.myRank ? `#${data.myRank}` : '—'} />
            </div>

            <div className="mt-5 rounded-3xl p-4" style={{ border: '1px solid var(--leaderboard-surface-border)', background: 'var(--leaderboard-surface-bg)' }}>
                <div className="text-sm font-semibold" style={{ color: 'var(--leaderboard-text)' }}>{ui.rewardsTitle}</div>
                <p className="mt-1 text-sm" style={{ color: 'var(--leaderboard-muted)' }}>{ui.topHint}</p>
                <div className="grid gap-3 md:grid-cols-2 mt-4">
                    {REFERRAL_BADGE_TIERS.toSorted((left, right) => left.minReferrals - right.minReferrals).map((tier) => (
                        <div key={tier.id} className="rounded-2xl p-3" style={{ border: '1px solid var(--leaderboard-surface-border)', background: 'var(--leaderboard-row-bg)' }}>
                            <div style={{ color: 'var(--leaderboard-text)', fontWeight: 700 }}>{tier.icon} {tier.id}</div>
                            <div className="mt-1 text-sm" style={{ color: 'var(--leaderboard-muted)' }}>{tier.minReferrals}+ {ui.rewardRefs}</div>
                        </div>
                    ))}
                    {REFERRAL_THEME_UNLOCKS.map((unlock) => (
                        <div key={unlock.theme} className="rounded-2xl p-3" style={{ border: '1px solid var(--leaderboard-surface-border)', background: 'var(--leaderboard-row-bg)' }}>
                            <div style={{ color: 'var(--leaderboard-text)', fontWeight: 700 }}>
                                {unlock.theme === 'referral-sherbet' ? '🍊' : '🪐'} {unlock.theme === 'referral-sherbet' ? ui.rewardThemePaper : ui.rewardThemeMidnight}
                            </div>
                            <div className="mt-1 text-sm" style={{ color: 'var(--leaderboard-muted)' }}>{unlock.minReferrals}+ {ui.rewardRefs}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="mt-5 space-y-3">
                {visibleEntries.length === 0 ? (
                    <p style={{ color: 'var(--leaderboard-muted)' }}>{ui.empty}</p>
                ) : visibleEntries.map((entry) => (
                    <div key={`ref-top-${entry.userId}`} className="rounded-2xl p-4" style={{ border: entry.isCurrentUser ? '1px solid rgba(var(--primary-rgb), 0.34)' : '1px solid var(--leaderboard-surface-border)', background: entry.isCurrentUser ? 'var(--leaderboard-row-active-bg)' : 'var(--leaderboard-row-bg)' }}>
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div style={{ color: 'var(--leaderboard-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>#{entry.rank}</div>
                                <div className="mt-1 font-semibold" style={{ color: 'var(--leaderboard-text)' }}>{entry.displayName}</div>
                                <div className="mt-3">
                                    <FriendActionButton targetUserId={entry.userId} compact />
                                </div>
                            </div>
                            <div className="text-right text-sm" style={{ color: 'var(--leaderboard-muted)' }}>
                                <div>{entry.referralCount} {ui.referrals}</div>
                                <div>{entry.totalPoints} {ui.points}</div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {data.leaderboard.length > 6 ? (
                <button
                    type="button"
                    onClick={() => setShowAll((current) => !current)}
                    style={{
                        marginTop: '16px',
                        borderRadius: '16px',
                        border: '1px solid var(--leaderboard-secondary-button-border)',
                        background: 'var(--leaderboard-secondary-button-bg)',
                        color: 'var(--leaderboard-secondary-button-color)',
                        padding: '12px 16px',
                        fontSize: '13px',
                        fontWeight: 700,
                        cursor: 'pointer',
                    }}
                >
                    {showAll ? ui.collapse : ui.showAll}
                </button>
            ) : null}
        </section>
    );
}

function MetricCard({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-3xl p-4" style={{ border: '1px solid var(--leaderboard-surface-border)', background: 'var(--leaderboard-surface-bg)' }}>
            <div style={{ color: 'var(--leaderboard-muted)', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.12em' }}>{label}</div>
            <div className="mt-2 text-2xl font-black" style={{ color: 'var(--leaderboard-text)' }}>{value}</div>
        </div>
    );
}
