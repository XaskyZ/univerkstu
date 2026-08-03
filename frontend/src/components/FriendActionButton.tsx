'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    cancelFriendRequest,
    getFriendOverview,
    removeFriend,
    respondToFriendRequest,
    sendFriendRequest,
    type FriendOverview,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';

const FRIENDS_EVENT = 'friends-state-updated';

let cachedOverview: FriendOverview | null = null;
let pendingOverviewPromise: Promise<FriendOverview | null> | null = null;

export function buildDirectRoomId(userA: string, userB: string): string {
    const [low, high] = [userA.trim(), userB.trim()].sort((left, right) => left.localeCompare(right));
    return `direct:${low}::${high}`;
}

async function readOverview(force = false): Promise<FriendOverview | null> {
    if (!force && cachedOverview) return cachedOverview;
    if (!force && pendingOverviewPromise) return pendingOverviewPromise;

    pendingOverviewPromise = (async () => {
        const result = await getFriendOverview();
        cachedOverview = result.success && result.data ? result.data : null;
        pendingOverviewPromise = null;
        return cachedOverview;
    })();

    return pendingOverviewPromise;
}

function emitFriendsUpdated() {
    cachedOverview = null;
    pendingOverviewPromise = null;
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(FRIENDS_EVENT));
    }
}

export default function FriendActionButton({
    targetUserId,
    className = '',
    compact = false,
}: {
    targetUserId: string;
    className?: string;
    compact?: boolean;
}) {
    const { userId } = useAuth();
    const { language } = useLanguage();
    const router = useRouter();
    const [overview, setOverview] = useState<FriendOverview | null>(cachedOverview);
    const [busy, setBusy] = useState(false);

    const ui = useMemo(() => {
        if (language === 'en') {
            return {
                add: 'Add friend',
                open: 'Open chat',
                accept: 'Accept',
                reject: 'Reject',
                cancel: 'Cancel request',
                remove: 'Remove',
            };
        }
        if (language === 'kz') {
            return {
                add: 'Дос қосу',
                open: 'Чатты ашу',
                accept: 'Қабылдау',
                reject: 'Қабылдамау',
                cancel: 'Сұранысты қайтару',
                remove: 'Өшіру',
            };
        }
        return {
            add: 'В друзья',
            open: 'Открыть чат',
            accept: 'Принять',
            reject: 'Отклонить',
            cancel: 'Отменить заявку',
            remove: 'Удалить',
        };
    }, [language]);

    const refreshOverview = useCallback(async (force = false) => {
        const next = await readOverview(force);
        setOverview(next);
        return next;
    }, []);

    useEffect(() => {
        let mounted = true;
        const syncOverview = async (force = false) => {
            const next = await readOverview(force);
            if (mounted) {
                setOverview(next);
            }
        };

        void syncOverview(false);
        const handleUpdate = () => { void syncOverview(true); };
        window.addEventListener(FRIENDS_EVENT, handleUpdate);
        return () => {
            mounted = false;
            window.removeEventListener(FRIENDS_EVENT, handleUpdate);
        };
    }, []);

    const derived = useMemo(() => {
        if (!overview || !userId || !targetUserId || userId === targetUserId) return null;

        const friend = overview.friends.find((item) => item.userId === targetUserId);
        if (friend) {
            return { kind: 'friend' as const, roomId: friend.roomId };
        }

        const incoming = overview.incoming.find((item) => item.requesterUserId === targetUserId);
        if (incoming) {
            return { kind: 'incoming' as const, requestId: incoming.id };
        }

        const outgoing = overview.outgoing.find((item) => item.targetUserId === targetUserId);
        if (outgoing) {
            return { kind: 'outgoing' as const, requestId: outgoing.id };
        }

        return { kind: 'none' as const };
    }, [overview, targetUserId, userId]);

    const handleOpenChat = useCallback(() => {
        if (!userId) return;
        const roomId = derived?.kind === 'friend' && derived.roomId
            ? derived.roomId
            : buildDirectRoomId(userId, targetUserId);
        router.push(`/chat?roomId=${encodeURIComponent(roomId)}`);
    }, [derived, router, targetUserId, userId]);

    const handleAdd = useCallback(async () => {
        setBusy(true);
        const result = await sendFriendRequest(targetUserId);
        if (result.success) {
            emitFriendsUpdated();
            await refreshOverview(true);
        }
        setBusy(false);
    }, [refreshOverview, targetUserId]);

    const handleAccept = useCallback(async () => {
        if (derived?.kind !== 'incoming') return;
        setBusy(true);
        const result = await respondToFriendRequest(derived.requestId, 'accept');
        if (result.success) {
            emitFriendsUpdated();
            await refreshOverview(true);
        }
        setBusy(false);
    }, [derived, refreshOverview]);

    const handleReject = useCallback(async () => {
        if (derived?.kind !== 'incoming') return;
        setBusy(true);
        const result = await respondToFriendRequest(derived.requestId, 'reject');
        if (result.success) {
            emitFriendsUpdated();
            await refreshOverview(true);
        }
        setBusy(false);
    }, [derived, refreshOverview]);

    const handleCancel = useCallback(async () => {
        if (derived?.kind !== 'outgoing') return;
        setBusy(true);
        const result = await cancelFriendRequest(derived.requestId);
        if (result.success) {
            emitFriendsUpdated();
            await refreshOverview(true);
        }
        setBusy(false);
    }, [derived, refreshOverview]);

    const handleRemove = useCallback(async () => {
        if (derived?.kind !== 'friend') return;
        setBusy(true);
        const result = await removeFriend(targetUserId);
        if (result.success) {
            emitFriendsUpdated();
            await refreshOverview(true);
        }
        setBusy(false);
    }, [derived, refreshOverview, targetUserId]);

    if (!userId || !targetUserId || userId === targetUserId || !derived) {
        return null;
    }

    const baseClass = `${compact ? 'px-2.5 py-1.5 text-[11px]' : 'px-3 py-2 text-xs'} rounded-xl font-medium disabled:opacity-60`;
    const wrapClass = compact ? 'flex flex-wrap gap-2' : 'flex flex-wrap gap-2';
    const primaryStyle = { background: 'var(--gradient-primary)', color: '#fff', border: '1px solid transparent', boxShadow: '0 12px 28px rgba(var(--primary-rgb), 0.22)' };
    const neutralStyle = { background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' };
    const dangerStyle = { background: 'rgba(var(--danger-rgb), 0.12)', color: 'var(--danger)', border: '1px solid rgba(var(--danger-rgb), 0.24)' };

    if (derived.kind === 'friend') {
        return (
            <div className={`${wrapClass} ${className}`.trim()}>
                <button type="button" onClick={handleOpenChat} disabled={busy} className={baseClass} style={primaryStyle}>
                    {ui.open}
                </button>
                <button type="button" onClick={() => void handleRemove()} disabled={busy} className={baseClass} style={dangerStyle}>
                    {ui.remove}
                </button>
            </div>
        );
    }

    if (derived.kind === 'incoming') {
        return (
            <div className={`${wrapClass} ${className}`.trim()}>
                <button type="button" onClick={() => void handleAccept()} disabled={busy} className={baseClass} style={primaryStyle}>
                    {ui.accept}
                </button>
                <button type="button" onClick={() => void handleReject()} disabled={busy} className={baseClass} style={neutralStyle}>
                    {ui.reject}
                </button>
            </div>
        );
    }

    if (derived.kind === 'outgoing') {
        return (
            <div className={`${wrapClass} ${className}`.trim()}>
                <button type="button" onClick={() => void handleCancel()} disabled={busy} className={baseClass} style={neutralStyle}>
                    {ui.cancel}
                </button>
            </div>
        );
    }

    return (
        <div className={`${wrapClass} ${className}`.trim()}>
            <button type="button" onClick={() => void handleAdd()} disabled={busy} className={baseClass} style={primaryStyle}>
                {ui.add}
            </button>
        </div>
    );
}
