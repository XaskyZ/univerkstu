'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    createGroupJoinRequest,
    getGroupJoinRequests,
    getGroupMembers,
    getMyGroupJoinRequests,
    removeGroupMember,
    reviewGroupJoinRequest,
    type GroupJoinRequestView,
    type GroupMemberView,
} from '@/lib/api';

export function dedupeMembers(items: GroupMemberView[]): GroupMemberView[] {
    const map = new Map<string, GroupMemberView>();
    for (const member of items) {
        const existing = map.get(member.userId);
        if (!existing) {
            map.set(member.userId, {
                ...member,
                roles: Array.from(new Set(member.roles)),
            });
            continue;
        }
        map.set(member.userId, {
            ...existing,
            fullName: existing.fullName || member.fullName,
            source: existing.source === 'platonus_auto' || member.source !== 'platonus_auto' ? existing.source : member.source,
            joinedAt: new Date(existing.joinedAt).getTime() <= new Date(member.joinedAt).getTime() ? existing.joinedAt : member.joinedAt,
            canBeRemovedManually: existing.canBeRemovedManually && member.canBeRemovedManually,
            roles: Array.from(new Set([...existing.roles, ...member.roles])),
        });
    }
    return Array.from(map.values()).sort((left, right) => {
        const leftLabel = `${left.fullName || ''} ${left.userId}`.trim();
        const rightLabel = `${right.fullName || ''} ${right.userId}`.trim();
        return leftLabel.localeCompare(rightLabel, 'ru');
    });
}

export function useGroupMembers(groupKey?: string, enabled = true) {
    const [members, setMembers] = useState<GroupMemberView[]>([]);
    const [joinRequests, setJoinRequests] = useState<GroupJoinRequestView[]>([]);
    const [myJoinRequests, setMyJoinRequests] = useState<GroupJoinRequestView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled) {
            setMembers([]);
            setJoinRequests([]);
            setMyJoinRequests([]);
            return;
        }

        setLoading(true);
        setError('');
        const emptyMembersResponse: Awaited<ReturnType<typeof getGroupMembers>> = {
            success: true,
            data: { groupKey: groupKey || '', members: [] },
        };
        const emptyRequestsResponse: Awaited<ReturnType<typeof getGroupJoinRequests>> = {
            success: true,
            data: { groupKey: groupKey || '', requests: [] },
        };
        const [membersRes, requestsRes, myRequestsRes] = await Promise.all([
            groupKey ? getGroupMembers(groupKey) : Promise.resolve(emptyMembersResponse),
            groupKey ? getGroupJoinRequests(groupKey, 'pending') : Promise.resolve(emptyRequestsResponse),
            getMyGroupJoinRequests(),
        ]);

        if (!membersRes.success) {
            setError(membersRes.error || 'Failed to load members');
            setLoading(false);
            return;
        }

        setMembers(dedupeMembers(membersRes.data?.members || []));
        setJoinRequests(requestsRes.success ? (requestsRes.data?.requests || []) : []);
        setMyJoinRequests(myRequestsRes.success ? (myRequestsRes.data?.requests || []) : []);
        setLoading(false);
    }, [enabled, groupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    const removeMember = useCallback(async (userId: string, reason: string) => {
        const result = await removeGroupMember(userId, reason, groupKey);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [groupKey, refresh]);

    const createJoinRequestItem = useCallback(async (targetGroupKey: string, reason?: string) => {
        const result = await createGroupJoinRequest(targetGroupKey, reason);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const reviewJoinRequest = useCallback(async (requestId: string, decision: 'approved' | 'rejected', note?: string) => {
        const result = await reviewGroupJoinRequest(requestId, decision, note);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    return {
        members,
        joinRequests,
        myJoinRequests,
        loading,
        error,
        refresh,
        removeMember,
        createJoinRequestItem,
        reviewJoinRequest,
    };
}
