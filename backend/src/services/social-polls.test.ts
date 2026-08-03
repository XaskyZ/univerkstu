import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Polls service tests — uses the same in-memory shim pattern as
 * `social-crud.test.ts`. We keep this self-contained instead of importing
 * the existing fake so the SQL-dispatch heuristics stay readable for the
 * poll-specific flows (read row, update payload, write revision).
 */

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
}

const store = {
    entities: [] as EntityRow[],
    revisions: [] as RevisionRow[],
};

let idCounter = 0;
function nextId(): string {
    idCounter += 1;
    return `rev-${idCounter.toString().padStart(6, '0')}`;
}

function reset(): void {
    store.entities.length = 0;
    store.revisions.length = 0;
    idCounter = 0;
}

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function parseJsonbParam(param: unknown): Record<string, unknown> {
    if (typeof param === 'string') {
        try { return JSON.parse(param) as Record<string, unknown>; } catch { return {}; }
    }
    if (param && typeof param === 'object') return param as Record<string, unknown>;
    return {};
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            if (text.startsWith('select * from app_social_entity where id =')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id);
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }

            if (text.includes('update app_social_entity') && text.includes('set payload')) {
                const [id, payloadRaw] = params as [string, string];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.payload = parseJsonbParam(payloadRaw);
                row.updated_at = new Date();
                return { rows: [], rowCount: 1 };
            }

            if (text.includes('insert into app_social_revision')) {
                // The polls service has two revision-insert shapes:
                //   - vote/unvote: 4 params (entity, author, snapshot, note) +
                //     literal `'update'` revision_kind in the SQL.
                //   - close: 3 params (entity, author, snapshot) + literal
                //     `'update'` revision_kind AND literal `'close'` note.
                // The generic CRUD code uses 5 params. Detect by sniffing the
                // SQL for the literal note + counting params.
                const noteFromSql = text.includes("'close'") ? 'close' : null;
                if (params.length === 3) {
                    const [entityId, author, snapshotRaw] = params as [string, string, string];
                    store.revisions.push({
                        id: nextId(),
                        entity_id: entityId,
                        author_user_id: author,
                        snapshot: parseJsonbParam(snapshotRaw),
                        revision_kind: 'update',
                        note: noteFromSql,
                    });
                } else if (params.length === 4) {
                    const [entityId, author, snapshotRaw, note] = params as [string, string, string, string | null];
                    store.revisions.push({
                        id: nextId(),
                        entity_id: entityId,
                        author_user_id: author,
                        snapshot: parseJsonbParam(snapshotRaw),
                        revision_kind: 'update',
                        note,
                    });
                } else {
                    const [entityId, author, snapshotRaw, revisionKind, note] = params as [
                        string, string, string, RevisionRow['revision_kind'], string | null,
                    ];
                    store.revisions.push({
                        id: nextId(),
                        entity_id: entityId,
                        author_user_id: author,
                        snapshot: parseJsonbParam(snapshotRaw),
                        revision_kind: revisionKind,
                        note,
                    });
                }
                return { rows: [], rowCount: 1 };
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

// Bypass the membership + DM peer checks entirely — pollster authorization is
// covered by the pure helper test below; service-level tests are about the
// vote / unvote / close happy paths and DB invariants.
vi.mock('./group-space.js', () => ({
    assertCanReadGroup: vi.fn(async () => undefined),
}));

vi.mock('./messaging.js', () => ({
    parseDirectRoomId: vi.fn((roomId: string) => {
        if (!roomId.startsWith('direct:')) return null;
        const [low, high] = roomId.slice('direct:'.length).split('::');
        if (!low || !high) return null;
        return { low, high };
    }),
}));

import {
    vote,
    unvote,
    closePoll,
    computeNextVotes,
    computeUnvotedVotes,
    deriveMyVote,
    deriveMyVotes,
    assertCanVoteOnPoll,
} from './social-polls.js';
import { assertCanReadGroup } from './group-space.js';

function seedPoll(overrides: Partial<EntityRow> = {}): EntityRow {
    const row: EntityRow = {
        id: 'poll-1',
        kind: 'poll',
        scope_type: 'group',
        scope_id: 'group:ITS-21',
        author_user_id: 'owner',
        payload: {
            question: 'Pick a color',
            options: [
                { id: 'opt-r', label: 'Red' },
                { id: 'opt-g', label: 'Green' },
                { id: 'opt-b', label: 'Blue' },
            ],
            votes: {},
        },
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
        deleted_by_user_id: null,
        deleted_reason: null,
        ...overrides,
    };
    store.entities.push(row);
    return row;
}

beforeEach(() => {
    reset();
    vi.clearAllMocks();
});

describe('computeNextVotes (pure)', () => {
    it('adds the viewer to the target option bucket', () => {
        const payload = {
            question: 'q',
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
            votes: {},
        };
        const next = computeNextVotes(payload, 'alice', 'a');
        expect(next).toEqual({ a: ['alice'], b: [] });
    });

    it('moves the viewer from their previous option (single-choice)', () => {
        const payload = {
            question: 'q',
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
            votes: { a: ['alice', 'bob'], b: [] },
        };
        const next = computeNextVotes(payload, 'alice', 'b');
        expect(next).toEqual({ a: ['bob'], b: ['alice'] });
    });

    it('returns null when option does not exist on poll', () => {
        const payload = {
            question: 'q',
            options: [{ id: 'a', label: 'A' }],
            votes: {},
        };
        expect(computeNextVotes(payload, 'alice', 'z')).toBeNull();
    });

    it('returns null when poll is closed', () => {
        const payload = {
            question: 'q',
            options: [{ id: 'a', label: 'A' }],
            votes: {},
            closedAt: '2026-05-20T10:00:00Z',
        };
        expect(computeNextVotes(payload, 'alice', 'a')).toBeNull();
    });
});

describe('computeUnvotedVotes (pure)', () => {
    it('drops viewer from every option bucket', () => {
        const payload = {
            question: 'q',
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
            votes: { a: ['alice'], b: ['alice', 'bob'] },
        };
        const next = computeUnvotedVotes(payload, 'alice');
        expect(next).toEqual({ a: [], b: ['bob'] });
    });

    it('is a no-op for a non-voting viewer', () => {
        const payload = {
            question: 'q',
            options: [{ id: 'a', label: 'A' }],
            votes: { a: ['bob'] },
        };
        expect(computeUnvotedVotes(payload, 'alice')).toEqual({ a: ['bob'] });
    });

    it('returns null when the poll is closed', () => {
        const payload = {
            question: 'q',
            options: [{ id: 'a', label: 'A' }],
            votes: { a: ['alice'] },
            closedAt: '2026-05-20T10:00:00Z',
        };
        expect(computeUnvotedVotes(payload, 'alice')).toBeNull();
    });
});

describe('deriveMyVote (pure)', () => {
    it('returns the option the viewer is in', () => {
        expect(deriveMyVote({ a: ['alice'], b: ['bob'] }, 'alice')).toBe('a');
    });
    it('returns null when viewer is not in any bucket', () => {
        expect(deriveMyVote({ a: ['bob'] }, 'alice')).toBeNull();
    });
});

describe('deriveMyVotes (pure, multi-choice)', () => {
    it('returns every option the viewer is in (insertion order)', () => {
        expect(deriveMyVotes(
            { a: ['alice'], b: ['bob'], c: ['alice', 'carol'] },
            'alice',
        )).toEqual(['a', 'c']);
    });
    it('returns [] when viewer is not in any bucket', () => {
        expect(deriveMyVotes({ a: ['bob'] }, 'alice')).toEqual([]);
    });
    it('handles empty buckets defensively', () => {
        expect(deriveMyVotes({ a: [], b: ['alice'] }, 'alice')).toEqual(['b']);
    });
});

describe('computeNextVotes (pure, multi-choice)', () => {
    it('multi-choice: adds the viewer to the target without dropping other selections', () => {
        const payload = {
            question: 'q',
            multiChoice: true,
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }],
            votes: { a: ['alice'], b: [], c: [] },
        };
        const next = computeNextVotes(payload, 'alice', 'c');
        expect(next).toEqual({ a: ['alice'], b: [], c: ['alice'] });
    });

    it('multi-choice: re-casting on a held option removes the viewer from it (toggle)', () => {
        const payload = {
            question: 'q',
            multiChoice: true,
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
            votes: { a: ['alice', 'bob'], b: ['alice'] },
        };
        const next = computeNextVotes(payload, 'alice', 'a');
        // Only 'a' bucket changes — alice removed; 'b' bucket untouched.
        expect(next).toEqual({ a: ['bob'], b: ['alice'] });
    });

    it('multi-choice: does NOT touch other voters in the toggled bucket', () => {
        const payload = {
            question: 'q',
            multiChoice: true,
            options: [{ id: 'a', label: 'A' }],
            votes: { a: ['alice', 'bob', 'carol'] },
        };
        const next = computeNextVotes(payload, 'alice', 'a');
        expect(next).toEqual({ a: ['bob', 'carol'] });
    });

    it('multi-choice: still returns null for unknown option / closed poll', () => {
        const closed = {
            question: 'q',
            multiChoice: true,
            options: [{ id: 'a', label: 'A' }],
            votes: {},
            closedAt: '2026-05-20T10:00:00Z',
        };
        expect(computeNextVotes(closed, 'alice', 'a')).toBeNull();

        const unknown = {
            question: 'q',
            multiChoice: true,
            options: [{ id: 'a', label: 'A' }],
            votes: {},
        };
        expect(computeNextVotes(unknown, 'alice', 'z')).toBeNull();
    });

    it('single-choice (default, multiChoice unset) preserves the existing move-vote behavior', () => {
        const payload = {
            question: 'q',
            options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
            votes: { a: ['alice'], b: ['bob'] },
        };
        const next = computeNextVotes(payload, 'alice', 'b');
        // Alice moved from a → b; bob still in b.
        expect(next).toEqual({ a: [], b: ['bob', 'alice'] });
    });
});

describe('vote service (multi-choice)', () => {
    it('returns myVotes with every selection (no fan-out across options)', async () => {
        const poll = seedPoll({ payload: {
            question: 'q',
            multiChoice: true,
            options: [
                { id: 'a', label: 'A' },
                { id: 'b', label: 'B' },
            ],
            votes: { a: ['alice'], b: [] },
        } });
        const result = await vote(poll.id, 'alice', 'b');
        expect(result.myVote).toBe('a');
        expect(result.myVotes).toEqual(['a', 'b']);
        expect(result.votes).toEqual({ a: ['alice'], b: ['alice'] });
    });

    it('returns myVotes = [] after toggling the last held option off', async () => {
        const poll = seedPoll({ payload: {
            question: 'q',
            multiChoice: true,
            options: [{ id: 'a', label: 'A' }],
            votes: { a: ['alice'] },
        } });
        const result = await vote(poll.id, 'alice', 'a');
        expect(result.myVote).toBeNull();
        expect(result.myVotes).toEqual([]);
        expect(result.votes).toEqual({ a: [] });
    });

    it('single-choice vote result still includes myVotes (length-1 array)', async () => {
        const poll = seedPoll();
        const result = await vote(poll.id, 'alice', 'opt-g');
        expect(result.myVote).toBe('opt-g');
        expect(result.myVotes).toEqual(['opt-g']);
    });
});

describe('assertCanVoteOnPoll', () => {
    it('allows global scope for any authenticated viewer', async () => {
        await expect(
            assertCanVoteOnPoll({ scopeType: 'global', scopeId: 'global:chat' }, 'alice'),
        ).resolves.toBeUndefined();
    });

    it('allows announcement scope for any authenticated viewer', async () => {
        await expect(
            assertCanVoteOnPoll({ scopeType: 'announcement', scopeId: 'announcement:all' }, 'alice'),
        ).resolves.toBeUndefined();
    });

    it('delegates group scope to assertCanReadGroup (strip prefix)', async () => {
        await assertCanVoteOnPoll({ scopeType: 'group', scopeId: 'group:ITS-21' }, 'alice');
        expect(assertCanReadGroup).toHaveBeenCalledWith('alice', 'ITS-21');
    });

    it('rejects when the group helper throws', async () => {
        vi.mocked(assertCanReadGroup).mockRejectedValueOnce(new Error('Forbidden'));
        await expect(
            assertCanVoteOnPoll({ scopeType: 'group', scopeId: 'group:ITS-21' }, 'alice'),
        ).rejects.toThrow(/forbidden/);
    });

    it('allows dm scope only for participants', async () => {
        await expect(
            assertCanVoteOnPoll({ scopeType: 'dm', scopeId: 'dm:direct:alice::bob' }, 'alice'),
        ).resolves.toBeUndefined();
        await expect(
            assertCanVoteOnPoll({ scopeType: 'dm', scopeId: 'dm:direct:alice::bob' }, 'carol'),
        ).rejects.toThrow(/forbidden/);
    });

    it('rejects unknown scope types', async () => {
        await expect(
            assertCanVoteOnPoll({ scopeType: 'unknown' as 'global', scopeId: 'x' }, 'alice'),
        ).rejects.toThrow(/forbidden/);
    });

    it('rejects blank viewer id', async () => {
        await expect(
            assertCanVoteOnPoll({ scopeType: 'global', scopeId: 'global:chat' }, ''),
        ).rejects.toThrow(/forbidden/);
    });
});

describe('vote (service)', () => {
    it('happy path: writes vote, updates payload, returns derived myVote', async () => {
        const poll = seedPoll();
        const result = await vote(poll.id, 'alice', 'opt-g');
        expect(result.myVote).toBe('opt-g');
        expect(result.votes).toEqual({ 'opt-r': [], 'opt-g': ['alice'], 'opt-b': [] });
        // Payload row was actually updated.
        const row = store.entities.find((e) => e.id === poll.id)!;
        expect((row.payload as { votes: Record<string, string[]> }).votes['opt-g']).toEqual(['alice']);
        // Revision row was written with 'vote' note.
        const revs = store.revisions.filter((r) => r.entity_id === poll.id);
        expect(revs).toHaveLength(1);
        expect(revs[0].note).toBe('vote');
        expect(revs[0].revision_kind).toBe('update');
    });

    it('moves vote across options (single-choice)', async () => {
        const poll = seedPoll({ payload: {
            question: 'q', options: [
                { id: 'a', label: 'A' }, { id: 'b', label: 'B' },
            ], votes: { a: ['alice'], b: [] },
        } });
        const result = await vote(poll.id, 'alice', 'b');
        expect(result.myVote).toBe('b');
        expect(result.votes).toEqual({ a: [], b: ['alice'] });
    });

    it('throws not found for missing poll', async () => {
        await expect(vote('nope', 'alice', 'opt-r')).rejects.toThrow(/not found/);
    });

    it('throws not found for soft-deleted poll', async () => {
        const poll = seedPoll({ deleted_at: new Date() });
        await expect(vote(poll.id, 'alice', 'opt-r')).rejects.toThrow(/not found/);
    });

    it('throws not found for non-poll entity kind', async () => {
        const poll = seedPoll({ kind: 'post' });
        await expect(vote(poll.id, 'alice', 'opt-r')).rejects.toThrow(/not found/);
    });

    it('throws invalid option for unknown optionId', async () => {
        const poll = seedPoll();
        await expect(vote(poll.id, 'alice', 'opt-unknown')).rejects.toThrow(/invalid option/);
    });

    it('throws poll closed when closedAt is set', async () => {
        const poll = seedPoll({ payload: {
            question: 'q',
            options: [{ id: 'a', label: 'A' }],
            votes: {},
            closedAt: '2026-05-20T10:00:00Z',
        } });
        await expect(vote(poll.id, 'alice', 'a')).rejects.toThrow(/poll closed/);
    });

    it('throws forbidden when scope auth fails', async () => {
        vi.mocked(assertCanReadGroup).mockRejectedValueOnce(new Error('Forbidden'));
        const poll = seedPoll();
        await expect(vote(poll.id, 'stranger', 'opt-r')).rejects.toThrow(/forbidden/);
    });

    it('requires non-empty pollId, viewerUserId, optionId', async () => {
        await expect(vote('', 'a', 'o')).rejects.toThrow(/pollId/);
        await expect(vote('p', '', 'o')).rejects.toThrow(/viewerUserId/);
        await expect(vote('p', 'a', '')).rejects.toThrow(/optionId/);
    });
});

describe('unvote (service)', () => {
    it('happy path: drops viewer from every bucket', async () => {
        const poll = seedPoll({ payload: {
            question: 'q', options: [
                { id: 'a', label: 'A' }, { id: 'b', label: 'B' },
            ], votes: { a: ['alice', 'bob'], b: [] },
        } });
        const result = await unvote(poll.id, 'alice');
        expect(result.myVote).toBeNull();
        expect(result.votes).toEqual({ a: ['bob'], b: [] });
    });

    it('idempotent for a non-voting viewer', async () => {
        const poll = seedPoll({ payload: {
            question: 'q', options: [{ id: 'a', label: 'A' }], votes: { a: ['bob'] },
        } });
        const result = await unvote(poll.id, 'alice');
        expect(result.myVote).toBeNull();
        expect(result.votes).toEqual({ a: ['bob'] });
    });

    it('throws poll closed when closedAt is set', async () => {
        const poll = seedPoll({ payload: {
            question: 'q',
            options: [{ id: 'a', label: 'A' }],
            votes: { a: ['alice'] },
            closedAt: '2026-05-20T10:00:00Z',
        } });
        await expect(unvote(poll.id, 'alice')).rejects.toThrow(/poll closed/);
    });

    it('throws not found for missing poll', async () => {
        await expect(unvote('nope', 'alice')).rejects.toThrow(/not found/);
    });
});

describe('closePoll (service)', () => {
    it('happy path: author closes the poll, sets closedAt', async () => {
        const poll = seedPoll();
        await closePoll(poll.id, 'owner');
        const row = store.entities.find((e) => e.id === poll.id)!;
        expect(typeof (row.payload as { closedAt?: string }).closedAt).toBe('string');
        // Revision written with 'close' note.
        const revs = store.revisions.filter((r) => r.entity_id === poll.id);
        expect(revs).toHaveLength(1);
        expect(revs[0].note).toBe('close');
    });

    it('forbidden when actor is not the author', async () => {
        const poll = seedPoll({ author_user_id: 'someone-else' });
        await expect(closePoll(poll.id, 'owner')).rejects.toThrow(/forbidden/);
    });

    it('idempotent when poll is already closed', async () => {
        const poll = seedPoll({ payload: {
            question: 'q',
            options: [{ id: 'a', label: 'A' }],
            votes: {},
            closedAt: '2026-05-20T00:00:00Z',
        } });
        await closePoll(poll.id, 'owner');
        // No new revision row written on the idempotent path.
        expect(store.revisions.filter((r) => r.entity_id === poll.id)).toHaveLength(0);
    });

    it('throws not found for missing / deleted / non-poll entities', async () => {
        await expect(closePoll('nope', 'owner')).rejects.toThrow(/not found/);
        const deleted = seedPoll({ id: 'p-d', deleted_at: new Date() });
        await expect(closePoll(deleted.id, 'owner')).rejects.toThrow(/not found/);
        const post = seedPoll({ id: 'p-p', kind: 'post' });
        await expect(closePoll(post.id, 'owner')).rejects.toThrow(/not found/);
    });
});
