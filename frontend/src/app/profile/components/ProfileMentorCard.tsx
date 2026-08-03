import { Briefcase, Mail, Phone, UserRound } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import type { StudentAdvisor, StudentPractice } from './types';
import { Skeleton } from '@/components/ThemeSkeleton';

interface ProfileMentorCardProps {
    advisor?: StudentAdvisor | null;
    practice?: StudentPractice | null;
    loading?: boolean;
}

/**
 * Compact advisor + nearest practice tile. Sits ABOVE the questionnaire
 * accordion, so the two most actionable contacts are never hidden.
 *
 * Shows a 2-row skeleton (advisor + practice slots) only while we haven't
 * received the profile payload yet AND we don't already know the answer.
 * Once data resolves, if both advisor and practice are absent we collapse
 * the card entirely — skeleton is for "still loading", not "empty".
 */
export function ProfileMentorCard({ advisor, practice, loading = false }: ProfileMentorCardProps) {
    const { messages } = useLanguage();
    const latestPractice = practice?.groups?.[0] || null;
    const advisorHasContent = Boolean(advisor?.fullName || advisor?.email || advisor?.workPhone);

    if (loading && !advisorHasContent && !latestPractice) {
        return <ProfileMentorCardSkeleton title={messages.profile.you.mentorTitle} />;
    }

    if (!advisorHasContent && !latestPractice) {
        return null;
    }

    return (
        <div className="card animate-fadeInUp profile-card-fade-in" style={{ animationDelay: '150ms' }}>
            <div className="card-header">
                <h3 className="card-header-title">{messages.profile.you.mentorTitle}</h3>
            </div>
            <div className="p-4 space-y-3">
                {advisorHasContent && advisor ? (
                    <div
                        className="rounded-xl p-3 flex items-start gap-3 surface-overlay-1"
                        style={{ border: '1px solid var(--border)' }}
                    >
                        <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                            style={{
                                background: 'var(--status-info-bg)',
                                color: 'var(--status-info-color)',
                                border: '1px solid var(--status-info-border)',
                            }}
                            aria-hidden
                        >
                            <UserRound className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                            <div
                                className="text-[11px] font-semibold uppercase tracking-wider"
                                style={{ color: 'var(--muted)' }}
                            >
                                {messages.profile.you.mentorAdvisorLabel}
                            </div>
                            <div className="text-sm font-medium text-fg break-words">
                                {advisor.fullName || '—'}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-fg">
                                {advisor.email ? (
                                    <a
                                        href={`mailto:${advisor.email}`}
                                        className="inline-flex items-center gap-1 hover:underline break-all"
                                        style={{ color: 'var(--primary)' }}
                                    >
                                        <Mail className="w-3 h-3 shrink-0" aria-hidden />
                                        <span>{advisor.email}</span>
                                    </a>
                                ) : null}
                                {advisor.workPhone ? (
                                    <a
                                        href={`tel:${advisor.workPhone}`}
                                        className="inline-flex items-center gap-1 hover:underline"
                                        style={{ color: 'var(--primary)' }}
                                    >
                                        <Phone className="w-3 h-3 shrink-0" aria-hidden />
                                        <span>{advisor.workPhone}</span>
                                    </a>
                                ) : null}
                            </div>
                        </div>
                    </div>
                ) : null}

                {latestPractice ? (
                    <div
                        className="rounded-xl p-3 flex items-start gap-3 surface-overlay-1"
                        style={{ border: '1px solid var(--border)' }}
                    >
                        <div
                            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                            style={{
                                background: 'rgba(var(--primary-rgb), 0.14)',
                                color: 'var(--primary)',
                                border: '1px solid rgba(var(--primary-rgb), 0.24)',
                            }}
                            aria-hidden
                        >
                            <Briefcase className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1 space-y-1">
                            <div
                                className="text-[11px] font-semibold uppercase tracking-wider"
                                style={{ color: 'var(--muted)' }}
                            >
                                {messages.profile.you.mentorPracticeLabel}
                            </div>
                            <div className="text-sm font-medium text-fg break-words">
                                {latestPractice.practiceType || '—'}
                            </div>
                            {latestPractice.organization ? (
                                <div className="text-xs text-muted-fg break-words">
                                    {latestPractice.organization}
                                </div>
                            ) : null}
                            {latestPractice.period ? (
                                <div className="text-xs text-muted-fg">
                                    {latestPractice.period}
                                </div>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/**
 * Skeleton variant — 2 tile slots (advisor + practice). Each tile mirrors
 * the real tile's avatar + 2-line text layout so swap-in is stable.
 */
function ProfileMentorCardSkeleton({ title }: { title: string }) {
    return (
        <div
            className="card animate-fadeInUp"
            style={{ animationDelay: '150ms' }}
            aria-busy="true"
            aria-live="polite"
        >
            <div className="card-header">
                <h3 className="card-header-title">{title}</h3>
            </div>
            <div className="p-4 space-y-3">
                {[0, 1].map((index) => (
                    <div
                        key={index}
                        className="rounded-xl p-3 flex items-start gap-3 surface-overlay-1"
                        style={{ border: '1px solid var(--border)' }}
                    >
                        <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                        <div className="min-w-0 flex-1 space-y-1.5">
                            <Skeleton className="h-2.5 w-20" />
                            <Skeleton className="h-3.5 w-3/5" />
                            <Skeleton className="h-3 w-2/5" />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
