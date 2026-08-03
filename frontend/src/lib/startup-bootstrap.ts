'use client';

import {
    getAppBootstrap,
    type AppBootstrapData,
    type AppBootstrapPlatonusSummary,
    type AppBootstrapProfileSummary,
} from '@/lib/api';
import {
    CacheKeys,
    getStartupBootstrapMeta,
    hasRecentStartupBootstrapBlock,
    saveStartupBootstrapMeta,
    saveToCache,
} from '@/lib/cache';
import type { Exams, Schedule } from '@/lib/types';

const RECENT_BOOTSTRAP_WINDOW_MS = 15_000;
const LANGUAGE_STORAGE_KEY = 'app-language';

function getBootstrapFallbackMessage(): string {
    if (typeof window === 'undefined') return 'Не удалось загрузить startup bootstrap';
    const language = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (language === 'en') return 'Failed to load startup bootstrap';
    if (language === 'kz') return 'Startup bootstrap жүктеу мүмкін болмады';
    return 'Не удалось загрузить startup bootstrap';
}

export function hasRecentStartupBootstrap(maxAgeMs = RECENT_BOOTSTRAP_WINDOW_MS): boolean {
    const meta = getStartupBootstrapMeta();
    if (!meta) return false;
    return Date.now() - meta.hydratedAt <= maxAgeMs;
}

export function shouldSkipBootstrapRevalidate(
    block: 'schedule' | 'exams' | 'profileSummary' | 'platonusSummary',
    maxAgeMs = RECENT_BOOTSTRAP_WINDOW_MS
): boolean {
    return hasRecentStartupBootstrapBlock(block, maxAgeMs);
}

function persistProfileSummary(summary: AppBootstrapProfileSummary | undefined): void {
    if (!summary) return;
    saveToCache(CacheKeys.PROFILE_SUMMARY, summary);
}

function formatBootstrapSemesterLabel(year: number, semester: number): string {
    return `${year}/${year + 1} — ${semester === 1 ? 'Осенний' : 'Весенний'}`;
}

function persistPlatonusSummary(summary: AppBootstrapPlatonusSummary | undefined, issuedAt: string): void {
    if (!summary) return;

    const availableSemesters = (summary.availableSemesters || [])
        .map((semester) => ({
            year: semester.year,
            semester: semester.semester,
            label: formatBootstrapSemesterLabel(semester.year, semester.semester),
        }));

    saveToCache(CacheKeys.PLATONUS_STATUS, {
        connected: summary.connected,
        login: summary.login || null,
        availableSemesters,
        preferredSemester: summary.preferredSemester || summary.latestSemester || null,
        updatedAt: issuedAt,
    });

    if (typeof summary.gpa === 'number' && summary.gpa > 0) {
        saveToCache(CacheKeys.PLATONUS_GPA, {
            gpa: summary.gpa,
            updatedAt: issuedAt,
        });
    }

    if (summary.groupName) {
        saveToCache(CacheKeys.PLATONUS_GROUP, {
            groupName: summary.groupName,
            updatedAt: issuedAt,
        });
    }
}

export async function hydrateStartupBootstrap(
    userId?: string | null,
    options: { force?: boolean } = {}
): Promise<{
    success: boolean;
    data?: AppBootstrapData;
    skipped?: boolean;
    error?: string;
    errorCode?: string;
    statusCode?: number;
}> {
    const existingMeta = getStartupBootstrapMeta();
    if (
        !options.force
        && existingMeta
        && (!userId || existingMeta.userId === userId)
        && Date.now() - existingMeta.hydratedAt <= RECENT_BOOTSTRAP_WINDOW_MS
    ) {
        return { success: true, skipped: true };
    }

    const result = await getAppBootstrap();
    if (!result.success || !result.data) {
        return {
            success: false,
            error: result.error || getBootstrapFallbackMessage(),
            errorCode: result.errorCode,
            statusCode: result.statusCode,
        };
    }

    const payload = result.data;

    if (payload.schedule) {
        saveToCache<Schedule>(CacheKeys.SCHEDULE, payload.schedule);
    }

    if (payload.exams) {
        saveToCache<Exams>(CacheKeys.EXAMS, payload.exams);
    }

    persistProfileSummary(payload.profileSummary);

    persistPlatonusSummary(payload.platonusSummary, payload.issuedAt);

    saveStartupBootstrapMeta({
        userId: payload.user.userId,
        hydratedAt: Date.now(),
        issuedAt: payload.issuedAt,
        freshness: payload.freshness,
    });

    return {
        success: true,
        data: payload,
    };
}
