'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldOff } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import {
    getMessagingPreferences,
    unblockChatUser,
    type BlockedChatUserView,
} from '@/lib/api';
import { PageMain, PageShell, PageStateCard } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';

function avatarInitial(label: string): string {
    const trimmed = (label || '').trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : '?';
}

function hueFor(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
}

export default function SettingsBlockedPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const copy = messages.settings.blocked;

    const [blockedUsers, setBlockedUsers] = useState<BlockedChatUserView[]>([]);
    const [initialLoading, setInitialLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [pendingUnblock, setPendingUnblock] = useState<string | null>(null);

    const load = useCallback(async () => {
        const result = await getMessagingPreferences();
        if (result.success && result.data) {
            setBlockedUsers(result.data.blockedUsers || []);
            setError(null);
        } else {
            setError(result.error || copy.screenTitle);
        }
        setInitialLoading(false);
    }, [copy.screenTitle]);

    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    useEffect(() => {
        if (!isAuth) return;
        // Defer to next tick so the loader doesn't fire setState during commit.
        const timer = window.setTimeout(() => {
            void load();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isAuth, load]);

    if (loading || !isAuth) return null;

    const handleUnblock = async (userId: string) => {
        setPendingUnblock(userId);
        const result = await unblockChatUser(userId);
        if (result.success) {
            setBlockedUsers((prev) => prev.filter((user) => user.userId !== userId));
        } else {
            setError(result.error || copy.screenTitle);
        }
        setPendingUnblock(null);
    };

    return (
        <PageShell>
            <SubScreenHeader title={copy.screenTitle} subtitle={copy.screenSubtitle} />
            <PageMain className="space-y-3" spacing="lg">
                {error ? <PageStateCard message={error} tone="danger" /> : null}

                {initialLoading ? (
                    <section className="card p-6">
                        <div
                            className="flex items-center justify-center gap-2"
                            style={{ color: 'var(--muted)', fontSize: 14 }}
                        >
                            <Loader2 size={16} strokeWidth={2.2} className="animate-spin" aria-hidden />
                            <span>{messages.common.loading}</span>
                        </div>
                    </section>
                ) : blockedUsers.length === 0 ? (
                    <section
                        className="card p-8 text-center"
                        style={{ color: 'var(--muted)' }}
                    >
                        <ShieldOff
                            size={32}
                            strokeWidth={1.6}
                            aria-hidden
                            className="mx-auto mb-3"
                            style={{ opacity: 0.6 }}
                        />
                        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                            {copy.emptyTitle}
                        </p>
                    </section>
                ) : (
                    <div className="space-y-2">
                        {blockedUsers.map((user) => {
                            const hue = hueFor(user.userId);
                            const isPending = pendingUnblock === user.userId;
                            return (
                                <div
                                    key={user.userId}
                                    className="card flex items-center gap-3 p-3"
                                >
                                    <div
                                        aria-hidden
                                        className="flex-shrink-0 flex items-center justify-center"
                                        style={{
                                            width: 40,
                                            height: 40,
                                            borderRadius: 14,
                                            background: `linear-gradient(135deg, hsl(${hue}, 72%, 58%), hsl(${(hue + 40) % 360}, 65%, 50%))`,
                                            color: 'white',
                                            fontWeight: 700,
                                            fontSize: 16,
                                        }}
                                    >
                                        {avatarInitial(user.label)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div
                                            className="truncate"
                                            style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}
                                        >
                                            {user.label}
                                        </div>
                                        <div
                                            className="truncate"
                                            style={{ color: 'var(--muted)', fontSize: 12 }}
                                        >
                                            {user.reason || user.userId}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        className="btn"
                                        onClick={() => void handleUnblock(user.userId)}
                                        disabled={isPending}
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: 12,
                                            fontSize: 13,
                                            background: 'var(--surface-overlay-2)',
                                            color: 'var(--text)',
                                            border: '1px solid var(--border)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                        }}
                                    >
                                        {isPending ? (
                                            <Loader2 size={14} strokeWidth={2.4} className="animate-spin" aria-hidden />
                                        ) : null}
                                        <span>{copy.unblockBtn}</span>
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </PageMain>
        </PageShell>
    );
}
