import { useCallback, useEffect, useState, useRef } from 'react';
import { Schedule } from './types';
import { trackAnalyticsEvent } from './analytics';
import { formatMessage, useLanguage } from './language-context';
import { getClientDebugEnvironment, getNotificationCapability, recordRuntimeTrace } from './runtime-debug';
import { isLessonPeriodActive } from '@/app/schedule/utils/lesson-period';
import { getLessonTypeLabel } from '@/app/schedule/utils/lesson-type';

const NOTIFICATION_THRESHOLD_MINUTES = 10;
const CHECK_INTERVAL_MS = 60 * 1000; // Check every minute
export const NOTIFICATIONS_ENABLED_KEY = 'notifications-enabled';

interface NotificationState {
    notifiedLessonIds: Set<string>;
}

type NotificationResult =
    | { success: true }
    | { success: false; reason: 'unsupported' | 'ios_pwa_required' | 'denied' | 'error'; message?: string };

export function areNotificationsEnabled(): boolean {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem(NOTIFICATIONS_ENABLED_KEY) === 'true';
}

export function setNotificationsEnabled(enabled: boolean): void {
    if (typeof window === 'undefined') return;
    localStorage.setItem(NOTIFICATIONS_ENABLED_KEY, String(enabled));
}

export function useNotifications(
    schedule: Schedule | null,
    activeParity?: 'num' | 'den',
    options: {
        watchSchedule?: boolean;
        /**
         * Номер учебной недели семестра (из академ-контекста). Позволяет не
         * слать push о паре, чей период действия («1-8 неделя», «с 01.09 по
         * 15.10») уже закончился или ещё не начался (№10 логик-аудита).
         * null/undefined — недельные периоды не фильтруются (консервативно).
         */
        semesterWeek?: number | null;
    } = {}
) {
    const { messages, language } = useLanguage();
    const stateRef = useRef<NotificationState>({ notifiedLessonIds: new Set() });
    const [enabled, setEnabled] = useState(() => areNotificationsEnabled());
    const [permission, setPermission] = useState<NotificationPermission>(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) return 'default';
        return Notification.permission;
    });
    const watchSchedule = options.watchSchedule ?? true;
    const semesterWeek = options.semesterWeek ?? null;

    const getServiceWorkerRegistration = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;

        try {
            const existing = await navigator.serviceWorker.getRegistration();
            if (existing?.active) return existing;

            const registered = existing || await navigator.serviceWorker.register('/sw.js');
            if (registered.active) return registered;

            // Wait until SW becomes active (first install usually needs a short delay).
            const ready = await navigator.serviceWorker.ready;
            return ready || registered;
        } catch {
            return null;
        }
    }, []);

    const showNotification = useCallback(async (title: string, options: NotificationOptions): Promise<NotificationResult> => {
        try {
            const registration = await getServiceWorkerRegistration();
            if (registration) {
                try {
                    await registration.showNotification(title, options);
                    return { success: true };
                } catch {
                    // Retry once after waiting for active registration.
                    const ready = await navigator.serviceWorker.ready;
                    await ready.showNotification(title, options);
                    return { success: true };
                }
            }

            new Notification(title, options);
            return { success: true };
        } catch (error) {
            const msg = error instanceof Error ? error.message : messages.schedule.notificationBrowserError;
            return { success: false, reason: 'error', message: msg };
        }
    }, [getServiceWorkerRegistration, messages.schedule.notificationBrowserError]);

    // Toggle function
    const toggle = async (): Promise<NotificationResult> => {
        const newState = !enabled;

        const capability = getNotificationCapability();
        if (newState && !capability.supported) {
            void recordRuntimeTrace({
                scope: 'schedule.notifications',
                event: 'toggle_failed',
                level: 'warn',
                message: capability.reason === 'ios_pwa_required'
                    ? 'Failed to enable notifications because iOS requires installed PWA mode'
                    : 'Failed to enable notifications because Notification API is unsupported',
                metadata: capability.environment,
                throttleKey: `schedule.notifications:toggle_failed:${capability.reason || 'unsupported'}`,
            });
            return { success: false, reason: capability.reason || 'unsupported' };
        }

        if (newState && 'Notification' in window) {
            const perm = await Notification.requestPermission();
            setPermission(perm);
            if (perm !== 'granted') {
                void recordRuntimeTrace({
                    scope: 'schedule.notifications',
                    event: 'toggle_denied',
                    level: 'warn',
                    message: `Notification enable request resolved with permission=${perm}`,
                    metadata: getClientDebugEnvironment(),
                    throttleKey: `schedule.notifications:toggle_denied:${perm}`,
                });
                return { success: false, reason: 'denied' }; // Don't enable if denied
            }
        }

        setEnabled(newState);
        setNotificationsEnabled(newState);
        trackAnalyticsEvent('cta_click', {
            feature: 'notifications',
            label: 'toggle',
            status: newState ? 'enabled' : 'disabled',
        });
        void recordRuntimeTrace({
            scope: 'schedule.notifications',
            event: 'toggle',
            level: 'info',
            message: `Notifications ${newState ? 'enabled' : 'disabled'} by user`,
            metadata: getClientDebugEnvironment(),
            throttleKey: `schedule.notifications:toggle:${newState ? 'on' : 'off'}`,
            throttleMs: 2_000,
        });
        return { success: true };
    };

    const sendTestNotification = async (): Promise<NotificationResult> => {
        const capability = getNotificationCapability();
        if (!capability.supported) {
            void recordRuntimeTrace({
                scope: 'schedule.notifications',
                event: 'test_failed',
                level: 'warn',
                message: capability.reason === 'ios_pwa_required'
                    ? 'Test notification failed because iOS requires installed PWA mode'
                    : 'Test notification failed because Notification API is unsupported',
                metadata: capability.environment,
                throttleKey: `schedule.notifications:test_failed:${capability.reason || 'unsupported'}`,
            });
            return { success: false, reason: capability.reason || 'unsupported' };
        }

        let perm = Notification.permission;
        if (perm !== 'granted') {
            perm = await Notification.requestPermission();
            setPermission(perm);
        }

        if (perm !== 'granted') {
            void recordRuntimeTrace({
                scope: 'schedule.notifications',
                event: 'test_denied',
                level: 'warn',
                message: `Test notification blocked because permission=${perm}`,
                metadata: getClientDebugEnvironment(),
                throttleKey: `schedule.notifications:test_denied:${perm}`,
            });
            return { success: false, reason: 'denied' };
        }

        const result = await showNotification(messages.schedule.testNotificationTitle, {
            body: messages.schedule.testNotificationBody,
            icon: '/android-chrome-192x192.png',
            badge: '/android-chrome-192x192.png',
            tag: 'manual-notification-test',
        });
        trackAnalyticsEvent('cta_click', {
            feature: 'notifications',
            label: 'send_test',
            status: result.success ? 'success' : 'failed',
        });
        void recordRuntimeTrace({
            scope: 'schedule.notifications',
            event: result.success ? 'test_sent' : 'test_failed',
            level: result.success ? 'info' : 'warn',
            message: result.success ? 'Test notification sent' : `Test notification failed: ${result.message || result.reason}`,
            metadata: getClientDebugEnvironment(),
            throttleKey: result.success ? 'schedule.notifications:test_sent' : `schedule.notifications:test_failed:${result.reason}`,
            throttleMs: 2_000,
        });
        return result;
    };

    // Check for upcoming lessons
    useEffect(() => {
        if (!watchSchedule) return;
        if (!schedule || !enabled || permission !== 'granted') {
            if (!schedule) {
                void recordRuntimeTrace({
                    scope: 'schedule.notifications',
                    event: 'watcher_inactive',
                    level: 'debug',
                    message: 'Notification watcher inactive because schedule is missing',
                    metadata: getClientDebugEnvironment(),
                    throttleKey: 'schedule.notifications:missing_schedule',
                });
            } else if (!enabled) {
                void recordRuntimeTrace({
                    scope: 'schedule.notifications',
                    event: 'watcher_inactive',
                    level: 'debug',
                    message: 'Notification watcher inactive because notifications are disabled',
                    metadata: getClientDebugEnvironment(),
                    throttleKey: 'schedule.notifications:disabled',
                });
            } else {
                void recordRuntimeTrace({
                    scope: 'schedule.notifications',
                    event: 'watcher_inactive',
                    level: 'debug',
                    message: `Notification watcher inactive because permission is ${permission}`,
                    metadata: { ...getClientDebugEnvironment(), permission },
                    throttleKey: `schedule.notifications:permission:${permission}`,
                });
            }
            return;
        }

        const checkLessons = () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
                void recordRuntimeTrace({
                    scope: 'schedule.notifications',
                    event: 'check_skipped',
                    level: 'debug',
                    message: 'Skipped notification check because document is hidden',
                    metadata: getClientDebugEnvironment(),
                    throttleKey: 'schedule.notifications:hidden',
                });
                return;
            }
            const now = new Date();
            const currentDayIndex = (now.getDay() === 0 ? 6 : now.getDay() - 1); // 0=Mon, 6=Sun
            const daysMap = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
            const currentDayKey = daysMap[currentDayIndex];

            // Find today's schedule
            const todaySchedule = schedule.days.find(d => d.name === currentDayKey);
            if (!todaySchedule) {
                void recordRuntimeTrace({
                    scope: 'schedule.notifications',
                    event: 'day_missing',
                    level: 'warn',
                    message: `No schedule found for current day ${currentDayKey}`,
                    metadata: { ...getClientDebugEnvironment(), currentDayKey },
                    throttleKey: `schedule.notifications:day_missing:${currentDayKey}`,
                });
                return;
            }

            let upcomingLessons = 0;
            let sentNotifications = 0;

            schedule.timeSlots.forEach((slot, index) => {
                const lessons = todaySchedule.lessons[index];
                if (!lessons || lessons.length === 0) return;
                const filteredLessons = lessons.filter((lesson) =>
                    (!activeParity || lesson.parity === 'all' || lesson.parity === activeParity)
                    // №10: пара вне своего периода действия не должна
                    // генерировать push-уведомление.
                    && isLessonPeriodActive(lesson.period, { now, semesterWeek }));
                if (filteredLessons.length === 0) return;

                // Parse start time (HH:MM)
                const [h, m] = slot.start.split(':').map(Number);
                const lessonStart = new Date();
                lessonStart.setHours(h, m, 0, 0);

                const diffMs = lessonStart.getTime() - now.getTime();
                const diffMinutes = diffMs / (1000 * 60);

                // Notify if within threshold (e.g. 0-10 mins before)
                if (diffMinutes > 0 && diffMinutes <= NOTIFICATION_THRESHOLD_MINUTES) {
                    filteredLessons.forEach((lesson) => {
                        upcomingLessons += 1;
                        const lessonId = `${currentDayKey}-${index}-${lesson.parity}-${lesson.title}`;

                        if (!stateRef.current.notifiedLessonIds.has(lessonId)) {
                            void showNotification(messages.schedule.upcomingLessonTitle, {
                                body: formatMessage(messages.schedule.upcomingLessonBody, {
                                    title: lesson.title,
                                    // Never surface the raw portal code («л», «спз») in a push —
                                    // resolve it to the same label the schedule card shows.
                                    type: getLessonTypeLabel(lesson.type, language, messages.schedule.lessonFallbackType)
                                        || messages.schedule.lessonFallbackType,
                                    minutes: Math.ceil(diffMinutes),
                                    room: lesson.room || messages.schedule.roomNotSpecified,
                                }),
                                icon: '/android-chrome-192x192.png',
                                badge: '/android-chrome-192x192.png',
                                tag: lessonId
                            });

                            stateRef.current.notifiedLessonIds.add(lessonId);
                            sentNotifications += 1;
                        }
                    });
                }
            });

            void recordRuntimeTrace({
                scope: 'schedule.notifications',
                event: 'check_completed',
                level: upcomingLessons > 0 ? 'info' : 'debug',
                message: upcomingLessons > 0
                    ? `Notification check found ${upcomingLessons} upcoming lesson(s) and sent ${sentNotifications}`
                    : 'Notification check completed without upcoming lessons',
                metadata: {
                    ...getClientDebugEnvironment(),
                    currentDayKey,
                    activeParity: activeParity || null,
                    permission,
                    enabled,
                    upcomingLessons,
                    sentNotifications,
                },
                throttleKey: upcomingLessons > 0
                    ? `schedule.notifications:upcoming:${currentDayKey}:${activeParity || 'all'}:${upcomingLessons}:${sentNotifications}`
                    : `schedule.notifications:none:${currentDayKey}:${activeParity || 'all'}`,
                throttleMs: upcomingLessons > 0 ? 5_000 : 60_000,
            });
        };

        const interval = setInterval(checkLessons, CHECK_INTERVAL_MS);
        const handleResumeCheck = () => {
            if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
            void recordRuntimeTrace({
                scope: 'schedule.notifications',
                event: 'resume_check',
                level: 'debug',
                message: 'Triggered notification check after app became active again',
                metadata: getClientDebugEnvironment(),
                throttleKey: 'schedule.notifications:resume_check',
                throttleMs: 5_000,
            });
            checkLessons();
        };

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleResumeCheck);
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('focus', handleResumeCheck);
            window.addEventListener('pageshow', handleResumeCheck);
        }

        checkLessons(); // Initial check

        return () => {
            clearInterval(interval);
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleResumeCheck);
            }
            if (typeof window !== 'undefined') {
                window.removeEventListener('focus', handleResumeCheck);
                window.removeEventListener('pageshow', handleResumeCheck);
            }
        };
    }, [
        enabled,
        activeParity,
        language,
        messages.schedule.lessonFallbackType,
        messages.schedule.roomNotSpecified,
        messages.schedule.upcomingLessonBody,
        messages.schedule.upcomingLessonTitle,
        permission,
        schedule,
        semesterWeek,
        showNotification,
        watchSchedule,
    ]);

    return { enabled, toggle, permission, sendTestNotification };
}
