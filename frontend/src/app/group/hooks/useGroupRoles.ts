'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    assignGroupRole,
    getGroupRoles,
    revokeGroupRole,
    type GroupRoleAssignmentView,
} from '@/lib/api';

export function useGroupRoles(groupKey?: string, enabled = true) {
    const [assignments, setAssignments] = useState<GroupRoleAssignmentView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setAssignments([]);
            return;
        }

        setLoading(true);
        setError('');
        const result = await getGroupRoles(groupKey);
        if (!result.success) {
            setError(result.error || 'Failed to load roles');
            setLoading(false);
            return;
        }

        setAssignments(result.data?.assignments || []);
        setLoading(false);
    }, [enabled, groupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    const assignRole = useCallback(async (userId: string, roleId: 'starosta' | 'helper', reason?: string) => {
        if (!groupKey) return { success: false, error: 'Missing groupKey' };
        const result = await assignGroupRole(userId, roleId, groupKey, reason);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [groupKey, refresh]);

    const revokeRole = useCallback(async (userId: string, roleId: 'starosta' | 'helper', reason?: string) => {
        if (!groupKey) return { success: false, error: 'Missing groupKey' };
        const result = await revokeGroupRole(userId, roleId, groupKey, reason);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [groupKey, refresh]);

    return {
        assignments,
        loading,
        error,
        refresh,
        assignRole,
        revokeRole,
    };
}
