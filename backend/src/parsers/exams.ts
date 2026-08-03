/**
 * Парсер экзаменов Platonus v7
 * Использует JSON endpoint'ы student/exam/* вместо старой HTML страницы.
 */

import axios from 'axios';
import {
    Exams,
    Exam,
    ExamDateTime,
    ParseResult,
} from '../types/index.js';
import {
    bootstrapPlatonusV7,
    createPlatonusV7Client,
    getCurrentAcademicPeriod,
    platonusLogin,
} from './platonus-client.js';

type SupportedLanguage = 'ru' | 'kz' | 'en';

interface ExamScheduleRow {
    examTimetableID?: number;
    examDate?: {
        date2?: string;
        displayedValue?: string;
        timestamp?: string;
        time?: string;
    };
    examTime?: string;
    subjectName?: string;
    tutorName?: string;
    examType?: string;
    additional?: boolean;
    onlineExam?: boolean;
    finalExam?: boolean;
    stateExam?: boolean;
    examDateTime?: string;
    studyGroupName?: string;
    buildingName?: string;
    auditoryName?: string;
}

export interface ExamInitialResponse {
    selectedExamType?: number;
    selectedYear?: number;
    selectedTerm?: number;
    yearList?: number[];
    termList?: Array<{
        name?: string;
        ID?: number;
        id?: number;
    }>;
    examSchedules?: ExamScheduleRow[];
    finalExam?: boolean;
    stateExam?: boolean;
}

interface ExamCalculateResponse {
    examSchedules?: ExamScheduleRow[];
}

function resolveLanguage(language?: string): SupportedLanguage {
    if (language === 'kz' || language === 'en') return language;
    return 'ru';
}

export function parseExamDatetime(dateText?: string, timeRange?: string): ExamDateTime | null {
    if (!dateText) return null;

    const normalizedDate = dateText.replace(/-/g, '.').trim();
    const dateMatch = normalizedDate.match(/(\d{2})\.(\d{2})\.(\d{4})/);
    if (!dateMatch) return null;

    const [, day, month, year] = dateMatch;
    const timeMatch = (timeRange || '').match(/(\d{2}):(\d{2})/);
    const hour = timeMatch?.[1] || '00';
    const minute = timeMatch?.[2] || '00';

    return {
        date: `${year}-${month}-${day}`,
        time: `${hour}:${minute}`,
        displayDate: `${day}.${month}.${year}`,
        displayTime: `${hour}:${minute}`,
        iso: `${year}-${month}-${day}T${hour}:${minute}:00`,
    };
}

export interface ParseExamRowOptions {
    /** Session-wide flags from `ExamInitialResponse` (apply to every row). */
    finalExam?: boolean;
    stateExam?: boolean;
}

export function parseExamRow(row: ExamScheduleRow, options: ParseExamRowOptions = {}): Exam {
    const format = (row.examType || '').trim();
    const type = row.additional
        ? 'Дополнительный'
        : (row.onlineExam ? 'Онлайн' : '');
    const datetime = parseExamDatetime(
        row.examDate?.date2 || row.examDate?.displayedValue,
        row.examTime
    );

    const locationParts = [row.buildingName, row.auditoryName].filter(Boolean);

    // Row-level booleans win; session-level flags fill in when row is silent.
    const online = Boolean(row.onlineExam);
    const additional = Boolean(row.additional);
    const final = Boolean(row.finalExam ?? options.finalExam);
    const state = Boolean(row.stateExam ?? options.stateExam);

    const flags = {
        ...(online ? { online: true } : {}),
        ...(additional ? { additional: true } : {}),
        ...(final ? { final: true } : {}),
        ...(state ? { state: true } : {}),
    };

    const exam: Exam = {
        subject: (row.subjectName || '').trim(),
        teacher: (row.tutorName || '').trim(),
        type,
        format,
        building: (row.buildingName || '').trim(),
        room: (row.auditoryName || '').trim(),
        locationRaw: locationParts.join(', '),
        groupType: (row.studyGroupName || '').trim(),
        datetime,
    };

    if (Object.keys(flags).length > 0) {
        exam.flags = flags;
    }

    return exam;
}

export function resolveTargetTerm(initial: ExamInitialResponse): { year: number; semester: number } {
    const current = getCurrentAcademicPeriod();
    const availableYears = Array.isArray(initial.yearList) ? initial.yearList : [];
    const availableTerms = Array.isArray(initial.termList)
        ? initial.termList
            .map((item) => item.ID ?? item.id)
            .filter((value): value is number => value === 1 || value === 2)
        : [];

    const year = availableYears.includes(current.year)
        ? current.year
        : (typeof initial.selectedYear === 'number' ? initial.selectedYear : current.year);

    const semester = availableTerms.includes(current.semester)
        ? current.semester
        : (typeof initial.selectedTerm === 'number' && (initial.selectedTerm === 1 || initial.selectedTerm === 2)
            ? initial.selectedTerm
            : current.semester);

    return { year, semester };
}

export function buildSemesterTitle(year: number, semester: number, language: SupportedLanguage): string {
    const termLabels = {
        ru: semester === 1 ? '1 семестр' : '2 семестр',
        kz: semester === 1 ? '1 семестр' : '2 семестр',
        en: semester === 1 ? 'Semester 1' : 'Semester 2',
    } as const;

    return `${year}/${year + 1} • ${termLabels[language]}`;
}

/**
 * Основная функция парсинга экзаменов через Platonus v7.
 */
export async function parseExams(
    platonusUsername: string,
    platonusPassword: string,
    language?: string
): Promise<ParseResult<Omit<Exams, '_id' | 'userId' | 'cachedAt' | 'expiresAt'>>> {
    try {
        const endpointLanguage = resolveLanguage(language);
        console.log(`[Exams Parser] Starting Platonus v7 fetch for ${platonusUsername} (${endpointLanguage})...`);

        const session = await platonusLogin(platonusUsername, platonusPassword);
        if (!session?.token || !session.sid) {
            return {
                success: false,
                error: 'Требуется авторизация в Platonus',
            };
        }

        // Общий v7-клиент (тот же, что у расписания): headers clientId/Referer + bootstrap /v7/.
        const client = createPlatonusV7Client(session);

        // Без открытия /v7/ новые exam endpoint'ы часто отдают 401.
        const landingStatus = await bootstrapPlatonusV7(client);
        if (landingStatus !== 200) {
            return {
                success: false,
                error: `Platonus v7 bootstrap failed: HTTP ${landingStatus}`,
            };
        }

        const initialResponse = await client.get<ExamInitialResponse>(
            `/rest/schedule/userSchedule/student/exam/initial/0/${endpointLanguage}`
        );

        if (initialResponse.status === 401) {
            return {
                success: false,
                error: 'Требуется авторизация в Platonus',
            };
        }
        if (initialResponse.status !== 200 || !initialResponse.data || typeof initialResponse.data !== 'object') {
            return {
                success: false,
                error: `Platonus exams initial failed: HTTP ${initialResponse.status}`,
            };
        }

        const { year, semester } = resolveTargetTerm(initialResponse.data);
        const calculateResponse = await client.get<ExamCalculateResponse>(
            `/rest/schedule/userSchedule/student/exam/calculate/0/0/${year}/${semester}/${endpointLanguage}`
        );

        if (calculateResponse.status === 401) {
            return {
                success: false,
                error: 'Требуется авторизация в Platonus',
            };
        }
        if (calculateResponse.status !== 200 || !calculateResponse.data || typeof calculateResponse.data !== 'object') {
            return {
                success: false,
                error: `Platonus exams calculate failed: HTTP ${calculateResponse.status}`,
            };
        }

        const rows = Array.isArray(calculateResponse.data.examSchedules)
            ? calculateResponse.data.examSchedules
            : [];
        const sessionFlags: ParseExamRowOptions = {
            finalExam: initialResponse.data.finalExam,
            stateExam: initialResponse.data.stateExam,
        };
        const exams = rows.map((row) => parseExamRow(row, sessionFlags)).filter((exam) => exam.subject);

        console.log(`[Exams Parser] Found ${exams.length} exams for ${year}/${semester}`);

        return {
            success: true,
            data: {
                exams,
                meta: {
                    parsedAt: new Date().toISOString(),
                    totalExams: exams.length,
                    semesterInfo: {
                        title: buildSemesterTitle(year, semester, endpointLanguage),
                    },
                    userId: '',
                },
            },
        };
    } catch (error) {
        console.error('[Exams Parser] Error:', error);
        if (axios.isAxiosError(error) && error.response?.status === 401) {
            return {
                success: false,
                error: 'Требуется авторизация в Platonus',
            };
        }
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export default parseExams;
