/**
 * Академический контекст (текущий семестр / неделя / чётность / активный
 * период) — источник данных Platonus.
 *
 * univer.kstu.kz закрыт навсегда; HTML-парсер academcalendar удалён. Из
 * Platonus в кодовой базе доступны только:
 *   - getCurrentAcademicPeriod()  — текущий учебный год + семестр (та же
 *     функция, что использует парсер расписания, оценки и экзамены);
 *   - approximateSemesterStart()  — расчётный старт семестра, по которому
 *     парсер расписания вычисляет чётность недель (parity num/den);
 *   - fetchCalendarEvents()       — события личного календаря Platonus
 *     (/rest/welcome/calendarEvents/ru: экзамены и т.п.).
 *
 * Границы семестра в Platonus для нового учебного года заведены ненадёжно
 * (startSemesterPeriod отдаёт прошлогодние даты, см. platonus-schedule.ts),
 * поэтому окно семестра здесь — тот же расчёт, что и в парсере расписания.
 * Это важно: неделя/чётность в контексте обязаны совпадать с тем, как была
 * склеена сетка расписания, иначе «числитель/знаменатель» разойдутся.
 *
 * Чего Platonus НЕ даёт (поля остаются null/пустыми, не выдумываем):
 *   - форма обучения, уровень, специальность, год поступления, число
 *     семестров (formOfEducation/educationLevel/specialty/admissionYear/
 *     totalSemesters);
 *   - порядковый номер семестра по учебному плану (currentSemesterNumber) —
 *     без года поступления его не вычислить; фронтенд в этом случае
 *     показывает currentSemesterLabel («2026/2027 — Осенний семестр»);
 *   - подпериоды «теоретическое обучение / рубежный контроль / сессия» с
 *     датами — есть только точечные события календаря (экзамены).
 */

import { getCacheEntry, getCachedData, setCachedData } from '../db/mongo.js';
import {
    fetchCalendarEvents,
    getCurrentAcademicPeriod,
    type PlatonusCalendarEvent,
} from '../parsers/platonus-client.js';
import { approximateSemesterStart } from '../parsers/platonus-schedule.js';
import { forceRefreshSession, getActivePlatonusSession } from './platonus.js';
import {
    classifyPeriod,
    formatDate,
    normalizeText,
    toDate,
    type AcademicCalendarPeriod,
    type AcademicCalendarSemester,
    type AcademicPeriodKind,
    type ParsedAcademicCalendar,
} from './academic-calendar-types.js';

export type {
    AcademicCalendarPeriod,
    AcademicCalendarSemester,
    AcademicPeriodKind,
    ParsedAcademicCalendar,
} from './academic-calendar-types.js';

const ACADEMIC_CONTEXT_TTL = 6 * 60 * 60 * 1000;

export type AcademicContextErrorCode = 'PLATONUS_NOT_CONNECTED' | 'PLATONUS_UPSTREAM_ERROR';

export class AcademicContextError extends Error {
    constructor(message: string, public readonly code: AcademicContextErrorCode) {
        super(message);
        this.name = 'AcademicContextError';
    }
}

export interface AcademicContextResponse {
    source: 'platonus_calendar';
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
    // Within the semester window, an explicit period (an exam day or another
    // Platonus calendar event) wins; a gap between events stays null.
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

// === Platonus → ParsedAcademicCalendar ===

/**
 * Окно семестра (включительно) в терминах учебного года Platonus
 * (`year` = 2026 для 2026-2027, `term` 1 = осенний, 2 = весенний).
 *
 * Старт — approximateSemesterStart() из парсера расписания (1 сентября /
 * 20 января): именно от него считается чётность недель сетки. Конец —
 * по месячной семантике getCurrentAcademicPeriod(): осень длится до дня
 * перед стартом весны (включая зимнюю сессию в январе), весна — до 30 июня;
 * июль–август между семестрами (контекст отдаёт «Каникулы»).
 *
 * Это расчётные границы, а не даты академкалендаря Platonus — тот для
 * текущего года недоступен (см. шапку файла).
 */
export function platonusSemesterWindow(year: number, term: number): { start: Date; end: Date } {
    const start = approximateSemesterStart(year, term);
    if (term === 1) {
        const springStart = approximateSemesterStart(year, 2);
        const end = new Date(springStart);
        end.setDate(end.getDate() - 1);
        return { start, end };
    }
    return { start, end: new Date(year + 1, 5, 30) };
}

export function platonusSemesterTitle(year: number, term: number): string {
    return `${year}/${year + 1} — ${term === 1 ? 'Осенний' : 'Весенний'} семестр`;
}

/** Platonus отдаёт `start`/`end` событий как ms since epoch (число или числовая строка). */
export function toCalendarEventDate(raw: string | number | undefined): Date | null {
    if (raw === undefined || raw === null || raw === '') return null;
    const ms = typeof raw === 'number' ? raw : Number(raw);
    const date = Number.isFinite(ms) ? new Date(ms) : new Date(String(raw));
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Вид периода для события Platonus: сначала по названию (общий словарь с
 * Univer — «экзаменационная сессия», «рубежный контроль», «каникулы»), затем
 * по `type` события (`exam` — единственный тип, который кодовая база
 * использует; см. parsers/grades.ts:resolveCalendarExamDate).
 */
export function classifyCalendarEvent(type: string | undefined, label: string): AcademicPeriodKind {
    const byLabel = classifyPeriod(label);
    if (byLabel !== 'other') return byLabel;

    const normalizedType = (type || '').toLowerCase();
    if (normalizedType === 'exam' || normalizedType.includes('exam')) return 'exams';
    if (normalizedType.includes('holiday') || normalizedType.includes('vacation')) return 'vacation';
    return 'other';
}

export function calendarEventToPeriod(event: PlatonusCalendarEvent): AcademicCalendarPeriod | null {
    const start = toCalendarEventDate(event.start);
    if (!start) return null;
    const end = toCalendarEventDate(event.end) ?? start;

    const label = normalizeText(String(event.title || event.description || '')) || 'Событие Platonus';
    const type = event.type ? String(event.type).trim() : '';

    return {
        label,
        kind: classifyCalendarEvent(type, label),
        // Platonus не отдаёт длительность в неделях — событие точечное.
        weeks: null,
        start: formatDate(start),
        end: formatDate(end < start ? start : end),
        segmentLabel: type ? `Platonus: ${type}` : 'Platonus',
    };
}

/**
 * Собирает ParsedAcademicCalendar из данных Platonus: два семестра текущего
 * учебного года (по getCurrentAcademicPeriod) с расчётными окнами, а внутрь
 * каждого — события календаря Platonus, чья дата начала попадает в окно.
 * События вне обоих окон отбрасываются.
 *
 * Поля, которых у Platonus нет, — null (см. шапку файла).
 */
export function buildPlatonusAcademicCalendar(
    current: { year: number; semester: number },
    events: PlatonusCalendarEvent[] | null
): ParsedAcademicCalendar {
    const eventPeriods = (events || [])
        .map(calendarEventToPeriod)
        .filter((period): period is AcademicCalendarPeriod => period !== null)
        .sort((a, b) => (toDate(a.start)?.getTime() ?? 0) - (toDate(b.start)?.getTime() ?? 0));

    const semesters: AcademicCalendarSemester[] = [1, 2].map((term) => {
        const window = platonusSemesterWindow(current.year, term);
        const periods = eventPeriods.filter((period) => isDateInRange(toDate(period.start)!, window.start, window.end));
        return {
            // Порядковый номер семестра по учебному плану Platonus не отдаёт
            // (нет года поступления) — null, чтобы фронтенд не показал
            // «1 семестр» третьекурснику. Учебный год и term — отдельно.
            semesterNumber: null,
            academicYear: current.year,
            term,
            title: platonusSemesterTitle(current.year, term),
            start: formatDate(window.start),
            end: formatDate(window.end),
            // Длительность семестра в неделях Platonus не отдаёт.
            totalWeeks: null,
            periods,
        };
    });

    return {
        formOfEducation: null,
        educationLevel: null,
        specialty: null,
        totalSemesters: null,
        admissionYear: null,
        semesters,
    };
}

export function buildAcademicContext(userId: string, parsed: ParsedAcademicCalendar, now = new Date()): AcademicContextResponse {
    const semester = pickCurrentSemester(parsed, now);
    const { semesterWeek, activePeriodKind, activePeriodLabel } = resolveActivePeriod(semester, now);
    const cachedAt = now;

    return {
        source: 'platonus_calendar',
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
    const session = await getActivePlatonusSession(userId);
    if (!session) {
        throw new AcademicContextError(
            'Platonus не подключён. Необходимо авторизоваться.',
            'PLATONUS_NOT_CONNECTED'
        );
    }

    // fetchCalendarEvents() глотает ошибки и отдаёт null (в т.ч. при 401 по
    // протухшей сессии) — один retry со свежим логином, как у оценок.
    let events = await fetchCalendarEvents(session);
    if (events === null) {
        console.log(`[Academic Context] Platonus calendar unavailable for ${userId}, force-refreshing session...`);
        const freshSession = await forceRefreshSession(userId);
        if (freshSession) {
            events = await fetchCalendarEvents(freshSession);
        }
    }
    if (events === null) {
        // Семестр/неделя/чётность считаются без календаря; теряются только
        // точечные события (экзамены). Не считаем это фатальной ошибкой.
        console.warn(`[Academic Context] Platonus calendar events unavailable for ${userId}; periods will be empty`);
    }

    const parsed = buildPlatonusAcademicCalendar(getCurrentAcademicPeriod(), events);
    const context = buildAcademicContext(userId, parsed);

    await setCachedData(getCacheKey(userId), context, ACADEMIC_CONTEXT_TTL);
    return context;
}

export async function getAcademicContext(
    userId: string,
    forceRefresh = false
): Promise<{
    context: AcademicContextResponse | null;
    cached: boolean;
    stale?: boolean;
    error?: string;
    errorCode?: AcademicContextErrorCode;
}> {
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
            errorCode: error instanceof AcademicContextError ? error.code : 'PLATONUS_UPSTREAM_ERROR',
        };
    }
}
