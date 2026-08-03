'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/language-context';

interface IdentityStripProps {
    userId: string | null;
    /**
     * Optional group label shown under the userId (e.g. "ИС-23-1 · 3 курс").
     * If the caller doesn't have group data yet, leave it out and only the
     * userId line will render.
     */
    groupLine?: string | null;
}

/**
 * Inline avatar + name/userId + group line. No card chrome — it sits flush
 * against the top of the main settings list so the page feels less stacked
 * than the v3 design.
 */
export function IdentityStrip({ userId, groupLine }: IdentityStripProps) {
    const { messages } = useLanguage();
    const storageKey = useMemo(() => (userId ? `profile-avatar:${userId}` : null), [userId]);
    const [customAvatar, setCustomAvatar] = useState<string | null>(() => {
        if (!storageKey || typeof window === 'undefined') return null;
        return localStorage.getItem(storageKey);
    });

    useEffect(() => {
        if (!storageKey) return;
        const onStorage = (event: StorageEvent) => {
            if (event.key === storageKey) {
                setCustomAvatar(event.newValue);
            }
        };
        const onAvatarUpdated = (event: Event) => {
            const detail = (event as CustomEvent<{ userId?: string; avatar?: string | null }>).detail;
            if (!detail || detail.userId !== userId) return;
            setCustomAvatar(detail.avatar ?? null);
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('profile-avatar-updated', onAvatarUpdated as EventListener);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('profile-avatar-updated', onAvatarUpdated as EventListener);
        };
    }, [storageKey, userId]);

    return (
        <section className="flex items-center gap-4 px-1 py-2">
            {customAvatar ? (
                <Image
                    src={customAvatar}
                    alt={messages.settings.identity.profileAvatarAlt}
                    width={64}
                    height={64}
                    unoptimized
                    className="w-16 h-16 rounded-full object-cover"
                />
            ) : (
                <div
                    className="w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold text-white"
                    style={{ background: 'var(--gradient-primary)' }}
                    aria-hidden
                >
                    {userId?.[0]?.toUpperCase() || 'U'}
                </div>
            )}
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-fg text-[17px] truncate">{userId ?? messages.settings.identity.studentKstu}</p>
                {groupLine ? (
                    <p className="text-[13px] text-muted-fg truncate mt-0.5">{groupLine}</p>
                ) : (
                    <p className="text-[13px] text-muted-fg truncate mt-0.5">{messages.settings.identity.studentKstu}</p>
                )}
            </div>
        </section>
    );
}
