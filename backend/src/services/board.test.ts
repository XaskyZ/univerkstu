import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the universal social layer + moderation + pg pool so we can exercise the
// board service's orchestration/validation/error-mapping without a database.
vi.mock('./social.js', () => ({
    buildScopeId: (type: string, raw: string) => `${type}:${raw}`,
    validateTitle: (input: unknown) => {
        const s = String(input ?? '').trim();
        if (!s) throw new Error('title must not be empty');
        if (s.length > 200) throw new Error('title too long');
        return s;
    },
    validateBody: (input: unknown) => {
        const s = String(input ?? '').trim();
        if (!s) throw new Error('body must not be empty');
        return s;
    },
    createEntity: vi.fn(),
    getEntityView: vi.fn(),
    listEntitiesByScope: vi.fn(),
    updateEntity: vi.fn(),
    softDeleteEntity: vi.fn(),
}));

vi.mock('./social-moderation.js', () => ({
    isUserMuted: vi.fn(),
}));

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(),
}));

import * as social from './social.js';
import { isUserMuted } from './social-moderation.js';
import { withSupabasePostgres } from '../db/postgres.js';
import {
    BOARD_CATEGORIES,
    BOARD_SCOPE_ID,
    BOARD_SCOPE_TYPE,
    BoardError,
    createBoardAnnouncement,
    deleteAllBoardAnnouncements,
    deleteBoardAnnouncement,
    isBoardCategory,
    isBoardError,
    listBoardAnnouncements,
    normalizeBoardCategory,
    pinBoardAnnouncement,
    setBoardAnnouncementFavorite,
    updateBoardAnnouncement,
} from './board.js';

const createEntityMock = social.createEntity as unknown as ReturnType<typeof vi.fn>;
const getEntityViewMock = social.getEntityView as unknown as ReturnType<typeof vi.fn>;
const updateMock = social.updateEntity as unknown as ReturnType<typeof vi.fn>;
const softDeleteMock = social.softDeleteEntity as unknown as ReturnType<typeof vi.fn>;
const isUserMutedMock = isUserMuted as unknown as ReturnType<typeof vi.fn>;
const withPgMock = withSupabasePostgres as unknown as ReturnType<typeof vi.fn>;

function fakeEntity(id = 'e1') {
    return { id, kind: 'announcement', scopeType: BOARD_SCOPE_TYPE, scopeId: BOARD_SCOPE_ID, authorUserId: 'u1', payload: {}, pinned: false };
}
function fakeView(id = 'e1') {
    return { entity: fakeEntity(id), reactions: [], myReactions: [], commentCount: 0, attachmentCount: 0, isPinned: false, viewCount: 0, hasViewed: false };
}

beforeEach(() => {
    vi.clearAllMocks();
    isUserMutedMock.mockResolvedValue(false);
    createEntityMock.mockResolvedValue(fakeEntity());
    getEntityViewMock.mockResolvedValue(fakeView());
    updateMock.mockResolvedValue(fakeEntity());
    softDeleteMock.mockResolvedValue(undefined);
    // withSupabasePostgres runs the handler with a fake client and returns the
    // handler's result directly (matching the real signature — no extra wrap).
    // Rows carry fields for both the scope-guard query and the author-label
    // query so either handler resolves.
    withPgMock.mockImplementation(async (handler: (client: unknown) => unknown) => {
        const client = {
            query: vi.fn().mockResolvedValue({
                rowCount: 1,
                rows: [{ scope_type: BOARD_SCOPE_TYPE, scope_id: BOARD_SCOPE_ID, deleted_at: null, user_id: 'u1', label: 'Test User', entity_id: 'e1', file_id: 'file-1' }],
            }),
        };
        return handler(client);
    });
});

describe('board scope + categories (pure)', () => {
    it('uses a dedicated scope isolated from coordinator announcements', () => {
        expect(BOARD_SCOPE_TYPE).toBe('announcement');
        expect(BOARD_SCOPE_ID).toBe('announcement:student-board');
        expect(BOARD_SCOPE_ID).not.toBe('announcement:global');
    });

    it('exposes a fixed category set', () => {
        expect(BOARD_CATEGORIES).toEqual(['sale', 'buy', 'service', 'event', 'lost_found', 'help', 'other']);
    });

    it('isBoardCategory accepts known keys only', () => {
        expect(isBoardCategory('sale')).toBe(true);
        expect(isBoardCategory('nope')).toBe(false);
        expect(isBoardCategory(123)).toBe(false);
    });

    it('normalizeBoardCategory falls back to "other"', () => {
        expect(normalizeBoardCategory('event')).toBe('event');
        expect(normalizeBoardCategory('garbage')).toBe('other');
        expect(normalizeBoardCategory(undefined)).toBe('other');
    });
});

describe('BoardError', () => {
    it('carries statusCode + code and is detectable', () => {
        const err = new BoardError('nope', 403, 'BOARD_FORBIDDEN');
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe('BOARD_FORBIDDEN');
        expect(isBoardError(err)).toBe(true);
        expect(isBoardError(new Error('plain'))).toBe(false);
    });
});

describe('createBoardAnnouncement', () => {
    it('creates with the fixed board scope + normalized category + default priority', async () => {
        await createBoardAnnouncement({ authorUserId: 'u1', title: 'Hi', body: 'Body', category: 'sale' });
        expect(createEntityMock).toHaveBeenCalledTimes(1);
        expect(createEntityMock).toHaveBeenCalledWith({
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:student-board',
            authorUserId: 'u1',
            payload: { title: 'Hi', body: 'Body', priority: 'low', category: 'sale', dealType: 'product', status: 'active' },
        });
    });

    it('coerces an unknown category to "other"', async () => {
        await createBoardAnnouncement({ authorUserId: 'u1', title: 'Hi', body: 'Body', category: 'weird' });
        const payload = createEntityMock.mock.calls[0][0].payload;
        expect(payload.category).toBe('other');
    });

    it('stores service-specific deal fields', async () => {
        await createBoardAnnouncement({
            authorUserId: 'u1',
            title: 'Help with math',
            body: 'Can explain limits',
            category: 'help',
            dealType: 'product',
            condition: 'new',
            serviceFormat: 'online',
            price: '2000 ₸',
        });
        const payload = createEntityMock.mock.calls[0][0].payload;
        expect(payload.dealType).toBe('service');
        expect(payload.serviceFormat).toBe('online');
        expect(payload.price).toBe('2000 ₸');
        expect(payload.condition).toBeUndefined();
    });

    it('stores event and lost-found category fields', async () => {
        await createBoardAnnouncement({
            authorUserId: 'u1',
            title: 'Meeting',
            body: 'Frontend club',
            category: 'event',
            dealType: 'product',
            price: '1000',
            serviceFormat: 'online',
            eventAt: '2026-06-10',
            location: 'Main hall',
        });
        let payload = createEntityMock.mock.calls[0][0].payload;
        expect(payload.dealType).toBe('other');
        expect(payload.price).toBeUndefined();
        expect(payload.serviceFormat).toBeUndefined();
        expect(payload.eventAt).toBe('2026-06-10T00:00:00.000Z');
        expect(payload.location).toBe('Main hall');

        createEntityMock.mockClear();
        await createBoardAnnouncement({
            authorUserId: 'u1',
            title: 'Lost card',
            body: 'Student card',
            category: 'lost_found',
            lostFoundType: 'lost',
        });
        payload = createEntityMock.mock.calls[0][0].payload;
        expect(payload.lostFoundType).toBe('lost');
    });

    it('rejects an empty title as a 400 BoardError', async () => {
        await expect(createBoardAnnouncement({ authorUserId: 'u1', title: '   ', body: 'Body' }))
            .rejects.toMatchObject({ statusCode: 400, code: 'BOARD_VALIDATION' });
        expect(createEntityMock).not.toHaveBeenCalled();
    });

    it('rejects a missing author as 400', async () => {
        await expect(createBoardAnnouncement({ authorUserId: '', title: 'Hi', body: 'Body' }))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('blocks a muted user with 403', async () => {
        isUserMutedMock.mockResolvedValue(true);
        await expect(createBoardAnnouncement({ authorUserId: 'u1', title: 'Hi', body: 'Body' }))
            .rejects.toMatchObject({ statusCode: 403, code: 'BOARD_MUTED' });
        expect(createEntityMock).not.toHaveBeenCalled();
    });

    it('still posts when the mute check itself throws (fail-open)', async () => {
        isUserMutedMock.mockRejectedValue(new Error('relation app_social_mute does not exist'));
        await expect(createBoardAnnouncement({ authorUserId: 'u1', title: 'Hi', body: 'Body' })).resolves.toBeDefined();
        expect(createEntityMock).toHaveBeenCalledTimes(1);
    });

    it('returns a minimal view if getEntityView resolves null', async () => {
        getEntityViewMock.mockResolvedValue(null);
        const view = await createBoardAnnouncement({ authorUserId: 'u1', title: 'Hi', body: 'Body' });
        expect(view.entity.id).toBe('e1');
        expect(view.reactions).toEqual([]);
    });

    it('attaches a resolved human author label', async () => {
        const view = await createBoardAnnouncement({ authorUserId: 'u1', title: 'Hi', body: 'Body' });
        expect(view.authorLabel).toBe('Test User');
    });

    it('falls back to the user id when name resolution fails', async () => {
        withPgMock.mockRejectedValueOnce(new Error('db down'));
        const view = await createBoardAnnouncement({ authorUserId: 'u1', title: 'Hi', body: 'Body' });
        expect(view.authorLabel).toBe('u1');
    });

    it('attaches the cover image file id from the first image attachment', async () => {
        const view = await createBoardAnnouncement({ authorUserId: 'u1', title: 'Hi', body: 'Body' });
        expect(view.coverFileId).toBe('file-1');
    });
});

describe('listBoardAnnouncements', () => {
    it('lists the board scope, announcement kind, pinned-first', async () => {
        const query = vi.fn().mockResolvedValue({ rows: [{ id: 'e1' }] });
        withPgMock.mockImplementationOnce(async (handler: (client: unknown) => unknown) => handler({ query }));
        await listBoardAnnouncements({ viewerUserId: 'u1', limit: 10, offset: 0 });
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toContain(`e.scope_type = $1`);
        expect(query.mock.calls[0][0]).toContain(`e.kind = 'announcement'`);
        expect(query.mock.calls[0][0]).toContain('order by e.pinned desc');
        expect(query.mock.calls[0][1]).toEqual(['announcement', 'announcement:student-board', 10, 0]);
        expect(getEntityViewMock).toHaveBeenCalledWith('e1', 'u1');
    });
});

describe('deleteBoardAnnouncement', () => {
    it('deletes own announcement via the owner path', async () => {
        await deleteBoardAnnouncement('e1', 'u1', false);
        expect(softDeleteMock).toHaveBeenCalledWith('e1', 'u1', undefined);
    });

    it('admin force-deletes when the owner check forbids', async () => {
        softDeleteMock.mockRejectedValue(new Error('forbidden'));
        await deleteBoardAnnouncement('e1', 'admin', true);
        // Falls back to a board-scoped direct query.
        expect(withPgMock).toHaveBeenCalled();
    });

    it('maps a forbidden non-admin delete to 403', async () => {
        softDeleteMock.mockRejectedValue(new Error('forbidden'));
        await expect(deleteBoardAnnouncement('e1', 'u2', false))
            .rejects.toMatchObject({ statusCode: 403 });
    });

    it('maps not-found to 404', async () => {
        softDeleteMock.mockRejectedValue(new Error('not found'));
        await expect(deleteBoardAnnouncement('missing', 'u1', false))
            .rejects.toMatchObject({ statusCode: 404 });
    });
});

describe('deleteAllBoardAnnouncements', () => {
    it('soft-deletes every live announcement in the board scope', async () => {
        const deleted = await deleteAllBoardAnnouncements('super-admin');
        expect(deleted).toBe(1);
        expect(withPgMock).toHaveBeenCalled();
    });

    it('requires an actor user id', async () => {
        await expect(deleteAllBoardAnnouncements('   '))
            .rejects.toMatchObject({ statusCode: 400, code: 'BOARD_VALIDATION' });
    });
});

describe('setBoardAnnouncementFavorite', () => {
    it('adds a favorite and returns the current count', async () => {
        const result = await setBoardAnnouncementFavorite('e1', 'u1', true);
        expect(result).toEqual({ isFavorite: true, favoriteCount: 0 });
        expect(withPgMock).toHaveBeenCalled();
    });

    it('rejects missing actor', async () => {
        await expect(setBoardAnnouncementFavorite('e1', '', true))
            .rejects.toMatchObject({ statusCode: 400, code: 'BOARD_VALIDATION' });
    });
});

describe('updateBoardAnnouncement', () => {
    it('rejects an empty patch as 400', async () => {
        await expect(updateBoardAnnouncement('e1', 'u1', {}, false))
            .rejects.toMatchObject({ statusCode: 400 });
    });

    it('updates own announcement title via the owner path', async () => {
        await updateBoardAnnouncement('e1', 'u1', { title: 'New' }, false);
        expect(updateMock).toHaveBeenCalledWith('e1', 'u1', { title: 'New' });
    });

    it('derives deal type from an updated category and drops incompatible category fields', async () => {
        await updateBoardAnnouncement('e1', 'u1', {
            category: 'event',
            dealType: 'product',
            price: '1000',
            condition: 'new',
            serviceFormat: 'online',
            eventAt: '2026-06-10',
        }, false);
        expect(updateMock).toHaveBeenCalledWith('e1', 'u1', {
            category: 'event',
            dealType: 'other',
            price: null,
            condition: null,
            serviceFormat: null,
            eventAt: '2026-06-10T00:00:00.000Z',
            lostFoundType: null,
        });
    });
});

describe('pinBoardAnnouncement', () => {
    it('pins via a board-scoped direct query', async () => {
        await pinBoardAnnouncement('e1', true);
        expect(withPgMock).toHaveBeenCalled();
    });
});
