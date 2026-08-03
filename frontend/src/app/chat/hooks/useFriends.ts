'use client';

import { useCallback, useMemo, useState } from 'react';
import {
    blockChatUser as apiBlockChatUser,
    getFriendOverview,
    getMessagingPreferences,
    respondToFriendRequest as apiRespondToFriendRequest,
    searchChatUsers,
    sendFriendRequest as apiSendFriendRequest,
    unblockChatUser as apiUnblockChatUser,
    type ChatUserSearchView,
    type FriendOverview,
    type MessagingPreferencesView,
} from '@/lib/api';
import { DEFAULT_MESSAGING_PREFERENCES, EMPTY_FRIEND_OVERVIEW } from '../types';

/**
 * Friends data + actions for the chat surface.
 *
 * Slimmed down after the Друзья tab was merged into the Личные tab as bottom
 * sheets. We still need:
 *   - `friends` (for sender authority elsewhere)
 *   - `incoming` requests (for the requests sheet + badge count)
 *   - `acceptRequest` / `rejectRequest`
 *   - `sendRequest` (for the AddFriendSheet)
 *   - search state (for the AddFriendSheet)
 *   - block/unblock + messagingPreferences (consumed from /settings/blocked)
 */
export function useFriends() {
    const [friendOverview, setFriendOverview] = useState<FriendOverview>(EMPTY_FRIEND_OVERVIEW);
    const [messagingPreferences, setMessagingPreferences] = useState<MessagingPreferencesView>(DEFAULT_MESSAGING_PREFERENCES);
    const [friendsLoading, setFriendsLoading] = useState(true);
    const [preferencesLoading, setPreferencesLoading] = useState(true);
    const [friendError, setFriendError] = useState<string | null>(null);
    const [searchValue, setSearchValue] = useState('');
    const [searchResults, setSearchResults] = useState<ChatUserSearchView[]>([]);
    const [searchBusy, setSearchBusy] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [chatBusyKey, setChatBusyKey] = useState<string | null>(null);

    const totalPendingRequests = friendOverview.incoming.length;

    const blockedUserIds = useMemo(
        () => new Set((messagingPreferences.blockedUsers || []).map((item) => item.userId)),
        [messagingPreferences.blockedUsers]
    );

    const loadFriendOverview = useCallback(async (showLoader = false) => {
        if (showLoader) setFriendsLoading(true);
        const result = await getFriendOverview();
        if (result.success && result.data) {
            setFriendOverview(result.data);
            setFriendError(null);
        } else {
            setFriendError(result.error || 'Не удалось загрузить друзей');
        }
        if (showLoader) setFriendsLoading(false);
    }, []);

    const loadMessagingPrivacy = useCallback(async (showLoader = false) => {
        if (showLoader) setPreferencesLoading(true);
        const result = await getMessagingPreferences();
        if (result.success && result.data) {
            setMessagingPreferences(result.data);
            setFriendError(null);
        } else {
            setFriendError(result.error || 'Не удалось загрузить настройки лички');
        }
        if (showLoader) setPreferencesLoading(false);
    }, []);

    const refreshSearchResults = useCallback(async () => {
        const trimmed = searchValue.trim();
        if (!trimmed) {
            setSearchResults([]);
            setSearchError(null);
            return;
        }
        setSearchBusy(true);
        const result = await searchChatUsers(trimmed);
        if (result.success && result.data) {
            setSearchResults(result.data.users || []);
            setSearchError(null);
        } else {
            setSearchResults([]);
            setSearchError(result.error || 'Не удалось выполнить поиск');
        }
        setSearchBusy(false);
    }, [searchValue]);

    const respondToRequest = useCallback(async (
        requestId: string,
        decision: 'accept' | 'reject',
        afterAccept?: () => void | Promise<void>,
    ) => {
        setChatBusyKey(`request:${requestId}:${decision}`);
        const result = await apiRespondToFriendRequest(requestId, decision);
        if (result.success) {
            await Promise.all([loadFriendOverview(false), refreshSearchResults()]);
            if (decision === 'accept' && afterAccept) await afterAccept();
            setFriendError(null);
        } else {
            setFriendError(result.error || 'Не удалось обработать заявку');
        }
        setChatBusyKey(null);
    }, [loadFriendOverview, refreshSearchResults]);

    const sendRequest = useCallback(async (targetUserId: string) => {
        setChatBusyKey(`send:${targetUserId}`);
        const result = await apiSendFriendRequest(targetUserId);
        if (result.success) {
            await Promise.all([loadFriendOverview(false), refreshSearchResults()]);
            setFriendError(null);
        } else {
            setFriendError(result.error || 'Не удалось отправить заявку');
        }
        setChatBusyKey(null);
        return result.success;
    }, [loadFriendOverview, refreshSearchResults]);

    const blockUser = useCallback(async (
        targetUserId: string,
        onPeerRoomCleared?: () => void,
    ) => {
        setChatBusyKey(`block:${targetUserId}`);
        const result = await apiBlockChatUser(targetUserId);
        if (result.success) {
            if (onPeerRoomCleared) onPeerRoomCleared();
            await Promise.all([loadMessagingPrivacy(false), loadFriendOverview(false), refreshSearchResults()]);
            setFriendError(null);
        } else {
            setFriendError(result.error || 'Не удалось заблокировать пользователя');
        }
        setChatBusyKey(null);
    }, [loadFriendOverview, loadMessagingPrivacy, refreshSearchResults]);

    const unblockUser = useCallback(async (targetUserId: string) => {
        setChatBusyKey(`unblock:${targetUserId}`);
        const result = await apiUnblockChatUser(targetUserId);
        if (result.success) {
            await Promise.all([loadMessagingPrivacy(false), refreshSearchResults()]);
            setFriendError(null);
        } else {
            setFriendError(result.error || 'Не удалось разблокировать пользователя');
        }
        setChatBusyKey(null);
    }, [loadMessagingPrivacy, refreshSearchResults]);

    return {
        friendOverview,
        messagingPreferences,
        friendsLoading,
        preferencesLoading,
        friendError,
        searchValue,
        setSearchValue,
        searchResults,
        searchBusy,
        searchError,
        chatBusyKey,
        totalPendingRequests,
        blockedUserIds,
        loadFriendOverview,
        loadMessagingPrivacy,
        refreshSearchResults,
        respondToRequest,
        sendRequest,
        blockUser,
        unblockUser,
        setFriendError,
    };
}

export type UseFriendsReturn = ReturnType<typeof useFriends>;
