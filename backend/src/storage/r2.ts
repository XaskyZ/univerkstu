import {
    DeleteObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
    NoSuchKey,
    PutObjectCommand,
    S3Client,
    S3ServiceException
} from '@aws-sdk/client-s3';

export interface R2Config {
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
}

export interface R2ObjectInfo {
    key: string;
    size: number;
    lastModified: string | null;
}

export function getR2Config(): R2Config | null {
    const bucket = process.env.R2_BUCKET_NAME?.trim();
    const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
    let endpoint = process.env.R2_ENDPOINT?.trim();

    if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
        return null;
    }

    // Accept both "...cloudflarestorage.com" and "...cloudflarestorage.com/<bucket>" formats.
    endpoint = endpoint.replace(/\/+$/, '');
    const parsed = tryParseUrl(endpoint);
    if (parsed && parsed.pathname && parsed.pathname !== '/') {
        const pathPart = parsed.pathname.replace(/^\/+/, '');
        if (pathPart && pathPart === bucket) {
            parsed.pathname = '/';
            endpoint = parsed.toString().replace(/\/+$/, '');
        }
    }

    return {
        endpoint,
        bucket,
        accessKeyId,
        secretAccessKey,
    };
}

function tryParseUrl(value: string): URL | null {
    try {
        return new URL(value);
    } catch {
        return null;
    }
}

function getClient(config: R2Config): S3Client {
    return new S3Client({
        endpoint: config.endpoint,
        region: 'auto',
        forcePathStyle: true,
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });
}

export function buildObjectKey(courseId: string, contentHash: string, safeFilename: string): string {
    const cleanFilename = safeFilename.replace(/^\/+/, '').replace(/\.\.+/g, '.');
    return `umkd/${courseId}/${contentHash}/${cleanFilename}`;
}

export async function putObjectToR2(
    config: R2Config,
    key: string,
    body: Buffer,
    contentType?: string
): Promise<void> {
    const client = getClient(config);
    await client.send(new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType || 'application/octet-stream',
        ContentLength: body.length,
    }));
}

export async function getObjectFromR2(config: R2Config, key: string): Promise<Buffer> {
    const client = getClient(config);
    const response = await client.send(new GetObjectCommand({
        Bucket: config.bucket,
        Key: key,
    }));

    if (!response.Body) {
        throw new Error('R2 object body is empty');
    }

    const chunks: Buffer[] = [];
    // Body is an async iterable in Node runtime.
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
        chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

export async function headObjectInR2(config: R2Config, key: string): Promise<boolean> {
    const client = getClient(config);
    try {
        await client.send(new HeadObjectCommand({
            Bucket: config.bucket,
            Key: key,
        }));
        return true;
    } catch (error) {
        if (error instanceof NoSuchKey) {
            return false;
        }
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
            return false;
        }
        throw error;
    }
}

export async function deleteObjectFromR2(config: R2Config, key: string): Promise<void> {
    const client = getClient(config);
    await client.send(new DeleteObjectCommand({
        Bucket: config.bucket,
        Key: key,
    }));
}

export async function listObjectsInR2(
    config: R2Config,
    prefix: string,
    maxKeys = 20
): Promise<R2ObjectInfo[]> {
    const client = getClient(config);
    const response = await client.send(new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        MaxKeys: Math.max(1, Math.min(maxKeys, 100)),
    }));

    return (response.Contents || [])
        .filter((item): item is NonNullable<typeof item> & { Key: string } => Boolean(item?.Key))
        .map((item) => ({
            key: item.Key,
            size: item.Size || 0,
            lastModified: item.LastModified ? item.LastModified.toISOString() : null,
        }))
        .sort((a, b) => (b.lastModified || '').localeCompare(a.lastModified || ''));
}

export async function listAllObjectsInR2(
    config: R2Config,
    prefix = ''
): Promise<R2ObjectInfo[]> {
    const client = getClient(config);
    const objects: R2ObjectInfo[] = [];
    let continuationToken: string | undefined;

    do {
        const response = await client.send(new ListObjectsV2Command({
            Bucket: config.bucket,
            Prefix: prefix || undefined,
            MaxKeys: 1000,
            ContinuationToken: continuationToken,
        }));

        for (const item of response.Contents || []) {
            if (!item?.Key) continue;
            objects.push({
                key: item.Key,
                size: item.Size || 0,
                lastModified: item.LastModified ? item.LastModified.toISOString() : null,
            });
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return objects;
}
