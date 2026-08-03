/**
 * Unified write-path wrappers for the group-extra-lessons POC.
 *
 * Each function decides — based on the `useSocialBeta` flag the caller passes
 * in — whether to write through the **legacy** group API (`/api/v3/group/...`,
 * Phase 1c shim mirrors the change into `app_social_entity` server-side) or
 * **directly** through the universal social store (`/api/v3/social/*`). This
 * validates that the universal store can serve the lessons write path
 * end-to-end while the legacy table is still source of truth for everything
 * else.
 *
 * Boundaries:
 *  - Wrappers are pure: the flag is an argument, not a global lookup. Lets
 *    callers (and tests) flip it without re-rendering React state.
 *  - APIs are injected via the second-to-last `deps` argument so tests can pass
 *    fakes instead of monkey-patching ESM bindings (matches the convention in
 *    `social-feed-actions.ts` / `social-task-actions.ts`).
 *  - Returned envelope is `ApiResponse<unknown>` — handlers downstream only
 *    branch on `success` + `error`; reusing the legacy shape avoids changing
 *    `LessonsTab` error / refresh logic.
 *
 * **ID mapping rule** when `useSocialBeta` is on:
 *  - `lessonId` is the **`app_social_entity.id`** (uuid). The read path
 *    (`useGroupExtraLessonsSocial` → `socialEntityToExtraLessonView`) already
 *    surfaces `entity.id` as `lesson.id`, so the value coming back into
 *    update / delete / restore handlers is the social id, not the legacy
 *    `app_group_extra_lessons.id`.
 *  - Conversely, when `useSocialBeta` is off, `lessonId` is the legacy id —
 *    matches the existing `useGroupLessons` contract.
 *
 * **Schema bridge** between the universal payload (`{ subject, startsAt,
 * endsAt, teacher, room, note }`) and the legacy table (`{ title, date,
 * startTime, endTime, teacher, room, note }`):
 *  - On the beta path we forward the universal shape verbatim.
 *  - On the legacy path we project ISO timestamps back into `date` + `HH:MM`
 *    pieces via `splitIsoToDateAndTime`. The legacy endpoint requires all
 *    three (`date`, `startTime`, `endTime`) on every write, so callers MUST
 *    supply `startsAt` (and `endsAt` for updates that intend to keep the end
 *    time) in legacy mode — otherwise the split yields empty strings and the
 *    backend will reject the payload.
 *  - The legacy `title` column is the universal `subject` — projected
 *    one-for-one. The Phase 1c shim does the inverse mapping server-side so
 *    that legacy reads stay consistent.
 *
 * **No completion semantics** here — extra lessons are not tasks; the legacy
 * surface has no `toggleCompletion` endpoint, so the wrapper count is 6 (not
 * 7 like tasks).
 *
 * **Reactions**: lessons did not historically have a per-group reaction
 * endpoint (`toggleGroupExtraLessonReaction` does not exist in
 * `lib/api/group.ts`). When the flag is off, `toggleExtraLessonReactionUnified`
 * therefore returns a non-fatal `ApiResponse` failure rather than calling a
 * missing legacy function — matching the convention in
 * `toggleTaskReactionUnified`.
 */
import {
    createGroupExtraLesson as createGroupExtraLessonLegacy,
    deleteGroupExtraLesson as deleteGroupExtraLessonLegacy,
    restoreDeletedGroupExtraLesson as restoreDeletedGroupExtraLessonLegacy,
    updateGroupExtraLesson as updateGroupExtraLessonLegacy,
} from '@/lib/api/group';
import type { ApiResponse } from '@/lib/api/core';
import {
    createSocialEntity as createSocialEntityDefault,
    deleteSocialEntity as deleteSocialEntityDefault,
    restoreSocialEntity as restoreSocialEntityDefault,
    toggleSocialReaction as toggleSocialReactionDefault,
    updateSocialEntity as updateSocialEntityDefault,
} from '@/lib/api/social';

// === Shared types ===========================================================

/**
 * Subset of an extra lesson that the universal payload represents. Mirrors the
 * `extra_lesson` payload schema exactly (`{ subject, teacher?, room?,
 * startsAt, endsAt?, note? }`). The legacy table also requires explicit
 * `date` / `startTime` / `endTime` fields — those are derived from
 * `startsAt` / `endsAt` inside the wrappers below, not exposed in the input.
 */
export interface ExtraLessonInput {
    subject: string;
    teacher?: string;
    room?: string;
    /** ISO 8601 timestamp (e.g. `2026-03-15T09:00:00Z`). */
    startsAt: string;
    /** ISO 8601 timestamp. Optional — open-ended lessons omit it. */
    endsAt?: string;
    note?: string;
}

export interface SocialExtraLessonActionDeps {
    // social (universal store)
    createSocialEntity?: typeof createSocialEntityDefault;
    updateSocialEntity?: typeof updateSocialEntityDefault;
    deleteSocialEntity?: typeof deleteSocialEntityDefault;
    restoreSocialEntity?: typeof restoreSocialEntityDefault;
    toggleSocialReaction?: typeof toggleSocialReactionDefault;
    // legacy (group extra lessons)
    createGroupExtraLesson?: typeof createGroupExtraLessonLegacy;
    updateGroupExtraLesson?: typeof updateGroupExtraLessonLegacy;
    deleteGroupExtraLesson?: typeof deleteGroupExtraLessonLegacy;
    restoreDeletedGroupExtraLesson?: typeof restoreDeletedGroupExtraLessonLegacy;
}

// === Helpers ================================================================

/**
 * Build the social-entity payload from an `ExtraLessonInput`. Drops
 * `undefined` fields so the backend AJV validator does not reject the body
 * for explicit-undefined keys (it accepts missing keys but not
 * `key: undefined` once stringified).
 */
function buildLessonPayload(input: ExtraLessonInput): Record<string, unknown> {
    const payload: Record<string, unknown> = {
        subject: input.subject,
        startsAt: input.startsAt,
    };
    if (typeof input.teacher === 'string' && input.teacher) payload.teacher = input.teacher;
    if (typeof input.room === 'string' && input.room) payload.room = input.room;
    if (typeof input.endsAt === 'string' && input.endsAt) payload.endsAt = input.endsAt;
    if (typeof input.note === 'string' && input.note) payload.note = input.note;
    return payload;
}

/**
 * Split an ISO 8601 timestamp into a `YYYY-MM-DD` date and a `HH:MM` time —
 * the shape the legacy `createGroupExtraLesson` endpoint expects. Defensive
 * against empty strings (returns `{ date: '', time: '' }` so the caller sees
 * a deterministic shape and the backend rejects it cleanly via its required-
 * field validator).
 *
 * Exported for unit testing — the projection is the riskiest part of the
 * legacy bridge and locking the contract here prevents drift if the social
 * payload format changes.
 */
export function splitIsoToDateAndTime(iso: string | undefined): { date: string; time: string } {
    if (typeof iso !== 'string' || !iso) return { date: '', time: '' };
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return { date: '', time: '' };
    // Use UTC pieces — the social payload is ISO-Z, and the legacy backend
    // does not localize the inputs further. Working in UTC keeps the round
    // trip deterministic across timezones.
    const yyyy = String(parsed.getUTCFullYear()).padStart(4, '0');
    const mm = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(parsed.getUTCDate()).padStart(2, '0');
    const hh = String(parsed.getUTCHours()).padStart(2, '0');
    const min = String(parsed.getUTCMinutes()).padStart(2, '0');
    return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
}

// === Create =================================================================

/**
 * `createExtraLessonUnified` — beta path POSTs an `extra_lesson`-kind entity
 * into the social store under `group:<groupKey>`; legacy path calls the
 * existing group-extra-lessons create with the date+time split applied to the
 * universal `startsAt`/`endsAt` pair.
 *
 * Legacy quirks:
 *  - Legacy `title` ← universal `subject` (one-for-one rename).
 *  - Legacy `date` / `startTime` ← `startsAt`; legacy `endTime` ← `endsAt`.
 *  - Empty `endsAt` projects to an empty `endTime`; the backend treats this as
 *    a validation error today, so callers should always supply an end in
 *    legacy mode.
 */
export async function createExtraLessonUnified(
    groupKey: string,
    input: ExtraLessonInput,
    useSocialBeta: boolean,
    deps: SocialExtraLessonActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const createSocial = deps.createSocialEntity ?? createSocialEntityDefault;
        return createSocial({
            kind: 'extra_lesson',
            scopeType: 'group',
            scopeId: `group:${groupKey}`,
            payload: buildLessonPayload(input),
        });
    }
    const createLegacy = deps.createGroupExtraLesson ?? createGroupExtraLessonLegacy;
    const start = splitIsoToDateAndTime(input.startsAt);
    const end = splitIsoToDateAndTime(input.endsAt);
    return createLegacy({
        groupKey,
        title: input.subject,
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        room: input.room,
        teacher: input.teacher,
        note: input.note,
    });
}

// === Update =================================================================

/**
 * `updateExtraLessonUnified` — beta path PATCHes only the provided payload
 * fields; legacy path POSTs the full lesson record (the legacy endpoint
 * requires `title`, `date`, `startTime`, `endTime` on every save and
 * re-applies the full set).
 *
 * In legacy mode `subject` / `startsAt` / `endsAt` default to empty strings
 * when missing — callers MUST include them in the patch when the flag is off,
 * or risk wiping the existing values.
 */
export async function updateExtraLessonUnified(
    lessonId: string,
    patch: Partial<ExtraLessonInput>,
    useSocialBeta: boolean,
    deps: SocialExtraLessonActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const updateSocial = deps.updateSocialEntity ?? updateSocialEntityDefault;
        const payloadDiff: Record<string, unknown> = {};
        if (typeof patch.subject === 'string') payloadDiff.subject = patch.subject;
        if (typeof patch.startsAt === 'string') payloadDiff.startsAt = patch.startsAt;
        if (typeof patch.endsAt === 'string') payloadDiff.endsAt = patch.endsAt;
        if (typeof patch.teacher === 'string') payloadDiff.teacher = patch.teacher;
        if (typeof patch.room === 'string') payloadDiff.room = patch.room;
        if (typeof patch.note === 'string') payloadDiff.note = patch.note;
        const socialPatch: Record<string, unknown> = {};
        if (Object.keys(payloadDiff).length > 0) socialPatch.payload = payloadDiff;
        return updateSocial(lessonId, socialPatch);
    }
    const updateLegacy = deps.updateGroupExtraLesson ?? updateGroupExtraLessonLegacy;
    const start = splitIsoToDateAndTime(patch.startsAt);
    const end = splitIsoToDateAndTime(patch.endsAt);
    return updateLegacy(lessonId, {
        title: patch.subject ?? '',
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        room: patch.room,
        teacher: patch.teacher,
        note: patch.note,
    });
}

// === Delete (soft) ==========================================================

/**
 * `deleteExtraLessonUnified` — soft delete in both modes. `reason` only flows
 * through on the beta path (the legacy endpoint has no reason parameter).
 */
export async function deleteExtraLessonUnified(
    lessonId: string,
    reason: string | undefined,
    useSocialBeta: boolean,
    deps: SocialExtraLessonActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(lessonId, reason);
    }
    const deleteLegacy = deps.deleteGroupExtraLesson ?? deleteGroupExtraLessonLegacy;
    return deleteLegacy(lessonId);
}

// === Restore ================================================================

export async function restoreExtraLessonUnified(
    lessonId: string,
    useSocialBeta: boolean,
    deps: SocialExtraLessonActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const restoreSocial = deps.restoreSocialEntity ?? restoreSocialEntityDefault;
        return restoreSocial(lessonId);
    }
    const restoreLegacy = deps.restoreDeletedGroupExtraLesson ?? restoreDeletedGroupExtraLessonLegacy;
    return restoreLegacy(lessonId);
}

// === Permanent delete (degrades to soft on both modes) =====================

/**
 * `permanentlyDeleteExtraLessonUnified` — the social store has no hard-delete
 * primitive (tombstones live forever for audit), so beta routes through
 * soft-delete with a discoverable reason. Legacy extra-lessons have **no**
 * permanent delete endpoint either (there is no
 * `permanentlyDeleteGroupExtraLesson` in `lib/api/group.ts`), so the legacy
 * path falls through to the soft-delete call — matching the way LessonsTab
 * already empties the trash today.
 */
export async function permanentlyDeleteExtraLessonUnified(
    lessonId: string,
    useSocialBeta: boolean,
    deps: SocialExtraLessonActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(lessonId, 'permanent');
    }
    const deleteLegacy = deps.deleteGroupExtraLesson ?? deleteGroupExtraLessonLegacy;
    return deleteLegacy(lessonId);
}

// === Reaction toggle ========================================================

/**
 * `toggleExtraLessonReactionUnified` — beta path uses the universal toggle
 * endpoint (server returns fresh aggregates). Legacy has no per-group lesson
 * reaction endpoint today, so we degrade to a non-fatal failure with a
 * discoverable error code rather than silently no-opping (mirrors
 * `toggleTaskReactionUnified`).
 *
 * `groupKey` is accepted for symmetry with `togglePostReactionUnified` and to
 * keep call sites uniform, even though the beta path infers it from the
 * entity record.
 */
export async function toggleExtraLessonReactionUnified(
    lessonId: string,
    emoji: string,
    useSocialBeta: boolean,
    _groupKey?: string,
    deps: SocialExtraLessonActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const toggleSocial = deps.toggleSocialReaction ?? toggleSocialReactionDefault;
        return toggleSocial(lessonId, emoji);
    }
    return {
        success: false,
        error: 'Lesson reactions are only available on the social-beta path; legacy extra-lessons do not expose a reaction endpoint.',
        errorCode: 'LESSON_REACTION_LEGACY_UNSUPPORTED',
    };
}
