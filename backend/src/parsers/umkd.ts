/**
 * Парсер УМКД (Учебно-методический комплекс дисциплин) KSTU
 * Использует HTTP запросы вместо Playwright + GridFS для хранения файлов с дедупликацией
 */

import * as cheerio from 'cheerio';
import { ParseResult } from '../types/index.js';
import { getMimeType, getFilesByMultipleCourses } from '../db/gridfs.js';
import type { FileInfo } from '../db/gridfs.js';
import { uploadToStorage } from '../storage/index.js';
import { login, switchToRussian, httpGet, httpDownload, KSTUCookies, isLoggedIn, BASE_URL } from './http-client.js';
import { classifyUmkdMaterial, type ClassificationResult } from './umkd-classify.js';
import { getCurrentAcademicPeriod } from './platonus-client.js';

const UMKD_ROOT = `${BASE_URL}/student/umkd/`;

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
            const urlObj = new URL(url, BASE_URL);
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
 * Скачивает файл и сохраняет в GridFS с дедупликацией
 */
async function downloadAndStoreFile(
    cookies: KSTUCookies,
    fileObj: { id: string; name: string; url: string },
    courseId: string,
    courseName: string,
    userId: string
): Promise<{ fileId: string | null; downloadUrl: string | null; downloadStatus: string; deduplicated: boolean; hash?: string }> {
    const url = fileObj.url;

    if (!url) {
        return { fileId: null, downloadUrl: null, downloadStatus: 'no_url', deduplicated: false };
    }

    try {
        // Скачиваем файл через HTTP
        const { data, status } = await httpDownload(url, cookies);

        if (status !== 200) {
            return { fileId: null, downloadUrl: null, downloadStatus: `http_${status}`, deduplicated: false };
        }

        if (looksLikeHtml(data)) {
            return { fileId: null, downloadUrl: null, downloadStatus: 'html_instead_of_file', deduplicated: false };
        }

        // Генерируем имя файла
        const filename = guessFilename(fileObj.name, url, fileObj.id);
        const mimeType = getMimeType(filename);

        // Загружаем в storage (R2 с fallback на GridFS) с дедупликацией
        const result = await uploadToStorage({
            buffer: data,
            filename,
            metadata: {
            originalName: fileObj.name || filename,
            courseId,
            courseName,
            mimeType,
            uploadedBy: userId,
            },
        });

        const downloadUrl = `/api/v3/files/${result.ref.fileId}`;

        return {
            fileId: result.ref.fileId,
            downloadUrl,
            downloadStatus: 'ok',
            deduplicated: result.deduplicated,
            hash: result.contentHash,
        };
    } catch (error) {
        const errName = error instanceof Error ? error.name : 'unknown';
        return { fileId: null, downloadUrl: null, downloadStatus: `fail:${errName}`, deduplicated: false };
    }
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
 * Получение списка курсов со страницы УМКД
 */
export function parseCourseList(html: string): Array<{ id: string; title: string; kind: string }> {
    const $ = cheerio.load(html);
    const courses: Array<{ id: string; title: string; kind: string }> = [];

    // Попытка найти курсы in table.inner tr.link
    $('table.inner tr.link').each((_, row) => {
        const $row = $(row);
        const cells = $row.find('td');
        const id = $row.attr('id') || '';
        const title = $(cells.get(1)).text().trim();
        const kind = $(cells.get(2)).text().trim();

        if (id && title) {
            courses.push({ id, title, kind });
        }
    });

    // Альтернативный поиск если не нашли
    if (courses.length === 0) {
        $('table.inner tr').each((_, row) => {
            const $row = $(row);
            if ($row.find('img[src*="folder"]').length) {
                const cells = $row.find('td');
                const id = $row.attr('id') || '';
                const title = $(cells.get(1)).text().trim();
                const kind = $(cells.get(2)).text().trim();

                if (title) {
                    courses.push({ id: id || `course-${courses.length}`, title, kind });
                }
            }
        });
    }

    return courses;
}

/**
 * Парсинг файлов для конкретного курса
 */
function parseFilesFromHtml(html: string): { files: UMKDFile[]; isEmpty: boolean } {
    const $ = cheerio.load(html);
    const files: UMKDFile[] = [];

    // Ищем файлы в таблице
    $('table.inner tr.file, table tr.file').each((i, row) => {
        const $row = $(row);
        const cells = $row.find('td');

        // Ищем ссылку на скачивание
        const link = $row.find('a.downLoad, a[href*="/umkd/get/"], a[href*="download"]').first();
        const url = link.attr('href') || '';
        const fileName = link.text().trim() || '';

        if (cells.length >= 6 && (url || fileName)) {
            const name = fileName || $(cells.get(1)).text().trim();
            const type = $(cells.get(3)).text().trim();
            const examClassification = classifyUmkdMaterial({
                title: name,
                filename: name,
                type,
            });
            files.push({
                id: $row.attr('id') || `file-${i}`,
                name,
                url: url,
                type,
                lang: $(cells.get(4)).text().trim().replace(/^\s*-\s*$/, ''),
                size: $(cells.get(5)).text().trim(),
                uploaded: $(cells.get(6)).text().trim(),
                downloads: $(cells.get(7)).text().trim(),
                examClassification,
            });
        }
    });

    const pageText = $('body').text() || '';
    const isEmpty = pageText.includes('Файлы не загружены') ||
        pageText.includes('Нет загруженных файлов') ||
        (files.length === 0);

    return { files, isEmpty };
}

/**
 * Извлечение файлов для конкретного курса
 */
async function extractFilesForCourse(
    cookies: KSTUCookies,
    courseId: string,
    courseTitle: string,
    year: string,
    semester: string,
    downloadFiles: boolean,
    userId: string,
    prefetchedFiles?: FileInfo[], // Предзагруженные файлы из batch-запроса (N+1 fix)
    onProgress?: (status: string, percent: number) => void
): Promise<{ files: UMKDFile[]; isEmpty: boolean; downloadedCount: number; deduplicatedCount: number }> {
    const courseUrl = `${BASE_URL}/student/umkd/${courseId}/${year}/${semester}`;

    try {
        const { data: html, status } = await httpGet(courseUrl, cookies);

        if (status !== 200) {
            console.log(`[UMKD Parser] HTTP error ${status} for course ${courseId}`);
            return { files: [], isEmpty: true, downloadedCount: 0, deduplicatedCount: 0 };
        }

        const { files: parsedFiles, isEmpty } = parseFilesFromHtml(html);

        console.log(`[UMKD Parser] Found ${parsedFiles.length} files for course ${courseId}`);

        // Нормализуем URL файлов
        const normalizedFiles: UMKDFile[] = parsedFiles.map(f => ({
            ...f,
            url: f.url ? (f.url.startsWith('http') ? f.url : `${BASE_URL}${f.url.startsWith('/') ? '' : '/'}${f.url}`) : ''
        }));

        let downloadedCount = 0;
        let deduplicatedCount = 0;

        // Скачиваем файлы и сохраняем в GridFS
        if (downloadFiles && normalizedFiles.length > 0) {
            // Используем предзагруженные файлы или делаем запрос (fallback)
            let existingFiles: FileInfo[];
            if (prefetchedFiles) {
                existingFiles = prefetchedFiles;
            } else {
                const { getFilesByCourse } = await import('../db/gridfs.js');
                existingFiles = await getFilesByCourse(courseId);
            }
            const existingNames = new Set(existingFiles.map(f => f.name));

            console.log(`[UMKD Parser] Found ${existingFiles.length} existing files in DB for course ${courseId}`);
            console.log(`[UMKD Parser] Processing ${normalizedFiles.length} files...`);

            const CONCURRENCY = 10;
            let processedCount = 0;

            // Вспомогательная функция для обработки одного файла
            const processFile = async (file: any, _index: number) => {
                const ext = detectExtension(file.name, file.url);
                let candidate = (file.name || '').trim();
                if (candidate) {
                    candidate = candidate.replace(/\u2013|\u2014/g, '-');
                    if (candidate.toLowerCase().endsWith(ext)) candidate = candidate.slice(0, -ext.length);
                    if (candidate.endsWith('.')) candidate = candidate.slice(0, -1);
                    candidate = slugify(candidate);
                }
                if (!candidate) candidate = file.id || 'file';
                const guessedName = `${candidate}${ext}`;

                // 1. Проверяем, есть ли файл уже
                if (existingNames.has(guessedName)) {
                    console.log(`[UMKD Parser]   ⏭ ${guessedName} (skipped, exists)`);

                    if (onProgress) {
                        processedCount++;
                        const filePercent = Math.round((processedCount / normalizedFiles.length) * 100);
                        onProgress(`Файл ${processedCount}/${normalizedFiles.length}`, filePercent);
                    }

                    // Fill metadata so frontend sees it as "present"
                    const existingFile = existingFiles.find(f => f.name === guessedName);
                    if (existingFile) {
                        file.fileId = existingFile.fileId;
                        file.downloadUrl = existingFile.downloadUrl;
                        file.downloadStatus = 'exists';
                        file.hash = existingFile.contentHash;
                    }
                    return;
                }

                // 2. Если нет - качаем
                if (onProgress) {
                    const currentProgress = Math.round(((processedCount + 1) / normalizedFiles.length) * 100);
                    onProgress(`Загрузка... ${guessedName}`, currentProgress);
                }

                const { fileId, downloadUrl, downloadStatus, deduplicated, hash } = await downloadAndStoreFile(
                    cookies, file, courseId, courseTitle, userId
                );

                file.downloadStatus = downloadStatus;

                if (fileId && downloadUrl) {
                    file.fileId = fileId;
                    file.downloadUrl = downloadUrl;
                    file.hash = hash;
                    downloadedCount++;
                    if (deduplicated) {
                        deduplicatedCount++;
                        console.log(`[UMKD Parser]   ♻ ${file.name} (deduplicated)`);
                    } else {
                        console.log(`[UMKD Parser]   ✓ ${file.name}`);
                    }
                } else {
                    console.log(`[UMKD Parser]   ✗ ${file.name} (${downloadStatus})`);
                }

                processedCount++;
                if (onProgress) {
                    const filePercent = Math.round((processedCount / normalizedFiles.length) * 100);
                    onProgress(`Загружено ${processedCount}/${normalizedFiles.length}`, filePercent);
                }
            };

            // Запускаем пачками (Chunks)
            for (let i = 0; i < normalizedFiles.length; i += CONCURRENCY) {
                const chunk = normalizedFiles.slice(i, i + CONCURRENCY);
                await Promise.all(chunk.map((file, idx) => processFile(file, i + idx)));
            }
        }




        // Deduplicate files in the final list
        const uniqueFiles: UMKDFile[] = [];
        const seenHashes = new Set<string>();
        const seenNameSize = new Set<string>();

        for (const file of normalizedFiles) {
            // Priority 1: Filter by Content Hash (if available)
            if (file.hash) {
                if (seenHashes.has(file.hash)) continue;
                seenHashes.add(file.hash);
                uniqueFiles.push(file);
                continue;
            }

            // Priority 2: Filter by Name + Size (fallback for failed downloads or logic without hash)
            const key = `${file.name}|${file.size}`;
            if (seenNameSize.has(key)) continue;

            seenNameSize.add(key);
            uniqueFiles.push(file);
        }

        return { files: uniqueFiles, isEmpty, downloadedCount, deduplicatedCount };
    } catch (error) {
        console.error(`[UMKD Parser] Error extracting files for course ${courseId}:`, error);
        return { files: [], isEmpty: true, downloadedCount: 0, deduplicatedCount: 0 };
    }
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

/**
 * Основная функция парсинга УМКД
 * Использует быстрые HTTP запросы вместо Playwright
 */
export async function parseUMKD(
    username: string,
    password: string,
    options: {
        downloadFiles?: boolean;
        onProgress?: (status: string, percent: number) => void;
        year?: string;
        semester?: string;
    } = {}
): Promise<ParseResult<UMKD>> {
    const year = options.year || getCurrentYear();
    const semester = options.semester || getCurrentSemester();
    const downloadFiles = options.downloadFiles ?? true;
    const onProgress = options.onProgress || (() => { });

    try {
        onProgress('Авторизация...', 0);
        console.log('[UMKD Parser] Starting (HTTP mode)...');
        console.log(`[UMKD Parser] Year: ${year}, Semester: ${semester}`);
        console.log(`[UMKD Parser] Download files: ${downloadFiles}`);

        // Авторизация через HTTP
        const cookies = await login(username, password);
        if (!cookies) {
            return { success: false, error: 'Ошибка авторизации. Проверьте логин и пароль.' };
        }

        // Переключаем на русский
        const cookiesRu = await switchToRussian(cookies);

        // Загружаем страницу УМКД
        console.log('[UMKD Parser] Loading UMKD page...');
        const { data: umkdHtml, status } = await httpGet(UMKD_ROOT, cookiesRu);

        if (status !== 200) {
            return { success: false, error: `HTTP error: ${status}` };
        }

        if (!isLoggedIn(umkdHtml)) {
            return { success: false, error: 'Сессия истекла или авторизация не удалась' };
        }

        // Парсим список курсов
        const courseList = parseCourseList(umkdHtml);
        console.log(`[UMKD Parser] Found ${courseList.length} courses in list`);
        onProgress(`Найдено предметов: ${courseList.length}`, 15);

        // Для каждого курса получаем файлы
        const courses: UMKDCourse[] = [];
        let totalFiles = 0;
        let totalDownloaded = 0;
        let totalDeduplicated = 0;

        // N+1 fix: загружаем все файлы всех курсов одним batch-запросом
        const allCourseIds = courseList.map(c => c.id);
        const prefetchedFilesMap = await getFilesByMultipleCourses(allCourseIds);
        console.log(`[UMKD Parser] Pre-fetched files for ${allCourseIds.length} courses in 1 DB query`);

        // Параллельная обработка курсов с ограничением concurrency
        const COURSE_CONCURRENCY = 3; // Не больше 3 курсов одновременно (чтобы не перегружать KSTU)
        const courseResults: { course: typeof courseList[0]; result: Awaited<ReturnType<typeof extractFilesForCourse>> }[] = [];

        for (let i = 0; i < courseList.length; i += COURSE_CONCURRENCY) {
            const chunk = courseList.slice(i, i + COURSE_CONCURRENCY);
            const chunkResults = await Promise.all(chunk.map((course, idx) => {
                const globalIdx = i + idx;
                const percent = 15 + Math.round((globalIdx / courseList.length) * 80);
                onProgress(`Обработка: ${course.title}`, percent);
                console.log(`[UMKD Parser] (${globalIdx + 1}/${courseList.length}) Processing: ${course.title}`);

                return extractFilesForCourse(
                    cookiesRu, course.id, course.title, year, semester, downloadFiles, username,
                    prefetchedFilesMap.get(course.id) || [],
                    (fileStatus, filePercent) => {
                        const courseProgress = percent + Math.round((filePercent / 100) * (80 / courseList.length));
                        onProgress(`${course.title}: ${fileStatus}`, courseProgress);
                    }
                ).then(result => ({ course, result }));
            }));
            courseResults.push(...chunkResults);
        }

        for (const { course, result } of courseResults) {
            const { files, isEmpty, downloadedCount, deduplicatedCount } = result;

            totalFiles += files.length;
            totalDownloaded += downloadedCount;
            totalDeduplicated += deduplicatedCount;
            console.log(`[UMKD Parser]   -> ${isEmpty ? 'Empty' : `${files.length} files, ${downloadedCount} downloaded, ${deduplicatedCount} deduplicated`}`);

            courses.push({
                id: course.id,
                name: course.title,
                kind: course.kind,
                files,
                isEmpty
            });
        }

        const examQuestionsBySubject = buildExamQuestionsBySubject(courses);

        const result: UMKD = {
            courses,
            examQuestionsBySubject,
            meta: {
                parsedAt: new Date().toISOString(),
                totalCourses: courses.length,
                totalFiles,
                downloadedFiles: totalDownloaded,
                deduplicatedFiles: totalDeduplicated,
                userId: username,
            },
        };

        console.log(`[UMKD Parser] Done! ${courses.length} courses, ${totalFiles} files, ${totalDownloaded} downloaded, ${totalDeduplicated} deduplicated`);
        onProgress('Готово', 100);

        return {
            success: true,
            data: result,
        };

    } catch (error) {
        console.error('[UMKD Parser] Error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

export default parseUMKD;
