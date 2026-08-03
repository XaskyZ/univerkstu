import Link from 'next/link';
import { Circle, CircleDot, TrendingUp } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import type { StudentAcademicOptions } from './types';
import { Skeleton } from '@/components/ThemeSkeleton';

interface ProfileActionsCardProps {
    academicOptions?: StudentAcademicOptions | null;
    loading?: boolean;
}

/**
 * "Действия по учёбе" — only renders if the user actually has something
 * actionable (retake available / FX submitted / GPA-up affordance).
 * Otherwise we hide the card entirely instead of showing an empty state.
 *
 * When loading=true and we have no data yet, render a 3-row skeleton so
 * the slot reserves space. The moment data arrives we either render the
 * real card OR return null if there's nothing actionable — we never leave
 * the skeleton up as a permanent "empty" placeholder.
 */
export function ProfileActionsCard({ academicOptions, loading = false }: ProfileActionsCardProps) {
    const { messages } = useLanguage();

    if (loading && !academicOptions) {
        return <ProfileActionsCardSkeleton title={messages.profile.you.actionsTitle} />;
    }

    if (!academicOptions) return null;

    const retakeAvailable = academicOptions.retake.availableCount || 0;
    const fxSubmitted = academicOptions.fx.submittedCount || 0;
    const gpaUpAnnualCost = academicOptions.gpaIncrease.annualCost || null;
    const gpaUpAvailable = academicOptions.gpaIncrease.availableCount || 0;

    const showRetake = retakeAvailable > 0;
    const showFx = fxSubmitted > 0;
    const showGpaUp = Boolean(gpaUpAnnualCost) || gpaUpAvailable > 0;

    if (!showRetake && !showFx && !showGpaUp) {
        return null;
    }

    return (
        <div className="card animate-fadeInUp profile-card-fade-in" style={{ animationDelay: '160ms' }}>
            <div className="card-header">
                <h3 className="card-header-title">{messages.profile.you.actionsTitle}</h3>
            </div>
            <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {showRetake ? (
                    <ActionRow
                        icon={<CircleDot className="w-4 h-4" aria-hidden />}
                        tone="success"
                        label={messages.profile.you.actionRetakeLabel}
                        count={retakeAvailable}
                        cta={messages.profile.you.actionCtaSubmit}
                        href="/grades"
                    />
                ) : null}
                {showFx ? (
                    <ActionRow
                        icon={<Circle className="w-4 h-4" aria-hidden />}
                        tone="muted"
                        label={messages.profile.you.actionFxLabel}
                        count={fxSubmitted}
                        href="/grades"
                    />
                ) : null}
                {showGpaUp ? (
                    <ActionRow
                        icon={<TrendingUp className="w-4 h-4" aria-hidden />}
                        tone="primary"
                        label={messages.profile.you.actionGpaUpLabel}
                        priceText={gpaUpAnnualCost
                            ? `${gpaUpAnnualCost}${messages.profile.you.actionGpaUpYearSuffix}`
                            : null}
                        cta={messages.profile.you.actionCtaDetails}
                        href="/grades"
                    />
                ) : null}
            </div>
        </div>
    );
}

interface ActionRowProps {
    icon: React.ReactNode;
    tone: 'success' | 'muted' | 'primary';
    label: string;
    count?: number;
    priceText?: string | null;
    cta?: string;
    href: string;
}

function ActionRow({ icon, tone, label, count, priceText, cta, href }: ActionRowProps) {
    const iconStyle = tone === 'success'
        ? { background: 'var(--status-success-bg)', color: 'var(--status-success-color)', border: '1px solid var(--status-success-border)' }
        : tone === 'primary'
            ? { background: 'rgba(var(--primary-rgb), 0.14)', color: 'var(--primary)', border: '1px solid rgba(var(--primary-rgb), 0.24)' }
            : { background: 'var(--surface-overlay-2)', color: 'var(--muted)', border: '1px solid var(--border)' };

    return (
        <div className="flex items-center gap-3 px-4 py-3">
            <div
                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                style={iconStyle}
                aria-hidden
            >
                {icon}
            </div>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-fg truncate">{label}</div>
                {priceText ? (
                    <div className="text-xs text-muted-fg truncate">{priceText}</div>
                ) : null}
            </div>
            {typeof count === 'number' ? (
                <span
                    className="text-sm font-semibold tabular-nums shrink-0"
                    style={{ color: tone === 'success' ? 'var(--status-success-color)' : 'var(--text)' }}
                >
                    {count}
                </span>
            ) : null}
            {cta ? (
                <Link
                    href={href}
                    className="btn btn-secondary text-xs px-3 py-1.5 shrink-0"
                >
                    {cta}
                </Link>
            ) : null}
        </div>
    );
}

/**
 * Skeleton variant — 3 rows matching the heights of retake/FX/GPA-up real
 * rows so the surrounding card stack doesn't shift when data resolves.
 */
function ProfileActionsCardSkeleton({ title }: { title: string }) {
    return (
        <div
            className="card animate-fadeInUp"
            style={{ animationDelay: '160ms' }}
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
                            <Skeleton className="h-3.5 w-2/5" />
                            {index === 2 ? <Skeleton className="h-3 w-1/3" /> : null}
                        </div>
                        <Skeleton className="h-7 w-16 rounded-xl shrink-0" />
                    </div>
                ))}
            </div>
        </div>
    );
}
