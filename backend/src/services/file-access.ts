/**
 * Проверка права пользователя на чтение бинарника из хранилища.
 *
 * `/api/v3/files/:fileId` — единственный download-URL приложения. За ним стоят
 * сразу четыре потребителя (материалы УМКД, файлы группы, вложения социальных
 * сущностей, обложки объявлений доски), поэтому проверка живёт здесь, в одном
 * месте, а не размазана по трём хендлерам.
 *
 * Модель доступа (достаточно ЛЮБОГО из правил):
 *   1. `metadata.uploadedBy === userId` — тот, кто загрузил файл, всегда может
 *      его скачать. Это обязательный fallback: файл может быть зарегистрирован
 *      раньше, чем появится связывающая строка (`app_group_files` /
 *      `app_social_attachment`), — например между шагом «upload» и шагом
 *      «attach» во фронтовом пайплайне social-attachment-upload.ts.
 *   2. Материал УМКД — общий учебный контент, доступен любому
 *      аутентифицированному пользователю (см. комментарий у
 *      `isRuntimeUploadCourseId` ниже).
 *   3. Файл числится в `app_group_files` группы, которую пользователь вправе
 *      читать (`assertCanReadGroup` из services/group-space.ts).
 *   4. Файл числится в `app_social_attachment` у сущности, чей scope доступен
 *      пользователю (`assertScopeAccess` из services/social.ts:
 *      global/announcement — всем, dm — двум участникам комнаты, group — через
 *      ту же `assertCanReadGroup`).
 *
 * Fail-closed: недоступный Postgres приводит к исключению (маршрут отвечает
 * 500), а не к «разрешено по умолчанию».
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { getFileOwnership } from '../db/gridfs.js';
import { assertCanReadGroup } from './group-space.js';
import { assertScopeAccess } from './social.js';
import type { SocialScopeType } from '../types/social.js';

/**
 * Служебный `courseId`, которым `POST /api/v3/files/upload` (и сидер
 * scripts/seed-board-images.ts) помечает runtime-загрузки. Всё, что НЕ помечено
 * этим значением, попало в `app_umkd_files` через парсер УМКД
 * (`parsers/umkd.ts`) или через миграцию legacy-коллекции — то есть является
 * общим учебным материалом курса.
 */
export const RUNTIME_UPLOAD_COURSE_ID = 'social';

/**
 * true — файл загружен через runtime-endpoint (вложение/обложка), доступ к нему
 * решают правила 1/3/4. false — материал УМКД (правило 2).
 *
 * Почему материалы УМКД открыты всем аутентифицированным:
 *   - дедупликация в `uploadToStorage` ключуется по (contentHash, courseId),
 *     поэтому второй и последующие студенты того же курса получают fileId
 *     ПЕРВОГО загрузившего. Правило 1 покрыло бы только первого — остальные
 *     потеряли бы доступ к самой используемой функции приложения;
 *   - в базе нет связи «студент ↔ курс УМКД»: список УМКД тянется из КГТУ на
 *     лету и кешируется под `umkd:<userId>`, а строка файла не хранит ни
 *     группы, ни списка слушателей — авторизовать «зачислен на курс» просто не
 *     на чем;
 *   - контент по своей природе общий (лекции, силлабусы, вопросы к экзамену),
 *     персональных данных в нём нет.
 * Строки без `courseId` (legacy-миграция с пустыми метаданными) приехали из
 * коллекции `umkd_files` и трактуются так же — как учебный материал.
 */
export function isRuntimeUploadCourseId(courseId: string | null | undefined): boolean {
    return (courseId || '').trim().toLowerCase() === RUNTIME_UPLOAD_COURSE_ID;
}

export type FileAccessReason =
    | 'no_user'
    | 'file_not_found'
    | 'uploader'
    | 'course_material'
    | 'group_file'
    | 'social_attachment'
    | 'denied';

export interface FileAccessDecision {
    allowed: boolean;
    reason: FileAccessReason;
}

async function requireFileAccessPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>,
): Promise<T> {
    const wrapped = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (wrapped === null) {
        throw new Error(`[FileAccess] Supabase/Postgres is unavailable during ${operation}`);
    }
    return wrapped.value;
}

/** Группы, в реестре файлов которых числится этот fileId. */
async function loadGroupKeysForFile(fileId: string): Promise<string[]> {
    return requireFileAccessPostgres('loadGroupKeysForFile', async (client) => {
        const result = await client.query<{ group_key: string }>(
            `
                select distinct group_key
                from app_group_files
                where file_id = $1
            `,
            [fileId],
        );
        return result.rows.map((row) => row.group_key).filter(Boolean);
    });
}

/** Scope'ы социальных сущностей, к которым прикреплён этот fileId. */
async function loadAttachmentScopesForFile(
    fileId: string,
): Promise<Array<{ scopeType: SocialScopeType; scopeId: string }>> {
    return requireFileAccessPostgres('loadAttachmentScopesForFile', async (client) => {
        const result = await client.query<{ scope_type: string; scope_id: string }>(
            `
                select distinct e.scope_type, e.scope_id
                from app_social_attachment a
                join app_social_entity e on e.id = a.entity_id
                where a.file_id = $1
                  and e.deleted_at is null
            `,
            [fileId],
        );
        return result.rows
            .filter((row) => Boolean(row.scope_type) && Boolean(row.scope_id))
            .map((row) => ({
                scopeType: row.scope_type as SocialScopeType,
                scopeId: row.scope_id,
            }));
    });
}

/**
 * Главная точка входа. Возвращает решение + причину (причина попадает в
 * action-log, чтобы отказы можно было разбирать без гадания).
 *
 * `file_not_found` отделён от `denied` намеренно: маршрут отвечает на него 404,
 * сохраняя прежнее поведение для несуществующих id.
 */
export async function canAccessFile(userId: string, fileId: string): Promise<FileAccessDecision> {
    const trimmedUserId = (userId || '').trim();
    if (!trimmedUserId || trimmedUserId === 'anonymous') {
        return { allowed: false, reason: 'no_user' };
    }

    const trimmedFileId = (fileId || '').trim();
    if (!trimmedFileId) {
        return { allowed: false, reason: 'file_not_found' };
    }

    const ownership = await getFileOwnership(trimmedFileId);
    if (!ownership) {
        return { allowed: false, reason: 'file_not_found' };
    }

    // Правило 1 — загрузивший.
    if (ownership.uploadedBy && ownership.uploadedBy === trimmedUserId) {
        return { allowed: true, reason: 'uploader' };
    }

    // Правило 2 — общий учебный материал УМКД.
    if (!isRuntimeUploadCourseId(ownership.courseId)) {
        return { allowed: true, reason: 'course_material' };
    }

    // Правило 3 — реестр файлов группы.
    const groupKeys = await loadGroupKeysForFile(trimmedFileId);
    for (const groupKey of groupKeys) {
        try {
            await assertCanReadGroup(trimmedUserId, groupKey);
            return { allowed: true, reason: 'group_file' };
        } catch {
            // Нет доступа к этой конкретной группе — пробуем следующую связь.
        }
    }

    // Правило 4 — вложение социальной сущности.
    const scopes = await loadAttachmentScopesForFile(trimmedFileId);
    for (const scope of scopes) {
        try {
            await assertScopeAccess(scope.scopeType, scope.scopeId, trimmedUserId);
            return { allowed: true, reason: 'social_attachment' };
        } catch {
            // Этот scope закрыт — пробуем следующий.
        }
    }

    return { allowed: false, reason: 'denied' };
}
