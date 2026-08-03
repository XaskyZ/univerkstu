'use client';

import { useEffect } from 'react';
import { POLL_INTERVAL_MS, type ChatTab } from '../types';
import type { UseDialogsReturn } from './useDialogs';
import type { UseFriendsReturn } from './useFriends';
import type { UseGlobalChatReturn } from './useGlobalChat';

interface ChatPollingDeps {
    isAuth: boolean;
    activeTab: ChatTab;
    dialogs: UseDialogsReturn;
    friends: UseFriendsReturn;
    globalChat: UseGlobalChatReturn;
}

/**
 * Owns initial chat-data load + background polling.
 *
 *  - Always poll: dialog rooms + friends overview (for tab badges).
 *  - Active tab gets the heavy data:
 *      dialogs → selected room detail
 *      global  → global chat messages
 */
export function useChatPolling({
    isAuth,
    activeTab,
    dialogs,
    friends,
    globalChat,
}: ChatPollingDeps) {
    const { selectedRoomId, loadRooms, loadRoomDetail, setRoomDetail } = dialogs;
    const { loadFriendOverview, loadMessagingPrivacy } = friends;
    const { load: loadGlobalChat } = globalChat;

    // Initial load on mount
    useEffect(() => {
        if (!isAuth) return;
        const timer = window.setTimeout(() => {
            void Promise.all([
                loadRooms(true),
                loadFriendOverview(true),
                loadMessagingPrivacy(true),
                loadGlobalChat(true),
            ]);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isAuth, loadFriendOverview, loadGlobalChat, loadMessagingPrivacy, loadRooms]);

    // Background polling
    useEffect(() => {
        if (!isAuth) return;
        const intervalId = window.setInterval(() => {
            void loadRooms(false);
            void loadFriendOverview(false);

            if (activeTab === 'dialogs' && selectedRoomId) {
                void loadRoomDetail(selectedRoomId, false);
            }
            if (activeTab === 'global') {
                void loadGlobalChat(false);
            }
        }, POLL_INTERVAL_MS);

        return () => window.clearInterval(intervalId);
    }, [activeTab, isAuth, loadFriendOverview, loadGlobalChat, loadRoomDetail, loadRooms, selectedRoomId]);

    // Load room detail on selection change
    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (selectedRoomId && isAuth) {
                void loadRoomDetail(selectedRoomId, true);
            } else {
                setRoomDetail(null);
            }
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isAuth, loadRoomDetail, selectedRoomId, setRoomDetail]);
}
