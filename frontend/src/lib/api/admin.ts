/**
 * Admin API: session check, group spaces, group roles, group user lookup,
 * coordinator announcements, support request review.
 *
 * Domain types (GroupSpaceSummary, GroupRoleAssignmentView, AdminSupportData, ...)
 * are imported from `../api` as type-only — they still live in the main barrel
 * for backward-compat with the many call sites that `import type` them from there.
 */
import { fetchWithAuth, type ApiResponse } from './core';
import type {
    AdminSessionRole,
    AdminSupportData,
    AdminSupporterEntry,
    CoordinatorAnnouncementPriority,
    CoordinatorAnnouncementTargetMode,
    CoordinatorAnnouncementView,
    GroupRoleAssignmentView,
    GroupSpaceSummary,
    GroupUserSearchView,
    SupportRequestStatus,
    SupportRequestView,
    SupportTierId,
} from '../api';

export async function checkAdminSession(): Promise<ApiResponse<{ authenticated: boolean; role: AdminSessionRole | null }>> {
    const result = await fetchWithAuth<{ authenticated: boolean; role: AdminSessionRole | null }>('/api/v3/admin/session/check', {
        credentials: 'include',
    });
    if (!result.success) {
        return result;
    }
    if (result.data) {
        return result;
    }

    const direct = result as ApiResponse<{ authenticated: boolean; role: AdminSessionRole | null }> & {
        authenticated?: boolean;
        role?: AdminSessionRole | null;
    };
    if (typeof direct.authenticated === 'boolean') {
        return {
            success: true,
            data: {
                authenticated: direct.authenticated,
                role: direct.role ?? null,
            },
            statusCode: direct.statusCode,
        };
    }

    return {
        success: false,
        error: 'Invalid admin session response',
        statusCode: result.statusCode,
    };
}

export async function getAdminGroupSpaces(): Promise<ApiResponse<{
    groups: GroupSpaceSummary[];
    coordinators: GroupRoleAssignmentView[];
}>> {
    const result = await fetchWithAuth<{
        groups?: GroupSpaceSummary[];
        coordinators?: GroupRoleAssignmentView[];
    }>('/api/v3/admin/group-spaces', {
        credentials: 'include',
    });

    const raw = result as ApiResponse<{
        groups?: GroupSpaceSummary[];
        coordinators?: GroupRoleAssignmentView[];
    }> & {
        groups?: GroupSpaceSummary[];
        coordinators?: GroupRoleAssignmentView[];
    };
    const normalizedData = {
        groups: result.data?.groups ?? raw.groups ?? [],
        coordinators: result.data?.coordinators ?? raw.coordinators ?? [],
    };

    return {
        ...result,
        data: normalizedData,
    };
}

export async function createAdminGroupSpace(
    groupKey?: string,
    title?: string,
): Promise<ApiResponse<GroupSpaceSummary>> {
    return fetchWithAuth('/api/v3/admin/group-spaces/create', {
        method: 'POST',
        body: JSON.stringify({ groupKey, title }),
        credentials: 'include',
    });
}

export async function updateAdminGroupSpace(
    groupKey: string,
    title: string,
): Promise<ApiResponse<GroupSpaceSummary>> {
    return fetchWithAuth('/api/v3/admin/group-spaces/update', {
        method: 'POST',
        body: JSON.stringify({ groupKey, title }),
        credentials: 'include',
    });
}

export async function getAdminGroupRoles(
    groupKey?: string,
    roleId?: 'coordinator' | 'curator' | 'starosta' | 'helper',
): Promise<ApiResponse<{ assignments: GroupRoleAssignmentView[] }>> {
    const params = new URLSearchParams();
    if (groupKey) params.set('groupKey', groupKey);
    if (roleId) params.set('roleId', roleId);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    const result = await fetchWithAuth<{
        assignments?: GroupRoleAssignmentView[];
    }>(`/api/v3/admin/group-roles${suffix}`, {
        credentials: 'include',
    });

    const raw = result as ApiResponse<{
        assignments?: GroupRoleAssignmentView[];
    }> & {
        assignments?: GroupRoleAssignmentView[];
    };
    const normalizedData = {
        assignments: result.data?.assignments ?? raw.assignments ?? [],
    };

    return {
        ...result,
        data: normalizedData,
    };
}

export async function assignAdminGroupRole(
    userId: string,
    roleId: 'coordinator' | 'curator' | 'starosta' | 'helper',
    groupKey?: string,
    reason?: string,
): Promise<ApiResponse<GroupRoleAssignmentView>> {
    return fetchWithAuth('/api/v3/admin/group-roles/assign', {
        method: 'POST',
        body: JSON.stringify({ userId, roleId, groupKey, reason }),
        credentials: 'include',
    });
}

export async function revokeAdminGroupRole(
    userId: string,
    roleId: 'coordinator' | 'curator' | 'starosta' | 'helper',
    groupKey?: string,
    reason?: string,
): Promise<ApiResponse<{ revoked: boolean }>> {
    return fetchWithAuth('/api/v3/admin/group-roles/revoke', {
        method: 'POST',
        body: JSON.stringify({ userId, roleId, groupKey, reason }),
        credentials: 'include',
    });
}

export async function searchAdminGroupUsers(
    query: string,
): Promise<ApiResponse<{ users: GroupUserSearchView[] }>> {
    const suffix = query.trim() ? `?q=${encodeURIComponent(query.trim())}` : '';
    return fetchWithAuth(`/api/v3/admin/group-users/search${suffix}`, {
        credentials: 'include',
    });
}

export async function getAdminGroupUserPhone(
    userId: string,
): Promise<ApiResponse<{
    userId: string;
    phone: string | null;
    source: 'profile_cache' | 'admin_snapshot' | null;
    missingReason: 'profile_not_cached' | 'phone_not_provided' | null;
}>> {
    return fetchWithAuth(`/api/v3/admin/group-users/${encodeURIComponent(userId)}/phone`, {
        credentials: 'include',
    });
}

export async function getAdminCoordinatorAnnouncements(): Promise<ApiResponse<{ announcements: CoordinatorAnnouncementView[] }>> {
    return fetchWithAuth('/api/v3/admin/coordinator-announcements', {
        credentials: 'include',
    });
}

export async function createAdminCoordinatorAnnouncement(input: {
    title: string;
    body: string;
    priority: CoordinatorAnnouncementPriority;
    targetMode: CoordinatorAnnouncementTargetMode;
    targetGroups?: string[];
    expiresAt?: string | null;
}): Promise<ApiResponse<CoordinatorAnnouncementView>> {
    return fetchWithAuth('/api/v3/admin/coordinator-announcements/create', {
        method: 'POST',
        body: JSON.stringify(input),
        credentials: 'include',
    });
}

export async function revokeAdminCoordinatorAnnouncement(
    announcementId: string,
): Promise<ApiResponse<{ revoked: boolean }>> {
    return fetchWithAuth('/api/v3/admin/coordinator-announcements/revoke', {
        method: 'POST',
        body: JSON.stringify({ announcementId }),
        credentials: 'include',
    });
}

export async function getAdminSupportRequests(
    status: SupportRequestStatus | 'all' = 'all',
): Promise<ApiResponse<AdminSupportData>> {
    return fetchWithAuth<AdminSupportData>(`/api/v3/admin/support/requests?status=${encodeURIComponent(status)}`, {
        credentials: 'include',
    });
}

export async function reviewAdminSupportRequest(input: {
    requestId: string;
    decision: 'verified' | 'rejected';
    reviewNote?: string;
}): Promise<ApiResponse<SupportRequestView>> {
    return fetchWithAuth<SupportRequestView>('/api/v3/admin/support/requests/review', {
        method: 'POST',
        body: JSON.stringify(input),
        credentials: 'include',
    });
}

export async function updateAdminSupportOverride(input: {
    userId: string;
    mode: 'grant' | 'revoke' | 'clear';
    tierId?: SupportTierId;
    note?: string;
}): Promise<ApiResponse<AdminSupporterEntry | null>> {
    return fetchWithAuth<AdminSupporterEntry | null>('/api/v3/admin/support/supporters/override', {
        method: 'POST',
        body: JSON.stringify(input),
        credentials: 'include',
    });
}
