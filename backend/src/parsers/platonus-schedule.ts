/**
 * Парсер расписания занятий из Platonus v7 (основной источник с осени 2026).
 *
 * Platonus отдаёт расписание понедельно (weekList = 1..15) через read-only
 * viewer-запрос POST /rest/schedule/userSchedule/student/calculate/0/{lang}
 * (тело — фильтры, сервер ничего не меняет; аналог POST /rest/transcript/load).
 *
 * Приложение же хранит расписание в форме «одна сетка на семестр + чётность»
 * (parity: all/num/den), как отдавал старый Univer. Чётность в Platonus
 * отсутствует, поэтому вычисляется сравнением двух недель — см.
 * parsePlatonusSchedule().
 */

import type { AxiosInstance } from 'axios';
import {
    Schedule,
    ScheduleMeta,
    TimeSlot,
    Lesson,
    ParseResult,
} from '../types/index.js';
import {
    PlatonusSession,
    bootstrapPlatonusV7,
    createPlatonusV7Client,
    getCurrentAcademicPeriod,
    getPlatonusErrorSummary,
} from './platonus-client.js';
import { findTeacherInDb } from '../utils/teacherMatcher.js';

// === Типы ответа Platonus (см. docs/reference/platonus-api.md §3) ===

export interface PlatonusLessonHour {
    /** Сквозной id пары в БД (36..40 осенью 2026) — ключ в timetable.days[*].lessons */
    number: number;
    /** "09:00:00" */
    start: string;
    /** "10:45:00" */
    finish: string;
    /** Порядковый номер пары для показа (1..5) */
    displayNumber: number;
    shiftNumber?: number;
    duration?: number;
}

export interface PlatonusRawLesson {
    subjectName?: string;
    groupTypeShortName?: string;   // "Л" | "ЛЗ" | "СПЗ" | ...
    groupTypeFullName?: string;    // "Лекции" | "Лабораторные работы" | ...
    tutorName?: string;            // с ведущим пробелом — тримить
    tutorShortName?: string;
    auditory?: string;
    building?: string;
    number?: number;               // ссылка на lessonHours.number
    empty?: boolean;               // ячейка-заглушка
}

interface PlatonusLessonSlot {
    lessons?: PlatonusRawLesson[];
}

interface PlatonusDayCell {
    lessons?: Record<string, PlatonusLessonSlot>;
}

export interface PlatonusScheduleWeek {
    selectedStudyYear?: number;
    selectedTerm?: number;
    selectedWeek?: number;
    lessonHours?: PlatonusLessonHour[];
    timetable?: {
        days?: Record<string, PlatonusDayCell>;
    };
}

// Ключи дней Platonus: 1 = Понедельник … 7 = Воскресенье
// (подтверждено getWeekDayNameByIndex в v7-бандле).
const PLATONUS_DAY_KEYS: Record<string, string> = {
    '1': 'mon',
    '2': 'tue',
    '3': 'wed',
    '4': 'thu',
    '5': 'fri',
    '6': 'sat',
    '7': 'sun',
};

/** Дни, которые всегда присутствуют в сетке приложения (как у Univer-таблицы). */
const OUTPUT_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const WEEKS_IN_SEMESTER = 15;

/** "09:00:00" → "09:00" */
export function trimSeconds(value: string | undefined): string {
    if (!value) return '';
    const match = value.match(/^(\d{1,2}:\d{2})/);
    return match ? match[1] : value;
}

/**
 * Приблизительное начало семестра.
 *
 * ВАЖНО: не опираемся на startSemesterPeriod из ответа Platonus — для
 * studyYear=2026/term=1 сервер отдаёт прошлогодние даты (2025-09-01), а
 * activeWeekNumber = 0: академ-календарь на новый учебный год в Platonus
 * ещё не заведён (см. docs/reference/platonus-api.md §7.1). Поэтому считаем
 * сами: осенний семестр — с 1 сентября учебного года, весенний — с 20 января
 * следующего календарного года (та же аппроксимация, что в Univer-парсере).
 */
export function approximateSemesterStart(year: number, term: number): Date {
    return term === 1 ? new Date(year, 8, 1) : new Date(year + 1, 0, 20);
}

/**
 * Номер текущей учебной недели (1..15) от расчётного старта семестра.
 * До начала семестра и после его конца значение зажимается в границы.
 */
export function computeSemesterWeek(year: number, term: number, now: Date): number {
    const start = approximateSemesterStart(year, term);
    const msPerDay = 24 * 60 * 60 * 1000;
    const days = Math.floor((now.getTime() - start.getTime()) / msPerDay);
    const week = Math.floor(days / 7) + 1;
    return Math.min(Math.max(week, 1), WEEKS_IN_SEMESTER);
}

/**
 * Пара недель (нечётная + чётная) для вычисления чётности.
 * Берём текущую неделю и соседнюю, чтобы отражать актуальное состояние
 * расписания (правки середины семестра), а не только недели 1-2.
 */
export function pickWeekPair(currentWeek: number): { oddWeek: number; evenWeek: number } {
    const clamped = Math.min(Math.max(currentWeek, 1), WEEKS_IN_SEMESTER);
    if (clamped % 2 === 1) {
        // Нечётная текущая: чётная соседка — следующая, для 15-й — предыдущая.
        return { oddWeek: clamped, evenWeek: clamped < WEEKS_IN_SEMESTER ? clamped + 1 : clamped - 1 };
    }
    return { oddWeek: clamped - 1, evenWeek: clamped };
}

/**
 * Один viewer-запрос расписания за конкретную неделю.
 * Клиент должен быть создан createPlatonusV7Client() и пройти bootstrapPlatonusV7().
 */
export async function fetchPlatonusSchedule(
    session: PlatonusSession,
    year: number,
    term: number,
    week: number,
    client?: AxiosInstance
): Promise<{ status: number; data: PlatonusScheduleWeek | null }> {
    const v7Client = client ?? createPlatonusV7Client(session);
    if (!client) {
        const bootStatus = await bootstrapPlatonusV7(v7Client);
        if (bootStatus !== 200) {
            return { status: bootStatus, data: null };
        }
    }

    // Тело — фильтры вьюера; значимы только studyYear/term/week,
    // остальное — дефолты вьюера «моё расписание» (см. platonus-api.md §3.1).
    const body = {
        scheduleSubModule: 'scheduleViewerByGroup',
        studentTypeID: 1,
        studyYear: year,
        term,
        week,
        statusID: 1,
        disciplineStudyLanguageIds: [1, 2, 3],
        facultyID: null,
        departmentID: null,
        specializationID: null,
        professionID: null,
        programID: null,
        courseID: null,
        groupID: null,
        tutorID: null,
        buildingID: null,
        auditoryID: null,
        curriculumID: null,
    };

    const response = await v7Client.post<PlatonusScheduleWeek>(
        '/rest/schedule/userSchedule/student/calculate/0/ru',
        body,
        { headers: { 'Content-Type': 'application/json' } }
    );

    const data = response.status === 200 && response.data && typeof response.data === 'object'
        ? response.data
        : null;
    return { status: response.status, data };
}

/** Ключ занятия для сравнения недель: день + номер пары + предмет + тип + аудитория. */
function lessonComparisonKey(dayKey: string, hourNumber: number, lesson: PlatonusRawLesson): string {
    return [
        dayKey,
        hourNumber,
        (lesson.subjectName || '').trim(),
        (lesson.groupTypeShortName || '').trim(),
        (lesson.auditory || '').trim(),
    ].join('||');
}

interface CollectedLesson {
    dayKey: string;        // 'mon'..'sun'
    hourNumber: number;    // lessonHours.number
    raw: PlatonusRawLesson;
}

/** Разворачивает timetable недели в плоский список занятий с ключами дней приложения. */
function collectWeekLessons(week: PlatonusScheduleWeek): CollectedLesson[] {
    const out: CollectedLesson[] = [];
    const days = week.timetable?.days || {};
    for (const [platonusDay, dayCell] of Object.entries(days)) {
        const dayKey = PLATONUS_DAY_KEYS[platonusDay];
        if (!dayKey) continue;
        for (const [hourKey, slot] of Object.entries(dayCell.lessons || {})) {
            const hourNumber = Number(hourKey);
            if (!Number.isFinite(hourNumber)) continue;
            for (const raw of slot.lessons || []) {
                if (!raw || raw.empty) continue;
                if (!(raw.subjectName || '').trim()) continue;
                out.push({ dayKey, hourNumber, raw });
            }
        }
    }
    return out;
}

function toLesson(raw: PlatonusRawLesson, parity: Lesson['parity']): Lesson {
    const teacherText = (raw.tutorShortName || raw.tutorName || '').trim();
    const matchedTeacher = teacherText ? findTeacherInDb(teacherText) : null;

    return {
        title: (raw.subjectName || '').trim(),
        type: (raw.groupTypeShortName || '').trim() || null,
        teacher: teacherText,
        teacherName: matchedTeacher?.name,
        teacherUrl: matchedTeacher?.url,
        room: (raw.auditory || '').trim() || null,
        // Lesson.faculty фронтенд рендерит как метку корпуса
        // (expandBuildingLabel в LessonCardMobile) — кладём туда building.
        faculty: (raw.building || '').trim() || null,
        parity,
        period: null,
        rawParams: (raw.groupTypeFullName || '').trim() || undefined,
    };
}

export interface PlatonusSemesterInfo {
    year: number;   // учебный год: 2026 = 2026-2027
    term: number;   // 1 = осенний, 2 = весенний
    isCurrent?: boolean;
}

/**
 * Склеивает две недели Platonus (нечётную и чётную) в семестровую сетку
 * приложения с вычисленной чётностью.
 *
 * Логика parity: в Platonus чётности нет — расписание понедельное. Недели
 * 1, 3, 5, … семестра считаем «числителем» (num), недели 2, 4, 6, … —
 * «знаменателем» (den): первая учебная неделя по общепринятой конвенции —
 * числитель. Занятие сравнивается между неделями по ключу
 * «день + номер пары + предмет + тип + аудитория»:
 *   - есть в обеих неделях  → parity 'all' (идёт каждую неделю);
 *   - только в нечётной     → parity 'num';
 *   - только в чётной       → parity 'den'.
 * Если у занятия между неделями меняется, например, аудитория — это два
 * разных ключа, и оно честно попадёт в сетку дважды: как num и как den.
 */
export function parsePlatonusSchedule(
    oddWeek: PlatonusScheduleWeek,
    evenWeek: PlatonusScheduleWeek,
    semester: PlatonusSemesterInfo
): Omit<Schedule, '_id' | 'userId' | 'cachedAt' | 'expiresAt'> {
    // Сетка пар: у обеих недель одного семестра она одинаковая; берём ту,
    // что заполнена. lessonHours.number — сквозной id из БД (не порядковый),
    // сортируем по displayNumber для порядка показа.
    const lessonHours = [...(oddWeek.lessonHours?.length ? oddWeek.lessonHours : evenWeek.lessonHours || [])]
        .sort((a, b) => (a.displayNumber ?? 0) - (b.displayNumber ?? 0));

    const timeSlots: TimeSlot[] = lessonHours.map((hour) => {
        const start = trimSeconds(hour.start);
        const end = trimSeconds(hour.finish);
        return {
            start,
            end,
            raw: `${start} - ${end}`,
            segments: [{ start, end }],
        };
    });

    // Индекс пары в timeSlots по её сквозному id.
    const slotIndexByHourNumber = new Map<number, number>();
    lessonHours.forEach((hour, index) => slotIndexByHourNumber.set(hour.number, index));

    const oddLessons = collectWeekLessons(oddWeek);
    const evenLessons = collectWeekLessons(evenWeek);
    const oddKeys = new Set(oddLessons.map((l) => lessonComparisonKey(l.dayKey, l.hourNumber, l.raw)));
    const evenKeys = new Set(evenLessons.map((l) => lessonComparisonKey(l.dayKey, l.hourNumber, l.raw)));

    // Сетка приложения: день → массив слотов → массив занятий.
    const daysData: Record<string, Lesson[][]> = {};
    for (const dayKey of OUTPUT_DAYS) {
        daysData[dayKey] = timeSlots.map(() => []);
    }

    const placed = new Set<string>();
    const placeLesson = (item: CollectedLesson, parity: Lesson['parity']) => {
        const key = lessonComparisonKey(item.dayKey, item.hourNumber, item.raw);
        if (placed.has(key)) return; // дубликат в рамках недели/между неделями
        placed.add(key);

        const slotIndex = slotIndexByHourNumber.get(item.hourNumber);
        if (slotIndex === undefined) return; // пара вне известной сетки — пропускаем
        if (!daysData[item.dayKey]) return;  // воскресенье и пр. вне выводимых дней
        daysData[item.dayKey][slotIndex].push(toLesson(item.raw, parity));
    };

    // Сначала нечётная неделя: занятия из обеих недель получают 'all',
    // только-нечётные — 'num'. Затем чётная: оставшиеся (не попавшие в 'all') — 'den'.
    for (const item of oddLessons) {
        const key = lessonComparisonKey(item.dayKey, item.hourNumber, item.raw);
        placeLesson(item, evenKeys.has(key) ? 'all' : 'num');
    }
    for (const item of evenLessons) {
        const key = lessonComparisonKey(item.dayKey, item.hourNumber, item.raw);
        placeLesson(item, oddKeys.has(key) ? 'all' : 'den');
    }

    const meta: ScheduleMeta = {
        tz: 'Asia/Almaty',
        parsedAt: new Date().toISOString(),
        userId: '', // заполняется сервисом при сохранении
        source: 'platonus',
        semester: {
            year: semester.year,
            term: semester.term,
            title: `${semester.year}-${semester.year + 1} • ${semester.term === 1 ? 'Осенний' : 'Весенний'} семестр (Platonus)`,
            isCurrent: semester.isCurrent ?? true,
        },
    };

    return {
        meta,
        timeSlots,
        days: OUTPUT_DAYS.map((dayKey) => ({
            name: dayKey,
            lessons: daysData[dayKey],
        })),
    };
}

/**
 * Полный путь «Platonus → Schedule»: определяет текущий семестр и неделю,
 * забирает нечётную и чётную недели одним bootstrap'ом и склеивает их
 * с вычислением чётности.
 */
export async function fetchAndParsePlatonusSchedule(
    session: PlatonusSession,
    now: Date = new Date()
): Promise<ParseResult<Omit<Schedule, '_id' | 'userId' | 'cachedAt' | 'expiresAt'>>> {
    try {
        const { year, semester: term } = getCurrentAcademicPeriod();
        const currentWeek = computeSemesterWeek(year, term, now);
        const { oddWeek, evenWeek } = pickWeekPair(currentWeek);

        console.log(
            `[Platonus Schedule] Fetching ${year}/${term}, weeks ${oddWeek} (odd) + ${evenWeek} (even), ` +
            `current week ~${currentWeek}`
        );

        const client = createPlatonusV7Client(session);
        const bootStatus = await bootstrapPlatonusV7(client);
        if (bootStatus !== 200) {
            return { success: false, error: `Platonus v7 bootstrap failed: HTTP ${bootStatus}` };
        }

        const [oddResult, evenResult] = await Promise.all([
            fetchPlatonusSchedule(session, year, term, oddWeek, client),
            fetchPlatonusSchedule(session, year, term, evenWeek, client),
        ]);

        if (oddResult.status === 401 || evenResult.status === 401) {
            return { success: false, error: 'Требуется авторизация в Platonus' };
        }
        if (!oddResult.data || !evenResult.data) {
            return {
                success: false,
                error: `Platonus schedule calculate failed: HTTP ${oddResult.status}/${evenResult.status}`,
            };
        }

        const data = parsePlatonusSchedule(oddResult.data, evenResult.data, {
            year,
            term,
            isCurrent: true,
        });

        const totalLessons = data.days.reduce(
            (sum, day) => sum + day.lessons.reduce((s, slot) => s + slot.length, 0),
            0
        );
        if (totalLessons === 0) {
            // Пустой семестр — не считаем успехом: пусть сервис уйдёт в фолбэк
            // на Univer, а не закэширует пустую сетку.
            return { success: false, error: `Platonus schedule is empty for ${year}/${term}` };
        }

        console.log(`[Platonus Schedule] Parsed ${totalLessons} lessons for ${year}/${term}`);
        return { success: true, data };
    } catch (error) {
        const summary = getPlatonusErrorSummary(error);
        console.error(`[Platonus Schedule] Error: ${summary.message}`);
        if (summary.status === 401) {
            return { success: false, error: 'Требуется авторизация в Platonus' };
        }
        return { success: false, error: summary.message };
    }
}

export default fetchAndParsePlatonusSchedule;
