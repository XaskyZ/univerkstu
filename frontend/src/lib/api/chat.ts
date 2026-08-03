/**
 * Chat / messaging API: global chat (with moderation), direct message rooms,
 * friends, search, blocks, messaging preferences.
 */
import { fetchWithAuth, type ApiResponse } from './core';
import type {
    BlockedChatUserView,
    ChatMessageView,
    ChatRoomDetail,
    ChatRoomListItem,
    ChatUserSearchView,
    FriendOverview,
    FriendRequestView,
    GlobalChatMessageView,
    GlobalChatMuteView,
    GlobalChatReportStatus,
    GlobalChatReportView,
    GlobalChatViewerState,
    MessagingPreferencesView,
} from '../api';

export async function getGlobalChatMessages(
    limit?: number,
): Promise<ApiResponse<{ messages: GlobalChatMessageView[]; maxMessageLength: number; viewer: GlobalChatViewerState }>> {
    const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : '';
    return fetchWithAuth(`/api/v3/chat/global${query}`);
}

export async function createGlobalChatMessage(
    body: string,
): Promise<ApiResponse<GlobalChatMessageView>> {
    return fetchWithAuth('/api/v3/chat/global/messages', {
        method: 'POST',
        body: JSON.stringify({ body }),
    });
}

export async function reportGlobalChatMessage(
    messageId: string,
    payload: { reason: string; details?: string | null },
): Promise<ApiResponse<GlobalChatReportView>> {
    return fetchWithAuth(`/api/v3/chat/global/messages/${encodeURIComponent(messageId)}/report`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function getGlobalChatReports(
    status: GlobalChatReportStatus | 'all' = 'open',
    limit?: number,
): Promise<ApiResponse<{ reports: GlobalChatReportView[] }>> {
    const search = new URLSearchParams({ status });
    if (typeof limit === 'number' && Number.isFinite(limit)) {
        search.set('limit', String(limit));
    }
    return fetchWithAuth(`/api/v3/chat/global/moderation/reports?${search.toString()}`);
}

export async function deleteGlobalChatMessage(
    messageId: string,
    reason?: string | null,
): Promise<ApiResponse<{ messageId: string; resolvedReports: number }>> {
    return fetchWithAuth(`/api/v3/chat/global/messages/${encodeURIComponent(messageId)}/delete`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
    });
}

export async function setGlobalChatMessagePinned(
    messageId: string,
    pinned: boolean,
): Promise<ApiResponse<GlobalChatMessageView | null>> {
    return fetchWithAuth(`/api/v3/chat/global/messages/${encodeURIComponent(messageId)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned }),
    });
}

export async function muteGlobalChatUser(
    userId: string,
    payload: { reason?: string | null; durationMinutes?: number | null },
): Promise<ApiResponse<GlobalChatMuteView>> {
    return fetchWithAuth(`/api/v3/chat/global/users/${encodeURIComponent(userId)}/mute`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function unmuteGlobalChatUser(userId: string): Promise<ApiResponse<GlobalChatMuteView | null>> {
    return fetchWithAuth(`/api/v3/chat/global/users/${encodeURIComponent(userId)}/unmute`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export async function reviewGlobalChatReport(
    reportId: string,
    payload: { status: Exclude<GlobalChatReportStatus, 'open'>; resolutionNote?: string | null },
): Promise<ApiResponse<GlobalChatReportView | null>> {
    return fetchWithAuth(`/api/v3/chat/global/moderation/reports/${encodeURIComponent(reportId)}/review`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function searchChatUsers(
    query: string,
): Promise<ApiResponse<{ users: ChatUserSearchView[] }>> {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    return fetchWithAuth(`/api/v3/chat/users/search${suffix}`);
}

export async function getFriendOverview(): Promise<ApiResponse<FriendOverview>> {
    return fetchWithAuth('/api/v3/chat/friends');
}

export async function getMessagingPreferences(): Promise<ApiResponse<MessagingPreferencesView>> {
    return fetchWithAuth('/api/v3/chat/preferences');
}

export async function updateMessagingPreferences(
    dmPrivacy: 'friends_only' | 'open',
): Promise<ApiResponse<MessagingPreferencesView>> {
    return fetchWithAuth('/api/v3/chat/preferences', {
        method: 'POST',
        body: JSON.stringify({ dmPrivacy }),
    });
}

export async function sendFriendRequest(
    targetUserId: string,
): Promise<ApiResponse<FriendRequestView>> {
    return fetchWithAuth('/api/v3/chat/friends/requests', {
        method: 'POST',
        body: JSON.stringify({ targetUserId }),
    });
}

export async function respondToFriendRequest(
    requestId: string,
    decision: 'accept' | 'reject',
): Promise<ApiResponse<FriendRequestView>> {
    return fetchWithAuth(`/api/v3/chat/friends/requests/${encodeURIComponent(requestId)}/respond`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
    });
}

export async function cancelFriendRequest(
    requestId: string,
): Promise<ApiResponse<FriendRequestView>> {
    return fetchWithAuth(`/api/v3/chat/friends/requests/${encodeURIComponent(requestId)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export async function removeFriend(
    targetUserId: string,
): Promise<ApiResponse<{ removed: boolean; targetUserId: string }>> {
    return fetchWithAuth(`/api/v3/chat/friends/${encodeURIComponent(targetUserId)}/remove`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export async function blockChatUser(
    targetUserId: string,
    reason?: string | null,
): Promise<ApiResponse<BlockedChatUserView>> {
    return fetchWithAuth(`/api/v3/chat/blocks/${encodeURIComponent(targetUserId)}`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason || null }),
    });
}

export async function unblockChatUser(
    targetUserId: string,
): Promise<ApiResponse<{ unblocked: boolean; targetUserId: string }>> {
    return fetchWithAuth(`/api/v3/chat/blocks/${encodeURIComponent(targetUserId)}/unblock`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export async function getDialogRooms(): Promise<ApiResponse<{ rooms: ChatRoomListItem[]; maxMessageLength: number }>> {
    return fetchWithAuth('/api/v3/chat/rooms');
}

export async function getChatRoomDetail(
    roomId: string,
    limit?: number,
): Promise<ApiResponse<ChatRoomDetail>> {
    const query = typeof limit === 'number' && Number.isFinite(limit)
        ? `?limit=${encodeURIComponent(String(limit))}`
        : '';
    return fetchWithAuth(`/api/v3/chat/rooms/${encodeURIComponent(roomId)}${query}`);
}

export async function markChatRoomRead(roomId: string): Promise<ApiResponse<{ roomId: string }>> {
    return fetchWithAuth(`/api/v3/chat/rooms/${encodeURIComponent(roomId)}/read`, {
        method: 'POST',
        body: JSON.stringify({}),
    });
}

export async function createChatRoomMessage(
    roomId: string,
    payload: { body: string; replyToMessageId?: string | null },
): Promise<ApiResponse<ChatMessageView>> {
    return fetchWithAuth(`/api/v3/chat/rooms/${encodeURIComponent(roomId)}/messages`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function editChatRoomMessage(
    messageId: string,
    body: string,
): Promise<ApiResponse<ChatMessageView>> {
    return fetchWithAuth(`/api/v3/chat/messages/${encodeURIComponent(messageId)}/edit`, {
        method: 'POST',
        body: JSON.stringify({ body }),
    });
}
