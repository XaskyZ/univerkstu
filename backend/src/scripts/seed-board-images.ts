/**
 * Attach demo photos to seeded board announcements.
 *
 * Usage:
 *   npm run seed:board-images -- [authorUserId]   (default author: demo-student)
 *
 * Finds the board announcements posted by the given author that have no image
 * attachment yet, downloads a couple of placeholder photos from picsum.photos,
 * stores them in R2 via the storage abstraction, and registers them as social
 * attachments — so the grid shows real cover images and the detail page shows a
 * gallery. Idempotent: posts that already have an image are skipped.
 *
 * Requires the same env as the backend (Supabase + R2). One-time fetch; images
 * are self-hosted in R2 afterwards.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSupabasePostgres } from '../db/postgres.js';
import { uploadToStorage } from '../storage/index.js';
import { attachFile, listAttachments } from '../services/social.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
loadEnv({ path: path.resolve(currentDir, '../../../.env'), override: false });

const IMAGES_PER_POST = 2;

interface BoardRow { id: string; payload: { category?: string; title?: string } | null }

async function fetchPicsum(seed: string): Promise<Buffer> {
    const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/640/480`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`picsum responded ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
}

async function main() {
    const author = process.argv[2] || 'demo-student';
    console.log(`[seed-board-images] author="${author}", ${IMAGES_PER_POST} photo(s)/post`);

    const posts = await withSupabasePostgres<BoardRow[]>(async (client) => {
        const result = await client.query<BoardRow>(
            `
                select id::text as id, payload
                from app_social_entity
                where scope_type = 'announcement'
                  and scope_id = 'announcement:student-board'
                  and author_user_id = $1
                  and deleted_at is null
                order by created_at asc
            `,
            [author],
        );
        return result.rows;
    });

    if (posts === null) {
        console.error('[seed-board-images] Postgres unavailable (check env).');
        process.exit(1);
    }
    if (posts.length === 0) {
        console.warn(`[seed-board-images] No board posts found for "${author}". Run "npm run seed:board -- ${author}" first.`);
        process.exit(0);
    }

    let attached = 0;
    for (const post of posts) {
        const existing = await listAttachments(post.id, author);
        if (existing.some((a) => (a.mime || '').startsWith('image/'))) {
            console.log(`  • skip ${post.id} (already has an image)`);
            continue;
        }
        const category = post.payload?.category || 'other';
        for (let i = 0; i < IMAGES_PER_POST; i += 1) {
            try {
                const buffer = await fetchPicsum(`board-${category}-${post.id.slice(0, 8)}-${i}`);
                const filename = `${category}-${i + 1}.jpg`;
                const result = await uploadToStorage({
                    buffer,
                    filename,
                    metadata: {
                        originalName: filename,
                        courseId: 'social',
                        courseName: 'Social attachments',
                        mimeType: 'image/jpeg',
                        uploadedBy: author,
                    },
                });
                // attachFile is author-only — the posts queried above all belong
                // to `author`, so the seeding actor is the entity's own author.
                await attachFile(post.id, result.ref.fileId, 'image/jpeg', buffer.length, i, author);
                attached += 1;
                console.log(`  ✓ ${post.id} [${category}] image ${i + 1} (fileId=${result.ref.fileId})`);
            } catch (error) {
                console.error(`  ✗ ${post.id} image ${i + 1}:`, error instanceof Error ? error.message : error);
            }
        }
    }

    console.log(`[seed-board-images] done: ${attached} image(s) attached.`);
    process.exit(0);
}

main().catch((error) => {
    console.error('[seed-board-images] failed:', error);
    process.exit(1);
});
