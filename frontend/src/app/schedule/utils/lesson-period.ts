/**
 * Formats `Lesson.period` (the raw `.dateStartLbl` value coming from the KSTU
 * schedule parser) into a small chip-friendly label.
 *
 * KSTU emits a few common shapes here:
 *   - "с 01.09 по 15.10"   — dotted date range
 *   - "1-8 неделя"          — week range
 *   - "all" / "" / null     — no restriction (whole semester)
 *
 * The "all" sentinel means "no restriction" — we hide the chip in that case so
 * we don't visually clutter every single lesson. Anything else gets shown.
 *
 * Returns `null` when nothing meaningful is available; otherwise returns a
 * `{ label, title }` pair where `label` is short text suitable for a chip and
 * `title` is a longer string for the native tooltip.
 */
type Lang = 'ru' | 'kz' | 'en';

export interface LessonPeriodLabel {
    label: string;
    title: string;
}

const ALL_SENTINELS = new Set(['all', '*', '-', '–', '—']);

function compactWeekRange(raw: string, language: Lang): string | null {
    // Match patterns like "1-8 неделя", "1-8 нед", "1 - 15 week".
    const match = raw.match(/(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*(нед|апта|week|w)/i);
    if (!match) return null;
    const [, a, b] = match;
    const suffix = language === 'en' ? 'wk' : language === 'kz' ? 'апта' : 'нед.';
    return `${a}–${b} ${suffix}`;
}

function compactDateRange(raw: string): string | null {
    // Match "с 01.09 по 15.10" or "01.09 - 15.10" or "01.09.2024 - 15.10.2024".
    const match = raw.match(/(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)\s*(?:[-–—]|по|до)\s*(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)/i);
    if (!match) return null;
    const trim = (s: string) => s.split('.').slice(0, 2).join('.');
    return `${trim(match[1])} – ${trim(match[2])}`;
}

export function formatLessonPeriod(
    raw: string | null | undefined,
    language: Lang,
): LessonPeriodLabel | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    if (ALL_SENTINELS.has(trimmed.toLowerCase())) return null;

    const compactWeek = compactWeekRange(trimmed, language);
    if (compactWeek) {
        return { label: compactWeek, title: trimmed };
    }

    const compactDate = compactDateRange(trimmed);
    if (compactDate) {
        return { label: compactDate, title: trimmed };
    }

    // Fallback: show the raw text but truncated.
    const truncated = trimmed.length > 28 ? `${trimmed.slice(0, 27)}…` : trimmed;
    return { label: truncated, title: trimmed };
}

// ---------------------------------------------------------------------------
// Активность периода пары (№10 логик-аудита)
//
// `lesson.period` — сырой текст `.dateStartLbl` из расписания КГТУ. Известные
// формы: «1-8 неделя» (диапазон учебных недель), «с 01.09 по 15.10» /
// «Период с 26.01 по 09.05» (диапазон дат, год обычно опущен), «all» — без
// ограничения. Здесь мы решаем, действует ли пара «сейчас», чтобы не считать
// её в «сегодня N пар», не светить в «Сейчас/Далее» и не слать push.
//
// КОНСЕРВАТИВНО: всё, что не распознано уверенно (в т.ч. открытые периоды
// вида «с 1 февраля»), считаем активным — поведение не хуже прежнего.
// ---------------------------------------------------------------------------

export interface LessonPeriodActivityContext {
    /** Текущий момент — для диапазонов дат. */
    now: Date;
    /** Номер учебной недели из академ-контекста — для «1-8 неделя». */
    semesterWeek?: number | null;
}

const WEEK_RANGE_RE = /(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*(?:нед|апта|week|w)/i;
const DATE_RANGE_RE = /(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)\s*(?:[-–—]|по|до)\s*(\d{1,2}\.\d{1,2}(?:\.\d{2,4})?)/i;

interface DateParts {
    day: number;
    month: number; // 1-12
    year: number | null;
}

function parseDateParts(raw: string): DateParts | null {
    const segments = raw.split('.');
    if (segments.length < 2 || segments.length > 3) return null;
    const day = Number(segments[0]);
    const month = Number(segments[1]);
    let year: number | null = null;
    if (segments.length === 3) {
        year = Number(segments[2]);
        if (!Number.isInteger(year)) return null;
        if (year < 100) year += 2000; // «24» → 2024
    }
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;
    return { day, month, year };
}

function startOfDayMs(year: number, parts: DateParts): number {
    return new Date(year, parts.month - 1, parts.day).getTime();
}

function endOfDayMs(year: number, parts: DateParts): number {
    return new Date(year, parts.month - 1, parts.day, 23, 59, 59, 999).getTime();
}

/**
 * Кандидаты конкретных диапазонов дат. Год в `.dateStartLbl` обычно опущен,
 * поэтому без явного года пробуем якоря «прошлый/текущий/следующий год»:
 * период активен, если «сейчас» попадает хотя бы в один кандидат. Диапазон
 * «через Новый год» («с 01.12 по 15.02») получает конец в следующем году.
 */
function buildDateRangeCandidates(
    start: DateParts,
    end: DateParts,
    nowYear: number,
): Array<{ startMs: number; endMs: number }> {
    const candidates: Array<{ startMs: number; endMs: number }> = [];

    const pushAnchored = (startYear: number, endYear: number) => {
        const startMs = startOfDayMs(startYear, start);
        let endMs = endOfDayMs(endYear, end);
        if (endMs < startMs) {
            endMs = endOfDayMs(endYear + 1, end);
        }
        candidates.push({ startMs, endMs });
    };

    if (start.year !== null && end.year !== null) {
        // Оба года явные — верим им как есть (даже если диапазон «пустой»).
        candidates.push({ startMs: startOfDayMs(start.year, start), endMs: endOfDayMs(end.year, end) });
    } else if (start.year !== null) {
        pushAnchored(start.year, start.year);
    } else if (end.year !== null) {
        // Явный только конец: начало — в том же году, либо годом раньше,
        // если иначе диапазон выходит «задом наперёд».
        const startMs = startOfDayMs(end.year, start);
        const endMs = endOfDayMs(end.year, end);
        candidates.push(
            startMs <= endMs
                ? { startMs, endMs }
                : { startMs: startOfDayMs(end.year - 1, start), endMs },
        );
    } else {
        for (const anchor of [nowYear - 1, nowYear, nowYear + 1]) {
            pushAnchored(anchor, anchor);
        }
    }

    return candidates;
}

/**
 * true — пара действует «сейчас» (или период не распознан — не фильтруем);
 * false — период распознан и текущий момент/неделя вне него.
 */
export function isLessonPeriodActive(
    raw: string | null | undefined,
    context: LessonPeriodActivityContext,
): boolean {
    if (!raw) return true;
    const trimmed = raw.trim();
    if (!trimmed || ALL_SENTINELS.has(trimmed.toLowerCase())) return true;

    const weekMatch = trimmed.match(WEEK_RANGE_RE);
    if (weekMatch) {
        const from = Number(weekMatch[1]);
        const to = Number(weekMatch[2]);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
            return true; // странный диапазон — не фильтруем
        }
        const week = context.semesterWeek;
        if (typeof week !== 'number' || !Number.isFinite(week) || week < 1) {
            return true; // неделя семестра неизвестна — консервативно активна
        }
        return week >= from && week <= to;
    }

    const dateMatch = trimmed.match(DATE_RANGE_RE);
    if (dateMatch) {
        const start = parseDateParts(dateMatch[1]);
        const end = parseDateParts(dateMatch[2]);
        if (!start || !end) return true;
        const nowMs = context.now.getTime();
        if (!Number.isFinite(nowMs)) return true;
        return buildDateRangeCandidates(start, end, context.now.getFullYear())
            .some(({ startMs, endMs }) => nowMs >= startMs && nowMs <= endMs);
    }

    return true;
}
