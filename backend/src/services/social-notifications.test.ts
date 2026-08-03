/**
 * Unit tests for `services/social-notifications.ts`. Mirrors the in-memory PG
 * shim pattern used by `social-read-markers.test.ts` and `social-crud.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// === Fake Postgres store ====================================================

interface MentionRow {
    id: string;
    entity_id: string;
    source_kind: 'entity' | 'comment';
    source_id: string;
    author_user_id: string;
    mentioned_user_id: string;
    created_at: Date;
    read_at: Date | null;
}

interface EntityRow {
    id: string;
    kind: string;
    scope_type: string;
    scope_id: string;
    author_user_id: string;
    payload: Record<string, unknown>;
    created_at: Date;
    deleted_at: Date | null;
}

interface CommentRow {
    id: string;
    body: string;
    deleted_at: Date | null;
}

const store = {
    mentions: [] as MentionRow[],
    entities: [] as EntityRow[],
    comments: [] as CommentRow[],
};

let mentionCounter = 0;
function nextId(prefix: string): string {
    mentionCounter += 1;
    return `${prefix}-${mentionCounter.toString().padStart(6, '0')}`;
}

function reset(): void {
    store.mentions.length = 0;
    store.entities.length = 0;
    store.comments.length = 0;
    mentionCounter = 0;
}

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            if (text.startsWith('select m.id::text as id')) {
                // listSocialNotifications. params: [userId, limit, beforeIso?]
                const [userId, limit] = params as [string, number];
                const beforeIso = params.length >= 3 ? (params[2] as string) : null;
                const unreadOnly = text.includes('m.read_at is null');
                const beforeDate = beforeIso ? new Date(beforeIso) : null;

                const matches = store.mentions
                    .filter((m) => m.mentioned_user_id === userId)
                    .filter((m) => {
                        const entity = store.entities.find((e) => e.id === m.entity_id);
                        return entity != null && entity.deleted_at == null;
                    })
                    .filter((m) => (unreadOnly ? m.read_at == null : true))
                    .filter((m) => (beforeDate ? m.created_at < beforeDate : true))
                    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
                    .slice(0, limit)
                    .map((m) => {
                        const entity = store.entities.find((e) => e.id === m.entity_id)!;
                        const comment = m.source_kind === 'comment'
                            ? store.comments.find((c) => c.id === m.source_id && c.deleted_at == null)
                            : null;
                        return {
                            id: m.id,
                            source_kind: m.source_kind,
                            source_id: m.source_id,
                            entity_id: m.entity_id,
                            author_user_id: m.author_user_id,
                            created_at: m.created_at,
                            read_at: m.read_at,
                            entity_kind: entity.kind,
                            scope_type: entity.scope_type,
                            scope_id: entity.scope_id,
                            entity_payload: entity.payload,
                            comment_body: comment?.body ?? null,
                        };
                    });
                return { rows: matches, rowCount: matches.length };
            }

            if (text.startsWith('update app_social_mention') && text.includes('id = any')) {
                // markNotificationsRead. params: [userId, ids[]]
                const [userId, ids] = params as [string, string[]];
                const idSet = new Set(ids);
                let touched = 0;
                for (const m of store.mentions) {
                    if (m.mentioned_user_id === userId && m.read_at == null && idSet.has(m.id)) {
                        m.read_at = new Date();
                        touched += 1;
                    }
                }
                return { rows: [], rowCount: touched };
            }

            if (text.startsWith('update app_social_mention') && !text.includes('id = any')) {
                // markAllNotificationsRead. params: [userId]
                const [userId] = params as [string];
                let touched = 0;
                for (const m of store.mentions) {
                    if (m.mentioned_user_id === userId && m.read_at == null) {
                        m.read_at = new Date();
                        touched += 1;
                    }
                }
                return { rows: [], rowCount: touched };
            }

            if (
                text.startsWith('select count(*)::text as count')
                && text.includes('from app_social_mention')
            ) {
                const [userId] = params as [string];
                let count = 0;
                for (const m of store.mentions) {
                    if (m.mentioned_user_id !== userId) continue;
                    if (m.read_at != null) continue;
                    const entity = store.entities.find((e) => e.id === m.entity_id);
                    if (!entity || entity.deleted_at != null) continue;
                    count += 1;
                }
                return { rows: [{ count: String(count) }], rowCount: 1 };
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

// Helpers used inside tests to seed the in-memory store without going through
// real CRUD code.
function seedEntity(args: {
    id?: string;
    kind?: string;
    scopeType?: string;
    scopeId?: string;
    authorUserId?: string;
    payload?: Record<string, unknown>;
    createdAt?: Date;
    deleted?: boolean;
}): string {
    const id = args.id ?? nextId('e');
    store.entities.push({
        id,
        kind: args.kind ?? 'post',
        scope_type: args.scopeType ?? 'group',
        scope_id: args.scopeId ?? 'group:ITS-21',
        author_user_id: args.authorUserId ?? 'alice',
        payload: args.payload ?? { title: 'T', body: 'B' },
        created_at: args.createdAt ?? new Date(),
        deleted_at: args.deleted ? new Date() : null,
    });
    return id;
}

function seedComment(args: {
    id?: string;
    body: string;
    deleted?: boolean;
}): string {
    const id = args.id ?? nextId('c');
    store.comments.push({
        id,
        body: args.body,
        deleted_at: args.deleted ? new Date() : null,
    });
    return id;
}

function seedMention(args: {
    id?: string;
    entityId: string;
    sourceKind: 'entity' | 'comment';
    sourceId: string;
    authorUserId: string;
    mentionedUserId: string;
    createdAt?: Date;
    read?: boolean;
}): string {
    const id = args.id ?? nextId('m');
    store.mentions.push({
        id,
        entity_id: args.entityId,
        source_kind: args.sourceKind,
        source_id: args.sourceId,
        author_user_id: args.authorUserId,
        mentioned_user_id: args.mentionedUserId,
        created_at: args.createdAt ?? new Date(),
        read_at: args.read ? new Date() : null,
    });
    return id;
}

import {
    listSocialNotifications,
    markNotificationsRead,
    markAllNotificationsRead,
    getUnreadNotificationCount,
    deriveNotificationKind,
    pickSummary,
    SOCIAL_NOTIFICATION_DEFAULT_LIMIT,
    SOCIAL_NOTIFICATION_MAX_LIMIT,
    __testing,
} from './social-notifications.js';

beforeEach(() => {
    reset();
});

describe('deriveNotificationKind', () => {
    it('classifies comment-sourced mentions as comment regardless of entity kind', () => {
        expect(deriveNotificationKind('comment', 'post')).toBe('comment');
        expect(deriveNotificationKind('comment', 'dm_message')).toBe('comment');
        expect(deriveNotificationKind('comment', 'announcement')).toBe('comment');
    });

    it('maps entity-sourced DM/global rows to dm', () => {
        expect(deriveNotificationKind('entity', 'dm_message')).toBe('dm');
        expect(deriveNotificationKind('entity', 'global_message')).toBe('dm');
    });

    it('maps entity-sourced announcement rows to announcement', () => {
        expect(deriveNotificationKind('entity', 'announcement')).toBe('announcement');
    });

    it('maps entity-sourced group feed kinds to group_post', () => {
        expect(deriveNotificationKind('entity', 'post')).toBe('group_post');
        expect(deriveNotificationKind('entity', 'task')).toBe('group_post');
        expect(deriveNotificationKind('entity', 'extra_lesson')).toBe('group_post');
        expect(deriveNotificationKind('entity', 'poll')).toBe('group_post');
        expect(deriveNotificationKind('entity', 'event')).toBe('group_post');
    });
});

describe('pickSummary', () => {
    it('prefers the comment body for comment-sourced rows', () => {
        const s = pickSummary('comment', 'reply body!', { title: 'T', body: 'B' });
        expect(s).toBe('reply body!');
    });

    it('falls back through body → title → subject → question → note for entity rows', () => {
        expect(pickSummary('entity', null, { body: 'b', title: 't' })).toBe('b');
        expect(pickSummary('entity', null, { title: 't' })).toBe('t');
        expect(pickSummary('entity', null, { subject: 's' })).toBe('s');
        expect(pickSummary('entity', null, { question: 'q' })).toBe('q');
        expect(pickSummary('entity', null, { note: 'n' })).toBe('n');
        expect(pickSummary('entity', null, {})).toBe('');
    });

    it('truncates with an ellipsis when over the cap', () => {
        const long = 'x'.repeat(200);
        const s = pickSummary('entity', null, { body: long }, 10);
        expect(s.length).toBe(10);
        expect(s.endsWith('…')).toBe(true);
    });

    it('ignores non-string payload fields', () => {
        expect(pickSummary('entity', null, { body: 42 as unknown as string })).toBe('');
    });
});

describe('__testing helpers', () => {
    it('clampLimit defaults when value is missing or invalid', () => {
        expect(__testing.clampLimit(undefined)).toBe(SOCIAL_NOTIFICATION_DEFAULT_LIMIT);
        expect(__testing.clampLimit(-5)).toBe(SOCIAL_NOTIFICATION_DEFAULT_LIMIT);
        expect(__testing.clampLimit(Number.NaN)).toBe(SOCIAL_NOTIFICATION_DEFAULT_LIMIT);
    });

    it('clampLimit caps at MAX_LIMIT and floors decimals', () => {
        expect(__testing.clampLimit(SOCIAL_NOTIFICATION_MAX_LIMIT + 100)).toBe(SOCIAL_NOTIFICATION_MAX_LIMIT);
        expect(__testing.clampLimit(12.7)).toBe(12);
    });
});

describe('listSocialNotifications', () => {
    it('returns empty array for unknown / empty user', async () => {
        expect(await listSocialNotifications('')).toEqual([]);
        expect(await listSocialNotifications('nobody')).toEqual([]);
    });

    it('returns the user\'s mentions in newest-first order', async () => {
        const e = seedEntity({ kind: 'post', payload: { body: 'hi' } });
        seedMention({
            entityId: e,
            sourceKind: 'entity',
            sourceId: e,
            authorUserId: 'alice',
            mentionedUserId: 'bob',
            createdAt: new Date(Date.now() - 30_000),
        });
        seedMention({
            entityId: e,
            sourceKind: 'entity',
            sourceId: e,
            authorUserId: 'alice',
            mentionedUserId: 'bob',
            createdAt: new Date(Date.now() - 10_000),
        });
        const out = await listSocialNotifications('bob');
        expect(out).toHaveLength(2);
        expect(new Date(out[0].createdAt).getTime()).toBeGreaterThan(new Date(out[1].createdAt).getTime());
    });

    it('excludes mentions whose parent entity is soft-deleted', async () => {
        const live = seedEntity({ payload: { body: 'live' } });
        const dead = seedEntity({ payload: { body: 'dead' }, deleted: true });
        seedMention({ entityId: live, sourceKind: 'entity', sourceId: live, authorUserId: 'a', mentionedUserId: 'bob' });
        seedMention({ entityId: dead, sourceKind: 'entity', sourceId: dead, authorUserId: 'a', mentionedUserId: 'bob' });
        const out = await listSocialNotifications('bob');
        expect(out).toHaveLength(1);
        expect(out[0].entityId).toBe(live);
    });

    it('filters to unread-only when requested', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob', read: true });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });

        const allOut = await listSocialNotifications('bob');
        expect(allOut).toHaveLength(2);

        const unreadOut = await listSocialNotifications('bob', { unreadOnly: true });
        expect(unreadOut).toHaveLength(1);
        expect(unreadOut[0].readAt).toBeNull();
    });

    it('clamps oversize limit and respects a small limit', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        for (let i = 0; i < 5; i++) {
            seedMention({
                entityId: e,
                sourceKind: 'entity',
                sourceId: e,
                authorUserId: 'a',
                mentionedUserId: 'bob',
                createdAt: new Date(Date.now() - i * 1000),
            });
        }
        const out = await listSocialNotifications('bob', { limit: 2 });
        expect(out).toHaveLength(2);
    });

    it('applies the `before` cursor to return older items only', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        const t0 = new Date(Date.now() - 60_000);
        const t1 = new Date(Date.now() - 30_000);
        const t2 = new Date(Date.now() - 10_000);
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob', createdAt: t0 });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob', createdAt: t1 });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob', createdAt: t2 });

        const page2 = await listSocialNotifications('bob', { before: t1.toISOString() });
        expect(page2).toHaveLength(1);
        expect(new Date(page2[0].createdAt).getTime()).toBe(t0.getTime());
    });

    it('silently drops a malformed before cursor and returns first page', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        const out = await listSocialNotifications('bob', { before: 'not-a-date' });
        expect(out).toHaveLength(1);
    });

    it('joins the comment body for comment-sourced mentions', async () => {
        const e = seedEntity({ kind: 'post', payload: { body: 'parent post' } });
        const c = seedComment({ body: 'a reply that mentions @bob' });
        seedMention({
            entityId: e,
            sourceKind: 'comment',
            sourceId: c,
            authorUserId: 'alice',
            mentionedUserId: 'bob',
        });
        const out = await listSocialNotifications('bob');
        expect(out).toHaveLength(1);
        expect(out[0].kind).toBe('comment');
        expect(out[0].summary).toBe('a reply that mentions @bob');
    });

    it('classifies kinds via deriveNotificationKind end-to-end', async () => {
        const post = seedEntity({ kind: 'post', payload: { body: 'p' } });
        const ann = seedEntity({ kind: 'announcement', payload: { title: 'A', body: 'b' }, scopeType: 'announcement', scopeId: 'announcement:global' });
        const dm = seedEntity({ kind: 'dm_message', payload: { body: 'hi' }, scopeType: 'dm', scopeId: 'dm:direct:alice::bob' });

        seedMention({ entityId: post, sourceKind: 'entity', sourceId: post, authorUserId: 'a', mentionedUserId: 'bob' });
        seedMention({ entityId: ann, sourceKind: 'entity', sourceId: ann, authorUserId: 'a', mentionedUserId: 'bob' });
        seedMention({ entityId: dm, sourceKind: 'entity', sourceId: dm, authorUserId: 'a', mentionedUserId: 'bob' });

        const out = await listSocialNotifications('bob');
        const byEntity = new Map(out.map((n) => [n.entityId, n.kind]));
        expect(byEntity.get(post)).toBe('group_post');
        expect(byEntity.get(ann)).toBe('announcement');
        expect(byEntity.get(dm)).toBe('dm');
    });

    it('preserves the readAt timestamp in the response', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob', read: true });
        const out = await listSocialNotifications('bob');
        expect(out[0].readAt).not.toBeNull();
    });
});

describe('markNotificationsRead', () => {
    it('marks specified rows as read for the owning user only', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        const m1 = seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        const m2 = seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        // Foreign mention — must NOT be touched.
        const m3 = seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'mallory' });

        await markNotificationsRead('bob', [m1, m2, m3]);

        expect(store.mentions.find((m) => m.id === m1)?.read_at).not.toBeNull();
        expect(store.mentions.find((m) => m.id === m2)?.read_at).not.toBeNull();
        // m3 belongs to 'mallory' and must remain unread.
        expect(store.mentions.find((m) => m.id === m3)?.read_at).toBeNull();
    });

    it('is a no-op when called with an empty list', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        await markNotificationsRead('bob', []);
        expect(store.mentions[0].read_at).toBeNull();
    });

    it('idempotent — already-read rows are left alone', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        const first = new Date(Date.now() - 60_000);
        const id = seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob', read: true });
        const row = store.mentions.find((m) => m.id === id)!;
        row.read_at = first;
        await markNotificationsRead('bob', [id]);
        expect(row.read_at?.getTime()).toBe(first.getTime());
    });

    it('deduplicates and trims input ids', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        const id = seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        await markNotificationsRead('bob', [id, ` ${id} `, '']);
        expect(store.mentions.find((m) => m.id === id)?.read_at).not.toBeNull();
    });
});

describe('markAllNotificationsRead', () => {
    it('marks every unread row owned by the user', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        const m1 = seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        const m2 = seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        const m3 = seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'mallory' });

        await markAllNotificationsRead('bob');

        expect(store.mentions.find((m) => m.id === m1)?.read_at).not.toBeNull();
        expect(store.mentions.find((m) => m.id === m2)?.read_at).not.toBeNull();
        // Foreign mention untouched.
        expect(store.mentions.find((m) => m.id === m3)?.read_at).toBeNull();
    });

    it('is a no-op for an empty user', async () => {
        await markAllNotificationsRead('');
        // Just asserting it doesn't throw.
        expect(store.mentions).toHaveLength(0);
    });
});

describe('getUnreadNotificationCount', () => {
    it('returns 0 when there are no unread mentions', async () => {
        expect(await getUnreadNotificationCount('bob')).toBe(0);
    });

    it('counts only unread, non-deleted, owned by the user', async () => {
        const live = seedEntity({ payload: { body: 'hi' } });
        const dead = seedEntity({ payload: { body: 'no' }, deleted: true });

        // 2 unread, 1 read, 1 deleted-parent → count = 2
        seedMention({ entityId: live, sourceKind: 'entity', sourceId: live, authorUserId: 'a', mentionedUserId: 'bob' });
        seedMention({ entityId: live, sourceKind: 'entity', sourceId: live, authorUserId: 'a', mentionedUserId: 'bob' });
        seedMention({ entityId: live, sourceKind: 'entity', sourceId: live, authorUserId: 'a', mentionedUserId: 'bob', read: true });
        seedMention({ entityId: dead, sourceKind: 'entity', sourceId: dead, authorUserId: 'a', mentionedUserId: 'bob' });
        // foreign user — must NOT contribute
        seedMention({ entityId: live, sourceKind: 'entity', sourceId: live, authorUserId: 'a', mentionedUserId: 'mallory' });

        expect(await getUnreadNotificationCount('bob')).toBe(2);
    });

    it('drops to 0 after markAllNotificationsRead', async () => {
        const e = seedEntity({ payload: { body: 'hi' } });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        seedMention({ entityId: e, sourceKind: 'entity', sourceId: e, authorUserId: 'a', mentionedUserId: 'bob' });
        expect(await getUnreadNotificationCount('bob')).toBe(2);
        await markAllNotificationsRead('bob');
        expect(await getUnreadNotificationCount('bob')).toBe(0);
    });
});
