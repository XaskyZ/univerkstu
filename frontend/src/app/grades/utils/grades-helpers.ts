import { CacheKeys, getFromCache } from '@/lib/cache';
import type { PlatonusSemester, PlatonusSubjectGrade } from '@/lib/api';
import { formatMessage, type useLanguage } from '@/lib/language-context';
import {
    getCachedAcademicContext,
    getCurrentAcademicSemesterFromDate,
    getPreferredPlatonusSemester,
} from '@/lib/platonus-semesters';
import {
    type AssistantStatus,
    BLOCKED_MARKERS,
    type CachedPlatonusStatus,
    type ParsedScore,
    type SubjectStatusKey,
} from '../types';

/**
 * Крайний фолбэк-список семестров, когда динамический список бэкенда
 * (`fetchAvailableSemesters` → cached `availableSemesters`) недоступен.
 * Генерируется от текущей даты (текущий период + 3 предыдущих, новые
 * первыми), чтобы захардкоженный список никогда не устаревал и текущий
 * период всегда присутствовал в фолбэке.
 */
export function getDefaultSemesters(messages: ReturnType<typeof useLanguage>['messages']): PlatonusSemester[] {
    const result: PlatonusSemester[] = [];
    let { year, semester } = getCurrentAcademicSemesterFromDate();

    for (let i = 0; i < 4; i++) {
        const season = semester === 1 ? messages.grades.autumn : messages.grades.spring;
        result.push({
            year,
            semester,
            label: formatMessage(messages.grades.semesterFormat, { start: year, end: year + 1, season }),
        });

        // Шаг на одно полугодие назад
        if (semester === 2) {
            semester = 1;
        } else {
            semester = 2;
            year -= 1;
        }
    }

    return result;
}

export function buildPlatonusLoginFromFullName(fullName: string): string {
    const cleaned = fullName.trim().replace(/\s+/g, ' ');
    if (!cleaned) return '';

    const [lastName, firstName] = cleaned.split(' ');
    if (!lastName || !firstName) return '';

    return `${lastName}_${firstName}`;
}

export function getSuggestedPlatonusLoginFromCache(): string {
    if (typeof window === 'undefined') return '';

    const cachedProfile = getFromCache<{ profile?: { fullName?: string } }>(CacheKeys.PROFILE);
    const fullName = cachedProfile?.profile?.fullName;
    if (!fullName) return '';

    return buildPlatonusLoginFromFullName(fullName);
}

export function normalizePlatonusLogin(value: string): string {
    return value.trim();
}

export function gradesCacheKey(year: number, semester: number): string {
    return `platonus_grades_${year}_${semester}`;
}

export function getCachedPlatonusStatus(): CachedPlatonusStatus | null {
    return getFromCache<CachedPlatonusStatus>(CacheKeys.PLATONUS_STATUS);
}

export function getInitialSemesterSelection(defaultSemesters: PlatonusSemester[]) {
    const cachedStatus = getCachedPlatonusStatus();
    const academicContext = getCachedAcademicContext();
    const semesters = cachedStatus?.availableSemesters?.length
        ? cachedStatus.availableSemesters
        : defaultSemesters;
    const latest = getPreferredPlatonusSemester(semesters, academicContext);
    return {
        year: latest.year,
        semester: latest.semester,
    };
}

export function getGradeTone(value: string) {
    const parsed = Number.parseFloat(value);
    const isNumber = !Number.isNaN(parsed);
    const normalizedValue = value.toLowerCase();
    const nonAdmissionMarkers = ['недоп', 'nedop', 'not admitted'];
    const isNedop = nonAdmissionMarkers.some((marker) => normalizedValue.includes(marker));

    if (isNedop) {
        return { bg: 'var(--status-danger-bg)', color: 'var(--status-danger-color)', border: 'var(--status-danger-border)' };
    }

    if (!isNumber) {
        return { bg: 'var(--surface-overlay-3)', color: 'var(--muted)', border: 'var(--border)' };
    }

    if (parsed >= 90) {
        return { bg: 'var(--status-success-bg)', color: 'var(--status-success-color)', border: 'var(--status-success-border)' };
    }

    if (parsed >= 70) {
        return { bg: 'var(--status-info-bg)', color: 'var(--status-info-color)', border: 'var(--status-info-border)' };
    }

    if (parsed >= 50) {
        return { bg: 'var(--status-warning-bg)', color: 'var(--status-warning-color)', border: 'var(--status-warning-border)' };
    }

    return { bg: 'var(--status-danger-bg)', color: 'var(--status-danger-color)', border: 'var(--status-danger-border)' };
}

export function formatParsedAt(parsedAt?: string, locale = 'ru-RU') {
    if (!parsedAt) return '';

    const date = new Date(parsedAt);
    if (Number.isNaN(date.getTime())) return '';

    return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

export function formatRelativeParsedAge(parsedAt?: string, language: 'ru' | 'kz' | 'en' = 'ru') {
    if (!parsedAt) return '';
    const date = new Date(parsedAt);
    if (Number.isNaN(date.getTime())) return '';

    const diffMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
    if (language === 'en') {
        if (diffMinutes < 1) return 'just now';
        if (diffMinutes < 60) return `${diffMinutes} min ago`;

        const diffHours = Math.round(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours} h ago`;

        const diffDays = Math.round(diffHours / 24);
        return `${diffDays} d ago`;
    }

    if (language === 'kz') {
        if (diffMinutes < 1) return 'жаңа ғана';
        if (diffMinutes < 60) return `${diffMinutes} мин бұрын`;

        const diffHours = Math.round(diffMinutes / 60);
        if (diffHours < 24) return `${diffHours} сағ бұрын`;

        const diffDays = Math.round(diffHours / 24);
        return `${diffDays} күн бұрын`;
    }

    if (diffMinutes < 1) return 'только что';
    if (diffMinutes < 60) return `${diffMinutes} мин назад`;

    const diffHours = Math.round(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} ч назад`;

    const diffDays = Math.round(diffHours / 24);
    return `${diffDays} дн назад`;
}

export function parseScoreValue(value?: string | null): ParsedScore {
    const raw = value?.trim() || '';
    if (!raw || raw === '-' || raw === '—') {
        return { kind: 'missing', raw, value: null };
    }

    const normalized = raw.toLowerCase();
    if (BLOCKED_MARKERS.some((marker) => normalized.includes(marker))) {
        return { kind: 'blocked', raw, value: null };
    }

    const parsed = Number.parseFloat(raw.replace(',', '.'));
    if (!Number.isNaN(parsed)) {
        return { kind: 'number', raw, value: parsed };
    }

    return { kind: 'text', raw, value: null };
}

/**
 * Есть ли по предмету хоть одна реально опубликованная оценка.
 *
 * Для ещё НЕ начавшегося семестра Platonus отдаёт заглушки: РК1/РК2 = '-',
 * Рейтинг/итог = '0', а в слот экзамена заранее проставляет «недоп.»
 * (проверено на живом журнале осени 2026/1). Такой «недоп.» — не реальный
 * недопуск, а «данных ещё нет», и без этой проверки пустой семестр
 * подсвечивался как тревожный Risk по всем предметам.
 *
 * Активностью считаем:
 * - закрытую РК — любое число, включая честный 0 у реального студента
 *   (неопубликованные РК Platonus отдаёт как '-', а не '0');
 * - положительный рейтинг/экзамен/итог ('0' здесь — заглушка, а не оценка).
 */
export function hasPublishedSemesterActivity(subject: PlatonusSubjectGrade): boolean {
    const rk1 = parseScoreValue(subject.rk1);
    const rk2 = parseScoreValue(subject.rk2);
    if (rk1.kind === 'number' && rk1.value !== null) return true;
    if (rk2.kind === 'number' && rk2.value !== null) return true;

    const rating = parseScoreValue(subject.rating);
    const exam = parseScoreValue(subject.exam);
    const total = parseScoreValue(subject.total);
    if (rating.kind === 'number' && (rating.value ?? 0) > 0) return true;
    if (exam.kind === 'number' && (exam.value ?? 0) > 0) return true;
    if (total.kind === 'number' && (total.value ?? 0) > 0) return true;

    return false;
}

export function clampNumber(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export function formatGoalNumber(value: number | null) {
    if (value === null) return '—';
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function formatExamDateLabel(value?: string | null, locale = 'ru-RU') {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).format(date);
}

export function getAssistantStatusTone(status: AssistantStatus) {
    if (status === 'ok') {
        return { bg: 'var(--status-success-bg)', color: 'var(--status-success-color)', border: 'var(--status-success-border)' };
    }
    if (status === 'achievable') {
        return { bg: 'var(--status-info-bg)', color: 'var(--status-info-color)', border: 'var(--status-info-border)' };
    }
    if (status === 'risk') {
        return { bg: 'var(--status-warning-bg)', color: 'var(--status-warning-color)', border: 'var(--status-warning-border)' };
    }
    return { bg: 'var(--status-danger-bg)', color: 'var(--status-danger-color)', border: 'var(--status-danger-border)' };
}

/**
 * Простой статус для компактного списка предметов: 5 состояний из спеки.
 * Эта функция отделена от языковых строк — список рендерит метку через
 * locale-словарь по этому ключу.
 *
 * Маппинг:
 * - `final`           → итог выставлен (есть `total`/`rating` числом, или экзамен закрыт)
 * - `awaiting-exam`   → обе РК закрыты, экзамена пока нет
 * - `awaiting-final`  → курсовая/практика без итога ИЛИ РК1/РК2 ещё открыты
 * - `blocked`         → недопуск (Platonus сказал «Недоп.» или средняя РК < 50)
 * - `no-data`         → ни РК, ни рейтинга, ни экзамена — пустая строка от Platonus
 */
export function getSubjectStatusKey(subject: PlatonusSubjectGrade): SubjectStatusKey {
    const rk1 = parseScoreValue(subject.rk1);
    const rk2 = parseScoreValue(subject.rk2);
    const rating = parseScoreValue(subject.rating);
    const exam = parseScoreValue(subject.exam);
    const total = parseScoreValue(subject.total);

    const totalIsNumeric = total.kind === 'number' && total.value !== null && total.value > 0;
    const ratingIsNumeric = rating.kind === 'number' && rating.value !== null && rating.value > 0;
    const examIsNumeric = exam.kind === 'number' && exam.value !== null && exam.value > 0;

    // Экзамен реально выставлен — итог зафиксирован.
    if (examIsNumeric) return 'final';

    // Для курсовой/практики достаточно положительного total или rating.
    const looksExamless = subject.kind === 'coursework' || subject.kind === 'practice';
    if (looksExamless && (totalIsNumeric || ratingIsNumeric)) return 'final';

    // «Недоп.» в слоте экзамена авторитетен только при реальной активности:
    // для не начавшегося семестра Platonus проставляет его заранее при
    // полностью пустых РК — это заглушка «данных нет», а не недопуск.
    if (exam.kind === 'blocked' && hasPublishedSemesterActivity(subject)) return 'blocked';

    const rk1Closed = rk1.kind === 'number' && rk1.value !== null;
    const rk2Closed = rk2.kind === 'number' && rk2.value !== null;

    // Средняя РК < 50 — недопуск, даже если Platonus ещё не отметил это явно.
    if (rk1Closed && rk2Closed) {
        const avg = ((rk1.value ?? 0) + (rk2.value ?? 0)) / 2;
        if (avg < 50) return 'blocked';
        if (looksExamless) return 'awaiting-final';
        return 'awaiting-exam';
    }

    // Курсовая/практика: без единой опубликованной оценки данных ещё нет,
    // иначе — ждём итоговую оценку.
    if (looksExamless) {
        return hasPublishedSemesterActivity(subject) ? 'awaiting-final' : 'no-data';
    }

    // Хоть какие-то семестровые данные есть → ждём окончания семестра.
    if (rk1Closed || rk2Closed || ratingIsNumeric) return 'awaiting-final';

    return 'no-data';
}

/**
 * Тон-токены для статуса в компактном списке. Используем существующие
 * semantic status tokens — без новых цветов.
 */
export function getSubjectStatusTone(status: SubjectStatusKey) {
    if (status === 'final') {
        return { bg: 'var(--status-success-bg)', color: 'var(--status-success-color)', border: 'var(--status-success-border)' };
    }
    if (status === 'awaiting-exam') {
        return { bg: 'var(--status-info-bg)', color: 'var(--status-info-color)', border: 'var(--status-info-border)' };
    }
    if (status === 'awaiting-final') {
        return { bg: 'var(--status-warning-bg)', color: 'var(--status-warning-color)', border: 'var(--status-warning-border)' };
    }
    if (status === 'blocked') {
        return { bg: 'var(--status-danger-bg)', color: 'var(--status-danger-color)', border: 'var(--status-danger-border)' };
    }
    return { bg: 'var(--surface-overlay-3)', color: 'var(--muted)', border: 'var(--border)' };
}
