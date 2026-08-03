import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory shim for the social CRUD tables. Lets us drive create / update /
// delete / restore / pin / list / get / addComment / toggleReaction / attach
// without touching real Postgres. SQL dispatch is by leading text so the
// fragments here must stay in sync with services/social.ts.

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

interface CommentRow {
    id: string;
    entity_id: string;
    parent_comment_id: string | null;
    author_user_id: string;
    body: string;
    depth: number;
    created_at: Date;
    deleted_at: Date | null;
}

interface ReactionRow {
    entity_id: string;
    user_id: string;
    emoji: string;
}

interface ViewRow {
    entity_id: string;
    user_id: string;
}

interface MentionRow {
    id: string;
    entity_id: string;
    source_kind: 'entity' | 'comment';
    source_id: string;
    author_user_id: string;
    mentioned_user_id: string;
}

interface AttachmentRow {
    id: string;
    entity_id: string;
    file_id: string;
    mime: string | null;
    size_bytes: number | null;
    sort_order: number;
    created_at: Date;
}

interface UmkdFileRow {
    file_id: string;
    filename: string;
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
    comments: [] as CommentRow[],
    reactions: [] as ReactionRow[],
    views: [] as ViewRow[],
    mentions: [] as MentionRow[],
    attachments: [] as AttachmentRow[],
    revisions: [] as RevisionRow[],
    umkdFiles: [] as UmkdFileRow[],
    // `${userId}::${groupKey}` pairs that the mocked `assertCanReadGroup`
    // rejects. Empty by default so the CRUD tests below exercise the CRUD
    // logic rather than the access gate; the scope-access describe block
    // seeds it to simulate a student removed from a group.
    deniedGroups: new Set<string>(),
};

let idCounter = 0;
function nextId(): string {
    idCounter += 1;
    return `id-${idCounter.toString().padStart(6, '0')}`;
}

function reset(): void {
    store.entities.length = 0;
    store.comments.length = 0;
    store.reactions.length = 0;
    store.views.length = 0;
    store.mentions.length = 0;
    store.attachments.length = 0;
    store.revisions.length = 0;
    store.umkdFiles.length = 0;
    store.deniedGroups.clear();
    idCounter = 0;
}

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function parseJsonbParam(param: unknown): Record<string, unknown> {
    if (typeof param === 'string') {
        try {
            return JSON.parse(param) as Record<string, unknown>;
        } catch {
            return {};
        }
    }
    if (param && typeof param === 'object') return param as Record<string, unknown>;
    return {};
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            // === Entity inserts ===
            if (text.startsWith('insert into app_social_entity')) {
                const [kind, scopeType, scopeId, author, payloadRaw] = params as [
                    string, string, string, string, string,
                ];
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

            // === Single entity for view (with deleted_at is null) — must come before generic by-id ===
            if (text.startsWith('select * from app_social_entity where id = $1::uuid and deleted_at is null')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id && !e.deleted_at);
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }

            // === Entity SELECT * by id ===
            if (text.startsWith('select * from app_social_entity where id =')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id);
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }

            // === Entity select author/deleted for pin ===
            if (text.startsWith('select author_user_id, deleted_at from app_social_entity')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id);
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }

            // === Entity update payload ===
            if (text.startsWith('update app_social_entity\n                set payload =')) {
                const [id, payloadRaw] = params as [string, string];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.payload = parseJsonbParam(payloadRaw);
                row.updated_at = new Date();
                return { rows: [row], rowCount: 1 };
            }

            // === Entity soft-delete ===
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

            // === Entity restore ===
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

            // === Entity pin ===
            if (text.startsWith('update app_social_entity set pinned =')) {
                const [id, pinned] = params as [string, boolean];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.pinned = pinned;
                row.updated_at = new Date();
                return { rows: [], rowCount: 1 };
            }

            // === Entity list ===
            if (text.startsWith('select * from app_social_entity\n                where scope_type')) {
                // Find scope params (always first two), then optional kind, then limit/offset
                const scopeType = params[0] as string;
                const scopeId = params[1] as string;
                let filtered = store.entities.filter(
                    (e) => e.scope_type === scopeType && e.scope_id === scopeId,
                );
                if (!text.includes('include_deleted_disabled')) {
                    // Heuristic: if where contains "deleted_at is null"
                    if (text.includes('deleted_at is null')) {
                        filtered = filtered.filter((e) => !e.deleted_at);
                    }
                }
                // optional kind filter (3rd param exists if there are 5 params total)
                let limit: number;
                let offset: number;
                if (params.length === 5) {
                    const kind = params[2] as string;
                    filtered = filtered.filter((e) => e.kind === kind);
                    limit = params[3] as number;
                    offset = params[4] as number;
                } else {
                    limit = params[2] as number;
                    offset = params[3] as number;
                }
                if (text.includes('pinned desc')) {
                    filtered = [...filtered].sort((a, b) => {
                        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
                        return b.created_at.getTime() - a.created_at.getTime();
                    });
                } else {
                    filtered = [...filtered].sort(
                        (a, b) => b.created_at.getTime() - a.created_at.getTime(),
                    );
                }
                const paged = filtered.slice(offset, offset + limit);
                return { rows: paged, rowCount: paged.length };
            }

            // === Aggregates ===
            if (text.startsWith('select\n                e.id::text as id,')) {
                const [ids] = params as [string[]];
                const out: Array<{
                    id: string;
                    reaction_emojis: string[];
                    reaction_counts: string[];
                    comment_count: string;
                    attachment_count: string;
                }> = [];
                for (const eid of ids) {
                    const entity = store.entities.find((e) => e.id === eid);
                    if (!entity) continue;
                    const byEmoji = new Map<string, number>();
                    for (const r of store.reactions) {
                        if (r.entity_id !== eid) continue;
                        byEmoji.set(r.emoji, (byEmoji.get(r.emoji) ?? 0) + 1);
                    }
                    const sorted = [...byEmoji.entries()].sort(([a], [b]) =>
                        a < b ? -1 : a > b ? 1 : 0,
                    );
                    out.push({
                        id: eid,
                        reaction_emojis: sorted.map(([emoji]) => emoji),
                        reaction_counts: sorted.map(([, count]) => String(count)),
                        comment_count: String(
                            store.comments.filter((c) => c.entity_id === eid && !c.deleted_at).length,
                        ),
                        attachment_count: String(
                            store.attachments.filter((a) => a.entity_id === eid).length,
                        ),
                    });
                }
                return { rows: out, rowCount: out.length };
            }

            // === Viewer reactions ===
            if (text.startsWith('select entity_id::text as entity_id, emoji')) {
                const [userId, entityIds] = params as [string, string[]];
                const ids = new Set(entityIds);
                const rows = store.reactions
                    .filter((r) => r.user_id === userId && ids.has(r.entity_id))
                    .map((r) => ({ entity_id: r.entity_id, emoji: r.emoji }));
                return { rows, rowCount: rows.length };
            }

            // === Mention insert ===
            if (text.startsWith('insert into app_social_mention')) {
                const [entityId, sourceKind, sourceId, author, mentioned] = params as [
                    string, 'entity' | 'comment', string, string, string,
                ];
                const row: MentionRow = {
                    id: nextId(),
                    entity_id: entityId,
                    source_kind: sourceKind,
                    source_id: sourceId,
                    author_user_id: author,
                    mentioned_user_id: mentioned,
                };
                store.mentions.push(row);
                return { rows: [row], rowCount: 1 };
            }

            // === Revision insert ===
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
                    created_at: new Date(),
                };
                store.revisions.push(row);
                return { rows: [row], rowCount: 1 };
            }

            // === Comment list by entity (listComments) ===
            // Must come before the more generic "select entity_id::text" matcher
            // below because both prefixes begin with `select` against
            // app_social_comment but only the list query selects the full row set.
            if (
                text.startsWith('select')
                && text.includes('from app_social_comment')
                && text.includes('order by created_at asc')
            ) {
                const [entityId] = params as [string];
                const filtered = store.comments
                    .filter((c) => c.entity_id === entityId && !c.deleted_at)
                    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
                    .map((c) => ({
                        id: c.id,
                        entity_id: c.entity_id,
                        parent_comment_id: c.parent_comment_id,
                        author_user_id: c.author_user_id,
                        body: c.body,
                        depth: c.depth,
                        created_at: c.created_at,
                        updated_at: c.created_at,
                        deleted_at: c.deleted_at,
                    }));
                return { rows: filtered, rowCount: filtered.length };
            }

            // === Comment select by id ===
            if (text.startsWith('select entity_id::text as entity_id, depth, deleted_at from app_social_comment')) {
                const [id] = params as [string];
                const row = store.comments.find((c) => c.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                return {
                    rows: [{ entity_id: row.entity_id, depth: row.depth, deleted_at: row.deleted_at }],
                    rowCount: 1,
                };
            }

            // === Comment insert ===
            if (text.startsWith('insert into app_social_comment')) {
                const [entityId, parent, author, body, depth] = params as [
                    string, string | null, string, string, number,
                ];
                const row: CommentRow = {
                    id: nextId(),
                    entity_id: entityId,
                    parent_comment_id: parent,
                    author_user_id: author,
                    body,
                    depth,
                    created_at: new Date(),
                    deleted_at: null,
                };
                store.comments.push(row);
                return { rows: [{ id: row.id }], rowCount: 1 };
            }

            // === Entity select for addComment ===
            if (text.startsWith('select id::text as id, deleted_at from app_social_entity')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                return { rows: [{ id: row.id, deleted_at: row.deleted_at }], rowCount: 1 };
            }

            // === Reaction exists ===
            if (text.startsWith('select 1 from app_social_reaction')) {
                const [entityId, userId, emoji] = params as [string, string, string];
                const hit = store.reactions.some(
                    (r) => r.entity_id === entityId && r.user_id === userId && r.emoji === emoji,
                );
                return { rows: hit ? [{ '?column?': 1 }] : [], rowCount: hit ? 1 : 0 };
            }

            // === Reaction delete ===
            if (text.startsWith('delete from app_social_reaction')) {
                const [entityId, userId, emoji] = params as [string, string, string];
                const before = store.reactions.length;
                for (let i = store.reactions.length - 1; i >= 0; i--) {
                    const r = store.reactions[i];
                    if (r.entity_id === entityId && r.user_id === userId && r.emoji === emoji) {
                        store.reactions.splice(i, 1);
                    }
                }
                return { rows: [], rowCount: before - store.reactions.length };
            }

            // === Reaction insert ===
            if (text.startsWith('insert into app_social_reaction')) {
                const [entityId, userId, emoji] = params as [string, string, string];
                if (
                    !store.reactions.some(
                        (r) => r.entity_id === entityId && r.user_id === userId && r.emoji === emoji,
                    )
                ) {
                    store.reactions.push({ entity_id: entityId, user_id: userId, emoji });
                }
                return { rows: [], rowCount: 1 };
            }

            // === Reaction single-entity aggregate ===
            if (text.startsWith('select emoji, count(*)::text as count')) {
                const [entityId] = params as [string];
                const counts = new Map<string, number>();
                for (const r of store.reactions) {
                    if (r.entity_id !== entityId) continue;
                    counts.set(r.emoji, (counts.get(r.emoji) ?? 0) + 1);
                }
                const rows = [...counts.entries()]
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([emoji, count]) => ({ emoji, count: String(count) }));
                return { rows, rowCount: rows.length };
            }

            // === Reaction mine list ===
            if (text.startsWith('select emoji from app_social_reaction')) {
                const [entityId, userId] = params as [string, string];
                const rows = store.reactions
                    .filter((r) => r.entity_id === entityId && r.user_id === userId)
                    .map((r) => ({ emoji: r.emoji }));
                return { rows, rowCount: rows.length };
            }

            // === View marker lookup ===
            if (
                text.startsWith('select entity_id::text as entity_id')
                && text.includes('from app_social_view')
            ) {
                const [userId, ids] = params as [string, string[]];
                const idSet = new Set(ids);
                const rows = store.views
                    .filter((view) => view.user_id === userId && idSet.has(view.entity_id))
                    .map((view) => ({ entity_id: view.entity_id }));
                return { rows, rowCount: rows.length };
            }

            // === Attachment insert ===
            if (text.startsWith('insert into app_social_attachment')) {
                const [entityId, fileId, mime, sizeBytes, sortOrder] = params as [
                    string, string, string | null, number | null, number,
                ];
                const row: AttachmentRow = {
                    id: nextId(),
                    entity_id: entityId,
                    file_id: fileId,
                    mime,
                    size_bytes: sizeBytes,
                    sort_order: sortOrder,
                    created_at: new Date(),
                };
                store.attachments.push(row);
                return { rows: [{ id: row.id }], rowCount: 1 };
            }

            // === Attachment list by entity (listAttachments) ===
            // The real query LEFT JOINs `app_umkd_files` on file_id to resolve
            // the original upload filename. We mimic the join here by looking
            // up the file row in `store.umkdFiles` and returning `null` when
            // no row exists (matches the LEFT JOIN semantics).
            if (
                text.startsWith('select')
                && text.includes('from app_social_attachment a')
                && text.includes('left join app_umkd_files f')
                && text.includes('order by a.sort_order asc')
            ) {
                const [entityId] = params as [string];
                const filtered = store.attachments
                    .filter((a) => a.entity_id === entityId)
                    .slice()
                    .sort((a, b) => {
                        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
                        return a.created_at.getTime() - b.created_at.getTime();
                    })
                    .map((a) => {
                        const file = store.umkdFiles.find((f) => f.file_id === a.file_id);
                        return {
                            id: a.id,
                            entity_id: a.entity_id,
                            file_id: a.file_id,
                            mime: a.mime,
                            size_bytes: a.size_bytes,
                            sort_order: a.sort_order,
                            created_at: a.created_at,
                            filename: file ? file.filename : null,
                        };
                    });
                return { rows: filtered, rowCount: filtered.length };
            }

            // === Attachment owner-lookup join (removeAttachment) ===
            if (
                text.startsWith('select')
                && text.includes('from app_social_attachment a')
                && text.includes('join app_social_entity e')
            ) {
                const [attachmentId] = params as [string];
                const att = store.attachments.find((a) => a.id === attachmentId);
                if (!att) return { rows: [], rowCount: 0 };
                const entity = store.entities.find((e) => e.id === att.entity_id);
                if (!entity) return { rows: [], rowCount: 0 };
                return {
                    rows: [{
                        attachment_id: att.id,
                        author_user_id: entity.author_user_id,
                        deleted_at: entity.deleted_at,
                    }],
                    rowCount: 1,
                };
            }

            // === Attachment delete ===
            if (text.startsWith('delete from app_social_attachment')) {
                const [attachmentId] = params as [string];
                const before = store.attachments.length;
                for (let i = store.attachments.length - 1; i >= 0; i--) {
                    if (store.attachments[i].id === attachmentId) {
                        store.attachments.splice(i, 1);
                    }
                }
                return { rows: [], rowCount: before - store.attachments.length };
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

// `assertScopeAccess` delegates group scopes to `assertCanReadGroup`, which in
// production runs two membership/role queries. Mock the module instead of the
// SQL so a test can flip a single user out of a single group (the "removed
// member" case) without modelling the whole RBAC schema. Default = allowed.
vi.mock('./group-space.js', () => ({
    assertCanReadGroup: vi.fn(async (userId: string, groupKey: string) => {
        if (store.deniedGroups.has(`${userId}::${groupKey}`)) {
            throw new Error('Forbidden');
        }
    }),
}));

import {
    createEntity,
    updateEntity,
    softDeleteEntity,
    restoreEntity,
    pinEntity,
    listEntitiesByScope,
    getEntityView,
    addComment,
    listComments,
    toggleReaction,
    attachFile,
    listAttachments,
    removeAttachment,
} from './social.js';

beforeEach(() => {
    reset();
});

describe('createEntity', () => {
    it('inserts an entity, extracts mentions, writes a create revision', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'user-1',
            payload: { body: 'Hello @alice and @bob' },
        });

        expect(e.id).toMatch(/^id-/);
        expect(e.kind).toBe('post');
        expect(e.scopeType).toBe('group');
        expect(e.scopeId).toBe('group:ITS-21');
        expect(e.authorUserId).toBe('user-1');
        expect(e.pinned).toBe(false);
        expect(e.deletedAt).toBeNull();
        expect(store.entities).toHaveLength(1);

        const mentions = store.mentions.filter((m) => m.entity_id === e.id);
        expect(mentions.map((m) => m.mentioned_user_id).sort()).toEqual(['alice', 'bob']);
        for (const m of mentions) {
            expect(m.source_kind).toBe('entity');
            expect(m.source_id).toBe(e.id);
        }

        const revisions = store.revisions.filter((r) => r.entity_id === e.id);
        expect(revisions).toHaveLength(1);
        expect(revisions[0].revision_kind).toBe('create');
    });

    it('extracts mentions from poll question and announcement title too', async () => {
        const poll = await createEntity({
            kind: 'poll',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'u',
            payload: { question: 'ping @alice?', options: [{ id: 'a', label: 'yes' }] },
        });
        expect(
            store.mentions.filter((m) => m.entity_id === poll.id).map((m) => m.mentioned_user_id),
        ).toEqual(['alice']);

        const ann = await createEntity({
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:all',
            authorUserId: 'u',
            payload: { title: 'attn @bob', body: 'see @carol', priority: 'high' },
        });
        expect(
            store.mentions
                .filter((m) => m.entity_id === ann.id)
                .map((m) => m.mentioned_user_id)
                .sort(),
        ).toEqual(['bob', 'carol']);
    });

    it('requires authorUserId and scopeId', async () => {
        await expect(
            createEntity({
                kind: 'post',
                scopeType: 'group',
                scopeId: 'group:x',
                authorUserId: '',
                payload: { body: 'x' },
            }),
        ).rejects.toThrow(/authorUserId/);
        await expect(
            createEntity({
                kind: 'post',
                scopeType: 'group',
                scopeId: '',
                authorUserId: 'u',
                payload: { body: 'x' },
            }),
        ).rejects.toThrow(/scopeId/);
    });
});

describe('updateEntity', () => {
    it('rejects when actor is not the author', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'original' },
        });
        await expect(
            updateEntity(e.id, 'someone-else', { body: 'hijack' }),
        ).rejects.toThrow(/forbidden/);
    });

    it('rejects on missing or deleted entity', async () => {
        await expect(updateEntity('id-nope', 'u', { body: 'x' })).rejects.toThrow(/not found/);
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        await softDeleteEntity(e.id, 'owner');
        await expect(updateEntity(e.id, 'owner', { body: 'x' })).rejects.toThrow(/not found/);
    });

    it('merges patch into payload and records update revision', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { title: 'orig', body: 'original' },
        });

        const updated = await updateEntity(e.id, 'owner', { body: 'edited' });
        expect((updated.payload as { title: string; body: string }).title).toBe('orig');
        expect((updated.payload as { title: string; body: string }).body).toBe('edited');

        const revisions = store.revisions.filter((r) => r.entity_id === e.id);
        const updates = revisions.filter((r) => r.revision_kind === 'update');
        expect(updates).toHaveLength(1);
    });

    it('only inserts mentions for newly added handles (diff)', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'hello @alice' },
        });
        const beforeMentions = store.mentions.filter((m) => m.entity_id === e.id).length;
        expect(beforeMentions).toBe(1);

        await updateEntity(e.id, 'owner', { body: 'hello @alice and @bob' });

        const all = store.mentions
            .filter((m) => m.entity_id === e.id)
            .map((m) => m.mentioned_user_id);
        // 'alice' was already mentioned — should not be re-inserted. 'bob' is new.
        expect(all.sort()).toEqual(['alice', 'bob']);
    });
});

describe('softDeleteEntity / restoreEntity', () => {
    it('soft-delete writes a delete revision and is idempotent', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        await softDeleteEntity(e.id, 'owner', 'because');
        const row = store.entities.find((r) => r.id === e.id);
        expect(row?.deleted_at).not.toBeNull();
        expect(row?.deleted_by_user_id).toBe('owner');
        expect(row?.deleted_reason).toBe('because');

        const revs = store.revisions.filter((r) => r.entity_id === e.id);
        expect(revs.filter((r) => r.revision_kind === 'delete')).toHaveLength(1);

        // Idempotent second call should not throw and not write another revision.
        await softDeleteEntity(e.id, 'owner');
        const revsAfter = store.revisions.filter(
            (r) => r.entity_id === e.id && r.revision_kind === 'delete',
        );
        expect(revsAfter).toHaveLength(1);
    });

    it('soft-delete rejects non-author', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        await expect(softDeleteEntity(e.id, 'someone-else')).rejects.toThrow(/forbidden/);
    });

    it('restore reverses delete and writes a restore revision', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        await softDeleteEntity(e.id, 'owner');
        await restoreEntity(e.id, 'owner');

        const row = store.entities.find((r) => r.id === e.id);
        expect(row?.deleted_at).toBeNull();
        expect(row?.deleted_reason).toBeNull();

        const restoreRevs = store.revisions.filter(
            (r) => r.entity_id === e.id && r.revision_kind === 'restore',
        );
        expect(restoreRevs).toHaveLength(1);
    });
});

describe('pinEntity', () => {
    it('updates pinned flag, owner-only, no revision written', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        const revsBefore = store.revisions.filter((r) => r.entity_id === e.id).length;
        await pinEntity(e.id, 'owner', true);
        const row = store.entities.find((r) => r.id === e.id);
        expect(row?.pinned).toBe(true);

        // No revision should have been added for pin.
        const revsAfter = store.revisions.filter((r) => r.entity_id === e.id).length;
        expect(revsAfter).toBe(revsBefore);

        await expect(pinEntity(e.id, 'intruder', false)).rejects.toThrow(/forbidden/);
    });
});

describe('listEntitiesByScope', () => {
    it('returns aggregates and viewer reactions for the scope', async () => {
        const a = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'u1',
            payload: { body: 'first' },
        });
        const b = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'u2',
            payload: { body: 'second' },
        });
        await toggleReaction(a.id, 'viewer', '👍');
        await toggleReaction(b.id, 'someone', '❤️');
        await addComment(a.id, 'commenter', 'nice');

        const views = await listEntitiesByScope('group', 'group:ITS-21', { viewerUserId: 'viewer' });
        expect(views).toHaveLength(2);
        const viewA = views.find((v) => v.entity.id === a.id)!;
        const viewB = views.find((v) => v.entity.id === b.id)!;
        expect(viewA.reactions.find((r) => r.emoji === '👍')?.count).toBe(1);
        expect(viewA.myReactions).toEqual(['👍']);
        expect(viewA.commentCount).toBe(1);
        expect(viewB.reactions.find((r) => r.emoji === '❤️')?.count).toBe(1);
        expect(viewB.myReactions).toEqual([]);
    });

    it('hides deleted entities by default', async () => {
        const a = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'visible' },
        });
        const b = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'gone' },
        });
        await softDeleteEntity(b.id, 'u');

        // A viewer is mandatory now — listEntitiesByScope runs assertScopeAccess
        // and an empty viewer id is treated as unauthenticated.
        const views = await listEntitiesByScope('group', 'group:x', { viewerUserId: 'viewer' });
        expect(views.map((v) => v.entity.id)).toEqual([a.id]);
    });
});

describe('getEntityView', () => {
    it('returns null for missing or deleted entities', async () => {
        expect(await getEntityView('id-nope', 'viewer')).toBeNull();
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        await softDeleteEntity(e.id, 'u');
        expect(await getEntityView(e.id, 'viewer')).toBeNull();
    });

    it('returns the entity and aggregates when found', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        await toggleReaction(e.id, 'viewer', '🎉');
        const view = await getEntityView(e.id, 'viewer');
        expect(view).not.toBeNull();
        expect(view!.entity.id).toBe(e.id);
        expect(view!.reactions.find((r) => r.emoji === '🎉')?.count).toBe(1);
        expect(view!.myReactions).toEqual(['🎉']);
    });
});

describe('addComment', () => {
    it('inserts a top-level comment with depth=0', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const c = await addComment(e.id, 'commenter', 'first @alice');
        const row = store.comments.find((r) => r.id === c.id);
        expect(row?.depth).toBe(0);
        expect(row?.parent_comment_id).toBeNull();

        const mention = store.mentions.find((m) => m.source_id === c.id);
        expect(mention?.mentioned_user_id).toBe('alice');
        expect(mention?.source_kind).toBe('comment');
    });

    it('rejects when parent does not exist', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        await expect(addComment(e.id, 'c', 'hi', 'id-nonsense')).rejects.toThrow(/parent not found/);
    });

    it('enforces depth cap of 1 (no reply-to-reply)', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const top = await addComment(e.id, 'c', 'top');
        const reply = await addComment(e.id, 'c', 'reply', top.id);
        const replyRow = store.comments.find((r) => r.id === reply.id);
        expect(replyRow?.depth).toBe(1);

        await expect(addComment(e.id, 'c', 'too deep', reply.id)).rejects.toThrow(
            /comment depth limit/,
        );
    });

    it('rejects empty comment body via validator', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        await expect(addComment(e.id, 'c', '')).rejects.toThrow(/empty/);
        await expect(addComment(e.id, 'c', '   ')).rejects.toThrow(/empty/);
    });

    it('rejects on missing or deleted entity', async () => {
        await expect(addComment('id-nope', 'c', 'hi')).rejects.toThrow(/not found/);
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        await softDeleteEntity(e.id, 'u');
        await expect(addComment(e.id, 'c', 'hi')).rejects.toThrow(/not found/);
    });
});

describe('toggleReaction', () => {
    it('rejects invalid emojis', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        await expect(toggleReaction(e.id, 'u', '🔥')).rejects.toThrow(/invalid emoji/);
        await expect(toggleReaction(e.id, 'u', '')).rejects.toThrow(/invalid emoji/);
    });

    it('toggles idempotently and returns up-to-date aggregates', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });

        const first = await toggleReaction(e.id, 'viewer', '👍');
        expect(first.added).toBe(true);
        expect(first.reactions.find((r) => r.emoji === '👍')?.count).toBe(1);
        expect(first.mine).toEqual(['👍']);

        const second = await toggleReaction(e.id, 'viewer', '👍');
        expect(second.added).toBe(false);
        expect(second.reactions.find((r) => r.emoji === '👍')).toBeUndefined();
        expect(second.mine).toEqual([]);
    });
});

describe('attachFile', () => {
    it('inserts an attachment row and returns its id', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const att = await attachFile(e.id, 'file-abc', 'image/png', 123, 2, 'u');
        const row = store.attachments.find((a) => a.id === att.id);
        expect(row?.entity_id).toBe(e.id);
        expect(row?.file_id).toBe('file-abc');
        expect(row?.mime).toBe('image/png');
        expect(row?.size_bytes).toBe(123);
        expect(row?.sort_order).toBe(2);
    });

    it('defaults optional fields', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const att = await attachFile(e.id, 'file-xyz', undefined, undefined, undefined, 'u');
        const row = store.attachments.find((a) => a.id === att.id);
        expect(row?.mime).toBeNull();
        expect(row?.size_bytes).toBeNull();
        expect(row?.sort_order).toBe(0);
    });

    it('requires entityId and fileId', async () => {
        await expect(
            attachFile('', 'f', undefined, undefined, undefined, 'u'),
        ).rejects.toThrow(/entityId/);
        await expect(
            attachFile('e', '', undefined, undefined, undefined, 'u'),
        ).rejects.toThrow(/fileId/);
        await expect(
            attachFile('e', 'f', undefined, undefined, undefined, '  '),
        ).rejects.toThrow(/actorUserId/);
    });
});

describe('listComments', () => {
    it('returns [] for an entity with no comments', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const comments = await listComments(e.id, 'viewer');
        expect(comments).toEqual([]);
    });

    it('returns multiple comments in created_at ascending order', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const c1 = await addComment(e.id, 'commenter-a', 'first');
        const c2 = await addComment(e.id, 'commenter-b', 'second');
        const c3 = await addComment(e.id, 'commenter-c', 'third');

        const comments = await listComments(e.id, 'viewer');
        expect(comments.map((c) => c.id)).toEqual([c1.id, c2.id, c3.id]);
        expect(comments.map((c) => c.body)).toEqual(['first', 'second', 'third']);
        // Every top-level comment must have depth=0 and a null parent.
        for (const c of comments) {
            expect(c.depth).toBe(0);
            expect(c.parentCommentId).toBeNull();
            expect(c.entityId).toBe(e.id);
            expect(c.deletedAt).toBeNull();
        }
    });

    it('skips soft-deleted comments', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const c1 = await addComment(e.id, 'a', 'keep me');
        const c2 = await addComment(e.id, 'b', 'tombstone');
        // Soft-delete via the in-memory store directly — there is no public
        // softDeleteComment helper yet, but the SELECT must still respect
        // `deleted_at is null`.
        const row = store.comments.find((c) => c.id === c2.id);
        if (row) row.deleted_at = new Date();

        const comments = await listComments(e.id, 'viewer');
        expect(comments.map((c) => c.id)).toEqual([c1.id]);
    });

    it('returns parents and replies (depth-1) in chronological order', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const top = await addComment(e.id, 'a', 'top-level');
        const reply = await addComment(e.id, 'b', 'replying', top.id);

        const comments = await listComments(e.id, 'viewer');
        expect(comments).toHaveLength(2);
        const topRow = comments.find((c) => c.id === top.id);
        const replyRow = comments.find((c) => c.id === reply.id);
        expect(topRow?.depth).toBe(0);
        expect(topRow?.parentCommentId).toBeNull();
        expect(replyRow?.depth).toBe(1);
        expect(replyRow?.parentCommentId).toBe(top.id);
    });

    it('returns [] for an unknown entity (no 404)', async () => {
        // Recommendation in the spec: simpler client surface. The helper just
        // returns an empty list when the entity does not exist; route layer
        // does not have to special-case missing entities.
        const comments = await listComments('id-does-not-exist', 'viewer');
        expect(comments).toEqual([]);
    });

    it('returns [] for an empty entityId without hitting the DB', async () => {
        const comments = await listComments('   ', 'viewer');
        expect(comments).toEqual([]);
    });
});

describe('listAttachments', () => {
    it('returns [] for an entity with no attachments', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const result = await listAttachments(e.id, 'viewer');
        expect(result).toEqual([]);
    });

    it('returns multiple attachments ordered by sort_order asc', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const a1 = await attachFile(e.id, 'file-third', 'image/png', 100, 5, 'u');
        const a2 = await attachFile(e.id, 'file-first', 'image/jpeg', 200, 1, 'u');
        const a3 = await attachFile(e.id, 'file-second', null, null, 2, 'u');

        const result = await listAttachments(e.id, 'viewer');
        expect(result.map((r) => r.id)).toEqual([a2.id, a3.id, a1.id]);
        expect(result.map((r) => r.fileId)).toEqual(['file-first', 'file-second', 'file-third']);
        expect(result[0].mime).toBe('image/jpeg');
        expect(result[0].sizeBytes).toBe(200);
        expect(result[0].sortOrder).toBe(1);
        expect(result[1].mime).toBeNull();
        expect(result[1].sizeBytes).toBeNull();
        for (const row of result) {
            expect(row.entityId).toBe(e.id);
            expect(typeof row.createdAt).toBe('string');
        }
    });

    it('returns [] for an unknown entity (no 404)', async () => {
        const result = await listAttachments('id-does-not-exist', 'viewer');
        expect(result).toEqual([]);
    });

    it('returns [] for an empty/blank entityId without hitting the DB', async () => {
        const result = await listAttachments('   ', 'viewer');
        expect(result).toEqual([]);
    });

    it('only includes attachments for the requested entity', async () => {
        const a = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'a' },
        });
        const b = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        await attachFile(a.id, 'file-a1', undefined, undefined, undefined, 'u');
        await attachFile(a.id, 'file-a2', undefined, undefined, undefined, 'u');
        await attachFile(b.id, 'file-b1', undefined, undefined, undefined, 'u');

        const forA = await listAttachments(a.id, 'viewer');
        const forB = await listAttachments(b.id, 'viewer');
        expect(forA.map((r) => r.fileId).sort()).toEqual(['file-a1', 'file-a2']);
        expect(forB.map((r) => r.fileId)).toEqual(['file-b1']);
    });

    it('resolves filename via JOIN on app_umkd_files when the file row exists', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        // Seed the UMKD file metadata row that the listAttachments JOIN reads.
        store.umkdFiles.push({ file_id: 'file-with-name', filename: 'Lecture-3.pdf' });
        await attachFile(e.id, 'file-with-name', 'application/pdf', 4096, 0, 'u');

        const result = await listAttachments(e.id, 'viewer');
        expect(result).toHaveLength(1);
        expect(result[0].filename).toBe('Lecture-3.pdf');
    });

    it('returns filename: null when the joined file row is missing', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        // No umkdFiles entry — simulates an orphaned attachment row.
        await attachFile(e.id, 'orphan-file-id', 'application/pdf', 1, 0, 'u');

        const result = await listAttachments(e.id, 'viewer');
        expect(result).toHaveLength(1);
        expect(result[0].filename).toBeNull();
    });

    it('returns filename for some rows and null for others in one list', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        store.umkdFiles.push({ file_id: 'has-name-1', filename: 'first.docx' });
        store.umkdFiles.push({ file_id: 'has-name-2', filename: 'фото.png' });
        await attachFile(e.id, 'has-name-1', null, null, 1, 'u');
        await attachFile(e.id, 'no-name', null, null, 2, 'u');
        await attachFile(e.id, 'has-name-2', null, null, 3, 'u');

        const result = await listAttachments(e.id, 'viewer');
        // Ordered by sort_order asc.
        expect(result.map((r) => r.filename)).toEqual(['first.docx', null, 'фото.png']);
    });

    it('preserves Unicode and special characters in the resolved filename', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        const tricky = 'Курсовая работа (final, v2)!.docx';
        store.umkdFiles.push({ file_id: 'unicode-file', filename: tricky });
        await attachFile(e.id, 'unicode-file', null, null, 0, 'u');

        const result = await listAttachments(e.id, 'viewer');
        expect(result[0].filename).toBe(tricky);
    });

    it('treats an empty-string filename in the file row as null', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'u',
            payload: { body: 'b' },
        });
        // Defensive: if a file row somehow has an empty filename, the helper
        // should normalize it to null so the UI fallback path runs cleanly.
        store.umkdFiles.push({ file_id: 'empty-name', filename: '' });
        await attachFile(e.id, 'empty-name', null, null, 0, 'u');

        const result = await listAttachments(e.id, 'viewer');
        expect(result[0].filename).toBeNull();
    });
});

describe('removeAttachment', () => {
    it('happy path: entity author can remove their own attachment', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        const att = await attachFile(e.id, 'file-xyz', 'image/png', 99, 0, 'owner');
        await removeAttachment(att.id, 'owner');
        expect(store.attachments.find((a) => a.id === att.id)).toBeUndefined();
    });

    it('throws forbidden when actor is not the entity author', async () => {
        const e = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:x',
            authorUserId: 'owner',
            payload: { body: 'b' },
        });
        const att = await attachFile(e.id, 'file-xyz', undefined, undefined, undefined, 'owner');
        await expect(removeAttachment(att.id, 'intruder')).rejects.toThrow(/forbidden/i);
        // Row must still exist after the failed delete.
        expect(store.attachments.find((a) => a.id === att.id)).toBeDefined();
    });

    it('throws not found when the attachment id does not exist', async () => {
        await expect(removeAttachment('id-does-not-exist', 'owner')).rejects.toThrow(/not found/);
    });

    it('requires non-empty attachmentId and actorUserId', async () => {
        await expect(removeAttachment('', 'owner')).rejects.toThrow(/attachmentId/);
        await expect(removeAttachment('att-1', '')).rejects.toThrow(/actorUserId/);
    });
});

// ===========================================================================
// Scope access on the by-id surface.
//
// Every one of these paths used to accept a bare entity UUID with no
// membership check, so a student removed from a group (or a blocked DM peer)
// kept full read/write access to everything they had ever seen. The gate is
// `assertScopeAccess`, reached either directly or through
// `loadEntityRowWithScopeAccess`.
// ===========================================================================

describe('scope access on by-id paths', () => {
    /** Create a group post and then revoke `viewer`'s membership of that group. */
    async function postInGroupThenRemove(viewer: string, groupKey = 'ITS-21') {
        const entity = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: `group:${groupKey}`,
            authorUserId: 'author',
            payload: { body: 'members only' },
        });
        store.deniedGroups.add(`${viewer}::${groupKey}`);
        return entity;
    }

    it('getEntityView denies a non-member even with a valid entity id', async () => {
        const entity = await postInGroupThenRemove('outsider');
        await expect(getEntityView(entity.id, 'outsider')).rejects.toThrow(/forbidden/i);
        // A member still reads it — the gate is per-viewer, not global.
        const view = await getEntityView(entity.id, 'member');
        expect(view?.entity.id).toBe(entity.id);
    });

    it('addComment denies a removed group member', async () => {
        const entity = await postInGroupThenRemove('removed');
        await expect(addComment(entity.id, 'removed', 'still here?')).rejects.toThrow(/forbidden/i);
        expect(store.comments).toHaveLength(0);
        // Someone still in the group can comment.
        await addComment(entity.id, 'member', 'hi');
        expect(store.comments).toHaveLength(1);
    });

    it('listComments denies a non-member', async () => {
        const entity = await postInGroupThenRemove('outsider');
        await addComment(entity.id, 'member', 'internal');
        await expect(listComments(entity.id, 'outsider')).rejects.toThrow(/forbidden/i);
        expect(await listComments(entity.id, 'member')).toHaveLength(1);
    });

    it('toggleReaction denies a non-member and 404s on unknown entities', async () => {
        const entity = await postInGroupThenRemove('outsider');
        await expect(toggleReaction(entity.id, 'outsider', '👍')).rejects.toThrow(/forbidden/i);
        expect(store.reactions).toHaveLength(0);
        await expect(toggleReaction('id-does-not-exist', 'member', '👍')).rejects.toThrow(/not found/);
    });

    it('listAttachments denies a non-member', async () => {
        const entity = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'author',
            payload: { body: 'with a file' },
        });
        await attachFile(entity.id, 'file-secret', undefined, undefined, undefined, 'author');
        store.deniedGroups.add('outsider::ITS-21');
        await expect(listAttachments(entity.id, 'outsider')).rejects.toThrow(/forbidden/i);
        expect(await listAttachments(entity.id, 'member')).toHaveLength(1);
    });

    it('recordable dm scope: only the two participants pass', async () => {
        const roomScope = 'dm:direct:alice::bob';
        const entity = await createEntity({
            kind: 'dm_message',
            scopeType: 'dm',
            scopeId: roomScope,
            authorUserId: 'alice',
            payload: { body: 'private' },
        });
        expect((await getEntityView(entity.id, 'bob'))?.entity.id).toBe(entity.id);
        await expect(getEntityView(entity.id, 'carol')).rejects.toThrow(/forbidden/i);
        await expect(addComment(entity.id, 'carol', 'butting in')).rejects.toThrow(/forbidden/i);
    });

    it('announcement scope stays readable by any authenticated user (board)', async () => {
        // services/board.ts stores every student-board post in this scope; the
        // new gate must NOT narrow it.
        const entity = await createEntity({
            kind: 'announcement',
            scopeType: 'announcement',
            scopeId: 'announcement:student-board',
            authorUserId: 'author',
            payload: { title: 'Selling a bike', body: 'cheap' },
        });
        await attachFile(entity.id, 'file-photo', 'image/jpeg', 10, 0, 'author');
        await addComment(entity.id, 'random-student', 'is it still available?');

        const view = await getEntityView(entity.id, 'random-student');
        expect(view?.entity.id).toBe(entity.id);
        expect(await listComments(entity.id, 'random-student')).toHaveLength(1);
        expect(await listAttachments(entity.id, 'random-student')).toHaveLength(1);
        const reaction = await toggleReaction(entity.id, 'random-student', '👍');
        expect(reaction.added).toBe(true);
    });

    it('attachFile is author-only and rejects unknown entities', async () => {
        const entity = await createEntity({
            kind: 'post',
            scopeType: 'group',
            scopeId: 'group:ITS-21',
            authorUserId: 'author',
            payload: { body: 'mine' },
        });
        await expect(
            attachFile(entity.id, 'file-x', undefined, undefined, undefined, 'not-the-author'),
        ).rejects.toThrow(/forbidden/i);
        expect(store.attachments).toHaveLength(0);

        await expect(
            attachFile('id-does-not-exist', 'file-x', undefined, undefined, undefined, 'author'),
        ).rejects.toThrow(/not found/);

        // Author on a live entity still works.
        await attachFile(entity.id, 'file-x', undefined, undefined, undefined, 'author');
        expect(store.attachments).toHaveLength(1);

        // …but not after the entity is soft-deleted.
        await softDeleteEntity(entity.id, 'author');
        await expect(
            attachFile(entity.id, 'file-y', undefined, undefined, undefined, 'author'),
        ).rejects.toThrow(/not found/);
    });
});
