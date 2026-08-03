/**
 * Private per-user teacher notes (the "Private Teacher Notes" feature from
 * IDEAS.md). Each user can attach a single free-form plain-text note to a
 * teacher key. Notes are strictly private — there is no public/shared read
 * path, no admin override list, and no aggregation. The schema lives in
 * `user_teacher_notes` (see backend/src/db/postgres.ts).
 *
 * `teacherKey` is the normalized teacher identifier produced by
 * `normalizeTeacherKey`. The route accepts whatever the client sends and the
 * service normalizes server-side so the storage layout stays stable even if
 * clients change.
 */

import { withSupabasePostgres } from '../db/postgres.js';
import { normalizeTeacherName } from './teacher-ratings.js';

export const TEACHER_NOTE_MAX_LENGTH = 2000;
export const TEACHER_KEY_MAX_LENGTH = 200;

export interface TeacherNote {
    note: string;
    updatedAt: string;
}

export interface TeacherNoteEntry extends TeacherNote {
    teacherKey: string;
}

/**
 * Produces the canonical storage key for a teacher identifier. Reuses the same
 * normalization the teacher directory uses (lowercase, whitespace-collapsed,
 * tight initial dots, smart-quote→ASCII) so the key is stable across
 * variants like "Иванов И. И." / "Иванов И.И." / "иванов и.и.".
 */
export function normalizeTeacherKey(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return normalizeTeacherName(raw).slice(0, TEACHER_KEY_MAX_LENGTH);
}

/**
 * Trims and length-validates a note body. Throws on overlong input so the
 * route can map it to a 400 / `note too long`. Returns the cleaned string.
 */
export function validateTeacherNote(raw: unknown): string {
    if (typeof raw !== 'string') {
        throw new Error('note must be a string');
    }
    const trimmed = raw.trim();
    if (trimmed.length > TEACHER_NOTE_MAX_LENGTH) {
        throw new Error('note too long');
    }
    return trimmed;
}

export async function getTeacherNote(
    userId: string,
    teacherKey: string,
): Promise<TeacherNote | null> {
    const key = normalizeTeacherKey(teacherKey);
    if (!userId || !key) return null;

    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{ note: string; updated_at: string }>(
            `
                select note, updated_at::text as updated_at
                from user_teacher_notes
                where user_id = $1 and teacher_key = $2
                limit 1
            `,
            [userId, key],
        );
        if (!rows.rows[0]) return null;
        return {
            note: rows.rows[0].note,
            updatedAt: rows.rows[0].updated_at,
        };
    });

    return result ?? null;
}

export async function setTeacherNote(
    userId: string,
    teacherKey: string,
    note: string,
): Promise<TeacherNote> {
    if (!userId) {
        throw new Error('userId is required');
    }
    const key = normalizeTeacherKey(teacherKey);
    if (!key) {
        throw new Error('teacherKey is required');
    }
    const cleaned = validateTeacherNote(note);

    // Empty note after trim → delete to keep the row count tidy and to match
    // user intent ("I cleared the note" = "remove it"). Matches what the
    // DELETE endpoint does so the two paths converge.
    if (cleaned.length === 0) {
        await deleteTeacherNote(userId, key);
        return { note: '', updatedAt: new Date().toISOString() };
    }

    const result = await withSupabasePostgres(async (client) => {
        const now = new Date().toISOString();
        const rows = await client.query<{ updated_at: string }>(
            `
                insert into user_teacher_notes (user_id, teacher_key, note, updated_at)
                values ($1, $2, $3, $4)
                on conflict (user_id, teacher_key) do update set
                    note = excluded.note,
                    updated_at = excluded.updated_at
                returning updated_at::text as updated_at
            `,
            [userId, key, cleaned, now],
        );
        return {
            note: cleaned,
            updatedAt: rows.rows[0]?.updated_at || now,
        };
    });

    if (!result) {
        throw new Error('teacher notes storage unavailable');
    }
    return result;
}

export async function deleteTeacherNote(
    userId: string,
    teacherKey: string,
): Promise<void> {
    const key = normalizeTeacherKey(teacherKey);
    if (!userId || !key) return;

    await withSupabasePostgres(async (client) => {
        await client.query(
            `delete from user_teacher_notes where user_id = $1 and teacher_key = $2`,
            [userId, key],
        );
    });
}

export async function listMyTeacherNotes(userId: string): Promise<TeacherNoteEntry[]> {
    if (!userId) return [];
    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{
            teacher_key: string;
            note: string;
            updated_at: string;
        }>(
            `
                select teacher_key, note, updated_at::text as updated_at
                from user_teacher_notes
                where user_id = $1
                order by updated_at desc
            `,
            [userId],
        );
        return rows.rows.map((row) => ({
            teacherKey: row.teacher_key,
            note: row.note,
            updatedAt: row.updated_at,
        }));
    });

    return result ?? [];
}
