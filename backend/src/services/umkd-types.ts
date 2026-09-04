/**
 * UMKD Types - типы УМКД и чистые хелперы (имена файлов, период, группировка).
 *
 * Раньше жили в parsers/umkd.ts вместе со скрейпером univer.kstu.kz/student/umkd.
 * Univer отключён навсегда, скрейпер удалён. Типы описывают форму данных,
 * которая по-прежнему лежит в кэше `umkd:<userId>` и в хранилище файлов (R2),
 * и отдаётся фронтенду маршрутами routes/umkd.ts.
 */

import type { ClassificationResult } from '../parsers/umkd-classify.js';
import { getCurrentAcademicPeriod } from '../parsers/platonus-client.js';

/**
 * База только для разбора относительных URL в detectExtension (нужен pathname).
 * Никаких сетевых запросов по этому адресу не делается.
 */
const URL_PARSE_BASE = 'http://localhost';

/** Код ошибки: источник УМКД (univer.kstu.kz) отключён, свежие данные получить негде. */
export const UMKD_SOURCE_UNAVAILABLE = 'UMKD_SOURCE_UNAVAILABLE';
export const UMKD_SOURCE_UNAVAILABLE_MESSAGE = 'Источник УМКД univer.kstu.kz отключён. Доступны только ранее сохранённые материалы.';

// Типы для УМКД
export interface UMKDFile {
    id: string;
    name: string;
    url: string;            // Оригинальный URL на KSTU
    fileId?: string;        // ID файла в GridFS
    downloadUrl?: string;   // URL для скачивания с нашего сервера
    teacher?: string;
    type?: string;
    lang?: string;
    size?: string;
    uploaded?: string;
    downloads?: string;
    downloadStatus?: string;
    hash?: string;          // MD5 hash
    examClassification?: ClassificationResult; // Phase 2: exam-questions classifier output
}

export interface UMKDCourse {
    id: string;
    name: string;
    kind?: string;
    files: UMKDFile[];
    isEmpty?: boolean;
}

export interface UmkdExamQuestionFile {
    id?: string;       // KSTU row id (e.g. "388803") — display/key only
    fileId?: string;   // Storage ObjectId — used for /parsed endpoint + downloads
    title: string;
    filename?: string;
    category?: string;
    extension?: string;
    mimeType?: string;
    size?: string;
    updatedAt?: string;
    downloadUrl?: string;
    openUrl?: string;
    confidence: 'strong' | 'medium' | 'weak';
    matchReason: string;
}

export interface UmkdExamQuestionsForSubject {
    subjectId?: string;
    subjectName: string;
    subjectCode?: string;
    fileCount: number;
    files: UmkdExamQuestionFile[];
}

export interface UMKD {
    courses: UMKDCourse[];
    examQuestionsBySubject: UmkdExamQuestionsForSubject[];
    meta: {
        parsedAt: string;
        totalCourses: number;
        totalFiles: number;
        downloadedFiles: number;
        deduplicatedFiles: number;
        userId: string;
    };
}

/**
 * Создаёт безопасное имя файла
 */
export function slugify(text: string, maxlen: number = 120): string {
    text = (text || '').trim().toLowerCase();
    text = text.replace(/[^\w\s\-.()а-яёіқңғүұһәө]+/gu, '');
    text = text.replace(/\s+/g, '_');
    text = text.substring(0, maxlen);
    return text || 'file';
}

/**
 * Определяет расширение файла
 */
export function detectExtension(title: string | undefined, url: string | undefined): string {
    if (url) {
        try {
            const urlObj = new URL(url, URL_PARSE_BASE);
            const pathParts = urlObj.pathname.split('.');
            if (pathParts.length > 1) {
                const ext = pathParts.pop();
                if (ext && ext.length >= 2 && ext.length <= 6) {
                    return `.${ext.toLowerCase()}`;
                }
            }
        } catch { }
    }
    if (title) {
        const match = title.match(/\.([a-z0-9]{2,6})$/i);
        if (match) return `.${match[1].toLowerCase()}`;
    }
    return '.bin';
}

/**
 * Генерирует имя файла
 */
export function guessFilename(title: string | undefined, url: string | undefined, fileId: string | undefined): string {
    const ext = detectExtension(title, url);
    let candidate = (title || '').trim();

    if (candidate) {
        candidate = candidate.replace(/\u2013|\u2014/g, '-');
        if (candidate.toLowerCase().endsWith(ext)) {
            candidate = candidate.slice(0, -ext.length);
        }
        if (candidate.endsWith('.')) {
            candidate = candidate.slice(0, -1);
        }
        candidate = slugify(candidate);
    }

    if (!candidate) {
        candidate = fileId || 'file';
    }

    return `${candidate}${ext}`;
}

/**
 * Проверяет, выглядит ли контент как HTML (ошибка вместо файла)
 */
export function looksLikeHtml(buffer: Buffer): boolean {
    const sample = buffer.slice(0, 200).toString().toLowerCase();
    return sample.includes('<html') || sample.includes('<!doctype');
}

/**
 * Получает текущий учебный год.
 * Делегирует канонической функции `getCurrentAcademicPeriod` — единая
 * семантика периода для всего бэкенда (grades/exams/schedule/umkd).
 */
export function getCurrentYear(): string {
    return String(getCurrentAcademicPeriod().year);
}

/**
 * Получает текущий семестр (та же каноническая семантика:
 * сен–янв → '1', фев–июн → '2', июл–авг → '1' предстоящий).
 */
export function getCurrentSemester(): string {
    return String(getCurrentAcademicPeriod().semester);
}


/**
 * Извлекает расширение из имени файла без точки в начале (для UmkdExamQuestionFile).
 * Возвращает undefined, если расширение не удалось определить или это бинарный fallback.
 */
function extractExtensionFromName(name: string | undefined): string | undefined {
    if (!name) return undefined;
    const match = name.match(/\.([a-z0-9]{2,6})$/i);
    return match ? match[1].toLowerCase() : undefined;
}

/**
 * Группирует UMKD-файлы, классифицированные как exam-questions, по предмету.
 * Сортировка: по убыванию количества файлов, затем по названию предмета.
 */
export function buildExamQuestionsBySubject(courses: UMKDCourse[]): UmkdExamQuestionsForSubject[] {
    const groups: UmkdExamQuestionsForSubject[] = [];

    for (const course of courses) {
        const matching = course.files.filter(
            (f) => f.examClassification?.kind === 'exam-questions',
        );
        if (matching.length === 0) continue;

        const files: UmkdExamQuestionFile[] = matching.map((f) => {
            const classification = f.examClassification!;
            return {
                id: f.id,
                fileId: f.fileId,
                title: f.name,
                filename: f.name,
                category: f.type,
                extension: extractExtensionFromName(f.name),
                size: f.size,
                updatedAt: f.uploaded,
                downloadUrl: f.fileId ? `/api/v3/files/${f.fileId}?download=1` : undefined,
                openUrl: f.fileId ? `/api/v3/files/${f.fileId}` : undefined,
                confidence: classification.confidence as 'strong' | 'medium' | 'weak',
                matchReason: classification.reason,
            };
        });

        groups.push({
            subjectId: course.id,
            subjectName: course.name,
            subjectCode: course.kind,
            fileCount: files.length,
            files,
        });
    }

    groups.sort((a, b) => {
        if (b.fileCount !== a.fileCount) return b.fileCount - a.fileCount;
        return a.subjectName.localeCompare(b.subjectName);
    });

    return groups;
}
