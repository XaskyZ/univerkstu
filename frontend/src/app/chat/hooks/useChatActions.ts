'use client';

import { useCallback } from 'react';
import type { ChatTab } from '../types';
import type { UseDialogsReturn } from './useDialogs';
import type { UseFriendsReturn } from './useFriends';
import type { UseGlobalChatReturn } from './useGlobalChat';

interface ChatActionsDeps {
    setActiveTab: (tab: ChatTab) => void;
    dialogs: UseDialogsReturn;
    friends: UseFriendsReturn;
    globalChat: UseGlobalChatReturn;
    muteSummary: string | null;
}

/**
 * Cross-hook handlers — coordinate side effects across dialogs / friends / global chat.
 * Keeps page.tsx a thin renderer.
 */
export function useChatActions({
    setActiveTab,
    dialogs,
    friends,
    globalChat,
    muteSummary,
}: ChatActionsDeps) {
    const { loadRooms } = dialogs;
    const { loadFriendOverview } = friends;

    const handleSubmitGlobal = useCallback(() => globalChat.submit(muteSummary), [globalChat, muteSummary]);

    const handleSubmitRoomMessage = useCallback(() => dialogs.submitMessage(async () => {
        await loadFriendOverview(false);
    }), [dialogs, loadFriendOverview]);

    const handleOpenRoom = useCallback((roomId: string) => {
        dialogs.openRoom(roomId);
        setActiveTab('dialogs');
    }, [dialogs, setActiveTab]);

    const handleOpenDirectRoom = useCallback((targetUserId: string, roomId?: string | null) => {
        dialogs.openDirectRoom(targetUserId, roomId);
        setActiveTab('dialogs');
    }, [dialogs, setActiveTab]);

    const handleRespondFriendRequest = useCallback((requestId: string, decision: 'accept' | 'reject') => {
        return friends.respondToRequest(requestId, decision, async () => {
            await loadRooms(false);
            setActiveTab('dialogs');
        });
    }, [friends, loadRooms, setActiveTab]);

    const handleBlockUser = useCallback(async (targetUserId: string) => {
        await friends.blockUser(targetUserId, () => {
            if (dialogs.activeRoom?.peerUserId === targetUserId) {
                dialogs.clearSelectedRoom();
            }
        });
        await loadRooms(false);
    }, [dialogs, friends, loadRooms]);

    const handleUnblockUser = useCallback(async (targetUserId: string) => {
        await friends.unblockUser(targetUserId);
        await loadRooms(false);
    }, [friends, loadRooms]);

    const handleMuteUser = useCallback(async (targetUserId: string, durationMinutes: number, reason?: string) => {
        await globalChat.muteUser(targetUserId, durationMinutes, reason);
    }, [globalChat]);

    const handleUnmuteUser = useCallback(async (targetUserId: string) => {
        await globalChat.unmuteUser(targetUserId);
    }, [globalChat]);

    return {
        handleSubmitGlobal,
        handleSubmitRoomMessage,
        handleOpenRoom,
        handleOpenDirectRoom,
        handleRespondFriendRequest,
        handleBlockUser,
        handleUnblockUser,
        handleMuteUser,
        handleUnmuteUser,
    };
}
