import {
    computeHash,
    findStoredFileByHash,
    getFileInfo,
    getMimeType,
    registerR2File,
    type FileMetadata,
    type StorageProvider
} from '../db/gridfs.js';
import {
    buildObjectKey,
    getObjectFromR2,
    getR2Config,
    headObjectInR2,
    putObjectToR2
} from './r2.js';

export interface StoredFileRef {
    provider: StorageProvider;
    fileId: string;
    objectKey?: string;
    bucket?: string;
}

export interface StorageUploadInput {
    buffer: Buffer;
    filename: string;
    metadata: Omit<FileMetadata, 'contentHash' | 'uploadedAt' | 'size' | 'storageProvider'>;
}

export interface StorageUploadResult {
    ref: StoredFileRef;
    deduplicated: boolean;
    contentHash: string;
}

export interface DownloadedStorageObject {
    buffer: Buffer;
    contentType: string;
    filename: string;
    fileId: string;
    provider: StorageProvider;
}

export function isR2Configured(): boolean {
    return Boolean(getR2Config());
}

export function getStorageBackendLabel(): string {
    return 'r2';
}

export async function uploadToStorage(input: StorageUploadInput): Promise<StorageUploadResult> {
    const { buffer, filename, metadata } = input;
    const contentHash = computeHash(buffer);

    const existingDoc = await findStoredFileByHash(contentHash, metadata.courseId);
    if (existingDoc) {
        const provider = existingDoc.metadata.storageProvider || 'gridfs';
        return {
            deduplicated: true,
            contentHash,
            ref: {
                provider,
                fileId: existingDoc._id.toString(),
                objectKey: existingDoc.metadata.r2ObjectKey,
                bucket: existingDoc.metadata.r2Bucket,
            },
        };
    }

    const r2 = getR2Config();
    if (!r2) {
        throw new Error('R2 is not configured for runtime uploads');
    }
    const objectKey = buildObjectKey(metadata.courseId, contentHash, filename);
    const contentType = metadata.mimeType || getMimeType(filename);
    try {
        await putObjectToR2(r2, objectKey, buffer, contentType);

        const fileId = await registerR2File(filename, {
            ...metadata,
            contentHash,
            size: buffer.length,
            r2ObjectKey: objectKey,
            r2Bucket: r2.bucket,
            mimeType: contentType,
        });

        console.log(`[Storage] Uploaded to R2: ${filename}`);
        return {
            deduplicated: false,
            contentHash,
            ref: {
                provider: 'r2',
                fileId: fileId.toString(),
                objectKey,
                bucket: r2.bucket,
            },
        };
    } catch (error) {
        throw error;
    }
}

export async function downloadFromStorageByFileId(fileId: string): Promise<DownloadedStorageObject | null> {
    const fileInfo = await getFileInfo(fileId);
    if (!fileInfo) {
        return null;
    }

    const r2 = getR2Config();
    if (!r2) {
        throw new Error('R2 file requested but R2 is not configured');
    }
    if (!fileInfo.r2ObjectKey) {
        throw new Error(`R2 metadata missing object key for file ${fileId}`);
    }
    const exists = await headObjectInR2(r2, fileInfo.r2ObjectKey);
    if (!exists) {
        throw new Error(`R2 object not found for file ${fileId}`);
    }

    const buffer = await getObjectFromR2(r2, fileInfo.r2ObjectKey);
    return {
        buffer,
        contentType: fileInfo.mimeType || 'application/octet-stream',
        filename: fileInfo.name,
        fileId,
        provider: 'r2',
    };
}
