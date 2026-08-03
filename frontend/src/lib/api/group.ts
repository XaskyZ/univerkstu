/**
 * Group API: workspace surface for groups, curator/coordinator views, content
 * (feed posts, tasks, extra lessons), revisions, role/dispute/join-request flows.
 *
 * Domain types are still in `../api` and imported as `import type` to keep this
 * module purely behaviour while the main barrel stays the source of truth.
 */
import { fetchWithAuth, type ApiResponse } from './core';
import type {
    CoordinatorAnnouncementView,
    CuratorStudentDetail,
    CuratorStudentSummary,
    GroupCatalogItem,
    GroupContentRevisionView,
    GroupContentType,
    GroupExtraLessonView,
    GroupJoinRequestStatus,
    GroupJoinRequestView,
    GroupMemberView,
    GroupMembershipDisputeIssue,
    GroupMembershipDisputeStatus,
    GroupMembershipDisputeView,
    GroupPostView,
    GroupRoleAssignmentView,
    GroupSpaceMe,
    GroupTaskPriority,
    GroupTaskView,
} from '../api';

export async function getGroupSpaceMe(): Promise<ApiResponse<GroupSpaceMe>> {
    return fetchWithAuth('/api/v3/group/me');
}

export async function getGroupCatalog(): Promise<ApiResponse<{ groups: GroupCatalogItem[] }>> {
    return fetchWithAuth('/api/v3/group/catalog');
}

export async function getGroupMembers(groupKey?: string): Promise<ApiResponse<{ groupKey: string; members: GroupMemberView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/members${query}`);
}

export async function getCuratorStudents(groupKey?: string): Promise<ApiResponse<{ groupKey: string; students: CuratorStudentSummary[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/curator/students${query}`);
}

export async function getCuratorStudentDetail(
    userId: string,
    groupKey?: string,
): Promise<ApiResponse<{ groupKey: string; student: CuratorStudentDetail }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/curator/students/${encodeURIComponent(userId)}${query}`);
}

export async function removeGroupMember(
    userId: string,
    reason: string,
    groupKey?: string,
): Promise<ApiResponse<{ removed: boolean }>> {
    return fetchWithAuth('/api/v3/group/members/remove', {
        method: 'POST',
        body: JSON.stringify({ userId, reason, groupKey }),
    });
}

export async function getGroupFeed(groupKey?: string): Promise<ApiResponse<{ groupKey: string; posts: GroupPostView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/feed${query}`);
}

export async function getDeletedGroupFeed(groupKey?: string): Promise<ApiResponse<{ groupKey: string; posts: GroupPostView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/feed/deleted${query}`);
}

export async function getGroupTasks(groupKey?: string): Promise<ApiResponse<{ groupKey: string; tasks: GroupTaskView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/tasks${query}`);
}

export async function getDeletedGroupTasks(groupKey?: string): Promise<ApiResponse<{ groupKey: string; tasks: GroupTaskView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/tasks/deleted${query}`);
}

export async function getGroupExtraLessons(groupKey?: string): Promise<ApiResponse<{ groupKey: string; lessons: GroupExtraLessonView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/extra-lessons${query}`);
}

export async function getDeletedGroupExtraLessons(groupKey?: string): Promise<ApiResponse<{ groupKey: string; lessons: GroupExtraLessonView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/extra-lessons/deleted${query}`);
}

export async function getGroupContentRevisions(
    contentType: GroupContentType,
    entityId: string,
    groupKey?: string,
): Promise<ApiResponse<{ groupKey: string; contentType: GroupContentType; entityId: string; revisions: GroupContentRevisionView[] }>> {
    const params = new URLSearchParams({ contentType, entityId });
    if (groupKey) params.set('groupKey', groupKey);
    return fetchWithAuth(`/api/v3/group/revisions?${params.toString()}`);
}

export async function restoreGroupContentRevision(
    revisionId: string,
): Promise<ApiResponse<{ groupKey: string; contentType: GroupContentType; entityId: string }>> {
    return fetchWithAuth('/api/v3/group/revisions/restore', {
        method: 'POST',
        body: JSON.stringify({ revisionId }),
    });
}

export async function createGroupFeedPost(
    title: string,
    body: string,
    groupKey?: string,
    pinned?: boolean,
): Promise<ApiResponse<GroupPostView>> {
    return fetchWithAuth('/api/v3/group/posts', {
        method: 'POST',
        body: JSON.stringify({ title, body, groupKey, pinned }),
    });
}

export async function createGroupTask(
    title: string,
    options: {
        groupKey?: string;
        subject?: string;
        description?: string;
        deadline?: string;
        priority?: GroupTaskPriority;
    } = {},
): Promise<ApiResponse<GroupTaskView>> {
    return fetchWithAuth('/api/v3/group/tasks', {
        method: 'POST',
        body: JSON.stringify({
            title,
            groupKey: options.groupKey,
            subject: options.subject,
            description: options.description,
            deadline: options.deadline,
            priority: options.priority,
        }),
    });
}

export async function updateGroupFeedPost(
    postId: string,
    title: string,
    body: string,
    pinned: boolean,
): Promise<ApiResponse<GroupPostView>> {
    return fetchWithAuth('/api/v3/group/posts/update', {
        method: 'POST',
        body: JSON.stringify({ postId, title, body, pinned }),
    });
}

export async function updateGroupTask(
    taskId: string,
    options: {
        title: string;
        subject?: string;
        description?: string;
        deadline?: string;
        priority?: GroupTaskPriority;
    },
): Promise<ApiResponse<GroupTaskView>> {
    return fetchWithAuth('/api/v3/group/tasks/update', {
        method: 'POST',
        body: JSON.stringify({
            taskId,
            title: options.title,
            subject: options.subject,
            description: options.description,
            deadline: options.deadline,
            priority: options.priority,
        }),
    });
}

export async function createGroupExtraLesson(options: {
    title: string;
    date: string;
    startTime: string;
    endTime: string;
    groupKey?: string;
    room?: string;
    teacher?: string;
    note?: string;
}): Promise<ApiResponse<GroupExtraLessonView>> {
    return fetchWithAuth('/api/v3/group/extra-lessons', {
        method: 'POST',
        body: JSON.stringify(options),
    });
}

export async function updateGroupExtraLesson(
    lessonId: string,
    options: {
        title: string;
        date: string;
        startTime: string;
        endTime: string;
        room?: string;
        teacher?: string;
        note?: string;
    },
): Promise<ApiResponse<GroupExtraLessonView>> {
    return fetchWithAuth('/api/v3/group/extra-lessons/update', {
        method: 'POST',
        body: JSON.stringify({
            lessonId,
            title: options.title,
            date: options.date,
            startTime: options.startTime,
            endTime: options.endTime,
            room: options.room,
            teacher: options.teacher,
            note: options.note,
        }),
    });
}

export async function deleteGroupFeedPost(postId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return fetchWithAuth('/api/v3/group/posts/delete', {
        method: 'POST',
        body: JSON.stringify({ postId }),
    });
}

export async function restoreDeletedGroupFeedPost(postId: string): Promise<ApiResponse<GroupPostView>> {
    return fetchWithAuth('/api/v3/group/posts/restore-deleted', {
        method: 'POST',
        body: JSON.stringify({ postId }),
    });
}

export async function permanentlyDeleteGroupFeedPost(postId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return fetchWithAuth('/api/v3/group/posts/delete-permanently', {
        method: 'POST',
        body: JSON.stringify({ postId }),
    });
}

export async function toggleGroupTaskCompletion(
    taskId: string,
    completed: boolean,
): Promise<ApiResponse<GroupTaskView>> {
    return fetchWithAuth('/api/v3/group/tasks/toggle', {
        method: 'POST',
        body: JSON.stringify({ taskId, completed }),
    });
}

export async function deleteGroupTask(taskId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return fetchWithAuth('/api/v3/group/tasks/delete', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
    });
}

export async function restoreDeletedGroupTask(taskId: string): Promise<ApiResponse<GroupTaskView>> {
    return fetchWithAuth('/api/v3/group/tasks/restore-deleted', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
    });
}

export async function deleteGroupExtraLesson(lessonId: string): Promise<ApiResponse<{ deleted: boolean }>> {
    return fetchWithAuth('/api/v3/group/extra-lessons/delete', {
        method: 'POST',
        body: JSON.stringify({ lessonId }),
    });
}

export async function restoreDeletedGroupExtraLesson(lessonId: string): Promise<ApiResponse<GroupExtraLessonView>> {
    return fetchWithAuth('/api/v3/group/extra-lessons/restore-deleted', {
        method: 'POST',
        body: JSON.stringify({ lessonId }),
    });
}

export async function getMyGroupMembershipDisputes(): Promise<ApiResponse<{ disputes: GroupMembershipDisputeView[] }>> {
    return fetchWithAuth('/api/v3/group/disputes/me');
}

export async function getGroupMembershipDisputes(
    groupKey?: string,
    status: GroupMembershipDisputeStatus = 'pending',
): Promise<ApiResponse<{ groupKey: string; disputes: GroupMembershipDisputeView[] }>> {
    const params = new URLSearchParams();
    if (groupKey) params.set('groupKey', groupKey);
    if (status) params.set('status', status);
    const query = params.toString();
    return fetchWithAuth(`/api/v3/group/disputes${query ? `?${query}` : ''}`);
}

export async function createGroupMembershipDispute(
    groupKey: string,
    issueType: GroupMembershipDisputeIssue,
    reason: string,
): Promise<ApiResponse<GroupMembershipDisputeView>> {
    return fetchWithAuth('/api/v3/group/disputes', {
        method: 'POST',
        body: JSON.stringify({ groupKey, issueType, reason }),
    });
}

export async function reviewGroupMembershipDispute(
    disputeId: string,
    decision: Exclude<GroupMembershipDisputeStatus, 'pending'>,
    note?: string,
): Promise<ApiResponse<GroupMembershipDisputeView>> {
    return fetchWithAuth('/api/v3/group/disputes/review', {
        method: 'POST',
        body: JSON.stringify({ disputeId, decision, note }),
    });
}

export async function getMyGroupJoinRequests(): Promise<ApiResponse<{ requests: GroupJoinRequestView[] }>> {
    return fetchWithAuth('/api/v3/group/join-requests/me');
}

export async function getGroupJoinRequests(
    groupKey?: string,
    status: GroupJoinRequestStatus = 'pending',
): Promise<ApiResponse<{ groupKey: string; requests: GroupJoinRequestView[] }>> {
    const params = new URLSearchParams();
    if (groupKey) params.set('groupKey', groupKey);
    if (status) params.set('status', status);
    const query = params.toString();
    return fetchWithAuth(`/api/v3/group/join-requests${query ? `?${query}` : ''}`);
}

export async function createGroupJoinRequest(
    groupKey: string,
    reason?: string,
): Promise<ApiResponse<GroupJoinRequestView>> {
    return fetchWithAuth('/api/v3/group/join-requests', {
        method: 'POST',
        body: JSON.stringify({ groupKey, reason }),
    });
}

export async function reviewGroupJoinRequest(
    requestId: string,
    decision: 'approved' | 'rejected',
    note?: string,
): Promise<ApiResponse<GroupJoinRequestView>> {
    return fetchWithAuth('/api/v3/group/join-requests/review', {
        method: 'POST',
        body: JSON.stringify({ requestId, decision, note }),
    });
}

export async function getGroupRoles(groupKey?: string): Promise<ApiResponse<{ groupKey: string; assignments: GroupRoleAssignmentView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/roles${query}`);
}

export async function assignGroupRole(
    userId: string,
    roleId: 'starosta' | 'helper',
    groupKey: string,
    reason?: string,
): Promise<ApiResponse<GroupRoleAssignmentView>> {
    return fetchWithAuth('/api/v3/group/roles/assign', {
        method: 'POST',
        body: JSON.stringify({ userId, roleId, groupKey, reason }),
    });
}

export async function revokeGroupRole(
    userId: string,
    roleId: 'starosta' | 'helper',
    groupKey: string,
    reason?: string,
): Promise<ApiResponse<{ revoked: boolean }>> {
    return fetchWithAuth('/api/v3/group/roles/revoke', {
        method: 'POST',
        body: JSON.stringify({ userId, roleId, groupKey, reason }),
    });
}

export async function getCoordinatorAnnouncementsForGroup(
    groupKey?: string,
): Promise<ApiResponse<{ groupKey: string; announcements: CoordinatorAnnouncementView[] }>> {
    const query = groupKey ? `?groupKey=${encodeURIComponent(groupKey)}` : '';
    return fetchWithAuth(`/api/v3/group/coordinator-announcements${query}`);
}

export async function markCoordinatorAnnouncementViewed(
    announcementId: string,
    groupKey?: string,
): Promise<ApiResponse> {
    return fetchWithAuth('/api/v3/group/coordinator-announcements/view', {
        method: 'POST',
        body: JSON.stringify({ announcementId, groupKey }),
    });
}

// ---------------------------------------------------------------------------
// Files & Links tab — per-group link and file metadata registries.
//
// Files reference an already-uploaded R2/storage object by `fileId`. The
// download URL for the underlying binary is the existing `/api/v3/files/:fileId`
// endpoint; this client only manipulates the per-group registry rows.
// ---------------------------------------------------------------------------

export interface GroupLinkView {
    id: string;
    groupKey: string;
    title: string;
    url: string;
    description?: string | null;
    createdBy: string;
    createdAt: string;
}

export interface GroupFileEntryView {
    id: string;
    groupKey: string;
    fileId: string;
    title: string;
    description?: string | null;
    mime?: string | null;
    sizeBytes?: number | null;
    createdBy: string;
    createdAt: string;
}

export async function getGroupLinks(
    groupKey: string,
): Promise<ApiResponse<{ groupKey: string; links: GroupLinkView[] }>> {
    return fetchWithAuth(`/api/v3/group/${encodeURIComponent(groupKey)}/links`);
}

export async function addGroupLink(
    groupKey: string,
    payload: { title: string; url: string; description?: string | null },
): Promise<ApiResponse<GroupLinkView>> {
    return fetchWithAuth(`/api/v3/group/${encodeURIComponent(groupKey)}/links`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function deleteGroupLink(
    groupKey: string,
    linkId: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
    return fetchWithAuth(
        `/api/v3/group/${encodeURIComponent(groupKey)}/links/${encodeURIComponent(linkId)}`,
        { method: 'DELETE' },
    );
}

export async function getGroupFiles(
    groupKey: string,
): Promise<ApiResponse<{ groupKey: string; files: GroupFileEntryView[] }>> {
    return fetchWithAuth(`/api/v3/group/${encodeURIComponent(groupKey)}/files`);
}

export async function addGroupFile(
    groupKey: string,
    payload: {
        title: string;
        fileId: string;
        description?: string | null;
        mime?: string | null;
        sizeBytes?: number | null;
    },
): Promise<ApiResponse<GroupFileEntryView>> {
    return fetchWithAuth(`/api/v3/group/${encodeURIComponent(groupKey)}/files`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export async function deleteGroupFile(
    groupKey: string,
    fileEntryId: string,
): Promise<ApiResponse<{ deleted: boolean }>> {
    return fetchWithAuth(
        `/api/v3/group/${encodeURIComponent(groupKey)}/files/${encodeURIComponent(fileEntryId)}`,
        { method: 'DELETE' },
    );
}

// ---------------------------------------------------------------------------
// Feed post reactions — fixed 5-emoji set, toggle semantics. The backend
// validates the emoji against an allow-list; the client mirrors it as
// `ALLOWED_REACTION_EMOJI` for UI rendering only.
// ---------------------------------------------------------------------------

export const ALLOWED_REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '😢'] as const;
export type AllowedReactionEmoji = (typeof ALLOWED_REACTION_EMOJI)[number];

export interface ReactionAggregate {
    emoji: string;
    count: number;
}

export interface GroupPostReactionsPayload {
    groupKey: string;
    postId: string;
    reactions: ReactionAggregate[];
    mine: string[];
}

export interface GroupPostReactionsToggleResult extends GroupPostReactionsPayload {
    added: boolean;
}

export async function getGroupPostReactions(
    groupKey: string,
    postId: string,
): Promise<ApiResponse<GroupPostReactionsPayload>> {
    return fetchWithAuth(
        `/api/v3/group/${encodeURIComponent(groupKey)}/posts/${encodeURIComponent(postId)}/reactions`,
    );
}

export async function toggleGroupPostReaction(
    groupKey: string,
    postId: string,
    emoji: AllowedReactionEmoji | string,
): Promise<ApiResponse<GroupPostReactionsToggleResult>> {
    return fetchWithAuth(
        `/api/v3/group/${encodeURIComponent(groupKey)}/posts/${encodeURIComponent(postId)}/reactions`,
        {
            method: 'POST',
            body: JSON.stringify({ emoji }),
        },
    );
}
