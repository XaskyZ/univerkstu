'use client';

import { useCallback, useEffect, useState } from 'react';
import {
    createGroupExtraLesson,
    deleteGroupExtraLesson,
    getDeletedGroupExtraLessons,
    getGroupExtraLessons,
    restoreDeletedGroupExtraLesson,
    updateGroupExtraLesson,
    type GroupExtraLessonView,
} from '@/lib/api';

export function useGroupLessons(groupKey?: string, enabled = true) {
    const [lessons, setLessons] = useState<GroupExtraLessonView[]>([]);
    const [deletedLessons, setDeletedLessons] = useState<GroupExtraLessonView[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setLessons([]);
            setDeletedLessons([]);
            return;
        }

        setLoading(true);
        setError('');
        const [lessonsRes, deletedRes] = await Promise.all([
            getGroupExtraLessons(groupKey),
            getDeletedGroupExtraLessons(groupKey),
        ]);

        if (!lessonsRes.success) {
            setError(lessonsRes.error || 'Failed to load lessons');
            setLoading(false);
            return;
        }

        setLessons(lessonsRes.data?.lessons || []);
        setDeletedLessons(deletedRes.success ? (deletedRes.data?.lessons || []) : []);
        setLoading(false);
    }, [enabled, groupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    const createLesson = useCallback(async (payload: {
        title: string;
        date: string;
        startTime: string;
        endTime: string;
        room?: string;
        teacher?: string;
        note?: string;
    }) => {
        if (!groupKey) return { success: false, error: 'Missing groupKey' };
        const result = await createGroupExtraLesson({ ...payload, groupKey });
        if (result.success) {
            await refresh();
        }
        return result;
    }, [groupKey, refresh]);

    const updateLessonItem = useCallback(async (lessonId: string, payload: {
        title: string;
        date: string;
        startTime: string;
        endTime: string;
        room?: string;
        teacher?: string;
        note?: string;
    }) => {
        const result = await updateGroupExtraLesson(lessonId, payload);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const deleteLessonItem = useCallback(async (lessonId: string) => {
        const result = await deleteGroupExtraLesson(lessonId);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    const restoreLesson = useCallback(async (lessonId: string) => {
        const result = await restoreDeletedGroupExtraLesson(lessonId);
        if (result.success) {
            await refresh();
        }
        return result;
    }, [refresh]);

    return {
        lessons,
        deletedLessons,
        loading,
        error,
        refresh,
        createLesson,
        updateLessonItem,
        deleteLessonItem,
        restoreLesson,
    };
}
