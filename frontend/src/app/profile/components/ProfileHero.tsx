'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';
import { Camera, Check, Copy, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface HeroStat {
    label: string;
    value: string;
    /** Optional small caption under the value (e.g. the GPA data source). */
    hint?: string;
}

type GpaSource = 'platonus' | 'attestation' | 'transfer';

interface ProfileHeroProps {
    fullName: string | null;
    userId: string;
    specialty: string | null;
    course: number | null;
    groupName: string | null;
    faculty?: string | null;
    avatarSrc?: string | null;
    gpa?: number | null;
    /** Where the displayed GPA comes from, surfaced as a caption under the value. */
    gpaSource?: GpaSource | null;
    /** Current semester index, e.g. 5. */
    semesterNumber?: number | null;
    /** Total semesters in the program, e.g. 8. */
    totalSemesters?: number | null;
    /** Credits earned to date. */
    creditsEarned?: number | null;
    /** Total credits the program requires, if known. */
    totalCredits?: number | null;
    refreshing: boolean;
    fetching: boolean;
    onRefresh: () => void;
    /** Click avatar / camera button → trigger file picker. */
    onSelectAvatar?: () => void;
    onRemoveAvatar?: () => void;
    /** Slot for supporter / referral chips rendered as a row below the userId chip. */
    chips?: ReactNode;
}

function getInitials(name: string | null): string {
    const source = (name || '').trim();
    if (!source) return '?';
    const parts = source.split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?';
}

/**
 * New profile hero — dense personal banner: avatar, name, faculty/group, a
 * 3-stat strip (GPA / semester / credits) and a chip row for supporter +
 * referral status. Refresh button moves to the corner so the visual weight
 * stays on identity.
 */
export function ProfileHero({
    fullName,
    userId,
    specialty,
    course,
    groupName,
    faculty,
    avatarSrc,
    gpa,
    gpaSource,
    semesterNumber,
    totalSemesters,
    creditsEarned,
    totalCredits,
    refreshing,
    fetching,
    onRefresh,
    onSelectAvatar,
    onRemoveAvatar,
    chips,
}: ProfileHeroProps) {
    const { messages, language } = useLanguage();
    const [copied, setCopied] = useState(false);
    const courseLabel = typeof course === 'number'
        ? language === 'en' ? `${course} year` : `${course} курс`
        : null;
    const metaPieces = [groupName, courseLabel, specialty, faculty].filter((piece) => piece && piece.trim().length > 0);

    const handleCopyUserId = async () => {
        if (!userId) return;
        try {
            await navigator.clipboard.writeText(userId);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch {
            setCopied(false);
        }
    };

    const gpaSourceLabel = (source: GpaSource): string => {
        if (source === 'platonus') return 'Platonus';
        if (source === 'attestation') {
            return language === 'en' ? 'Attestation' : language === 'kz' ? 'Аттестаттау' : 'Аттестация';
        }
        return language === 'en' ? 'Transfer' : language === 'kz' ? 'Ауыстыру' : 'Перевод';
    };

    const stats: HeroStat[] = [];
    if (typeof gpa === 'number') {
        stats.push({
            label: messages.profile.you.statGpaLabel,
            value: gpa.toFixed(2),
            hint: gpaSource ? gpaSourceLabel(gpaSource) : undefined,
        });
    }
    if (typeof semesterNumber === 'number' && semesterNumber > 0) {
        const total = typeof totalSemesters === 'number' && totalSemesters > 0 ? totalSemesters : null;
        stats.push({
            label: messages.profile.you.statSemesterLabel,
            value: total ? `${semesterNumber} / ${total}` : String(semesterNumber),
        });
    }
    if (typeof creditsEarned === 'number' && creditsEarned > 0) {
        const total = typeof totalCredits === 'number' && totalCredits > 0 ? totalCredits : null;
        stats.push({
            label: messages.profile.you.statCreditsLabel,
            value: total ? `${creditsEarned} / ${total}` : String(creditsEarned),
        });
    }

    return (
        <section className="profile-hero">
            <button
                type="button"
                onClick={onSelectAvatar}
                disabled={!onSelectAvatar}
                className="profile-hero-avatar relative group"
                style={{ cursor: onSelectAvatar ? 'pointer' : 'default' }}
                aria-label={messages.profile.changeAvatar}
            >
                {avatarSrc ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={avatarSrc}
                        alt=""
                        className="w-full h-full object-cover rounded-[22px]"
                    />
                ) : (
                    <span>{getInitials(fullName || userId)}</span>
                )}
                {onSelectAvatar ? (
                    <span
                        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full text-xs flex items-center justify-center"
                        style={{ background: 'var(--primary)', color: '#fff', boxShadow: '0 4px 10px rgba(0,0,0,0.18)' }}
                        aria-hidden
                    >
                        <Camera className="w-3.5 h-3.5" />
                    </span>
                ) : null}
            </button>

            <div className="profile-hero-info">
                <h1 className="profile-hero-name">{fullName || userId}</h1>
                <p className="profile-hero-meta">
                    {metaPieces.length > 0 ? metaPieces.join(' · ') : userId}
                </p>
                <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <code
                        className="px-2 py-1 rounded-lg text-xs font-mono surface-overlay-2 text-muted-fg"
                        style={{ border: '1px solid var(--border)' }}
                    >
                        {userId}
                    </code>
                    <button
                        type="button"
                        onClick={() => void handleCopyUserId()}
                        className="chip"
                        data-tone={copied ? 'success' : 'primary'}
                        data-size="sm"
                    >
                        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copied ? messages.profile.copied : messages.profile.copy}
                    </button>
                    {avatarSrc && onRemoveAvatar ? (
                        <button
                            type="button"
                            onClick={onRemoveAvatar}
                            className="text-xs underline text-muted-fg"
                        >
                            {messages.profile.removeAvatar}
                        </button>
                    ) : null}
                </div>
                {chips ? (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {chips}
                    </div>
                ) : null}
            </div>

            <div className="profile-hero-summary">
                <div className="profile-hero-actions">
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing || fetching}
                        className="profile-hero-refresh"
                        aria-label={messages.profile.refresh}
                    >
                        <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
                        <span>{messages.profile.refresh}</span>
                    </button>
                </div>

                {stats.length > 0 ? (
                    <div className="profile-hero-stats">
                        {stats.map((stat) => (
                            <div key={stat.label} className="profile-hero-stat">
                                <div className="profile-hero-stat-label">{stat.label}</div>
                                <div className="profile-hero-stat-value">{stat.value}</div>
                                {stat.hint ? (
                                    <div
                                        className="text-muted-fg"
                                        style={{ marginTop: '2px', fontSize: '11px', fontWeight: 600 }}
                                    >
                                        {stat.hint}
                                    </div>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
            </div>
        </section>
    );
}
