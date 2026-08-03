import { GridFSBucket, ObjectId } from 'mongodb';
import { getDB } from './mongo.js';
import { type FileMetadata, type LegacyGridFsFileRecord } from './gridfs.js';

const BUCKET_NAME = 'umkd_files';

function getBucket(): GridFSBucket {
    const db = getDB();
    return new GridFSBucket(db, { bucketName: BUCKET_NAME });
}

export async function getLegacyGridFsFilesBatch(
    limit: number,
    afterId?: string
): Promise<LegacyGridFsFileRecord[]> {
    const db = getDB();
    const filesCollection = db.collection<LegacyGridFsFileRecord>(`${BUCKET_NAME}.files`);
    const query: Record<string, unknown> = {
        $or: [
            { 'metadata.storageProvider': { $exists: false } },
            { 'metadata.storageProvider': 'gridfs' },
        ],
    };
    if (afterId) {
        query._id = { $gt: new ObjectId(afterId) };
    }
    return filesCollection
        .find(query)
        .sort({ _id: 1 })
        .limit(limit)
        .toArray();
}

export async function markFileAsR2(
    fileId: string | ObjectId,
    objectKey: string,
    bucket: string
): Promise<void> {
    const db = getDB();
    const objectId = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
    const filesCollection = db.collection(`${BUCKET_NAME}.files`);
    await filesCollection.updateOne(
        { _id: objectId },
        {
            $set: {
                'metadata.storageProvider': 'r2',
                'metadata.r2ObjectKey': objectKey,
                'metadata.r2Bucket': bucket,
            },
        }
    );
}

export async function downloadFile(fileId: string | ObjectId): Promise<{
    buffer: Buffer;
    metadata: FileMetadata;
    filename: string;
} | null> {
    const bucket = getBucket();
    const db = getDB();
    const objectId = typeof fileId === 'string' ? new ObjectId(fileId) : fileId;
    const filesCollection = db.collection(`${BUCKET_NAME}.files`);
    const fileDoc = await filesCollection.findOne({ _id: objectId });

    if (!fileDoc) {
        return null;
    }

    const downloadStream = bucket.openDownloadStream(objectId);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
        downloadStream
            .on('data', (chunk: Buffer) => chunks.push(chunk))
            .on('error', reject)
            .on('end', () => {
                resolve({
                    buffer: Buffer.concat(chunks),
                    metadata: fileDoc.metadata as FileMetadata,
                    filename: fileDoc.filename as string,
                });
            });
    });
}
