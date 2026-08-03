'use client';

import type { GroupTaskView } from './api';

type NotificationLang = 'ru' | 'kz' | 'en';

export interface GroupTaskDelta {
    count: number;
    sample: GroupTaskView | null;
}

const TASK_REMINDER_THRESHOLDS = [60, 180, 1440] as const;

function getNotificationLanguage(): NotificationLang {
    if (typeof window === 'undefined') return 'ru';
    const value = localStorage.getItem('app-language');
    return value === 'kz' || value === 'en' ? value : 'ru';
}

function getMessages(language: NotificationLang) {
    if (language === 'kz') {
        return {
            newTaskTitle: 'Топта жаңа тапсырма',
            newTaskSingle: 'Жаңа тапсырма: {title}',
            newTaskMany: '{count} жаңа тапсырма бар. Мысалы: {title}',
            deadlineTitle: 'Тапсырма дедлайны жақындап қалды',
            deadlineBody: '"{title}" тапсыруға {timeLeft} қалды.',
            taskFallback: 'Тапсырма',
            time24h: '24 сағаттан аз',
            time3h: '3 сағаттан аз',
            time1h: '1 сағаттан аз',
        };
    }

    if (language === 'en') {
        return {
            newTaskTitle: 'New group task',
            newTaskSingle: 'New task: {title}',
            newTaskMany: '{count} new tasks. For example: {title}',
            deadlineTitle: 'Task deadline is approaching',
            deadlineBody: '"{title}" is due in {timeLeft}.',
            taskFallback: 'Task',
            time24h: 'less than 24 hours',
            time3h: 'less than 3 hours',
            time1h: 'less than 1 hour',
        };
    }

    return {
        newTaskTitle: 'Новое задание в группе',
        newTaskSingle: 'Новое задание: {title}',
        newTaskMany: 'Появилось {count} новых заданий. Например: {title}',
        deadlineTitle: 'Скоро дедлайн по заданию',
        deadlineBody: 'До сдачи "{title}" осталось {timeLeft}.',
        taskFallback: 'Задание',
        time24h: 'меньше 24 часов',
        time3h: 'меньше 3 часов',
        time1h: 'меньше 1 часа',
    };
}

function formatMessage(template: string, values: Record<string, string | number>) {
    return Object.entries(values).reduce((acc, [key, value]) => acc.replace(`{${key}}`, String(value)), template);
}

function snapshotKey(groupKey: string, user?: string | null) {
    const suffix = user ? `_${user}` : '';
    return `group_task_snapshot_${groupKey}${suffix}`;
}

function remindersKey(groupKey: string, user?: string | null) {
    const suffix = user ? `_${user}` : '';
    return `group_task_deadline_notifications_${groupKey}${suffix}`;
}

function serializeTasks(tasks: GroupTaskView[]): string {
    return JSON.stringify(
        tasks
            .filter((task) => !task.deletedAt)
            .map((task) => ({
                id: task.id,
                title: task.title,
                deadline: task.deadline || null,
                updatedAt: task.updatedAt,
                completed: Boolean(task.completed),
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
    );
}

function parseSnapshot(raw: string | null): Array<{ id: string; title: string; deadline: string | null; updatedAt: string; completed: boolean }> {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function parseReminderSet(raw: string | null): Set<string> {
    if (!raw) return new Set<string>();
    try {
        const parsed = JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
    } catch {
        return new Set<string>();
    }
}

function persistReminderSet(key: string, value: Set<string>) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(Array.from(value).sort()));
}

export function detectAndStoreNewTaskDelta(
    tasks: GroupTaskView[],
    groupKey: string,
    user?: string | null,
): GroupTaskDelta {
    if (typeof window === 'undefined') {
        return { count: 0, sample: null };
    }

    const key = snapshotKey(groupKey, user);
    const previous = parseSnapshot(localStorage.getItem(key));
    const previousIds = new Set(previous.filter((task) => !task.completed).map((task) => task.id));
    const nextActiveTasks = tasks.filter((task) => !task.deletedAt && !task.completed);
    const nextSerialized = serializeTasks(tasks);

    if (previous.length === 0) {
        localStorage.setItem(key, nextSerialized);
        return { count: 0, sample: null };
    }

    const newTasks = nextActiveTasks.filter((task) => !previousIds.has(task.id));
    localStorage.setItem(key, nextSerialized);

    return {
        count: newTasks.length,
        sample: newTasks[0] || null,
    };
}

function getNotificationTimeLabel(threshold: typeof TASK_REMINDER_THRESHOLDS[number]) {
    const messages = getMessages(getNotificationLanguage());
    if (threshold === 60) return messages.time1h;
    if (threshold === 180) return messages.time3h;
    return messages.time24h;
}

export function getDeadlineReminderCandidate(
    tasks: GroupTaskView[],
    groupKey: string,
    user?: string | null,
): { task: GroupTaskView; threshold: typeof TASK_REMINDER_THRESHOLDS[number] } | null {
    if (typeof window === 'undefined') return null;

    const notified = parseReminderSet(localStorage.getItem(remindersKey(groupKey, user)));
    const now = Date.now();

    const upcoming = tasks
        .filter((task) => !task.deletedAt && !task.completed && task.deadline)
        .map((task) => {
            const dueAt = new Date(String(task.deadline)).getTime();
            return { task, dueAt, diffMinutes: (dueAt - now) / 60000 };
        })
        .filter((entry) => Number.isFinite(entry.dueAt) && entry.diffMinutes > 0);

    upcoming.sort((a, b) => a.dueAt - b.dueAt);

    for (const entry of upcoming) {
        const threshold = TASK_REMINDER_THRESHOLDS.find((value) => entry.diffMinutes <= value);
        if (!threshold) continue;
        const reminderId = `${entry.task.id}:${entry.task.deadline}:${threshold}`;
        if (notified.has(reminderId)) continue;
        return { task: entry.task, threshold };
    }

    return null;
}

export function markDeadlineReminderSent(
    groupKey: string,
    task: GroupTaskView,
    threshold: typeof TASK_REMINDER_THRESHOLDS[number],
    user?: string | null,
) {
    if (typeof window === 'undefined') return;
    const key = remindersKey(groupKey, user);
    const notified = parseReminderSet(localStorage.getItem(key));
    notified.add(`${task.id}:${task.deadline}:${threshold}`);
    persistReminderSet(key, notified);
}

async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

    try {
        const existing = await navigator.serviceWorker.getRegistration();
        if (existing?.active) return existing;

        const registered = existing || await navigator.serviceWorker.register('/sw.js');
        if (registered.active) return registered;

        return await navigator.serviceWorker.ready;
    } catch {
        return null;
    }
}

async function showNotification(title: string, options: NotificationOptions): Promise<void> {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') {
        return;
    }

    const registration = await getServiceWorkerRegistration();
    if (registration) {
        try {
            await registration.showNotification(title, options);
            return;
        } catch {
            // Fall back to Notification API.
        }
    }

    new Notification(title, options);
}

export async function showNewTasksNotification(delta: GroupTaskDelta, groupKey: string): Promise<void> {
    if (delta.count <= 0 || !delta.sample) return;
    const messages = getMessages(getNotificationLanguage());
    const sampleTitle = delta.sample.title?.trim() || messages.taskFallback;
    const body = delta.count === 1
        ? formatMessage(messages.newTaskSingle, { title: sampleTitle })
        : formatMessage(messages.newTaskMany, { count: delta.count, title: sampleTitle });

    await showNotification(messages.newTaskTitle, {
        body,
        icon: '/android-chrome-192x192.png',
        badge: '/android-chrome-192x192.png',
        tag: `group-task-new-${groupKey}`,
    });
}

export async function showTaskDeadlineNotification(
    task: GroupTaskView,
    threshold: typeof TASK_REMINDER_THRESHOLDS[number],
    groupKey: string,
): Promise<void> {
    const messages = getMessages(getNotificationLanguage());
    const title = messages.deadlineTitle;
    const body = formatMessage(messages.deadlineBody, {
        title: task.title?.trim() || messages.taskFallback,
        timeLeft: getNotificationTimeLabel(threshold),
    });

    await showNotification(title, {
        body,
        icon: '/android-chrome-192x192.png',
        badge: '/android-chrome-192x192.png',
        tag: `group-task-deadline-${groupKey}-${task.id}-${threshold}`,
    });
}
