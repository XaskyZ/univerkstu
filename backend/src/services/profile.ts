/**
 * Profile Service - профиль студента.
 *
 * univer.kstu.kz отключён навсегда. HTML-разделы профиля (анкета, ИУП,
 * аттестация, транскрипт, зачётка, практика, эдвайзер, учебный план,
 * академические опции) больше ниоткуда не приходят и никогда не запрашиваются.
 *
 * Сервис:
 *   1. отдаёт ранее сохранённый (legacy) кэш `profile_<userId>`, даже если он
 *      формально просрочен — пересобрать его невозможно, поэтому при отдаче
 *      срок хранения продлевается;
 *   2. дополняет его тем, что умеет отдать Platonus существующим клиентом:
 *      GPA/группа из транскрипта (fetchTranscriptGPA), список семестров
 *      (fetchAvailableSemesters), personID сессии;
 *   3. если legacy-кэша нет — разделы отдаются как null с `source: 'platonus'`
 *      и `errorCode: PROFILE_SOURCE_UNAVAILABLE`.
 */

import { getCacheEntry, setCachedData } from '../db/mongo.js';
import {
    fetchAvailableSemesters,
    fetchTranscriptGPA,
    type PlatonusSemesterOption,
    type PlatonusSession,
} from '../parsers/platonus-client.js';
import { forceRefreshSession, getActivePlatonusSession } from './platonus.js';
import type {
    Attestation,
    IUP,
    StudentAcademicOptions,
    StudentAdvisor,
    StudentEducPlan,
    StudentPractice,
    StudentProfile,
    StudentRecbook,
    StudentTranscript,
} from '../types/profile.js';

/**
 * Legacy-разделы нельзя получить заново, поэтому храним их долго. Раньше TTL был
 * 24 часа — ровно столько «жил» профиль до следующего парсинга Univer.
 */
export const PROFILE_CACHE_TTL = 365 * 24 * 60 * 60 * 1000;

/** Код ошибки: источник профиля (univer.kstu.kz) отключён, legacy-разделы недоступны. */
export const PROFILE_SOURCE_UNAVAILABLE = 'PROFILE_SOURCE_UNAVAILABLE';
export const PROFILE_SOURCE_UNAVAILABLE_MESSAGE =
    'Источник профиля univer.kstu.kz отключён. Доступны только данные Platonus и ранее сохранённый профиль.';

export type ProfileSource = 'platonus' | 'cache';
export type PlatonusProfileStatus = 'ok' | 'not_connected' | 'unavailable';

export type LegacyProfileSection =
    | 'profile'
    | 'iup'
    | 'attestation'
    | 'transcript'
    | 'recbook'
    | 'practice'
    | 'advisor'
    | 'educPlan'
    | 'academicOptions';

export const LEGACY_PROFILE_SECTIONS: readonly LegacyProfileSection[] = [
    'profile',
    'iup',
    'attestation',
    'transcript',
    'recbook',
    'practice',
    'advisor',
    'educPlan',
    'academicOptions',
];

/** То, что Platonus отдаёт существующим клиентом (без новых эндпоинтов). */
export interface PlatonusProfileSummary {
    personID: string | null;
    gpa: number | null;
    overallGpa: number | null;
    groupName: string | null;
    termGpaMap: Record<string, number>;
    courseGpaMap: Record<string, number>;
    semesters: PlatonusSemesterOption[];
    fetchedAt: string;
}

export interface LegacyProfileSections {
    profile: StudentProfile | null;
    iup: IUP | null;
    attestation: Attestation | null;
    transcript: StudentTranscript | null;
    recbook: StudentRecbook | null;
    practice: StudentPractice | null;
    advisor: StudentAdvisor | null;
    educPlan: StudentEducPlan | null;
    academicOptions: StudentAcademicOptions | null;
}

export interface FullProfile extends LegacyProfileSections {
    /** Откуда взяты legacy-разделы: 'cache' — сохранённый профиль, 'platonus' — их нет. */
    source: ProfileSource;
    platonus: PlatonusProfileSummary | null;
    platonusStatus: PlatonusProfileStatus;
    /** Legacy-разделы, которых нет ни в кэше, ни в Platonus. */
    unavailableSections: LegacyProfileSection[];
    errorCode?: typeof PROFILE_SOURCE_UNAVAILABLE;
    message?: string;
    meta: {
        parsedAt: string;
        userId: string;
    };
    cachedAt: string;
    expiresAt: string;
}

function profileCacheKey(userId: string): string {
    return `profile_${userId}`;
}

function pickLegacySections(cached: Partial<LegacyProfileSections> | null | undefined): LegacyProfileSections {
    const sections = {} as LegacyProfileSections;
    for (const key of LEGACY_PROFILE_SECTIONS) {
        const value = cached?.[key];
        (sections as Record<LegacyProfileSection, unknown>)[key] = value === undefined ? null : value;
    }
    return sections;
}

export function listUnavailableSections(sections: Partial<LegacyProfileSections> | null | undefined): LegacyProfileSection[] {
    return LEGACY_PROFILE_SECTIONS.filter((key) => sections?.[key] === null || sections?.[key] === undefined);
}

function hasAnyLegacySection(sections: LegacyProfileSections): boolean {
    return listUnavailableSections(sections).length < LEGACY_PROFILE_SECTIONS.length;
}

function isFullProfileShape(value: unknown): value is FullProfile {
    return Boolean(value)
        && typeof value === 'object'
        && typeof (value as FullProfile).source === 'string'
        && typeof (value as FullProfile).platonusStatus === 'string';
}

async function fetchTranscriptWithRetry(userId: string, session: PlatonusSession) {
    const first = await fetchTranscriptGPA(session);
    if (first) return { transcript: first, session };

    // Тот же приём, что и в platonus-grades: TTL сессии ещё «валиден», а
    // Platonus уже отвечает 401 — перелогиниваемся один раз.
    const refreshed = await forceRefreshSession(userId);
    if (!refreshed) return { transcript: null, session };
    return { transcript: await fetchTranscriptGPA(refreshed), session: refreshed };
}

/**
 * Сводка из Platonus. Никогда не бросает: любая проблема → status 'unavailable'.
 */
export async function loadPlatonusProfileSummary(userId: string): Promise<{
    status: PlatonusProfileStatus;
    summary: PlatonusProfileSummary | null;
}> {
    try {
        const session = await getActivePlatonusSession(userId);
        if (!session) {
            return { status: 'not_connected', summary: null };
        }

        const { transcript, session: activeSession } = await fetchTranscriptWithRetry(userId, session);
        const semesters = await fetchAvailableSemesters(activeSession);

        if (!transcript && !semesters) {
            return { status: 'unavailable', summary: null };
        }

        return {
            status: 'ok',
            summary: {
                personID: activeSession.personID || null,
                gpa: transcript?.gpa ?? null,
                overallGpa: transcript?.overallGpa ?? null,
                groupName: transcript?.groupName ?? null,
                termGpaMap: transcript?.termGpaMap ?? {},
                courseGpaMap: transcript?.courseGpaMap ?? {},
                semesters: semesters ?? [],
                fetchedAt: new Date().toISOString(),
            },
        };
    } catch (error) {
        console.error(`[Profile] Platonus summary failed for ${userId}:`, error);
        return { status: 'unavailable', summary: null };
    }
}

/**
 * Получить профиль.
 *
 * - без forceRefresh и при свежем кэше нового формата — отдаём кэш как есть;
 * - иначе берём legacy-разделы из любого сохранённого кэша (даже просроченного),
 *   дозапрашиваем сводку Platonus и сохраняем объединённый результат.
 */
export async function getProfile(userId: string, forceRefresh = false): Promise<FullProfile> {
    const cacheKey = profileCacheKey(userId);
    const entry = await getCacheEntry<Partial<FullProfile>>(cacheKey);
    const cached = entry?.data ?? null;
    const cacheIsFresh = Boolean(entry && entry.expiresAt.getTime() > Date.now());

    if (!forceRefresh && cacheIsFresh && isFullProfileShape(cached)) {
        console.log(`[Profile] Cache hit for ${userId}`);
        return {
            ...cached,
            ...pickLegacySections(cached),
            unavailableSections: listUnavailableSections(cached),
        };
    }

    const legacy = pickLegacySections(cached);
    const hasLegacy = hasAnyLegacySection(legacy);
    console.log(`[Profile] Building profile for ${userId} (legacy cache: ${hasLegacy ? 'yes' : 'no'}, refresh=${forceRefresh})`);

    const platonus = await loadPlatonusProfileSummary(userId);
    // Если Platonus сейчас недоступен, не теряем прошлую сводку.
    const previousSummary = isFullProfileShape(cached) ? cached.platonus : null;
    const summary = platonus.summary ?? previousSummary;

    const now = new Date();
    const unavailableSections = listUnavailableSections(legacy);
    const result: FullProfile = {
        ...legacy,
        source: hasLegacy ? 'cache' : 'platonus',
        platonus: summary,
        platonusStatus: platonus.status,
        unavailableSections,
        ...(unavailableSections.length > 0
            ? { errorCode: PROFILE_SOURCE_UNAVAILABLE, message: PROFILE_SOURCE_UNAVAILABLE_MESSAGE }
            : {}),
        meta: {
            parsedAt: now.toISOString(),
            userId,
        },
        cachedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + PROFILE_CACHE_TTL).toISOString(),
    };

    try {
        await setCachedData(cacheKey, result, PROFILE_CACHE_TTL);
    } catch (error) {
        console.error(`[Profile] Cache write failed for ${userId}:`, error);
    }

    console.log(`[Profile] Profile ready for ${userId}: source=${result.source}, platonus=${result.platonusStatus}`);
    return result;
}
