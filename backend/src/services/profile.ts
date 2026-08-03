/**
 * Profile Service - сервис для получения и кэширования профиля студента
 * Использует HTTP вместо Playwright
 */

import { login, switchToRussian } from '../parsers/http-client.js';
import {
    parseAdvisor,
    parseAcademicOptions,
    parseAttestation,
    parseEducPlan,
    parseIUP,
    parsePractice,
    parseProfile,
    parseRecbook,
    parseTranscript,
    type StudentAdvisor,
    type StudentPractice,
    type StudentProfile,
    type StudentRecbook,
    type StudentTranscript,
    type StudentEducPlan,
    type StudentAcademicOptions,
    type IUP,
    type Attestation,
} from '../parsers/profile.js';
import { getCachedData, setCachedData } from '../db/mongo.js';
import { parseTermLabel, recordUserSubjectGrades } from './subject-grades.js';

const PROFILE_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 часа

export interface FullProfile {
    profile: StudentProfile;
    iup: IUP;
    attestation: Attestation;
    transcript: StudentTranscript | null;
    recbook: StudentRecbook | null;
    practice: StudentPractice | null;
    advisor: StudentAdvisor | null;
    educPlan: StudentEducPlan | null;
    academicOptions: StudentAcademicOptions | null;
    cachedAt: string;
    expiresAt: string;
}

/**
 * Получить профиль (из кэша или парсинг)
 */
export async function getProfile(
    userId: string,
    password: string,
    forceRefresh = false
): Promise<FullProfile> {
    const cacheKey = `profile_${userId}`;

    // Проверяем кэш
    if (!forceRefresh) {
        const cached = await getCachedData<FullProfile>(cacheKey);
        if (cached) {
            console.log(`[Profile] Cache hit for ${userId}`);
            return cached;
        }
    }

    console.log(`[Profile] Parsing profile for ${userId}...`);

    // Авторизация через HTTP
    const cookies = await login(userId, password);
    if (!cookies) {
        throw new Error('Ошибка авторизации. Проверьте логин и пароль.');
    }

    // Переключаем на русский
    const cookiesRu = await switchToRussian(cookies);

    // Парсим профиль параллельно
    const [profile, iup, attestation, transcript, recbook, practice, advisor, educPlan, academicOptions] = await Promise.all([
        parseProfile(cookiesRu),
        parseIUP(cookiesRu),
        parseAttestation(cookiesRu),
        parseTranscript(cookiesRu).catch(() => null),
        parseRecbook(cookiesRu).catch(() => null),
        parsePractice(cookiesRu).catch(() => null),
        parseAdvisor(cookiesRu).catch(() => null),
        parseEducPlan(cookiesRu).catch(() => null),
        parseAcademicOptions(cookiesRu).catch(() => null),
    ]);

    const now = new Date();
    const result: FullProfile = {
        profile,
        iup,
        attestation,
        transcript,
        recbook,
        practice,
        advisor,
        educPlan,
        academicOptions,
        cachedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + PROFILE_CACHE_TTL).toISOString()
    };

    // Сохраняем в кэш
    await setCachedData(cacheKey, result, PROFILE_CACHE_TTL);

    // Best-effort: feed the cross-user subject leaderboard from the transcript
    // (historical per-subject grades — ideal for finding seniors who took a
    // course). Fire-and-forget; never blocks or fails the profile fetch.
    const transcriptSubjects = result.transcript?.subjects;
    if (Array.isArray(transcriptSubjects) && transcriptSubjects.length > 0) {
        const inputs = transcriptSubjects
            .map((s) => {
                const term = parseTermLabel(s.termLabel);
                if (!term) return null;
                return {
                    name: s.subject,
                    year: term.year,
                    semester: term.semester,
                    source: 'univer' as const,
                    score: s.numericGrade,
                    gpa: s.gpa,
                    letter: s.letterGrade,
                };
            })
            .filter((x): x is NonNullable<typeof x> => x !== null);
        if (inputs.length > 0) {
            void recordUserSubjectGrades(userId, inputs)
                .catch((error) => console.error('[Profile] leaderboard record failed:', error));
        }
    }

    console.log(`[Profile] Profile cached for ${userId}`);
    return result;
}
