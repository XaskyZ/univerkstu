import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectId } from 'mongodb';
import { closeDB, connectDB, getDB } from '../db/mongo.js';
import { computeHash, type GridFsLikeFileDocument } from '../db/gridfs.js';
import { downloadFile } from '../db/gridfs-legacy.js';
import { getObjectFromR2, getR2Config, headObjectInR2 } from '../storage/r2.js';

interface CliOptions {
    provider: 'all' | 'r2' | 'gridfs';
    limit: number;
    afterId?: string;
    deep: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    const opts: CliOptions = {
        provider: 'all',
        limit: 100,
        deep: false,
    };

    for (let i = 0; i < argv.length; i += 1) {
        const raw = argv[i];
        if (!raw.startsWith('-')) {
            if ((raw === 'all' || raw === 'r2' || raw === 'gridfs') && opts.provider === 'all') {
                opts.provider = raw;
                continue;
            }
            const n = Number.parseInt(raw, 10);
            if (Number.isFinite(n) && n > 0 && opts.limit === 100) {
                opts.limit = n;
                continue;
            }
        }
        if (raw === '--deep') {
            opts.deep = true;
            continue;
        }
        if (raw.startsWith('--provider=')) {
            const value = raw.split('=')[1];
            if (value === 'all' || value === 'r2' || value === 'gridfs') {
                opts.provider = value;
            }
            continue;
        }
        if (raw.startsWith('--limit=')) {
            const n = Number.parseInt(raw.split('=')[1] || '', 10);
            if (Number.isFinite(n) && n > 0) opts.limit = n;
            continue;
        }
        if (raw === '--provider') {
            const value = argv[i + 1];
            if (value === 'all' || value === 'r2' || value === 'gridfs') {
                opts.provider = value;
            }
            i += 1;
            continue;
        }
        if (raw === '--limit') {
            const n = Number.parseInt(argv[i + 1] || '', 10);
            if (Number.isFinite(n) && n > 0) opts.limit = n;
            i += 1;
            continue;
        }
        if (raw.startsWith('--after-id=')) {
            const id = raw.split('=')[1];
            if (id) opts.afterId = id;
        }
        if (raw === '--after-id') {
            const id = argv[i + 1];
            if (id) opts.afterId = id;
            i += 1;
        }
    }

    return opts;
}

function buildQuery(provider: CliOptions['provider'], afterId?: string): Record<string, unknown> {
    const query: Record<string, unknown> = {};
    if (provider === 'r2') {
        query['metadata.storageProvider'] = 'r2';
    } else if (provider === 'gridfs') {
        query.$or = [
            { 'metadata.storageProvider': { $exists: false } },
            { 'metadata.storageProvider': 'gridfs' },
        ];
    }
    if (afterId) {
        query._id = { $gt: new ObjectId(afterId) };
    }
    return query;
}

async function run(): Promise<void> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    loadEnv();
    loadEnv({ path: path.resolve(currentDir, '../../../.env'), override: false });

    const opts = parseArgs(process.argv.slice(2));
    const r2 = getR2Config();

    await connectDB();
    const db = getDB();
    const files = db.collection<GridFsLikeFileDocument>('umkd_files.files');
    const query = buildQuery(opts.provider, opts.afterId);

    const docs = await files
        .find(query)
        .sort({ _id: 1 })
        .limit(opts.limit)
        .toArray();

    let ok = 0;
    let failed = 0;
    let checked = 0;
    let lastId = opts.afterId || '';

    for (const doc of docs) {
        checked += 1;
        lastId = doc._id.toString();
        const provider = doc.metadata?.storageProvider || 'gridfs';

        try {
            if (provider === 'r2') {
                if (!r2) {
                    throw new Error('R2 not configured');
                }
                const key = doc.metadata?.r2ObjectKey;
                if (!key) {
                    throw new Error('Missing r2ObjectKey');
                }
                const exists = await headObjectInR2(r2, key);
                if (!exists) {
                    throw new Error('R2 object not found');
                }
                if (opts.deep) {
                    const r2Buffer = await getObjectFromR2(r2, key);
                    if (doc.metadata?.contentHash) {
                        const hash = computeHash(r2Buffer);
                        if (hash !== doc.metadata.contentHash) {
                            throw new Error('R2 hash mismatch');
                        }
                    }
                }
                ok += 1;
                continue;
            }

            const downloaded = await downloadFile(doc._id.toString());
            if (!downloaded) {
                throw new Error('GridFS file not found');
            }
            if (opts.deep) {
                if (doc.metadata?.contentHash) {
                    const hash = computeHash(downloaded.buffer);
                    if (hash !== doc.metadata.contentHash) {
                        throw new Error('GridFS hash mismatch');
                    }
                }
                if (typeof doc.metadata?.size === 'number' && downloaded.buffer.length !== doc.metadata.size) {
                    throw new Error('GridFS size mismatch');
                }
            }
            ok += 1;
        } catch (error) {
            failed += 1;
            console.error(`[Verify] failed fileId=${doc._id.toString()} provider=${provider}`, error);
        }
    }

    await closeDB();

    console.log('');
    console.log('[Verify] Done');
    console.log(`[Verify] provider=${opts.provider}`);
    console.log(`[Verify] deep=${opts.deep}`);
    console.log(`[Verify] checked=${checked}`);
    console.log(`[Verify] ok=${ok}`);
    console.log(`[Verify] failed=${failed}`);
    console.log(`[Verify] lastAfterId=${lastId || '-'}`);
}

run().catch(async (error) => {
    console.error('[Verify] Fatal error:', error);
    await closeDB();
    process.exit(1);
});
