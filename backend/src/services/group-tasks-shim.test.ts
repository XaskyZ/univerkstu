import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase 1c dual-write shim tests for group_tasks. Mirrors the group-posts-shim
// test structure: mock the postgres bridge (so the legacy lookups/updates are
// observable without a real DB) and the universal social service (so failure
// modes are deterministic). The contract under test is that the shim is
// non-fatal — callers must never see throws from the new-store path, even when
// it explodes.

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

interface PgRow {
    social_entity_id: string | null;
}

// In-memory legacy table: taskId -> social_entity_id.
const legacyById = new Map<string, string | null>();

const fakeClient: FakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();
        if (text.startsWith('select social_entity_id from app_group_tasks')) {
            const [taskId] = params as [string];
            if (!legacyById.has(taskId)) {
                return { rows: [] as PgRow[], rowCount: 0 };
            }
            return {
                rows: [{ social_entity_id: legacyById.get(taskId) ?? null }] as PgRow[],
                rowCount: 1,
            };
        }
        if (text.startsWith('update app_group_tasks set social_entity_id')) {
            const [taskId, socialId] = params as [string, string];
            legacyById.set(taskId, socialId);
            return { rows: [], rowCount: 1 };
        }
        throw new Error(`Unmocked SQL: ${sql}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

const createEntityMock = vi.fn();
const updateEntityMock = vi.fn();
const softDeleteEntityMock = vi.fn();
const restoreEntityMock = vi.fn();

vi.mock('./social.js', () => ({
    createEntity: (...args: unknown[]) => createEntityMock(...args),
    updateEntity: (...args: unknown[]) => updateEntityMock(...args),
    softDeleteEntity: (...args: unknown[]) => softDeleteEntityMock(...args),
    restoreEntity: (...args: unknown[]) => restoreEntityMock(...args),
    buildScopeId: (scopeType: string, raw: string) =>
        raw.startsWith(`${scopeType}:`) ? raw : `${scopeType}:${raw}`,
}));

import {
    shimMirrorCreateGroupTask,
    shimMirrorUpdateGroupTask,
    shimMirrorSoftDeleteGroupTask,
    shimMirrorRestoreGroupTask,
    shimMirrorPermanentDeleteGroupTask,
} from './group-tasks-shim.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    legacyById.clear();
    fakeClient.query.mockClear();
    createEntityMock.mockReset();
    updateEntityMock.mockReset();
    softDeleteEntityMock.mockReset();
    restoreEntityMock.mockReset();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

describe('shimMirrorCreateGroupTask', () => {
    it('creates a social entity with kind=task, scope=group, and the mapped payload, then stores the link', async () => {
        legacyById.set('legacy-1', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1' });

        await shimMirrorCreateGroupTask({
            legacyId: 'legacy-1',
            groupKey: 'ITS-21',
            authorUserId: 'user-a',
            title: 'Buy groceries',
            body: 'milk, eggs',
            dueAt: '2026-06-01T10:00:00.000Z',
        });

        expect(createEntityMock).toHaveBeenCalledTimes(1);
        expect(createEntityMock).toHaveBeenCalledWith({
            kind: 'task',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'user-a',
            payload: { title: 'Buy groceries', body: 'milk, eggs', dueAt: '2026-06-01T10:00:00.000Z' },
        });
        expect(legacyById.get('legacy-1')).toBe('social-1');
    });

    it('omits dueAt from the payload when no deadline is given', async () => {
        legacyById.set('legacy-1b', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1b' });

        await shimMirrorCreateGroupTask({
            legacyId: 'legacy-1b',
            groupKey: 'ITS-21',
            authorUserId: 'user-a',
            title: 'T',
            body: 'B',
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: { title: 'T', body: 'B' },
            })
        );
    });

    it('swallows errors from createEntity (does NOT throw to the caller)', async () => {
        legacyById.set('legacy-2', null);
        createEntityMock.mockRejectedValueOnce(new Error('postgres unavailable'));

        await expect(
            shimMirrorCreateGroupTask({
                legacyId: 'legacy-2',
                groupKey: 'ITS-21',
                authorUserId: 'user-a',
                title: 'T',
                body: 'B',
            })
        ).resolves.toBeUndefined();

        expect(legacyById.get('legacy-2')).toBe(null);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('create failed for group_tasks'),
            expect.objectContaining({ legacyId: 'legacy-2' })
        );
    });
});

describe('shimMirrorUpdateGroupTask', () => {
    it('updates the mirror entity when social_entity_id is already set', async () => {
        legacyById.set('legacy-3', 'social-3');
        updateEntityMock.mockResolvedValueOnce({ id: 'social-3' });

        await shimMirrorUpdateGroupTask({
            legacyId: 'legacy-3',
            groupKey: 'ITS-21',
            authorUserId: 'user-a',
            title: 'New T',
            body: 'New B',
            dueAt: '2026-07-01T09:00:00.000Z',
        });

        expect(updateEntityMock).toHaveBeenCalledWith('social-3', 'user-a', {
            title: 'New T',
            body: 'New B',
            dueAt: '2026-07-01T09:00:00.000Z',
        });
        expect(createEntityMock).not.toHaveBeenCalled();
    });

    it('creates a new mirror entity when the legacy row has no social_entity_id (back-fill)', async () => {
        legacyById.set('legacy-4', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-4' });

        await shimMirrorUpdateGroupTask({
            legacyId: 'legacy-4',
            groupKey: 'ITS-21',
            authorUserId: 'user-a',
            title: 'T',
            body: 'B',
        });

        expect(updateEntityMock).not.toHaveBeenCalled();
        expect(createEntityMock).toHaveBeenCalledWith({
            kind: 'task',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'user-a',
            payload: { title: 'T', body: 'B' },
        });
        expect(legacyById.get('legacy-4')).toBe('social-4');
    });

    it('swallows errors from updateEntity (caller stays successful)', async () => {
        legacyById.set('legacy-5', 'social-5');
        updateEntityMock.mockRejectedValueOnce(new Error('forbidden'));

        await expect(
            shimMirrorUpdateGroupTask({
                legacyId: 'legacy-5',
                groupKey: 'ITS-21',
                authorUserId: 'user-a',
                title: 'T',
                body: 'B',
            })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorSoftDeleteGroupTask', () => {
    it('soft-deletes the mirror entity when the link exists', async () => {
        legacyById.set('legacy-6', 'social-6');
        softDeleteEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorSoftDeleteGroupTask({ legacyId: 'legacy-6', actorUserId: 'user-a' });

        expect(softDeleteEntityMock).toHaveBeenCalledWith('social-6', 'user-a');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-7', null);
        await shimMirrorSoftDeleteGroupTask({ legacyId: 'legacy-7', actorUserId: 'user-a' });
        expect(softDeleteEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from softDeleteEntity', async () => {
        legacyById.set('legacy-8', 'social-8');
        softDeleteEntityMock.mockRejectedValueOnce(new Error('not found'));

        await expect(
            shimMirrorSoftDeleteGroupTask({ legacyId: 'legacy-8', actorUserId: 'user-a' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorRestoreGroupTask', () => {
    it('restores the mirror entity when the link exists', async () => {
        legacyById.set('legacy-9', 'social-9');
        restoreEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorRestoreGroupTask({ legacyId: 'legacy-9', actorUserId: 'user-a' });

        expect(restoreEntityMock).toHaveBeenCalledWith('social-9', 'user-a');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-10', null);
        await shimMirrorRestoreGroupTask({ legacyId: 'legacy-10', actorUserId: 'user-a' });
        expect(restoreEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from restoreEntity', async () => {
        legacyById.set('legacy-11', 'social-11');
        restoreEntityMock.mockRejectedValueOnce(new Error('not found'));

        await expect(
            shimMirrorRestoreGroupTask({ legacyId: 'legacy-11', actorUserId: 'user-a' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorPermanentDeleteGroupTask', () => {
    it('soft-deletes the mirror with the permanent-delete reason instead of hard-deleting', async () => {
        legacyById.set('legacy-12', 'social-12');
        softDeleteEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorPermanentDeleteGroupTask({ legacyId: 'legacy-12', actorUserId: 'user-a' });

        expect(softDeleteEntityMock).toHaveBeenCalledWith('social-12', 'user-a', 'permanent-delete');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-13', null);
        await shimMirrorPermanentDeleteGroupTask({ legacyId: 'legacy-13', actorUserId: 'user-a' });
        expect(softDeleteEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from softDeleteEntity in the permanent path', async () => {
        legacyById.set('legacy-14', 'social-14');
        softDeleteEntityMock.mockRejectedValueOnce(new Error('db down'));

        await expect(
            shimMirrorPermanentDeleteGroupTask({ legacyId: 'legacy-14', actorUserId: 'user-a' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('scope_id prefixing for already-namespaced keys', () => {
    it('does not double-prefix a group key that already starts with group:', async () => {
        legacyById.set('legacy-15', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-15' });

        await shimMirrorCreateGroupTask({
            legacyId: 'legacy-15',
            groupKey: 'group:ITS-21',
            authorUserId: 'user-a',
            title: 'T',
            body: 'B',
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({ scopeId: 'group:ITS-21' })
        );
    });
});
