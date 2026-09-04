/**
 * Типы и чистые хелперы академического календаря.
 *
 * Исторически жили в parsers/academic-calendar.ts (HTML-парсер
 * univer.kstu.kz/student/academcalendar). Univer закрыт навсегда, парсер
 * удалён; структура данных сохранена, чтобы routes/exams, routes/umkd и
 * фронтенд (AcademicContext) не менялись. Теперь её наполняет
 * services/academic-context.ts из данных Platonus.
 *
 * Даты периодов хранятся строками в формате DD.MM.YYYY (как отдавал Univer,
 * этот формат ожидают routes/exams:parseCalendarDate и фронтенд).
 */

export type AcademicPeriodKind =
    | 'semester'
    | 'theory'
    | 'midterm_1'
    | 'midterm_2'
    | 'exams'
    | 'state_exams'
    | 'practice'
    | 'practice_grading'
    | 'vacation'
    | 'other';

export interface AcademicCalendarPeriod {
    label: string;
    kind: AcademicPeriodKind;
    weeks: number | null;
    /** DD.MM.YYYY */
    start: string;
    /** DD.MM.YYYY */
    end: string;
    segmentLabel: string;
}

export interface AcademicCalendarSemester {
    /**
     * Порядковый номер семестра по учебному плану (1..N). Univer отдавал его
     * явно; Platonus — нет (нужен год поступления), поэтому теперь null.
     */
    semesterNumber: number | null;
    /** Учебный год Platonus: 2026 = 2026-2027. */
    academicYear?: number | null;
    /** 1 = осенний, 2 = весенний. */
    term?: number | null;
    title: string;
    /** DD.MM.YYYY */
    start: string | null;
    /** DD.MM.YYYY */
    end: string | null;
    totalWeeks: number | null;
    periods: AcademicCalendarPeriod[];
}

export interface ParsedAcademicCalendar {
    formOfEducation: string | null;
    educationLevel: string | null;
    specialty: string | null;
    totalSemesters: number | null;
    admissionYear: number | null;
    semesters: AcademicCalendarSemester[];
}

export function normalizeText(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
}

/** "DD.MM.YYYY" → Date (локальная полночь) или null. */
export function parseDate(value: string): Date | null {
    const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(date.getTime()) ? null : date;
}

export function toDate(value: string | null): Date | null {
    return value ? parseDate(value) : null;
}

/** Date → "DD.MM.YYYY" (локальная календарная дата). */
export function formatDate(date: Date): string {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    return `${dd}.${mm}.${date.getFullYear()}`;
}

/**
 * Классификация периода по русскому названию. Словарь унаследован от
 * academcalendar Univer; названия событий Platonus (`title`) проходят через
 * него же — ключевые слова («экзамен», «рубежный контроль», «каникулы») в
 * обеих системах одинаковые.
 */
export function classifyPeriod(label: string): AcademicPeriodKind {
    const normalized = label.toLowerCase();
    if (normalized === 'период') return 'semester';
    if (normalized.includes('теоретическое обучение')) return 'theory';
    if (normalized.includes('рубежный контроль 1')) return 'midterm_1';
    if (normalized.includes('рубежный контроль 2')) return 'midterm_2';
    if (normalized.includes('государственные экзамены')) return 'state_exams';
    if (normalized.includes('экзаменационная сессия')) return 'exams';
    if (normalized === 'практика') return 'practice';
    if (normalized.includes('проставление баллов за практику')) return 'practice_grading';
    if (normalized.includes('каникул')) return 'vacation';
    return 'other';
}
