import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SocialComment, SocialEntity } from '../types/social.js';

// === Mocks ===================================================================

// Postgres mock: a tiny in-memory store that captures the SQL paths
// exercised by social-events.ts. New paths added in this expansion:
//   - SELECT distinct user_id FROM app_group_memberships  (group fan-out)
//   - SELECT distinct user_id FROM app_push_subscriptions (critical broadcast)
//   - SELECT author_user_id FROM app_social_comment ...   (comment fan-out)
interface MentionRow {
    entity_id: string;
    source_kind: 'entity' | 'comment';
    source_id: string;
    author_user_id: string;
    mentioned_user_id: string;
}

interface MembershipRow {
    user_id: string;
    group_key: string;
    active: boolean;
}

interface SocialCommentRow {
    id: string;
    entity_id: string;
    author_user_id: string;
}

interface PushSubscriptionRow {
    user_id: string;
}

const mentions: MentionRow[] = [];
const memberships: MembershipRow[] = [];
const socialComments: SocialCommentRow[] = [];
const pushSubscribers: PushSubscriptionRow[] = [];

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            // selectMentions
            if (text.startsWith('select entity_id::text as entity_id,')) {
                const [sourceKind, sourceId] = params as [string, string];
                const rows = mentions
                    .filter((m) => m.source_kind === sourceKind && m.source_id === sourceId)
                    .map((m) => ({
                        entity_id: m.entity_id,
                        source_kind: m.source_kind,
                        source_id: m.source_id,
                        author_user_id: m.author_user_id,
                        mentioned_user_id: m.mentioned_user_id,
                    }));
                return { rows, rowCount: rows.length };
            }

            // ensureDmNotificationRow
            if (text.startsWith('insert into app_social_mention')
                && text.includes('where not exists')) {
                const [entityId, authorUserId, mentionedUserId] = params as [string, string, string];
                const exists = mentions.some((m) =>
                    m.entity_id === entityId
                    && m.source_kind === 'entity'
                    && m.source_id === entityId
                    && m.mentioned_user_id === mentionedUserId
                );
                if (!exists) {
                    mentions.push({
                        entity_id: entityId,
                        source_kind: 'entity',
                        source_id: entityId,
                        author_user_id: authorUserId,
                        mentioned_user_id: mentionedUserId,
                    });
                    return { rows: [], rowCount: 1 };
                }
                return { rows: [], rowCount: 0 };
            }

            // resolveGroupMembers
            if (text.startsWith('select distinct user_id\n                    from app_group_memberships')
                || (text.includes('app_group_memberships') && text.includes('distinct user_id'))) {
                const [groupKey] = params as [string];
                const rows = memberships
                    .filter((m) => m.group_key === groupKey && m.active)
                    .map((m) => ({ user_id: m.user_id }));
                return { rows, rowCount: rows.length };
            }

            // resolveAnnouncementRecipients broadcast path
            if (text.startsWith('select distinct user_id from app_push_subscriptions')) {
                const rows = pushSubscribers.map((p) => ({ user_id: p.user_id }));
                return { rows, rowCount: rows.length };
            }

            // resolveCommentRecipients parent-comment lookup
            if (text.startsWith('select author_user_id') && text.includes('app_social_comment')) {
                const [commentId] = params as [string];
                const found = socialComments.find((c) => c.id === commentId);
                if (!found) return { rows: [], rowCount: 0 };
                return { rows: [{ author_user_id: found.author_user_id }], rowCount: 1 };
            }

            throw new Error(`Unmocked SQL: ${sql}`);
        }),
    };
}

const fakeClient = makeClient();

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

// Push.ts mock: track every call so individual tests can assert the fan-out
// shape (recipient count, payload contents, expired cleanup, idempotency).
const sendPushNotification = vi.fn(async () => ({ ok: true, expired: false }));
const getUserSubscriptions = vi.fn(async (userId: string) => [
    {
        id: 1,
        userId,
        endpoint: `https://push.example/${userId}`,
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
        createdAt: new Date(),
        lastSeenAt: new Date(),
    },
]);
const recordSend = vi.fn(async () => true);
const hasBeenSent = vi.fn(async () => false);
const deleteSubscription = vi.fn(async () => true);
const isPushConfiguredMock = vi.fn(() => true);

vi.mock('./push.js', () => ({
    sendPushNotification: (...args: unknown[]) => sendPushNotification(...args as [never, never]),
    getUserSubscriptions: (...args: unknown[]) => getUserSubscriptions(...args as [string]),
    recordSend: (...args: unknown[]) => recordSend(...args as [never, never, never, never]),
    hasBeenSent: (...args: unknown[]) => hasBeenSent(...args as [never, never, never]),
    deleteSubscription: (...args: unknown[]) => deleteSubscription(...args as [never, never]),
    isPushConfigured: () => isPushConfiguredMock(),
}));

// Per-kind notification preferences gate. Default-on across every existing
// test path; individual tests in the "opt-out gate" suite below override the
// mock per-case to exercise the skip behavior.
const isPushKindEnabledForUserMock = vi.fn(async () => true);
vi.mock('./notification-prefs.js', () => ({
    isPushKindEnabledForUser: (...args: unknown[]) =>
        isPushKindEnabledForUserMock(...args as [string, string]),
}));

import {
    buildAnnouncementPayload,
    buildCommentPayload,
    buildDmPayload,
    buildGroupPostPayload,
    buildMentionFingerprint,
    buildMentionPayload,
    deliverMentionToUser,
    deliverPushToUser,
    ensureDmNotificationRow,
    onAnnouncementCreated,
    onCommentCreated,
    onEntityCreated,
    onGroupPostCreated,
    onSocialDmCreated,
    resolveAnnouncementRecipients,
    resolveCommentRecipients,
    resolveDmParticipants,
    resolveGroupMembers,
    __testing,
} from './social-events.js';

// === Helpers =================================================================

function makeEntity(overrides?: Partial<SocialEntity>): SocialEntity {
    const now = new Date().toISOString();
    return {
        id: 'entity-1',
        kind: 'post',
        scopeType: 'group',
        scopeId: 'group:ITS-21',
        authorUserId: 'author-1',
        payload: { body: 'hello @alice and @bob' },
        pinned: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByUserId: null,
        deletedReason: null,
        ...overrides,
    };
}

function makeDmEntity(overrides?: Partial<SocialEntity<'dm_message'>>): SocialEntity<'dm_message'> {
    const now = new Date().toISOString();
    return {
        id: 'dm-1',
        kind: 'dm_message',
        scopeType: 'dm',
        scopeId: 'dm:direct:alice::bob',
        authorUserId: 'alice',
        payload: { body: 'hey there' },
        pinned: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByUserId: null,
        deletedReason: null,
        ...overrides,
    };
}

function makeAnnouncementEntity(
    overrides?: Partial<SocialEntity<'announcement'>>,
): SocialEntity<'announcement'> {
    const now = new Date().toISOString();
    return {
        id: 'ann-1',
        kind: 'announcement',
        scopeType: 'announcement',
        scopeId: 'announcement:global',
        authorUserId: 'coordinator-1',
        payload: { title: 'Heads up', body: 'Something is happening', priority: 'medium' },
        pinned: false,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        deletedByUserId: null,
        deletedReason: null,
        ...overrides,
    };
}

function makeComment(overrides?: Partial<SocialComment>): SocialComment {
    const now = new Date().toISOString();
    return {
        id: 'comment-1',
        entityId: 'entity-1',
        parentCommentId: null,
        authorUserId: 'commenter-1',
        body: 'ping @alice',
        depth: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        ...overrides,
    };
}

beforeEach(() => {
    mentions.length = 0;
    memberships.length = 0;
    socialComments.length = 0;
    pushSubscribers.length = 0;
    sendPushNotification.mockClear();
    getUserSubscriptions.mockClear();
    recordSend.mockClear();
    hasBeenSent.mockClear();
    deleteSubscription.mockClear();
    isPushConfiguredMock.mockClear();
    isPushConfiguredMock.mockReturnValue(true);
    isPushKindEnabledForUserMock.mockClear();
    isPushKindEnabledForUserMock.mockImplementation(async () => true);
    sendPushNotification.mockImplementation(async () => ({ ok: true, expired: false }));
    hasBeenSent.mockImplementation(async () => false);
    getUserSubscriptions.mockImplementation(async (userId: string) => [
        {
            id: 1,
            userId,
            endpoint: `https://push.example/${userId}`,
            p256dh: 'p',
            auth: 'a',
            userAgent: null,
            createdAt: new Date(),
            lastSeenAt: new Date(),
        },
    ]);
});

// === Pure helpers ============================================================

describe('buildMentionFingerprint', () => {
    it('composes a stable per-(source, recipient) fingerprint', () => {
        const fp = buildMentionFingerprint({
            sourceKind: 'comment',
            sourceId: 'c-1',
            mentionedUserId: 'alice',
        });
        expect(fp).toBe('comment:c-1:alice');
    });

    it('distinguishes recipients on the same source', () => {
        const a = buildMentionFingerprint({ sourceKind: 'entity', sourceId: 'e-1', mentionedUserId: 'alice' });
        const b = buildMentionFingerprint({ sourceKind: 'entity', sourceId: 'e-1', mentionedUserId: 'bob' });
        expect(a).not.toBe(b);
    });
});

describe('buildMentionPayload', () => {
    it('includes title, author handle in body, and entity metadata in data', () => {
        const entity = makeEntity({ kind: 'post', authorUserId: 'author-1', id: 'e-9' });
        const payload = buildMentionPayload({
            authorUserId: 'author-1',
            entity,
            sourceKind: 'entity',
            sourceId: 'e-9',
        });
        expect(payload.title).toBe('Вас упомянули');
        expect(String(payload.body)).toContain('@author-1');
        expect(String(payload.body)).toContain('посте');
        const data = payload.data as Record<string, unknown>;
        expect(data.entityId).toBe('e-9');
        expect(data.scopeType).toBe('group');
        expect(data.scopeId).toBe('group:ITS-21');
        expect(data.sourceKind).toBe('entity');
        expect(data.sourceId).toBe('e-9');
        expect(payload.tag).toBe('social-mention-entity-e-9');
    });

    it('localizes the entity-kind label (task)', () => {
        const entity = makeEntity({ kind: 'task' });
        const payload = buildMentionPayload({
            authorUserId: 'u',
            entity,
            sourceKind: 'comment',
            sourceId: 'c-1',
        });
        expect(String(payload.body)).toContain('задаче');
    });

    it('uses comment source kind in the tag for comment mentions', () => {
        const entity = makeEntity();
        const payload = buildMentionPayload({
            authorUserId: 'u',
            entity,
            sourceKind: 'comment',
            sourceId: 'c-42',
        });
        expect(payload.tag).toBe('social-mention-comment-c-42');
    });
});

describe('snippet helper', () => {
    it('returns short bodies untouched', () => {
        expect(__testing.snippet('hi')).toBe('hi');
    });

    it('trims surrounding whitespace before measuring length', () => {
        expect(__testing.snippet('   hi   ')).toBe('hi');
    });

    it('caps overly-long bodies and appends an ellipsis', () => {
        const long = 'x'.repeat(200);
        const out = __testing.snippet(long);
        expect(out.length).toBe(80);
        expect(out.endsWith('…')).toBe(true);
    });

    it('returns empty string for non-strings', () => {
        expect(__testing.snippet(undefined)).toBe('');
        expect(__testing.snippet(42)).toBe('');
    });
});

// === Delivery primitive ======================================================

describe('deliverMentionToUser', () => {
    it('reports duplicate when hasBeenSent is true and skips push', async () => {
        hasBeenSent.mockResolvedValueOnce(true);
        const result = await deliverMentionToUser(
            {
                mentionedUserId: 'alice',
                authorUserId: 'author-1',
                sourceKind: 'entity',
                sourceId: 'e-1',
                entityId: 'e-1',
            },
            buildMentionPayload({
                authorUserId: 'author-1',
                entity: makeEntity(),
                sourceKind: 'entity',
                sourceId: 'e-1',
            }),
        );
        expect(result).toBe('duplicate');
        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
    });

    it('records no_subscriptions when the user has no devices', async () => {
        getUserSubscriptions.mockResolvedValueOnce([]);
        const result = await deliverMentionToUser(
            {
                mentionedUserId: 'alice',
                authorUserId: 'author-1',
                sourceKind: 'entity',
                sourceId: 'e-1',
                entityId: 'e-1',
            },
            buildMentionPayload({
                authorUserId: 'author-1',
                entity: makeEntity(),
                sourceKind: 'entity',
                sourceId: 'e-1',
            }),
        );
        expect(result).toBe('no_subscriptions');
        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(recordSend).toHaveBeenCalledWith('alice', 'entity:e-1:alice', 'social_mention', 'no_subscriptions');
    });

    it('deletes expired subscriptions and reports failed when none deliver', async () => {
        sendPushNotification.mockResolvedValueOnce({ ok: false, expired: true });
        const result = await deliverMentionToUser(
            {
                mentionedUserId: 'alice',
                authorUserId: 'author-1',
                sourceKind: 'entity',
                sourceId: 'e-1',
                entityId: 'e-1',
            },
            buildMentionPayload({
                authorUserId: 'author-1',
                entity: makeEntity(),
                sourceKind: 'entity',
                sourceId: 'e-1',
            }),
        );
        expect(deleteSubscription).toHaveBeenCalledWith('alice', 'https://push.example/alice');
        expect(result).toBe('failed');
        expect(recordSend).toHaveBeenCalledWith('alice', 'entity:e-1:alice', 'social_mention', 'failed');
    });

    it('records sent on successful delivery', async () => {
        const result = await deliverMentionToUser(
            {
                mentionedUserId: 'alice',
                authorUserId: 'author-1',
                sourceKind: 'comment',
                sourceId: 'c-1',
                entityId: 'e-1',
            },
            buildMentionPayload({
                authorUserId: 'author-1',
                entity: makeEntity(),
                sourceKind: 'comment',
                sourceId: 'c-1',
            }),
        );
        expect(result).toBe('sent');
        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        expect(recordSend).toHaveBeenCalledWith('alice', 'comment:c-1:alice', 'social_mention', 'sent');
    });
});

// === onEntityCreated =========================================================

describe('onEntityCreated', () => {
    it('pushes to each mentioned user exactly once', async () => {
        mentions.push(
            { entity_id: 'entity-1', source_kind: 'entity', source_id: 'entity-1', author_user_id: 'author-1', mentioned_user_id: 'alice' },
            { entity_id: 'entity-1', source_kind: 'entity', source_id: 'entity-1', author_user_id: 'author-1', mentioned_user_id: 'bob' },
        );
        await onEntityCreated(makeEntity());

        expect(sendPushNotification).toHaveBeenCalledTimes(2);
        expect(getUserSubscriptions).toHaveBeenCalledWith('alice');
        expect(getUserSubscriptions).toHaveBeenCalledWith('bob');
    });

    it('does not push to the author of the entity (skipAuthor default)', async () => {
        mentions.push(
            { entity_id: 'entity-1', source_kind: 'entity', source_id: 'entity-1', author_user_id: 'author-1', mentioned_user_id: 'author-1' },
            { entity_id: 'entity-1', source_kind: 'entity', source_id: 'entity-1', author_user_id: 'author-1', mentioned_user_id: 'alice' },
        );
        await onEntityCreated(makeEntity());

        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        expect(getUserSubscriptions).toHaveBeenCalledWith('alice');
        expect(getUserSubscriptions).not.toHaveBeenCalledWith('author-1');
    });

    it('skips push when VAPID is not configured', async () => {
        isPushConfiguredMock.mockReturnValue(false);
        mentions.push({
            entity_id: 'entity-1', source_kind: 'entity', source_id: 'entity-1',
            author_user_id: 'author-1', mentioned_user_id: 'alice',
        });
        await onEntityCreated(makeEntity());

        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(getUserSubscriptions).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
    });

    it('deduplicates the same recipient across multiple mention rows', async () => {
        // Two rows for the same recipient — should still produce exactly one push.
        mentions.push(
            { entity_id: 'entity-1', source_kind: 'entity', source_id: 'entity-1', author_user_id: 'author-1', mentioned_user_id: 'alice' },
            { entity_id: 'entity-1', source_kind: 'entity', source_id: 'entity-1', author_user_id: 'author-1', mentioned_user_id: 'alice' },
        );
        await onEntityCreated(makeEntity());

        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        expect(getUserSubscriptions).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there are no mentions', async () => {
        await onEntityCreated(makeEntity());
        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(getUserSubscriptions).not.toHaveBeenCalled();
    });

    it('passes through entity metadata into the push payload', async () => {
        mentions.push({
            entity_id: 'entity-1', source_kind: 'entity', source_id: 'entity-1',
            author_user_id: 'author-1', mentioned_user_id: 'alice',
        });
        await onEntityCreated(makeEntity({ kind: 'announcement', authorUserId: 'author-1' }));

        const args = sendPushNotification.mock.calls[0];
        expect(args).toBeDefined();
        const payload = args![1] as { title: string; body: string; data: Record<string, unknown> };
        expect(payload.title).toBe('Вас упомянули');
        expect(payload.body).toContain('@author-1');
        expect(payload.body).toContain('объявлении');
        expect(payload.data.kind).toBe('announcement');
    });
});

// === onCommentCreated ========================================================

describe('onCommentCreated', () => {
    it('pushes to each user mentioned in the comment', async () => {
        mentions.push(
            { entity_id: 'entity-1', source_kind: 'comment', source_id: 'comment-1', author_user_id: 'commenter-1', mentioned_user_id: 'alice' },
            { entity_id: 'entity-1', source_kind: 'comment', source_id: 'comment-1', author_user_id: 'commenter-1', mentioned_user_id: 'bob' },
        );
        await onCommentCreated(
            makeComment(),
            // Skip parent-author fan-out by making the parent author identical
            // to the commenter (no self-push).
            makeEntity({ authorUserId: 'commenter-1' }),
        );

        expect(sendPushNotification).toHaveBeenCalledTimes(2);
    });

    it('does not push to the commenter when the commenter is also mentioned', async () => {
        mentions.push(
            { entity_id: 'entity-1', source_kind: 'comment', source_id: 'comment-1', author_user_id: 'commenter-1', mentioned_user_id: 'commenter-1' },
            { entity_id: 'entity-1', source_kind: 'comment', source_id: 'comment-1', author_user_id: 'commenter-1', mentioned_user_id: 'alice' },
        );
        await onCommentCreated(
            makeComment(),
            makeEntity({ authorUserId: 'commenter-1' }),
        );

        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        expect(getUserSubscriptions).toHaveBeenCalledWith('alice');
        expect(getUserSubscriptions).not.toHaveBeenCalledWith('commenter-1');
    });

    it('threads the comment author handle into the push body, not the entity author', async () => {
        mentions.push({
            entity_id: 'entity-1', source_kind: 'comment', source_id: 'comment-1',
            author_user_id: 'commenter-1', mentioned_user_id: 'alice',
        });
        await onCommentCreated(
            makeComment({ authorUserId: 'commenter-1' }),
            // Use the same author for the parent so we exercise the
            // mention-only path (no comment-fanout push to entity author).
            makeEntity({ authorUserId: 'commenter-1', kind: 'post' }),
        );

        const args = sendPushNotification.mock.calls[0];
        const payload = args![1] as { body: string; data: Record<string, unknown> };
        expect(payload.body).toContain('@commenter-1');
        expect(payload.body).not.toContain('@author-1');
        expect(payload.data.sourceKind).toBe('comment');
        expect(payload.data.sourceId).toBe('comment-1');
    });

    it('skips push but keeps the notification row when VAPID is not configured', async () => {
        isPushConfiguredMock.mockReturnValue(false);
        mentions.push({
            entity_id: 'entity-1', source_kind: 'comment', source_id: 'comment-1',
            author_user_id: 'commenter-1', mentioned_user_id: 'alice',
        });
        await onCommentCreated(makeComment(), makeEntity());

        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
    });

    it('notifies the parent-entity author about a comment (new fan-out)', async () => {
        await onCommentCreated(
            makeComment({ authorUserId: 'commenter-1' }),
            makeEntity({ authorUserId: 'author-1', kind: 'post' }),
        );

        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        expect(getUserSubscriptions).toHaveBeenCalledWith('author-1');
        const args = sendPushNotification.mock.calls[0];
        const payload = args![1] as { title: string; body: string };
        expect(payload.title).toContain('Комментарий');
        expect(payload.title).toContain('посте');
        expect(payload.body).toContain('commenter-1');
        expect(recordSend).toHaveBeenCalledWith(
            'author-1',
            'comment:comment-1:author-1',
            'social_comment',
            'sent',
        );
    });

    it('does not push the comment-author self when commenting on own post', async () => {
        await onCommentCreated(
            makeComment({ authorUserId: 'commenter-1' }),
            makeEntity({ authorUserId: 'commenter-1', kind: 'post' }),
        );

        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
    });

    it('also notifies the parent-comment author on a reply', async () => {
        socialComments.push({ id: 'parent-comment-1', entity_id: 'entity-1', author_user_id: 'top-poster' });
        await onCommentCreated(
            makeComment({
                id: 'reply-comment-1',
                parentCommentId: 'parent-comment-1',
                authorUserId: 'reply-author',
                body: 'hi',
            }),
            makeEntity({ authorUserId: 'entity-author', kind: 'post' }),
        );

        expect(getUserSubscriptions).toHaveBeenCalledWith('entity-author');
        expect(getUserSubscriptions).toHaveBeenCalledWith('top-poster');
        // 2 unique non-author recipients => 2 pushes.
        expect(sendPushNotification).toHaveBeenCalledTimes(2);
    });

    it('deduplicates a recipient that was mentioned AND is the parent author', async () => {
        mentions.push({
            entity_id: 'entity-1',
            source_kind: 'comment',
            source_id: 'comment-1',
            author_user_id: 'commenter-1',
            mentioned_user_id: 'author-1',
        });
        await onCommentCreated(
            makeComment({ authorUserId: 'commenter-1' }),
            makeEntity({ authorUserId: 'author-1', kind: 'post' }),
        );

        // The mention path fires once for author-1; the comment-fanout path
        // must skip them as already-notified.
        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        const args = sendPushNotification.mock.calls[0];
        const payload = args![1] as { title: string };
        expect(payload.title).toBe('Вас упомянули');
    });

    it('truncates very long comment bodies in the push snippet', async () => {
        const long = 'lorem '.repeat(40);
        await onCommentCreated(
            makeComment({ authorUserId: 'commenter-1', body: long }),
            makeEntity({ authorUserId: 'author-1', kind: 'post' }),
        );
        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        const args = sendPushNotification.mock.calls[0];
        const payload = args![1] as { body: string };
        // Recipient prefix + a body that does not exceed reasonable bounds.
        expect(payload.body.length).toBeLessThanOrEqual(120);
        expect(payload.body.endsWith('…')).toBe(true);
    });
});

// === resolveDmParticipants ===================================================

describe('resolveDmParticipants', () => {
    it('extracts both participants from a dm:direct:<low>::<high> scope id', () => {
        expect(resolveDmParticipants('dm:direct:alice::bob')).toEqual(['alice', 'bob']);
    });

    it('accepts a bare direct:<low>::<high> scope id (no dm: prefix)', () => {
        expect(resolveDmParticipants('direct:alice::bob')).toEqual(['alice', 'bob']);
    });

    it('returns null for an unrecognized scope id shape', () => {
        expect(resolveDmParticipants('dm:group-chat:42')).toBeNull();
        expect(resolveDmParticipants('group:ITS-21')).toBeNull();
        expect(resolveDmParticipants('')).toBeNull();
    });
});

// === onSocialDmCreated =======================================================

describe('onSocialDmCreated', () => {
    it('creates a notification-center row for the peer participant', async () => {
        await onSocialDmCreated(makeDmEntity({ authorUserId: 'alice', scopeId: 'dm:direct:alice::bob' }));

        expect(mentions).toContainEqual({
            entity_id: 'dm-1',
            source_kind: 'entity',
            source_id: 'dm-1',
            author_user_id: 'alice',
            mentioned_user_id: 'bob',
        });
    });

    it('keeps the notification-center row even when VAPID is not configured', async () => {
        isPushConfiguredMock.mockReturnValue(false);
        await onSocialDmCreated(makeDmEntity({ authorUserId: 'alice', scopeId: 'dm:direct:alice::bob' }));

        expect(mentions).toHaveLength(1);
        expect(mentions[0]?.mentioned_user_id).toBe('bob');
        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
    });

    it('does not duplicate an existing DM notification-center row', async () => {
        const entity = makeDmEntity({ authorUserId: 'alice', scopeId: 'dm:direct:alice::bob' });
        await ensureDmNotificationRow(entity, 'bob');
        await ensureDmNotificationRow(entity, 'bob');

        expect(mentions).toHaveLength(1);
    });

    it('pushes the DM to the peer participant only', async () => {
        await onSocialDmCreated(makeDmEntity({ authorUserId: 'alice', scopeId: 'dm:direct:alice::bob' }));

        expect(getUserSubscriptions).toHaveBeenCalledTimes(1);
        expect(getUserSubscriptions).toHaveBeenCalledWith('bob');
        expect(sendPushNotification).toHaveBeenCalledTimes(1);
        expect(recordSend).toHaveBeenCalledWith('bob', 'dm:dm-1', 'social_dm', 'sent');
    });

    it('skips when the room id cannot be parsed', async () => {
        await onSocialDmCreated(makeDmEntity({ scopeId: 'dm:group-chat:42' }));
        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
    });

    it('does not self-push when the author is the only resolvable participant', async () => {
        // Pathological scope id where both sides equal the author. The filter
        // must still drop them.
        await onSocialDmCreated(makeDmEntity({
            authorUserId: 'alice',
            scopeId: 'dm:direct:alice::alice',
        }));
        expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it('builds the DM body as "<sender>: <snippet>"', async () => {
        await onSocialDmCreated(makeDmEntity({
            authorUserId: 'alice',
            payload: { body: 'long message coming up' },
        }));
        const args = sendPushNotification.mock.calls[0];
        const payload = args![1] as { title: string; body: string };
        expect(payload.title).toBe('Новое сообщение');
        expect(payload.body.startsWith('alice: ')).toBe(true);
        expect(payload.body).toContain('long message');
    });

    it('is a no-op when VAPID is not configured', async () => {
        isPushConfiguredMock.mockReturnValue(false);
        await onSocialDmCreated(makeDmEntity());
        expect(mentions).toHaveLength(1);
        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
    });
});

// === resolveGroupMembers =====================================================

describe('resolveGroupMembers', () => {
    it('returns active member ids for the group', async () => {
        memberships.push(
            { user_id: 'u1', group_key: 'ITS-21', active: true },
            { user_id: 'u2', group_key: 'ITS-21', active: true },
            { user_id: 'u3', group_key: 'ITS-21', active: false }, // removed
            { user_id: 'u4', group_key: 'OTHER', active: true },   // other group
        );
        const out = await resolveGroupMembers('ITS-21');
        expect(out).toEqual(['u1', 'u2']);
    });

    it('returns [] for an empty group key', async () => {
        const out = await resolveGroupMembers('');
        expect(out).toEqual([]);
    });

    it('returns [] for an unknown group with no rows', async () => {
        const out = await resolveGroupMembers('UNKNOWN');
        expect(out).toEqual([]);
    });
});

// === onGroupPostCreated ======================================================

describe('onGroupPostCreated', () => {
    it('pushes to every active member of the group except the author', async () => {
        memberships.push(
            { user_id: 'author-1', group_key: 'ITS-21', active: true },
            { user_id: 'alice', group_key: 'ITS-21', active: true },
            { user_id: 'bob', group_key: 'ITS-21', active: true },
        );
        await onGroupPostCreated(makeEntity({ kind: 'post', scopeId: 'group:ITS-21', authorUserId: 'author-1' }));

        expect(getUserSubscriptions).toHaveBeenCalledTimes(2);
        expect(getUserSubscriptions).toHaveBeenCalledWith('alice');
        expect(getUserSubscriptions).toHaveBeenCalledWith('bob');
        expect(getUserSubscriptions).not.toHaveBeenCalledWith('author-1');
        expect(recordSend).toHaveBeenCalledWith('alice', 'group-post:entity-1:alice', 'social_group_post', 'sent');
        expect(recordSend).toHaveBeenCalledWith('bob', 'group-post:entity-1:bob', 'social_group_post', 'sent');
    });

    it('handles different group-feed kinds with localized verb labels', async () => {
        memberships.push({ user_id: 'alice', group_key: 'ITS-21', active: true });
        await onGroupPostCreated(makeEntity({ kind: 'task', scopeId: 'group:ITS-21', authorUserId: 'author-1' }));

        const args = sendPushNotification.mock.calls[0];
        const payload = args![1] as { title: string; body: string };
        expect(payload.title).toBe('Новое в группе');
        expect(payload.body).toContain('author-1');
        expect(payload.body).toContain('задачу');
    });

    it('is a no-op for an empty group (only the author)', async () => {
        memberships.push({ user_id: 'author-1', group_key: 'ITS-21', active: true });
        await onGroupPostCreated(makeEntity({ kind: 'post', scopeId: 'group:ITS-21', authorUserId: 'author-1' }));
        expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it('ignores entities that are not in a group scope', async () => {
        memberships.push({ user_id: 'alice', group_key: 'ITS-21', active: true });
        await onGroupPostCreated(makeEntity({ scopeType: 'dm', scopeId: 'dm:direct:a::b' }));
        // resolveGroupMembers must not even be queried for non-group scopes.
        expect(sendPushNotification).not.toHaveBeenCalled();
    });

    it('writes per-recipient idempotency fingerprints to app_push_sends', async () => {
        memberships.push(
            { user_id: 'alice', group_key: 'ITS-21', active: true },
            { user_id: 'bob', group_key: 'ITS-21', active: true },
        );
        await onGroupPostCreated(makeEntity({ kind: 'post', scopeId: 'group:ITS-21', authorUserId: 'author-1' }));
        const fingerprintArgs = recordSend.mock.calls.map((c) => c[1]);
        expect(new Set(fingerprintArgs).size).toBe(fingerprintArgs.length);
        expect(fingerprintArgs).toContain('group-post:entity-1:alice');
        expect(fingerprintArgs).toContain('group-post:entity-1:bob');
    });
});

// === resolveAnnouncementRecipients ===========================================

describe('resolveAnnouncementRecipients', () => {
    it('unions members across targetGroups (deduplicated)', async () => {
        memberships.push(
            { user_id: 'u1', group_key: 'G1', active: true },
            { user_id: 'u2', group_key: 'G1', active: true },
            { user_id: 'u2', group_key: 'G2', active: true },
            { user_id: 'u3', group_key: 'G2', active: true },
        );
        const out = await resolveAnnouncementRecipients({
            title: 't', body: 'b', priority: 'medium', targetGroups: ['G1', 'G2'],
        });
        expect(out).not.toBeNull();
        expect(new Set(out)).toEqual(new Set(['u1', 'u2', 'u3']));
    });

    it('broadcasts to all push-subscribed users when priority is critical and no targetGroups', async () => {
        pushSubscribers.push({ user_id: 'sub-a' }, { user_id: 'sub-b' });
        const out = await resolveAnnouncementRecipients({
            title: 't', body: 'b', priority: 'critical',
        });
        expect(new Set(out)).toEqual(new Set(['sub-a', 'sub-b']));
    });

    it('returns [] when no targetGroups and priority is not critical', async () => {
        pushSubscribers.push({ user_id: 'sub-a' });
        const out = await resolveAnnouncementRecipients({
            title: 't', body: 'b', priority: 'low',
        });
        expect(out).toEqual([]);
    });
});

// === onAnnouncementCreated ===================================================

describe('onAnnouncementCreated', () => {
    it('fans out to each member of every targetGroup, skipping the announcement author', async () => {
        memberships.push(
            { user_id: 'coordinator-1', group_key: 'G1', active: true },
            { user_id: 'student-a', group_key: 'G1', active: true },
            { user_id: 'student-b', group_key: 'G2', active: true },
        );
        await onAnnouncementCreated(makeAnnouncementEntity({
            authorUserId: 'coordinator-1',
            payload: { title: 'Hi', body: 'Body', priority: 'medium', targetGroups: ['G1', 'G2'] },
        }));

        expect(getUserSubscriptions).toHaveBeenCalledTimes(2);
        expect(getUserSubscriptions).toHaveBeenCalledWith('student-a');
        expect(getUserSubscriptions).toHaveBeenCalledWith('student-b');
        expect(getUserSubscriptions).not.toHaveBeenCalledWith('coordinator-1');
    });

    it('broadcasts only for critical priority when targetGroups is empty', async () => {
        pushSubscribers.push({ user_id: 'sub-a' }, { user_id: 'sub-b' });
        await onAnnouncementCreated(makeAnnouncementEntity({
            authorUserId: 'coordinator-1',
            payload: { title: 'URGENT', body: 'Body', priority: 'critical' },
        }));

        expect(sendPushNotification).toHaveBeenCalledTimes(2);
        const args = sendPushNotification.mock.calls[0];
        const payload = args![1] as { title: string };
        expect(payload.title).toContain('Важное объявление');
    });

    it('does NOT broadcast when targetGroups is empty and priority is low/medium/high', async () => {
        pushSubscribers.push({ user_id: 'sub-a' });
        await onAnnouncementCreated(makeAnnouncementEntity({
            authorUserId: 'coordinator-1',
            payload: { title: 'Routine', body: 'Body', priority: 'medium' },
        }));

        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
    });

    it('uses non-critical announcement title for medium-priority targeted announcements', async () => {
        memberships.push({ user_id: 'student-a', group_key: 'G1', active: true });
        await onAnnouncementCreated(makeAnnouncementEntity({
            authorUserId: 'coordinator-1',
            payload: { title: 'Regular', body: 'Body', priority: 'medium', targetGroups: ['G1'] },
        }));

        const args = sendPushNotification.mock.calls[0];
        const payload = args![1] as { title: string };
        expect(payload.title).toBe('📢 Объявление');
    });

    it('writes per-recipient idempotency fingerprints scoped to the announcement', async () => {
        memberships.push(
            { user_id: 'student-a', group_key: 'G1', active: true },
            { user_id: 'student-b', group_key: 'G1', active: true },
        );
        await onAnnouncementCreated(makeAnnouncementEntity({
            authorUserId: 'coordinator-1',
            payload: { title: 't', body: 'b', priority: 'high', targetGroups: ['G1'] },
        }));
        const fingerprints = recordSend.mock.calls.map((c) => c[1]);
        expect(new Set(fingerprints).size).toBe(fingerprints.length);
        expect(fingerprints).toContain('announcement:ann-1:student-a');
        expect(fingerprints).toContain('announcement:ann-1:student-b');
    });

    it('is a no-op when VAPID is not configured', async () => {
        isPushConfiguredMock.mockReturnValue(false);
        memberships.push({ user_id: 'student-a', group_key: 'G1', active: true });
        await onAnnouncementCreated(makeAnnouncementEntity({
            authorUserId: 'coordinator-1',
            payload: { title: 't', body: 'b', priority: 'critical', targetGroups: ['G1'] },
        }));
        expect(sendPushNotification).not.toHaveBeenCalled();
    });
});

// === Per-kind payload builders ==============================================

describe('buildDmPayload', () => {
    it('embeds the sender id and snippet, tags by entity id', () => {
        const payload = buildDmPayload({
            entity: makeDmEntity({ id: 'dm-7' }),
            senderUserId: 'alice',
            bodySnippet: 'hi',
        });
        expect(payload.title).toBe('Новое сообщение');
        expect(payload.body).toBe('alice: hi');
        expect(payload.tag).toBe('social-dm-dm-7');
        const data = payload.data as Record<string, unknown>;
        expect(data.kind).toBe('dm_message');
    });
});

describe('buildCommentPayload', () => {
    it('localizes the title per parent entity kind', () => {
        const payload = buildCommentPayload({
            parentEntity: makeEntity({ kind: 'task' }),
            comment: makeComment(),
            bodySnippet: 'reply',
        });
        expect(payload.title).toBe('Комментарий к вашему задаче');
    });
});

describe('buildGroupPostPayload', () => {
    it('uses the active-voice verb label for the kind', () => {
        const payload = buildGroupPostPayload({ entity: makeEntity({ kind: 'extra_lesson', authorUserId: 'teacher-1' }) });
        expect(payload.body).toContain('teacher-1');
        expect(payload.body).toContain('занятие');
    });
});

describe('buildAnnouncementPayload', () => {
    it('uses the critical title for priority=critical', () => {
        const payload = buildAnnouncementPayload({
            entity: makeAnnouncementEntity({ payload: { title: 'wow', body: 'b', priority: 'critical' } }),
        });
        expect(payload.title).toContain('Важное объявление');
        expect(payload.body).toBe('wow');
    });

    it('uses the default title for non-critical priority', () => {
        const payload = buildAnnouncementPayload({
            entity: makeAnnouncementEntity({ payload: { title: 'meh', body: 'b', priority: 'low' } }),
        });
        expect(payload.title).toBe('📢 Объявление');
    });
});

// === resolveCommentRecipients ================================================

describe('resolveCommentRecipients', () => {
    it('returns the parent-entity author for a top-level comment', async () => {
        const out = await resolveCommentRecipients(
            makeComment({ authorUserId: 'commenter-1' }),
            makeEntity({ authorUserId: 'author-1' }),
        );
        expect(out).toEqual(['author-1']);
    });

    it('returns empty when the commenter IS the parent-entity author', async () => {
        const out = await resolveCommentRecipients(
            makeComment({ authorUserId: 'self-1' }),
            makeEntity({ authorUserId: 'self-1' }),
        );
        expect(out).toEqual([]);
    });

    it('adds the parent-comment author on a reply', async () => {
        socialComments.push({ id: 'parent-comment-1', entity_id: 'entity-1', author_user_id: 'top-poster' });
        const out = await resolveCommentRecipients(
            makeComment({ authorUserId: 'reply-author', parentCommentId: 'parent-comment-1' }),
            makeEntity({ authorUserId: 'entity-author' }),
        );
        expect(new Set(out)).toEqual(new Set(['entity-author', 'top-poster']));
    });

    it('caps at 2 unique recipients even with parent comment + entity author', async () => {
        socialComments.push({ id: 'parent-comment-1', entity_id: 'entity-1', author_user_id: 'author-1' });
        const out = await resolveCommentRecipients(
            makeComment({ authorUserId: 'reply-author', parentCommentId: 'parent-comment-1' }),
            makeEntity({ authorUserId: 'author-1' }),
        );
        // Both the parent-entity author and the parent-comment author are
        // the same person — Set dedup yields one recipient.
        expect(out).toEqual(['author-1']);
    });
});

// === Per-kind opt-out gate ===================================================

describe('deliverPushToUser — per-kind opt-out gate', () => {
    it('skips delivery and returns opted_out when isPushKindEnabledForUser is false', async () => {
        isPushKindEnabledForUserMock.mockResolvedValueOnce(false);
        const result = await deliverPushToUser({
            userId: 'alice',
            fingerprint: 'fp-1',
            kind: 'social_mention',
            payload: { title: 't', body: 'b' },
        });
        expect(result).toBe('opted_out');
        expect(sendPushNotification).not.toHaveBeenCalled();
        expect(getUserSubscriptions).not.toHaveBeenCalled();
        expect(recordSend).not.toHaveBeenCalled();
        expect(hasBeenSent).not.toHaveBeenCalled();
    });

    it('still delivers when the gate returns true (default path)', async () => {
        // gate already returns true via the beforeEach default.
        const result = await deliverPushToUser({
            userId: 'alice',
            fingerprint: 'fp-2',
            kind: 'social_mention',
            payload: { title: 't', body: 'b' },
        });
        expect(result).toBe('sent');
        expect(sendPushNotification).toHaveBeenCalledTimes(1);
    });

    it('falls open (delivers) when the gate throws', async () => {
        // A transient prefs lookup failure must not silently mute the user.
        isPushKindEnabledForUserMock.mockRejectedValueOnce(new Error('boom'));
        const result = await deliverPushToUser({
            userId: 'alice',
            fingerprint: 'fp-3',
            kind: 'social_dm',
            payload: { title: 't', body: 'b' },
        });
        expect(result).toBe('sent');
        expect(sendPushNotification).toHaveBeenCalledTimes(1);
    });

    it('passes the kind to the gate (downstream prefs honor the kind argument)', async () => {
        await deliverPushToUser({
            userId: 'alice',
            fingerprint: 'fp-4',
            kind: 'social_group_post',
            payload: { title: 't', body: 'b' },
        });
        expect(isPushKindEnabledForUserMock).toHaveBeenCalledWith('alice', 'social_group_post');
    });
});

describe('opt-out gate within fan-out handlers', () => {
    it('onGroupPostCreated skips opted-out members', async () => {
        memberships.push(
            { user_id: 'alice', group_key: 'ITS-21', active: true },
            { user_id: 'bob', group_key: 'ITS-21', active: true },
        );
        // Alice opted out of group-post pushes; Bob remains default-on.
        isPushKindEnabledForUserMock.mockImplementation(async (userId: string) => userId !== 'alice');
        await onGroupPostCreated(makeEntity({
            kind: 'post',
            scopeId: 'group:ITS-21',
            authorUserId: 'author-1',
        }));
        // Only Bob's subscriptions are queried — Alice was gated out before any
        // subscription lookup.
        expect(getUserSubscriptions).toHaveBeenCalledTimes(1);
        expect(getUserSubscriptions).toHaveBeenCalledWith('bob');
        expect(getUserSubscriptions).not.toHaveBeenCalledWith('alice');
    });

    it('onSocialDmCreated skips the peer when they opted out of DMs', async () => {
        isPushKindEnabledForUserMock.mockImplementation(async (_userId: string, kind: string) => kind !== 'social_dm');
        await onSocialDmCreated(makeDmEntity({
            authorUserId: 'alice',
            scopeId: 'dm:direct:alice::bob',
        }));
        expect(sendPushNotification).not.toHaveBeenCalled();
    });
});
