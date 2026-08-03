/**
 * HTTP client for Platonus (platonus.kstu.kz)
 * Отдельный от http-client.ts (для univer.kstu.kz)
 */

import axios, { AxiosInstance } from 'axios';
import https from 'https';

export const PLATONUS_BASE_URL = 'https://platonus.kstu.kz';

export interface PlatonusSession {
    token: string;
    sid: string;
    personID: string;
    cookieString?: string;
}

export interface PlatonusSemesterOption {
    year: number;
    semester: number;
    label: string;
}

export function getPlatonusErrorSummary(error: unknown): {
    status: number | null;
    message: string;
} {
    if (axios.isAxiosError(error)) {
        const status = error.response?.status ?? null;
        const statusText = error.response?.statusText?.trim();
        const message = statusText
            ? `HTTP ${status}: ${statusText}`
            : (error.message || 'Axios request failed');
        return { status, message };
    }

    if (error instanceof Error) {
        return { status: null, message: error.message };
    }

    return { status: null, message: String(error) };
}

function logPlatonusRequestError(scope: string, error: unknown) {
    const summary = getPlatonusErrorSummary(error);
    if (summary.status === 401) {
        console.warn(`[Platonus] ${scope}: upstream 401 Unauthorized`);
        return;
    }

    console.error(`[Platonus] ${scope}: ${summary.message}`);
}

/**
 * Создает axios instance для Platonus с отключенным SSL verification
 */
function createPlatonusClient(): AxiosInstance {
    return axios.create({
        baseURL: PLATONUS_BASE_URL,
        timeout: 30000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Origin': PLATONUS_BASE_URL,
            'Referer': `${PLATONUS_BASE_URL}/`,
        },
        httpsAgent: new https.Agent({
            rejectUnauthorized: false, // Platonus использует самоподписанный сертификат
        }),
    });
}

export function getSessionHeaders(session: PlatonusSession) {
    return {
        'token': session.token,
        'sid': session.sid,
        'Accept': 'application/json, text/plain, */*',
        'Cookie': session.cookieString || `plt_sid=${session.sid}`,
    };
}

/**
 * Общий axios-клиент для v7-namespace Platonus (`/rest/schedule/...` и т.п.).
 * Отличается от createPlatonusClient() заголовками `clientId`/`Referer: /v7/` —
 * без них v7-эндпоинты отвечают 401. Используется экзаменами и расписанием.
 *
 * `validateStatus: () => true` — вызывающий код сам разбирает статусы
 * (401 = протухшая сессия, 403 = нет лицензии и т.д.).
 */
export function createPlatonusV7Client(session: PlatonusSession): AxiosInstance {
    return axios.create({
        baseURL: PLATONUS_BASE_URL,
        timeout: 30000,
        validateStatus: () => true,
        httpsAgent: new https.Agent({
            rejectUnauthorized: false, // Platonus использует самоподписанный сертификат
        }),
        headers: {
            'Accept': 'application/json, text/plain, */*',
            'Accept-Language': 'ru',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
            'Origin': PLATONUS_BASE_URL,
            'Referer': `${PLATONUS_BASE_URL}/v7/`,
            'clientId': 'null',
            'token': session.token,
            'sid': session.sid,
            'Cookie': session.cookieString || `plt_sid=${session.sid}`,
        },
    });
}

/**
 * Bootstrap v7-namespace: без предварительного `GET /v7/` сервер часто отвечает
 * 401 на `/rest/schedule/...`. Возвращает HTTP-статус страницы (200 = ок).
 */
export async function bootstrapPlatonusV7(client: AxiosInstance): Promise<number> {
    const response = await client.get('/v7/', {
        headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
    });
    return response.status;
}

export function extractYearValue(raw: unknown): number | null {
    if (typeof raw === 'number' && raw >= 2000 && raw <= 2100) {
        return raw;
    }

    if (typeof raw === 'string') {
        const match = raw.match(/(20\d{2})/);
        if (match) return Number(match[1]);
    }

    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const candidates = [
            obj.year,
            obj.studyYear,
            obj.startYear,
            obj.ID,
            obj.id,
            obj.value,
            obj.name,
            obj.label,
            obj.title,
        ];
        for (const candidate of candidates) {
            const parsed = extractYearValue(candidate);
            if (parsed) return parsed;
        }
    }

    return null;
}

export function extractSemesterValue(raw: unknown): number | null {
    if (typeof raw === 'number' && (raw === 1 || raw === 2)) {
        return raw;
    }

    if (typeof raw === 'string') {
        const value = raw.trim().toLowerCase();
        if (value === '1') return 1;
        if (value === '2') return 2;
        if (value.includes('осен')) return 1;
        if (value.includes('весен')) return 2;
    }

    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const candidates = [
            obj.semester,
            obj.term,
            obj.ID,
            obj.id,
            obj.value,
            obj.name,
            obj.label,
            obj.title,
        ];
        for (const candidate of candidates) {
            const parsed = extractSemesterValue(candidate);
            if (parsed) return parsed;
        }
    }

    return null;
}

export function extractTermLabel(raw: unknown, semester: number): string {
    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const maybeLabel = obj.name || obj.label || obj.title;
        if (typeof maybeLabel === 'string' && maybeLabel.trim().length > 0) {
            return maybeLabel.trim();
        }
    }

    return semester === 1 ? 'Осенний' : 'Весенний';
}

export function normalizeArrayPayload(raw: unknown): unknown[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') {
        const obj = raw as Record<string, unknown>;
        const nestedArray = Object.values(obj).find(Array.isArray);
        if (nestedArray && Array.isArray(nestedArray)) return nestedArray;
    }
    return [];
}

/**
 * Пытается получить динамический список семестров из Platonus API.
 * При неудаче возвращает null — вызывающий код должен использовать fallback.
 */
export async function fetchAvailableSemesters(
    session: PlatonusSession
): Promise<PlatonusSemesterOption[] | null> {
    const client = createPlatonusClient();
    const headers = getSessionHeaders(session);

    try {
        const [yearsResponse, termsResponse] = await Promise.all([
            client.get('/rest/mobile/student/studyYears/ru', { headers }),
            client.get('/rest/mobile/tutor/terms/ru', { headers }),
        ]);

        const yearItems = normalizeArrayPayload(yearsResponse.data);
        const termItems = normalizeArrayPayload(termsResponse.data);

        const years = Array.from(new Set(
            yearItems
                .map(extractYearValue)
                .filter((v): v is number => v !== null)
        )).sort((a, b) => b - a);

        const terms = Array.from(new Set(
            termItems
                .map(extractSemesterValue)
                .filter((v): v is number => v !== null)
        )).sort((a, b) => a - b);

        if (years.length === 0 || terms.length === 0) {
            console.warn('[Platonus] Failed to parse dynamic study years/terms');
            return null;
        }

        const termLabelBySemester = new Map<number, string>();
        for (const termItem of termItems) {
            const semester = extractSemesterValue(termItem);
            if (!semester || termLabelBySemester.has(semester)) continue;
            termLabelBySemester.set(semester, extractTermLabel(termItem, semester));
        }

        const semesters: PlatonusSemesterOption[] = [];
        for (const year of years) {
            for (const semester of terms) {
                const termLabel = termLabelBySemester.get(semester) || (semester === 1 ? 'Осенний' : 'Весенний');
                semesters.push({
                    year,
                    semester,
                    label: `${year}/${year + 1} — ${termLabel}`,
                });
            }
        }

        return semesters;
    } catch (error) {
        const summary = getPlatonusErrorSummary(error);
        if (summary.status !== 401) {
            console.warn(`[Platonus] Dynamic semesters fetch failed: ${summary.message}`);
        }
        return null;
    }
}

/**
 * Авторизация в Platonus
 * @returns Session data (token, sid, personID) или null при ошибке
 */
export async function platonusLogin(username: string, password: string): Promise<PlatonusSession | null> {
    const client = createPlatonusClient();

    try {
        console.log(`[Platonus] Logging in as ${username}...`);

        // 1. POST /rest/api/login
        const loginResponse = await client.post('/rest/api/login', {
            login: username,
            password: password,
            iin: null,
            icNumber: null,
            authForDeductedStudentsAndGraduates: 'false',
        }, {
            headers: {
                'Content-Type': 'application/json; charset=UTF-8',
            },
        });

        const authData = loginResponse.data;
        const token = authData.auth_token || authData.token;
        const setCookie = loginResponse.headers['set-cookie'] || [];
        const cookieString = setCookie.map((c: string) => c.split(';')[0]).join('; ');

        let sid = authData.sid;

        // Если sid нет в JSON, берём из cookies
        if (!sid) {
            const sidCookie = setCookie.find((c: string) => c.startsWith('plt_sid='));
            if (sidCookie) {
                sid = sidCookie.split(';')[0].split('=')[1];
            }
        }

        if (!token) {
            console.error('[Platonus] Token not found in response');
            return null;
        }

        console.log('[Platonus] Login successful');

        // 2. GET /rest/api/person/personID
        const idResponse = await client.get('/rest/api/person/personID', {
            headers: {
                'token': token,
                'sid': sid || '',
                'Cookie': cookieString,
            },
        });

        let personID: string;
        try {
            const idJson = idResponse.data;
            if (typeof idJson === 'object' && idJson !== null) {
                personID = String(idJson.personID);
            } else {
                personID = String(idJson).replace(/"/g, '');
            }
        } catch {
            personID = String(idResponse.data).replace(/"/g, '');
        }

        console.log(`[Platonus] Got person ID: ${personID}`);

        return {
            token,
            sid: sid || '',
            personID,
            cookieString,
        };
    } catch (error) {
        logPlatonusRequestError('Login error', error);
        return null;
    }
}

/**
 * Получение данных журнала (оценок) из Platonus
 * @param session - Session data from platonusLogin
 * @param year - Учебный год (например, 2025)
 * @param semester - Семестр (1 или 2)
 * @returns JSON data from /journal endpoint
 */
export async function fetchJournal(
    session: PlatonusSession,
    year: number,
    semester: number
): Promise<any> {
    const client = createPlatonusClient();

    try {
        const journalUrl = `/journal/${year}/${semester}/${session.personID}`;
        console.log(`[Platonus] Fetching journal: ${journalUrl}`);

        const response = await client.get(journalUrl, {
            headers: getSessionHeaders(session),
        });

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = response.data;
        console.log(`[Platonus] Journal response type: ${typeof data}, isArray: ${Array.isArray(data)}`);
        if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
            console.log(`[Platonus] Journal response keys: ${Object.keys(data).join(', ')}`);
        }
        if (Array.isArray(data)) {
            console.log(`[Platonus] Journal items count: ${data.length}`);
        }
        console.log('[Platonus] Journal fetched successfully');
        return data;
    } catch (error) {
        logPlatonusRequestError('Fetch journal error', error);
        throw error;
    }
}

/**
 * Загрузить детальные оценки по предмету
 */
export async function fetchDetailedSubject(
    session: PlatonusSession,
    year: number,
    semester: number,
    subjectId: string,
    queryId: string
): Promise<any> {
    const client = createPlatonusClient();
    const url = `/subject/${year}/${semester}/${subjectId}/${session.personID}?queryID=${queryId}`;

    try {
        console.log(`[Platonus] Fetching detailed subject: ${url}`);
        const response = await client.get(url, {
            headers: getSessionHeaders(session),
        });

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}`);
        }

        return response.data;
    } catch (error) {
        logPlatonusRequestError('Fetch detailed subject error', error);
        throw error;
    }
}
/**
 * Загрузить GPA из транскрипта
 */
export interface TranscriptMetaData {
    gpa: number;
    overallGpa: number;
    groupName?: string;
    termGpaMap?: Record<string, number>;
    courseGpaMap?: Record<string, number>;
}

export interface PlatonusCalendarEvent {
    type?: string;
    title?: string;
    description?: string;
    start?: string | number;
    end?: string | number;
    allDay?: boolean;
    my?: boolean;
}

export async function fetchTranscriptGPA(session: PlatonusSession): Promise<TranscriptMetaData | null> {
    const client = createPlatonusClient();
    const url = `/rest/transcript/load/ru/0`;

    try {
        console.log(`[Platonus] Fetching transcript GPA...`);
        const payload = {
            "showDeletedRecords": false,
            "showAllRecords": false,
            "showRewritableDisciplines": false,
            "showRetakenRecords": true,
            "printVersionID": 0,
            "languageID": 0,
            "courseNumber": [],
            "term": -1,
            "includeSubjectCodes": false,
            "includeSubjectUnderStudy": true,
            "includeSubjectAdditional": false,
            "includeSubjectAcademicDifference": false,
            "showRetakeSubjectsWithStar": true,
            "includeMoveOrder": false
        };

        const response = await client.post(url, payload, {
            headers: {
                ...getSessionHeaders(session),
                'Content-Type': 'application/json',
            },
        });

        console.log(`[Platonus] Transcript GPA Response Status: ${response.status}`);

        if (response.status !== 200) {
            console.error(`[Platonus] Transcript HTTP ${response.status}`, response.data);
            throw new Error(`HTTP ${response.status}`);
        }

        const data = response.data;
        if (!data || typeof data !== 'object') {
            return null;
        }

        const termGpaMap: Record<string, number> = data.termGpaMap || {};
        const courseGpaMap: Record<string, number> = data.courseGpaMap || {};

        const asFiniteNumber = (value: unknown): number | null => {
            if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
            if (typeof value === 'string') {
                const normalized = value.replace(',', '.').trim();
                const parsed = Number(normalized);
                if (Number.isFinite(parsed) && parsed > 0) return parsed;
            }
            return null;
        };

        // Официальный GPA в ответе обычно в student.GPA / student.gpa / transcript.gpa
        // Именно это значение отображается в интерфейсе Платонуса и должно быть приоритетным.
        const officialGpa =
            asFiniteNumber(data?.student?.GPA) ??
            asFiniteNumber(data?.student?.gpa) ??
            asFiniteNumber(data?.transcript?.gpa) ??
            asFiniteNumber(data?.GPA);

        // Резервный расчет (если официальное поле не пришло)
        const courseValues = Object
            .values(courseGpaMap)
            .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
        const calculatedGpa = courseValues.length > 0
            ? courseValues.reduce((sum, val) => sum + val, 0) / courseValues.length
            : null;

        const resolvedGpa = officialGpa ?? calculatedGpa;
        if (!resolvedGpa) {
            console.warn('[Platonus] Transcript payload has no usable GPA');
            return null;
        }
        const rawGroupName = data?.student?.groupName;
        const groupName = typeof rawGroupName === 'string' && rawGroupName.trim().length > 0
            ? rawGroupName.trim()
            : undefined;

        console.log('[Platonus] GPA fields:', {
            studentGPA: data?.student?.GPA,
            studentGpa: data?.student?.gpa,
            transcriptGpa: data?.transcript?.gpa,
            groupName,
            fallbackCourseAverage: calculatedGpa,
            resolved: resolvedGpa,
            source: officialGpa ? 'official' : 'course-average-fallback',
        });
        console.log(`[Platonus] termGpaMap:`, termGpaMap);

        return {
            gpa: resolvedGpa,
            overallGpa: resolvedGpa,
            groupName,
            termGpaMap,
            courseGpaMap,
        };
    } catch (error) {
        logPlatonusRequestError('Fetch transcript GPA error', error);
        return null;
    }
}

export async function fetchCalendarEvents(session: PlatonusSession): Promise<PlatonusCalendarEvent[] | null> {
    const client = createPlatonusClient();
    const url = '/rest/welcome/calendarEvents/ru';

    try {
        const response = await client.get(url, {
            headers: getSessionHeaders(session),
        });

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}`);
        }

        if (!Array.isArray(response.data)) {
            return null;
        }

        return response.data as PlatonusCalendarEvent[];
    } catch (error) {
        logPlatonusRequestError('Fetch calendar events error', error);
        return null;
    }
}

/**
 * Определяет текущий учебный год и семестр.
 *
 * ЕДИНСТВЕННЫЙ источник истины для «текущего академического периода» на
 * бэкенде (grades/exams/schedule/umkd/admin-hydration). Фронтовая копия с
 * той же семантикой — `frontend/src/lib/platonus-semesters.ts`
 * (`getCurrentAcademicSemesterFromDate`); при изменении границ месяцев
 * менять ОБЕ стороны и их тесты синхронно.
 *
 * Семантика по месяцам:
 * - сентябрь–ноябрь → осень {Y, 1};
 * - декабрь         → осень {Y, 1} — конец теории и зимняя экзаменационная
 *   сессия осеннего семестра (не каникулы);
 * - январь          → осень {Y-1, 1} — хвост зимней сессии/довыставление
 *   итогов; весенний семестр стартует только ~20 января;
 * - февраль–июнь    → весна {Y-1, 2};
 * - июль–август     → осень {Y, 1} — предстоящий (предикт на новый учебный год).
 */
export function getCurrentAcademicPeriod(): { year: number; semester: number } {
    const now = new Date();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentYear = now.getFullYear();

    let semester: number;
    let academicYear: number;

    if (currentMonth >= 2 && currentMonth <= 6) {
        // Февраль-июнь: 2 семестр (весенний), учебный год начался прошлой осенью
        semester = 2;
        academicYear = currentYear - 1;
    } else if (currentMonth === 1) {
        // Январь: зимняя сессия осеннего семестра ещё идёт → осень прошлого года
        semester = 1;
        academicYear = currentYear - 1;
    } else {
        // Июль-декабрь: осенний семестр текущего года
        // (июль-август — предстоящий, сентябрь-ноябрь — теория, декабрь — сессия)
        semester = 1;
        academicYear = currentYear;
    }

    return { year: academicYear, semester };
}
