import type { CoordinatorAnnouncementPriority, CoordinatorAnnouncementTargetMode, GroupMemberView } from '@/lib/api';

export type ManagedRole = 'starosta' | 'helper';
export type GroupListFilter = 'all' | 'with_roles' | 'without_starosta' | 'without_helper' | 'with_members' | 'empty';

export type GroupMembersState = {
    loading: boolean;
    error: string;
    members: GroupMemberView[];
};

export const EMPTY_GROUP_STATE: GroupMembersState = {
    loading: false,
    error: '',
    members: [],
};

export type CoordinatorUi = {
    title: string;
    subtitle: string;
    groups: string;
    groupsHint: string;
    groupSearch: string;
    oversight: string;
    oversightHint: string;
    filterAll: string;
    filterWithRoles: string;
    filterWithoutStarosta: string;
    filterWithoutHelper: string;
    filterWithMembers: string;
    filterEmpty: string;
    broadcasts: string;
    broadcastsHint: string;
    createGroup: string;
    editGroup: string;
    openSpace: string;
    collapse: string;
    expand: string;
    loading: string;
    loadFailed: string;
    noGroups: string;
    members: string;
    memberFilter: string;
    noMembers: string;
    responsibles: string;
    noResponsibles: string;
    phone: string;
    phoneMissing: string;
    phoneNotSynced: string;
    phoneNotProvided: string;
    showPhone: string;
    phoneLoading: string;
    starosta: string;
    helper: string;
    memberSince: string;
    manualMember: string;
    autoMember: string;
    assignStarosta: string;
    revokeStarosta: string;
    assignHelper: string;
    revokeHelper: string;
    announcementTitle: string;
    announcementBody: string;
    announcementPriority: string;
    priorityInfo: string;
    priorityWarning: string;
    priorityCritical: string;
    announcementTargeting: string;
    allStarostas: string;
    selectedGroups: string;
    expiresAt: string;
    publish: string;
    recentAnnouncements: string;
    noAnnouncements: string;
    revokeAnnouncement: string;
    active: string;
    expired: string;
    revoked: string;
    targetedGroups: string;
    allGroupsBadge: string;
    createdAt: string;
    viewCount: string;
    groupTitle: string;
    groupKey: string;
    save: string;
};

export type { CoordinatorAnnouncementPriority, CoordinatorAnnouncementTargetMode };
