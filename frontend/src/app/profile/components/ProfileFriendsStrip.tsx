import Link from 'next/link';
import { Users } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import type { FriendView } from '@/lib/api';
import { Skeleton } from '@/components/ThemeSkeleton';

interface ProfileFriendsStripProps {
    friends: FriendView[] | null;
    loading: boolean;
}

const MAX_VISIBLE_AVATARS = 6;

/** Hash a string into a stable hue so each person gets their own gradient. */
function hueFor(seed: string): number {
    let hash = 0;
    for (let index = 0; index < seed.length; index += 1) {
        hash = (hash * 31 + seed.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) % 360;
}

function getInitial(label: string): string {
    const trimmed = (label || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

/**
 * Slim avatar strip — 6 avatars + overflow chip + total + "All →" link.
 * If the user has 0 friends, we DON'T turn this into a big CTA; the inline
 * `+ Найти друзей` link below is enough to nudge action without dominating
 * the page (see profile spec defaults).
 */
export function ProfileFriendsStrip({ friends, loading }: ProfileFriendsStripProps) {
    const { messages } = useLanguage();

    // Show skeleton while the friends fetch is still in-flight so the slot
    // reserves the same vertical space the real strip will occupy. Once the
    // fetch resolves with [], the empty-state CTA below replaces it (the
    // skeleton is never used to represent "actually empty").
    if (loading || friends === null) {
        return (
            <div
                className="card flex items-center justify-between gap-3 px-4 py-3"
                style={{ animationDelay: '120ms' }}
                aria-busy="true"
                aria-live="polite"
            >
                <div className="flex items-center gap-3 min-w-0">
                    <Skeleton className="h-4 w-16 shrink-0" />
                    <div className="flex items-center -space-x-2 min-w-0">
                        {[0, 1, 2, 3, 4, 5].map((index) => (
                            <Skeleton
                                key={index}
                                className="w-7 h-7 rounded-full"
                                // Inline so the white "card" gap between
                                // avatars still reads as overlapping circles
                                // while loading (matches real layout).
                            />
                        ))}
                    </div>
                </div>
                <Skeleton className="h-3.5 w-10 shrink-0" />
            </div>
        );
    }

    const total = friends.length;

    if (total === 0) {
        return (
            <div
                className="card animate-fadeInUp profile-card-fade-in flex items-center justify-between gap-3 px-4 py-3"
                style={{ animationDelay: '120ms' }}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <Users className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} aria-hidden />
                    <span className="text-sm font-medium text-fg">
                        {messages.profile.you.friendsTitle}
                    </span>
                    <span className="text-xs text-muted-fg">0</span>
                </div>
                <Link
                    href="/chat"
                    className="text-xs font-semibold"
                    style={{ color: 'var(--primary)' }}
                >
                    {messages.profile.you.friendsEmptyAction}
                </Link>
            </div>
        );
    }

    const visible = friends.slice(0, MAX_VISIBLE_AVATARS);
    const overflow = total - visible.length;

    return (
        <div
            className="card animate-fadeInUp profile-card-fade-in flex items-center justify-between gap-3 px-4 py-3"
            style={{ animationDelay: '120ms' }}
        >
            <div className="flex items-center gap-3 min-w-0">
                <span className="text-sm font-medium text-fg shrink-0">
                    {messages.profile.you.friendsTitle}
                </span>
                <span className="text-xs text-muted-fg shrink-0">{total}</span>
                <div className="flex items-center -space-x-2 min-w-0">
                    {visible.map((friend) => {
                        const hue = hueFor(friend.userId);
                        return (
                            <div
                                key={friend.userId}
                                className="w-7 h-7 rounded-full text-[11px] font-semibold flex items-center justify-center text-white"
                                style={{
                                    background: `linear-gradient(135deg, hsl(${hue}, 72%, 58%), hsl(${(hue + 40) % 360}, 65%, 50%))`,
                                    border: '2px solid var(--card)',
                                }}
                                title={friend.label}
                                aria-hidden
                            >
                                {getInitial(friend.label)}
                            </div>
                        );
                    })}
                    {overflow > 0 ? (
                        <div
                            className="w-7 h-7 rounded-full text-[11px] font-semibold flex items-center justify-center"
                            style={{
                                background: 'var(--surface-overlay-2)',
                                color: 'var(--text)',
                                border: '2px solid var(--card)',
                            }}
                            aria-hidden
                        >
                            +{overflow}
                        </div>
                    ) : null}
                </div>
            </div>
            <Link
                href="/chat"
                className="text-xs font-semibold shrink-0"
                style={{ color: 'var(--primary)' }}
            >
                {messages.profile.you.friendsViewAll}
            </Link>
        </div>
    );
}
