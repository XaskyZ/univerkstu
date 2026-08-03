'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import {
    getAcademicContext,
    getExams,
    getPlatonusGrades,
    getPlatonusStatus,
    getProfile,
    getSchedule,
    getUMKD,
    type PlatonusGradesData,
    type PlatonusStatus,
    type AcademicContext,
} from '@/lib/api';
import { CacheKeys, getCacheAge, saveToCache } from '@/lib/cache';
import { hydrateStartupBootstrap } from '@/lib/startup-bootstrap';
import { getCachedAcademicContext, getPreferredPlatonusSemester } from '@/lib/platonus-semesters';
import type { Exams, Schedule, UMKD } from '@/lib/types';
import type { ProfileData } from '@/app/profile/components/types';

const PREFETCH_SESSION_PREFIX = 'startup-prefetch';
const ROUTE_PREFETCHES = ['/schedule', '/grades', '/profile', '/exams', '/umkd'] as const;

function shouldWarm(cacheKey: string, maxAgeMinutes: number): boolean {
    const age = getCacheAge(cacheKey);
    return age === null || age >= maxAgeMinutes;
}

function scheduleIdleTask(task: () => void, delayMs: number): () => void {
    let cancelled = false;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

    timeoutId = window.setTimeout(() => {
        if (cancelled) return;

        if (typeof window.requestIdleCallback === 'function') {
            idleId = window.requestIdleCallback(() => {
                if (!cancelled) task();
            }, { timeout: 1500 });
            return;
        }

        task();
    }, delayMs);

    return () => {
        cancelled = true;
        if (timeoutId !== null) {
            window.clearTimeout(timeoutId);
        }
        if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
            window.cancelIdleCallback(idleId);
        }
    };
}

async function warmSchedule() {
    const result = await getSchedule(false);
    if (result.success && result.data) {
        saveToCache<Schedule>(CacheKeys.SCHEDULE, result.data);
    }
    return result;
}

async function warmAcademicContext() {
    const result = await getAcademicContext(false);
    if (result.success && result.data) {
        saveToCache<AcademicContext>(CacheKeys.ACADEMIC_CONTEXT, result.data);
    }
    return result;
}

async function warmProfile() {
    const result = await getProfile<ProfileData>(false);
    if (result.success && result.data) {
        saveToCache<ProfileData>(CacheKeys.PROFILE, result.data);
    }
    return result;
}

async function warmExams() {
    const result = await getExams(false);
    if (result.success && result.data) {
        saveToCache<Exams>(CacheKeys.EXAMS, result.data);
    }
    return result;
}

async function warmPlatonus() {
    const statusResult = await getPlatonusStatus();
    if (!statusResult.success || !statusResult.data) return;

    saveToCache(CacheKeys.PLATONUS_STATUS, {
        connected: statusResult.data.connected,
        login: statusResult.data.login || null,
        availableSemesters: statusResult.data.availableSemesters || [],
        updatedAt: new Date().toISOString(),
    });

    if (!statusResult.data.connected) return;

    const status = statusResult.data as PlatonusStatus;
    const latestSemester = status.availableSemesters?.length
        ? getPreferredPlatonusSemester(status.availableSemesters, getCachedAcademicContext())
        : null;
    if (!latestSemester) return;

    const gradesResult = await getPlatonusGrades(latestSemester.year, latestSemester.semester, false);
    if (!gradesResult.success || !gradesResult.data) return;

    const grades = gradesResult.data as PlatonusGradesData;
    const gpa = grades.meta.overallGpa || grades.meta.gpa;
    if (typeof gpa === 'number' && gpa > 0) {
        saveToCache(CacheKeys.PLATONUS_GPA, {
            gpa,
            updatedAt: new Date().toISOString(),
        });
    }
    if (grades.meta.groupName) {
        saveToCache(CacheKeys.PLATONUS_GROUP, {
            groupName: grades.meta.groupName,
            updatedAt: new Date().toISOString(),
        });
    }
}

async function warmUmkd() {
    const result = await getUMKD(false);
    if (result.success && result.data) {
        saveToCache<UMKD>(CacheKeys.UMKD, result.data);
    }
    return result;
}

export default function StartupPrefetcher() {
    const { isAuth, loading, userId } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    useEffect(() => {
        if (loading || !isAuth || !userId || typeof window === 'undefined') return;
        if (pathname?.startsWith('/admin')) return;

        const sessionKey = `${PREFETCH_SESSION_PREFIX}:${userId}`;
        if (sessionStorage.getItem(sessionKey) === 'done') return;
        sessionStorage.setItem(sessionKey, 'done');

        const handleReloginRequired = async (result?: { errorCode?: string; statusCode?: number } | null) => {
            if (!result) return false;
            if (result.errorCode !== 'AUTH_RELOGIN_REQUIRED' && result.statusCode !== 401) return false;
            console.warn('[StartupPrefetcher] Background prefetch hit relogin requirement. Keeping local session and cache intact.');
            return true;
        };

        const cleanup: Array<() => void> = [];
        cleanup.push(scheduleIdleTask(() => {
            void hydrateStartupBootstrap(userId).then((result) => {
                void handleReloginRequired(result);
            });
        }, 120));

        ROUTE_PREFETCHES.forEach((route, index) => {
            cleanup.push(scheduleIdleTask(() => {
                router.prefetch(route);
            }, 180 + index * 320));
        });

        if (shouldWarm(CacheKeys.SCHEDULE, 15)) {
            cleanup.push(scheduleIdleTask(() => {
                void warmSchedule().then((result) => {
                    void handleReloginRequired(result);
                });
            }, 400));
        }
        if (shouldWarm(CacheKeys.ACADEMIC_CONTEXT, 120)) {
            cleanup.push(scheduleIdleTask(() => {
                void warmAcademicContext().then((result) => {
                    void handleReloginRequired(result);
                });
            }, 750));
        }
        if (shouldWarm(CacheKeys.PROFILE, 30)) {
            cleanup.push(scheduleIdleTask(() => {
                void warmProfile().then((result) => {
                    void handleReloginRequired(result);
                });
            }, 1100));
        }
        if (shouldWarm(CacheKeys.EXAMS, 30)) {
            cleanup.push(scheduleIdleTask(() => {
                void warmExams().then((result) => {
                    void handleReloginRequired(result);
                });
            }, 1650));
        }
        if (shouldWarm(CacheKeys.PLATONUS_GPA, 20) || shouldWarm(CacheKeys.PLATONUS_GROUP, 20)) {
            cleanup.push(scheduleIdleTask(() => { void warmPlatonus(); }, 2300));
        }
        if (shouldWarm(CacheKeys.UMKD, 180)) {
            cleanup.push(scheduleIdleTask(() => {
                void warmUmkd().then((result) => {
                    void handleReloginRequired(result);
                });
            }, 3300));
        }

        return () => {
            cleanup.forEach((fn) => fn());
        };
    }, [isAuth, loading, pathname, router, userId]);

    return null;
}
