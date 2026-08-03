import type { AcademicContext, PlatonusSemester } from './api';
import { CacheKeys, getCacheAge, getFromCache } from './cache';

interface AcademicSemesterRef {
    year: number;
    semester: number;
}

/**
 * Академ-контекст обновляется только страницами, которые его запрашивают
 * (расписание и т.п.). Без TTL протухший контекст из localStorage мог
 * неделями «побеждать» реальную дату (например, весенний семестр из мая
 * выбирался дефолтом в октябре). 12 часов достаточно: бэкендовый кеш
 * контекста живёт 6 часов, а суточная граница смены семестра не критична.
 */
const ACADEMIC_CONTEXT_MAX_AGE_MINUTES = 12 * 60;

export function getCachedAcademicContext(): AcademicContext | null {
    const ageMinutes = getCacheAge(CacheKeys.ACADEMIC_CONTEXT);
    if (ageMinutes !== null && ageMinutes > ACADEMIC_CONTEXT_MAX_AGE_MINUTES) {
        return null;
    }
    return getFromCache<AcademicContext>(CacheKeys.ACADEMIC_CONTEXT);
}

/**
 * Текущий академический период по календарной дате.
 *
 * Семантика ДОЛЖНА совпадать с бэкендовой канонической функцией
 * `getCurrentAcademicPeriod` (`backend/src/parsers/platonus-client.ts`):
 * - сентябрь–ноябрь → осень {Y, 1};
 * - декабрь         → осень {Y, 1} — зимняя сессия осеннего семестра;
 * - январь          → осень {Y-1, 1} — хвост зимней сессии;
 * - февраль–июнь    → весна {Y-1, 2};
 * - июль–август     → осень {Y, 1} — предстоящий учебный год.
 * При изменении границ месяцев менять обе стороны и тесты синхронно.
 */
export function getCurrentAcademicSemesterFromDate(now = new Date()): AcademicSemesterRef {
    const month = now.getMonth(); // 0-11
    const year = now.getFullYear();

    if (month === 0) {
        // Январь — ещё осенний семестр прошлого календарного года
        return { year: year - 1, semester: 1 };
    }

    if (month >= 1 && month <= 5) {
        // Февраль-июнь — весенний семестр
        return { year: year - 1, semester: 2 };
    }

    // Июль-декабрь — осенний семестр текущего года
    return { year, semester: 1 };
}

export function getCurrentAcademicSemesterFromContext(
    academicContext?: AcademicContext | null
): AcademicSemesterRef | null {
    if (!academicContext) return null;
    const admissionYear = academicContext.admissionYear;
    const semesterNumber = academicContext.currentSemesterNumber;

    if (
        typeof admissionYear !== 'number'
        || typeof semesterNumber !== 'number'
        || admissionYear < 1900
        || semesterNumber < 1
    ) {
        return null;
    }

    const year = admissionYear + Math.floor((semesterNumber - 1) / 2);
    const semester = semesterNumber % 2 === 1 ? 1 : 2;

    return { year, semester };
}

/** Линейный порядковый номер полугодия — для сравнения периодов между собой. */
function semesterOrdinal(ref: AcademicSemesterRef): number {
    return ref.year * 2 + (ref.semester === 2 ? 1 : 0);
}

export function getPreferredPlatonusSemester(
    semesters: PlatonusSemester[],
    academicContext?: AcademicContext | null
): PlatonusSemester {
    // Дата — надёжный источник «какой сейчас семестр». Академ-контекст (из
    // календаря Platonus) сейчас ненадёжен: пока вуз не завёл осенний календарь,
    // логика «текущего» уводит в ближайший БУДУЩИЙ семестр (весну), из-за чего
    // грейдсы дефолтились в весну. Поэтому НЕ даём контексту перепрыгнуть вперёд
    // относительно даты — используем его, только если он не позже даты.
    const dateBased = getCurrentAcademicSemesterFromDate();
    const contextBased = getCurrentAcademicSemesterFromContext(
        academicContext ?? getCachedAcademicContext()
    );
    const preferred =
        contextBased && semesterOrdinal(contextBased) <= semesterOrdinal(dateBased)
            ? contextBased
            : dateBased;

    const exact = semesters.find((item) =>
        item.year === preferred.year
        && item.semester === preferred.semester
    );
    if (exact) return exact;

    // Текущего периода нет в списке (список устарел или новый семестр ещё не
    // открыт в Platonus). Берём ближайший разумный: последний доступный, не
    // позже текущего; если все доступные — в будущем, берём самый ранний.
    // Раньше здесь был слепой `semesters[0]`, из-за чего дефолтом могла
    // открыться прошлогодняя весна.
    const target = semesterOrdinal(preferred);
    let bestPast: PlatonusSemester | undefined;
    let bestPastOrdinal = Number.NEGATIVE_INFINITY;
    let earliest: PlatonusSemester | undefined;
    let earliestOrdinal = Number.POSITIVE_INFINITY;

    for (const item of semesters) {
        const ordinal = semesterOrdinal(item);
        if (ordinal <= target && ordinal > bestPastOrdinal) {
            bestPast = item;
            bestPastOrdinal = ordinal;
        }
        if (ordinal < earliestOrdinal) {
            earliest = item;
            earliestOrdinal = ordinal;
        }
    }

    return bestPast ?? earliest ?? semesters[0];
}
