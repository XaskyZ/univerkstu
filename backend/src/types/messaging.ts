export type ChatRoomKind = 'direct';
export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';
export type DirectMessagePrivacy = 'friends_only' | 'open';

export interface FriendRequestView {
    id: string;
    requesterUserId: string;
    requesterLabel: string;
    targetUserId: string;
    targetLabel: string;
    status: FriendRequestStatus;
    createdAt: Date;
    updatedAt: Date;
    direction: 'incoming' | 'outgoing';
}

export interface FriendView {
    userId: string;
    label: string;
    roomId: string;
    createdAt: Date;
    lastMessageAt: Date | null;
    unreadCount: number;
}

export interface ChatUserSearchView {
    userId: string;
    label: string;
    status: 'friend' | 'incoming' | 'outgoing' | 'none';
    roomId: string | null;
    canDirectMessage: boolean;
    directState: 'friend' | 'open' | 'blocked' | 'restricted';
}

export interface FriendRecommendationView {
    userId: string;
    label: string;
    groupKey: string | null;
    reason: 'same_group';
}

export interface ChatReplyPreview {
    id: string;
    authorUserId: string;
    authorLabel: string;
    body: string;
}

export interface ChatMessageView {
    id: string;
    roomId: string;
    roomKind: ChatRoomKind;
    authorUserId: string;
    authorLabel: string;
    body: string;
    createdAt: Date;
    editedAt: Date | null;
    isOwn: boolean;
    replyTo: ChatReplyPreview | null;
}

export interface ChatRoomListItem {
    roomId: string;
    kind: ChatRoomKind;
    title: string;
    subtitle: string | null;
    peerUserId: string | null;
    groupKey: string | null;
    unreadCount: number;
    lastMessagePreview: string | null;
    lastMessageAt: Date | null;
}

export interface ChatRoomDetail {
    room: ChatRoomListItem;
    messages: ChatMessageView[];
    canWrite: boolean;
    maxMessageLength: number;
}

export interface FriendOverview {
    friends: FriendView[];
    incoming: FriendRequestView[];
    outgoing: FriendRequestView[];
    recommended: FriendRecommendationView[];
}

export interface BlockedChatUserView {
    userId: string;
    label: string;
    reason: string | null;
    createdAt: Date;
}

export interface MessagingPreferencesView {
    dmPrivacy: DirectMessagePrivacy;
    blockedUsers: BlockedChatUserView[];
}
