import Link from 'next/link';
import { ChevronRight, Heart, Sparkles, Trophy } from 'lucide-react';
import { formatMessage, useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import type { SupporterSummary, SupportTierId } from '@/lib/api';
import { Skeleton } from '@/components/ThemeSkeleton';

interface RankInput {
    rank: number | null;
    total: number;
}

interface ProfileRanksCardProps {
    activity: RankInput | null;
    invites: RankInput | null;
    supporter: SupporterSummary | null;
    loading?: boolean;
}

/**
 * "Где ты в топах" — 3 rank rows. Each row deep-links to the matching
 * leaderboard. Low ranks (bottom half) are reframed as "Войди в топ" so
 * we never shame the user with raw 489/612 numbers.
 *
 * While the parent is still waiting on the leaderboard/referral/support
 * side-fetches, render a 3-row skeleton (same heights as the real rows) so
 * the card doesn't pop in once data lands. Once loading=false and there's
 * genuinely no data, return null — empty answer collapses the card, the
 * skeleton is NOT a permanent placeholder.
 */
export function ProfileRanksCard({ activity, invites, supporter, loading = false }: ProfileRanksCardProps) {
    const { messages } = useLanguage();

    const showActivity = activity !== null;
    const showInvites = invites !== null;
    const showSupporter = Boolean(supporter?.enabled);

    if (loading) {
        return <ProfileRanksCardSkeleton title={messages.profile.you.ranksTitle} />;
    }

    if (!showActivity && !showInvites && !showSupporter) {
        return null;
    }

    return (
        <div className="card animate-fadeInUp profile-card-fade-in" style={{ animationDelay: '140ms' }}>
            <div className="card-header">
                <h3 className="card-header-title">{messages.profile.you.ranksTitle}</h3>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {showActivity && activity ? (
                    <RankRow
                        href="/settings/activity"
                        icon={<Trophy className="w-4 h-4" aria-hidden />}
                        accent="warning"
                        label={messages.profile.you.rankActivityLabel}
                        rankInput={activity}
                    />
                ) : null}
                {showInvites && invites ? (
                    <RankRow
                        href="/settings/activity"
                        icon={<Sparkles className="w-4 h-4" aria-hidden />}
                        accent="primary"
                        label={messages.profile.you.rankInvitesLabel}
                        rankInput={invites}
                    />
                ) : null}
                {showSupporter && supporter ? (
                    <SupporterRow supporter={supporter} />
                ) : null}
            </div>
        </div>
    );
}

interface RankRowProps {
    href: string;
    icon: React.ReactNode;
    accent: 'warning' | 'primary' | 'info';
    label: string;
    rankInput: RankInput;
}

function RankRow({ href, icon, accent, label, rankInput }: RankRowProps) {
    const { messages } = useLanguage();
    const { rank, total } = rankInput;

    const isTopHalf = typeof rank === 'number' && total > 0 && rank <= Math.ceil(total / 2);
    const positionText = typeof rank === 'number' && total > 0 && isTopHalf
        ? formatMessage(messages.profile.you.rankPositionTemplate, { rank, total })
        : total > 0
            ? messages.profile.you.rankJoinTop
            : messages.profile.you.rankNoData;

    const iconStyle = accent === 'warning'
        ? { background: 'var(--status-warning-bg)', color: 'var(--status-warning-color)', border: '1px solid var(--status-warning-border)' }
        : accent === 'primary'
            ? { background: 'rgba(var(--primary-rgb), 0.14)', color: 'var(--primary)', border: '1px solid rgba(var(--primary-rgb), 0.24)' }
            : { background: 'var(--status-info-bg)', color: 'var(--status-info-color)', border: '1px solid var(--status-info-border)' };

    return (
        <Link
            href={href}
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-overlay-1)]"
        >
            <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={iconStyle}
                aria-hidden
            >
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-fg truncate">{label}</div>
                <div className="text-xs text-muted-fg truncate">{positionText}</div>
            </div>
            <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} aria-hidden />
        </Link>
    );
}

function SupporterRow({ supporter }: { supporter: SupporterSummary }) {
    const { messages, language } = useLanguage();
    const tier = supporter.highestTierId;
    const tierLabel = tierToLabel(tier, messages.profile.you);

    const amountFormatted = supporter.totalDonatedKzt.toLocaleString(localeTag(language));
    const amountText = formatMessage(messages.profile.you.supporterAmountTemplate, { amount: amountFormatted });
    const subtitle = tierLabel ? `${tierLabel} · ${amountText}` : amountText;

    return (
        <Link
            href="/support"
            className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-overlay-1)]"
        >
            <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={{
                    background: 'rgba(var(--primary-rgb), 0.14)',
                    color: 'var(--primary)',
                    border: '1px solid rgba(var(--primary-rgb), 0.24)',
                }}
                aria-hidden
            >
                <Heart className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-fg truncate">
                    {messages.profile.you.rankSupporterLabel}
                </div>
                <div className="text-xs text-muted-fg truncate">{subtitle}</div>
            </div>
            <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} aria-hidden />
        </Link>
    );
}

function tierToLabel(
    tier: SupportTierId | null,
    you: { supporterTierFriend: string; supporterTierBoost: string; supporterTierHero: string },
): string | null {
    if (!tier) return null;
    if (tier === 'hero') return you.supporterTierHero;
    if (tier === 'boost') return you.supporterTierBoost;
    return you.supporterTierFriend;
}

/**
 * Skeleton variant — 3 rows with the same heights/spacing as the real
 * RankRow so swapping to real content doesn't shift surrounding cards.
 */
function ProfileRanksCardSkeleton({ title }: { title: string }) {
    return (
        <div
            className="card animate-fadeInUp"
            style={{ animationDelay: '140ms' }}
            aria-busy="true"
            aria-live="polite"
        >
            <div className="card-header">
                <h3 className="card-header-title">{title}</h3>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {[0, 1, 2].map((index) => (
                    <div key={index} className="flex items-center gap-3 px-4 py-3">
                        <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                        <div className="flex-1 min-w-0 space-y-1.5">
                            <Skeleton className="h-3.5 w-1/2" />
                            <Skeleton className="h-3 w-2/3" />
                        </div>
                        <Skeleton className="w-4 h-4 shrink-0 rounded" />
                    </div>
                ))}
            </div>
        </div>
    );
}
