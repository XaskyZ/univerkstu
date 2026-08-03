'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    createGroupTask,
    deleteGroupTask,
    getDeletedGroupTasks,
    getGroupTasks,
    restoreDeletedGroupTask,
    toggleGroupTaskCompletion,
    updateGroupTask,
    type GroupTaskPriority,
    type GroupTaskView,
} from '@/lib/api';

export function useGroupTasks(groupKey?: string, enabled = true) {
    const [tasks, setTasks] = useState<GroupTaskView[]>([]);
    const [deletedTasks, setDeletedTasks] = useState<GroupTaskView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setTasks([]);
            setDeletedTasks([]);
            return;
        }

        setLoading(true);
        setError('');
        const [tasksRes, deletedRes] = await Promise.all([
            getGroupTasks(groupKey),
            getDeletedGroupTasks(groupKey),
        ]);

        if (!tasksRes.success) {
            setError(tasksRes.error || 'Failed to load tasks');
            setLoading(false);
            return;
        }

        setTasks(tasksRes.data?.tasks || []);
        setDeletedTasks(deletedRes.success ? (deletedRes.data?.tasks || []) : []);
        setLoading(false);
    }, [enabled, groupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    const createTask = useCallback(async (payload: {
        title: string;
        subject?: string;
        description?: string;
        deadline?: string;
        priority?: GroupTaskPriority;
    }) => {
        if (!groupKey) return { success: false, error: 'Missing groupKey' };
        const result = await createGroupTask(payload.title, {
            groupKey,
            subject: payload.subject,
            description: payload.description,
            deadline: payload.deadline,
            priority: payload.priority,
        });
        if (result.success) {
            await refresh();
        }
        return result;
    }, [groupKey, refresh]);

    const updateTaskItem = useCallback(async (taskId: string, payload: {
        title: string;
        subject?: string;
        description?: string;
        deadline?: string;
        priority?: GroupTaskPriority;
    }) => {
        const result = await updateGroupTask(taskId, payload);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const toggleCompleted = useCallback(async (taskId: string, completed: boolean) => {
        const previous = tasks;
        setTasks((current) => current.map((task) => task.id === taskId ? { ...task, completed } : task));
        const result = await toggleGroupTaskCompletion(taskId, completed);
        if (!result.success) {
            setTasks(previous);
            return result;
        }
        setTasks((current) => current.map((task) => task.id === taskId ? (result.data || task) : task));
        return result;
    }, [tasks]);

    const deleteTaskItem = useCallback(async (taskId: string) => {
        const result = await deleteGroupTask(taskId);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const restoreTask = useCallback(async (taskId: string) => {
        const result = await restoreDeletedGroupTask(taskId);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    return {
        tasks,
        deletedTasks,
        loading,
        error,
        refresh,
        createTask,
        updateTaskItem,
        toggleCompleted,
        deleteTaskItem,
        restoreTask,
    };
}
