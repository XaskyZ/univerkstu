import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Pure-mapping tests for the Phase 1d migration script. The mapping helpers
// (`mapPost`, `mapTask`, …) take legacy row shapes and return SocialEntity
// insert plans — they have no DB I/O, so we can assert their output directly.
// The DB-touching pieces (`processRow`, `migrateKind`) are exercised via a
// mocked `withSupabasePostgres` that records the SQL calls without contacting
// Postgres.

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

interface CapturedCall {
    sql: string;
    params: unknown[];
}

const capturedCalls: CapturedCall[] = [];

// Default fake responses for the SELECT-batch and INSERT-returning-id queries.
let nextSelectRows: unknown[] = [];
let nextInsertId = 'fake-uuid-0';
// Reactions migration uses a join + NOT EXISTS, so we drive it with its own
// fake-row list.
let nextReactionRows: unknown[] = [];
// Toggle whether the simulated INSERT into app_social_reaction succeeds
// (rowCount=1) or hit ON CONFLICT (rowCount=0).
let nextReactionInsertSucceeds = true;
// Friendship backfill — same idea as reactions.
let nextFriendshipRows: unknown[] = [];
let nextFriendshipId = 'fr-uuid-0';
let nextFriendshipInsertSucceeds = true;

// Default mock implementation. Reapplied in `beforeEach` so prior tests that
// override via `mockImplementation` don't bleed state into later tests.
const defaultQueryImpl = async (sql: string, params: unknown[] = []) => {
    const text = sql.trim().toLowerCase();
    capturedCalls.push({ sql, params });
    if (
        text.startsWith('select') &&
        text.includes('from app_group_feed_reactions') &&
        text.includes('app_social_reaction')
    ) {
        return { rows: nextReactionRows, rowCount: nextReactionRows.length };
    }
    if (text.startsWith('insert into app_social_reaction')) {
        return { rows: [], rowCount: nextReactionInsertSucceeds ? 1 : 0 };
    }
    if (
        text.startsWith('select') &&
        text.includes('from app_friend_requests') &&
        text.includes('social_friendship_id is null')
    ) {
        return { rows: nextFriendshipRows, rowCount: nextFriendshipRows.length };
    }
    if (text.startsWith('insert into app_social_friendship')) {
        if (nextFriendshipInsertSucceeds) {
            return { rows: [{ id: nextFriendshipId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
    }
    if (
        text.startsWith('select') &&
        text.includes('from app_social_friendship') &&
        text.includes('requester_user_id = $1')
    ) {
        // Existing-row lookup after ON CONFLICT DO NOTHING.
        return { rows: [{ id: 'existing-fr-id' }], rowCount: 1 };
    }
    if (text.startsWith('update app_friend_requests set social_friendship_id')) {
        return { rows: [], rowCount: 1 };
    }
    if (text.startsWith('select') && text.includes('where social_entity_id is null')) {
        return { rows: nextSelectRows, rowCount: nextSelectRows.length };
    }
    if (text.startsWith('insert into app_social_entity')) {
        return { rows: [{ id: nextInsertId }], rowCount: 1 };
    }
    // INSERT into app_social_mention / UPDATE legacy back-link / UPDATE
    // soft-delete state — return empty result.
    return { rows: [], rowCount: 1 };
};

const fakeClient: FakeClient = {
    query: vi.fn(defaultQueryImpl),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

import {
    parseArgs,
    mapPost,
    mapTask,
    mapExtraLesson,
    mapAnnouncement,
    mapDmMessage,
    mapGlobalMessage,
    mapReaction,
    mapFriendRequest,
    collectMentions,
    combineLessonDateTime,
    processRow,
    processReactionRow,
    processFriendshipRow,
    migrateReactions,
    migrateFriendships,
    legacyPairKey,
    DESCRIPTORS,
    SUPPORTED_KINDS,
} from './migrate-social-store.js';

beforeEach(() => {
    capturedCalls.length = 0;
    fakeClient.query.mockReset();
    // Restore the default implementation — prior tests may have replaced
    // it via `fakeClient.query.mockImplementation(...)`.
    fakeClient.query.mockImplementation(defaultQueryImpl);
    nextSelectRows = [];
    nextReactionRows = [];
    nextReactionInsertSucceeds = true;
    nextFriendshipRows = [];
    nextFriendshipInsertSucceeds = true;
    nextInsertId = `fake-uuid-${Math.floor(Math.random() * 1_000_000)}`;
    nextFriendshipId = `fr-uuid-${Math.floor(Math.random() * 1_000_000)}`;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('parseArgs', () => {
    it('defaults to all six kinds, batch=100, no limit, no dry-run', () => {
        const args = parseArgs([]);
        expect(args.dryRun).toBe(false);
        expect(args.verbose).toBe(false);
        expect(args.batchSize).toBe(100);
        expect(args.limit).toBe(0);
        expect(args.kinds).toEqual([...SUPPORTED_KINDS]);
        expect(args.withReactions).toBe(false);
        expect(args.withFriendships).toBe(false);
    });

    it('parses --dry-run, --verbose, --batch-size, --limit, --kinds', () => {
        const args = parseArgs([
            '--dry-run',
            '--verbose',
            '--batch-size=50',
            '--limit=200',
            '--kinds=post,task',
        ]);
        expect(args.dryRun).toBe(true);
        expect(args.verbose).toBe(true);
        expect(args.batchSize).toBe(50);
        expect(args.limit).toBe(200);
        expect(args.kinds).toEqual(['post', 'task']);
    });

    it('throws on unknown kinds', () => {
        expect(() => parseArgs(['--kinds=post,bogus'])).toThrow(/unknown kind/);
    });
});

describe('mapPost', () => {
    it('maps a legacy group post to a post entity in the group scope', () => {
        const plan = mapPost({
            id: 'p1',
            group_key: 'ITS-21',
            title: 'Hello',
            body: 'world',
            author_user_id: 'user-a',
            pinned: false,
            created_at: '2024-01-15T10:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        });
        expect(plan.kind).toBe('post');
        expect(plan.scopeType).toBe('group');
        expect(plan.scopeId).toBe('group:ITS-21');
        expect(plan.authorUserId).toBe('user-a');
        expect(plan.payload).toEqual({ title: 'Hello', body: 'world' });
        expect(plan.createdAt.toISOString()).toBe('2024-01-15T10:00:00.000Z');
        expect(plan.deletedAt).toBeNull();
        expect(plan.pinned).toBe(false);
    });

    it('propagates soft-delete state', () => {
        const plan = mapPost({
            id: 'p2',
            group_key: 'ITS-21',
            title: 'T',
            body: 'B',
            author_user_id: 'user-a',
            pinned: false,
            created_at: '2024-02-01T00:00:00.000Z',
            deleted_at: '2024-02-05T12:00:00.000Z',
            deleted_by: 'mod-b',
        });
        expect(plan.deletedAt?.toISOString()).toBe('2024-02-05T12:00:00.000Z');
        expect(plan.deletedByUserId).toBe('mod-b');
    });
});

describe('mapTask', () => {
    it('puts description into body and deadline into dueAt', () => {
        const plan = mapTask({
            id: 't1',
            group_key: 'ITS-21',
            title: 'Lab 3',
            subject: 'Algorithms',
            description: 'Solve problems 1-5',
            deadline: '2024-03-10T23:59:00.000Z',
            author_user_id: 'user-a',
            created_at: '2024-03-01T08:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        });
        expect(plan.kind).toBe('task');
        expect(plan.scopeId).toBe('group:ITS-21');
        expect(plan.payload).toEqual({
            title: 'Lab 3',
            body: 'Solve problems 1-5',
            dueAt: '2024-03-10T23:59:00.000Z',
        });
    });

    it('falls back to subject (then empty string) when description is missing', () => {
        const planA = mapTask({
            id: 't2',
            group_key: 'ITS-21',
            title: 'T',
            subject: 'Math',
            description: null,
            deadline: null,
            author_user_id: 'user-a',
            created_at: '2024-03-01T08:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        });
        expect(planA.payload.body).toBe('Math');
        expect(planA.payload.dueAt).toBeUndefined();

        const planB = mapTask({
            id: 't3',
            group_key: 'ITS-21',
            title: 'T',
            subject: null,
            description: null,
            deadline: null,
            author_user_id: 'user-a',
            created_at: '2024-03-01T08:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        });
        expect(planB.payload.body).toBe('');
    });
});

describe('mapExtraLesson + combineLessonDateTime', () => {
    it('combines YYYY-MM-DD date with HH:MM start/end into ISO strings', () => {
        expect(combineLessonDateTime('2024-04-20T00:00:00.000Z', '14:30')).toBe(
            '2024-04-20T14:30:00.000Z',
        );
    });

    it('maps a lesson with all optional fields populated', () => {
        const plan = mapExtraLesson({
            id: 'l1',
            group_key: 'ITS-21',
            title: 'Algorithms',
            date: '2024-04-20T00:00:00.000Z',
            start_time: '14:30',
            end_time: '16:00',
            room: '201',
            teacher: 'Ivanov',
            note: 'bring laptop',
            author_user_id: 'user-a',
            created_at: '2024-04-15T08:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        });
        expect(plan.payload).toEqual({
            subject: 'Algorithms',
            startsAt: '2024-04-20T14:30:00.000Z',
            endsAt: '2024-04-20T16:00:00.000Z',
            room: '201',
            teacher: 'Ivanov',
            note: 'bring laptop',
        });
    });

    it('omits optional payload fields when the legacy columns are null/empty', () => {
        const plan = mapExtraLesson({
            id: 'l2',
            group_key: 'ITS-21',
            title: 'X',
            date: '2024-04-20T00:00:00.000Z',
            start_time: '09:00',
            end_time: '',
            room: null,
            teacher: null,
            note: '',
            author_user_id: 'user-a',
            created_at: '2024-04-15T08:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        });
        expect(plan.payload).toEqual({
            subject: 'X',
            startsAt: '2024-04-20T09:00:00.000Z',
        });
        expect(plan.payload.teacher).toBeUndefined();
        expect(plan.payload.room).toBeUndefined();
        expect(plan.payload.note).toBeUndefined();
    });
});

describe('mapAnnouncement', () => {
    it('coerces legacy priorities (info→low, warning→high, critical→critical)', () => {
        const info = mapAnnouncement({
            id: 'a1',
            author_user_id: 'mod',
            title: 'T',
            body: 'B',
            priority: 'info',
            target_mode: 'all_starostas',
            target_groups_json: [],
            expires_at: null,
            revoked_at: null,
            created_at: '2024-05-01T00:00:00.000Z',
        });
        expect(info.payload.priority).toBe('low');

        const warn = mapAnnouncement({
            id: 'a2',
            author_user_id: 'mod',
            title: 'T',
            body: 'B',
            priority: 'warning',
            target_mode: 'all_starostas',
            target_groups_json: [],
            expires_at: null,
            revoked_at: null,
            created_at: '2024-05-01T00:00:00.000Z',
        });
        expect(warn.payload.priority).toBe('high');

        const crit = mapAnnouncement({
            id: 'a3',
            author_user_id: 'mod',
            title: 'T',
            body: 'B',
            priority: 'critical',
            target_mode: 'specific',
            target_groups_json: ['ITS-21', 'ITS-22'],
            expires_at: null,
            revoked_at: null,
            created_at: '2024-05-01T00:00:00.000Z',
        });
        expect(crit.payload.priority).toBe('critical');
        expect(crit.payload.targetGroups).toEqual(['ITS-21', 'ITS-22']);
    });

    it('always uses scopeId="announcement:global" regardless of targeting', () => {
        const plan = mapAnnouncement({
            id: 'a4',
            author_user_id: 'mod',
            title: 'T',
            body: 'B',
            priority: 'info',
            target_mode: 'specific',
            target_groups_json: ['ITS-21'],
            expires_at: '2024-06-01T00:00:00.000Z',
            revoked_at: null,
            created_at: '2024-05-01T00:00:00.000Z',
        });
        expect(plan.scopeType).toBe('announcement');
        expect(plan.scopeId).toBe('announcement:global');
        expect(plan.payload.expiresAt).toBe('2024-06-01T00:00:00.000Z');
    });

    it('maps revoked_at to soft-delete state', () => {
        const plan = mapAnnouncement({
            id: 'a5',
            author_user_id: 'mod',
            title: 'T',
            body: 'B',
            priority: 'info',
            target_mode: 'all_starostas',
            target_groups_json: [],
            expires_at: null,
            revoked_at: '2024-05-15T10:00:00.000Z',
            created_at: '2024-05-01T00:00:00.000Z',
        });
        expect(plan.deletedAt?.toISOString()).toBe('2024-05-15T10:00:00.000Z');
        expect(plan.deletedReason).toBe('revoked');
        expect(plan.deletedByUserId).toBe('mod');
    });

    it('parses target_groups_json from a JSON string (jsonb sometimes returns text)', () => {
        const plan = mapAnnouncement({
            id: 'a6',
            author_user_id: 'mod',
            title: 'T',
            body: 'B',
            priority: 'info',
            target_mode: 'specific',
            target_groups_json: '["ITS-21","ITS-22"]',
            expires_at: null,
            revoked_at: null,
            created_at: '2024-05-01T00:00:00.000Z',
        });
        expect(plan.payload.targetGroups).toEqual(['ITS-21', 'ITS-22']);
    });
});

describe('mapDmMessage', () => {
    it('uses scopeType=dm and builds scopeId from room_id (idempotent prefix)', () => {
        const plan = mapDmMessage({
            id: 'm1',
            room_id: 'direct:alice::bob',
            author_user_id: 'alice',
            body: 'hi',
            reply_to_message_id: null,
            created_at: '2024-06-01T10:00:00.000Z',
            edited_at: null,
            deleted_at: null,
        });
        expect(plan.kind).toBe('dm_message');
        expect(plan.scopeType).toBe('dm');
        expect(plan.scopeId).toBe('dm:direct:alice::bob');
        expect(plan.payload).toEqual({ body: 'hi' });
    });

    it('includes replyToMessageId and editedAt when present', () => {
        const plan = mapDmMessage({
            id: 'm2',
            room_id: 'roomX',
            author_user_id: 'alice',
            body: 'reply',
            reply_to_message_id: 'm1',
            created_at: '2024-06-01T10:05:00.000Z',
            edited_at: '2024-06-01T10:10:00.000Z',
            deleted_at: null,
        });
        expect(plan.payload).toEqual({
            body: 'reply',
            replyToMessageId: 'm1',
            editedAt: '2024-06-01T10:10:00.000Z',
        });
    });
});

describe('mapGlobalMessage', () => {
    it('uses fixed scopeId "global:chat" and propagates pinned + soft-delete', () => {
        const plan = mapGlobalMessage({
            id: 'g1',
            author_user_id: 'user-a',
            body: 'pinned message',
            created_at: '2024-07-01T08:00:00.000Z',
            pinned_at: '2024-07-02T09:00:00.000Z',
            pinned_by: 'mod',
            deleted_at: null,
            deleted_by: null,
            delete_reason: null,
        });
        expect(plan.scopeType).toBe('global');
        expect(plan.scopeId).toBe('global:chat');
        expect(plan.pinned).toBe(true);
        expect(plan.deletedAt).toBeNull();
    });

    it('propagates deleted_at + deleted_by + delete_reason', () => {
        const plan = mapGlobalMessage({
            id: 'g2',
            author_user_id: 'user-a',
            body: 'bad',
            created_at: '2024-07-01T08:00:00.000Z',
            pinned_at: null,
            pinned_by: null,
            deleted_at: '2024-07-03T10:00:00.000Z',
            deleted_by: 'mod',
            delete_reason: 'spam',
        });
        expect(plan.deletedAt?.toISOString()).toBe('2024-07-03T10:00:00.000Z');
        expect(plan.deletedByUserId).toBe('mod');
        expect(plan.deletedReason).toBe('spam');
    });
});

describe('buildScopeId idempotency (via mapPost)', () => {
    it('does not double-prefix when the group_key already starts with "group:"', () => {
        const plan = mapPost({
            id: 'p99',
            group_key: 'group:ITS-21',
            title: 'T',
            body: 'B',
            author_user_id: 'user-a',
            pinned: false,
            created_at: '2024-01-01T00:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        });
        expect(plan.scopeId).toBe('group:ITS-21');
    });
});

describe('collectMentions', () => {
    it('extracts @handles from title and body, deduplicated', () => {
        const handles = collectMentions({
            title: 'cc @alice',
            body: 'thanks @alice and @bob',
        });
        expect(handles).toEqual(['alice', 'bob']);
    });

    it('returns [] when no recognised text fields are present', () => {
        const handles = collectMentions({ priority: 'low', dueAt: '2024-01-01' });
        expect(handles).toEqual([]);
    });
});

describe('processRow — dry-run', () => {
    it('does not call any INSERT when dryRun=true', async () => {
        const row = {
            id: 'p-dry',
            group_key: 'ITS-21',
            title: 'T',
            body: 'B',
            author_user_id: 'user-a',
            pinned: false,
            created_at: '2024-01-01T00:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        };
        const result = await processRow(DESCRIPTORS.post, row, {
            dryRun: true,
            kinds: ['post'],
            batchSize: 10,
            limit: 0,
            verbose: false,
            withReactions: false,
            withFriendships: false,
        });
        expect(result.ok).toBe(true);
        expect(result.socialId).toBeUndefined();
        // No DB calls were made.
        expect(fakeClient.query).not.toHaveBeenCalled();
    });
});

describe('processRow — live insert preserves created_at and writes back-link', () => {
    it('passes legacy created_at into the INSERT, then updates the back-link', async () => {
        nextInsertId = 'social-xyz';
        const row = {
            id: 'p-live',
            group_key: 'ITS-21',
            title: 'Hello',
            body: 'world',
            author_user_id: 'user-a',
            pinned: false,
            created_at: '2023-12-25T18:30:00.000Z',
            deleted_at: null,
            deleted_by: null,
        };
        const result = await processRow(DESCRIPTORS.post, row, {
            dryRun: false,
            kinds: ['post'],
            batchSize: 10,
            limit: 0,
            verbose: false,
            withReactions: false,
            withFriendships: false,
        });
        expect(result.ok).toBe(true);
        expect(result.socialId).toBe('social-xyz');

        // INSERT into app_social_entity — params[6] must be the preserved Date.
        const insertCall = capturedCalls.find((c) =>
            c.sql.trim().toLowerCase().startsWith('insert into app_social_entity'),
        );
        expect(insertCall).toBeDefined();
        const params = insertCall!.params;
        expect(params[0]).toBe('post');
        expect(params[1]).toBe('group');
        expect(params[2]).toBe('group:ITS-21');
        expect(params[3]).toBe('user-a');
        // params[6] is the preserved created_at — must equal the input.
        expect((params[6] as Date).toISOString()).toBe('2023-12-25T18:30:00.000Z');

        // UPDATE on the legacy back-link.
        const backLinkCall = capturedCalls.find(
            (c) =>
                c.sql.includes('update app_group_posts') &&
                c.sql.includes('social_entity_id'),
        );
        expect(backLinkCall).toBeDefined();
        expect(backLinkCall!.params).toEqual(['p-live', 'social-xyz']);
    });

    it('propagates soft-delete onto the mirror via a follow-up UPDATE', async () => {
        nextInsertId = 'social-soft';
        const row = {
            id: 'p-soft',
            group_key: 'ITS-21',
            title: 'T',
            body: 'B',
            author_user_id: 'user-a',
            pinned: false,
            created_at: '2024-01-01T00:00:00.000Z',
            deleted_at: '2024-01-10T12:00:00.000Z',
            deleted_by: 'mod-c',
        };
        await processRow(DESCRIPTORS.post, row, {
            dryRun: false,
            kinds: ['post'],
            batchSize: 10,
            limit: 0,
            verbose: false,
            withReactions: false,
            withFriendships: false,
        });

        const softDeleteCall = capturedCalls.find(
            (c) =>
                c.sql.toLowerCase().includes('update app_social_entity') &&
                c.sql.toLowerCase().includes('deleted_at = $2'),
        );
        expect(softDeleteCall).toBeDefined();
        expect((softDeleteCall!.params[1] as Date).toISOString()).toBe(
            '2024-01-10T12:00:00.000Z',
        );
        expect(softDeleteCall!.params[2]).toBe('mod-c');
    });

    it('inserts @user mention rows for handles in the body', async () => {
        nextInsertId = 'social-mention';
        const row = {
            id: 'p-mention',
            group_key: 'ITS-21',
            title: 'Hi @alice',
            body: 'cc @bob and @alice',
            author_user_id: 'user-a',
            pinned: false,
            created_at: '2024-01-01T00:00:00.000Z',
            deleted_at: null,
            deleted_by: null,
        };
        await processRow(DESCRIPTORS.post, row, {
            dryRun: false,
            kinds: ['post'],
            batchSize: 10,
            limit: 0,
            verbose: false,
            withReactions: false,
            withFriendships: false,
        });

        const mentionCalls = capturedCalls.filter((c) =>
            c.sql.toLowerCase().includes('insert into app_social_mention'),
        );
        expect(mentionCalls).toHaveLength(2);
        const inserted = mentionCalls.map((c) => c.params[2]).sort();
        expect(inserted).toEqual(['alice', 'bob']);
    });
});

describe('descriptor table coverage', () => {
    it('has a descriptor for each supported kind', () => {
        for (const kind of SUPPORTED_KINDS) {
            const d = DESCRIPTORS[kind];
            expect(d.kind).toBe(kind);
            expect(d.legacyTable.startsWith('app_')).toBe(true);
            expect(typeof d.mapRow).toBe('function');
            expect(typeof d.legacyId).toBe('function');
        }
    });
});

// === Reactions side-data migration (Phase 1c+d) ==============================

describe('mapReaction', () => {
    it('maps a legacy reaction row to a reaction insert plan keyed on social_entity_id', () => {
        const plan = mapReaction({
            post_id: 'legacy-post-1',
            user_id: 'user-a',
            emoji: '👍',
            created_at: '2024-08-01T10:00:00.000Z',
            social_entity_id: 'social-entity-1',
        });
        expect(plan.entityId).toBe('social-entity-1');
        expect(plan.userId).toBe('user-a');
        expect(plan.emoji).toBe('👍');
        expect(plan.createdAt.toISOString()).toBe('2024-08-01T10:00:00.000Z');
    });

    it('falls back to "now" when the legacy created_at is unparseable', () => {
        const before = Date.now();
        const plan = mapReaction({
            post_id: 'p',
            user_id: 'u',
            emoji: '❤️',
            created_at: 'not-a-date',
            social_entity_id: 'e',
        });
        // Falls into toDate's safety net — must be a Date >= the call time.
        expect(plan.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    });
});

describe('processReactionRow — dry-run', () => {
    it('does not call any INSERT when dryRun=true', async () => {
        const row = {
            post_id: 'p',
            user_id: 'u',
            emoji: '👍',
            created_at: '2024-08-01T10:00:00.000Z',
            social_entity_id: 'e',
        };
        const result = await processReactionRow(row, {
            dryRun: true,
            kinds: ['post'],
            batchSize: 10,
            limit: 0,
            verbose: false,
            withReactions: true,
            withFriendships: false,
        });
        expect(result.ok).toBe(true);
        expect(result.copied).toBe(false);
        // No DB call attempted.
        expect(fakeClient.query).not.toHaveBeenCalled();
    });
});

describe('processReactionRow — live insert preserves entity link, user, emoji, created_at', () => {
    it('passes the social entity_id (NOT the legacy post_id) into the INSERT', async () => {
        const row = {
            post_id: 'legacy-post-1',
            user_id: 'user-a',
            emoji: '🎉',
            created_at: '2024-08-15T12:00:00.000Z',
            social_entity_id: 'social-xyz',
        };
        const result = await processReactionRow(row, {
            dryRun: false,
            kinds: ['post'],
            batchSize: 10,
            limit: 0,
            verbose: false,
            withReactions: true,
            withFriendships: false,
        });
        expect(result.ok).toBe(true);
        expect(result.copied).toBe(true);

        const insertCall = capturedCalls.find((c) =>
            c.sql.trim().toLowerCase().startsWith('insert into app_social_reaction'),
        );
        expect(insertCall).toBeDefined();
        // params[0] = entity_id (NOT legacy post_id), params[1] = user_id,
        // params[2] = emoji, params[3] = preserved created_at.
        expect(insertCall!.params[0]).toBe('social-xyz');
        expect(insertCall!.params[1]).toBe('user-a');
        expect(insertCall!.params[2]).toBe('🎉');
        expect((insertCall!.params[3] as Date).toISOString()).toBe('2024-08-15T12:00:00.000Z');
    });

    it('reports copied=false when the INSERT hits ON CONFLICT (rowCount=0)', async () => {
        nextReactionInsertSucceeds = false;
        const row = {
            post_id: 'p',
            user_id: 'u',
            emoji: '😂',
            created_at: '2024-01-01T00:00:00.000Z',
            social_entity_id: 'e',
        };
        const result = await processReactionRow(row, {
            dryRun: false,
            kinds: ['post'],
            batchSize: 10,
            limit: 0,
            verbose: false,
            withReactions: true,
            withFriendships: false,
        });
        expect(result.ok).toBe(true);
        expect(result.copied).toBe(false);
    });
});

describe('migrateReactions — batch loop', () => {
    it('skips rows where the mirror reaction already exists (idempotent via NOT EXISTS)', async () => {
        // The fake client returns nextReactionRows for the join+NOT-EXISTS
        // select. An empty list models "every legacy reaction is already
        // mirrored", so migrateReactions exits without trying any INSERT.
        nextReactionRows = [];
        const stats = { scanned: 0, copied: 0, skipped: 0, failed: 0 };
        await migrateReactions(
            {
                dryRun: false,
                kinds: ['post'],
                batchSize: 100,
                limit: 0,
                verbose: false,
                withReactions: true,
                withFriendships: false,
            },
            stats,
        );
        expect(stats.scanned).toBe(0);
        expect(stats.copied).toBe(0);
        // Only the SELECT happened — no INSERT.
        const insertCall = capturedCalls.find((c) =>
            c.sql.trim().toLowerCase().startsWith('insert into app_social_reaction'),
        );
        expect(insertCall).toBeUndefined();
    });

    it('counts copied rows in stats and uses the NOT EXISTS + JOIN SELECT to filter', async () => {
        // First batch returns 2 rows, second returns 0 (exhausted).
        let callCount = 0;
        nextReactionInsertSucceeds = true;
        fakeClient.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();
            capturedCalls.push({ sql, params });
            if (
                text.startsWith('select') &&
                text.includes('from app_group_feed_reactions') &&
                text.includes('app_social_reaction')
            ) {
                callCount += 1;
                if (callCount === 1) {
                    const rows = [
                        {
                            post_id: 'p1',
                            user_id: 'u1',
                            emoji: '👍',
                            created_at: '2024-09-01T00:00:00.000Z',
                            social_entity_id: 'e1',
                        },
                        {
                            post_id: 'p2',
                            user_id: 'u2',
                            emoji: '❤️',
                            created_at: '2024-09-02T00:00:00.000Z',
                            social_entity_id: 'e2',
                        },
                    ];
                    return { rows, rowCount: rows.length };
                }
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('insert into app_social_reaction')) {
                return { rows: [], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
        });

        const stats = { scanned: 0, copied: 0, skipped: 0, failed: 0 };
        await migrateReactions(
            {
                dryRun: false,
                kinds: ['post'],
                batchSize: 100,
                limit: 0,
                verbose: false,
                withReactions: true,
                withFriendships: false,
            },
            stats,
        );
        expect(stats.scanned).toBe(2);
        expect(stats.copied).toBe(2);
        expect(stats.failed).toBe(0);

        // Verify the SELECT actually included the NOT EXISTS predicate so the
        // script is safe to re-run.
        const selectCall = capturedCalls.find(
            (c) =>
                c.sql.trim().toLowerCase().startsWith('select') &&
                c.sql.toLowerCase().includes('from app_group_feed_reactions'),
        );
        expect(selectCall).toBeDefined();
        expect(selectCall!.sql.toLowerCase()).toContain('not exists');
        expect(selectCall!.sql.toLowerCase()).toContain('join app_group_posts');
        expect(selectCall!.sql.toLowerCase()).toContain('social_entity_id is not null');
    });
});

// ============================================================================
// Phase 1c — friendships backfill (`--with-friendships`)

describe('legacyPairKey', () => {
    it('returns the lexicographically-sorted "a::b" pair', () => {
        expect(legacyPairKey('alice', 'bob')).toBe('alice::bob');
        expect(legacyPairKey('bob', 'alice')).toBe('alice::bob');
    });
});

describe('mapFriendRequest', () => {
    it('maps a pending row with no acted_at', () => {
        const plan = mapFriendRequest({
            id: 'fr-1',
            requester_user_id: 'alice',
            target_user_id: 'bob',
            status: 'pending',
            created_at: '2026-01-01T00:00:00.000Z',
            acted_at: null,
        });
        expect(plan).toEqual({
            id: 'fr-1',
            requesterUserId: 'alice',
            addresseeUserId: 'bob',
            status: 'pending',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            respondedAt: null,
            pairKey: 'alice::bob',
        });
    });

    it('preserves acted_at as respondedAt on an accepted row', () => {
        const plan = mapFriendRequest({
            id: 'fr-2',
            requester_user_id: 'alice',
            target_user_id: 'bob',
            status: 'accepted',
            created_at: '2026-01-01T00:00:00.000Z',
            acted_at: '2026-01-02T00:00:00.000Z',
        });
        expect(plan?.respondedAt).toEqual(new Date('2026-01-02T00:00:00.000Z'));
    });

    it('returns null for an unknown legacy status', () => {
        const plan = mapFriendRequest({
            id: 'fr-x',
            requester_user_id: 'alice',
            target_user_id: 'bob',
            status: 'whatever',
            created_at: '2026-01-01T00:00:00.000Z',
            acted_at: null,
        });
        expect(plan).toBeNull();
    });

    it('returns null when requester equals addressee (corrupt row)', () => {
        const plan = mapFriendRequest({
            id: 'fr-self',
            requester_user_id: 'alice',
            target_user_id: 'alice',
            status: 'pending',
            created_at: '2026-01-01T00:00:00.000Z',
            acted_at: null,
        });
        expect(plan).toBeNull();
    });
});

describe('processFriendshipRow — dry run', () => {
    it('returns ok+plan but does NOT call the DB', async () => {
        const result = await processFriendshipRow(
            {
                id: 'fr-3',
                requester_user_id: 'alice',
                target_user_id: 'bob',
                status: 'pending',
                created_at: '2026-01-01T00:00:00.000Z',
                acted_at: null,
            },
            {
                dryRun: true,
                kinds: [],
                batchSize: 10,
                limit: 0,
                verbose: false,
                withReactions: false,
                withFriendships: true,
            },
        );
        expect(result.ok).toBe(true);
        expect(result.copied).toBe(false);
        expect(result.plan?.pairKey).toBe('alice::bob');
        expect(fakeClient.query).not.toHaveBeenCalled();
    });
});

describe('processFriendshipRow — live insert', () => {
    it('INSERTs into app_social_friendship with the legacy created_at and updates the back-link', async () => {
        nextFriendshipId = 'social-fr-7';
        const result = await processFriendshipRow(
            {
                id: 'fr-7',
                requester_user_id: 'alice',
                target_user_id: 'bob',
                status: 'accepted',
                created_at: '2026-01-01T00:00:00.000Z',
                acted_at: '2026-01-02T00:00:00.000Z',
            },
            {
                dryRun: false,
                kinds: [],
                batchSize: 10,
                limit: 0,
                verbose: false,
                withReactions: false,
                withFriendships: true,
            },
        );
        expect(result.ok).toBe(true);
        expect(result.copied).toBe(true);

        const insertCall = capturedCalls.find((c) =>
            c.sql.trim().toLowerCase().startsWith('insert into app_social_friendship'),
        );
        expect(insertCall).toBeDefined();
        expect(insertCall!.params[0]).toBe('alice');
        expect(insertCall!.params[1]).toBe('bob');
        expect(insertCall!.params[2]).toBe('accepted');
        expect((insertCall!.params[3] as Date).toISOString()).toBe('2026-01-01T00:00:00.000Z');
        expect((insertCall!.params[4] as Date).toISOString()).toBe('2026-01-02T00:00:00.000Z');

        const updateCall = capturedCalls.find((c) =>
            c.sql.trim().toLowerCase().startsWith('update app_friend_requests set social_friendship_id'),
        );
        expect(updateCall).toBeDefined();
        expect(updateCall!.params).toEqual(['fr-7', 'social-fr-7']);
    });

    it('falls back to the existing row id when ON CONFLICT DO NOTHING returns no rows', async () => {
        nextFriendshipInsertSucceeds = false;
        const result = await processFriendshipRow(
            {
                id: 'fr-8',
                requester_user_id: 'alice',
                target_user_id: 'bob',
                status: 'pending',
                created_at: '2026-01-01T00:00:00.000Z',
                acted_at: null,
            },
            {
                dryRun: false,
                kinds: [],
                batchSize: 10,
                limit: 0,
                verbose: false,
                withReactions: false,
                withFriendships: true,
            },
        );
        expect(result.ok).toBe(true);
        expect(result.copied).toBe(true);

        const updateCall = capturedCalls.find((c) =>
            c.sql.trim().toLowerCase().startsWith('update app_friend_requests set social_friendship_id'),
        );
        expect(updateCall!.params).toEqual(['fr-8', 'existing-fr-id']);
    });

    it('skips bad legacy data without throwing', async () => {
        const result = await processFriendshipRow(
            {
                id: 'fr-bad',
                requester_user_id: 'alice',
                target_user_id: 'alice',
                status: 'pending',
                created_at: '2026-01-01T00:00:00.000Z',
                acted_at: null,
            },
            {
                dryRun: false,
                kinds: [],
                batchSize: 10,
                limit: 0,
                verbose: false,
                withReactions: false,
                withFriendships: true,
            },
        );
        expect(result.ok).toBe(true);
        expect(result.copied).toBe(false);
        expect(result.plan).toBeNull();
        expect(fakeClient.query).not.toHaveBeenCalled();
    });
});

describe('migrateFriendships — end-to-end (mocked DB)', () => {
    it('scans, copies and stops when the second batch is empty', async () => {
        let firstFetch = true;
        fakeClient.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();
            capturedCalls.push({ sql, params });
            if (
                text.startsWith('select') &&
                text.includes('from app_friend_requests') &&
                text.includes('social_friendship_id is null')
            ) {
                if (firstFetch) {
                    firstFetch = false;
                    return {
                        rows: [
                            {
                                id: 'fr-A',
                                requester_user_id: 'alice',
                                target_user_id: 'bob',
                                status: 'pending',
                                created_at: '2026-01-01T00:00:00.000Z',
                                acted_at: null,
                            },
                            {
                                id: 'fr-B',
                                requester_user_id: 'carol',
                                target_user_id: 'dave',
                                status: 'accepted',
                                created_at: '2026-01-02T00:00:00.000Z',
                                acted_at: '2026-01-03T00:00:00.000Z',
                            },
                        ],
                        rowCount: 2,
                    };
                }
                return { rows: [], rowCount: 0 };
            }
            if (text.startsWith('insert into app_social_friendship')) {
                return { rows: [{ id: 'inserted' }], rowCount: 1 };
            }
            return { rows: [], rowCount: 1 };
        });

        const stats = { scanned: 0, copied: 0, skipped: 0, failed: 0 };
        await migrateFriendships(
            {
                dryRun: false,
                kinds: [],
                batchSize: 100,
                limit: 0,
                verbose: false,
                withReactions: false,
                withFriendships: true,
            },
            stats,
        );
        expect(stats.scanned).toBe(2);
        expect(stats.copied).toBe(2);
        expect(stats.failed).toBe(0);
    });
});
