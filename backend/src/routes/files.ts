/**
 * Routes для скачивания файлов из GridFS
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getFileInfo, getMimeType, getStorageStats } from '../db/gridfs.js';
import { downloadFromStorageByFileId, uploadToStorage } from '../storage/index.js';
import { canAccessFile, RUNTIME_UPLOAD_COURSE_ID } from '../services/file-access.js';
import { logAction } from '../utils/actionLog.js';

/**
 * Тело upload'а приезжает base64 в JSON, а base64 раздувает полезную нагрузку
 * примерно в 4/3. Глобальный `bodyLimit` (256 KB, backend/src/index.ts) резал
 * запрос ДО хендлера, поэтому заявленный лимит в 25 MB был недостижим —
 * фактический потолок был ~190 KB, и пользователь получал безликий 413 от
 * Fastify вместо `FILE_TOO_LARGE`.
 *
 * 36 MiB покрывают 25 MiB бинарника (25 MiB → ~33.3 MiB base64) плюс JSON-обвязку.
 * Пользовательским потолком остаётся проверка `MAX_UPLOAD_BYTES` уже
 * по декодированному буферу — она и отдаёт `FILE_TOO_LARGE`.
 */
export const UPLOAD_BODY_LIMIT_BYTES = 36 * 1024 * 1024;

/** Жёсткий потолок размера файла после декодирования base64. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Разрешённые типы содержимого для runtime-загрузок.
 *
 * Список собран по тому, что реально шлёт фронт
 * (`SOCIAL_ATTACHMENT_ALLOWED_MIME_PREFIXES` в
 * frontend/src/app/group/utils/social-attachment-upload.ts: картинки, PDF,
 * office-документы, plain text, CSV) плюс архивы, которые староста может
 * положить в файлы группы.
 *
 * Записи с завершающим `/` или `.` — префиксы (например `image/` покрывает
 * `image/png`, а `application/vnd.openxmlformats-officedocument.` — весь
 * docx/xlsx/pptx-куст). Остальные сравниваются точно.
 */
export const ALLOWED_UPLOAD_CONTENT_TYPES = [
    'image/',
    'application/pdf',
    'application/msword',
    'application/rtf',
    'application/vnd.openxmlformats-officedocument.',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    'application/vnd.oasis.opendocument.',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/vnd.rar',
    'application/x-7z-compressed',
    'application/x-tar',
    'application/gzip',
] as const;

/**
 * Эффективный content-type загрузки: заявленный клиентом MIME, а если его нет —
 * выведенный из расширения (та же логика, что в `uploadToStorage`). Параметры
 * вида `; charset=utf-8` отбрасываются.
 */
export function resolveUploadContentType(filename: string, mimeType?: string | null): string {
    const declared = (mimeType || '').split(';')[0].trim().toLowerCase();
    if (declared) return declared;
    return getMimeType(filename).toLowerCase();
}

/**
 * Аллоу-лист по эффективному content-type. Неизвестное расширение без
 * заявленного MIME сваливается в `application/octet-stream` и отклоняется —
 * endpoint не должен работать как хостинг произвольных бинарников.
 */
export function isAllowedUploadContentType(contentType: string): boolean {
    const normalized = (contentType || '').trim().toLowerCase();
    if (!normalized) return false;
    return ALLOWED_UPLOAD_CONTENT_TYPES.some((entry) => (
        entry.endsWith('/') || entry.endsWith('.')
            ? normalized.startsWith(entry)
            : normalized === entry
    ));
}

/**
 * Доступ к файлам всегда проходит проверку `canAccessFile`; служебные поля
 * (ключ/бакет объекта в хранилище) наружу не отдаются. Предикат оставлен
 * как всегда-false, чтобы не разворачивать вызывающие блоки.
 */
function isAdminRequest(_request: FastifyRequest): boolean {
    return false;
}

/**
 * Builds a Content-Disposition response header with dual filename encoding:
 *   - `filename="ASCII"` — fallback for old clients that don't understand RFC 5987.
 *     Non-ASCII chars get replaced with `_`; double quotes stripped (would break syntax).
 *   - `filename*=UTF-8''<urlencoded>` — RFC 5987 form for modern browsers; preserves
 *     Cyrillic/emoji/etc. perfectly.
 */
export function buildContentDispositionHeader(name: string): string {
    const effectiveName = name || 'file.bin';
    const encodedName = encodeURIComponent(effectiveName);
    const asciiFallbackName = effectiveName
        .replace(/[^\x20-\x7E]/g, '_')
        .replace(/"/g, '');
    return `attachment; filename="${asciiFallbackName}"; filename*=UTF-8''${encodedName}`;
}

export async function filesRoutes(app: FastifyInstance) {

    /**
     * GET /api/v3/files/:fileId
     * Скачать файл по ID
     */
    app.get('/files/:fileId', {
        // Скачивание доступно только авторизованным — закрываем анонимный перебор fileId
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Params: { fileId: string } }>,
        reply: FastifyReply
    ) => {
        const { fileId } = request.params;
        const userId = (request as any).user?.userId || 'anonymous';

        try {
            // Авторизация: JWT сам по себе не даёт права на ЛЮБОЙ fileId —
            // нужна связь с файлом (загрузивший / материал УМКД / файл группы /
            // вложение доступного scope). См. services/file-access.ts.
            if (!isAdminRequest(request)) {
                const access = await canAccessFile(userId, fileId);
                if (!access.allowed) {
                    if (access.reason === 'file_not_found') {
                        logAction(userId, 'files_download_failed', `Download failed: file ${fileId} not found`);
                        return reply.status(404).send({
                            success: false,
                            error: 'File not found',
                        });
                    }
                    // Переиспользуем существующий ActionType — расширять union
                    // в utils/actionLog.ts ради одной строки не нужно, детали
                    // отказа несёт текст сообщения.
                    logAction(userId, 'files_download_failed', `Download denied for file ${fileId}; reason=${access.reason}`);
                    return reply.status(403).send({
                        success: false,
                        error: 'Нет доступа к файлу',
                        errorCode: 'FILE_FORBIDDEN',
                    });
                }
            }

            // Скачиваем через storage facade (R2 + GridFS fallback).
            const downloaded = await downloadFromStorageByFileId(fileId);
            if (!downloaded) {
                logAction(userId, 'files_download_failed', `Download failed: file ${fileId} not found`);
                return reply.status(404).send({
                    success: false,
                    error: 'File not found',
                });
            }

            const { buffer, filename, contentType, provider } = downloaded;
            const effectiveName = filename || 'file.bin';

            reply
                .header('Content-Type', contentType)
                .header('Content-Disposition', buildContentDispositionHeader(effectiveName))
                .header('Content-Length', String(buffer.length))
                .header('Cache-Control', 'no-store, no-cache, must-revalidate')
                .header('Pragma', 'no-cache')
                .header('Expires', '0')
                .header('X-Content-Type-Options', 'nosniff')
                .header('X-Storage-Provider', provider)
                .send(buffer);
            logAction(
                userId,
                'files_download_success',
                `Downloaded file ${fileId}; provider=${provider}; bytes=${buffer.length}; filename=${effectiveName}`
            );

        } catch (error) {
            console.error('[Files Route] Download error:', error);
            logAction(userId, 'files_download_failed', `Download failed for file ${fileId}; server exception`);
            return reply.status(500).send({
                success: false,
                error: 'Failed to download file',
            });
        }
    });

    /**
     * GET /api/v3/files/:fileId/info
     * Получить информацию о файле без скачивания
     */
    app.get('/files/:fileId/info', {
        // Метаданные файла тоже только для авторизованных
        preHandler: [app.authenticate as any],
    }, async (
        request: FastifyRequest<{ Params: { fileId: string } }>,
        reply: FastifyReply
    ) => {
        const { fileId } = request.params;
        const userId = (request as any).user?.userId || 'anonymous';

        try {
            const isAdmin = isAdminRequest(request);
            if (!isAdmin) {
                const access = await canAccessFile(userId, fileId);
                if (!access.allowed) {
                    if (access.reason === 'file_not_found') {
                        return reply.status(404).send({
                            success: false,
                            error: 'File not found',
                        });
                    }
                    logAction(userId, 'files_download_failed', `Info denied for file ${fileId}; reason=${access.reason}`);
                    return reply.status(403).send({
                        success: false,
                        error: 'Нет доступа к файлу',
                        errorCode: 'FILE_FORBIDDEN',
                    });
                }
            }

            const fileInfo = await getFileInfo(fileId);

            if (!fileInfo) {
                return reply.status(404).send({
                    success: false,
                    error: 'File not found',
                });
            }

            logAction(userId, 'files_info_view', `Viewed file info for ${fileId}`);
            // `r2ObjectKey` / `r2Bucket` описывают внутреннюю раскладку
            // хранилища — обычному пользователю они не нужны и наружу не идут.
            // Админ-панель (storage health) продолжает их получать.
            const publicFileInfo = { ...fileInfo };
            delete publicFileInfo.r2ObjectKey;
            delete publicFileInfo.r2Bucket;
            return {
                success: true,
                data: isAdmin ? fileInfo : publicFileInfo,
            };

        } catch (error) {
            console.error('[Files Route] Info error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get file info',
            });
        }
    });

    /**
     * POST /api/v3/files/upload
     * Upload a file to the storage abstraction (R2) and return its `fileId`.
     *
     * Designed for the social attachments flow (`AttachmentsList` → social
     * entities). Accepts a base64-encoded payload in JSON to avoid adding a
     * `@fastify/multipart` dependency for the only consumer we have today.
     *
     * Request body:
     *   {
     *     filename: string,        // max 256 chars
     *     mimeType?: string,       // optional MIME hint; inferred from extension if absent
     *     contentBase64: string,   // raw bytes, base64-encoded
     *   }
     *
     * Response:
     *   { success: true, data: { fileId, size, contentType, deduplicated } }
     *
     * Size limit: 25 MB (post-decode). Beyond that the request is rejected
     * with `FILE_TOO_LARGE` so the storage layer never sees the buffer.
     * `config.bodyLimit` поднят до 36 MiB — иначе глобальный 256 KB лимит
     * (backend/src/index.ts) резал запрос раньше хендлера и заявленные 25 MB
     * были недостижимы (см. UPLOAD_BODY_LIMIT_BYTES).
     *
     * Content-type: только из аллоу-листа (картинки, PDF, office-документы,
     * текст, архивы) — иначе 415 `FILE_UNSUPPORTED_TYPE`. Скачивание в любом
     * случае отдаётся как `attachment` + `nosniff`.
     *
     * The route is auth-gated — anonymous callers are rejected by the bearer
     * preHandler before they reach this handler.
     */
    app.post('/files/upload', {
        preHandler: [app.authenticate as any],
        bodyLimit: UPLOAD_BODY_LIMIT_BYTES,
        schema: {
            body: {
                type: 'object',
                required: ['filename', 'contentBase64'],
                properties: {
                    filename: { type: 'string', minLength: 1, maxLength: 256 },
                    mimeType: { type: 'string', maxLength: 200 },
                    contentBase64: { type: 'string', minLength: 1 },
                },
            },
        },
        attachValidation: true,
    }, async (
        request: FastifyRequest<{
            Body: { filename: string; mimeType?: string; contentBase64: string };
        }>,
        reply: FastifyReply,
    ) => {
        if (request.validationError) {
            return reply.status(400).send({
                success: false,
                error: request.validationError.message || 'invalid upload payload',
                errorCode: 'FILE_VALIDATION_REQUIRED',
            });
        }

        const userId = (request as any).user?.userId || 'anonymous';
        const { filename, mimeType, contentBase64 } = request.body;

        // Тип содержимого — до декодирования base64: незачем тратить память на
        // буфер, который всё равно будет отклонён.
        const effectiveContentType = resolveUploadContentType(filename, mimeType);
        if (!isAllowedUploadContentType(effectiveContentType)) {
            logAction(userId, 'files_upload_failed', `Upload rejected for ${filename}; unsupported contentType=${effectiveContentType}`);
            return reply.status(415).send({
                success: false,
                error: 'unsupported file type',
                errorCode: 'FILE_UNSUPPORTED_TYPE',
            });
        }

        let buffer: Buffer;
        try {
            buffer = Buffer.from(contentBase64, 'base64');
        } catch {
            return reply.status(400).send({
                success: false,
                error: 'invalid base64 payload',
                errorCode: 'FILE_INVALID_PAYLOAD',
            });
        }

        if (buffer.length === 0) {
            return reply.status(400).send({
                success: false,
                error: 'empty file',
                errorCode: 'FILE_EMPTY',
            });
        }

        // Hard cap mirrors typical social attachment use (images / short docs).
        // The R2 layer also honours `R2_MAX_SIZE_MB`, but we reject early so
        // the storage code does not see oversized payloads. Это и есть
        // пользовательский потолок: `bodyLimit` выше него, чтобы запрос дошёл
        // до хендлера и получил внятный `FILE_TOO_LARGE`.
        if (buffer.length > MAX_UPLOAD_BYTES) {
            return reply.status(413).send({
                success: false,
                error: 'file too large',
                errorCode: 'FILE_TOO_LARGE',
            });
        }

        try {
            const result = await uploadToStorage({
                buffer,
                filename,
                metadata: {
                    originalName: filename,
                    courseId: RUNTIME_UPLOAD_COURSE_ID,
                    courseName: 'Social attachments',
                    mimeType: mimeType || undefined,
                    uploadedBy: userId,
                },
            });
            logAction(
                userId,
                'files_upload_success',
                `Uploaded ${filename}; bytes=${buffer.length}; deduplicated=${result.deduplicated}; fileId=${result.ref.fileId}`,
            );
            return reply.status(201).send({
                success: true,
                data: {
                    fileId: result.ref.fileId,
                    size: buffer.length,
                    contentType: mimeType || null,
                    deduplicated: result.deduplicated,
                },
            });
        } catch (error) {
            console.error('[Files Route] Upload error:', error);
            logAction(userId, 'files_upload_failed', `Upload failed for ${filename}; server exception`);
            return reply.status(500).send({
                success: false,
                error: 'Failed to upload file',
                errorCode: 'FILE_UPLOAD_FAILED',
            });
        }
    });

    /**
     * GET /api/v3/files/stats
     * Статистика хранилища (только для авторизованных)
     */
    app.get('/files/stats', {
        preHandler: [app.authenticate as any],
    }, async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
            const stats = await getStorageStats();

            return {
                success: true,
                data: {
                    ...stats,
                    maxSizeMB: 512, // MongoDB Atlas free tier limit
                    usagePercent: Math.round(stats.totalSizeMB / 512 * 100 * 10) / 10,
                },
            };

        } catch (error) {
            console.error('[Files Route] Stats error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get storage stats',
            });
        }
    });
}
