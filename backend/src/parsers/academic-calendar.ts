import * as cheerio from 'cheerio';
import { BASE_URL, httpGet, KSTUCookies } from './http-client.js';

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
    start: string;
    end: string;
    segmentLabel: string;
}

export interface AcademicCalendarSemester {
    semesterNumber: number;
    title: string;
    start: string | null;
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

export function parseDate(value: string): Date | null {
    const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;
    const [, dd, mm, yyyy] = match;
    const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    return Number.isNaN(date.getTime()) ? null : date;
}

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

export function extractField(text: string, label: string, stopLabels: string[] = []): string | null {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stopPattern = stopLabels.length > 0
        ? stopLabels
            .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|')
        : '[А-ЯA-Z#][^:]+';
    // Use `(?=\\s|$)` instead of `\\b` for the semester boundary — JS regex `\\b` is
    // defined on the ASCII word-char class, so "Семестр\\b" never fires after a Cyrillic
    // letter. Same trap as in profile.ts:parseEducPlanValue (fire 152).
    const match = text.match(new RegExp(`${escaped}:\\s*(.+?)(?=\\s+(?:${stopPattern}):|\\s+\\d+\\s+Семестр(?=\\s|$)|$)`));
    return match?.[1]?.trim() || null;
}

function extractSemestersText(text: string): string {
    const start = text.indexOf('1 Семестр');
    return start >= 0 ? text.slice(start) : text;
}

export async function parseAcademicCalendar(cookies: KSTUCookies): Promise<ParsedAcademicCalendar> {
    const response = await httpGet(`${BASE_URL}/student/academcalendar/`, cookies, {
        referer: `${BASE_URL}/student/`,
    });

    if (response.status !== 200) {
        throw new Error(`Academic calendar HTTP ${response.status}`);
    }

    const $ = cheerio.load(response.data);
    $('script, style, noscript').remove();
    const text = normalizeText($('body').text() || '');
    const semestersText = extractSemestersText(text);

    const semesterPattern = /(\d+)\s+Семестр\s+\^\s+к\s+описанию\s+учебного\s+плана\s+([\s\S]*?)(?=(?:\d+\s+Семестр\s+\^\s+к\s+описанию\s+учебного\s+плана)|$)/g;
    const segmentPattern = /((?:Основной период обучения)|(?:Модуль \d+))\s+\((\d+)\s+Семестр\)\s+([\s\S]*?)(?=(?:(?:Основной период обучения)|(?:Модуль \d+))\s+\(\d+\s+Семестр\)|$)/g;
    const periodPattern = /(Период|Теоретическое обучение|Рубежный контроль 1 \(100\)|Рубежный контроль 2 \(100\)|Государственные экзамены\(100\)|Экзаменационная сессия \(100\)|Практика|Проставление баллов за практику|Каникулы)\s+(\d+)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})/g;

    const semesters: AcademicCalendarSemester[] = [];
    let semesterMatch: RegExpExecArray | null;

    while ((semesterMatch = semesterPattern.exec(semestersText)) !== null) {
        const semesterNumber = Number.parseInt(semesterMatch[1], 10);
        const block = semesterMatch[2];
        const periods: AcademicCalendarPeriod[] = [];

        let segmentMatch: RegExpExecArray | null;
        while ((segmentMatch = segmentPattern.exec(block)) !== null) {
            const segmentLabel = normalizeText(segmentMatch[1]);
            const segmentBody = segmentMatch[3].replace(/Период\s+Недель\s+От\s+до/g, ' ');

            let periodMatch: RegExpExecArray | null;
            while ((periodMatch = periodPattern.exec(segmentBody)) !== null) {
                const label = normalizeText(periodMatch[1]);
                periods.push({
                    label,
                    kind: classifyPeriod(label),
                    weeks: Number.parseInt(periodMatch[2], 10) || null,
                    start: periodMatch[3],
                    end: periodMatch[4],
                    segmentLabel,
                });
            }
        }

        const periodRange = periods
            .map((period) => ({
                start: parseDate(period.start),
                end: parseDate(period.end),
                weeks: period.weeks,
            }))
            .filter((item): item is { start: Date; end: Date; weeks: number | null } => Boolean(item.start && item.end));

        const mainPeriod = periods.find((period) => period.kind === 'semester' && period.segmentLabel === 'Основной период обучения');
        const start = mainPeriod?.start || periodRange[0]?.start.toLocaleDateString('ru-RU') || null;
        const end = mainPeriod?.end || periodRange[periodRange.length - 1]?.end.toLocaleDateString('ru-RU') || null;
        const totalWeeks = mainPeriod?.weeks ?? null;

        semesters.push({
            semesterNumber,
            title: `${semesterNumber} семестр`,
            start,
            end,
            totalWeeks,
            periods,
        });
    }

    return {
        formOfEducation: extractField(text, 'Форма обучения', ['Уровень/направление обучения', 'Специальность', 'Количество семестров', 'Год поступления']),
        educationLevel: extractField(text, 'Уровень/направление обучения', ['Специальность', 'Количество семестров', 'Год поступления']),
        specialty: extractField(text, 'Специальность', ['Количество семестров', 'Год поступления']),
        totalSemesters: Number.parseInt(extractField(text, 'Количество семестров', ['Год поступления']) || '', 10) || null,
        admissionYear: Number.parseInt(extractField(text, 'Год поступления') || '', 10) || null,
        semesters,
    };
}

export function toDate(value: string | null): Date | null {
    return value ? parseDate(value) : null;
}
