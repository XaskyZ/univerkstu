import { getCacheEntry, getCachedData, setCachedData } from '../db/mongo.js';
import { parseAcademicCalendar, ParsedAcademicCalendar, toDate, type AcademicCalendarPeriod, type AcademicCalendarSemester } from '../parsers/academic-calendar.js';
import { login, switchToRussian } from '../parsers/http-client.js';
import { getUserPassword } from './users.js';

const ACADEMIC_CONTEXT_TTL = 6 * 60 * 60 * 1000;

export interface AcademicContextResponse {
    source: 'univer_academic_calendar';
    userId: string;
    formOfEducation: string | null;
    educationLevel: string | null;
    specialty: string | null;
    totalSemesters: number | null;
    admissionYear: number | null;
    currentSemesterNumber: number | null;
    currentSemesterLabel: string | null;
    semesterStart: string | null;
    semesterEnd: string | null;
    semesterWeek: number | null;
    weekLabel: string | null;
    weekParity: 'num' | 'den' | null;
    activePeriodLabel: string | null;
    activePeriodKind: string | null;
    periods: AcademicCalendarPeriod[];
    semesters: ParsedAcademicCalendar['semesters'];
    cachedAt: string;
    expiresAt: string;
}

function getCacheKey(userId: string): string {
    return `academic_context_${userId}`;
}

export function startOfToday(now = new Date()): Date {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function daysBetween(start: Date, end: Date): number {
    const ms = startOfToday(end).getTime() - startOfToday(start).getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/** Monday (start-of-day) of the week containing `date`. */
export function mondayOf(date: Date): Date {
    const result = startOfToday(date);
    const offset = (result.getDay() + 6) % 7; // Mon=0 … Sun=6
    result.setDate(result.getDate() - offset);
    return result;
}

export function isDateInRange(date: Date, start: Date | null, end: Date | null): boolean {
    if (!start || !end) return false;
    const current = startOfToday(date).getTime();
    return current >= startOfToday(start).getTime() && current <= startOfToday(end).getTime();
}

export function buildWeekLabel(semesterWeek: number | null): string | null {
    if (!semesterWeek || semesterWeek < 1) return null;
    return `${semesterWeek}-я неделя`;
}

export function pickActivePeriod(periods: AcademicCalendarPeriod[], now: Date): AcademicCalendarPeriod | null {
    const activePeriods = periods.filter((period) => isDateInRange(now, toDate(period.start), toDate(period.end)));
    if (activePeriods.length === 0) return null;

    const specific = activePeriods.find((period) => period.kind !== 'semester');
    return specific || activePeriods[0];
}

export interface ActivePeriodResolution {
    /** True only when `now` falls inside the picked semester's date range. */
    semesterIsCurrent: boolean;
    semesterWeek: number | null;
    activePeriodKind: string | null;
    activePeriodLabel: string | null;
}

/**
 * Decide the active period + week number for the picked semester.
 *
 * `pickCurrentSemester` falls back to the nearest *future* semester (or the
 * last one) when today is outside every semester window. Computing a week
 * number against that fallback used to fabricate a bogus "1-я неделя" during
 * breaks (negative day-diff clamped to 1) or a huge week number after the last
 * semester. So: only compute a week number when the semester actually contains
 * today; otherwise we're on a break between semesters and surface that as a
 * `vacation` period instead.
 */
export function resolveActivePeriod(
    semester: AcademicCalendarSemester | null,
    now: Date
): ActivePeriodResolution {
    const start = toDate(semester?.start ?? null);
    const end = toDate(semester?.end ?? null);
    const semesterIsCurrent = isDateInRange(now, start, end);

    if (!semesterIsCurrent) {
        return {
            semesterIsCurrent: false,
            semesterWeek: null,
            activePeriodKind: 'vacation',
            activePeriodLabel: 'Каникулы',
        };
    }

    // Week boundaries follow the university grid (Monday-based), not the raw
    // semester start date. If the semester starts mid-week (e.g. Wednesday),
    // the whole partial first week is week 1, and week 2 begins on the next
    // Monday — otherwise week number/parity would flip mid-week every week.
    const semesterWeek = start
        ? Math.max(1, Math.floor(daysBetween(mondayOf(start), mondayOf(now)) / 7) + 1)
        : null;
    // Within the semester window, an explicit period (theory/exams/practice and,
    // now, an in-semester "Каникулы") wins; a gap between sub-periods stays null.
    const activePeriod = semester ? pickActivePeriod(semester.periods, now) : null;
    return {
        semesterIsCurrent: true,
        semesterWeek,
        activePeriodKind: activePeriod?.kind ?? null,
        activePeriodLabel: activePeriod?.label ?? null,
    };
}

export function pickCurrentSemester(parsed: ParsedAcademicCalendar, now: Date) {
    const today = startOfToday(now);

    for (const semester of parsed.semesters) {
        const start = toDate(semester.start);
        const end = toDate(semester.end);
        if (isDateInRange(today, start, end)) {
            return semester;
        }
    }

    const future = parsed.semesters
        .map((semester) => ({
            semester,
            start: toDate(semester.start),
        }))
        .filter((item): item is { semester: ParsedAcademicCalendar['semesters'][number]; start: Date } => Boolean(item.start))
        .filter((item) => item.start.getTime() >= today.getTime())
        .sort((a, b) => a.start.getTime() - b.start.getTime());

    if (future.length > 0) {
        return future[0].semester;
    }

    return parsed.semesters[parsed.semesters.length - 1] || null;
}

function buildAcademicContext(userId: string, parsed: ParsedAcademicCalendar, now = new Date()): AcademicContextResponse {
    const semester = pickCurrentSemester(parsed, now);
    const { semesterWeek, activePeriodKind, activePeriodLabel } = resolveActivePeriod(semester, now);
    const cachedAt = now;

    return {
        source: 'univer_academic_calendar',
        userId,
        formOfEducation: parsed.formOfEducation,
        educationLevel: parsed.educationLevel,
        specialty: parsed.specialty,
        totalSemesters: parsed.totalSemesters,
        admissionYear: parsed.admissionYear,
        currentSemesterNumber: semester?.semesterNumber ?? null,
        currentSemesterLabel: semester?.title ?? null,
        semesterStart: semester?.start ?? null,
        semesterEnd: semester?.end ?? null,
        semesterWeek,
        weekLabel: buildWeekLabel(semesterWeek),
        weekParity: semesterWeek ? (semesterWeek % 2 === 0 ? 'den' : 'num') : null,
        activePeriodLabel,
        activePeriodKind,
        periods: semester?.periods ?? [],
        semesters: parsed.semesters,
        cachedAt: cachedAt.toISOString(),
        expiresAt: new Date(cachedAt.getTime() + ACADEMIC_CONTEXT_TTL).toISOString(),
    };
}

async function fetchAcademicContext(userId: string): Promise<AcademicContextResponse> {
    const password = await getUserPassword(userId);
    if (!password) {
        throw new Error('Пользователь не найден');
    }

    const cookies = await login(userId, password);
    if (!cookies) {
        throw new Error('Ошибка авторизации Univer');
    }

    const russianCookies = await switchToRussian(cookies);
    const parsed = await parseAcademicCalendar(russianCookies);
    const context = buildAcademicContext(userId, parsed);

    await setCachedData(getCacheKey(userId), context, ACADEMIC_CONTEXT_TTL);
    return context;
}

export async function getAcademicContext(
    userId: string,
    forceRefresh = false
): Promise<{ context: AcademicContextResponse | null; cached: boolean; stale?: boolean; error?: string }> {
    const cacheKey = getCacheKey(userId);

    if (!forceRefresh) {
        const cached = await getCachedData<AcademicContextResponse>(cacheKey);
        if (cached) {
            return { context: cached, cached: true };
        }
    }

    if (!forceRefresh) {
        const staleEntry = await getCacheEntry<AcademicContextResponse>(cacheKey);
        if (staleEntry?.data) {
            void fetchAcademicContext(userId).catch((error) => {
                console.error(`[Academic Context] Background refresh failed for ${userId}:`, error);
            });
            return { context: staleEntry.data, cached: true, stale: true };
        }
    }

    try {
        const context = await fetchAcademicContext(userId);
        return { context, cached: false };
    } catch (error) {
        return {
            context: null,
            cached: false,
            error: error instanceof Error ? error.message : 'Не удалось получить академический контекст',
        };
    }
}
