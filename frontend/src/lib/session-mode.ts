/**
 * Session-mode helpers.
 *
 * The backend exposes `academicContext.activePeriodKind`. When it equals
 * `exams` or `state_exams`, the user is in exam-session mode and the schedule
 * route should present a session-first experience (header card + exams above
 * the regular class schedule, "Расписание" → "Сессия" in navigation).
 *
 * Period dates from the academic calendar arrive as `DD.MM.YYYY` strings.
 */

import type { AcademicContext, AcademicContextPeriod } from './api';
import type { AppLanguage } from './language-context';

export const EXAM_SESSION_KINDS = ['exams', 'state_exams'] as const;
export type ExamSessionKind = (typeof EXAM_SESSION_KINDS)[number];

export function isExamSessionKind(kind: string | null | undefined): kind is ExamSessionKind {
    return kind === 'exams' || kind === 'state_exams';
}

export function isExamSessionContext(context: AcademicContext | null | undefined): boolean {
    if (!context) return false;
    return isExamSessionKind(context.activePeriodKind);
}

export function parsePeriodDate(value: string | null | undefined): Date | null {
    if (!value || typeof value !== 'string') return null;
    const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
    if (!match) return null;
    const day = Number(match[1]);
    const month = Number(match[2]) - 1;
    const year = Number(match[3]);
    if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
    const date = new Date(year, month, day);
    return Number.isNaN(date.getTime()) ? null : date;
}

function endOfDayMs(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

function startOfDayMs(date: Date): number {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
}

/**
 * Pick the period that matches the active exam-session kind. Prefers a period
 * whose date range contains today, otherwise falls back to the earliest period
 * that has not ended yet, otherwise the first matching period.
 */
export function getActiveSessionPeriod(
    context: AcademicContext | null | undefined,
    nowMs: number = Date.now()
): AcademicContextPeriod | null {
    if (!context) return null;
    const kind = context.activePeriodKind;
    if (!isExamSessionKind(kind)) return null;

    const candidates = (context.periods ?? []).filter((p) => p.kind === kind);
    if (candidates.length === 0) return null;

    const todayStart = startOfDayMs(new Date(nowMs));

    for (const period of candidates) {
        const start = parsePeriodDate(period.start);
        const end = parsePeriodDate(period.end);
        if (!start || !end) continue;
        if (todayStart >= startOfDayMs(start) && todayStart <= endOfDayMs(end)) {
            return period;
        }
    }

    const futureSorted = [...candidates].sort((a, b) => {
        const aEnd = parsePeriodDate(a.end)?.getTime() ?? Number.POSITIVE_INFINITY;
        const bEnd = parsePeriodDate(b.end)?.getTime() ?? Number.POSITIVE_INFINITY;
        return aEnd - bEnd;
    });
    for (const period of futureSorted) {
        const end = parsePeriodDate(period.end);
        if (!end) continue;
        if (endOfDayMs(end) >= todayStart) return period;
    }

    return candidates[0] ?? null;
}

/**
 * Days remaining until the period ends (inclusive of the last day).
 * Returns null if the period or end date can't be parsed, 0 if already past.
 */
export function getSessionDaysRemaining(
    period: AcademicContextPeriod | null | undefined,
    nowMs: number = Date.now()
): number | null {
    if (!period) return null;
    const end = parsePeriodDate(period.end);
    if (!end) return null;
    const diff = endOfDayMs(end) - nowMs;
    if (diff <= 0) return 0;
    return Math.ceil(diff / 86_400_000);
}

/**
 * Abbreviated month names per language, in the genitive case for Russian
 * ("15 мая", not "15 май") so date ranges read naturally. Exported as the
 * single source of truth — SessionPanel reuses this rather than duplicating it.
 */
export const SESSION_MONTHS: Record<AppLanguage, string[]> = {
    ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
    kz: ['қаң', 'ақп', 'нау', 'сәу', 'мам', 'мау', 'шіл', 'там', 'қыр', 'қаз', 'қар', 'жел'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

export function formatSessionDate(
    value: string | null | undefined,
    language: AppLanguage
): string | null {
    const date = parsePeriodDate(value);
    if (!date) return null;
    return `${date.getDate()} ${SESSION_MONTHS[language][date.getMonth()]}`;
}

export function formatSessionRange(
    period: AcademicContextPeriod | null | undefined,
    language: AppLanguage
): string | null {
    if (!period) return null;
    const start = parsePeriodDate(period.start);
    const end = parsePeriodDate(period.end);
    if (!start || !end) return null;
    const months = SESSION_MONTHS[language];
    const startLabel = `${start.getDate()} ${months[start.getMonth()]}`;
    const endLabel = `${end.getDate()} ${months[end.getMonth()]}`;
    if (start.getFullYear() !== end.getFullYear()) {
        return `${startLabel} ${start.getFullYear()} — ${endLabel} ${end.getFullYear()}`;
    }
    return `${startLabel} — ${endLabel} ${end.getFullYear()}`;
}
