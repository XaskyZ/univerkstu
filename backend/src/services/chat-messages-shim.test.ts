import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase 1c dual-write shim tests for direct chat messages. Mirrors the
// group-posts-shim / group-tasks-shim / group-extra-lessons-shim /
// coordinator-announcement-shim test structure: mock the postgres bridge (so
// legacy lookups/updates are observable without a real DB) and the universal
// social service (so failure modes are deterministic). The contract under test
// is that the shim is non-fatal — callers must never see throws from the
// new-store path, even when it explodes.

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

interface PgRow {
    social_entity_id: string | null;
}

// In-memory legacy table: messageId -> social_entity_id.
const legacyById = new Map<string, string | null>();

const fakeClient: FakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();
        if (text.startsWith('select social_entity_id from app_chat_messages')) {
            const [messageId] = params as [string];
            if (!legacyById.has(messageId)) {
                return { rows: [] as PgRow[], rowCount: 0 };
            }
            return {
                rows: [{ social_entity_id: legacyById.get(messageId) ?? null }] as PgRow[],
                rowCount: 1,
            };
        }
        if (text.startsWith('update app_chat_messages set social_entity_id')) {
            const [messageId, socialId] = params as [string, string];
            legacyById.set(messageId, socialId);
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
    shimMirrorCreateChatMessage,
    shimMirrorUpdateChatMessage,
    shimMirrorSoftDeleteChatMessage,
    shimMirrorRestoreChatMessage,
    shimMirrorPermanentDeleteChatMessage,
} from './chat-messages-shim.js';

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

describe('shimMirrorCreateChatMessage', () => {
    it('creates a social entity with kind=dm_message, scope=dm:<roomId>, and a minimal body-only payload, then stores the link', async () => {
        legacyById.set('msg-1', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1' });

        await shimMirrorCreateChatMessage({
            legacyId: 'msg-1',
            roomId: 'direct:alice::bob',
            authorUserId: 'alice',
            body: 'hello bob',
        });

        expect(createEntityMock).toHaveBeenCalledTimes(1);
        expect(createEntityMock).toHaveBeenCalledWith({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: 'dm:direct:alice::bob',
            authorUserId: 'alice',
            payload: { body: 'hello bob' },
        });
        // legacy row now points at the mirror.
        expect(legacyById.get('msg-1')).toBe('social-1');
    });

    it('includes replyToMessageId in the payload when provided', async () => {
        legacyById.set('msg-1b', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1b' });

        await shimMirrorCreateChatMessage({
            legacyId: 'msg-1b',
            roomId: 'direct:alice::bob',
            authorUserId: 'alice',
            body: 'reply',
            replyToMessageId: 'msg-prev',
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: { body: 'reply', replyToMessageId: 'msg-prev' },
            })
        );
    });

    it('omits replyToMessageId from the payload when null/undefined (cleaner mirror rows)', async () => {
        legacyById.set('msg-1c', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1c' });

        await shimMirrorCreateChatMessage({
            legacyId: 'msg-1c',
            roomId: 'direct:alice::bob',
            authorUserId: 'alice',
            body: 'plain',
            replyToMessageId: null,
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({ payload: { body: 'plain' } })
        );
    });

    it('swallows errors from createEntity (does NOT throw to the caller)', async () => {
        legacyById.set('msg-2', null);
        createEntityMock.mockRejectedValueOnce(new Error('postgres unavailable'));

        await expect(
            shimMirrorCreateChatMessage({
                legacyId: 'msg-2',
                roomId: 'direct:alice::bob',
                authorUserId: 'alice',
                body: 'x',
            })
        ).resolves.toBeUndefined();

        // legacy link untouched because mirror creation failed.
        expect(legacyById.get('msg-2')).toBe(null);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('create failed for chat_messages'),
            expect.objectContaining({ legacyId: 'msg-2' })
        );
    });
});

describe('shimMirrorUpdateChatMessage', () => {
    it('updates the mirror entity when social_entity_id is already set', async () => {
        legacyById.set('msg-3', 'social-3');
        updateEntityMock.mockResolvedValueOnce({ id: 'social-3' });

        await shimMirrorUpdateChatMessage({
            legacyId: 'msg-3',
            roomId: 'direct:alice::bob',
            authorUserId: 'alice',
            body: 'edited body',
            editedAt: '2026-05-21T10:00:00.000Z',
        });

        expect(updateEntityMock).toHaveBeenCalledWith('social-3', 'alice', {
            body: 'edited body',
            editedAt: '2026-05-21T10:00:00.000Z',
        });
        expect(createEntityMock).not.toHaveBeenCalled();
    });

    it('creates a new mirror entity when the legacy row has no social_entity_id (back-fill)', async () => {
        legacyById.set('msg-4', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-4' });

        await shimMirrorUpdateChatMessage({
            legacyId: 'msg-4',
            roomId: 'direct:alice::bob',
            authorUserId: 'alice',
            body: 'B',
        });

        expect(updateEntityMock).not.toHaveBeenCalled();
        expect(createEntityMock).toHaveBeenCalledWith({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: 'dm:direct:alice::bob',
            authorUserId: 'alice',
            payload: { body: 'B' },
        });
        // back-fill stored the link.
        expect(legacyById.get('msg-4')).toBe('social-4');
    });

    it('swallows errors from updateEntity (caller stays successful)', async () => {
        legacyById.set('msg-5', 'social-5');
        updateEntityMock.mockRejectedValueOnce(new Error('forbidden'));

        await expect(
            shimMirrorUpdateChatMessage({
                legacyId: 'msg-5',
                roomId: 'direct:alice::bob',
                authorUserId: 'alice',
                body: 'B',
            })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorSoftDeleteChatMessage', () => {
    it('soft-deletes the mirror entity when the link exists', async () => {
        legacyById.set('msg-6', 'social-6');
        softDeleteEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorSoftDeleteChatMessage({ legacyId: 'msg-6', actorUserId: 'alice' });

        expect(softDeleteEntityMock).toHaveBeenCalledWith('social-6', 'alice');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('msg-7', null);
        await shimMirrorSoftDeleteChatMessage({ legacyId: 'msg-7', actorUserId: 'alice' });
        expect(softDeleteEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from softDeleteEntity', async () => {
        legacyById.set('msg-8', 'social-8');
        softDeleteEntityMock.mockRejectedValueOnce(new Error('not found'));

        await expect(
            shimMirrorSoftDeleteChatMessage({ legacyId: 'msg-8', actorUserId: 'alice' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorRestoreChatMessage', () => {
    it('restores the mirror entity when the link exists', async () => {
        legacyById.set('msg-9', 'social-9');
        restoreEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorRestoreChatMessage({ legacyId: 'msg-9', actorUserId: 'alice' });

        expect(restoreEntityMock).toHaveBeenCalledWith('social-9', 'alice');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('msg-10', null);
        await shimMirrorRestoreChatMessage({ legacyId: 'msg-10', actorUserId: 'alice' });
        expect(restoreEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from restoreEntity', async () => {
        legacyById.set('msg-11', 'social-11');
        restoreEntityMock.mockRejectedValueOnce(new Error('not found'));

        await expect(
            shimMirrorRestoreChatMessage({ legacyId: 'msg-11', actorUserId: 'alice' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorPermanentDeleteChatMessage', () => {
    it('soft-deletes the mirror with the permanent-delete reason instead of hard-deleting', async () => {
        legacyById.set('msg-12', 'social-12');
        softDeleteEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorPermanentDeleteChatMessage({ legacyId: 'msg-12', actorUserId: 'alice' });

        expect(softDeleteEntityMock).toHaveBeenCalledWith('social-12', 'alice', 'permanent-delete');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('msg-13', null);
        await shimMirrorPermanentDeleteChatMessage({ legacyId: 'msg-13', actorUserId: 'alice' });
        expect(softDeleteEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from softDeleteEntity in the permanent path', async () => {
        legacyById.set('msg-14', 'social-14');
        softDeleteEntityMock.mockRejectedValueOnce(new Error('db down'));

        await expect(
            shimMirrorPermanentDeleteChatMessage({ legacyId: 'msg-14', actorUserId: 'alice' })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('scope_id prefixing for room ids', () => {
    it('does not double-prefix a room id that already starts with dm:', async () => {
        legacyById.set('msg-15', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-15' });

        await shimMirrorCreateChatMessage({
            legacyId: 'msg-15',
            roomId: 'dm:direct:alice::bob',
            authorUserId: 'alice',
            body: 'x',
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({ scopeId: 'dm:direct:alice::bob' })
        );
    });

    it('namespaces a raw direct:* room id under dm:', async () => {
        legacyById.set('msg-16', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-16' });

        await shimMirrorCreateChatMessage({
            legacyId: 'msg-16',
            roomId: 'direct:alice::bob',
            authorUserId: 'alice',
            body: 'x',
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({ scopeId: 'dm:direct:alice::bob' })
        );
    });
});
