import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { socialRoutes } from './social.js';
import * as socialService from '../services/social.js';
import * as socialUsersService from '../services/social-users.js';
import * as socialReadMarkersService from '../services/social-read-markers.js';
import * as socialNotificationsService from '../services/social-notifications.js';

// Mock the service entirely — these are route-layer tests. Behavioural tests
// for the service live in social-crud.test.ts.
vi.mock('../services/social.js', async (orig) => {
    const actual = await orig() as typeof socialService;
    return {
        ...actual,
        createEntity: vi.fn(),
        updateEntity: vi.fn(),
        softDeleteEntity: vi.fn(),
        restoreEntity: vi.fn(),
        pinEntity: vi.fn(),
        listEntitiesByScope: vi.fn(),
        getEntityView: vi.fn(),
        addComment: vi.fn(),
        listComments: vi.fn(),
        toggleReaction: vi.fn(),
        attachFile: vi.fn(),
        listAttachments: vi.fn(),
        removeAttachment: vi.fn(),
        searchSocialEntities: vi.fn(),
        listRevisions: vi.fn(),
    };
});

vi.mock('../services/social-users.js', async (orig) => {
    const actual = await orig() as typeof socialUsersService;
    return {
        ...actual,
        searchSocialUsers: vi.fn(),
    };
});

vi.mock('../services/social-read-markers.js', async (orig) => {
    const actual = await orig() as typeof socialReadMarkersService;
    return {
        ...actual,
        markScopeRead: vi.fn(),
        getUnreadCountsBatch: vi.fn(),
    };
});

vi.mock('../services/social-notifications.js', async (orig) => {
    const actual = await orig() as typeof socialNotificationsService;
    return {
        ...actual,
        listSocialNotifications: vi.fn(),
        markNotificationsRead: vi.fn(),
        markAllNotificationsRead: vi.fn(),
        getUnreadNotificationCount: vi.fn(),
    };
});

async function buildApp(userId: string) {
    const app = Fastify();
    app.decorate('authenticate', async (req: any) => {
        req.user = { userId };
    });
    await app.register(socialRoutes);
    return app;
}

function makeEntityView(overrides: Partial<any> = {}) {
    return {
        entity: {
            id: 'e1',
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'alice',
            payload: { title: 't', body: 'b' },
            pinned: false,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            deletedByUserId: null,
            deletedReason: null,
            ...((overrides.entity as object) || {}),
        },
        reactions: [],
        myReactions: [],
        commentCount: 0,
        attachmentCount: 0,
        isPinned: false,
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
});

// ============================================================================
// GET /social/scope/:scopeType/:scopeId/entities
// ============================================================================

describe('GET /social/scope/:scopeType/:scopeId/entities', () => {
    it('200 + list of entity views (happy path)', async () => {
        const view = makeEntityView();
        vi.mocked(socialService.listEntitiesByScope).mockResolvedValueOnce([view as any]);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'GET',
            url: '/social/scope/group/ITS-21/entities',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { entities: [view] } });
        expect(socialService.listEntitiesByScope).toHaveBeenCalledWith(
            'group',
            'group:ITS-21',
            expect.objectContaining({ viewerUserId: 'alice' }),
        );
    });

    it('200 + empty list when scope has no entities', async () => {
        vi.mocked(socialService.listEntitiesByScope).mockResolvedValueOnce([]);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'GET',
            url: '/social/scope/group/EMPTY/entities',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { entities: [] } });
    });

    it('400 when scopeType is invalid', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'GET',
            url: '/social/scope/banana/ITS-21/entities',
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialService.listEntitiesByScope).not.toHaveBeenCalled();
    });

    it('400 when limit exceeds the AJV cap (200)', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'GET',
            url: '/social/scope/group/ITS-21/entities?limit=999',
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
    });

    it('passes kind / limit / pinnedFirst through to the service', async () => {
        vi.mocked(socialService.listEntitiesByScope).mockResolvedValueOnce([]);
        const app = await buildApp('alice');
        await app.inject({
            method: 'GET',
            url: '/social/scope/group/ITS-21/entities?kind=task&limit=10&pinnedFirst=false',
        });
        expect(socialService.listEntitiesByScope).toHaveBeenCalledWith(
            'group',
            'group:ITS-21',
            expect.objectContaining({ kind: 'task', limit: 10, pinnedFirst: false }),
        );
    });
});

// ============================================================================
// GET /social/entities/:id
// ============================================================================

describe('GET /social/entities/:id', () => {
    it('200 + entity view (happy path)', async () => {
        const view = makeEntityView();
        vi.mocked(socialService.getEntityView).mockResolvedValueOnce(view as any);
        const app = await buildApp('alice');

        const res = await app.inject({ method: 'GET', url: '/social/entities/abc' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { entity: view } });
        expect(socialService.getEntityView).toHaveBeenCalledWith('abc', 'alice');
    });

    it('404 when entity is missing or soft-deleted', async () => {
        vi.mocked(socialService.getEntityView).mockResolvedValueOnce(null);
        const app = await buildApp('alice');

        const res = await app.inject({ method: 'GET', url: '/social/entities/missing' });
        expect(res.statusCode).toBe(404);
        expect(res.json().errorCode).toBe('SOCIAL_NOT_FOUND');
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialService.getEntityView).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/entities/abc' });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

// ============================================================================
// POST /social/entities
// ============================================================================

describe('POST /social/entities', () => {
    it('201 + entity view (happy path)', async () => {
        const created = { id: 'new-id' };
        const view = makeEntityView({ entity: { id: 'new-id' } });
        vi.mocked(socialService.createEntity).mockResolvedValueOnce(created as any);
        vi.mocked(socialService.getEntityView).mockResolvedValueOnce(view as any);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'POST',
            url: '/social/entities',
            payload: {
                kind: 'post',
                scopeType: 'group',
                scopeId: 'ITS-21',
                payload: { title: 'hi', body: 'hello world' },
            },
        });

        expect(res.statusCode).toBe(201);
        const body = res.json();
        expect(body.success).toBe(true);
        expect(body.data.id).toBe('new-id');
        expect(body.data.entity).toEqual(view);
        expect(socialService.createEntity).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: 'post',
                scopeType: 'group',
                scopeId: 'group:ITS-21',
                authorUserId: 'alice',
            }),
        );
    });

    it('400 AJV fail when payload field is missing entirely', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities',
            payload: { kind: 'post', scopeType: 'group', scopeId: 'ITS-21' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialService.createEntity).not.toHaveBeenCalled();
    });

    it('400 when payload body is empty (custom guard, not AJV)', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities',
            payload: {
                kind: 'post',
                scopeType: 'group',
                scopeId: 'ITS-21',
                payload: { body: '   ' }, // whitespace-only fails content guard
            },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_EMPTY');
        expect(socialService.createEntity).not.toHaveBeenCalled();
    });

    it('400 when kind is not in the allowed enum', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities',
            payload: {
                kind: 'made_up_kind',
                scopeType: 'group',
                scopeId: 'ITS-21',
                payload: { body: 'x' },
            },
        });
        expect(res.statusCode).toBe(400);
        expect(socialService.createEntity).not.toHaveBeenCalled();
    });

    it('maps service "is required" throw → 400 SOCIAL_VALIDATION_REQUIRED', async () => {
        vi.mocked(socialService.createEntity).mockRejectedValueOnce(new Error('authorUserId is required'));
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities',
            payload: {
                kind: 'post',
                scopeType: 'group',
                scopeId: 'ITS-21',
                payload: { body: 'hello' },
            },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
    });
});

// ============================================================================
// PATCH /social/entities/:id
// ============================================================================

describe('PATCH /social/entities/:id', () => {
    it('200 + updated view (happy path)', async () => {
        const view = makeEntityView();
        vi.mocked(socialService.updateEntity).mockResolvedValueOnce(view.entity as any);
        vi.mocked(socialService.getEntityView).mockResolvedValueOnce(view as any);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'PATCH',
            url: '/social/entities/e1',
            payload: { patch: { body: 'edited' } },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { entity: view } });
        expect(socialService.updateEntity).toHaveBeenCalledWith('e1', 'alice', { body: 'edited' });
    });

    it('403 when service throws "forbidden"', async () => {
        vi.mocked(socialService.updateEntity).mockRejectedValueOnce(new Error('forbidden'));
        const app = await buildApp('mallory');

        const res = await app.inject({
            method: 'PATCH',
            url: '/social/entities/e1',
            payload: { patch: { body: 'hax' } },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().errorCode).toBe('SOCIAL_FORBIDDEN');
    });

    it('404 when service throws "not found"', async () => {
        vi.mocked(socialService.updateEntity).mockRejectedValueOnce(new Error('not found'));
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'PATCH',
            url: '/social/entities/missing',
            payload: { patch: { body: 'x' } },
        });
        expect(res.statusCode).toBe(404);
        expect(res.json().errorCode).toBe('SOCIAL_NOT_FOUND');
    });

    it('400 when patch is missing or empty', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'PATCH',
            url: '/social/entities/e1',
            payload: { patch: {} },
        });
        expect(res.statusCode).toBe(400);
        expect(socialService.updateEntity).not.toHaveBeenCalled();
    });
});

// ============================================================================
// DELETE /social/entities/:id + restore
// ============================================================================

describe('DELETE /social/entities/:id', () => {
    it('204 on success and forwards reason to service', async () => {
        vi.mocked(socialService.softDeleteEntity).mockResolvedValueOnce(undefined);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'DELETE',
            url: '/social/entities/e1?reason=spam',
        });
        expect(res.statusCode).toBe(204);
        expect(socialService.softDeleteEntity).toHaveBeenCalledWith('e1', 'alice', 'spam');
    });

    it('403 when service throws "forbidden"', async () => {
        vi.mocked(socialService.softDeleteEntity).mockRejectedValueOnce(new Error('forbidden'));
        const app = await buildApp('mallory');
        const res = await app.inject({ method: 'DELETE', url: '/social/entities/e1' });
        expect(res.statusCode).toBe(403);
        expect(res.json().errorCode).toBe('SOCIAL_FORBIDDEN');
    });
});

describe('POST /social/entities/:id/restore', () => {
    it('204 on success', async () => {
        vi.mocked(socialService.restoreEntity).mockResolvedValueOnce(undefined);
        const app = await buildApp('alice');

        const res = await app.inject({ method: 'POST', url: '/social/entities/e1/restore' });
        expect(res.statusCode).toBe(204);
        expect(socialService.restoreEntity).toHaveBeenCalledWith('e1', 'alice');
    });

    it('404 when entity is unknown', async () => {
        vi.mocked(socialService.restoreEntity).mockRejectedValueOnce(new Error('not found'));
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'POST', url: '/social/entities/missing/restore' });
        expect(res.statusCode).toBe(404);
        expect(res.json().errorCode).toBe('SOCIAL_NOT_FOUND');
    });
});

// ============================================================================
// POST /social/entities/:id/pin
// ============================================================================

describe('POST /social/entities/:id/pin', () => {
    it('204 on pin=true', async () => {
        vi.mocked(socialService.pinEntity).mockResolvedValueOnce(undefined);
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/pin',
            payload: { pinned: true },
        });
        expect(res.statusCode).toBe(204);
        expect(socialService.pinEntity).toHaveBeenCalledWith('e1', 'alice', true);
    });

    it('400 when pinned flag is missing', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/pin',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
        expect(socialService.pinEntity).not.toHaveBeenCalled();
    });
});

// ============================================================================
// POST /social/entities/:id/comments
// ============================================================================

describe('GET /social/entities/:id/comments', () => {
    function makeComment(overrides: Partial<any> = {}) {
        return {
            id: 'c1',
            entityId: 'e1',
            parentCommentId: null,
            authorUserId: 'alice',
            body: 'hi',
            depth: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            ...overrides,
        };
    }

    it('200 + list of comments (happy path)', async () => {
        const c1 = makeComment({ id: 'c1', body: 'first' });
        const c2 = makeComment({ id: 'c2', body: 'second', createdAt: '2026-01-02T00:00:00.000Z' });
        vi.mocked(socialService.listComments).mockResolvedValueOnce([c1, c2] as any);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'GET',
            url: '/social/entities/e1/comments',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { comments: [c1, c2] } });
        expect(socialService.listComments).toHaveBeenCalledWith('e1', 'alice');
    });

    it('200 + empty array when entity has no comments (or does not exist)', async () => {
        vi.mocked(socialService.listComments).mockResolvedValueOnce([]);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'GET',
            url: '/social/entities/empty/comments',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { comments: [] } });
    });

    it('returns parent + reply ordered by createdAt asc', async () => {
        const parent = makeComment({ id: 'p1', body: 'parent', depth: 0 });
        const reply = makeComment({
            id: 'r1',
            body: 'reply',
            depth: 1,
            parentCommentId: 'p1',
            createdAt: '2026-01-01T00:00:01.000Z',
        });
        vi.mocked(socialService.listComments).mockResolvedValueOnce([parent, reply] as any);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'GET',
            url: '/social/entities/e1/comments',
        });
        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.data.comments).toHaveLength(2);
        expect(body.data.comments[0].id).toBe('p1');
        expect(body.data.comments[1].id).toBe('r1');
        expect(body.data.comments[1].parentCommentId).toBe('p1');
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialService.listComments).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'GET',
            url: '/social/entities/e1/comments',
        });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

// ============================================================================
// GET /social/entities/:id/revisions
// ============================================================================

describe('GET /social/entities/:id/revisions', () => {
    function makeRevision(overrides: Partial<any> = {}) {
        return {
            id: 'rev-1',
            entityId: 'e1',
            authorUserId: 'alice',
            snapshot: { body: 'hi' },
            revisionKind: 'update' as const,
            note: null,
            createdAt: '2026-01-01T00:00:00.000Z',
            ...overrides,
        };
    }

    it('200 + revision list (happy path)', async () => {
        const r1 = makeRevision({ id: 'rev-1', revisionKind: 'update', createdAt: '2026-01-02T00:00:00.000Z' });
        const r2 = makeRevision({ id: 'rev-2', revisionKind: 'create', createdAt: '2026-01-01T00:00:00.000Z' });
        vi.mocked(socialService.listRevisions).mockResolvedValueOnce([r1, r2] as any);
        const app = await buildApp('alice');

        const res = await app.inject({ method: 'GET', url: '/social/entities/e1/revisions' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { revisions: [r1, r2] } });
        expect(socialService.listRevisions).toHaveBeenCalledWith('e1', 'alice', undefined);
    });

    it('forwards the limit query param to the service', async () => {
        vi.mocked(socialService.listRevisions).mockResolvedValueOnce([]);
        const app = await buildApp('alice');
        await app.inject({ method: 'GET', url: '/social/entities/e1/revisions?limit=5' });
        expect(socialService.listRevisions).toHaveBeenCalledWith('e1', 'alice', { limit: 5 });
    });

    it('404 when service reports the entity is missing / soft-deleted / forbidden', async () => {
        vi.mocked(socialService.listRevisions).mockRejectedValueOnce(new Error('not found'));
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/entities/missing/revisions' });
        expect(res.statusCode).toBe(404);
        expect(res.json().errorCode).toBe('SOCIAL_NOT_FOUND');
    });

    it('400 when the limit query param exceeds the AJV cap', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/entities/e1/revisions?limit=9999' });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialService.listRevisions).not.toHaveBeenCalled();
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialService.listRevisions).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/entities/e1/revisions' });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

describe('POST /social/entities/:id/comments', () => {
    it('201 + new comment id (happy path)', async () => {
        vi.mocked(socialService.addComment).mockResolvedValueOnce({ id: 'c1' });
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/comments',
            payload: { body: 'hello' },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toEqual({ success: true, data: { id: 'c1' } });
        expect(socialService.addComment).toHaveBeenCalledWith('e1', 'alice', 'hello', undefined);
    });

    it('400 when service throws "comment depth limit"', async () => {
        vi.mocked(socialService.addComment).mockRejectedValueOnce(new Error('comment depth limit'));
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/comments',
            payload: { body: 'reply', parentCommentId: 'c0' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_COMMENT_DEPTH_LIMIT');
    });

    it('400 when comment body is empty (AJV minLength=1)', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/comments',
            payload: { body: '' },
        });
        expect(res.statusCode).toBe(400);
        expect(socialService.addComment).not.toHaveBeenCalled();
    });
});

// ============================================================================
// POST /social/entities/:id/reactions
// ============================================================================

describe('POST /social/entities/:id/reactions', () => {
    it('200 + aggregate (happy path)', async () => {
        vi.mocked(socialService.toggleReaction).mockResolvedValueOnce({
            added: true,
            reactions: [{ emoji: '👍', count: 1 }],
            mine: ['👍'],
        });
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/reactions',
            payload: { emoji: '👍' },
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            success: true,
            data: { added: true, reactions: [{ emoji: '👍', count: 1 }], mine: ['👍'] },
        });
    });

    it('400 when emoji is not in the allow-list (AJV enum)', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/reactions',
            payload: { emoji: '🚀' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_INVALID_EMOJI');
        expect(socialService.toggleReaction).not.toHaveBeenCalled();
    });

    it('400 when service throws "invalid emoji" (defence in depth)', async () => {
        vi.mocked(socialService.toggleReaction).mockRejectedValueOnce(new Error('invalid emoji'));
        const app = await buildApp('alice');
        // Use an allowed emoji to bypass AJV, then have the service reject it
        // — exercises the error-mapping path explicitly.
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/reactions',
            payload: { emoji: '🎉' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_INVALID_EMOJI');
    });
});

// ============================================================================
// POST /social/entities/:id/attachments
// ============================================================================

describe('POST /social/entities/:id/attachments', () => {
    it('201 + new attachment id (happy path)', async () => {
        vi.mocked(socialService.attachFile).mockResolvedValueOnce({ id: 'att-1' });
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/attachments',
            payload: { fileId: 'file-xyz', mime: 'image/png', sizeBytes: 1024, sortOrder: 0 },
        });
        expect(res.statusCode).toBe(201);
        expect(res.json()).toEqual({ success: true, data: { id: 'att-1' } });
        expect(socialService.attachFile).toHaveBeenCalledWith('e1', 'file-xyz', 'image/png', 1024, 0, 'alice');
    });

    it('400 when fileId is missing', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/attachments',
            payload: { mime: 'image/png' },
        });
        expect(res.statusCode).toBe(400);
        expect(socialService.attachFile).not.toHaveBeenCalled();
    });
});

// ============================================================================
// GET /social/entities/:id/attachments
// ============================================================================

describe('GET /social/entities/:id/attachments', () => {
    function makeAttachment(overrides: Partial<any> = {}) {
        return {
            id: 'att-1',
            entityId: 'e1',
            fileId: 'file-xyz',
            mime: 'image/png',
            sizeBytes: 1024,
            sortOrder: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            ...overrides,
        };
    }

    it('200 + list of attachments (happy path)', async () => {
        const a1 = makeAttachment({ id: 'att-1', fileId: 'file-1', sortOrder: 0 });
        const a2 = makeAttachment({ id: 'att-2', fileId: 'file-2', sortOrder: 1 });
        vi.mocked(socialService.listAttachments).mockResolvedValueOnce([a1, a2] as any);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'GET',
            url: '/social/entities/e1/attachments',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { attachments: [a1, a2] } });
        expect(socialService.listAttachments).toHaveBeenCalledWith('e1', 'alice');
    });

    it('200 + empty array when entity has no attachments', async () => {
        vi.mocked(socialService.listAttachments).mockResolvedValueOnce([]);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'GET',
            url: '/social/entities/empty/attachments',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { attachments: [] } });
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialService.listAttachments).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'GET',
            url: '/social/entities/e1/attachments',
        });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

// ============================================================================
// DELETE /social/entities/:id/attachments/:attachmentId
// ============================================================================

describe('DELETE /social/entities/:id/attachments/:attachmentId', () => {
    it('204 on success and forwards actor userId', async () => {
        vi.mocked(socialService.removeAttachment).mockResolvedValueOnce(undefined);
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'DELETE',
            url: '/social/entities/e1/attachments/att-1',
        });
        expect(res.statusCode).toBe(204);
        expect(socialService.removeAttachment).toHaveBeenCalledWith('att-1', 'alice');
    });

    it('403 when service throws "forbidden"', async () => {
        vi.mocked(socialService.removeAttachment).mockRejectedValueOnce(new Error('forbidden'));
        const app = await buildApp('mallory');

        const res = await app.inject({
            method: 'DELETE',
            url: '/social/entities/e1/attachments/att-1',
        });
        expect(res.statusCode).toBe(403);
        expect(res.json().errorCode).toBe('SOCIAL_FORBIDDEN');
    });

    it('404 when the attachment is missing', async () => {
        vi.mocked(socialService.removeAttachment).mockRejectedValueOnce(new Error('not found'));
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'DELETE',
            url: '/social/entities/e1/attachments/missing',
        });
        expect(res.statusCode).toBe(404);
        expect(res.json().errorCode).toBe('SOCIAL_NOT_FOUND');
    });
});

// ============================================================================
// GET /social/users/search
// ============================================================================

describe('GET /social/users/search', () => {
    it('200 + user list (happy path)', async () => {
        vi.mocked(socialUsersService.searchSocialUsers).mockResolvedValueOnce([
            { userId: 'alice', displayName: 'Alice C.' },
            { userId: 'alex' },
        ]);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=group:ITS-21&q=al',
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            success: true,
            data: {
                users: [
                    { userId: 'alice', displayName: 'Alice C.' },
                    { userId: 'alex' },
                ],
            },
        });
        expect(socialUsersService.searchSocialUsers).toHaveBeenCalledWith(
            'group:ITS-21',
            'al',
            'viewer',
            undefined,
        );
    });

    it('200 + [] when no candidates match', async () => {
        vi.mocked(socialUsersService.searchSocialUsers).mockResolvedValueOnce([]);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=group:EMPTY&q=zz',
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { users: [] } });
    });

    it('passes limit through to the service when supplied', async () => {
        vi.mocked(socialUsersService.searchSocialUsers).mockResolvedValueOnce([]);
        const app = await buildApp('viewer');

        await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=group:ITS-21&q=al&limit=5',
        });
        expect(socialUsersService.searchSocialUsers).toHaveBeenCalledWith(
            'group:ITS-21',
            'al',
            'viewer',
            5,
        );
    });

    it('400 when scope is missing', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?q=al',
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialUsersService.searchSocialUsers).not.toHaveBeenCalled();
    });

    it('400 when q is missing', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=group:ITS-21',
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
    });

    it('400 when q is empty string', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=group:ITS-21&q=',
        });
        expect(res.statusCode).toBe(400);
    });

    it('400 when limit exceeds the cap', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=group:ITS-21&q=al&limit=999',
        });
        expect(res.statusCode).toBe(400);
    });

    it('400 when limit is fractional', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=group:ITS-21&q=al&limit=2.5',
        });
        expect(res.statusCode).toBe(400);
    });

    it('500 when the service throws unexpectedly', async () => {
        vi.mocked(socialUsersService.searchSocialUsers).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=group:ITS-21&q=al',
        });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });

    it('returns [] from the service for unknown scope types (no global directory)', async () => {
        vi.mocked(socialUsersService.searchSocialUsers).mockResolvedValueOnce([]);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/users/search?scope=global:chat&q=al',
        });
        // Service decides — route just forwards. The route does NOT 400 on the
        // scope shape because the service is the single source of truth for
        // scope semantics (and may broaden them later without route churn).
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { users: [] } });
    });
});

// ============================================================================
// POST /social/read — mark scope as read
// ============================================================================

describe('POST /social/read', () => {
    it('204 + forwards (userId, scopeType, scopeId, lastEntityId) to the service', async () => {
        vi.mocked(socialReadMarkersService.markScopeRead).mockResolvedValueOnce(undefined);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'POST',
            url: '/social/read',
            payload: { scopeType: 'dm', scopeId: 'room-1', lastEntityId: 'entity-99' },
        });

        expect(res.statusCode).toBe(204);
        expect(socialReadMarkersService.markScopeRead).toHaveBeenCalledWith(
            'viewer',
            'dm',
            'room-1',
            'entity-99',
        );
    });

    it('204 even when lastEntityId is omitted', async () => {
        vi.mocked(socialReadMarkersService.markScopeRead).mockResolvedValueOnce(undefined);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'POST',
            url: '/social/read',
            payload: { scopeType: 'dm', scopeId: 'room-1' },
        });

        expect(res.statusCode).toBe(204);
        expect(socialReadMarkersService.markScopeRead).toHaveBeenCalledWith(
            'viewer',
            'dm',
            'room-1',
            undefined,
        );
    });

    it('400 when scopeType is missing', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'POST',
            url: '/social/read',
            payload: { scopeId: 'room-1' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialReadMarkersService.markScopeRead).not.toHaveBeenCalled();
    });

    it('400 when scopeType is not in the allowed enum', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'POST',
            url: '/social/read',
            payload: { scopeType: 'bogus', scopeId: 'room-1' },
        });
        expect(res.statusCode).toBe(400);
        expect(socialReadMarkersService.markScopeRead).not.toHaveBeenCalled();
    });

    it('500 SOCIAL_INTERNAL_ERROR on service throw', async () => {
        vi.mocked(socialReadMarkersService.markScopeRead).mockRejectedValueOnce(
            new Error('boom'),
        );
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'POST',
            url: '/social/read',
            payload: { scopeType: 'dm', scopeId: 'room-1' },
        });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

// ============================================================================
// GET /social/unread — batched unread counts
// ============================================================================

describe('GET /social/unread', () => {
    it('200 + counts map (happy path)', async () => {
        vi.mocked(socialReadMarkersService.getUnreadCountsBatch).mockResolvedValueOnce(
            new Map([
                ['dm:r1', 3],
                ['dm:r2', 1],
            ]),
        );
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/unread?scopes=dm:r1,dm:r2,dm:r3',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            success: true,
            data: { counts: { 'dm:r1': 3, 'dm:r2': 1 } },
        });
        // De-dup happens server-side: the service receives the unique scope list.
        expect(socialReadMarkersService.getUnreadCountsBatch).toHaveBeenCalledWith(
            'viewer',
            ['dm:r1', 'dm:r2', 'dm:r3'],
        );
    });

    it('200 + empty counts when nothing is unread', async () => {
        vi.mocked(socialReadMarkersService.getUnreadCountsBatch).mockResolvedValueOnce(
            new Map(),
        );
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/unread?scopes=dm:r1',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { counts: {} } });
    });

    it('de-duplicates the scopes querystring before calling the service', async () => {
        vi.mocked(socialReadMarkersService.getUnreadCountsBatch).mockResolvedValueOnce(
            new Map(),
        );
        const app = await buildApp('viewer');

        await app.inject({
            method: 'GET',
            url: '/social/unread?scopes=dm:r1,dm:r1,dm:r2',
        });

        expect(socialReadMarkersService.getUnreadCountsBatch).toHaveBeenCalledWith(
            'viewer',
            ['dm:r1', 'dm:r2'],
        );
    });

    it('400 when scopes parameter is missing', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'GET',
            url: '/social/unread',
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialReadMarkersService.getUnreadCountsBatch).not.toHaveBeenCalled();
    });

    it('500 on service throw maps to SOCIAL_INTERNAL_ERROR', async () => {
        vi.mocked(socialReadMarkersService.getUnreadCountsBatch).mockRejectedValueOnce(
            new Error('infra down'),
        );
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/unread?scopes=dm:r1',
        });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

// ============================================================================
// GET /social/search — universal text search
// ============================================================================

describe('GET /social/search', () => {
    it('200 + results envelope (happy path)', async () => {
        const view = makeEntityView({ entity: { id: 'hit-1', payload: { body: 'math notes' } } });
        vi.mocked(socialService.searchSocialEntities).mockResolvedValueOnce({
            results: [view as any],
            total: 1,
        });
        const app = await buildApp('alice');

        const res = await app.inject({
            method: 'GET',
            url: '/social/search?q=math',
        });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
            success: true,
            data: { results: [view], total: 1 },
        });
        expect(socialService.searchSocialEntities).toHaveBeenCalledWith(
            'math',
            expect.objectContaining({ viewerUserId: 'alice' }),
        );
    });

    it('parses comma-separated scope + kind filters into typed arrays', async () => {
        vi.mocked(socialService.searchSocialEntities).mockResolvedValueOnce({
            results: [],
            total: 0,
        });
        const app = await buildApp('alice');

        await app.inject({
            method: 'GET',
            url: '/social/search?q=math&scopes=group,dm&kinds=post,task',
        });
        expect(socialService.searchSocialEntities).toHaveBeenCalledWith(
            'math',
            expect.objectContaining({
                scopes: ['group', 'dm'],
                kinds: ['post', 'task'],
            }),
        );
    });

    it('drops unknown scope/kind tokens silently', async () => {
        vi.mocked(socialService.searchSocialEntities).mockResolvedValueOnce({
            results: [],
            total: 0,
        });
        const app = await buildApp('alice');

        await app.inject({
            method: 'GET',
            url: '/social/search?q=math&scopes=group,banana&kinds=post,not_a_kind',
        });
        expect(socialService.searchSocialEntities).toHaveBeenCalledWith(
            'math',
            expect.objectContaining({
                scopes: ['group'],
                kinds: ['post'],
            }),
        );
    });

    it('400 when q is missing entirely', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/search' });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialService.searchSocialEntities).not.toHaveBeenCalled();
    });

    it('400 when q is shorter than the AJV minLength (1 char)', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/search?q=a' });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialService.searchSocialEntities).not.toHaveBeenCalled();
    });

    it('400 when limit exceeds the AJV cap', async () => {
        const app = await buildApp('alice');
        const res = await app.inject({
            method: 'GET',
            url: '/social/search?q=math&limit=999',
        });
        expect(res.statusCode).toBe(400);
    });

    it('maps service "query too short" throw → 400 SOCIAL_VALIDATION_TOO_SHORT', async () => {
        vi.mocked(socialService.searchSocialEntities).mockRejectedValueOnce(
            new Error('query too short'),
        );
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/search?q=hi' });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_TOO_SHORT');
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialService.searchSocialEntities).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('alice');
        const res = await app.inject({ method: 'GET', url: '/social/search?q=math' });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

// ============================================================================
// Notification Center routes
// ============================================================================

function makeNotification(overrides: Partial<any> = {}) {
    return {
        id: 'n-1',
        kind: 'mention',
        sourceKind: 'entity',
        sourceEntityId: 'e-1',
        entityId: 'e-1',
        actorUserId: 'alice',
        summary: 'hi',
        scopeType: 'group',
        scopeId: 'group:ITS-21',
        entityKind: 'post',
        createdAt: '2026-05-20T12:00:00.000Z',
        readAt: null,
        ...overrides,
    };
}

describe('GET /social/notifications', () => {
    it('200 + notifications list (happy path)', async () => {
        const n = makeNotification();
        vi.mocked(socialNotificationsService.listSocialNotifications).mockResolvedValueOnce([n as any]);
        const app = await buildApp('viewer');

        const res = await app.inject({ method: 'GET', url: '/social/notifications' });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { notifications: [n] } });
        expect(socialNotificationsService.listSocialNotifications).toHaveBeenCalledWith(
            'viewer',
            expect.objectContaining({}),
        );
    });

    it('forwards limit / before / unreadOnly to the service', async () => {
        vi.mocked(socialNotificationsService.listSocialNotifications).mockResolvedValueOnce([]);
        const app = await buildApp('viewer');

        await app.inject({
            method: 'GET',
            url: '/social/notifications?limit=5&before=2026-05-20T00:00:00.000Z&unreadOnly=true',
        });
        expect(socialNotificationsService.listSocialNotifications).toHaveBeenCalledWith(
            'viewer',
            expect.objectContaining({
                limit: 5,
                before: '2026-05-20T00:00:00.000Z',
                unreadOnly: true,
            }),
        );
    });

    it('400 when limit exceeds the AJV cap', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'GET',
            url: '/social/notifications?limit=9999',
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialNotificationsService.listSocialNotifications).not.toHaveBeenCalled();
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialNotificationsService.listSocialNotifications).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('viewer');
        const res = await app.inject({ method: 'GET', url: '/social/notifications' });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

describe('POST /social/notifications/read', () => {
    it('204 on success (forwards ids to service)', async () => {
        vi.mocked(socialNotificationsService.markNotificationsRead).mockResolvedValueOnce(undefined);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'POST',
            url: '/social/notifications/read',
            payload: { ids: ['n-1', 'n-2'] },
        });
        expect(res.statusCode).toBe(204);
        expect(socialNotificationsService.markNotificationsRead).toHaveBeenCalledWith(
            'viewer',
            ['n-1', 'n-2'],
        );
    });

    it('400 when ids is missing', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'POST',
            url: '/social/notifications/read',
            payload: {},
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().errorCode).toBe('SOCIAL_VALIDATION_REQUIRED');
        expect(socialNotificationsService.markNotificationsRead).not.toHaveBeenCalled();
    });

    it('400 when ids is empty', async () => {
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'POST',
            url: '/social/notifications/read',
            payload: { ids: [] },
        });
        expect(res.statusCode).toBe(400);
        expect(socialNotificationsService.markNotificationsRead).not.toHaveBeenCalled();
    });

    it('400 when ids exceeds the AJV max items cap', async () => {
        const app = await buildApp('viewer');
        const ids = Array.from({ length: 250 }, (_, i) => `n-${i}`);
        const res = await app.inject({
            method: 'POST',
            url: '/social/notifications/read',
            payload: { ids },
        });
        expect(res.statusCode).toBe(400);
        expect(socialNotificationsService.markNotificationsRead).not.toHaveBeenCalled();
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialNotificationsService.markNotificationsRead).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'POST',
            url: '/social/notifications/read',
            payload: { ids: ['n-1'] },
        });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

describe('POST /social/notifications/read-all', () => {
    it('204 on success', async () => {
        vi.mocked(socialNotificationsService.markAllNotificationsRead).mockResolvedValueOnce(undefined);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'POST',
            url: '/social/notifications/read-all',
        });
        expect(res.statusCode).toBe(204);
        expect(socialNotificationsService.markAllNotificationsRead).toHaveBeenCalledWith('viewer');
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialNotificationsService.markAllNotificationsRead).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'POST',
            url: '/social/notifications/read-all',
        });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

describe('GET /social/notifications/unread-count', () => {
    it('200 + count (happy path)', async () => {
        vi.mocked(socialNotificationsService.getUnreadNotificationCount).mockResolvedValueOnce(7);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/notifications/unread-count',
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { count: 7 } });
        expect(socialNotificationsService.getUnreadNotificationCount).toHaveBeenCalledWith('viewer');
    });

    it('200 + zero when there is nothing unread', async () => {
        vi.mocked(socialNotificationsService.getUnreadNotificationCount).mockResolvedValueOnce(0);
        const app = await buildApp('viewer');

        const res = await app.inject({
            method: 'GET',
            url: '/social/notifications/unread-count',
        });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ success: true, data: { count: 0 } });
    });

    it('500 on unexpected service throw', async () => {
        vi.mocked(socialNotificationsService.getUnreadNotificationCount).mockRejectedValueOnce(new Error('boom'));
        const app = await buildApp('viewer');
        const res = await app.inject({
            method: 'GET',
            url: '/social/notifications/unread-count',
        });
        expect(res.statusCode).toBe(500);
        expect(res.json().errorCode).toBe('SOCIAL_INTERNAL_ERROR');
    });
});

// ---------------------------------------------------------------------------
// Per-user write throttles
//
// `services/social-moderation.ts` states that report idempotency is deliberately
// NOT enforced in the service and that throttling belongs to the route layer.
// The same `consumeRateLimit` helper (utils/rateLimit.ts) that guards
// board-post / global-chat-post now guards entity creation, comments and
// reports. Buckets are keyed per user, so each test below uses its own id to
// stay independent of the rest of the file.
// ---------------------------------------------------------------------------

describe('write throttles', () => {
    const createPayload = {
        kind: 'post',
        scopeType: 'group',
        scopeId: 'ITS-21',
        payload: { body: 'hello' },
    };

    it('429s entity creation past the per-user budget and keeps the envelope shape', async () => {
        vi.mocked(socialService.createEntity).mockResolvedValue({ id: 'e1', pinned: false } as any);
        vi.mocked(socialService.getEntityView).mockResolvedValue(makeEntityView() as any);
        const app = await buildApp('rl-create-user');

        // Default budget is 30 per 60s.
        for (let i = 0; i < 30; i += 1) {
            const ok = await app.inject({
                method: 'POST',
                url: '/social/entities',
                payload: createPayload,
            });
            expect(ok.statusCode).toBe(201);
        }

        const blocked = await app.inject({
            method: 'POST',
            url: '/social/entities',
            payload: createPayload,
        });
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json().errorCode).toBe('SOCIAL_RATE_LIMITED');
        expect(blocked.headers['retry-after']).toBeDefined();
    });

    it('429s comments past the per-user budget without calling the service again', async () => {
        vi.mocked(socialService.addComment).mockResolvedValue({ id: 'c1' });
        const app = await buildApp('rl-comment-user');

        // Default budget is 20 per 60s.
        for (let i = 0; i < 20; i += 1) {
            const ok = await app.inject({
                method: 'POST',
                url: '/social/entities/e1/comments',
                payload: { body: 'hi' },
            });
            expect(ok.statusCode).toBe(201);
        }
        const callsBefore = vi.mocked(socialService.addComment).mock.calls.length;

        const blocked = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/comments',
            payload: { body: 'hi' },
        });
        expect(blocked.statusCode).toBe(429);
        expect(blocked.json().errorCode).toBe('SOCIAL_RATE_LIMITED');
        expect(vi.mocked(socialService.addComment).mock.calls.length).toBe(callsBefore);
    });

    it('leaves a different user unaffected (buckets are per user)', async () => {
        vi.mocked(socialService.addComment).mockResolvedValue({ id: 'c2' });
        const app = await buildApp('rl-other-user');
        const res = await app.inject({
            method: 'POST',
            url: '/social/entities/e1/comments',
            payload: { body: 'hi' },
        });
        expect(res.statusCode).toBe(201);
    });
});
