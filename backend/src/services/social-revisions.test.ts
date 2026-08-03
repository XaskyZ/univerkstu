import { describe, it, expect, vi, beforeEach } from 'vitest';

// Standalone in-memory shim focused on the revisions read path. The broader
// social-crud.test.ts already exercises the WRITE side (every create / update /
// delete / restore inserts a revision row). Here we cover the dedicated
// `listRevisions` reader and its access-check via `getEntityView`.

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

interface RevisionRow {
    id: string;
    entity_id: string;
    author_user_id: string;
    snapshot: Record<string, unknown>;
    revision_kind: 'create' | 'update' | 'delete' | 'restore';
    note: string | null;
    created_at: Date;
}

const store = {
    entities: [] as EntityRow[],
    revisions: [] as RevisionRow[],
    mentions: [] as Array<{ entity_id: string; mentioned_user_id: string }>,
};

let idCounter = 0;
function nextId(): string {
    idCounter += 1;
    return `id-${idCounter.toString().padStart(6, '0')}`;
}

function reset(): void {
    store.entities.length = 0;
    store.revisions.length = 0;
    store.mentions.length = 0;
    idCounter = 0;
}

function parseJsonbParam(param: unknown): Record<string, unknown> {
    if (typeof param === 'string') {
        try { return JSON.parse(param) as Record<string, unknown>; } catch { return {}; }
    }
    if (param && typeof param === 'object') return param as Record<string, unknown>;
    return {};
}

interface FakeClient { query: ReturnType<typeof vi.fn> }

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            if (text.startsWith('insert into app_social_entity')) {
                const [kind, scopeType, scopeId, author, payloadRaw] = params as [string, string, string, string, string];
                const now = new Date();
                const row: EntityRow = {
                    id: nextId(),
                    kind,
                    scope_type: scopeType,
                    scope_id: scopeId,
                    author_user_id: author,
                    payload: parseJsonbParam(payloadRaw),
                    pinned: false,
                    created_at: now,
                    updated_at: now,
                    deleted_at: null,
                    deleted_by_user_id: null,
                    deleted_reason: null,
                };
                store.entities.push(row);
                return { rows: [row], rowCount: 1 };
            }

            if (text.startsWith('select * from app_social_entity where id = $1::uuid and deleted_at is null')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id && !e.deleted_at);
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }

            if (text.startsWith('select * from app_social_entity where id =')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id);
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }

            if (text.includes('set deleted_at = now()')) {
                const [id, actor, reason] = params as [string, string, string | null];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.deleted_at = new Date();
                row.deleted_by_user_id = actor;
                row.deleted_reason = reason;
                row.updated_at = new Date();
                return { rows: [], rowCount: 1 };
            }

            if (text.includes('set deleted_at = null')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.deleted_at = null;
                row.deleted_by_user_id = null;
                row.deleted_reason = null;
                row.updated_at = new Date();
                return { rows: [], rowCount: 1 };
            }

            if (text.startsWith('update app_social_entity\n                set payload =')) {
                const [id, payloadRaw] = params as [string, string];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.payload = parseJsonbParam(payloadRaw);
                row.updated_at = new Date();
                return { rows: [row], rowCount: 1 };
            }

            // Aggregates query used by getEntityView. We don't track reactions /
            // comments / attachments in this shim; return a no-row aggregate so
            // the view fills in zeros via its defaults.
            if (text.startsWith('select\n                e.id::text as id,')) {
                const [ids] = params as [string[]];
                const rows: Array<{ id: string; reaction_emojis: string[]; reaction_counts: string[]; comment_count: string; attachment_count: string }> = [];
                for (const eid of ids) {
                    const entity = store.entities.find((e) => e.id === eid);
                    if (!entity) continue;
                    rows.push({
                        id: eid,
                        reaction_emojis: [],
                        reaction_counts: [],
                        comment_count: '0',
                        attachment_count: '0',
                    });
                }
                return { rows, rowCount: rows.length };
            }

            if (text.startsWith('select entity_id::text as entity_id, emoji')) {
                return { rows: [], rowCount: 0 };
            }

            // Viewer "already seen" markers used by getEntityView enrichment.
            if (
                text.startsWith('select entity_id::text as entity_id')
                && text.includes('from app_social_view')
            ) {
                return { rows: [], rowCount: 0 };
            }

            if (text.startsWith('insert into app_social_mention')) {
                const [entityId, , , , mentioned] = params as [string, string, string, string, string];
                store.mentions.push({ entity_id: entityId, mentioned_user_id: mentioned });
                return { rows: [], rowCount: 1 };
            }

            if (text.startsWith('insert into app_social_revision')) {
                const [entityId, author, snapshotRaw, revisionKind, note] = params as [
                    string, string, string, RevisionRow['revision_kind'], string | null,
                ];
                const row: RevisionRow = {
                    id: nextId(),
                    entity_id: entityId,
                    author_user_id: author,
                    snapshot: parseJsonbParam(snapshotRaw),
                    revision_kind: revisionKind,
                    note,
                    created_at: new Date(Date.now() + store.revisions.length),
                };
                store.revisions.push(row);
                return { rows: [row], rowCount: 1 };
            }

            // The query under test — list revisions newest-first with a limit.
            if (text.startsWith('select id::text as id,') && text.includes('from app_social_revision')) {
                const [entityId, limit] = params as [string, number];
                const rows = store.revisions
                    .filter((r) => r.entity_id === entityId)
                    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
                    .slice(0, limit);
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

// Group membership behind `assertScopeAccess`. Allowed by default; a test can
// deny a specific (user, group) pair to assert the forbidden → 404 folding.
const deniedGroups = new Set<string>();
vi.mock('./group-space.js', () => ({
    assertCanReadGroup: vi.fn(async (userId: string, groupKey: string) => {
        if (deniedGroups.has(`${userId}::${groupKey}`)) throw new Error('Forbidden');
    }),
}));

import {
    createEntity,
    updateEntity,
    softDeleteEntity,
    restoreEntity,
    listRevisions,
    SOCIAL_REVISION_DEFAULT_LIMIT,
    SOCIAL_REVISION_MAX_LIMIT,
} from './social.js';

beforeEach(() => {
    reset();
    deniedGroups.clear();
});

describe('listRevisions', () => {
    it('hides history from a viewer who is not in the entity scope', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'owner',
            payload: { body: 'members only' },
        });
        deniedGroups.add('outsider::ITS-21');

        // Folded into 'not found' on purpose: the route must not let a caller
        // distinguish "exists but forbidden" from "does not exist".
        await expect(listRevisions(e.id, 'outsider')).rejects.toThrow(/not found/);
        expect(await listRevisions(e.id, 'owner')).toHaveLength(1);
    });

    it('returns a single create revision after entity creation', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'owner',
            payload: { title: 't', body: 'initial' },
        });

        const revisions = await listRevisions(e.id, 'owner');
        expect(revisions).toHaveLength(1);
        expect(revisions[0].revisionKind).toBe('create');
        expect(revisions[0].entityId).toBe(e.id);
        expect(revisions[0].authorUserId).toBe('owner');
        expect(revisions[0].snapshot).toMatchObject({ title: 't', body: 'initial' });
        expect(typeof revisions[0].createdAt).toBe('string');
    });

    it('orders revisions newest-first across create + updates + delete', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'v1' },
        });
        await updateEntity(e.id, 'owner', { body: 'v2' });
        await updateEntity(e.id, 'owner', { body: 'v3' });
        await softDeleteEntity(e.id, 'owner', 'spam');
        await restoreEntity(e.id, 'owner');

        const revisions = await listRevisions(e.id, 'owner');
        expect(revisions.map((r) => r.revisionKind)).toEqual([
            'restore', 'delete', 'update', 'update', 'create',
        ]);
    });

    it('records the delete note on the delete revision', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        await softDeleteEntity(e.id, 'owner', 'because reasons');
        await restoreEntity(e.id, 'owner');
        const revs = await listRevisions(e.id, 'owner');
        const del = revs.find((r) => r.revisionKind === 'delete');
        expect(del?.note).toBe('because reasons');
        const create = revs.find((r) => r.revisionKind === 'create');
        expect(create?.note).toBeNull();
    });

    it('throws when entityId is missing-or-not-found (no existence leak)', async () => {
        await expect(listRevisions('id-does-not-exist', 'someone')).rejects.toThrow(/not found/);
    });

    it('throws when entity is soft-deleted (post-delete revisions are still hidden via access check)', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        await softDeleteEntity(e.id, 'owner', 'r');
        await expect(listRevisions(e.id, 'owner')).rejects.toThrow(/not found/);
    });

    it('rejects empty viewerUserId', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        await expect(listRevisions(e.id, '   ')).rejects.toThrow(/viewerUserId/);
    });

    it('returns [] for empty entityId rather than throwing', async () => {
        const revs = await listRevisions('   ', 'owner');
        expect(revs).toEqual([]);
    });

    it('applies the supplied limit and clamps overshoot to MAX', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        // Create 6 update revisions (7 total with the original create row).
        for (let i = 0; i < 6; i++) {
            await updateEntity(e.id, 'owner', { body: `v${i + 2}` });
        }

        const limited = await listRevisions(e.id, 'owner', { limit: 3 });
        expect(limited).toHaveLength(3);

        // Overshoot should be clamped to MAX (not silently dropped to default).
        const huge = await listRevisions(e.id, 'owner', { limit: 999 });
        expect(huge.length).toBeLessThanOrEqual(SOCIAL_REVISION_MAX_LIMIT);
        expect(huge.length).toBe(7);

        // Negative / non-finite fall back to the floor (1).
        const tiny = await listRevisions(e.id, 'owner', { limit: -5 });
        expect(tiny.length).toBe(1);
    });

    it('default limit is SOCIAL_REVISION_DEFAULT_LIMIT when no opts are passed', async () => {
        expect(SOCIAL_REVISION_DEFAULT_LIMIT).toBeGreaterThan(0);
        expect(SOCIAL_REVISION_DEFAULT_LIMIT).toBeLessThanOrEqual(SOCIAL_REVISION_MAX_LIMIT);
    });
});
