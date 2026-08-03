import type {
    FriendOverview,
    GlobalChatViewerState,
    MessagingPreferencesView,
} from '@/lib/api';

export const POLL_INTERVAL_MS = 15000;
export const DEFAULT_MAX_MESSAGE_LENGTH = 2000;

export const DEFAULT_VIEWER_STATE: GlobalChatViewerState = {
    canModerate: false,
    isMuted: false,
    mute: null,
};

export const EMPTY_FRIEND_OVERVIEW: FriendOverview = {
    friends: [],
    incoming: [],
    outgoing: [],
    recommended: [],
};

export const DEFAULT_MESSAGING_PREFERENCES: MessagingPreferencesView = {
    dmPrivacy: 'open',
    blockedUsers: [],
};

export type ChatTab = 'dialogs' | 'global';
