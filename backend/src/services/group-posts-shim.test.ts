import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase 1c dual-write shim tests. We mock both the postgres bridge (so the
// legacy lookups/updates are observable without a real DB) and the universal
// social service (so we can drive failure modes deterministically). The goal
// is to prove the shim's non-fatal contract — callers must never see throws
// from the new-store path, even when it explodes.

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

interface PgRow {
    social_entity_id: string | null;
}

// In-memory legacy table: postId -> social_entity_id.
const legacyById = new Map<string, string | null>();

const fakeClient: FakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();
        if (text.startsWith('select social_entity_id from app_group_posts')) {
            const [postId] = params as [string];
            if (!legacyById.has(postId)) {
                return { rows: [] as PgRow[], rowCount: 0 };
            }
            return {
                rows: [{ social_entity_id: legacyById.get(postId) ?? null }] as PgRow[],
                rowCount: 1,
            };
        }
        if (text.startsWith('update app_group_posts set social_entity_id')) {
            const [postId, socialId] = params as [string, string];
            legacyById.set(postId, socialId);
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

// Mock the social service. Each call resolves/rejects based on test setup.
const createEntityMock = vi.fn();
const updateEntityMock = vi.fn();
const softDeleteEntityMock = vi.fn();
const restoreEntityMock = vi.fn();

vi.mock('./social.js', () => ({
    createEntity: (...args: unknown[]) => createEntityMock(...args),
    updateEntity: (...args: unknown[]) => updateEntityMock(...args),
    softDeleteEntity: (...args: unknown[]) => softDeleteEntityMock(...args),
    restoreEntity: (...args: unknown[]) => restoreEntityMock(...args),
    // Real implementation preserves caller scope_id semantics; re-export the
    // canonical version so the shim's prefix-building stays accurate.
    buildScopeId: (scopeType: string, raw: string) =>
        raw.startsWith(`${scopeType}:`) ? raw : `${scopeType}:${raw}`,
}));

import {
    shimMirrorCreateGroupPost,
    shimMirrorUpdateGroupPost,
    shimMirrorSoftDeleteGroupPost,
    shimMirrorRestoreGroupPost,
    shimMirrorPermanentDeleteGroupPost,
} from './group-posts-shim.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    legacyById.clear();
    fakeClient.query.mockClear();
    createEntityMock.mockReset();
    updateEntityMock.mockReset();
    softDeleteEntityMock.mockReset();
    restoreEntityMock.mockReset();
    // Silence the intentional shim error logs so the test output stays clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

describe('shimMirrorCreateGroupPost', () => {
    it('creates a social entity with the correct kind/scope/payload and stores the link', async () => {
        legacyById.set('legacy-1', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1' });

        await shimMirrorCreateGroupPost({
            legacyId: 'legacy-1',
            groupKey: 'ITS-21',
            authorUserId: 'user-a',
            title: 'Hello',
            body: 'world',
        });

        expect(createEntityMock).toHaveBeenCalledTimes(1);
        expect(createEntityMock).toHaveBeenCalledWith({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'user-a',
            payload: { title: 'Hello', body: 'world' },
        });
        // legacy row now points at the mirror.
        expect(legacyById.get('legacy-1')).toBe('social-1');
    });

    it('swallows errors from createEntity (does NOT throw to the caller)', async () => {
        legacyById.set('legacy-2', null);
        createEntityMock.mockRejectedValueOnce(new Error('postgres unavailable'));

        await expect(
            shimMirrorCreateGroupPost({
                legacyId: 'legacy-2',
                groupKey: 'ITS-21',
                authorUserId: 'user-a',
                title: 'T',
                body: 'B',
            })
        ).resolves.toBeUndefined();

        // legacy link untouched because mirror creation failed.
        expect(legacyById.get('legacy-2')).toBe(null);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('create failed for group_posts'),
            expect.objectContaining({ legacyId: 'legacy-2' })
        );
    });
});

describe('shimMirrorUpdateGroupPost', () => {
    it('updates the mirror entity when social_entity_id is already set', async () => {
        legacyById.set('legacy-3', 'social-3');
        updateEntityMock.mockResolvedValueOnce({ id: 'social-3' });

        await shimMirrorUpdateGroupPost({
            legacyId: 'legacy-3',
            groupKey: 'ITS-21',
            authorUserId: 'user-a',
            title: 'New T',
            body: 'New B',
        });

        expect(updateEntityMock).toHaveBeenCalledWith('social-3', 'user-a', {
            title: 'New T',
            body: 'New B',
        });
        expect(createEntityMock).not.toHaveBeenCalled();
    });

    it('creates a new mirror entity when the legacy row has no social_entity_id (back-fill)', async () => {
        legacyById.set('legacy-4', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-4' });

        await shimMirrorUpdateGroupPost({
            legacyId: 'legacy-4',
            groupKey: 'ITS-21',
            authorUserId: 'user-a',
            title: 'T',
            body: 'B',
        });

        expect(updateEntityMock).not.toHaveBeenCalled();
        expect(createEntityMock).toHaveBeenCalledWith({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'user-a',
            payload: { title: 'T', body: 'B' },
        });
        // back-fill stored the link.
        expect(legacyById.get('legacy-4')).toBe('social-4');
    });

    it('swallows errors from updateEntity (caller stays successful)', async () => {
        legacyById.set('legacy-5', 'social-5');
        updateEntityMock.mockRejectedValueOnce(new Error('forbidden'));

        await expect(
            shimMirrorUpdateGroupPost({
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

describe('shimMirrorSoftDeleteGroupPost', () => {
    it('soft-deletes the mirror entity when the link exists', async () => {
        legacyById.set('legacy-6', 'social-6');
        softDeleteEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorSoftDeleteGroupPost({ legacyId: 'legacy-6', actorUserId: 'user-a' });

        expect(softDeleteEntityMock).toHaveBeenCalledWith('social-6', 'user-a');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-7', null);
        await shimMirrorSoftDeleteGroupPost({ legacyId: 'legacy-7', actorUserId: 'user-a' });
        expect(softDeleteEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from softDeleteEntity', async () => {
        legacyById.set('legacy-8', 'social-8');
        softDeleteEntityMock.mockRejectedValueOnce(new Error('not found'));

        await expect(
            shimMirrorSoftDeleteGroupPost({ legacyId: 'legacy-8', actorUserId: 'user-a' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorRestoreGroupPost', () => {
    it('restores the mirror entity when the link exists', async () => {
        legacyById.set('legacy-9', 'social-9');
        restoreEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorRestoreGroupPost({ legacyId: 'legacy-9', actorUserId: 'user-a' });

        expect(restoreEntityMock).toHaveBeenCalledWith('social-9', 'user-a');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-10', null);
        await shimMirrorRestoreGroupPost({ legacyId: 'legacy-10', actorUserId: 'user-a' });
        expect(restoreEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from restoreEntity', async () => {
        legacyById.set('legacy-11', 'social-11');
        restoreEntityMock.mockRejectedValueOnce(new Error('not found'));

        await expect(
            shimMirrorRestoreGroupPost({ legacyId: 'legacy-11', actorUserId: 'user-a' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorPermanentDeleteGroupPost', () => {
    it('soft-deletes the mirror with the permanent-delete reason instead of hard-deleting', async () => {
        legacyById.set('legacy-12', 'social-12');
        softDeleteEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorPermanentDeleteGroupPost({ legacyId: 'legacy-12', actorUserId: 'user-a' });

        expect(softDeleteEntityMock).toHaveBeenCalledWith('social-12', 'user-a', 'permanent-delete');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-13', null);
        await shimMirrorPermanentDeleteGroupPost({ legacyId: 'legacy-13', actorUserId: 'user-a' });
        expect(softDeleteEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from softDeleteEntity in the permanent path', async () => {
        legacyById.set('legacy-14', 'social-14');
        softDeleteEntityMock.mockRejectedValueOnce(new Error('db down'));

        await expect(
            shimMirrorPermanentDeleteGroupPost({ legacyId: 'legacy-14', actorUserId: 'user-a' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('scope_id prefixing for already-namespaced keys', () => {
    it('does not double-prefix a group key that already starts with group:', async () => {
        legacyById.set('legacy-15', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-15' });

        await shimMirrorCreateGroupPost({
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
