/**
 * Universal social search — pure-helper + integration tests.
 *
 * Pure helpers (normalize / escape / clamp / visibility predicate) are tested
 * directly. The full SQL path is covered by an in-memory FakeClient that
 * mimics the ILIKE filter shape and the post-fetch authorization pass.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface EntityRow {
    id: string;
    kind: string;
    scope_type: string;
    scope_id: string;
    author_user_id: string;
    payload: Record<string, unknown>;
    pinned: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
    deleted_by_user_id: string | null;
    deleted_reason: string | null;
}

const store = {
    entities: [] as EntityRow[],
    // Map of `(viewerId, groupKey)` → boolean. Anything missing defaults to "no
    // access", which matches the production `assertCanReadGroup` failure path.
    groupAccess: new Map<string, boolean>(),
};

let idCounter = 0;
function nextId(): string {
    idCounter += 1;
    return `id-${idCounter.toString().padStart(6, '0')}`;
}

function reset(): void {
    store.entities.length = 0;
    store.groupAccess.clear();
    idCounter = 0;
}

function pushEntity(partial: Partial<EntityRow>): EntityRow {
    const now = new Date();
    const row: EntityRow = {
        id: nextId(),
        kind: 'post',
        scope_type: 'group',
        scope_id: 'group:ITS-21',
        author_user_id: 'author',
        payload: {},
        pinned: false,
        created_at: now,
        updated_at: now,
        deleted_at: null,
        deleted_by_user_id: null,
        deleted_reason: null,
        ...partial,
    };
    store.entities.push(row);
    return row;
}

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function ilikeMatch(value: unknown, pattern: string): boolean {
    if (typeof value !== 'string') return false;
    // Pattern is `%term%` with backslash-escapes for `%`, `_`, `\`. The fake
    // implementation strips outer `%` and does a plain case-insensitive
    // substring check — good enough for the assertion surface here.
    const inner = pattern.replace(/^%/, '').replace(/%$/, '').replace(/\\([%_\\])/g, '$1');
    return value.toLowerCase().includes(inner.toLowerCase());
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            // Aggregates (single combined query joining reactions / comments /
            // attachments). We return zero-rollups for every requested id —
            // the search service only needs the aggregates to be present.
            if (text.startsWith('select') && text.includes('reaction_emojis')) {
                const [ids] = params as [string[]];
                return {
                    rows: ids.map((id) => ({
                        id,
                        reaction_emojis: [],
                        reaction_counts: [],
                        comment_count: '0',
                        attachment_count: '0',
                    })),
                    rowCount: ids.length,
                };
            }

            // Viewer reactions (per-id, returns []).
            if (text.startsWith('select entity_id::text as entity_id, emoji')) {
                return { rows: [], rowCount: 0 };
            }

            // Viewer "already seen" markers — search enriches each hit with
            // `hasViewed`. No view rows are modelled here, so return [].
            if (
                text.startsWith('select entity_id::text as entity_id')
                && text.includes('from app_social_view')
            ) {
                return { rows: [], rowCount: 0 };
            }

            // Universal search SELECT.
            if (
                text.startsWith('select * from app_social_entity')
                && text.includes("payload->>'title'")
            ) {
                const likePattern = params[0] as string;
                let extraIdx = 1;
                let scopeFilter: string[] | null = null;
                let scopeIdFilter: string[] | null = null;
                let kindFilter: string[] | null = null;

                if (text.includes('scope_type = any(')) {
                    scopeFilter = params[extraIdx] as string[];
                    extraIdx += 1;
                }
                if (text.includes('scope_id = any(')) {
                    scopeIdFilter = params[extraIdx] as string[];
                    extraIdx += 1;
                }
                if (text.includes('kind = any(')) {
                    kindFilter = params[extraIdx] as string[];
                    extraIdx += 1;
                }
                const limit = params[extraIdx] as number;

                let filtered = store.entities.filter((e) => !e.deleted_at).filter((e) => {
                    const p = e.payload;
                    return (
                        ilikeMatch(p['title'], likePattern)
                        || ilikeMatch(p['body'], likePattern)
                        || ilikeMatch(p['subject'], likePattern)
                        || ilikeMatch(p['note'], likePattern)
                    );
                });
                if (scopeFilter) filtered = filtered.filter((e) => scopeFilter!.includes(e.scope_type));
                if (scopeIdFilter) filtered = filtered.filter((e) => scopeIdFilter!.includes(e.scope_id));
                if (kindFilter) filtered = filtered.filter((e) => kindFilter!.includes(e.kind));
                filtered = filtered
                    .slice()
                    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
                    .slice(0, limit);
                return { rows: filtered, rowCount: filtered.length };
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

vi.mock('./group-space.js', () => ({
    assertCanReadGroup: vi.fn(async (userId: string, groupKey: string) => {
        const key = `${userId}::${groupKey}`;
        if (store.groupAccess.get(key)) return;
        throw new Error('Forbidden');
    }),
}));

import {
    SOCIAL_SEARCH_DEFAULT_LIMIT,
    SOCIAL_SEARCH_MAX_LIMIT,
    SOCIAL_SEARCH_MAX_QUERY_LENGTH,
    SOCIAL_SEARCH_MIN_QUERY_LENGTH,
    clampSocialSearchLimit,
    escapeSocialSearchLike,
    isSocialSearchHitVisible,
    normalizeSocialSearchQuery,
    searchSocialEntities,
} from './social.js';

beforeEach(() => {
    reset();
});

describe('normalizeSocialSearchQuery', () => {
    it('returns null for non-string input', () => {
        expect(normalizeSocialSearchQuery(undefined)).toBeNull();
        expect(normalizeSocialSearchQuery(null)).toBeNull();
        expect(normalizeSocialSearchQuery(42 as unknown as string)).toBeNull();
    });

    it('returns null for queries shorter than the minimum length', () => {
        expect(normalizeSocialSearchQuery('')).toBeNull();
        expect(normalizeSocialSearchQuery(' ')).toBeNull();
        expect(normalizeSocialSearchQuery('a')).toBeNull();
        expect(normalizeSocialSearchQuery('  b  ')).toBeNull();
    });

    it('trims whitespace and returns the canonical query', () => {
        expect(normalizeSocialSearchQuery('  hello  ')).toBe('hello');
    });

    it('hard-truncates at SOCIAL_SEARCH_MAX_QUERY_LENGTH characters', () => {
        const huge = 'a'.repeat(SOCIAL_SEARCH_MAX_QUERY_LENGTH + 50);
        const out = normalizeSocialSearchQuery(huge);
        expect(out).not.toBeNull();
        expect(out!.length).toBe(SOCIAL_SEARCH_MAX_QUERY_LENGTH);
    });

    it('accepts queries of exactly the minimum length', () => {
        const exact = 'a'.repeat(SOCIAL_SEARCH_MIN_QUERY_LENGTH);
        expect(normalizeSocialSearchQuery(exact)).toBe(exact);
    });
});

describe('escapeSocialSearchLike', () => {
    it('escapes `%`, `_`, and `\\` so LIKE treats them as literals', () => {
        expect(escapeSocialSearchLike('100%')).toBe('100\\%');
        expect(escapeSocialSearchLike('one_two')).toBe('one\\_two');
        expect(escapeSocialSearchLike('back\\slash')).toBe('back\\\\slash');
    });

    it('passes through ordinary characters unchanged', () => {
        expect(escapeSocialSearchLike('hello world')).toBe('hello world');
        expect(escapeSocialSearchLike('русский запрос')).toBe('русский запрос');
    });
});

describe('clampSocialSearchLimit', () => {
    it('returns the default for non-numeric input', () => {
        expect(clampSocialSearchLimit(undefined)).toBe(SOCIAL_SEARCH_DEFAULT_LIMIT);
        expect(clampSocialSearchLimit('20' as unknown as number)).toBe(SOCIAL_SEARCH_DEFAULT_LIMIT);
        expect(clampSocialSearchLimit(Number.NaN)).toBe(SOCIAL_SEARCH_DEFAULT_LIMIT);
    });

    it('clamps below 1 and above MAX_LIMIT', () => {
        expect(clampSocialSearchLimit(0)).toBe(1);
        expect(clampSocialSearchLimit(-5)).toBe(1);
        expect(clampSocialSearchLimit(SOCIAL_SEARCH_MAX_LIMIT + 100)).toBe(SOCIAL_SEARCH_MAX_LIMIT);
    });

    it('floors fractional values', () => {
        expect(clampSocialSearchLimit(7.9)).toBe(7);
    });
});

describe('isSocialSearchHitVisible', () => {
    const allowed = new Set<string>(['group:ITS-21']);

    it('allows global / announcement scopes for any viewer', () => {
        expect(isSocialSearchHitVisible({ scopeType: 'global', scopeId: 'global:chat' }, 'alice', allowed)).toBe(true);
        expect(isSocialSearchHitVisible({ scopeType: 'announcement', scopeId: 'announcement:global' }, 'bob', allowed)).toBe(true);
    });

    it('allows group hits only when the scope is in the allowed set', () => {
        expect(isSocialSearchHitVisible({ scopeType: 'group', scopeId: 'group:ITS-21' }, 'alice', allowed)).toBe(true);
        expect(isSocialSearchHitVisible({ scopeType: 'group', scopeId: 'group:NOPE' }, 'alice', allowed)).toBe(false);
    });

    it('allows dm hits only when viewer is a participant of the room', () => {
        const dm = { scopeType: 'dm' as const, scopeId: 'dm:direct:alice::bob' };
        expect(isSocialSearchHitVisible(dm, 'alice', allowed)).toBe(true);
        expect(isSocialSearchHitVisible(dm, 'bob', allowed)).toBe(true);
        expect(isSocialSearchHitVisible(dm, 'mallory', allowed)).toBe(false);
    });

    it('rejects when viewerUserId is empty', () => {
        expect(isSocialSearchHitVisible({ scopeType: 'global', scopeId: 'global:chat' }, '', allowed)).toBe(false);
    });

    it('rejects dm hits with malformed scope ids', () => {
        expect(isSocialSearchHitVisible({ scopeType: 'dm', scopeId: 'dm:not-a-direct-room' }, 'alice', allowed)).toBe(false);
    });
});

describe('searchSocialEntities — validation', () => {
    it('throws when the query is shorter than the minimum length', async () => {
        await expect(searchSocialEntities('a', { viewerUserId: 'alice' })).rejects.toThrow(/too short/);
    });

    it('throws when the query is longer than the maximum length', async () => {
        const huge = 'a'.repeat(SOCIAL_SEARCH_MAX_QUERY_LENGTH + 1);
        await expect(searchSocialEntities(huge, { viewerUserId: 'alice' })).rejects.toThrow(/too long/);
    });

    it('throws when viewerUserId is empty', async () => {
        await expect(searchSocialEntities('hello', { viewerUserId: '' })).rejects.toThrow(/viewerUserId/);
    });
});

describe('searchSocialEntities — ILIKE matching + auth filter', () => {
    it('matches against title / body / subject / note (case-insensitive substring)', async () => {
        store.groupAccess.set('alice::ITS-21', true);
        pushEntity({ payload: { title: 'Math LECTURE', body: '' }, kind: 'post', scope_id: 'group:ITS-21' });
        pushEntity({ payload: { body: 'remember math classes' }, kind: 'post', scope_id: 'group:ITS-21' });
        pushEntity({ payload: { subject: 'Math practice' }, kind: 'extra_lesson', scope_id: 'group:ITS-21' });
        pushEntity({ payload: { note: 'side math note' }, kind: 'extra_lesson', scope_id: 'group:ITS-21' });
        pushEntity({ payload: { body: 'no match here' }, kind: 'post', scope_id: 'group:ITS-21' });

        const res = await searchSocialEntities('math', { viewerUserId: 'alice' });
        expect(res.total).toBe(4);
        expect(res.results.map((r) => r.entity.id).sort()).toEqual(['id-000001', 'id-000002', 'id-000003', 'id-000004']);
    });

    it('drops soft-deleted entities entirely', async () => {
        store.groupAccess.set('alice::ITS-21', true);
        pushEntity({ payload: { body: 'live math' }, scope_id: 'group:ITS-21' });
        pushEntity({ payload: { body: 'deleted math' }, scope_id: 'group:ITS-21', deleted_at: new Date() });

        const res = await searchSocialEntities('math', { viewerUserId: 'alice' });
        expect(res.total).toBe(1);
        expect(res.results[0].entity.payload).toEqual({ body: 'live math' });
    });

    it('respects the kind filter', async () => {
        store.groupAccess.set('alice::ITS-21', true);
        pushEntity({ payload: { body: 'task math' }, kind: 'task', scope_id: 'group:ITS-21' });
        pushEntity({ payload: { body: 'post math' }, kind: 'post', scope_id: 'group:ITS-21' });

        const res = await searchSocialEntities('math', {
            viewerUserId: 'alice',
            kinds: ['task'],
        });
        expect(res.total).toBe(1);
        expect(res.results[0].entity.kind).toBe('task');
    });

    it('respects the scopeType filter', async () => {
        store.groupAccess.set('alice::ITS-21', true);
        pushEntity({ payload: { body: 'group math' }, scope_type: 'group', scope_id: 'group:ITS-21' });
        pushEntity({ payload: { body: 'global math' }, scope_type: 'global', scope_id: 'global:chat', kind: 'global_message' });

        const res = await searchSocialEntities('math', {
            viewerUserId: 'alice',
            scopes: ['global'],
        });
        expect(res.total).toBe(1);
        expect(res.results[0].entity.scopeType).toBe('global');
    });

    it('drops group hits the viewer cannot read', async () => {
        // Viewer is only a member of ITS-21, NOT ITS-22.
        store.groupAccess.set('alice::ITS-21', true);
        pushEntity({ payload: { body: 'allowed math' }, scope_id: 'group:ITS-21' });
        pushEntity({ payload: { body: 'forbidden math' }, scope_id: 'group:ITS-22' });

        const res = await searchSocialEntities('math', { viewerUserId: 'alice' });
        expect(res.total).toBe(1);
        expect(res.results[0].entity.scopeId).toBe('group:ITS-21');
    });

    it('shows dm hits only when the viewer is a participant', async () => {
        pushEntity({
            payload: { body: 'dm math' },
            scope_type: 'dm',
            scope_id: 'dm:direct:alice::bob',
            kind: 'dm_message',
        });
        pushEntity({
            payload: { body: 'foreign math' },
            scope_type: 'dm',
            scope_id: 'dm:direct:bob::carol',
            kind: 'dm_message',
        });

        const res = await searchSocialEntities('math', { viewerUserId: 'alice' });
        expect(res.total).toBe(1);
        expect(res.results[0].entity.scopeId).toBe('dm:direct:alice::bob');
    });

    it('passes global / announcement hits straight through', async () => {
        pushEntity({
            payload: { body: 'global math' },
            scope_type: 'global',
            scope_id: 'global:chat',
            kind: 'global_message',
        });
        pushEntity({
            payload: { title: 'math notice', body: 'read carefully', priority: 'high' },
            scope_type: 'announcement',
            scope_id: 'announcement:global',
            kind: 'announcement',
        });

        const res = await searchSocialEntities('math', { viewerUserId: 'random-user' });
        expect(res.total).toBe(2);
    });

    it('clamps the limit and never returns more than SOCIAL_SEARCH_MAX_LIMIT rows', async () => {
        for (let i = 0; i < 80; i++) {
            pushEntity({
                payload: { body: `match ${i}` },
                scope_type: 'global',
                scope_id: 'global:chat',
                kind: 'global_message',
            });
        }
        const res = await searchSocialEntities('match', {
            viewerUserId: 'random-user',
            limit: 999,
        });
        expect(res.results.length).toBeLessThanOrEqual(SOCIAL_SEARCH_MAX_LIMIT);
    });

    it('returns an empty result set when nothing matches', async () => {
        store.groupAccess.set('alice::ITS-21', true);
        pushEntity({ payload: { body: 'zoology' }, scope_id: 'group:ITS-21' });

        const res = await searchSocialEntities('math', { viewerUserId: 'alice' });
        expect(res.total).toBe(0);
        expect(res.results).toEqual([]);
    });
});
