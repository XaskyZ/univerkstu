/**
 * Unified write-path wrappers for the group-tasks POC.
 *
 * Each function decides — based on the `useSocialBeta` flag the caller passes
 * in — whether to write through the **legacy** group API (`/api/v3/group/...`,
 * Phase 1c shim mirrors the change into `app_social_entity` server-side) or
 * **directly** through the universal social store (`/api/v3/social/*`). This
 * validates that the universal store can serve the task write path end-to-end
 * while the legacy table is still source of truth for everything else.
 *
 * Boundaries:
 *  - Wrappers are pure: the flag is an argument, not a global lookup. Lets
 *    callers (and tests) flip it without re-rendering React state.
 *  - APIs are injected via the second-to-last `deps` argument so tests can pass
 *    fakes instead of monkey-patching ESM bindings (matches the convention in
 *    `social-feed-actions.ts`).
 *  - Returned envelope is `ApiResponse<unknown>` — handlers downstream only
 *    branch on `success` + `error`; reusing the legacy shape avoids changing
 *    `TasksTab` error / refresh logic.
 *
 * **ID mapping rule** when `useSocialBeta` is on:
 *  - `taskId` is the **`app_social_entity.id`** (uuid). The read path
 *    (`useGroupTasksSocial` → `socialEntityToTaskView`) already surfaces
 *    `entity.id` as `task.id`, so the value coming back into update / delete
 *    / completion-toggle handlers is the social id, not the legacy
 *    `app_group_tasks.id`.
 *  - Conversely, when `useSocialBeta` is off, `taskId` is the legacy id —
 *    matches the existing `useGroupTasks` contract.
 *
 * **Completion semantics in beta mode**: the universal store does not expose a
 * dedicated `/toggle` endpoint for tasks. Instead, per-user completion lives
 * inside `payload.completedByUserIds: string[]`. `toggleTaskCompletionUnified`
 * performs a PATCH whose payload diff replaces the array with the
 * include/exclude of the current viewer's id. Legacy mode preserves the
 * existing `/api/v3/group/tasks/toggle` POST, which carries a single boolean
 * for the row.
 *
 * **Reactions**: tasks did not historically have a per-group reaction endpoint
 * (`toggleGroupTaskReaction` does not exist in `lib/api/group.ts`). When the
 * flag is off, `toggleTaskReactionUnified` therefore returns a non-fatal
 * `ApiResponse` failure rather than calling a missing legacy function. The
 * read path also does not surface reactions on legacy tasks today; this
 * wrapper exists so the universal-store cutover can opt in to task reactions
 * without re-plumbing the call site.
 */
import {
    createGroupTask as createGroupTaskLegacy,
    deleteGroupTask as deleteGroupTaskLegacy,
    restoreDeletedGroupTask as restoreDeletedGroupTaskLegacy,
    toggleGroupTaskCompletion as toggleGroupTaskCompletionLegacy,
    updateGroupTask as updateGroupTaskLegacy,
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
 * Subset of a group task that the universal payload represents. Mirrors the
 * `task` payload schema (`{ title, body, dueAt? }`) — legacy-only fields
 * (subject, description, priority) are NOT carried through the social
 * write path. Callers that still need to set them must keep the legacy
 * mutation path until those fields are promoted into the universal payload.
 */
export interface TaskInput {
    title: string;
    body: string;
    dueAt?: string;
}

export interface SocialTaskActionDeps {
    // social (universal store)
    createSocialEntity?: typeof createSocialEntityDefault;
    updateSocialEntity?: typeof updateSocialEntityDefault;
    deleteSocialEntity?: typeof deleteSocialEntityDefault;
    restoreSocialEntity?: typeof restoreSocialEntityDefault;
    toggleSocialReaction?: typeof toggleSocialReactionDefault;
    // legacy (group tasks)
    createGroupTask?: typeof createGroupTaskLegacy;
    updateGroupTask?: typeof updateGroupTaskLegacy;
    deleteGroupTask?: typeof deleteGroupTaskLegacy;
    restoreDeletedGroupTask?: typeof restoreDeletedGroupTaskLegacy;
    toggleGroupTaskCompletion?: typeof toggleGroupTaskCompletionLegacy;
}

// === Helpers ================================================================

/**
 * Build the social-entity payload from a `TaskInput`. Drops `undefined` fields
 * so the backend AJV validator does not reject the body for explicit-undefined
 * keys (it accepts missing keys but not `key: undefined` once stringified).
 */
function buildTaskPayload(input: TaskInput): Record<string, unknown> {
    const payload: Record<string, unknown> = { title: input.title, body: input.body };
    if (typeof input.dueAt === 'string' && input.dueAt) payload.dueAt = input.dueAt;
    return payload;
}

// === Create =================================================================

/**
 * `createTaskUnified` — beta path POSTs a `task`-kind entity into the social
 * store under `group:<groupKey>`; legacy path calls the existing group-task
 * create. The legacy variant additionally accepts subject / description /
 * priority via the second arg — beta-mode callers must omit those fields.
 */
export async function createTaskUnified(
    groupKey: string,
    input: TaskInput,
    useSocialBeta: boolean,
    deps: SocialTaskActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const createSocial = deps.createSocialEntity ?? createSocialEntityDefault;
        return createSocial({
            kind: 'task',
            scopeType: 'group',
            scopeId: `group:${groupKey}`,
            payload: buildTaskPayload(input),
        });
    }
    const createLegacy = deps.createGroupTask ?? createGroupTaskLegacy;
    return createLegacy(input.title, {
        groupKey,
        description: input.body,
        deadline: input.dueAt,
    });
}

// === Update =================================================================

/**
 * `updateTaskUnified` — beta path PATCHes only the provided payload fields;
 * legacy path POSTs the full task body (the legacy endpoint requires `title`
 * and re-applies the full set on every save).
 *
 * In legacy mode `title` defaults to '' when missing — callers MUST include
 * `title` in the patch when the flag is off, or risk wiping the existing
 * value.
 */
export async function updateTaskUnified(
    taskId: string,
    patch: Partial<TaskInput>,
    useSocialBeta: boolean,
    deps: SocialTaskActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const updateSocial = deps.updateSocialEntity ?? updateSocialEntityDefault;
        const payloadDiff: Record<string, unknown> = {};
        if (typeof patch.title === 'string') payloadDiff.title = patch.title;
        if (typeof patch.body === 'string') payloadDiff.body = patch.body;
        if (typeof patch.dueAt === 'string') payloadDiff.dueAt = patch.dueAt;
        const socialPatch: Record<string, unknown> = {};
        if (Object.keys(payloadDiff).length > 0) socialPatch.payload = payloadDiff;
        return updateSocial(taskId, socialPatch);
    }
    const updateLegacy = deps.updateGroupTask ?? updateGroupTaskLegacy;
    return updateLegacy(taskId, {
        title: patch.title ?? '',
        description: patch.body,
        deadline: patch.dueAt,
    });
}

// === Delete (soft) ==========================================================

/**
 * `deleteTaskUnified` — soft delete in both modes. `reason` only flows through
 * on the beta path (the legacy endpoint has no reason parameter).
 */
export async function deleteTaskUnified(
    taskId: string,
    reason: string | undefined,
    useSocialBeta: boolean,
    deps: SocialTaskActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(taskId, reason);
    }
    const deleteLegacy = deps.deleteGroupTask ?? deleteGroupTaskLegacy;
    return deleteLegacy(taskId);
}

// === Restore ================================================================

export async function restoreTaskUnified(
    taskId: string,
    useSocialBeta: boolean,
    deps: SocialTaskActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const restoreSocial = deps.restoreSocialEntity ?? restoreSocialEntityDefault;
        return restoreSocial(taskId);
    }
    const restoreLegacy = deps.restoreDeletedGroupTask ?? restoreDeletedGroupTaskLegacy;
    return restoreLegacy(taskId);
}

// === Permanent delete (degrades to soft on beta) ===========================

/**
 * `permanentlyDeleteTaskUnified` — the social store has no hard-delete
 * primitive (tombstones live forever for audit), so beta routes through
 * soft-delete with a discoverable reason. Legacy tasks have **no** permanent
 * delete endpoint either (there is no `permanentlyDeleteGroupTask` in
 * `lib/api/group.ts`), so the legacy path falls through to the soft-delete
 * call — matching the way TasksTab already empties the trash today.
 */
export async function permanentlyDeleteTaskUnified(
    taskId: string,
    useSocialBeta: boolean,
    deps: SocialTaskActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const deleteSocial = deps.deleteSocialEntity ?? deleteSocialEntityDefault;
        return deleteSocial(taskId, 'permanent');
    }
    const deleteLegacy = deps.deleteGroupTask ?? deleteGroupTaskLegacy;
    return deleteLegacy(taskId);
}

// === Reaction toggle ========================================================

/**
 * `toggleTaskReactionUnified` — beta path uses the universal toggle endpoint
 * (server returns fresh aggregates). Legacy has no per-group task reaction
 * endpoint today, so we degrade to a non-fatal failure with a discoverable
 * error code rather than silently no-opping.
 *
 * `groupKey` is accepted for symmetry with `togglePostReactionUnified` and to
 * keep call sites uniform, even though the beta path infers it from the
 * entity record.
 */
export async function toggleTaskReactionUnified(
    taskId: string,
    emoji: string,
    useSocialBeta: boolean,
    _groupKey?: string,
    deps: SocialTaskActionDeps = {},
): Promise<ApiResponse<unknown>> {
    if (useSocialBeta) {
        const toggleSocial = deps.toggleSocialReaction ?? toggleSocialReactionDefault;
        return toggleSocial(taskId, emoji);
    }
    return {
        success: false,
        error: 'Task reactions are only available on the social-beta path; legacy tasks do not expose a reaction endpoint.',
        errorCode: 'TASK_REACTION_LEGACY_UNSUPPORTED',
    };
}

// === Completion toggle ======================================================

/**
 * `toggleTaskCompletionUnified` — beta has no dedicated `/toggle` endpoint for
 * tasks. Per-user completion lives inside the entity payload as
 * `completedByUserIds: string[]`. We compute the next array (toggle membership
 * of `userId`) and PATCH the entity payload accordingly.
 *
 * The caller passes the array we should compute against. The legacy hook
 * surfaces a single boolean per task, but the beta read path
 * (`socialEntityToTaskView`) keeps the raw array under
 * `task.completedByUserIds`, so TasksTab can pass it through verbatim.
 *
 * Legacy path keeps the existing `/api/v3/group/tasks/toggle` semantics: a
 * boolean completion flag for the row. We derive the boolean from whether the
 * caller wants to mark themselves done (the `userId` was previously absent).
 */
export async function toggleTaskCompletionUnified(
    taskId: string,
    userId: string,
    currentCompletedBy: string[] | undefined,
    useSocialBeta: boolean,
    deps: SocialTaskActionDeps = {},
): Promise<ApiResponse<unknown>> {
    const current = Array.isArray(currentCompletedBy) ? currentCompletedBy : [];
    const isCurrentlyDone = current.includes(userId);
    const nextCompletedBy = isCurrentlyDone
        ? current.filter((id) => id !== userId)
        : [...current, userId];

    if (useSocialBeta) {
        const updateSocial = deps.updateSocialEntity ?? updateSocialEntityDefault;
        return updateSocial(taskId, {
            payload: { completedByUserIds: nextCompletedBy },
        });
    }
    const toggleLegacy = deps.toggleGroupTaskCompletion ?? toggleGroupTaskCompletionLegacy;
    return toggleLegacy(taskId, !isCurrentlyDone);
}
