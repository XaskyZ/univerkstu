import { describe, it, expect, vi } from 'vitest';
import type { ApiResponse } from '@/lib/api/core';
import {
    createTaskUnified,
    deleteTaskUnified,
    permanentlyDeleteTaskUnified,
    restoreTaskUnified,
    toggleTaskCompletionUnified,
    toggleTaskReactionUnified,
    updateTaskUnified,
    type SocialTaskActionDeps,
} from './social-task-actions';

// Unit tests for the unified task write-path wrappers. Each test injects fakes
// via the `deps` argument (matching the convention in
// `social-feed-actions.test.ts`). No `vi.mock` ESM intercepts; the wrappers
// expose every API binding as an explicit dep so fakes are first-class.

function ok<T>(data?: T): ApiResponse<T> {
    return { success: true, data: data as T };
}

describe('createTaskUnified', () => {
    it('beta path: calls createSocialEntity with kind=task and group-scoped scopeId', async () => {
        // Locks the shape passed into the universal store. A regression that
        // dropped `scopeType`/`scopeId` would silently land tasks in an empty
        // scope where the read path would never surface them.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-task-1' }));
        const deps: SocialTaskActionDeps = { createSocialEntity };
        const result = await createTaskUnified(
            'ITS-21',
            { title: 'T', body: 'B', dueAt: '2026-03-01T00:00:00Z' },
            true,
            deps,
        );
        expect(result.success).toBe(true);
        expect(createSocialEntity).toHaveBeenCalledTimes(1);
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'task',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            payload: { title: 'T', body: 'B', dueAt: '2026-03-01T00:00:00Z' },
        });
    });

    it('beta path: omits dueAt from the payload when not provided', async () => {
        // Explicit-undefined keys would serialize away in JSON, but pruning
        // is what the AJV validator relies on for forward-strict payloads.
        const createSocialEntity = vi.fn().mockResolvedValue(ok({ id: 'social-task-2' }));
        await createTaskUnified('CSE-22', { title: 'T', body: 'B' }, true, { createSocialEntity });
        expect(createSocialEntity).toHaveBeenCalledWith({
            kind: 'task',
            scopeType: 'group',
            scopeId: 'group:CSE-22',
            payload: { title: 'T', body: 'B' },
        });
    });

    it('legacy path: calls createGroupTask with title + (groupKey, description, deadline)', async () => {
        // Verifies the legacy adapter routes `body` → `description` and
        // `dueAt` → `deadline`, keeping the field rename centralized here so
        // the call site does not have to remember it.
        const createGroupTask = vi.fn().mockResolvedValue(ok({ id: 'legacy-task-1' }));
        await createTaskUnified(
            'ITS-21',
            { title: 'L', body: 'BL', dueAt: '2026-04-01T00:00:00Z' },
            false,
            { createGroupTask },
        );
        expect(createGroupTask).toHaveBeenCalledWith('L', {
            groupKey: 'ITS-21',
            description: 'BL',
            deadline: '2026-04-01T00:00:00Z',
        });
    });
});

describe('updateTaskUnified', () => {
    it('beta path: PATCHes only the provided payload fields', async () => {
        // The whole point of the social PATCH endpoint is partial updates —
        // verify we don't include `title` when the caller didn't ask to
        // change it.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await updateTaskUnified('e-1', { body: 'new body' }, true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-1', { payload: { body: 'new body' } });
    });

    it('beta path: sends an empty patch when nothing was provided', async () => {
        // Defensive: the social PATCH endpoint accepts an empty patch as a
        // no-op. Make sure we don't accidentally inject a stale `payload: {}`
        // that would re-trigger validation against the schema.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await updateTaskUnified('e-2', {}, true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-2', {});
    });

    it('beta path: forwards `dueAt` inside payload', async () => {
        // `dueAt` lives under `payload` (task-specific field) — assert it
        // does not bubble up to a top-level patch key.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await updateTaskUnified('e-3', { dueAt: '2026-05-01T00:00:00Z' }, true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-3', {
            payload: { dueAt: '2026-05-01T00:00:00Z' },
        });
    });

    it('legacy path: forwards (taskId, { title, description, deadline })', async () => {
        // Legacy schema requires title — defaults to '' so the request shape
        // stays valid even when callers omit it (they shouldn't).
        const updateGroupTask = vi.fn().mockResolvedValue(ok({ id: 't' }));
        await updateTaskUnified('p-1', { title: 'T2', body: 'B2' }, false, { updateGroupTask });
        expect(updateGroupTask).toHaveBeenCalledWith('p-1', {
            title: 'T2',
            description: 'B2',
            deadline: undefined,
        });
    });
});

describe('deleteTaskUnified', () => {
    it('beta path: calls deleteSocialEntity with the reason string when provided', async () => {
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deleteTaskUnified('e-4', 'duplicate', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-4', 'duplicate');
    });

    it('beta path: passes `undefined` reason through unchanged', async () => {
        // The social client treats undefined reason as "no querystring" —
        // make sure we don't accidentally coerce it to the literal string
        // 'undefined'.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await deleteTaskUnified('e-5', undefined, true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-5', undefined);
    });

    it('legacy path: ignores reason (the legacy endpoint has no reason param)', async () => {
        const deleteGroupTask = vi.fn().mockResolvedValue(ok({ deleted: true }));
        await deleteTaskUnified('p-2', 'doesnt-matter', false, { deleteGroupTask });
        expect(deleteGroupTask).toHaveBeenCalledWith('p-2');
    });
});

describe('restoreTaskUnified', () => {
    it('beta path: calls restoreSocialEntity with the entity id', async () => {
        const restoreSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await restoreTaskUnified('e-6', true, { restoreSocialEntity });
        expect(restoreSocialEntity).toHaveBeenCalledWith('e-6');
    });

    it('legacy path: calls restoreDeletedGroupTask', async () => {
        const restoreDeletedGroupTask = vi.fn().mockResolvedValue(ok({ id: 't' }));
        await restoreTaskUnified('p-3', false, { restoreDeletedGroupTask });
        expect(restoreDeletedGroupTask).toHaveBeenCalledWith('p-3');
    });
});

describe('permanentlyDeleteTaskUnified', () => {
    it('beta path: routes through deleteSocialEntity with reason=permanent', async () => {
        // Social store has no hard-delete primitive — assert we degrade
        // gracefully to a soft-delete with a discoverable reason.
        const deleteSocialEntity = vi.fn().mockResolvedValue(ok(null));
        await permanentlyDeleteTaskUnified('e-7', true, { deleteSocialEntity });
        expect(deleteSocialEntity).toHaveBeenCalledWith('e-7', 'permanent');
    });

    it('legacy path: routes through deleteGroupTask (legacy has no hard-delete either)', async () => {
        // `permanentlyDeleteGroupTask` does not exist in `lib/api/group.ts`
        // today; the legacy wrapper falls through to soft-delete. Test pins
        // that decision so a future contributor does not accidentally swap
        // in a non-existent function.
        const deleteGroupTask = vi.fn().mockResolvedValue(ok({ deleted: true }));
        await permanentlyDeleteTaskUnified('p-4', false, { deleteGroupTask });
        expect(deleteGroupTask).toHaveBeenCalledWith('p-4');
    });
});

describe('toggleTaskReactionUnified', () => {
    it('beta path: calls toggleSocialReaction with (taskId, emoji)', async () => {
        const toggleSocialReaction = vi.fn().mockResolvedValue(ok({ added: true, reactions: [], mine: [] }));
        await toggleTaskReactionUnified('e-8', '👍', true, 'ITS-21', { toggleSocialReaction });
        expect(toggleSocialReaction).toHaveBeenCalledWith('e-8', '👍');
    });

    it('legacy path: returns a non-success ApiResponse with TASK_REACTION_LEGACY_UNSUPPORTED', async () => {
        // No `toggleGroupTaskReaction` exists today; the wrapper exposes the
        // limitation via an error code instead of silently no-opping.
        const result = await toggleTaskReactionUnified('p-5', '🎉', false);
        expect(result.success).toBe(false);
        expect(result.errorCode).toBe('TASK_REACTION_LEGACY_UNSUPPORTED');
        expect(typeof result.error).toBe('string');
    });
});

describe('toggleTaskCompletionUnified', () => {
    it('beta path: appends viewer id to `completedByUserIds` when previously absent', async () => {
        // The happy path — viewer clicks the checkbox while they were not in
        // the set. We expect a PATCH whose payload diff carries the new
        // array with the viewer appended.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await toggleTaskCompletionUnified('e-9', 'user-A', ['user-B'], true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-9', {
            payload: { completedByUserIds: ['user-B', 'user-A'] },
        });
    });

    it('beta path: removes viewer id from `completedByUserIds` when already present', async () => {
        // Toggle-off path — clicking when already done removes the viewer.
        // The remaining users keep their entries.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await toggleTaskCompletionUnified('e-10', 'user-A', ['user-A', 'user-B'], true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-10', {
            payload: { completedByUserIds: ['user-B'] },
        });
    });

    it('beta path: treats undefined currentCompletedBy as an empty array', async () => {
        // Defensive: the read adapter may surface `completedByUserIds` as
        // undefined for legacy-only tasks. We should still produce a valid
        // patch instead of crashing.
        const updateSocialEntity = vi.fn().mockResolvedValue(ok({ entity: {} }));
        await toggleTaskCompletionUnified('e-11', 'user-A', undefined, true, { updateSocialEntity });
        expect(updateSocialEntity).toHaveBeenCalledWith('e-11', {
            payload: { completedByUserIds: ['user-A'] },
        });
    });

    it('legacy path: forwards completed=true when viewer was previously absent', async () => {
        // Legacy schema is a single boolean on the row. The wrapper derives
        // the bool from whether the viewer's id was already in the set.
        const toggleGroupTaskCompletion = vi.fn().mockResolvedValue(ok({ id: 't' }));
        await toggleTaskCompletionUnified('p-6', 'user-A', [], false, { toggleGroupTaskCompletion });
        expect(toggleGroupTaskCompletion).toHaveBeenCalledWith('p-6', true);
    });

    it('legacy path: forwards completed=false when viewer was previously present', async () => {
        const toggleGroupTaskCompletion = vi.fn().mockResolvedValue(ok({ id: 't' }));
        await toggleTaskCompletionUnified('p-7', 'user-A', ['user-A'], false, { toggleGroupTaskCompletion });
        expect(toggleGroupTaskCompletion).toHaveBeenCalledWith('p-7', false);
    });
});
