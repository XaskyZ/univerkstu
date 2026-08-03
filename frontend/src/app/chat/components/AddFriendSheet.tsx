'use client';

import { useEffect, useState } from 'react';
import { Loader2, Search, UserPlus } from 'lucide-react';
import { SettingsBottomSheet } from '@/components/SettingsBottomSheet';
import { useLanguage } from '@/lib/language-context';
import type { UseFriendsReturn } from '../hooks/useFriends';

interface AddFriendSheetProps {
    open: boolean;
    onClose: () => void;
    friends: UseFriendsReturn;
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
 * Bottom-sheet for finding people by login / name and sending friend requests.
 * Debounces the search 300ms after typing stops; clears on close.
 */
export function AddFriendSheet({ open, onClose, friends }: AddFriendSheetProps) {
    const { messages } = useLanguage();
    const copy = messages.globalChat.personal;
    const [pendingTarget, setPendingTarget] = useState<string | null>(null);

    // Debounced search — fires 300ms after typing stops.
    useEffect(() => {
        if (!open) return;
        const value = friends.searchValue.trim();
        if (!value) return;
        const timer = window.setTimeout(() => {
            void friends.refreshSearchResults();
        }, 300);
        return () => window.clearTimeout(timer);
    }, [friends, friends.searchValue, open]);

    // Reset search state when the sheet closes so a fresh open is empty.
    // Deferred to the next tick to avoid cascading renders inside the effect.
    useEffect(() => {
        if (open) return;
        const timer = window.setTimeout(() => {
            friends.setSearchValue('');
            setPendingTarget(null);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [friends, open]);

    const handleSendRequest = async (targetUserId: string) => {
        setPendingTarget(targetUserId);
        await friends.sendRequest(targetUserId);
        setPendingTarget(null);
    };

    const trimmedValue = friends.searchValue.trim();

    return (
        <SettingsBottomSheet
            open={open}
            onClose={onClose}
            title={copy.addFriendSheetTitle}
            closeAriaLabel={messages.common.close}
        >
            <div className="px-5 py-3 space-y-3">
                <div
                    className="flex items-center gap-2 px-3 py-2 rounded-2xl"
                    style={{
                        background: 'var(--surface-overlay-1)',
                        border: '1px solid var(--border)',
                    }}
                >
                    <Search size={16} strokeWidth={2.2} aria-hidden style={{ color: 'var(--muted)' }} />
                    <input
                        autoFocus
                        type="text"
                        value={friends.searchValue}
                        onChange={(event) => friends.setSearchValue(event.target.value)}
                        placeholder={copy.addFriendSheetPlaceholder}
                        className="flex-1 bg-transparent outline-none"
                        style={{ color: 'var(--text)', fontSize: 14 }}
                    />
                    {friends.searchBusy ? (
                        <Loader2
                            size={14}
                            strokeWidth={2.4}
                            className="animate-spin"
                            aria-hidden
                            style={{ color: 'var(--muted)' }}
                        />
                    ) : null}
                </div>

                {friends.searchError ? (
                    <p style={{ color: 'var(--danger)', fontSize: 13 }}>{friends.searchError}</p>
                ) : null}

                {trimmedValue.length === 0 ? (
                    <p
                        className="text-center py-6"
                        style={{ color: 'var(--muted)', fontSize: 14 }}
                    >
                        {copy.addFriendSheetPlaceholder}
                    </p>
                ) : friends.searchResults.length === 0 && !friends.searchBusy ? (
                    <p
                        className="text-center py-6"
                        style={{ color: 'var(--muted)', fontSize: 14 }}
                    >
                        {copy.noResults}
                    </p>
                ) : (
                    <div className="space-y-2">
                        {friends.searchResults.map((user) => {
                            const hue = hueFor(user.userId);
                            const alreadyFriend = user.status === 'friend';
                            const alreadyOutgoing = user.status === 'outgoing';
                            const alreadyIncoming = user.status === 'incoming';
                            const isPending = pendingTarget === user.userId;

                            return (
                                <div
                                    key={user.userId}
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
                                            {user.userId}
                                        </div>
                                    </div>
                                    {alreadyFriend || alreadyOutgoing || alreadyIncoming ? null : (
                                        <button
                                            type="button"
                                            className="btn btn-primary flex-shrink-0"
                                            style={{
                                                padding: '8px 12px',
                                                borderRadius: 12,
                                                fontSize: 13,
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 6,
                                            }}
                                            onClick={() => void handleSendRequest(user.userId)}
                                            disabled={isPending}
                                        >
                                            {isPending ? (
                                                <Loader2 size={14} strokeWidth={2.4} className="animate-spin" aria-hidden />
                                            ) : (
                                                <UserPlus size={14} strokeWidth={2.4} aria-hidden />
                                            )}
                                            <span>{copy.addFriendBtn}</span>
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </SettingsBottomSheet>
    );
}
