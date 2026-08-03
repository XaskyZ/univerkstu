/**
 * Парсер расписания KSTU
 * Использует HTTP запросы вместо Playwright для максимальной скорости
 */

import * as cheerio from 'cheerio';
import {
    Schedule,
    ScheduleMeta,
    TimeSlot,
    Lesson,
    ParseResult
} from '../types/index.js';
import { login, switchToRussian, httpGet, isLoggedIn, BASE_URL, type KSTUCookies } from './http-client.js';
import { getCurrentAcademicPeriod } from './platonus-client.js';

const SCHEDULE_URL = `${BASE_URL}/student/myschedule/`;

const DAYS_MAP: Record<string, string> = {
    'ПН': 'mon',
    'ВТ': 'tue',
    'СР': 'wed',
    'ЧТ': 'thu',
    'ПТ': 'fri',
    'СБ': 'sat',
    'ВС': 'sun',
};

const TIME_REGEX = /\b(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})\b/g;
const TYPE_IN_PARENS_REGEX = /\(([^)]+)\)\s*$/;

/**
 * Извлечение времени из ячейки
 */
export function extractTime(text: string): {
    start: string | null;
    end: string | null;
    raw: string;
    segments: Array<{ start: string; end: string }>;
} {
    const segments = Array.from(text.matchAll(TIME_REGEX)).map((m) => ({
        start: m[1],
        end: m[2],
    }));

    if (!segments.length) {
        return { start: null, end: null, raw: text, segments: [] };
    }

    return {
        start: segments[0].start,
        end: segments[segments.length - 1].end,
        raw: text.replace(/\s+/g, ' ').trim(),
        segments,
    };
}

/**
 * Разделение названия и типа занятия
 */
export function splitTitleAndType(rawTitle: string): { title: string; type: string | null } {
    const title = rawTitle.trim();
    const match = title.match(TYPE_IN_PARENS_REGEX);

    if (match) {
        return {
            title: title.replace(TYPE_IN_PARENS_REGEX, '').trim(),
            type: match[1].trim(),
        };
    }

    return { title, type: null };
}

/**
 * Извлечение чётности недели
 */
export function extractParity(html: string): 'all' | 'num' | 'den' {
    const $ = cheerio.load(html);
    const span = $('.denominator').first();
    if (span.length) {
        const val = span.text().toLowerCase();
        if (val.includes('числ')) return 'num';
        if (val.includes('знам')) return 'den';
    }
    return 'all';
}

/**
 * Извлечение аудитории
 */
export function extractRoom(html: string): string | null {
    if (html.includes('Ауд.:')) {
        const match = html.match(/Ауд\.:\s*([^|<]+)/);
        return match ? match[1].trim() : null;
    }
    return null;
}

/**
 * Извлечение факультета
 */
export function extractFaculty(html: string): string | null {
    const $ = cheerio.load(html);
    const span = $('.aud_faculty').first();
    return span.length ? span.text().trim() : null;
}

/**
 * Извлечение периода
 */
export function extractPeriod(html: string): string {
    const $ = cheerio.load(html);
    const span = $('.dateStartLbl').first();
    return span.length ? span.text().trim() : 'all';
}

import { findTeacherInDb } from '../utils/teacherMatcher.js';

/**
 * Парсинг ячейки с занятиями
 */
function parseCellGroups($: cheerio.CheerioAPI, cell: any): Lesson[] {
    const lessons: Lesson[] = [];
    const groups = $(cell).find('.groups');

    if (!groups.length) return lessons;

    const blocks = groups.find('> div');

    blocks.each((_, blk) => {
        const block = $(blk);
        const teachers = block.find('p.teacher');

        if (!teachers.length) return;

        const rawTitle = teachers.first().text().trim();
        const { title, type } = splitTitleAndType(rawTitle);
        const teacherText = teachers.length > 1 ? $(teachers.get(1)).text().trim() : '';

        // Поиск преподавателя в базе (сопоставление инициалов)
        const matchedTeacher = teacherText ? findTeacherInDb(teacherText) : null;

        // Собираем params блоки
        const paramsBlocks: string[] = [];
        const subjectParams = block.find('.subject_params');
        if (subjectParams.length) {
            paramsBlocks.push(subjectParams.html() || '');
        }
        block.find('p.params').each((_, p) => {
            paramsBlocks.push($(p).html() || '');
        });

        const paramsHtml = paramsBlocks.join(' ');

        lessons.push({
            title,
            type,
            teacher: teacherText,
            teacherName: matchedTeacher?.name,
            teacherUrl: matchedTeacher?.url,
            room: extractRoom(paramsHtml),
            faculty: extractFaculty(paramsHtml),
            parity: extractParity(paramsHtml),
            period: extractPeriod(paramsHtml) || null,
            rawParams: paramsHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() || undefined,
        });
    });

    return lessons;
}

// ============================================================================
// Новая разметка myschedule (с лета 2026):
//   /student/myschedule/            — страница-«хаб» без таблицы. На ней ссылки
//                                     сразу на НЕСКОЛЬКО семестров:
//     tr.top  td.ct  a[href=/student/myschedule/{год}/{терм}]   — семестр,
//                                     который портал считает выбранным/текущим;
//     tr.mid  td.ts  a.lt / a.rt    — предыдущий/следующий семестры.
//   /student/myschedule/{год}/{терм} — страница семестра. Таблицы всё ещё нет,
//                                     есть только <select id="weekSelect"> со
//                                     ссылками на недели. Если расписание
//                                     семестра не опубликовано — select пуст.
//   /student/myschedule/{год}/{терм}/{дд.мм.гггг}/{дд.мм.гггг}/ — страница
//                                     недели, и вот на ней лежит старая добрая
//                                     table.schedule (разметка ячеек прежняя).
// ============================================================================

export interface SemesterLink {
    year: number;   // учебный год: 2026 => 2026-2027
    term: number;   // 1 = осенний, 2 = весенний
    title: string;  // текст ссылки («Расписание учебных занятий Осенний семестра …»)
    href: string;   // относительный URL /student/myschedule/{год}/{терм}
}

export interface WeekOption {
    url: string;    // относительный URL страницы недели
    start: string;  // дд.мм.гггг
    end: string;    // дд.мм.гггг
    label: string;  // «Неделя 01. 26.01.2026 - 01.02.2026»
}

const SEMESTER_LINK_REGEX = /^\/student\/myschedule\/(\d{4})\/([12])\/?$/;
const WEEK_OPTION_REGEX = /^\/student\/myschedule\/(\d{4})\/([12])\/(\d{2}\.\d{2}\.\d{4})\/(\d{2}\.\d{2}\.\d{4})\/?$/;

/**
 * Собирает ссылки на семестры со страницы myschedule (хаб или страница семестра).
 * Первая ссылка в порядке документа — заголовочная (tr.top td.ct), т.е. семестр,
 * который сам портал считает выбранным.
 */
export function extractSemesterLinks(html: string): SemesterLink[] {
    const $ = cheerio.load(html);
    const links: SemesterLink[] = [];
    const seen = new Set<string>();

    $('a[href]').each((_, a) => {
        const href = ($(a).attr('href') || '').trim();
        const match = href.match(SEMESTER_LINK_REGEX);
        if (!match) return;

        const key = `${match[1]}/${match[2]}`;
        if (seen.has(key)) return;
        seen.add(key);

        links.push({
            year: Number(match[1]),
            term: Number(match[2]),
            title: $(a).text().replace(/\s+/g, ' ').trim(),
            href: `/student/myschedule/${match[1]}/${match[2]}`,
        });
    });

    return links;
}

/**
 * Достаёт список недель из <select id="weekSelect"> страницы семестра.
 * Фильтрует по году/терму, чтобы случайно не забрать недели другого семестра.
 */
export function extractWeekOptions(html: string, semester: { year: number; term: number }): WeekOption[] {
    const $ = cheerio.load(html);
    const weeks: WeekOption[] = [];

    $('#weekSelect option').each((_, opt) => {
        const value = ($(opt).attr('value') || '').trim();
        const match = value.match(WEEK_OPTION_REGEX);
        if (!match) return;
        if (Number(match[1]) !== semester.year || Number(match[2]) !== semester.term) return;

        weeks.push({
            url: value,
            start: match[3],
            end: match[4],
            label: $(opt).text().replace(/\s+/g, ' ').trim(),
        });
    });

    return weeks;
}

function parseDdMmYyyy(value: string): Date | null {
    const match = value.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
    if (!match) return null;
    const date = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Выбирает неделю для парсинга: неделя, содержащая сегодняшнюю дату →
 * иначе ближайшая будущая → иначе последняя (семестр уже закончился).
 * Таблица недели содержит полную сетку семестра с пометками
 * числитель/знаменатель, поэтому любая неделя даёт валидное расписание.
 */
export function pickWeekForDate(weeks: WeekOption[], now: Date): WeekOption | null {
    if (weeks.length === 0) return null;

    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    for (const week of weeks) {
        const start = parseDdMmYyyy(week.start)?.getTime();
        const end = parseDdMmYyyy(week.end)?.getTime();
        if (start != null && end != null && today >= start && today <= end) {
            return week;
        }
    }

    const upcoming = weeks
        .map((week) => ({ week, start: parseDdMmYyyy(week.start)?.getTime() ?? Infinity }))
        .filter((item) => item.start >= today)
        .sort((a, b) => a.start - b.start);
    if (upcoming.length > 0) return upcoming[0].week;

    return weeks[weeks.length - 1];
}

/** Приблизительное начало семестра: осенний — 1 сентября, весенний — 20 января след. года. */
function approximateSemesterStart(year: number, term: number): Date {
    return term === 1 ? new Date(year, 8, 1) : new Date(year + 1, 0, 20);
}

/**
 * Упорядочивает семестры-кандидаты:
 *  1. Семестр, совпадающий с текущим академическим периодом по дате
 *     (getCurrentAcademicPeriod — та же логика, что у exams/grades).
 *  2. Семестр, который портал сам показал в заголовке (первая ссылка).
 *  3. Остальные: сначала уже начавшиеся (новее — раньше), затем будущие
 *     (ближайшие — раньше). Так фолбэк при неопубликованном текущем семестре
 *     уходит в прошлый семестр, а не в пустой будущий.
 */
export function orderSemesterCandidates(
    links: SemesterLink[],
    desired: { year: number; semester: number },
    now: Date
): SemesterLink[] {
    const ordered: SemesterLink[] = [];
    const push = (link: SemesterLink | undefined) => {
        if (link && !ordered.includes(link)) ordered.push(link);
    };

    push(links.find((l) => l.year === desired.year && l.term === desired.semester));
    push(links[0]);

    const rest = links.filter((l) => !ordered.includes(l));
    const started = rest
        .filter((l) => approximateSemesterStart(l.year, l.term).getTime() <= now.getTime())
        .sort((a, b) => approximateSemesterStart(b.year, b.term).getTime() - approximateSemesterStart(a.year, a.term).getTime());
    const future = rest
        .filter((l) => approximateSemesterStart(l.year, l.term).getTime() > now.getTime())
        .sort((a, b) => approximateSemesterStart(a.year, a.term).getTime() - approximateSemesterStart(b.year, b.term).getTime());

    return [...ordered, ...started, ...future];
}

function hasScheduleTable(html: string): boolean {
    return cheerio.load(html)('table.schedule').length > 0;
}

/**
 * Парсинг HTML таблицы расписания
 */
export function parseScheduleTable(html: string): Omit<Schedule, '_id' | 'userId' | 'cachedAt' | 'expiresAt'> {
    const $ = cheerio.load(html);
    const table = $('table.schedule');

    if (!table.length) {
        throw new Error('Таблица расписания (.schedule) не найдена');
    }

    const rows = table.find('tr');
    if (rows.length < 2) {
        throw new Error('Недостаточно строк в таблице расписания');
    }

    // Заголовки дней
    const headerCells = $(rows.get(0)).find('th, td');
    const dayHeaders: string[] = [];
    headerCells.each((i, cell) => {
        if (i > 0) { // Пропускаем первую ячейку (время)
            dayHeaders.push($(cell).text().trim());
        }
    });
    const days = dayHeaders.map(h => DAYS_MAP[h] || h);

    const timeSlots: TimeSlot[] = [];
    const daysData: Record<string, Lesson[][]> = {};
    days.forEach(d => { daysData[d] = []; });

    // Парсинг строк
    rows.each((i, row) => {
        if (i === 0) return; // Пропускаем заголовок

        const cells = $(row).find('td');
        if (!cells.length) return;

        const firstCell = $(cells.get(0)).text().trim();
        const { start, end, raw, segments } = extractTime(firstCell);

        if (!start || !end) return;

        timeSlots.push({ start, end, raw, segments });

        cells.each((j, cell) => {
            if (j === 0) return; // Пропускаем ячейку времени
            if (j - 1 >= days.length) return;

            const dayKey = days[j - 1];
            const lessons = parseCellGroups($, cell);
            daysData[dayKey].push(lessons);
        });
    });

    const meta: ScheduleMeta = {
        tz: 'Asia/Almaty',
        parsedAt: new Date().toISOString(),
        userId: '', // Будет заполнено позже
    };

    return {
        meta,
        timeSlots,
        days: days.map(dk => ({
            name: dk,
            lessons: daysData[dk],
        })),
    };
}

/**
 * Находит и загружает HTML с таблицей расписания по новой навигации:
 * хаб → семестр → неделя. Возвращает HTML недели + данные семестра,
 * из которого он взят.
 */
async function fetchScheduleHtml(
    landingHtml: string,
    cookies: KSTUCookies,
    now: Date
): Promise<{ html: string; semester: SemesterLink; isCurrent: boolean } | { error: string }> {
    const links = extractSemesterLinks(landingHtml);
    if (links.length === 0) {
        return { error: 'На странице myschedule не найдено ни таблицы расписания, ни ссылок на семестры' };
    }

    const desired = getCurrentAcademicPeriod();
    const candidates = orderSemesterCandidates(links, desired, now);
    console.log(
        `[Schedule Parser] Semester candidates (desired ${desired.year}/${desired.semester}): ` +
        candidates.map((c) => `${c.year}/${c.term}`).join(', ')
    );

    for (const candidate of candidates) {
        // Хаб-страница — это одновременно страница семестра, выбранного порталом
        // (первая ссылка), поэтому для него ничего повторно не загружаем.
        let semesterHtml = landingHtml;
        let weeks = extractWeekOptions(landingHtml, candidate);
        if (weeks.length === 0) {
            const response = await httpGet(`${BASE_URL}${candidate.href}`, cookies, { referer: SCHEDULE_URL });
            if (response.status !== 200) {
                console.warn(`[Schedule Parser] Semester ${candidate.year}/${candidate.term}: HTTP ${response.status}, skipping`);
                continue;
            }
            semesterHtml = response.data;
            weeks = extractWeekOptions(semesterHtml, candidate);
        }

        if (weeks.length === 0) {
            console.warn(`[Schedule Parser] Semester ${candidate.year}/${candidate.term} has no published weeks, skipping`);
            continue;
        }

        const week = pickWeekForDate(weeks, now);
        if (!week) continue;

        console.log(`[Schedule Parser] Semester ${candidate.year}/${candidate.term}: loading week ${week.label}`);
        const weekResponse = await httpGet(`${BASE_URL}${week.url}`, cookies, { referer: `${BASE_URL}${candidate.href}` });
        if (weekResponse.status !== 200 || !hasScheduleTable(weekResponse.data)) {
            console.warn(`[Schedule Parser] Week page for ${candidate.year}/${candidate.term} has no schedule table, skipping`);
            continue;
        }

        const isCurrent = candidate.year === desired.year && candidate.term === desired.semester;
        if (!isCurrent) {
            console.warn(
                `[Schedule Parser] Current semester ${desired.year}/${desired.semester} is not published yet; ` +
                `falling back to ${candidate.year}/${candidate.term} ("${candidate.title}")`
            );
        }
        return { html: weekResponse.data, semester: candidate, isCurrent };
    }

    return { error: 'Расписание не опубликовано ни для одного доступного семестра' };
}

/**
 * Парсинг расписания при готовых KSTU-cookies.
 * Используется, когда вызывающий код только что аутентифицировался — не делаем
 * повторный login(). Внутри сам переключается на русский язык и парсит HTML.
 */
export async function parseScheduleWithCookies(
    cookies: KSTUCookies
): Promise<ParseResult<Omit<Schedule, '_id' | 'userId' | 'cachedAt' | 'expiresAt'>>> {
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(`[Schedule Parser] Fetching with provided cookies, attempt ${attempt}/${MAX_RETRIES}...`);

            // Переключение на русский язык (на провайденных куках)
            const cookiesRu = await switchToRussian(cookies);

            // Загрузка страницы расписания
            console.log('[Schedule Parser] Loading schedule page...');
            const { data: html, status } = await httpGet(SCHEDULE_URL, cookiesRu);

            if (status !== 200) {
                return { success: false, error: `HTTP error: ${status}` };
            }

            if (!isLoggedIn(html)) {
                if (attempt < MAX_RETRIES) {
                    console.warn(`[Schedule Parser] Session check failed (attempt ${attempt}), retrying...`);
                    await new Promise(r => setTimeout(r, 1000));
                    continue;
                }
                return { success: false, error: 'Сессия истекла или авторизация не удалась' };
            }

            // Старый формат: таблица прямо на /student/myschedule/ (на случай
            // отката портала к прежней разметке).
            if (hasScheduleTable(html)) {
                const scheduleData = parseScheduleTable(html);
                console.log('[Schedule Parser] Parsing complete (legacy single-page layout)');
                return { success: true, data: scheduleData, html };
            }

            // Новый формат: хаб → семестр → неделя.
            const fetched = await fetchScheduleHtml(html, cookiesRu, new Date());
            if ('error' in fetched) {
                return { success: false, error: fetched.error };
            }

            const scheduleData = parseScheduleTable(fetched.html);
            scheduleData.meta.semester = {
                year: fetched.semester.year,
                term: fetched.semester.term,
                title: fetched.semester.title || undefined,
                isCurrent: fetched.isCurrent,
            };

            console.log(
                `[Schedule Parser] Parsing complete (semester ${fetched.semester.year}/${fetched.semester.term}, ` +
                `isCurrent=${fetched.isCurrent})`
            );

            return {
                success: true,
                data: scheduleData,
                html: fetched.html
            };

        } catch (error) {
            console.error(`[Schedule Parser] Error (attempt ${attempt}):`, error);
            if (attempt === MAX_RETRIES) {
                return {
                    success: false,
                    error: error instanceof Error ? error.message : 'Unknown error'
                };
            }
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    return { success: false, error: 'Не удалось получить расписание после нескольких попыток' };
}

/**
 * Основная функция парсинга расписания: логинится в KSTU, затем парсит.
 * Использует быстрые HTTP запросы вместо Playwright.
 */
export async function parseSchedule(
    username: string,
    password: string
): Promise<ParseResult<Omit<Schedule, '_id' | 'userId' | 'cachedAt' | 'expiresAt'>>> {
    const cookies = await login(username, password);
    if (!cookies) {
        return { success: false, error: 'Ошибка авторизации. Проверьте логин и пароль.' };
    }
    return parseScheduleWithCookies(cookies);
}

export default parseSchedule;

