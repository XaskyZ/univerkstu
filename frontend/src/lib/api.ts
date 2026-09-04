/**
 * API клиент для UniverSchedule v4.0
 *
 * Core HTTP helpers (fetchWithAuth, token storage, ApiResponse type) live in
 * `./api/core`. This file holds the public domain endpoints.
 */
import type { Exams, Schedule, UMKD } from './types';
import { trackAnalyticsEvent } from './analytics';
import {
    API_URL,
    apiText,
    fetchWithAuth,
    type ApiResponse,
    type AppLanguage,
} from './api/core';

export { getUserId, isAuthenticated, setToken, removeToken } from './api/core';
export type { AppLanguage } from './api/core';

export {
    login,
    register,
    curatorLogin,
    logout,
    verifyToken,
    createLoginChallenge,
    createPushLoginChallenge,
    pollLoginChallenge,
    inspectLoginChallenge,
    approveLoginChallenge,
    denyLoginChallenge,
    AUTH_ERROR_CODES,
} from './api/auth';
export type {
    LoginResponse,
    LoginChallenge,
    LoginChallengeKind,
    LoginChallengeInfo,
    LoginChallengePollResult,
    PushLoginChallenge,
} from './api/auth';

export {
    checkAdminSession,
    getAdminGroupSpaces,
    createAdminGroupSpace,
    updateAdminGroupSpace,
    getAdminGroupRoles,
    assignAdminGroupRole,
    revokeAdminGroupRole,
    searchAdminGroupUsers,
    getAdminGroupUserPhone,
    getAdminCoordinatorAnnouncements,
    createAdminCoordinatorAnnouncement,
    revokeAdminCoordinatorAnnouncement,
    getAdminSupportRequests,
    reviewAdminSupportRequest,
    updateAdminSupportOverride,
} from './api/admin';

export {
    getGroupSpaceMe,
    getGroupCatalog,
    getGroupMembers,
    getCuratorStudents,
    getCuratorStudentDetail,
    removeGroupMember,
    getGroupFeed,
    getDeletedGroupFeed,
    getGroupTasks,
    getDeletedGroupTasks,
    getGroupExtraLessons,
    getDeletedGroupExtraLessons,
    getGroupContentRevisions,
    restoreGroupContentRevision,
    createGroupFeedPost,
    createGroupTask,
    updateGroupFeedPost,
    updateGroupTask,
    createGroupExtraLesson,
    updateGroupExtraLesson,
    deleteGroupFeedPost,
    restoreDeletedGroupFeedPost,
    permanentlyDeleteGroupFeedPost,
    toggleGroupTaskCompletion,
    deleteGroupTask,
    restoreDeletedGroupTask,
    deleteGroupExtraLesson,
    restoreDeletedGroupExtraLesson,
    getMyGroupMembershipDisputes,
    getGroupMembershipDisputes,
    createGroupMembershipDispute,
    reviewGroupMembershipDispute,
    getMyGroupJoinRequests,
    getGroupJoinRequests,
    createGroupJoinRequest,
    reviewGroupJoinRequest,
    getGroupRoles,
    assignGroupRole,
    revokeGroupRole,
    getCoordinatorAnnouncementsForGroup,
    markCoordinatorAnnouncementViewed,
    getGroupLinks,
    addGroupLink,
    deleteGroupLink,
    getGroupFiles,
    addGroupFile,
    deleteGroupFile,
    getGroupPostReactions,
    toggleGroupPostReaction,
    ALLOWED_REACTION_EMOJI,
} from './api/group';
export type {
    GroupLinkView,
    GroupFileEntryView,
    AllowedReactionEmoji,
    ReactionAggregate,
    GroupPostReactionsPayload,
    GroupPostReactionsToggleResult,
} from './api/group';

export {
    getGlobalChatMessages,
    createGlobalChatMessage,
    reportGlobalChatMessage,
    getGlobalChatReports,
    deleteGlobalChatMessage,
    setGlobalChatMessagePinned,
    muteGlobalChatUser,
    unmuteGlobalChatUser,
    reviewGlobalChatReport,
    searchChatUsers,
    getFriendOverview,
    getMessagingPreferences,
    updateMessagingPreferences,
    sendFriendRequest,
    respondToFriendRequest,
    cancelFriendRequest,
    removeFriend,
    blockChatUser,
    unblockChatUser,
    getDialogRooms,
    getChatRoomDetail,
    markChatRoomRead,
    createChatRoomMessage,
    editChatRoomMessage,
} from './api/chat';

export {
    listSocialEntitiesByScope,
    getSocialEntity,
    createSocialEntity,
    updateSocialEntity,
    deleteSocialEntity,
    restoreSocialEntity,
    pinSocialEntity,
    addSocialComment,
    getSocialComments,
    toggleSocialReaction,
    attachSocialFile,
    getSocialAttachments,
    removeSocialAttachment,
    searchSocialUsers,
    ALLOWED_SOCIAL_REACTION_EMOJI,
    SOCIAL_COMMENT_MAX_LENGTH,
} from './api/social';
export type {
    SocialEntityKind,
    SocialScopeType,
    SocialEntity,
    SocialEntityView,
    SocialCommentView,
    SocialReactionAggregate,
    SocialReactionToggleResult,
    SocialAttachment,
    SocialUserHint,
    ListSocialEntitiesOptions,
    AllowedSocialReactionEmoji,
} from './api/social';

export type AppBootstrapFreshness = 'warm' | 'cached' | 'stale' | 'missing';

export interface AppBootstrapProfileSummary {
    fullName: string | null;
    faculty: string | null;
    specialty: string | null;
    groupName: string | null;
    course: number | null;
    educationLevel: string | null;
    formOfEducation: string | null;
    department: string | null;
    transferGpa: number | null;
}

export interface AppBootstrapPlatonusSummary {
    connected: boolean;
    login?: string;
    gpa: number | null;
    groupName: string | null;
    latestSemester: {
        year: number;
        semester: number;
    } | null;
    preferredSemester?: {
        year: number;
        semester: number;
    } | null;
    availableSemesters?: Array<{
        year: number;
        semester: number;
    }>;
}

export interface AppBootstrapData {
    version: number;
    user: {
        userId: string;
    };
    schedule?: Schedule;
    exams?: Exams;
    profileSummary?: AppBootstrapProfileSummary;
    platonusSummary?: AppBootstrapPlatonusSummary;
    freshness: {
        schedule: AppBootstrapFreshness;
        exams: AppBootstrapFreshness;
        profileSummary: AppBootstrapFreshness;
        platonusSummary: AppBootstrapFreshness;
    };
    issuedAt: string;
}

export type SupportTierId = 'friend' | 'boost' | 'hero';
export type SupportRequestStatus = 'created' | 'submitted' | 'verified' | 'rejected' | 'expired' | 'cancelled';

export interface SupportRequestView {
    id: string;
    userId: string;
    code: string;
    tierId: SupportTierId;
    amountKzt: number;
    status: SupportRequestStatus;
    createdAt: string;
    updatedAt: string;
    expiresAt: string | null;
    submittedAt: string | null;
    transferAt: string | null;
    senderLast4: string | null;
    senderBank: string | null;
    receiptNote: string | null;
    reviewNote: string | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
    verifiedAt: string | null;
}

export interface SupporterSummary {
    enabled: boolean;
    highestTierId: SupportTierId | null;
    totalDonatedKzt: number;
    verifiedDonations: number;
    lastVerifiedAt: string | null;
}

export interface SupportOverview {
    receiverCardNumber: string;
    receiverCardLast4: string;
    requests: SupportRequestView[];
    openRequest: SupportRequestView | null;
    supporter: SupporterSummary;
}

export interface AdminSupportSummary {
    totalVerifiedKzt: number;
    verifiedCount: number;
    pendingCount: number;
    activeRequestCount: number;
    activeSupportersCount: number;
}

export type AdminSupportOverrideMode = 'grant' | 'revoke';

export interface AdminSupporterEntry {
    userId: string;
    fullName: string | null;
    supporter: SupporterSummary;
    baseSupporter: SupporterSummary;
    overrideMode: AdminSupportOverrideMode | null;
    overrideTierId: SupportTierId | null;
    overrideNote: string | null;
    overrideUpdatedAt: string | null;
    overrideUpdatedBy: string | null;
}

export interface AdminSupportData {
    summary: AdminSupportSummary;
    requests: SupportRequestView[];
    supporters: AdminSupporterEntry[];
}

export interface AcademicContextPeriod {
    label: string;
    kind: string;
    weeks: number | null;
    start: string;
    end: string;
    segmentLabel: string;
}

export interface AcademicContextSemester {
    semesterNumber: number | null;
    title: string;
    start: string | null;
    end: string | null;
    totalWeeks: number | null;
    periods: AcademicContextPeriod[];
}

export interface AcademicContext {
    source: 'platonus_calendar';
    userId: string;
    formOfEducation: string | null;
    educationLevel: string | null;
    specialty: string | null;
    totalSemesters: number | null;
    admissionYear: number | null;
    currentSemesterNumber: number | null;
    currentSemesterLabel: string | null;
    semesterStart: string | null;
    semesterEnd: string | null;
    semesterWeek: number | null;
    weekLabel: string | null;
    weekParity: 'num' | 'den' | null;
    activePeriodLabel: string | null;
    activePeriodKind: string | null;
    periods: AcademicContextPeriod[];
    semesters: AcademicContextSemester[];
    cachedAt: string;
    expiresAt: string;
}

export interface GlobalChatMessageView {
    id: string;
    authorUserId: string;
    authorLabel: string;
    body: string;
    createdAt: string;
    isPinned: boolean;
    pinnedAt: string | null;
    isOwn: boolean;
    canDelete: boolean;
    isReportedByViewer: boolean;
    reportCount: number;
}

export interface GlobalChatMuteView {
    id: string;
    userId: string;
    mutedBy: string;
    reason: string | null;
    createdAt: string;
    expiresAt: string | null;
    revokedAt: string | null;
    revokedBy: string | null;
    isActive: boolean;
}

export interface GlobalChatViewerState {
    canModerate: boolean;
    isMuted: boolean;
    mute: GlobalChatMuteView | null;
}

export type GlobalChatReportStatus = 'open' | 'dismissed' | 'actioned';

export interface GlobalChatReportView {
    id: string;
    messageId: string;
    messageBody: string;
    messageCreatedAt: string;
    messageAuthorUserId: string;
    messageAuthorLabel: string;
    reporterUserId: string;
    reporterLabel: string;
    reason: string;
    details: string | null;
    status: GlobalChatReportStatus;
    createdAt: string;
    reviewedAt: string | null;
    reviewedBy: string | null;
    resolutionNote: string | null;
    messageDeletedAt: string | null;
}

export type ChatRoomKind = 'direct';
export type FriendRequestStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface FriendRequestView {
    id: string;
    requesterUserId: string;
    requesterLabel: string;
    targetUserId: string;
    targetLabel: string;
    status: FriendRequestStatus;
    createdAt: string;
    updatedAt: string;
    direction: 'incoming' | 'outgoing';
}

export interface FriendView {
    userId: string;
    label: string;
    roomId: string;
    createdAt: string;
    lastMessageAt: string | null;
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
    createdAt: string;
    editedAt: string | null;
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
    lastMessageAt: string | null;
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
    createdAt: string;
}

export interface MessagingPreferencesView {
    dmPrivacy: 'friends_only' | 'open';
    blockedUsers: BlockedChatUserView[];
}


// === Schedule API ===

export async function getSchedule(refresh = false): Promise<ApiResponse<Schedule>> {
    const query = refresh ? '?refresh=true' : '';
    return fetchWithAuth(`/api/v3/schedule${query}`);
}

export async function refreshSchedule(): Promise<ApiResponse<Schedule>> {
    const result = await fetchWithAuth<Schedule>('/api/v3/schedule/refresh', { method: 'POST', body: JSON.stringify({}) });
    trackAnalyticsEvent('cta_click', {
        feature: 'schedule',
        label: 'refresh',
        status: result.success ? 'success' : 'failed',
        details: result.error,
        path: '/schedule',
    });
    return result;
}

export async function getAppBootstrap(): Promise<ApiResponse<AppBootstrapData>> {
    return fetchWithAuth<AppBootstrapData>('/api/v3/app/bootstrap');
}

export async function getAcademicContext(refresh = false): Promise<ApiResponse<AcademicContext>> {
    const query = refresh ? '?refresh=true' : '';
    return fetchWithAuth<AcademicContext>(`/api/v3/academic/context${query}`);
}

// === Exams API ===

export async function getExams(refresh = false): Promise<ApiResponse<Exams>> {
    const query = refresh ? '?refresh=true' : '';
    return fetchWithAuth(`/api/v3/exams${query}`);
}

export async function refreshExams(): Promise<ApiResponse<Exams>> {
    const result = await fetchWithAuth<Exams>('/api/v3/exams/refresh', { method: 'POST', body: JSON.stringify({}) });
    trackAnalyticsEvent('cta_click', {
        feature: 'exams',
        label: 'refresh',
        status: result.success ? 'success' : 'failed',
        details: result.error,
        path: '/exams',
    });
    return result;
}

// === Status API ===

export interface StatusPayload {
    user: {
        userId: string;
        lastLogin: string;
        settings?: {
            language: AppLanguage;
            notifications: boolean;
            theme: 'light' | 'dark' | 'system';
            leaderboardDisplayName?: string;
            leaderboardContacts?: {
                telegram?: string;
                instagram?: string;
            };
            dmPrivacy?: 'friends_only' | 'open';
            gradesLeaderboardOptOut?: boolean;
        };
    };
    schedule?: unknown;
    exams?: unknown;
}

export interface ActiveLeaderboardEntry {
    rank: number;
    displayName: string;
    totalSeconds: number;
    isCurrentUser: boolean;
}

export interface ActiveLeaderboardData {
    period: 'day' | 'week' | 'all';
    leaderboard: ActiveLeaderboardEntry[];
    currentUser: ActiveLeaderboardEntry | null;
    totalRankedUsers: number;
    updatedAt: string;
}

export type ReferralRewardType = 'invite_success' | 'welcome_bonus';

export interface ReferralInviterView {
    userId: string;
    displayName: string;
    code: string;
    referredAt: string;
    source: 'link' | 'manual';
}

export interface ReferralRewardEventView {
    id: string;
    type: ReferralRewardType;
    points: number;
    createdAt: string;
    counterpartUserId: string | null;
    counterpartDisplayName: string | null;
}

export interface ReferralRecentUserView {
    userId: string;
    displayName: string;
    referredAt: string;
}

export interface ReferralLeaderboardEntry {
    rank: number;
    userId: string;
    displayName: string;
    referralCount: number;
    totalPoints: number;
    isCurrentUser: boolean;
}

export interface ReferralOverview {
    code: string;
    inviteRewardPoints: number;
    welcomeRewardPoints: number;
    totalPoints: number;
    referralCount: number;
    myRank: number | null;
    totalRankedUsers: number;
    claimWindowEndsAt: string;
    canClaimManualCode: boolean;
    referredBy: ReferralInviterView | null;
    rewards: ReferralRewardEventView[];
    recentReferrals: ReferralRecentUserView[];
    leaderboard: ReferralLeaderboardEntry[];
    updatedAt: string;
}

export type AdminSessionRole = 'admin' | 'super_admin';

export async function getStatus(): Promise<ApiResponse<StatusPayload>> {
    return fetchWithAuth('/api/v3/status');
}

export async function updateLanguageSetting(language: AppLanguage): Promise<ApiResponse<{ language: AppLanguage }>> {
    return fetchWithAuth<{ language: AppLanguage }>('/api/v3/status/settings', {
        method: 'PATCH',
        body: JSON.stringify({ language }),
    });
}

export async function updateLeaderboardDisplayName(leaderboardDisplayName: string): Promise<ApiResponse<{ leaderboardDisplayName: string | null }>> {
    return fetchWithAuth<{ leaderboardDisplayName: string | null }>('/api/v3/status/settings', {
        method: 'PATCH',
        body: JSON.stringify({ leaderboardDisplayName }),
    });
}

export async function updateGradesLeaderboardOptOut(gradesLeaderboardOptOut: boolean): Promise<ApiResponse<{ gradesLeaderboardOptOut?: boolean }>> {
    return fetchWithAuth<{ gradesLeaderboardOptOut?: boolean }>('/api/v3/status/settings', {
        method: 'PATCH',
        body: JSON.stringify({ gradesLeaderboardOptOut }),
    });
}

export async function updateLeaderboardContacts(leaderboardContacts: {
    telegram?: string;
    instagram?: string;
}): Promise<ApiResponse<{ leaderboardContacts: { telegram?: string; instagram?: string } | null }>> {
    return fetchWithAuth<{ leaderboardContacts: { telegram?: string; instagram?: string } | null }>('/api/v3/status/settings', {
        method: 'PATCH',
        body: JSON.stringify({ leaderboardContacts }),
    });
}

export async function updateThemeSetting(theme: string): Promise<ApiResponse<{ theme?: string }>> {
    return fetchWithAuth<{ theme?: string }>('/api/v3/status/settings', {
        method: 'PATCH',
        body: JSON.stringify({ theme }),
    });
}

export async function getActiveLeaderboard(period: ActiveLeaderboardData['period'] = 'day'): Promise<ApiResponse<ActiveLeaderboardData>> {
    const result = await fetchWithAuth<ActiveLeaderboardData>(`/api/v3/settings/active-leaderboard?period=${period}&ts=${Date.now()}`);
    if (!result.success) {
        return result;
    }

    if (result.data) {
        return result;
    }

    const direct = result as ApiResponse<ActiveLeaderboardData> & Partial<ActiveLeaderboardData>;
    if (Array.isArray(direct.leaderboard) && typeof direct.period === 'string') {
        return {
            success: true,
            data: {
                period: direct.period,
                leaderboard: direct.leaderboard,
                currentUser: direct.currentUser ?? null,
                totalRankedUsers: typeof direct.totalRankedUsers === 'number' ? direct.totalRankedUsers : direct.leaderboard.length,
                updatedAt: typeof direct.updatedAt === 'string' ? direct.updatedAt : new Date().toISOString(),
            },
            statusCode: result.statusCode,
        };
    }

    return {
        success: false,
        error: 'Failed to normalize active leaderboard response',
        statusCode: result.statusCode,
    };
}

export async function getReferralOverview(): Promise<ApiResponse<ReferralOverview>> {
    return fetchWithAuth<ReferralOverview>('/api/v3/referrals/overview');
}

export async function claimReferralCode(code: string): Promise<ApiResponse<ReferralOverview>> {
    return fetchWithAuth<ReferralOverview>('/api/v3/referrals/claim', {
        method: 'POST',
        body: JSON.stringify({ code }),
    });
}


export async function getInfo(): Promise<ApiResponse> {
    const text = apiText();
    try {
        const response = await fetch(`${API_URL}/api/v3/info`);
        return await response.json();
    } catch {
        return { success: false, error: text.networkError };
    }
}

// === UMKD API ===

export async function getUMKD(refresh = false): Promise<ApiResponse<UMKD>> {
    const query = refresh ? '?refresh=true' : '';
    return fetchWithAuth(`/api/v3/umkd${query}`);
}

export async function refreshUMKD(): Promise<ApiResponse<UMKD>> {
    const result = await fetchWithAuth<UMKD>('/api/v3/umkd/refresh', { method: 'POST', body: JSON.stringify({}) });
    trackAnalyticsEvent('cta_click', {
        feature: 'umkd',
        label: 'refresh',
        status: result.success ? 'success' : 'failed',
        details: result.error,
        path: '/umkd',
    });
    return result;
}

// === Profile API ===

export async function getProfile<T = unknown>(refresh = false): Promise<ApiResponse<T>> {
    const query = refresh ? '?refresh=true' : '';
    return fetchWithAuth(`/api/v3/profile${query}`);
}

// === Teacher Profile API ===

export interface TeacherProfile {
    name: string;
    photoUrl: string | null;
    position: string | null;
    degree: string | null;
    department: string | null;
    /**
     * Faculty enriched from the backend staff DB (`kstu_staff_data.json`).
     * Optional / nullable — older cached profiles and unknown URLs return null.
     */
    faculty?: string | null;
    bio: string | null;
    contacts: {
        phone: string | null;
        email: string | null;
    };
    sourceUrl: string;
}

export async function getTeacherProfile(url: string): Promise<ApiResponse<TeacherProfile>> {
    return fetchWithAuth(`/api/v3/teacher/profile?url=${encodeURIComponent(url)}`);
}

export type TeacherTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F';
export type TeacherLeaderboardPeriod = 'day' | 'week' | 'all';

export interface TeacherUserRating {
    teacherId: string;
    tier: TeacherTier;
    tags: string[];
    updatedAt: string;
}

export interface TeacherDirectoryEntry {
    teacherId: string;
    name: string;
    sourceUrl: string | null;
    isVerified: boolean;
    createdBySource?: string;
    createdAt: string;
    updatedAt: string;
    myRating?: TeacherUserRating | null;
}

export interface TeacherLeaderboardEntry {
    rank: number;
    teacherId: string;
    name: string;
    isVerified: boolean;
    averageTier: TeacherTier;
    averageValue: number;
    voteCount: number;
    topTags: string[];
    myRating: TeacherUserRating | null;
}

export interface TeacherLeaderboardData {
    period: TeacherLeaderboardPeriod;
    leaderboard: TeacherLeaderboardEntry[];
    myRatings: TeacherUserRating[];
    totalTeachers: number;
    totalVotes: number;
    updatedAt: string;
}

export async function getTeacherLeaderboard(period: TeacherLeaderboardPeriod = 'day'): Promise<ApiResponse<TeacherLeaderboardData>> {
    return fetchWithAuth<TeacherLeaderboardData>(`/api/v3/teacher/ratings/leaderboard?period=${period}`);
}

export async function searchTeacherDirectory(query: string): Promise<ApiResponse<{ results: TeacherDirectoryEntry[] }>> {
    return fetchWithAuth<{ results: TeacherDirectoryEntry[] }>(`/api/v3/teacher/ratings/search?q=${encodeURIComponent(query)}`);
}

export interface CreateTeacherExtras {
    notInSchedule?: boolean;
    canonicalSuggestion?: string | null;
}

export async function createTeacherDirectoryEntry(
    name: string,
    options?: { force?: boolean },
): Promise<ApiResponse<{ teacher: TeacherDirectoryEntry }> & CreateTeacherExtras> {
    return fetchWithAuth<{ teacher: TeacherDirectoryEntry }>('/api/v3/teacher/ratings/teachers', {
        method: 'POST',
        body: JSON.stringify(options?.force ? { name, force: true } : { name }),
    }) as Promise<ApiResponse<{ teacher: TeacherDirectoryEntry }> & CreateTeacherExtras>;
}

export async function saveMyTeacherRating(teacherId: string, tier: TeacherTier, tags: string[]): Promise<ApiResponse<{ rating: TeacherUserRating }>> {
    return fetchWithAuth<{ rating: TeacherUserRating }>('/api/v3/teacher/ratings/mine', {
        method: 'POST',
        body: JSON.stringify({ teacherId, tier, tags }),
    });
}

// === Private Teacher Notes ===
// Strictly per-user free-form notes attached to a normalized teacher key
// (see backend/src/services/teacherNotes.ts). 2000-char plain text, no markdown,
// no shared/aggregate read path. The backend normalizes whatever key the client
// sends, so passing the raw teacher name works.

export const TEACHER_NOTE_MAX_LENGTH = 2000;

export interface TeacherNoteResponse {
    note: string | null;
    updatedAt: string | null;
}

export interface TeacherNoteEntry {
    teacherKey: string;
    note: string;
    updatedAt: string;
}

export async function getTeacherNote(teacherKey: string): Promise<ApiResponse<TeacherNoteResponse>> {
    return fetchWithAuth<TeacherNoteResponse>(
        `/api/v3/teacher/${encodeURIComponent(teacherKey)}/note`,
    );
}

export async function saveTeacherNote(teacherKey: string, note: string): Promise<ApiResponse<null>> {
    return fetchWithAuth<null>(`/api/v3/teacher/${encodeURIComponent(teacherKey)}/note`, {
        method: 'PUT',
        body: JSON.stringify({ note }),
    });
}

export async function deleteTeacherNote(teacherKey: string): Promise<ApiResponse<null>> {
    return fetchWithAuth<null>(`/api/v3/teacher/${encodeURIComponent(teacherKey)}/note`, {
        method: 'DELETE',
    });
}

export async function listMyTeacherNotes(): Promise<ApiResponse<{ notes: TeacherNoteEntry[] }>> {
    return fetchWithAuth<{ notes: TeacherNoteEntry[] }>('/api/v3/teacher/notes/mine');
}

// === Platonus API (Экспериментально) ===

export interface DetailedPlatonusGrade {
    date: string;
    mark: number;
    type?: string;
    title?: string | null;
    month?: string | null;
    teacher?: string | null;
    comment?: string | null;
}

export type PlatonusSubjectKind = 'regular' | 'coursework' | 'practice';

export interface PlatonusSubjectGrade {
    name: string;
    code?: string;
    tutors?: string[];
    /**
     * Тип предмета, проставленный бэк-парсером.
     * Опциональное поле — на случай чтения из старого кеша, не содержащего его.
     */
    kind?: PlatonusSubjectKind;
    rk1: string;
    rk2: string;
    rating?: string;
    exam: string;
    total: string;
    examDate?: string;
    subjectID?: string;
    queryID?: string;
}

export interface GradesMeta {
    parsedAt: string;
    year: number;
    semester: number;
    totalSubjects: number;
    gpa?: number;           // Текущий GPA (если доступен)
    overallGpa?: number;    // За всё время (если доступен)
    groupName?: string;     // Группа студента из transcript (если доступна)
    // Historical GPA tables from Platonus /rest/transcript/load. Keys are
    // Platonus-native labels (e.g. "2024-1", "2024-2" for terms; "1"–"4"
    // for course years). Both maps are dropped from the API response when
    // Platonus returns an empty object — UI checks truthiness to decide
    // whether to render the timeline chart.
    termGpaMap?: Record<string, number>;
    courseGpaMap?: Record<string, number>;
}
export interface PlatonusGradesData {
    meta: GradesMeta;
    subjects: PlatonusSubjectGrade[];
}

export interface PlatonusSemester {
    year: number;
    semester: number;
    label: string;
}

export interface PlatonusStatus {
    connected: boolean;
    login?: string;
    availableSemesters: PlatonusSemester[];
}

export interface GroupSpaceMe {
    available: boolean;
    group: {
        groupKey: string;
        title: string;
        slug: string;
    } | null;
    membership: {
        active: boolean;
        source: 'platonus_auto' | 'manual' | 'join_request' | null;
    };
    access: {
        roles: Array<'coordinator' | 'curator' | 'starosta' | 'helper'>;
        permissions: {
            canManageContent: boolean;
            canManageMembers: boolean;
            canManageHelpers: boolean;
            canAssignStarosta: boolean;
            canViewAudit: boolean;
        };
    };
    note?: string;
}

export interface GroupRoleAssignmentView {
    userId: string;
    roleId: 'coordinator' | 'curator' | 'starosta' | 'helper';
    scopeType: 'global' | 'group';
    scopeId: string;
    active: boolean;
    assignedBy: string;
    createdAt: string;
    updatedAt: string;
    reason?: string | null;
}

export interface GroupSpaceSummary {
    groupKey: string;
    title: string;
    slug: string;
    memberCount: number;
    starostas: string[];
    helpers: string[];
}

export interface GroupCatalogItem {
    groupKey: string;
    title: string;
    slug: string;
}

export interface GroupMemberView {
    userId: string;
    fullName?: string | null;
    source: 'platonus_auto' | 'manual' | 'join_request';
    joinedAt: string;
    roles: Array<'coordinator' | 'curator' | 'starosta' | 'helper'>;
    canBeRemovedManually: boolean;
}

export interface CuratorStudentSummary {
    userId: string;
    fullName?: string | null;
    groupKey: string;
    source: 'platonus_auto' | 'manual' | 'join_request';
    joinedAt: string;
    roles: Array<'coordinator' | 'curator' | 'starosta' | 'helper'>;
    canBeRemovedManually: boolean;
    profileSummary: {
        specialty: string | null;
        faculty: string | null;
        course: number | null;
        formOfEducation: string | null;
        detectedGroupName: string | null;
    };
    attestationSummary: {
        currentGPA: number | null;
        currentYear: string | null;
        creditsEarned: number | null;
        gradesCount: number;
    };
    analytics: {
        online: boolean;
        lastSeenAt: string | null;
        totalSessions: number | null;
    };
    freshness: {
        profile: 'fresh' | 'stale' | 'missing';
        platonus: 'fresh' | 'stale' | 'missing';
        umkd: 'fresh' | 'stale' | 'missing';
        analytics: 'fresh' | 'stale' | 'missing';
    };
}

export interface CuratorStudentDetail extends CuratorStudentSummary {
    phone: {
        value: string | null;
        source: 'profile_cache' | 'admin_snapshot' | null;
        missingReason: 'profile_not_cached' | 'phone_not_provided' | null;
    };
    // Removed in the slim curator modal payload (backend
    // group-space.getCuratorStudentDetail): topSubjects, iupSummary,
    // platonus, umkd. Restore alongside a matching UI consumer.
}

export interface GroupUserSearchView {
    userId: string;
    fullName?: string | null;
    existingRole?: {
        roleId: 'coordinator' | 'curator' | 'starosta' | 'helper';
        scopeId: string;
    } | null;
}

export type CoordinatorAnnouncementPriority = 'info' | 'warning' | 'critical';
export type CoordinatorAnnouncementTargetMode = 'all_starostas' | 'groups';

export interface CoordinatorAnnouncementView {
    id: string;
    authorUserId: string;
    title: string;
    body: string;
    priority: CoordinatorAnnouncementPriority;
    targetMode: CoordinatorAnnouncementTargetMode;
    targetGroups: string[];
    expiresAt?: string | null;
    revokedAt?: string | null;
    createdAt: string;
    updatedAt: string;
    viewCount: number;
    viewedAt?: string | null;
}

export type GroupJoinRequestStatus = 'pending' | 'approved' | 'rejected';
export type GroupMembershipDisputeIssue = 'join_blocked' | 'removal_appeal' | 'official_group_mismatch';
export type GroupMembershipDisputeStatus = 'pending' | 'approved' | 'rejected' | 'needs_admin';

export interface GroupJoinRequestView {
    id: string;
    userId: string;
    groupKey: string;
    status: GroupJoinRequestStatus;
    reason?: string | null;
    detectedGroupKey?: string | null;
    createdAt: string;
    updatedAt: string;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
    reviewNote?: string | null;
}

export interface GroupMembershipDisputeView {
    id: string;
    userId: string;
    groupKey: string;
    issueType: GroupMembershipDisputeIssue;
    status: GroupMembershipDisputeStatus;
    reason: string;
    detectedGroupKey?: string | null;
    activeGroupKey?: string | null;
    createdAt: string;
    updatedAt: string;
    reviewedAt?: string | null;
    reviewedBy?: string | null;
    reviewNote?: string | null;
}

export interface GroupPostView {
    id: string;
    groupKey: string;
    title: string;
    body: string;
    authorUserId: string;
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
    deletedBy?: string | null;
    /**
     * Reactions are attached only when the post comes from the feed list
     * endpoint that already batched them in. Standalone post fetches (e.g.
     * post-after-create) may omit this field — UI must default to empty.
     */
    reactions?: {
        items: Array<{ emoji: string; count: number }>;
        mine: string[];
    };
}

export type GroupTaskPriority = 'low' | 'medium' | 'high';

export interface GroupTaskView {
    id: string;
    groupKey: string;
    title: string;
    subject?: string | null;
    description?: string | null;
    deadline?: string | null;
    priority: GroupTaskPriority;
    authorUserId: string;
    completed: boolean;
    completedAt?: string | null;
    completedBy?: string | null;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
    deletedBy?: string | null;
    /**
     * Reactions are attached only on the `socialFeedBeta` read path — the legacy
     * group-tasks endpoint does not aggregate them. The shape mirrors the
     * `GroupPostView.reactions` envelope so `TaskCard` can reuse `ReactionsBar`
     * directly.
     */
    reactions?: {
        items: Array<{ emoji: string; count: number }>;
        mine: string[];
    };
}

export interface GroupExtraLessonView {
    id: string;
    groupKey: string;
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    room?: string | null;
    teacher?: string | null;
    note?: string | null;
    authorUserId: string;
    createdAt: string;
    updatedAt: string;
    deletedAt?: string | null;
    deletedBy?: string | null;
    /**
     * Reactions are attached only on the `socialFeedBeta` read path — the legacy
     * group-extra-lessons endpoint does not aggregate them. The shape mirrors
     * the `GroupPostView.reactions` envelope so `LessonCard` can reuse
     * `ReactionsBar` directly.
     */
    reactions?: {
        items: Array<{ emoji: string; count: number }>;
        mine: string[];
    };
}

export type GroupContentType = 'post' | 'task' | 'extra_lesson';

export interface GroupContentRevisionView {
    id: string;
    groupKey: string;
    contentType: GroupContentType;
    entityId: string;
    editedBy: string;
    editedAt: string;
    snapshot: Record<string, unknown>;
}

export async function platonusLogin(login: string, password: string): Promise<ApiResponse> {
    trackAnalyticsEvent('platonus_login_attempt', {
        feature: 'platonus',
        label: 'connect_account',
        status: 'attempt',
        path: '/grades',
    });
    const result = await fetchWithAuth('/api/v3/platonus/login', {
        method: 'POST',
        body: JSON.stringify({ login, password }),
    });
    trackAnalyticsEvent(result.success ? 'platonus_login_success' : 'platonus_login_failure', {
        feature: 'platonus',
        label: 'connect_account',
        status: result.success ? 'success' : String(result.statusCode || 'failed'),
        details: result.error,
        path: '/grades',
    });
    return result;
}

export async function getPlatonusGrades(
    year: number,
    semester: number,
    refresh = false
): Promise<ApiResponse<PlatonusGradesData>> {
    const refreshQuery = refresh ? '&refresh=true' : '';
    return fetchWithAuth(`/api/v3/platonus/grades?year=${year}&semester=${semester}${refreshQuery}`);
}

export async function getPlatonusStatus(): Promise<ApiResponse<PlatonusStatus>> {
    return fetchWithAuth('/api/v3/platonus/status');
}



export async function getMyFeedbackRating(): Promise<ApiResponse<{ rating: number | null }>> {
    const result = await fetchWithAuth<{ rating?: number | null }>('/api/v3/feedback/me');
    const raw = result as ApiResponse<{ rating?: number | null }> & { rating?: number | null };
    return {
        success: result.success,
        error: result.error,
        errorCode: result.errorCode,
        statusCode: result.statusCode,
        cached: result.cached,
        cacheAge: result.cacheAge,
        stale: result.stale,
        data: result.success ? { rating: raw.rating ?? result.data?.rating ?? null } : undefined,
    };
}

export async function submitAppRating(
    rating: number,
    page?: string | null,
    appVersion?: string | null
): Promise<ApiResponse<{ rating: number }>> {
    const result = await fetchWithAuth<{ rating?: number }>('/api/v3/feedback/rating', {
        method: 'POST',
        body: JSON.stringify({ rating, page, appVersion }),
    });
    const raw = result as ApiResponse<{ rating?: number }> & { rating?: number };
    return {
        success: result.success,
        error: result.error,
        errorCode: result.errorCode,
        statusCode: result.statusCode,
        cached: result.cached,
        cacheAge: result.cacheAge,
        stale: result.stale,
        data: result.success ? { rating: raw.rating ?? result.data?.rating ?? rating } : undefined,
    };
}

export async function submitAppFeedback(
    category: 'suggestion' | 'bug' | 'other',
    message: string,
    rating?: number | null,
    page?: string | null,
    appVersion?: string | null
): Promise<ApiResponse<{ id: string }>> {
    const result = await fetchWithAuth<{ id?: string }>('/api/v3/feedback/message', {
        method: 'POST',
        body: JSON.stringify({ category, message, rating, page, appVersion }),
    });
    const raw = result as ApiResponse<{ id?: string }> & { id?: string };
    return {
        success: result.success,
        error: result.error,
        errorCode: result.errorCode,
        statusCode: result.statusCode,
        cached: result.cached,
        cacheAge: result.cacheAge,
        stale: result.stale,
        data: result.success ? { id: raw.id ?? result.data?.id ?? '' } : undefined,
    };
}

export async function getSupportOverview(): Promise<ApiResponse<SupportOverview>> {
    return fetchWithAuth<SupportOverview>('/api/v3/support/overview');
}

export async function createSupportRequest(amountKzt: number): Promise<ApiResponse<SupportRequestView>> {
    return fetchWithAuth<SupportRequestView>('/api/v3/support/requests', {
        method: 'POST',
        body: JSON.stringify({ amountKzt }),
    });
}

export async function submitSupportRequest(input: {
    requestId: string;
    senderLast4: string;
    senderBank?: string;
    transferAt: string;
    receiptNote?: string;
}): Promise<ApiResponse<SupportRequestView>> {
    return fetchWithAuth<SupportRequestView>('/api/v3/support/requests/submit', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

export async function cancelSupportRequest(requestId: string): Promise<ApiResponse<SupportRequestView>> {
    return fetchWithAuth<SupportRequestView>('/api/v3/support/requests/cancel', {
        method: 'POST',
        body: JSON.stringify({ requestId }),
    });
}


export async function disconnectPlatonus(): Promise<ApiResponse> {
    return fetchWithAuth('/api/v3/platonus/disconnect', {
        method: 'POST',
        body: JSON.stringify({})
    });
}

export async function getPlatonusDetailedSubject(
    year: number,
    semester: number,
    subjectId: string,
    queryId: string
): Promise<ApiResponse<DetailedPlatonusGrade[]>> {
    return fetchWithAuth(`/api/v3/platonus/subject?year=${year}&semester=${semester}&subjectId=${subjectId}&queryId=${queryId}`);
}

// === Sessions (Devices) API ===

export interface DeviceSession {
    sessionId: string;
    deviceName: string | null;
    platform: string | null;
    browser: string | null;
    ip: string | null;
    createdAt: string;
    lastActiveAt: string;
    isCurrent: boolean;
}

export async function getDeviceSessions(): Promise<ApiResponse<{ sessions: DeviceSession[] }>> {
    return fetchWithAuth('/api/v3/auth/sessions');
}

export async function revokeDeviceSession(sessionId: string): Promise<ApiResponse> {
    return fetchWithAuth(`/api/v3/auth/sessions/${sessionId}`, { method: 'DELETE' });
}

export async function revokeAllOtherDeviceSessions(): Promise<ApiResponse<{ revokedCount: number }>> {
    return fetchWithAuth('/api/v3/auth/sessions', { method: 'DELETE' });
}
