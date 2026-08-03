import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Events RSVP service tests — uses the same in-memory shim pattern as
 * `social-polls.test.ts`. Kept self-contained so the SQL-dispatch heuristics
 * stay readable for the rsvp-specific flows (read row, update payload).
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

const store = {
    entities: [] as EntityRow[],
};

function reset(): void {
    store.entities.length = 0;
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

            if (text.startsWith('update app_social_entity\n                set payload =')) {
                const [id, payloadRaw] = params as [string, string];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.payload = parseJsonbParam(payloadRaw);
                row.updated_at = new Date();
                return { rows: [row], rowCount: 1 };
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

// Membership check stub: by default every viewer passes. Individual tests can
// override the implementation with `vi.mocked(assertCanReadGroup).mockImplementationOnce`
// to exercise the forbidden path.
vi.mock('./group-space.js', () => ({
    assertCanReadGroup: vi.fn(async () => undefined),
}));

import {
    rsvp,
    clearRsvp,
    assertRsvpStatus,
    readRsvpStatusMap,
} from './social-events-rsvp.js';
import { assertCanReadGroup } from './group-space.js';

function seedEvent(overrides: Partial<EntityRow> = {}): EntityRow {
    const row: EntityRow = {
        id: 'evt-1',
        kind: 'event',
        scope_type: 'group',
        scope_id: 'group:ITS-21',
        author_user_id: 'organizer',
        payload: {
            title: 'Lab meeting',
            startsAt: '2026-06-01T10:00:00Z',
            endsAt: '2026-06-01T12:00:00Z',
            location: 'Room 305',
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

describe('assertRsvpStatus (pure)', () => {
    it('accepts yes/no/maybe', () => {
        expect(assertRsvpStatus('yes')).toBe('yes');
        expect(assertRsvpStatus('no')).toBe('no');
        expect(assertRsvpStatus('maybe')).toBe('maybe');
    });

    it('throws on anything else', () => {
        expect(() => assertRsvpStatus('YES')).toThrow(/invalid rsvp status/);
        expect(() => assertRsvpStatus('attending')).toThrow(/invalid rsvp status/);
        expect(() => assertRsvpStatus(null)).toThrow(/invalid rsvp status/);
        expect(() => assertRsvpStatus(undefined)).toThrow(/invalid rsvp status/);
    });
});

describe('readRsvpStatusMap (pure)', () => {
    it('returns the cleaned map verbatim when valid', () => {
        const out = readRsvpStatusMap({ rsvpStatus: { alice: 'yes', bob: 'no', carol: 'maybe' } });
        expect(out).toEqual({ alice: 'yes', bob: 'no', carol: 'maybe' });
    });

    it('drops invalid values', () => {
        const out = readRsvpStatusMap({
            rsvpStatus: { alice: 'yes', bob: 'WHATEVER', carol: 'maybe', dave: 42 },
        });
        expect(out).toEqual({ alice: 'yes', carol: 'maybe' });
    });

    it('returns an empty object when payload is missing rsvpStatus or wrong type', () => {
        expect(readRsvpStatusMap(null)).toEqual({});
        expect(readRsvpStatusMap(undefined)).toEqual({});
        expect(readRsvpStatusMap({})).toEqual({});
        expect(readRsvpStatusMap({ rsvpStatus: 'oops' })).toEqual({});
        expect(readRsvpStatusMap({ rsvpStatus: null })).toEqual({});
    });
});

describe('rsvp', () => {
    it('sets a fresh RSVP and surfaces the resulting map + mine', async () => {
        const row = seedEvent();
        const result = await rsvp(row.id, 'alice', 'yes');
        expect(result.mine).toBe('yes');
        expect(result.rsvpStatus).toEqual({ alice: 'yes' });
        // Underlying payload is mutated through the fake client.
        expect((row.payload as { rsvpStatus: Record<string, string> }).rsvpStatus).toEqual({
            alice: 'yes',
        });
    });

    it('preserves existing payload fields when adding the map', async () => {
        const row = seedEvent();
        await rsvp(row.id, 'alice', 'maybe');
        expect(row.payload.title).toBe('Lab meeting');
        expect(row.payload.startsAt).toBe('2026-06-01T10:00:00Z');
        expect((row.payload as { rsvpStatus: Record<string, string> }).rsvpStatus).toEqual({
            alice: 'maybe',
        });
    });

    it('updates an existing user without touching others', async () => {
        const row = seedEvent({
            payload: {
                title: 'Lab meeting',
                startsAt: '2026-06-01T10:00:00Z',
                rsvpStatus: { bob: 'yes', carol: 'no' },
            },
        });
        const result = await rsvp(row.id, 'alice', 'yes');
        expect(result.rsvpStatus).toEqual({ alice: 'yes', bob: 'yes', carol: 'no' });
        expect(result.mine).toBe('yes');
    });

    it('moves a user from one status to another', async () => {
        const row = seedEvent({
            payload: {
                title: 'Lab meeting',
                startsAt: '2026-06-01T10:00:00Z',
                rsvpStatus: { alice: 'yes' },
            },
        });
        const result = await rsvp(row.id, 'alice', 'no');
        expect(result.rsvpStatus).toEqual({ alice: 'no' });
        expect(result.mine).toBe('no');
    });

    it('is idempotent — same status is a no-op (no DB write)', async () => {
        const row = seedEvent({
            payload: {
                title: 'Lab meeting',
                startsAt: '2026-06-01T10:00:00Z',
                rsvpStatus: { alice: 'yes' },
            },
        });
        const queryFn = (fakeClient as unknown as FakeClient).query;
        queryFn.mockClear();
        const result = await rsvp(row.id, 'alice', 'yes');
        // Only the initial SELECT should fire — no UPDATE because the status
        // hasn't changed.
        const calls = queryFn.mock.calls.map(([sql]: [string]) => sql.trim().toLowerCase());
        expect(calls.filter((sql: string) => sql.startsWith('update app_social_entity'))).toHaveLength(0);
        expect(result.rsvpStatus).toEqual({ alice: 'yes' });
        expect(result.mine).toBe('yes');
    });

    it('throws "not found" when the entity is missing', async () => {
        await expect(rsvp('does-not-exist', 'alice', 'yes')).rejects.toThrow('not found');
    });

    it('throws "not found" when the entity is soft-deleted', async () => {
        const row = seedEvent({ deleted_at: new Date() });
        await expect(rsvp(row.id, 'alice', 'yes')).rejects.toThrow('not found');
    });

    it('throws "not an event" when the entity is the wrong kind', async () => {
        const row = seedEvent({ kind: 'post' });
        await expect(rsvp(row.id, 'alice', 'yes')).rejects.toThrow('not an event');
    });

    it('throws "forbidden" when the viewer cannot read the group scope', async () => {
        const row = seedEvent();
        vi.mocked(assertCanReadGroup).mockRejectedValueOnce(new Error('Forbidden'));
        await expect(rsvp(row.id, 'outsider', 'yes')).rejects.toThrow('Forbidden');
    });

    it('throws "forbidden" for non-group scopes (dm/global/announcement)', async () => {
        const row = seedEvent({ scope_type: 'global', scope_id: 'global:chat' });
        await expect(rsvp(row.id, 'alice', 'yes')).rejects.toThrow('forbidden');
    });

    it('throws "invalid rsvp status" for unknown values', async () => {
        const row = seedEvent();
        await expect(rsvp(row.id, 'alice', 'attending' as unknown as 'yes')).rejects.toThrow('invalid rsvp status');
    });

    it('throws on missing event id or user id', async () => {
        await expect(rsvp('', 'alice', 'yes')).rejects.toThrow('eventId is required');
        await expect(rsvp('evt-1', '', 'yes')).rejects.toThrow('userId is required');
    });

    it('never lets a viewer flip another user\'s RSVP — only their own row is touched', async () => {
        // The service signature only accepts a single userId parameter (which
        // the route layer always sources from the JWT). This test locks the
        // contract — passing a foreign userId is impossible from the route
        // surface, and even if a caller tried, the rsvp() helper still only
        // writes the one userId it was given.
        const row = seedEvent({
            payload: {
                title: 'Lab',
                startsAt: '2026-06-01T10:00:00Z',
                rsvpStatus: { bob: 'yes' },
            },
        });
        const result = await rsvp(row.id, 'alice', 'maybe');
        // Bob's status is intact; only alice was added.
        expect(result.rsvpStatus).toEqual({ alice: 'maybe', bob: 'yes' });
    });
});

describe('clearRsvp', () => {
    it('removes the user\'s RSVP from the map', async () => {
        const row = seedEvent({
            payload: {
                title: 'Lab',
                startsAt: '2026-06-01T10:00:00Z',
                rsvpStatus: { alice: 'yes', bob: 'no' },
            },
        });
        const result = await clearRsvp(row.id, 'alice');
        expect(result.mine).toBeNull();
        expect(result.rsvpStatus).toEqual({ bob: 'no' });
    });

    it('is idempotent — clearing an absent entry is a no-op', async () => {
        const row = seedEvent({
            payload: {
                title: 'Lab',
                startsAt: '2026-06-01T10:00:00Z',
                rsvpStatus: { bob: 'no' },
            },
        });
        const queryFn = (fakeClient as unknown as FakeClient).query;
        queryFn.mockClear();
        const result = await clearRsvp(row.id, 'alice');
        const calls = queryFn.mock.calls.map(([sql]: [string]) => sql.trim().toLowerCase());
        expect(calls.filter((sql: string) => sql.startsWith('update app_social_entity'))).toHaveLength(0);
        expect(result.rsvpStatus).toEqual({ bob: 'no' });
        expect(result.mine).toBeNull();
    });

    it('throws "not found" / "not an event" / "forbidden" mirroring rsvp', async () => {
        await expect(clearRsvp('missing', 'alice')).rejects.toThrow('not found');
        const post = seedEvent({ id: 'evt-2', kind: 'post' });
        await expect(clearRsvp(post.id, 'alice')).rejects.toThrow('not an event');
        const global = seedEvent({ id: 'evt-3', scope_type: 'global', scope_id: 'global:chat' });
        await expect(clearRsvp(global.id, 'alice')).rejects.toThrow('forbidden');
    });
});
