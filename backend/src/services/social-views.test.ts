/**
 * Unit tests for `services/social-views.ts`. Uses an in-memory FakeClient that
 * mirrors only the rows the social-view service touches (`app_social_view`)
 * — there is no need to model the parent `app_social_entity` table here
 * because the FK constraint is enforced in real Postgres, not by the shim.
 *
 * SQL dispatch is by leading text, matching the convention in
 * `social-crud.test.ts` and `social-read-markers.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

interface ViewRow {
    entity_id: string;
    user_id: string;
    viewed_at: Date;
}

const store = {
    views: [] as ViewRow[],
    /**
     * Scope of the parent entity, per entity id. `recordView` now resolves the
     * scope and runs `assertScopeAccess` before inserting, so the shim has to
     * answer that lookup. Ids that are absent from this map fall back to a
     * public `announcement` scope — that keeps the pre-existing view-counting
     * tests focused on counting rather than on authorization.
     */
    entityScopes: new Map<string, { scope_type: string; scope_id: string }>(),
    /** Ids the shim must report as non-existent (drives the 'not found' path). */
    unknownEntities: new Set<string>(),
    /** `${userId}::${groupKey}` pairs rejected by the mocked group gate. */
    deniedGroups: new Set<string>(),
};

function reset(): void {
    store.views.length = 0;
    store.entityScopes.clear();
    store.unknownEntities.clear();
    store.deniedGroups.clear();
}

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            // === Parent-entity scope lookup (access gate in recordView) ===
            if (text.startsWith('select scope_type, scope_id from app_social_entity')) {
                const [entityId] = params as [string];
                if (store.unknownEntities.has(entityId)) return { rows: [], rowCount: 0 };
                const scope = store.entityScopes.get(entityId)
                    ?? { scope_type: 'announcement', scope_id: 'announcement:test' };
                return { rows: [scope], rowCount: 1 };
            }

            // === Insert view (idempotent ON CONFLICT DO NOTHING) ===
            if (text.startsWith('insert into app_social_view')) {
                const [entityId, userId] = params as [string, string];
                const exists = store.views.some(
                    (v) => v.entity_id === entityId && v.user_id === userId,
                );
                if (!exists) {
                    store.views.push({
                        entity_id: entityId,
                        user_id: userId,
                        viewed_at: new Date(),
                    });
                }
                return { rows: [], rowCount: 1 };
            }

            // === Single-entity view count ===
            if (
                text.startsWith('select count(*)::text as count')
                && text.includes('from app_social_view')
            ) {
                const [entityId] = params as [string];
                const count = store.views.filter((v) => v.entity_id === entityId).length;
                return { rows: [{ count: String(count) }], rowCount: 1 };
            }

            // === Batched view counts (entity_id = any($1)) ===
            if (
                text.startsWith('select entity_id::text as entity_id, count(*)::text as count')
                && text.includes('from app_social_view')
            ) {
                const [ids] = params as [string[]];
                const buckets = new Map<string, number>();
                for (const v of store.views) {
                    if (!ids.includes(v.entity_id)) continue;
                    buckets.set(v.entity_id, (buckets.get(v.entity_id) ?? 0) + 1);
                }
                const rows = [...buckets.entries()].map(([entity_id, count]) => ({
                    entity_id,
                    count: String(count),
                }));
                return { rows, rowCount: rows.length };
            }

            // === Has user viewed (single) ===
            if (text.startsWith('select 1 from app_social_view')) {
                const [entityId, userId] = params as [string, string];
                const hit = store.views.some(
                    (v) => v.entity_id === entityId && v.user_id === userId,
                );
                return { rows: hit ? [{ '?column?': 1 }] : [], rowCount: hit ? 1 : 0 };
            }

            // === Viewer's seen entities (batch) ===
            if (
                text.startsWith('select entity_id::text as entity_id')
                && text.includes('from app_social_view')
                && text.includes('user_id = $1')
            ) {
                const [userId, ids] = params as [string, string[]];
                const hits = store.views
                    .filter((v) => v.user_id === userId && ids.includes(v.entity_id))
                    .map((v) => ({ entity_id: v.entity_id }));
                return { rows: hits, rowCount: hits.length };
            }

            // === List viewers (most-recent first, limit) ===
            if (
                text.startsWith('select user_id, viewed_at')
                && text.includes('from app_social_view')
            ) {
                const [entityId, limit] = params as [string, number];
                const rows = store.views
                    .filter((v) => v.entity_id === entityId)
                    .slice()
                    .sort((a, b) => b.viewed_at.getTime() - a.viewed_at.getTime())
                    .slice(0, limit)
                    .map((v) => ({ user_id: v.user_id, viewed_at: v.viewed_at }));
                return { rows, rowCount: rows.length };
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

// Group membership behind `assertScopeAccess` (services/social.ts). Allowed by
// default so only the dedicated test below exercises a denial.
vi.mock('./group-space.js', () => ({
    assertCanReadGroup: vi.fn(async (userId: string, groupKey: string) => {
        if (store.deniedGroups.has(`${userId}::${groupKey}`)) throw new Error('Forbidden');
    }),
}));

import {
    getViewCount,
    getViewCountsBatch,
    getViewerSeenEntities,
    hasUserViewed,
    listEntityViewers,
    recordView,
} from './social-views.js';

beforeEach(() => {
    reset();
});

describe('recordView', () => {
    it('inserts a new (entity, user) row on first call', async () => {
        await recordView('entity-1', 'alice');
        expect(store.views).toHaveLength(1);
        expect(store.views[0].entity_id).toBe('entity-1');
        expect(store.views[0].user_id).toBe('alice');
    });

    it('is idempotent — a second call from the same viewer is a no-op', async () => {
        await recordView('entity-1', 'alice');
        await recordView('entity-1', 'alice');
        await recordView('entity-1', 'alice');
        expect(store.views).toHaveLength(1);
    });

    it('records a separate row per distinct viewer on the same entity', async () => {
        await recordView('entity-1', 'alice');
        await recordView('entity-1', 'bob');
        await recordView('entity-1', 'carol');
        expect(store.views).toHaveLength(3);
    });

    it('throws when entityId or userId is missing', async () => {
        await expect(recordView('', 'alice')).rejects.toThrow(/entityId/);
        await expect(recordView('e1', '')).rejects.toThrow(/userId/);
        // Whitespace-only inputs are treated as missing too.
        await expect(recordView('   ', 'alice')).rejects.toThrow(/entityId/);
    });

    it('rejects a viewer who has no access to the parent scope', async () => {
        store.entityScopes.set('group-post', { scope_type: 'group', scope_id: 'group:ITS-21' });
        store.deniedGroups.add('outsider::ITS-21');

        await expect(recordView('group-post', 'outsider')).rejects.toThrow(/forbidden/i);
        expect(store.views).toHaveLength(0);

        // A member of the same group still records a view.
        await recordView('group-post', 'member');
        expect(store.views).toHaveLength(1);
    });

    it('rejects a dm view from someone outside the room', async () => {
        store.entityScopes.set('dm-msg', {
            scope_type: 'dm',
            scope_id: 'dm:direct:alice::bob',
        });
        await expect(recordView('dm-msg', 'carol')).rejects.toThrow(/forbidden/i);
        await recordView('dm-msg', 'bob');
        expect(store.views).toHaveLength(1);
    });

    it('throws not found for an entity that does not exist', async () => {
        store.unknownEntities.add('ghost');
        await expect(recordView('ghost', 'alice')).rejects.toThrow(/not found/);
    });
});

describe('getViewCount', () => {
    it('returns 0 for an entity with no views', async () => {
        expect(await getViewCount('entity-1')).toBe(0);
    });

    it('returns the number of distinct viewers (not call count)', async () => {
        await recordView('entity-1', 'alice');
        await recordView('entity-1', 'alice');
        await recordView('entity-1', 'bob');
        await recordView('entity-1', 'carol');
        expect(await getViewCount('entity-1')).toBe(3);
    });

    it('returns 0 when entityId is blank', async () => {
        await recordView('entity-1', 'alice');
        expect(await getViewCount('')).toBe(0);
        expect(await getViewCount('   ')).toBe(0);
    });
});

describe('getViewCountsBatch', () => {
    it('returns an empty map for an empty input', async () => {
        const out = await getViewCountsBatch([]);
        expect(out.size).toBe(0);
    });

    it('returns counts for multiple entities in one call', async () => {
        await recordView('e1', 'alice');
        await recordView('e1', 'bob');
        await recordView('e2', 'alice');
        await recordView('e3', 'carol');
        const out = await getViewCountsBatch(['e1', 'e2', 'e3', 'e4']);
        expect(out.get('e1')).toBe(2);
        expect(out.get('e2')).toBe(1);
        expect(out.get('e3')).toBe(1);
        // e4 has no views — must be absent (callers treat absent as 0).
        expect(out.has('e4')).toBe(false);
    });

    it('de-duplicates input ids and ignores blank entries', async () => {
        await recordView('e1', 'alice');
        const out = await getViewCountsBatch(['e1', 'e1', '', '   ', 'e1']);
        expect(out.get('e1')).toBe(1);
        expect(out.size).toBe(1);
    });
});

describe('hasUserViewed', () => {
    it('returns false when no row exists', async () => {
        expect(await hasUserViewed('e1', 'alice')).toBe(false);
    });

    it('returns true once a viewer is recorded', async () => {
        await recordView('e1', 'alice');
        expect(await hasUserViewed('e1', 'alice')).toBe(true);
    });

    it('does not leak across distinct users', async () => {
        await recordView('e1', 'alice');
        expect(await hasUserViewed('e1', 'bob')).toBe(false);
    });

    it('returns false on blank inputs without hitting the DB', async () => {
        expect(await hasUserViewed('', 'alice')).toBe(false);
        expect(await hasUserViewed('e1', '')).toBe(false);
    });
});

describe('getViewerSeenEntities', () => {
    it('returns an empty set for an empty input', async () => {
        const out = await getViewerSeenEntities([], 'alice');
        expect(out.size).toBe(0);
    });

    it('returns the subset of entity ids the viewer has seen', async () => {
        await recordView('e1', 'alice');
        await recordView('e3', 'alice');
        await recordView('e2', 'bob');
        const out = await getViewerSeenEntities(['e1', 'e2', 'e3'], 'alice');
        expect(out.has('e1')).toBe(true);
        expect(out.has('e2')).toBe(false);
        expect(out.has('e3')).toBe(true);
    });

    it('returns an empty set when userId is blank', async () => {
        await recordView('e1', 'alice');
        const out = await getViewerSeenEntities(['e1'], '');
        expect(out.size).toBe(0);
    });
});

describe('listEntityViewers', () => {
    it('returns most-recent viewers first', async () => {
        await recordView('e1', 'alice');
        // Force temporal separation so the sort is deterministic across runs.
        await new Promise((resolve) => setTimeout(resolve, 2));
        await recordView('e1', 'bob');
        await new Promise((resolve) => setTimeout(resolve, 2));
        await recordView('e1', 'carol');

        const viewers = await listEntityViewers('e1');
        expect(viewers.map((v) => v.userId)).toEqual(['carol', 'bob', 'alice']);
        for (const v of viewers) {
            expect(typeof v.viewedAt).toBe('string');
            // ISO timestamp shape — guards against accidental Date leakage.
            expect(v.viewedAt).toMatch(/T/);
        }
    });

    it('honours the limit parameter', async () => {
        await recordView('e1', 'alice');
        await recordView('e1', 'bob');
        await recordView('e1', 'carol');
        const viewers = await listEntityViewers('e1', 2);
        expect(viewers).toHaveLength(2);
    });

    it('returns an empty list for an unknown entity', async () => {
        expect(await listEntityViewers('unknown')).toEqual([]);
    });

    it('returns an empty list for a blank entity id', async () => {
        expect(await listEntityViewers('')).toEqual([]);
    });
});
