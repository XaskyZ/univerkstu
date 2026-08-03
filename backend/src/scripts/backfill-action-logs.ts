import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDB } from '../db/mongo.js';
import { backfillActionLogs } from '../utils/actionLog.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
loadEnv({ path: path.resolve(currentDir, '../../../.env'), override: false });

async function main() {
    const rawLimit = Number(process.argv[2]);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 20_000) : 5_000;

    await connectDB();
    const result = await backfillActionLogs(limit);
    console.log(`[backfill-action-logs] updated ${result.updated} of ${result.scanned} logs`);
    process.exit(0);
}

main().catch((error) => {
    console.error('[backfill-action-logs] failed:', error);
    process.exit(1);
});
