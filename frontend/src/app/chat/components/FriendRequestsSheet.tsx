'use client';

import { Check, X } from 'lucide-react';
import { SettingsBottomSheet } from '@/components/SettingsBottomSheet';
import { useLanguage } from '@/lib/language-context';
import type { UseFriendsReturn } from '../hooks/useFriends';

interface FriendRequestsSheetProps {
    open: boolean;
    onClose: () => void;
    friends: UseFriendsReturn;
    onRespondFriendRequest: (requestId: string, decision: 'accept' | 'reject') => void;
}

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

/**
 * Bottom-sheet listing incoming friend requests with accept/reject actions.
 * Replaces the inline "Друзья" tab UI for the request inbox.
 */
export function FriendRequestsSheet({
    open,
    onClose,
    friends,
    onRespondFriendRequest,
}: FriendRequestsSheetProps) {
    const { messages } = useLanguage();
    const copy = messages.globalChat.personal;
    const incoming = friends.friendOverview.incoming;

    return (
        <SettingsBottomSheet
            open={open}
            onClose={onClose}
            title={copy.requestsSheetTitle}
            closeAriaLabel={messages.common.close}
        >
            <div className="px-5 py-3 space-y-2">
                {incoming.length === 0 ? (
                    <p
                        className="text-center py-8"
                        style={{ color: 'var(--muted)', fontSize: 14 }}
                    >
                        {copy.noRequests}
                    </p>
                ) : (
                    incoming.map((request) => {
                        const hue = hueFor(request.requesterUserId);
                        return (
                            <div
                                key={request.id}
                                className="flex items-center gap-3 p-3 rounded-2xl"
                                style={{
                                    background: 'var(--surface-overlay-1)',
                                    border: '1px solid var(--border)',
                                }}
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
                                    {avatarInitial(request.requesterLabel)}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div
                                        className="truncate"
                                        style={{ color: 'var(--text)', fontSize: 14, fontWeight: 600 }}
                                    >
                                        {request.requesterLabel}
                                    </div>
                                    <div
                                        className="truncate"
                                        style={{ color: 'var(--muted)', fontSize: 12 }}
                                    >
                                        {request.requesterUserId}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                    <button
                                        type="button"
                                        className="btn btn-primary"
                                        style={{
                                            padding: '8px 12px',
                                            borderRadius: 12,
                                            fontSize: 13,
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                        }}
                                        onClick={() => onRespondFriendRequest(request.id, 'accept')}
                                        disabled={friends.chatBusyKey === `request:${request.id}:accept`}
                                    >
                                        <Check size={14} strokeWidth={2.6} aria-hidden />
                                        <span>{copy.acceptBtn}</span>
                                    </button>
                                    <button
                                        type="button"
                                        className="btn"
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
                                        onClick={() => onRespondFriendRequest(request.id, 'reject')}
                                        disabled={friends.chatBusyKey === `request:${request.id}:reject`}
                                    >
                                        <X size={14} strokeWidth={2.6} aria-hidden />
                                        <span>{copy.rejectBtn}</span>
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </SettingsBottomSheet>
    );
}
