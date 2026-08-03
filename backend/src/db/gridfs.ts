/**
 * UMKD runtime metadata storage (Postgres + R2).
 * Legacy GridFS helpers live in ./gridfs-legacy.ts and are migration-only.
 */

import { ObjectId } from 'mongodb';
import { withSupabasePostgres } from './postgres.js';
import * as crypto from 'crypto';
export type StorageProvider = 'gridfs' | 'r2';

// Метаданные файла
export interface FileMetadata {
    originalName: string;
    contentHash: string;      // MD5 хеш для дедупликации
    courseId: string;
    courseName: string;
    storageProvider?: StorageProvider;
    r2ObjectKey?: string;
    r2Bucket?: string;
    mimeType?: string;
    uploadedBy?: string;      // userId кто первый загрузил
    uploadedAt: Date;
    size: number;
}

// Информация о файле для клиента
export interface FileInfo {
    fileId: string;
    name: string;
    size: number;
    mimeType?: string;
    courseId: string;
    courseName: string;
    storageProvider: StorageProvider;
    r2ObjectKey?: string;
    r2Bucket?: string;
    downloadUrl: string;
    contentHash?: string; // MD5 hash for client-side deduplication
}

// Запись о связи файла с пользователем
export interface GridFsLikeFileDocument {
    _id: ObjectId;
    filename: string;
    length?: number;
    chunkSize?: number;
    metadata: FileMetadata;
}

export interface LegacyGridFsFileRecord {
    _id: ObjectId;
    filename: string;
    metadata: FileMetadata;
}

interface PgUmkdFileRow {
    file_id: string;
    filename: string;
    length_bytes: string | number | null;
    chunk_size: number | null;
    upload_date: Date | string;
    metadata_json: FileMetadata;
}

async function requireUmkdPostgres<T>(
    operation: string,
    handler: (client: Parameters<Parameters<typeof withSupabasePostgres>[0]>[0]) => Promise<T>
): Promise<T> {
    // Wrap the handler result so a legitimate `null` return (e.g. "no row
    // found") is distinguishable from `withSupabasePostgres` returning `null`
    // because the pool is unavailable. Without this wrapper, findStoredFileByHash
    // returning null for a brand-new file (no dedup match) was misread as
    // "Postgres unavailable" — which broke EVERY new-file upload.
    const wrapped = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (wrapped === null) {
        throw new Error(`[UMKD Storage] Supabase/Postgres is unavailable during ${operation}`);
    }
    return wrapped.value;
}

function mapPgUmkdFileRow(row: PgUmkdFileRow): GridFsLikeFileDocument {
    return {
        _id: new ObjectId(row.file_id),
        filename: row.filename,
        length: row.length_bytes == null ? undefined : Number(row.length_bytes),
        chunkSize: row.chunk_size ?? undefined,
        metadata: row.metadata_json,
    };
}

async function loadPgFileById(fileId: string): Promise<GridFsLikeFileDocument | null> {
    const pgRow = await withSupabasePostgres(async (client) => {
        const result = await client.query<PgUmkdFileRow>(
            `
                select file_id, filename, length_bytes, chunk_size, upload_date, metadata_json
                from app_umkd_files
                where file_id = $1
                limit 1
            `,
            [fileId]
        );
        return result.rows[0] ?? null;
    });
    return pgRow ? mapPgUmkdFileRow(pgRow) : null;
}

function mapDocToFileInfo(doc: GridFsLikeFileDocument): FileInfo {
    const metadata = doc.metadata as FileMetadata;
    return {
        fileId: doc._id.toString(),
        name: doc.filename as string,
        size: metadata.size,
        mimeType: metadata.mimeType,
        courseId: metadata.courseId,
        courseName: metadata.courseName,
        storageProvider: metadata.storageProvider || 'gridfs',
        r2ObjectKey: metadata.r2ObjectKey,
        r2Bucket: metadata.r2Bucket,
        downloadUrl: `/api/v3/files/${doc._id.toString()}`,
        contentHash: metadata.contentHash,
    };
}

/**
 * Вычислить MD5 хеш буфера
 */
export function computeHash(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

/**
 * Найти документ файла по хешу и курсу (gridfs/r2)
 */
export async function findStoredFileByHash(
    contentHash: string,
    courseId: string
): Promise<GridFsLikeFileDocument | null> {
    const pgDoc = await requireUmkdPostgres(`findStoredFileByHash(${courseId})`, async (client) => {
        const result = await client.query<PgUmkdFileRow>(
            `
                select file_id, filename, length_bytes, chunk_size, upload_date, metadata_json
                from app_umkd_files
                where metadata_json->>'contentHash' = $1
                  and metadata_json->>'courseId' = $2
                limit 1
            `,
            [contentHash, courseId]
        );
        return result.rows[0] ?? null;
    });
    return pgDoc ? mapPgUmkdFileRow(pgDoc) : null;
}

/**
 * Зарегистрировать файл, который физически хранится в R2
 */
export async function registerR2File(
    filename: string,
    metadata: Omit<FileMetadata, 'storageProvider' | 'uploadedAt' | 'size'> & {
        size: number;
        r2ObjectKey: string;
        r2Bucket: string;
    }
): Promise<ObjectId> {
    const fileId = new ObjectId();
    const now = new Date();
    await requireUmkdPostgres('registerR2File', async (client) => {
        await client.query(
            `
                insert into app_umkd_files (
                    file_id, filename, length_bytes, chunk_size, upload_date, metadata_json
                )
                values ($1, $2, $3, $4, $5, $6::jsonb)
                on conflict (file_id)
                do update set
                    filename = excluded.filename,
                    length_bytes = excluded.length_bytes,
                    chunk_size = excluded.chunk_size,
                    upload_date = excluded.upload_date,
                    metadata_json = excluded.metadata_json
            `,
            [
                fileId.toString(),
                filename,
                metadata.size,
                261120,
                now,
                JSON.stringify({
                    ...metadata,
                    storageProvider: 'r2',
                    uploadedAt: now,
                } as FileMetadata),
            ]
        );
        return true;
    });
    return fileId;
}

/**
 * Получить raw документ файла из metadata-коллекции
 */
async function getRawFileDocument(fileId: string | ObjectId): Promise<GridFsLikeFileDocument | null> {
    const objectId = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
    return loadPgFileById(objectId.toString());
}

/**
 * Получить информацию о файле без скачивания
 */
export async function getFileInfo(fileId: string | ObjectId): Promise<FileInfo | null> {
    const objectId = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
    const fileDoc = await getRawFileDocument(objectId);

    if (!fileDoc) {
        return null;
    }

    return mapDocToFileInfo(fileDoc);
}

/**
 * Минимальный срез метаданных, нужный для проверки прав на файл.
 *
 * Отдельная функция (а не `getFileInfo`) по двум причинам:
 *   - `FileInfo` намеренно НЕ отдаёт `uploadedBy` наружу, а проверке доступа
 *     он нужен;
 *   - здесь не нужен `ObjectId`-парсинг: `app_umkd_files.file_id` — текст,
 *     поэтому произвольная строка не роняет запрос исключением.
 */
export interface FileOwnershipInfo {
    fileId: string;
    /** userId первого загрузившего; `null` у legacy-строк без метаданных. */
    uploadedBy: string | null;
    /**
     * `courseId` из метаданных. У материалов УМКД это реальный курс, у
     * runtime-загрузок через POST /files/upload — служебное значение
     * `'social'` (см. RUNTIME_UPLOAD_COURSE_ID в services/file-access.ts).
     */
    courseId: string | null;
}

export async function getFileOwnership(fileId: string): Promise<FileOwnershipInfo | null> {
    const trimmed = (fileId || '').trim();
    if (!trimmed) return null;

    const row = await requireUmkdPostgres(`getFileOwnership(${trimmed})`, async (client) => {
        const result = await client.query<{ uploaded_by: string | null; course_id: string | null }>(
            `
                select
                    metadata_json->>'uploadedBy' as uploaded_by,
                    metadata_json->>'courseId' as course_id
                from app_umkd_files
                where file_id = $1
                limit 1
            `,
            [trimmed]
        );
        return result.rows[0] ?? null;
    });

    if (!row) return null;
    return {
        fileId: trimmed,
        uploadedBy: row.uploaded_by ?? null,
        courseId: row.course_id ?? null,
    };
}

/**
 * Удалить все файлы, загруженные конкретным пользователем
 */
export async function deleteFilesByUploadedUser(userId: string): Promise<number> {
    const pgDeleted = await requireUmkdPostgres(`deleteFilesByUploadedUser(${userId})`, async (client) => {
        const result = await client.query<PgUmkdFileRow>(
            `
                delete from app_umkd_files
                where metadata_json->>'uploadedBy' = $1
                returning file_id, filename, length_bytes, chunk_size, upload_date, metadata_json
            `,
            [userId]
        );
        return result.rows.map(mapPgUmkdFileRow);
    });
    return pgDeleted.length;
}

/**
 * Получить статистику хранилища
 */
export async function getStorageStats(): Promise<{
    totalFiles: number;
    totalSize: number;
    totalSizeMB: number;
    uniqueHashes: number;
}> {
    const pgStats = await requireUmkdPostgres('getStorageStats', async (client) => {
        const result = await client.query<{
            total_files: string;
            total_size: string | null;
            unique_hashes: string;
        }>(
            `
                select
                    count(*)::text as total_files,
                    coalesce(sum((metadata_json->>'size')::bigint), 0)::text as total_size,
                    count(distinct metadata_json->>'contentHash')::text as unique_hashes
                from app_umkd_files
            `
        );
        return result.rows[0] ?? null;
    });
    const totalSize = Number(pgStats.total_size || 0);
    return {
        totalFiles: Number(pgStats.total_files || 0),
        totalSize,
        totalSizeMB: Math.round(totalSize / 1024 / 1024 * 100) / 100,
        uniqueHashes: Number(pgStats.unique_hashes || 0),
    };
}

/**
 * Получить статистику файлов по storage provider.
 * Документы без metadata.storageProvider считаются legacy GridFS.
 */
export async function getStorageProviderStats(): Promise<{
    total: number;
    gridfs: number;
    r2: number;
}> {
    const pgStats = await requireUmkdPostgres('getStorageProviderStats', async (client) => {
        const result = await client.query<{
            total: string;
            r2_count: string;
        }>(
            `
                select
                    count(*)::text as total,
                    count(*) filter (where coalesce(metadata_json->>'storageProvider', 'gridfs') = 'r2')::text as r2_count
                from app_umkd_files
            `
        );
        return result.rows[0] ?? null;
    });
    const total = Number(pgStats.total || 0);
    const r2Count = Number(pgStats.r2_count || 0);
    return {
        total,
        r2: r2Count,
        gridfs: Math.max(total - r2Count, 0),
    };
}

export async function getStorageHealthBreakdown(): Promise<{
    mongodb: {
        database: string;
        dataSizeMB: number;
        storageSizeMB: number;
        totalCollections: number;
        legacyGridFsFiles: number;
        legacyGridFsChunks: number;
        status: 'ok' | 'legacy_cleanup_needed';
    };
    r2: {
        configured: boolean;
        bucket: string | null;
        files: number;
        estimatedSizeMB: number;
        actualObjects: number;
        actualSizeMB: number;
        referencedObjects: number;
        referencedSizeMB: number;
        orphanedObjects: number;
        orphanedSizeMB: number;
        duplicateReferenceRows: number;
        duplicateReferenceOvercountMB: number;
        status: 'ready' | 'active' | 'not_configured';
    };
}> {
    const pgBreakdown = await requireUmkdPostgres('getStorageHealthBreakdown', async (client) => {
        const filesStats = await client.query<{
            total: string;
            legacy_gridfs_files: string;
            r2_files: string;
            r2_size: string | null;
        }>(
            `
                select
                    count(*)::text as total,
                    count(*) filter (where coalesce(metadata_json->>'storageProvider', 'gridfs') = 'gridfs')::text as legacy_gridfs_files,
                    count(*) filter (where metadata_json->>'storageProvider' = 'r2')::text as r2_files,
                    coalesce(sum(case when metadata_json->>'storageProvider' = 'r2' then (metadata_json->>'size')::bigint else 0 end), 0)::text as r2_size
                from app_umkd_files
            `
        );
        const referencedObjects = await client.query<{
            object_key: string;
            size_bytes: string;
            refs: string;
        }>(
            `
                select
                    metadata_json->>'r2ObjectKey' as object_key,
                    max(coalesce((metadata_json->>'size')::bigint, 0))::text as size_bytes,
                    count(*)::text as refs
                from app_umkd_files
                where metadata_json->>'storageProvider' = 'r2'
                  and metadata_json->>'r2ObjectKey' is not null
                group by metadata_json->>'r2ObjectKey'
            `
        );

        return {
            summary: filesStats.rows[0],
            referencedObjects: referencedObjects.rows,
        };
    });
    const { getR2Config } = await import('../storage/r2.js');
    const { listAllObjectsInR2 } = await import('../storage/r2.js');
    const r2 = getR2Config();
    const estimatedR2Size = Number(pgBreakdown.summary.r2_size || 0);
    const legacyGridFsFiles = Number(pgBreakdown.summary.legacy_gridfs_files || 0);
    const r2Files = Number(pgBreakdown.summary.r2_files || 0);
    const referencedObjectMap = new Map<string, { sizeBytes: number; refs: number }>(
        pgBreakdown.referencedObjects
            .filter((row) => Boolean(row.object_key))
            .map((row) => [
                row.object_key,
                {
                    sizeBytes: Number(row.size_bytes || 0),
                    refs: Number(row.refs || 0),
                },
            ])
    );
    const referencedObjects = referencedObjectMap.size;
    const referencedSizeBytes = Array.from(referencedObjectMap.values())
        .reduce<number>((sum, item) => sum + item.sizeBytes, 0);
    const duplicateReferenceRows = Array.from(referencedObjectMap.values())
        .reduce<number>((sum, item) => sum + Math.max(item.refs - 1, 0), 0);
    const duplicateReferenceOvercountBytes = Array.from(referencedObjectMap.values())
        .reduce<number>((sum, item) => sum + (item.refs > 1 ? item.sizeBytes * (item.refs - 1) : 0), 0);

    let actualObjects = 0;
    let actualSizeBytes = 0;
    let orphanedObjects = 0;
    let orphanedSizeBytes = 0;

    if (r2) {
        const bucketObjects = await listAllObjectsInR2(r2, 'umkd/');
        actualObjects = bucketObjects.length;
        actualSizeBytes = bucketObjects.reduce((sum, item) => sum + item.size, 0);

        for (const object of bucketObjects) {
            if (!referencedObjectMap.has(object.key)) {
                orphanedObjects += 1;
                orphanedSizeBytes += object.size;
            }
        }
    }

    return {
        mongodb: {
            database: 'legacy-gridfs',
            dataSizeMB: 0,
            storageSizeMB: 0,
            totalCollections: 0,
            legacyGridFsFiles,
            legacyGridFsChunks: 0,
            status: legacyGridFsFiles > 0 ? 'legacy_cleanup_needed' : 'ok',
        },
        r2: {
            configured: Boolean(r2),
            bucket: r2?.bucket || null,
            files: r2Files,
            estimatedSizeMB: Math.round((estimatedR2Size / 1024 / 1024) * 100) / 100,
            actualObjects,
            actualSizeMB: Math.round((actualSizeBytes / 1024 / 1024) * 100) / 100,
            referencedObjects,
            referencedSizeMB: Math.round((referencedSizeBytes / 1024 / 1024) * 100) / 100,
            orphanedObjects,
            orphanedSizeMB: Math.round((orphanedSizeBytes / 1024 / 1024) * 100) / 100,
            duplicateReferenceRows,
            duplicateReferenceOvercountMB: Math.round((duplicateReferenceOvercountBytes / 1024 / 1024) * 100) / 100,
            status: !r2 ? 'not_configured' : r2Files > 0 ? 'active' : 'ready',
        },
    };
}

/**
 * Получить список всех файлов курса
 */
export async function getFilesByCourse(courseId: string): Promise<FileInfo[]> {
    const pgFiles = await requireUmkdPostgres(`getFilesByCourse(${courseId})`, async (client) => {
        const result = await client.query<PgUmkdFileRow>(
            `
                select file_id, filename, length_bytes, chunk_size, upload_date, metadata_json
                from app_umkd_files
                where metadata_json->>'courseId' = $1
                order by upload_date desc
            `,
            [courseId]
        );
        return result.rows.map((row) => mapDocToFileInfo(mapPgUmkdFileRow(row)));
    });
    return pgFiles;
}

/**
 * Получить файлы для нескольких курсов одним batch-запросом (N+1 fix)
 */
export async function getFilesByMultipleCourses(courseIds: string[]): Promise<Map<string, FileInfo[]>> {
    const pgFiles = await requireUmkdPostgres('getFilesByMultipleCourses', async (client) => {
        const result = await client.query<PgUmkdFileRow>(
            `
                select file_id, filename, length_bytes, chunk_size, upload_date, metadata_json
                from app_umkd_files
                where metadata_json->>'courseId' = any($1::text[])
                order by upload_date desc
            `,
            [courseIds]
        );
        return result.rows.map((row) => mapDocToFileInfo(mapPgUmkdFileRow(row)));
    });
    const result = new Map<string, FileInfo[]>();
    for (const id of courseIds) {
        result.set(id, []);
    }

    for (const info of pgFiles) {
        result.get(info.courseId)?.push(info);
    }

    return result;
}

/**
 * Определить MIME тип по расширению файла
 */
export function getMimeType(filename: string): string {
    const ext = filename.toLowerCase().split('.').pop();
    const mimeTypes: Record<string, string> = {
        'pdf': 'application/pdf',
        'doc': 'application/msword',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel',
        'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint',
        'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'odt': 'application/vnd.oasis.opendocument.text',
        'ods': 'application/vnd.oasis.opendocument.spreadsheet',
        'odp': 'application/vnd.oasis.opendocument.presentation',
        'rtf': 'application/rtf',
        'txt': 'text/plain',
        'md': 'text/markdown',
        'csv': 'text/csv',
        'zip': 'application/zip',
        'rar': 'application/x-rar-compressed',
        '7z': 'application/x-7z-compressed',
        'tar': 'application/x-tar',
        'gz': 'application/gzip',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'png': 'image/png',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'bmp': 'image/bmp',
        'svg': 'image/svg+xml',
        'heic': 'image/heic',
        'avif': 'image/avif',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
}
