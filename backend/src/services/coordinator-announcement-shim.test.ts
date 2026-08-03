import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase 1c dual-write shim tests for coordinator_announcements. Mirrors the
// group-posts-shim / group-tasks-shim / group-extra-lessons-shim test structure:
// mock the postgres bridge (so the legacy lookups/updates are observable
// without a real DB) and the universal social service (so failure modes are
// deterministic). The contract under test is that the shim is non-fatal —
// callers must never see throws from the new-store path, even when it explodes.

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

interface PgRow {
    social_entity_id: string | null;
}

// In-memory legacy table: announcementId -> social_entity_id.
const legacyById = new Map<string, string | null>();

const fakeClient: FakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();
        if (text.startsWith('select social_entity_id from app_coordinator_announcements')) {
            const [announcementId] = params as [string];
            if (!legacyById.has(announcementId)) {
                return { rows: [] as PgRow[], rowCount: 0 };
            }
            return {
                rows: [{ social_entity_id: legacyById.get(announcementId) ?? null }] as PgRow[],
                rowCount: 1,
            };
        }
        if (text.startsWith('update app_coordinator_announcements set social_entity_id')) {
            const [announcementId, socialId] = params as [string, string];
            legacyById.set(announcementId, socialId);
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
const softDeleteEntityMock = vi.fn();
const restoreEntityMock = vi.fn();

vi.mock('./social.js', () => ({
    createEntity: (...args: unknown[]) => createEntityMock(...args),
    softDeleteEntity: (...args: unknown[]) => softDeleteEntityMock(...args),
    restoreEntity: (...args: unknown[]) => restoreEntityMock(...args),
    // Real implementation preserves caller scope_id semantics; re-export the
    // canonical version so the shim's prefix-building stays accurate.
    buildScopeId: (scopeType: string, raw: string) =>
        raw.startsWith(`${scopeType}:`) ? raw : `${scopeType}:${raw}`,
}));

import {
    coercePriority,
    shimMirrorCreateCoordinatorAnnouncement,
    shimMirrorSoftDeleteCoordinatorAnnouncement,
    shimMirrorRestoreCoordinatorAnnouncement,
    shimMirrorPermanentDeleteCoordinatorAnnouncement,
} from './coordinator-announcement-shim.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    legacyById.clear();
    fakeClient.query.mockClear();
    createEntityMock.mockReset();
    softDeleteEntityMock.mockReset();
    restoreEntityMock.mockReset();
    // Silence the intentional shim error logs so the test output stays clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
});

describe('coercePriority', () => {
    it('maps the legacy info → low', () => {
        expect(coercePriority('info')).toBe('low');
    });

    it('maps the legacy warning → high', () => {
        expect(coercePriority('warning')).toBe('high');
    });

    it('passes critical through unchanged', () => {
        expect(coercePriority('critical')).toBe('critical');
    });

    it('falls back to medium for unknown legacy values', () => {
        expect(coercePriority('garbage')).toBe('medium');
    });

    it('passes already-canonical low/medium/high through unchanged (forward-compat)', () => {
        expect(coercePriority('low')).toBe('low');
        expect(coercePriority('medium')).toBe('medium');
        expect(coercePriority('high')).toBe('high');
    });
});

describe('shimMirrorCreateCoordinatorAnnouncement', () => {
    it('creates a social entity with kind=announcement, scope=announcement:global, and the mapped payload, then stores the link', async () => {
        legacyById.set('legacy-1', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1' });

        await shimMirrorCreateCoordinatorAnnouncement({
            legacyId: 'legacy-1',
            authorUserId: 'coordinator-a',
            title: 'Maintenance window',
            body: 'Server will reboot at 02:00',
            priority: 'warning',
            targetGroups: ['ITS-21', 'ITS-22'],
            expiresAt: '2026-06-01T10:00:00.000Z',
        });

        expect(createEntityMock).toHaveBeenCalledTimes(1);
        expect(createEntityMock).toHaveBeenCalledWith({
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:global',
            authorUserId: 'coordinator-a',
            payload: {
                title: 'Maintenance window',
                body: 'Server will reboot at 02:00',
                priority: 'high',
                targetGroups: ['ITS-21', 'ITS-22'],
                expiresAt: '2026-06-01T10:00:00.000Z',
            },
        });
        // legacy row now points at the mirror.
        expect(legacyById.get('legacy-1')).toBe('social-1');
    });

    it('omits targetGroups + expiresAt from the payload when they are absent or empty (broadcast mode)', async () => {
        legacyById.set('legacy-1b', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1b' });

        await shimMirrorCreateCoordinatorAnnouncement({
            legacyId: 'legacy-1b',
            authorUserId: 'coordinator-a',
            title: 'T',
            body: 'B',
            priority: 'info',
            targetGroups: [],
            expiresAt: null,
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: { title: 'T', body: 'B', priority: 'low' },
            })
        );
    });

    it('coerces the legacy critical priority through unchanged in the payload', async () => {
        legacyById.set('legacy-1c', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-1c' });

        await shimMirrorCreateCoordinatorAnnouncement({
            legacyId: 'legacy-1c',
            authorUserId: 'coordinator-a',
            title: 'T',
            body: 'B',
            priority: 'critical',
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({
                payload: expect.objectContaining({ priority: 'critical' }),
            })
        );
    });

    it('swallows errors from createEntity (does NOT throw to the caller)', async () => {
        legacyById.set('legacy-2', null);
        createEntityMock.mockRejectedValueOnce(new Error('postgres unavailable'));

        await expect(
            shimMirrorCreateCoordinatorAnnouncement({
                legacyId: 'legacy-2',
                authorUserId: 'coordinator-a',
                title: 'T',
                body: 'B',
                priority: 'info',
            })
        ).resolves.toBeUndefined();

        // legacy link untouched because mirror creation failed.
        expect(legacyById.get('legacy-2')).toBe(null);
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('create failed for coordinator_announcements'),
            expect.objectContaining({ legacyId: 'legacy-2' })
        );
    });
});

describe('shimMirrorSoftDeleteCoordinatorAnnouncement', () => {
    it('soft-deletes the mirror entity when the link exists (legacy revoke maps here)', async () => {
        legacyById.set('legacy-6', 'social-6');
        softDeleteEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorSoftDeleteCoordinatorAnnouncement({
            legacyId: 'legacy-6',
            actorUserId: 'coordinator-a',
        });

        expect(softDeleteEntityMock).toHaveBeenCalledWith('social-6', 'coordinator-a');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-7', null);
        await shimMirrorSoftDeleteCoordinatorAnnouncement({
            legacyId: 'legacy-7',
            actorUserId: 'coordinator-a',
        });
        expect(softDeleteEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from softDeleteEntity', async () => {
        legacyById.set('legacy-8', 'social-8');
        softDeleteEntityMock.mockRejectedValueOnce(new Error('not found'));

        await expect(
            shimMirrorSoftDeleteCoordinatorAnnouncement({
                legacyId: 'legacy-8',
                actorUserId: 'coordinator-a',
            })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorRestoreCoordinatorAnnouncement', () => {
    it('restores the mirror entity when the link exists', async () => {
        legacyById.set('legacy-9', 'social-9');
        restoreEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorRestoreCoordinatorAnnouncement({
            legacyId: 'legacy-9',
            actorUserId: 'coordinator-a',
        });

        expect(restoreEntityMock).toHaveBeenCalledWith('social-9', 'coordinator-a');
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-10', null);
        await shimMirrorRestoreCoordinatorAnnouncement({
            legacyId: 'legacy-10',
            actorUserId: 'coordinator-a',
        });
        expect(restoreEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from restoreEntity', async () => {
        legacyById.set('legacy-11', 'social-11');
        restoreEntityMock.mockRejectedValueOnce(new Error('not found'));

        await expect(
            shimMirrorRestoreCoordinatorAnnouncement({
                legacyId: 'legacy-11',
                actorUserId: 'coordinator-a',
            })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('shimMirrorPermanentDeleteCoordinatorAnnouncement', () => {
    it('soft-deletes the mirror with the permanent-delete reason instead of hard-deleting', async () => {
        legacyById.set('legacy-12', 'social-12');
        softDeleteEntityMock.mockResolvedValueOnce(undefined);

        await shimMirrorPermanentDeleteCoordinatorAnnouncement({
            legacyId: 'legacy-12',
            actorUserId: 'coordinator-a',
        });

        expect(softDeleteEntityMock).toHaveBeenCalledWith(
            'social-12',
            'coordinator-a',
            'permanent-delete',
        );
    });

    it('is a no-op when the legacy row has no social_entity_id link', async () => {
        legacyById.set('legacy-13', null);
        await shimMirrorPermanentDeleteCoordinatorAnnouncement({
            legacyId: 'legacy-13',
            actorUserId: 'coordinator-a',
        });
        expect(softDeleteEntityMock).not.toHaveBeenCalled();
    });

    it('swallows errors from softDeleteEntity in the permanent path', async () => {
        legacyById.set('legacy-14', 'social-14');
        softDeleteEntityMock.mockRejectedValueOnce(new Error('db down'));

        await expect(
            shimMirrorPermanentDeleteCoordinatorAnnouncement({
                legacyId: 'legacy-14',
                actorUserId: 'coordinator-a',
            })
        ).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalled();
    });
});

describe('scope_id prefixing', () => {
    it('uses the fixed "announcement:global" scope regardless of targetGroups (per-group fan-out lives in payload, not scope)', async () => {
        legacyById.set('legacy-15', null);
        createEntityMock.mockResolvedValueOnce({ id: 'social-15' });

        await shimMirrorCreateCoordinatorAnnouncement({
            legacyId: 'legacy-15',
            authorUserId: 'coordinator-a',
            title: 'T',
            body: 'B',
            priority: 'info',
            targetGroups: ['ITS-21'],
        });

        expect(createEntityMock).toHaveBeenCalledWith(
            expect.objectContaining({
                scopeType: 'announcement',
                scopeId: 'announcement:global',
                payload: expect.objectContaining({ targetGroups: ['ITS-21'] }),
            })
        );
    });
});
