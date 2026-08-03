'use client';

import { useEffect, useRef } from 'react';
import { getGroupSpaceMe, getGroupTasks } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import {
    detectAndStoreNewTaskDelta,
    getDeadlineReminderCandidate,
    markDeadlineReminderSent,
    showNewTasksNotification,
    showTaskDeadlineNotification,
} from '@/lib/group-task-notifications';
import { areNotificationsEnabled } from '@/lib/use-notifications';
import { getClientDebugEnvironment, recordRuntimeTrace } from '@/lib/runtime-debug';

const GROUP_TASK_WATCHER_INTERVAL_MS = 10 * 60 * 1000;
const VISIBILITY_RECHECK_MS = 2 * 60 * 1000;

export default function GroupTaskNotificationsWatcher() {
    const { isAuth, userId } = useAuth();
    const lastCheckAtRef = useRef(0);
    const runningRef = useRef(false);
    const bootstrappedRef = useRef(false);

    useEffect(() => {
        if (!isAuth || typeof window === 'undefined') return;

        let cancelled = false;
        let timeoutId: number | null = null;
        let idleId: number | null = null;
        const idleWindow = window as typeof window & {
            requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
            cancelIdleCallback?: (id: number) => void;
        };

        const runCheck = async () => {
            if (cancelled || runningRef.current) return;
            if (document.visibilityState !== 'visible') return;
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            if (!areNotificationsEnabled()) return;

            runningRef.current = true;
            try {
                const meResult = await getGroupSpaceMe();
                if (!meResult.success || !meResult.data?.group?.groupKey) {
                    return;
                }

                const groupKey = meResult.data.group.groupKey;
                const tasksResult = await getGroupTasks(groupKey);
                if (!tasksResult.success || !tasksResult.data) {
                    void recordRuntimeTrace({
                        scope: 'group.tasks.watcher',
                        event: 'tasks_unavailable',
                        level: tasksResult.statusCode === 0 ? 'info' : 'warn',
                        message: 'Failed to load group tasks for notifications',
                        metadata: {
                            ...getClientDebugEnvironment(),
                            groupKey,
                            statusCode: tasksResult.statusCode ?? null,
                            error: tasksResult.error ?? null,
                        },
                        throttleKey: `group.tasks.watcher:unavailable:${groupKey}:${tasksResult.statusCode ?? 'unknown'}`,
                    });
                    return;
                }

                const tasks = tasksResult.data.tasks || [];
                const delta = detectAndStoreNewTaskDelta(tasks, groupKey, userId || null);
                if (delta.count > 0) {
                    await showNewTasksNotification(delta, groupKey);
                    void recordRuntimeTrace({
                        scope: 'group.tasks.watcher',
                        event: 'new_tasks_notified',
                        level: 'info',
                        message: `Detected ${delta.count} new group task(s)`,
                        metadata: {
                            ...getClientDebugEnvironment(),
                            groupKey,
                            count: delta.count,
                        },
                        throttleKey: `group.tasks.watcher:new_tasks:${groupKey}:${delta.count}`,
                        throttleMs: 5_000,
                    });
                }

                const reminder = getDeadlineReminderCandidate(tasks, groupKey, userId || null);
                if (reminder) {
                    await showTaskDeadlineNotification(reminder.task, reminder.threshold, groupKey);
                    markDeadlineReminderSent(groupKey, reminder.task, reminder.threshold, userId || null);
                    void recordRuntimeTrace({
                        scope: 'group.tasks.watcher',
                        event: 'deadline_notified',
                        level: 'info',
                        message: `Deadline reminder sent for task ${reminder.task.id}`,
                        metadata: {
                            ...getClientDebugEnvironment(),
                            groupKey,
                            taskId: reminder.task.id,
                            threshold: reminder.threshold,
                        },
                        throttleKey: `group.tasks.watcher:deadline:${groupKey}:${reminder.task.id}:${reminder.threshold}`,
                        throttleMs: 5_000,
                    });
                }

                lastCheckAtRef.current = Date.now();
            } finally {
                runningRef.current = false;
            }
        };

        const scheduleInitialCheck = () => {
            if (bootstrappedRef.current) return;
            bootstrappedRef.current = true;
            const idle = idleWindow.requestIdleCallback;
            if (idle) {
                idleId = idle(() => {
                    if (cancelled) return;
                    void runCheck();
                }, { timeout: 3000 });
                return;
            }
            timeoutId = window.setTimeout(() => {
                if (cancelled) return;
                void runCheck();
            }, 1500);
        };

        scheduleInitialCheck();

        const interval = window.setInterval(() => {
            if (document.visibilityState !== 'visible') return;
            void runCheck();
        }, GROUP_TASK_WATCHER_INTERVAL_MS);

        const handleVisibilityChange = () => {
            if (document.visibilityState !== 'visible') return;
            if (Date.now() - lastCheckAtRef.current < VISIBILITY_RECHECK_MS) return;
            void runCheck();
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            cancelled = true;
            if (timeoutId !== null) {
                window.clearTimeout(timeoutId);
            }
            if (idleId !== null) {
                idleWindow.cancelIdleCallback?.(idleId);
            }
            window.clearInterval(interval);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [isAuth, userId]);

    return null;
}
