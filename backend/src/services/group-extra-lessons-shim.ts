/**
 * Phase 1c — backward-compatibility shim for group extra lessons.
 *
 * Mirrors every legacy write into `app_group_extra_lessons` (via
 * services/group-space.ts) into the universal `app_social_entity` store under
 * `kind='extra_lesson'`. Legacy is still source-of-truth for reads; the
 * universal store is being populated in parallel so Phase 1d's read-flip has no
 * gaps.
 *
 * Failure mode: **non-fatal**. If any new-store call throws, we log and
 * swallow — the caller's legacy write already succeeded. This is deliberate so
 * a bug in the universal layer cannot break production lesson writes.
 *
 * Legacy → payload mapping (kind='extra_lesson'):
 *   - legacy `title`               → payload.subject
 *   - legacy `teacher`             → payload.teacher (optional)
 *   - legacy `room`                → payload.room (optional)
 *   - legacy `date` + `start_time` → payload.startsAt (combined ISO string)
 *   - legacy `date` + `end_time`   → payload.endsAt   (combined ISO string)
 *   - legacy `note`                → payload.note (optional)
 *
 * The combined `startsAt`/`endsAt` strings are assembled by the caller (which
 * has the typed `Date` + `HH:MM` pieces), passed in already-joined; this shim
 * does not re-parse them. See docs/SOCIAL_STORE.md.
 */

import { withSupabasePostgres } from '../db/postgres.js';
import {
    buildScopeId,
    createEntity,
    restoreEntity,
    softDeleteEntity,
    updateEntity,
} from './social.js';

async function fetchSocialEntityIdForLegacyLesson(lessonId: string): Promise<string | null> {
    const result = await withSupabasePostgres(async (client) => {
        const rows = await client.query<{ social_entity_id: string | null }>(
            `select social_entity_id from app_group_extra_lessons where id = $1 limit 1`,
            [lessonId]
        );
        return rows.rows[0]?.social_entity_id ?? null;
    });
    return result ?? null;
}

async function persistSocialEntityIdOnLegacyLesson(lessonId: string, socialEntityId: string): Promise<void> {
    await withSupabasePostgres(async (client) => {
        await client.query(
            `update app_group_extra_lessons set social_entity_id = $2 where id = $1`,
            [lessonId, socialEntityId]
        );
        return null;
    });
}

function logShimFailure(operation: string, legacyId: string, error: unknown): void {
    console.error(`[social shim] dual-write ${operation} failed for group_extra_lessons`, {
        legacyId,
        error: error instanceof Error ? error.message : String(error),
    });
}

interface ExtraLessonShimPayload {
    subject: string;
    startsAt: string;
    teacher?: string;
    room?: string;
    endsAt?: string;
    note?: string;
}

function buildPayload(args: {
    subject: string;
    startsAt: string;
    teacher?: string | null;
    room?: string | null;
    endsAt?: string | null;
    note?: string | null;
}): ExtraLessonShimPayload {
    const payload: ExtraLessonShimPayload = {
        subject: args.subject,
        startsAt: args.startsAt,
    };
    if (args.teacher) payload.teacher = args.teacher;
    if (args.room) payload.room = args.room;
    if (args.endsAt) payload.endsAt = args.endsAt;
    if (args.note) payload.note = args.note;
    return payload;
}

export async function shimMirrorCreateGroupExtraLesson(args: {
    legacyId: string;
    groupKey: string;
    authorUserId: string;
    subject: string;
    startsAt: string;
    teacher?: string | null;
    room?: string | null;
    endsAt?: string | null;
    note?: string | null;
}): Promise<void> {
    try {
        const entity = await createEntity({
            kind: 'extra_lesson',
            scopeType: 'group',
            scopeId: buildScopeId('group', args.groupKey),
            authorUserId: args.authorUserId,
            payload: buildPayload(args),
        });
        await persistSocialEntityIdOnLegacyLesson(args.legacyId, entity.id);
    } catch (error) {
        // Non-fatal: legacy write already succeeded; mirror is best-effort.
        logShimFailure('create', args.legacyId, error);
    }
}

export async function shimMirrorUpdateGroupExtraLesson(args: {
    legacyId: string;
    groupKey: string;
    authorUserId: string;
    subject: string;
    startsAt: string;
    teacher?: string | null;
    room?: string | null;
    endsAt?: string | null;
    note?: string | null;
}): Promise<void> {
    try {
        const payload = buildPayload(args);
        const existingSocialId = await fetchSocialEntityIdForLegacyLesson(args.legacyId);
        if (existingSocialId) {
            await updateEntity(existingSocialId, args.authorUserId, payload);
            return;
        }
        // Rare case: legacy row predates the shim, so there's no mirror yet.
        // Create one now so subsequent writes can update it normally.
        const entity = await createEntity({
            kind: 'extra_lesson',
            scopeType: 'group',
            scopeId: buildScopeId('group', args.groupKey),
            authorUserId: args.authorUserId,
            payload,
        });
        await persistSocialEntityIdOnLegacyLesson(args.legacyId, entity.id);
    } catch (error) {
        logShimFailure('update', args.legacyId, error);
    }
}

export async function shimMirrorSoftDeleteGroupExtraLesson(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyLesson(args.legacyId);
        if (!socialId) return; // nothing to mirror
        await softDeleteEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('soft-delete', args.legacyId, error);
    }
}

export async function shimMirrorRestoreGroupExtraLesson(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyLesson(args.legacyId);
        if (!socialId) return;
        await restoreEntity(socialId, args.actorUserId);
    } catch (error) {
        logShimFailure('restore', args.legacyId, error);
    }
}

// Permanent delete: we intentionally do NOT hard-delete the mirror entity.
// Leaving it soft-deleted preserves the audit trail in app_social_revision
// (revision rows reference the entity). The legacy extra-lesson tables don't
// currently expose a permanent-delete operation at the route layer, but the
// helper is kept symmetric with group-posts-shim for when that lands.
export async function shimMirrorPermanentDeleteGroupExtraLesson(args: {
    legacyId: string;
    actorUserId: string;
}): Promise<void> {
    try {
        const socialId = await fetchSocialEntityIdForLegacyLesson(args.legacyId);
        if (!socialId) return;
        await softDeleteEntity(socialId, args.actorUserId, 'permanent-delete');
    } catch (error) {
        logShimFailure('permanent-delete', args.legacyId, error);
    }
}
