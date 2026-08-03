/**
 * Seed a few sample announcements onto the student board.
 *
 * Usage:
 *   npm run seed:board -- <authorUserId>
 *
 * `<authorUserId>` should be your own student login so the seeded posts show up
 * as authored by you (you can then edit / delete them in the UI). Falls back to
 * the BOARD_SEED_AUTHOR env var, then to "demo-student".
 *
 * Requires the same DB env as the backend (the board writes through the
 * universal social store on Supabase/Postgres). Safe to re-run — it simply adds
 * more sample rows; delete them from the UI when you're done.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoardAnnouncement, type BoardCategory } from '../services/board.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
loadEnv({ path: path.resolve(currentDir, '../../../.env'), override: false });

const SAMPLES: Array<{ title: string; body: string; category: BoardCategory }> = [
    {
        category: 'sale',
        title: 'Продам учебник по матанализу (Демидович)',
        body: 'Состояние отличное, без пометок. 2000 тг. Пишите в комментарии или в ЛС.',
    },
    {
        category: 'lost_found',
        title: 'Найдена студенческая карта в столовой',
        body: 'Сегодня в обед нашёл студенческий на 2 этаже у окна. Опишите имя в комментариях — верну.',
    },
    {
        category: 'event',
        title: 'Турнир по настолкам в субботу',
        body: 'Собираемся в 15:00 в коворкинге, общаге №3. Будут «Каркассон», «Манчкин» и чай. Приходите!',
    },
    {
        category: 'help',
        title: 'Нужна помощь с лабой по физике',
        body: 'Кто шарит за электростатику — буду благодарен за пару советов. Можно онлайн.',
    },
];

async function main() {
    const authorUserId = process.argv[2] || process.env.BOARD_SEED_AUTHOR || 'demo-student';
    console.log(`[seed-board] creating ${SAMPLES.length} announcements as author "${authorUserId}"…`);

    let created = 0;
    for (const sample of SAMPLES) {
        try {
            const view = await createBoardAnnouncement({
                authorUserId,
                title: sample.title,
                body: sample.body,
                category: sample.category,
            });
            created += 1;
            console.log(`  ✓ [${sample.category}] ${sample.title} (id=${view.entity.id})`);
        } catch (error) {
            console.error(`  ✗ failed: ${sample.title}`, error);
        }
    }

    console.log(`[seed-board] done: ${created}/${SAMPLES.length} created.`);
    process.exit(created > 0 ? 0 : 1);
}

main().catch((error) => {
    console.error('[seed-board] failed:', error);
    process.exit(1);
});
