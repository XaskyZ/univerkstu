/**
 * Парсер оценок из Platonus
 * Основан на test_grades.py
 */

import { platonusLogin, fetchJournal, getCurrentAcademicPeriod, PlatonusSession, fetchTranscriptGPA, fetchCalendarEvents, type PlatonusCalendarEvent } from './platonus-client.js';
import { ParseGradesResult, GradesData, SubjectGrade, SubjectKind, Subject, DetailedGrade } from '../types/grades.js';

// Однозначные длинные подстроки — ищем через `includes`.
const COURSEWORK_MARKERS_LOOSE = [
    'курсов',
    'course work',
    'coursework',
    'course project',
    'курстық',
    'курсовой проект',
    'курс. проект',
];

// Короткие аббревиатуры — нужны границы слов, иначе ловят что попало.
// JS `\b` ASCII-only, поэтому делаем границы через `\p{L}`.
const COURSEWORK_MARKERS_TIGHT: RegExp[] = [
    /(?:^|[^\p{L}])кп(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])кр(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])жоба(?:[^\p{L}]|$)/u, // казахский: проект
];

// Ловим формы "практика/практики/практику/практике/практикой", но НЕ "практикум",
// "практический", "практикант" и пр.
const PRACTICE_PATTERNS: RegExp[] = [
    /(?:^|[^\p{L}])практик(?:а|и|у|е|ой)(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])тәжірибе/u,
    /(?:^|[^\p{L}])practice(?:[^\p{L}]|$)/u,
    /(?:^|[^\p{L}])интернатура/u,
];

/**
 * Классифицирует тип предмета по названию и коду.
 * У курсовой и практики нет экзамена — итог хранится в Рейтинг/total.
 */
export function classifySubjectKind(name: string, code?: string): SubjectKind {
    const haystack = `${name || ''} ${code || ''}`.toLowerCase();

    if (COURSEWORK_MARKERS_LOOSE.some((marker) => haystack.includes(marker))) {
        return 'coursework';
    }

    if (COURSEWORK_MARKERS_TIGHT.some((pattern) => pattern.test(haystack))) {
        return 'coursework';
    }

    if (PRACTICE_PATTERNS.some((pattern) => pattern.test(haystack))) {
        return 'practice';
    }

    return 'regular';
}

export function normalizeExamMatchValue(value?: string | null): string {
    return (value || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .replace(/[()]/g, ' ')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function resolveCalendarExamDate(
    subjectName: string,
    subjectCode: string | undefined,
    events: PlatonusCalendarEvent[] | null
): string | undefined {
    if (!events || events.length === 0) return undefined;

    const normalizedName = normalizeExamMatchValue(subjectName);
    const normalizedCode = normalizeExamMatchValue(subjectCode);

    const matchedEvent = events.find((event) => {
        if (String(event.type || '').toLowerCase() !== 'exam') return false;
        const haystack = normalizeExamMatchValue(`${event.title || ''} ${event.description || ''}`);
        if (!haystack) return false;
        if (normalizedCode && haystack.includes(normalizedCode)) return true;
        return normalizedName.length > 0 && haystack.includes(normalizedName);
    });

    if (!matchedEvent?.start) return undefined;

    const startMs = typeof matchedEvent.start === 'number'
        ? matchedEvent.start
        : Number(matchedEvent.start);

    if (!Number.isFinite(startMs)) return undefined;
    return new Date(startMs).toISOString();
}

/**
 * Извлекает итоговую оценку из данных предмета
 * Приоритет: totalMark → centerMark → totalScore → total → "-"
 */
export function extractTotalMark(item: Subject): string {
    let total = item.totalMark;

    if (!total || total === '-') {
        total = item.centerMark;
    }

    if (!total || total === '-') {
        total = item.totalScore || item.total || '-';
    }

    return String(total);
}

/**
 * Парсит массив экзаменов и извлекает РК1, РК2, Рейтинг, Экзамен.
 *
 * Дополнительно возвращает `inferredKind` — сильный сигнал классификации,
 * который Platonus сам прокидывает через имя слота:
 *   - `Курс.р.` / `Курс.п.` → coursework (даже если код предмета `--L`)
 *
 * Реальная оценка из `Курс.р.` (если она >0 и `Рейтинг` пуст) поднимается
 * в `Рейтинг`, чтобы фронтенд видел итог курсовой в стандартном месте.
 */
export function extractExamMarks(exams: any[]): {
    rk1: string;
    rk2: string;
    rating: string;
    exam: string;
    inferredKind: SubjectKind | null;
} {
    let rk1 = '-';
    let rk2 = '-';
    let rating = '-';
    let exam = '-';
    let inferredKind: SubjectKind | null = null;
    let courseworkRaw: string | null = null;

    if (!Array.isArray(exams)) {
        return { rk1, rk2, rating, exam, inferredKind };
    }

    for (const ex of exams) {
        const name = ex.name || '';
        const mark = String(ex.mark || '-');

        if (name === 'РК 1') {
            rk1 = mark;
        } else if (name === 'РК 2') {
            rk2 = mark;
        } else if (name === 'Рейтинг') {
            rating = mark;
        } else if (name === 'Экз.') {
            exam = mark;
        } else if (name === 'Курс.р.' || name === 'Курс.п.') {
            inferredKind = 'coursework';
            courseworkRaw = mark;
        }
    }

    const ratingIsEmpty = !rating || rating === '-' || rating === '0';
    const courseworkIsMeaningful = courseworkRaw && courseworkRaw !== '-' && courseworkRaw !== '0';
    if (ratingIsEmpty && courseworkIsMeaningful) {
        rating = courseworkRaw as string;
    }

    return { rk1, rk2, rating, exam, inferredKind };
}

/**
 * Парсит оценки студента из Platonus
 * @param username - Логин Platonus (формат: Фамилия_Имя)
 * @param password - Пароль Platonus
 * @returns ParseGradesResult с данными оценок
 */
export async function parseGrades(username: string, password: string): Promise<ParseGradesResult> {
    try {
        console.log('[Grades Parser] Starting...');

        // 1. Авторизация в Platonus
        const session = await platonusLogin(username, password);
        if (!session) {
            return {
                success: false,
                error: 'Ошибка авторизации в Platonus. Проверьте логин и пароль.',
            };
        }

        // 2. Определяем текущий период
        const { year, semester } = getCurrentAcademicPeriod();
        console.log(`[Grades Parser] Current period: ${year}/${semester}`);

        // 3. Загружаем журнал
        const rawData = await fetchJournal(session, year, semester);

        if (!Array.isArray(rawData)) {
            return {
                success: false,
                error: 'Некорректный формат данных от Platonus',
            };
        }

        // 4. Парсим данные
        const subjects: SubjectGrade[] = [];

        for (const item of rawData) {
            const rawName = item.subjectName || 'Неизвестный предмет';
            let name = rawName;
            let code: string | undefined = undefined;

            // "Экология и безопасность жизнедеятельности(ETK 1110-60--L)" -> name, code
            const match = rawName.match(/^(.*?)\((.*?)\)$/);
            if (match) {
                name = match[1].trim();
                code = match[2].trim();
            }

            let tutors: string[] | undefined = undefined;
            if (item.tutorList) {
                tutors = item.tutorList.split(',').map((t: string) => t.trim());
            }

            const { rk1, rk2, rating, exam, inferredKind } = extractExamMarks(item.exams || []);
            const total = extractTotalMark(item);
            const kind: SubjectKind = inferredKind ?? classifySubjectKind(name, code);

            subjects.push({
                name,
                code,
                tutors,
                kind,
                rk1,
                rk2,
                rating,
                exam,
                total,
            });
        }

        const gradesData: GradesData = {
            meta: {
                parsedAt: new Date().toISOString(),
                year,
                semester,
                totalSubjects: subjects.length,
            },
            subjects,
        };

        console.log(`[Grades Parser] Successfully parsed ${subjects.length} subjects`);

        return {
            success: true,
            data: gradesData,
        };
    } catch (error) {
        console.error('[Grades Parser] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Парсит оценки используя существующую сессию (без повторного логина)
 * @param session - Активная PlatonusSession
 * @param year - Учебный год
 * @param semester - Семестр (1 или 2)
 */
export async function parseGradesWithSession(
    session: PlatonusSession,
    year: number,
    semester: number
): Promise<ParseGradesResult> {
    try {
        console.log(`[Grades Parser] Fetching grades for ${year}/${semester} with cached session...`);

        // Запускаем параллельно загрузку журнала и транскрипта (для GPA)
        const [rawData, transcriptData, calendarEvents] = await Promise.all([
            fetchJournal(session, year, semester),
            fetchTranscriptGPA(session).catch(() => null),
            fetchCalendarEvents(session).catch(() => null),
        ]);

        if (!Array.isArray(rawData)) {
            return {
                success: false,
                error: 'Некорректный формат данных от Platonus',
            };
        }

        const subjects: SubjectGrade[] = [];

        for (const item of rawData) {
            const rawName = item.subjectName || 'Неизвестный предмет';
            let name = rawName;
            let code: string | undefined = undefined;

            // "Экология и безопасность жизнедеятельности(ETK 1110-60--L)" -> name, code
            const match = rawName.match(/^(.*?)\((.*?)\)$/);
            if (match) {
                name = match[1].trim();
                code = match[2].trim();
            }

            let tutors: string[] | undefined = undefined;
            if (item.tutorList) {
                tutors = item.tutorList.split(',').map((t: string) => t.trim());
            }

            const { rk1, rk2, rating, exam, inferredKind } = extractExamMarks(item.exams || []);
            const total = extractTotalMark(item);
            const kind: SubjectKind = inferredKind ?? classifySubjectKind(name, code);

            subjects.push({
                name,
                code,
                tutors,
                kind,
                rk1,
                rk2,
                rating,
                exam,
                total,
                examDate: resolveCalendarExamDate(name, code, calendarEvents),
                subjectID: String(item.subjectID || ''),
                queryID: String(item.queryID || ''),
            });
        }

        // Извлекаем GPA из транскрипта
        let gpa: number | undefined = undefined;
        let overallGpa: number | undefined = undefined;
        let groupName: string | undefined = undefined;
        let termGpaMap: Record<string, number> | undefined = undefined;
        let courseGpaMap: Record<string, number> | undefined = undefined;

        if (transcriptData) {
            overallGpa = transcriptData.overallGpa;
            gpa = overallGpa;
            groupName = transcriptData.groupName;
            // termGpaMap/courseGpaMap are already shaped Record<string, number>
            // by fetchTranscriptGPA. Drop empty maps so the UI can rely on
            // a truthy check to decide whether to render the history chart.
            if (transcriptData.termGpaMap && Object.keys(transcriptData.termGpaMap).length > 0) {
                termGpaMap = transcriptData.termGpaMap;
            }
            if (transcriptData.courseGpaMap && Object.keys(transcriptData.courseGpaMap).length > 0) {
                courseGpaMap = transcriptData.courseGpaMap;
            }
            console.log(`[Grades Parser] GPA from transcript: ${gpa}`);
            if (groupName) {
                console.log(`[Grades Parser] Group from transcript: ${groupName}`);
            }
        } else {
            console.log(`[Grades Parser] transcriptData is null, no GPA available`);
        }

        const gradesData: GradesData = {
            meta: {
                parsedAt: new Date().toISOString(),
                year,
                semester,
                totalSubjects: subjects.length,
                gpa,
                overallGpa,
                groupName,
                termGpaMap,
                courseGpaMap,
            },
            subjects,
        };

        console.log(`[Grades Parser] Successfully parsed ${subjects.length} subjects for ${year}/${semester}`);

        return {
            success: true,
            data: gradesData,
        };
    } catch (error) {
        console.error('[Grades Parser] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Разбирает ответ от /subject/... (детальные оценки) в плоский массив
 */
export function extractDetailedGrades(rawData: any[]): DetailedGrade[] {
    const details: DetailedGrade[] = [];

    if (!Array.isArray(rawData) || rawData.length === 0) return details;

    for (const item of rawData) {
        if (!item.Marks) continue;
        const itemTitle = getDetailedGradeTitle(item);
        const itemTeacher = getDetailedGradeTeacher(item);

        // iter over months objects
        for (const monthKey of Object.keys(item.Marks)) {
            const monthObj = item.Marks[monthKey];
            if (!monthObj || !monthObj.Marks) continue;
            const monthLabel = getDetailedGradeMonthLabel(monthObj, monthKey);

            // iter over days objects
            for (const dayKey of Object.keys(monthObj.Marks)) {
                const dayMarks = monthObj.Marks[dayKey];
                if (!Array.isArray(dayMarks)) continue;

                // iter over marks in day
                for (const markObj of dayMarks) {
                    const resolvedMark = parseDetailedGradeMark(markObj);
                    if (resolvedMark === null) continue;
                    const markTitle = getDetailedGradeMarkTitle(markObj) || itemTitle;
                    const markTeacher = getDetailedGradeMarkTeacher(markObj) || itemTeacher;

                    details.push({
                        date: markObj.MarkDate?.DisplayedValue || `${dayKey}-${monthKey}-XXXX`,
                        mark: resolvedMark,
                        type: getDetailedGradeType(markObj),
                        title: markTitle,
                        month: monthLabel,
                        teacher: markTeacher,
                        comment: getDetailedGradeComment(markObj),
                    });
                }
            }
        }
    }

    // Sort by date visually or realistically (DD-MM-YYYY)
    // DisplayedValue looks like: 25-09-2025
    details.sort((a, b) => {
        const parseDate = (dString: string) => {
            const parts = dString.split('-');
            if (parts.length === 3) {
                // YYYY-MM-DD for JS Date
                return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
            }
            return 0;
        };
        return parseDate(b.date) - parseDate(a.date); // newest first
    });

    return details;
}

export function parseDetailedGradeMark(markObj: any): number | null {
    if (typeof markObj?.Mark === 'number' && Number.isFinite(markObj.Mark)) {
        return markObj.Mark;
    }

    const raw = String(markObj?.MarkName || markObj?.Mark || '').replace(',', '.').trim();
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
}

export function getDetailedGradeType(markObj: any): string {
    const namedType = [
        markObj?.MarkTypeName,
        markObj?.TypeName,
        markObj?.ControlTypeName,
        markObj?.WorkTypeName,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);

    if (namedType) {
        return namedType.trim();
    }

    if (markObj?.MarkType === 1) return 'Текущая';
    if (markObj?.MarkType === 2) return 'РК';
    if (markObj?.MarkType === 3) return 'Экзамен';
    return 'Оценка';
}

export function getDetailedGradeTitle(item: any): string | null {
    const candidate = [
        item?.Name,
        item?.name,
        item?.Title,
        item?.title,
        item?.SubjectName,
        item?.subjectName,
        item?.WorkName,
        item?.workName,
        item?.ControlName,
        item?.controlName,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);

    return candidate ? candidate.trim() : null;
}

export function getDetailedGradeTeacher(item: any): string | null {
    const candidate = [
        item?.Teacher,
        item?.teacher,
        item?.TeacherName,
        item?.teacherName,
        item?.TutorFullName,
        item?.tutorFullName,
        item?.TutorName,
        item?.tutorName,
        item?.Tutor,
        item?.tutor,
        item?.EmployeeName,
        item?.employeeName,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);

    return candidate ? candidate.trim() : null;
}

export function getDetailedGradeMarkTeacher(markObj: any): string | null {
    const candidate = [
        markObj?.Teacher,
        markObj?.teacher,
        markObj?.TeacherName,
        markObj?.teacherName,
        markObj?.TutorFullName,
        markObj?.tutorFullName,
        markObj?.TutorName,
        markObj?.tutorName,
        markObj?.EmployeeName,
        markObj?.employeeName,
        markObj?.CreatedByName,
        markObj?.createdByName,
        markObj?.CreatedEmployeeName,
        markObj?.createdEmployeeName,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);

    return candidate ? candidate.trim() : null;
}

export function getDetailedGradeMarkTitle(markObj: any): string | null {
    const candidate = [
        markObj?.Name,
        markObj?.name,
        markObj?.Title,
        markObj?.title,
        markObj?.WorkName,
        markObj?.workName,
        markObj?.ControlName,
        markObj?.controlName,
        markObj?.TaskName,
        markObj?.taskName,
        markObj?.LessonTopic,
        markObj?.lessonTopic,
        markObj?.Topic,
        markObj?.topic,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);

    return candidate ? candidate.trim() : null;
}

export function getDetailedGradeComment(markObj: any): string | null {
    const candidate = [
        markObj?.Comment,
        markObj?.comment,
        markObj?.Description,
        markObj?.description,
        markObj?.Note,
        markObj?.note,
        markObj?.Reason,
        markObj?.reason,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);

    return candidate ? candidate.trim() : null;
}

export function getDetailedGradeMonthLabel(monthObj: any, fallbackKey: string): string | null {
    const candidate = [
        monthObj?.MonthName,
        monthObj?.monthName,
        monthObj?.Title,
        monthObj?.title,
        monthObj?.DisplayedValue,
        monthObj?.displayedValue,
    ].find((value) => typeof value === 'string' && value.trim().length > 0);

    if (candidate) {
        return candidate.trim();
    }

    const asNumber = Number(fallbackKey);
    if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= 12) {
        return [
            'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
            'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
        ][asNumber - 1];
    }

    return fallbackKey || null;
}

export default parseGrades;
