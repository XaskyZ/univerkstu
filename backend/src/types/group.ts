import type { ObjectId } from 'mongodb';

export type GroupRoleId = 'coordinator' | 'curator' | 'starosta' | 'helper';
export type GroupScopeType = 'global' | 'group';
export type GroupMembershipSource = 'platonus_auto' | 'manual' | 'join_request';
export type GroupJoinRequestStatus = 'pending' | 'approved' | 'rejected';
export type GroupTaskPriority = 'low' | 'medium' | 'high';
export type GroupContentType = 'post' | 'task' | 'extra_lesson';
export type GroupMembershipDisputeIssue = 'join_blocked' | 'removal_appeal' | 'official_group_mismatch';
export type GroupMembershipDisputeStatus = 'pending' | 'approved' | 'rejected' | 'needs_admin';
export type CoordinatorAnnouncementPriority = 'info' | 'warning' | 'critical';
export type CoordinatorAnnouncementTargetMode = 'all_starostas' | 'groups';

export interface GroupSpace {
    _id?: ObjectId | string;
    groupKey: string;
    title: string;
    slug: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface GroupMembership {
    _id?: ObjectId | string;
    userId: string;
    groupKey: string;
    source: GroupMembershipSource;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    reason?: string | null;
    removedAt?: Date | null;
    removedBy?: string | null;
    removalReason?: string | null;
}

export interface GroupRoleAssignment {
    _id?: ObjectId | string;
    userId: string;
    roleId: GroupRoleId;
    scopeType: GroupScopeType;
    scopeId: string;
    active: boolean;
    assignedBy: string;
    createdAt: Date;
    updatedAt: Date;
    reason?: string | null;
}

export interface GroupJoinRequest {
    _id?: ObjectId | string;
    userId: string;
    groupKey: string;
    status: GroupJoinRequestStatus;
    createdAt: Date;
    updatedAt: Date;
    reason?: string | null;
    detectedGroupKey?: string | null;
    reviewedAt?: Date | null;
    reviewedBy?: string | null;
    reviewNote?: string | null;
}

export interface GroupMembershipDispute {
    _id?: ObjectId | string;
    userId: string;
    groupKey: string;
    issueType: GroupMembershipDisputeIssue;
    status: GroupMembershipDisputeStatus;
    reason: string;
    detectedGroupKey?: string | null;
    activeGroupKey?: string | null;
    createdAt: Date;
    updatedAt: Date;
    reviewedAt?: Date | null;
    reviewedBy?: string | null;
    reviewNote?: string | null;
}

export interface GroupPost {
    _id?: ObjectId | string;
    groupKey: string;
    title: string;
    body: string;
    authorUserId: string;
    pinned: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
    deletedBy?: string | null;
}

export interface GroupTask {
    _id?: ObjectId | string;
    groupKey: string;
    title: string;
    subject?: string | null;
    description?: string | null;
    deadline?: Date | null;
    priority: GroupTaskPriority;
    authorUserId: string;
    completed: boolean;
    completedAt?: Date | null;
    completedBy?: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
    deletedBy?: string | null;
}

export interface GroupExtraLesson {
    _id?: ObjectId | string;
    groupKey: string;
    title: string;
    date: Date;
    startTime: string;
    endTime: string;
    room?: string | null;
    teacher?: string | null;
    note?: string | null;
    authorUserId: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
    deletedBy?: string | null;
}

export interface GroupContentRevision {
    _id?: ObjectId | string;
    groupKey: string;
    contentType: GroupContentType;
    entityId: string;
    editedBy: string;
    editedAt: Date;
    snapshot: Record<string, unknown>;
}

export interface CoordinatorAnnouncement {
    _id?: ObjectId | string;
    id: string;
    authorUserId: string;
    title: string;
    body: string;
    priority: CoordinatorAnnouncementPriority;
    targetMode: CoordinatorAnnouncementTargetMode;
    targetGroups: string[];
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface EffectiveGroupPermissions {
    canManageContent: boolean;
    canManageMembers: boolean;
    canManageHelpers: boolean;
    canAssignStarosta: boolean;
    canViewAudit: boolean;
}

export interface EffectiveGroupAccess {
    roles: GroupRoleId[];
    permissions: EffectiveGroupPermissions;
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
        source: GroupMembershipSource | null;
    };
    access: EffectiveGroupAccess;
    note?: string;
}

export interface GroupRoleAssignmentView {
    userId: string;
    roleId: GroupRoleId;
    scopeType: GroupScopeType;
    scopeId: string;
    active: boolean;
    assignedBy: string;
    createdAt: Date;
    updatedAt: Date;
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
    source: GroupMembershipSource;
    joinedAt: Date;
    roles: GroupRoleId[];
    canBeRemovedManually: boolean;
}

export interface CuratorStudentSummary {
    userId: string;
    fullName?: string | null;
    groupKey: string;
    source: GroupMembershipSource;
    joinedAt: Date;
    roles: GroupRoleId[];
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
        lastSeenAt: Date | null;
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
    // Removed (curator modal slim, see services/group-space.ts):
    //   topSubjects, iupSummary, platonus, umkd
    // The fields above were hydrated from the admin snapshot but never
    // rendered. Re-add only with a matching UI consumer.
}

export interface GroupUserSearchView {
    userId: string;
    fullName?: string | null;
    existingRole?: {
        roleId: GroupRoleId;
        scopeId: string;
    } | null;
}

export interface GroupJoinRequestView {
    id: string;
    userId: string;
    groupKey: string;
    status: GroupJoinRequestStatus;
    reason?: string | null;
    detectedGroupKey?: string | null;
    createdAt: Date;
    updatedAt: Date;
    reviewedAt?: Date | null;
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
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
    deletedBy?: string | null;
}

export interface GroupTaskView {
    id: string;
    groupKey: string;
    title: string;
    subject?: string | null;
    description?: string | null;
    deadline?: Date | null;
    priority: GroupTaskPriority;
    authorUserId: string;
    completed: boolean;
    completedAt?: Date | null;
    completedBy?: string | null;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
    deletedBy?: string | null;
}

export interface GroupExtraLessonView {
    id: string;
    groupKey: string;
    title: string;
    date: Date;
    startTime: string;
    endTime: string;
    room?: string | null;
    teacher?: string | null;
    note?: string | null;
    authorUserId: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date | null;
    deletedBy?: string | null;
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
    createdAt: Date;
    updatedAt: Date;
    reviewedAt?: Date | null;
    reviewedBy?: string | null;
    reviewNote?: string | null;
}

export interface GroupContentRevisionView {
    id: string;
    groupKey: string;
    contentType: GroupContentType;
    entityId: string;
    editedBy: string;
    editedAt: Date;
    snapshot: Record<string, unknown>;
}

export interface CoordinatorAnnouncementView {
    id: string;
    authorUserId: string;
    title: string;
    body: string;
    priority: CoordinatorAnnouncementPriority;
    targetMode: CoordinatorAnnouncementTargetMode;
    targetGroups: string[];
    expiresAt?: Date | null;
    revokedAt?: Date | null;
    createdAt: Date;
    updatedAt: Date;
    viewCount: number;
    viewedAt?: Date | null;
}
