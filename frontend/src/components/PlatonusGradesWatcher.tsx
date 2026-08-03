'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { getPlatonusGrades, getPlatonusStatus } from '@/lib/api';
import { getCachedAcademicContext, getPreferredPlatonusSemester } from '@/lib/platonus-semesters';
import { detectAndStoreGradeChanges, showGradesNotification } from '@/lib/platonus-grade-notifications';
import { areNotificationsEnabled } from '@/lib/use-notifications';
import { getClientDebugEnvironment, recordRuntimeTrace } from '@/lib/runtime-debug';

const GRADES_WATCHER_INTERVAL_MS = 10 * 60 * 1000;
const VISIBILITY_RECHECK_MS = 2 * 60 * 1000;

export default function PlatonusGradesWatcher() {
    const { isAuth } = useAuth();
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
            if (document.visibilityState !== 'visible') {
                void recordRuntimeTrace({
                    scope: 'platonus.watcher',
                    event: 'check_skipped',
                    level: 'debug',
                    message: 'Skipped grades watcher because document is hidden',
                    metadata: getClientDebugEnvironment(),
                    throttleKey: 'platonus.watcher:hidden',
                });
                return;
            }
            if (!('Notification' in window) || Notification.permission !== 'granted') {
                void recordRuntimeTrace({
                    scope: 'platonus.watcher',
                    event: 'check_skipped',
                    level: 'debug',
                    message: 'Skipped grades watcher because notification permission is not granted',
                    metadata: getClientDebugEnvironment(),
                    throttleKey: 'platonus.watcher:permission',
                });
                return;
            }

            if (!areNotificationsEnabled()) {
                void recordRuntimeTrace({
                    scope: 'platonus.watcher',
                    event: 'check_skipped',
                    level: 'debug',
                    message: 'Skipped grades watcher because notifications are disabled',
                    metadata: getClientDebugEnvironment(),
                    throttleKey: 'platonus.watcher:disabled',
                });
                return;
            }

            runningRef.current = true;
            try {
                const statusResult = await getPlatonusStatus();
                if (!statusResult.success) {
                    const isAuthOrSessionIssue = statusResult.statusCode === 401 || statusResult.statusCode === 403;
                    const isNetworkIssue = statusResult.statusCode === 0;
                    void recordRuntimeTrace({
                        scope: 'platonus.watcher',
                        event: isAuthOrSessionIssue ? 'status_skipped' : 'status_unavailable',
                        level: isAuthOrSessionIssue ? 'debug' : isNetworkIssue ? 'info' : 'warn',
                        message: isAuthOrSessionIssue
                            ? 'Skipped Platonus watcher because session is unavailable'
                            : 'Platonus watcher could not get connected status',
                        metadata: {
                            ...getClientDebugEnvironment(),
                            success: statusResult.success,
                            statusCode: statusResult.statusCode ?? null,
                            error: statusResult.error ?? null,
                        },
                        throttleKey: isAuthOrSessionIssue
                            ? `platonus.watcher:status_skipped:${statusResult.statusCode ?? 'unknown'}`
                            : `platonus.watcher:status_unavailable:${statusResult.statusCode ?? 'unknown'}`,
                    });
                    return;
                }

                if (!statusResult.data) {
                    void recordRuntimeTrace({
                        scope: 'platonus.watcher',
                        event: 'status_payload_missing',
                        level: 'debug',
                        message: 'Skipped Platonus watcher because status payload is missing',
                        metadata: {
                            ...getClientDebugEnvironment(),
                            success: statusResult.success,
                            statusCode: statusResult.statusCode ?? null,
                        },
                        throttleKey: 'platonus.watcher:status_payload_missing',
                    });
                    return;
                }

                if (!statusResult.data.connected) {
                    void recordRuntimeTrace({
                        scope: 'platonus.watcher',
                        event: 'not_connected',
                        level: 'debug',
                        message: 'Skipped Platonus watcher because account is not connected',
                        metadata: getClientDebugEnvironment(),
                        throttleKey: 'platonus.watcher:not_connected',
                    });
                    return;
                }

                const latestSemester = statusResult.data.availableSemesters?.length
                    ? getPreferredPlatonusSemester(
                        statusResult.data.availableSemesters,
                        getCachedAcademicContext()
                    )
                    : null;
                if (!latestSemester) {
                    void recordRuntimeTrace({
                        scope: 'platonus.watcher',
                        event: 'semester_missing',
                        level: 'warn',
                        message: 'Platonus watcher could not resolve current semester',
                        metadata: getClientDebugEnvironment(),
                        throttleKey: 'platonus.watcher:semester_missing',
                    });
                    return;
                }

                const gradesResult = await getPlatonusGrades(
                    latestSemester.year,
                    latestSemester.semester,
                    true
                );

                if (!gradesResult.success || !gradesResult.data) {
                    const isAuthOrSessionIssue = gradesResult.statusCode === 401 || gradesResult.statusCode === 403;
                    const isNetworkIssue = gradesResult.statusCode === 0;
                    void recordRuntimeTrace({
                        scope: 'platonus.watcher',
                        event: 'grades_unavailable',
                        level: isAuthOrSessionIssue ? 'debug' : isNetworkIssue ? 'info' : 'warn',
                        message: 'Platonus watcher could not load grades',
                        metadata: {
                            ...getClientDebugEnvironment(),
                            year: latestSemester.year,
                            semester: latestSemester.semester,
                            statusCode: gradesResult.statusCode ?? null,
                            error: gradesResult.error ?? null,
                        },
                        throttleKey: `platonus.watcher:grades_unavailable:${latestSemester.year}:${latestSemester.semester}:${gradesResult.statusCode ?? 'unknown'}`,
                    });
                    return;
                }

                const delta = detectAndStoreGradeChanges(
                    gradesResult.data,
                    latestSemester.year,
                    latestSemester.semester,
                    statusResult.data.login || null
                );

                if (delta.count > 0) {
                    await showGradesNotification(delta, latestSemester.year, latestSemester.semester);
                    void recordRuntimeTrace({
                        scope: 'platonus.watcher',
                        event: 'notification_sent',
                        level: 'info',
                        message: `Platonus watcher detected ${delta.count} grade change(s)`,
                        metadata: {
                            ...getClientDebugEnvironment(),
                            year: latestSemester.year,
                            semester: latestSemester.semester,
                            count: delta.count,
                        },
                        throttleKey: `platonus.watcher:delta:${latestSemester.year}:${latestSemester.semester}:${delta.count}`,
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
        }, GRADES_WATCHER_INTERVAL_MS);

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
    }, [isAuth]);

    return null;
}
