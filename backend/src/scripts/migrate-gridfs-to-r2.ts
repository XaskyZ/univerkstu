import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB, closeDB } from '../db/mongo.js';
import { computeHash, type LegacyGridFsFileRecord } from '../db/gridfs.js';
import {
    downloadFile,
    getLegacyGridFsFilesBatch,
    markFileAsR2,
} from '../db/gridfs-legacy.js';
import {
    buildObjectKey,
    getObjectFromR2,
    getR2Config,
    headObjectInR2,
    putObjectToR2,
} from '../storage/r2.js';

interface CliOptions {
    batch: number;
    concurrency: number;
    afterId?: string;
    max?: number;
    dryRun: boolean;
    verify: 'full' | 'none';
}

function parseArgs(argv: string[]): CliOptions {
    const opts: CliOptions = {
        batch: 100,
        concurrency: 6,
        dryRun: false,
        verify: 'full',
    };

    for (let i = 0; i < argv.length; i += 1) {
        const raw = argv[i];
        if (!raw.startsWith('-')) {
            if ((raw === 'none' || raw === 'full') && opts.verify === 'full') {
                opts.verify = raw;
                continue;
            }
            const n = Number.parseInt(raw, 10);
            if (Number.isFinite(n) && n > 0) {
                if (opts.batch === 100) {
                    opts.batch = n;
                    continue;
                }
                if (opts.max === undefined) {
                    opts.max = n;
                    continue;
                }
            }
            if (!opts.afterId && /^[a-fA-F0-9]{24}$/.test(raw)) {
                opts.afterId = raw;
                continue;
            }
        }
        if (raw === '--dry-run') {
            opts.dryRun = true;
            continue;
        }
        if (raw.startsWith('--batch=')) {
            const n = Number.parseInt(raw.split('=')[1] || '', 10);
            if (Number.isFinite(n) && n > 0) opts.batch = n;
            continue;
        }
        if (raw.startsWith('--max=')) {
            const n = Number.parseInt(raw.split('=')[1] || '', 10);
            if (Number.isFinite(n) && n > 0) opts.max = n;
            continue;
        }
        if (raw.startsWith('--concurrency=')) {
            const n = Number.parseInt(raw.split('=')[1] || '', 10);
            if (Number.isFinite(n) && n > 0) opts.concurrency = n;
            continue;
        }
        if (raw === '--batch') {
            const n = Number.parseInt(argv[i + 1] || '', 10);
            if (Number.isFinite(n) && n > 0) opts.batch = n;
            i += 1;
            continue;
        }
        if (raw === '--max') {
            const n = Number.parseInt(argv[i + 1] || '', 10);
            if (Number.isFinite(n) && n > 0) opts.max = n;
            i += 1;
            continue;
        }
        if (raw === '--concurrency') {
            const n = Number.parseInt(argv[i + 1] || '', 10);
            if (Number.isFinite(n) && n > 0) opts.concurrency = n;
            i += 1;
            continue;
        }
        if (raw.startsWith('--verify=')) {
            const value = raw.split('=')[1];
            if (value === 'none' || value === 'full') {
                opts.verify = value;
            }
            continue;
        }
        if (raw === '--verify') {
            const value = argv[i + 1];
            if (value === 'none' || value === 'full') {
                opts.verify = value;
            }
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

async function migrateOne(
    record: LegacyGridFsFileRecord,
    dryRun: boolean,
    verify: 'full' | 'none'
): Promise<'migrated' | 'skipped' | 'failed'> {
    const fileId = record._id.toString();
    const r2 = getR2Config();
    if (!r2) {
        throw new Error('R2 is not configured');
    }

    const hash = record.metadata.contentHash;
    if (!hash) {
        console.error(`[Migrate] Missing contentHash, skip fileId=${fileId}`);
        return 'skipped';
    }

    const objectKey = buildObjectKey(record.metadata.courseId, hash, record.filename);

    if (dryRun) {
        console.log(`[Migrate][dry-run] ${fileId} -> ${objectKey}`);
        return 'skipped';
    }

    try {
        let sourceBuffer: Buffer | null = null;

        const exists = await headObjectInR2(r2, objectKey);
        if (!exists) {
            const downloaded = await downloadFile(fileId);
            if (!downloaded) {
                console.error(`[Migrate] GridFS source not found fileId=${fileId}`);
                return 'failed';
            }
            sourceBuffer = downloaded.buffer;
            await putObjectToR2(
                r2,
                objectKey,
                sourceBuffer,
                record.metadata.mimeType || 'application/octet-stream'
            );
        }

        if (verify === 'full') {
            const r2Buffer = await getObjectFromR2(r2, objectKey);
            if (!sourceBuffer) {
                const downloaded = await downloadFile(fileId);
                if (!downloaded) {
                    console.error(`[Migrate] GridFS source not found for verify fileId=${fileId}`);
                    return 'failed';
                }
                sourceBuffer = downloaded.buffer;
            }

            const sourceHash = computeHash(sourceBuffer);
            const targetHash = computeHash(r2Buffer);
            if (sourceHash !== targetHash) {
                console.error(`[Migrate] Hash mismatch fileId=${fileId} source=${sourceHash} target=${targetHash}`);
                return 'failed';
            }
            if (sourceBuffer.length !== r2Buffer.length) {
                console.error(`[Migrate] Size mismatch fileId=${fileId} source=${sourceBuffer.length} target=${r2Buffer.length}`);
                return 'failed';
            }
        }

        await markFileAsR2(fileId, objectKey, r2.bucket);
        console.log(`[Migrate] OK fileId=${fileId} key=${objectKey}`);
        return 'migrated';
    } catch (error) {
        console.error(`[Migrate] Failed fileId=${fileId}`, error);
        return 'failed';
    }
}

async function processBatchConcurrently(
    batch: LegacyGridFsFileRecord[],
    opts: CliOptions
): Promise<{ migrated: number; skipped: number; failed: number }> {
    let index = 0;
    let migrated = 0;
    let skipped = 0;
    let failed = 0;

    const workers = Array.from({ length: Math.max(1, opts.concurrency) }, async () => {
        while (true) {
            const current = index;
            index += 1;
            if (current >= batch.length) return;

            const record = batch[current];
            const status = await migrateOne(record, opts.dryRun, opts.verify);
            if (status === 'migrated') migrated += 1;
            if (status === 'skipped') skipped += 1;
            if (status === 'failed') failed += 1;
        }
    });

    await Promise.all(workers);
    return { migrated, skipped, failed };
}

async function run(): Promise<void> {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    loadEnv();
    loadEnv({ path: path.resolve(currentDir, '../../../.env'), override: false });

    const opts = parseArgs(process.argv.slice(2));
    const r2 = getR2Config();
    if (!r2) {
        throw new Error('R2 is not configured. Set R2_* env vars before migration.');
    }

    await connectDB();

    let cursorAfterId = opts.afterId;
    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    let processed = 0;

    try {
        while (true) {
            if (opts.max && processed >= opts.max) {
                break;
            }

            const remaining = opts.max ? Math.max(opts.max - processed, 0) : opts.batch;
            const batchSize = Math.min(opts.batch, remaining || opts.batch);
            const batch = await getLegacyGridFsFilesBatch(batchSize, cursorAfterId);
            if (batch.length === 0) {
                break;
            }

            const summary = await processBatchConcurrently(batch, opts);
            processed += batch.length;
            migrated += summary.migrated;
            skipped += summary.skipped;
            failed += summary.failed;
            cursorAfterId = batch[batch.length - 1]?._id.toString();

            console.log(
                `[Migrate] Batch done: size=${batch.length} migrated=${summary.migrated} skipped=${summary.skipped} failed=${summary.failed}`
            );
        }
    } finally {
        await closeDB();
    }

    console.log('');
    console.log('[Migrate] Done');
    console.log(`[Migrate] processed=${processed}`);
    console.log(`[Migrate] migrated=${migrated}`);
    console.log(`[Migrate] skipped=${skipped}`);
    console.log(`[Migrate] failed=${failed}`);
    console.log(`[Migrate] lastAfterId=${cursorAfterId || '-'}`);
    console.log(`[Migrate] verify=${opts.verify}`);
    console.log(`[Migrate] concurrency=${opts.concurrency}`);
}

run().catch((error) => {
    console.error('[Migrate] Fatal error:', error);
    process.exit(1);
});
