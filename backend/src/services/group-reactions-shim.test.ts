import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Phase 1c dual-write shim tests for reactions side-data. We mock the postgres
// bridge so the legacy back-link lookup and the universal INSERT/DELETE are
// observable without a real DB. The goal is to prove the shim's non-fatal
// contract — callers (services/group-reactions.ts) must never see throws from
// the new-store path, even when it explodes.

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

// Legacy back-link: post_id -> social_entity_id (or null).
const legacyById = new Map<string, string | null>();

// In-memory universal store: keyed on `${entity_id}::${user_id}::${emoji}`.
const socialReactions = new Set<string>();

function reactionKey(entityId: string, userId: string, emoji: string): string {
    return `${entityId}::${userId}::${emoji}`;
}

// Toggle which the SQL handler should "fail" on next call, to drive error
// paths. Each test sets one of these and the next matching query throws.
let throwOnSelect = false;
let throwOnInsert = false;
let throwOnDelete = false;

const fakeClient: FakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        const text = sql.trim().toLowerCase();

        // 1. Back-link lookup.
        if (text.startsWith('select social_entity_id from app_group_posts')) {
            if (throwOnSelect) {
                throwOnSelect = false;
                throw new Error('postgres select failed');
            }
            const [postId] = params as [string];
            if (!legacyById.has(postId)) {
                return { rows: [], rowCount: 0 };
            }
            const social = legacyById.get(postId) ?? null;
            return { rows: [{ social_entity_id: social }], rowCount: 1 };
        }

        // 2. INSERT into the universal reactions table.
        if (text.startsWith('insert into app_social_reaction')) {
            if (throwOnInsert) {
                throwOnInsert = false;
                throw new Error('insert failed');
            }
            const [entityId, userId, emoji] = params as [string, string, string];
            socialReactions.add(reactionKey(entityId, userId, emoji));
            return { rows: [], rowCount: 1 };
        }

        // 3. DELETE from the universal reactions table.
        if (text.startsWith('delete from app_social_reaction')) {
            if (throwOnDelete) {
                throwOnDelete = false;
                throw new Error('delete failed');
            }
            const [entityId, userId, emoji] = params as [string, string, string];
            const k = reactionKey(entityId, userId, emoji);
            const had = socialReactions.has(k);
            socialReactions.delete(k);
            return { rows: [], rowCount: had ? 1 : 0 };
        }

        throw new Error(`Unmocked SQL: ${sql}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        return await handler(fakeClient);
    }),
}));

import {
    shimMirrorAddGroupReaction,
    shimMirrorRemoveGroupReaction,
} from './group-reactions-shim.js';

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    legacyById.clear();
    socialReactions.clear();
    throwOnSelect = false;
    throwOnInsert = false;
    throwOnDelete = false;
    fakeClient.query.mockClear();
    // Silence the intentional shim logs so the test output stays clean.
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
});

describe('shimMirrorAddGroupReaction', () => {
    it('inserts into app_social_reaction when the legacy post has a social_entity_id link', async () => {
        legacyById.set('post-1', 'social-1');

        await shimMirrorAddGroupReaction('post-1', 'user-a', '👍');

        expect(socialReactions.has(reactionKey('social-1', 'user-a', '👍'))).toBe(true);
        // Look-up + INSERT — two queries.
        const calls = fakeClient.query.mock.calls.map(([sql]) => (sql as string).trim().toLowerCase());
        expect(calls.some((c) => c.startsWith('select social_entity_id'))).toBe(true);
        expect(calls.some((c) => c.startsWith('insert into app_social_reaction'))).toBe(true);
    });

    it('is a no-op when the legacy post has no social_entity_id link (logs warning)', async () => {
        legacyById.set('post-2', null);

        await shimMirrorAddGroupReaction('post-2', 'user-a', '👍');

        expect(socialReactions.size).toBe(0);
        // SELECT happened, INSERT did not.
        const calls = fakeClient.query.mock.calls.map(([sql]) => (sql as string).trim().toLowerCase());
        expect(calls.some((c) => c.startsWith('insert into app_social_reaction'))).toBe(false);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('no social_entity_id link for add'),
            expect.objectContaining({ legacyPostId: 'post-2' })
        );
    });

    it('is a no-op when the legacy post row does not exist at all', async () => {
        // legacyById is empty — SELECT returns no rows.
        await shimMirrorAddGroupReaction('ghost-post', 'user-a', '👍');
        expect(socialReactions.size).toBe(0);
        expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('swallows errors from the underlying INSERT (does not throw to the caller)', async () => {
        legacyById.set('post-3', 'social-3');
        throwOnInsert = true;

        await expect(shimMirrorAddGroupReaction('post-3', 'user-a', '👍')).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('add failed for group_feed_reactions'),
            expect.objectContaining({ legacyPostId: 'post-3' })
        );
    });

    it('swallows errors from the back-link SELECT', async () => {
        legacyById.set('post-3b', 'social-3b');
        throwOnSelect = true;

        await expect(shimMirrorAddGroupReaction('post-3b', 'user-a', '👍')).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('add failed for group_feed_reactions'),
            expect.objectContaining({ legacyPostId: 'post-3b' })
        );
    });

    it('is idempotent at the SQL layer (ON CONFLICT DO NOTHING)', async () => {
        legacyById.set('post-4', 'social-4');

        await shimMirrorAddGroupReaction('post-4', 'user-a', '❤️');
        await shimMirrorAddGroupReaction('post-4', 'user-a', '❤️');

        // Re-adding the same triple stays a single Set entry.
        expect(socialReactions.size).toBe(1);
        expect(socialReactions.has(reactionKey('social-4', 'user-a', '❤️'))).toBe(true);
    });
});

describe('shimMirrorRemoveGroupReaction', () => {
    it('issues an explicit DELETE keyed on (entity_id, user_id, emoji) when the link exists', async () => {
        legacyById.set('post-5', 'social-5');
        socialReactions.add(reactionKey('social-5', 'user-a', '👍'));

        await shimMirrorRemoveGroupReaction('post-5', 'user-a', '👍');

        expect(socialReactions.has(reactionKey('social-5', 'user-a', '👍'))).toBe(false);
        const calls = fakeClient.query.mock.calls.map(([sql]) => (sql as string).trim().toLowerCase());
        expect(calls.some((c) => c.startsWith('delete from app_social_reaction'))).toBe(true);
    });

    it('is a no-op when the legacy post has no social_entity_id link (logs warning)', async () => {
        legacyById.set('post-6', null);
        socialReactions.add(reactionKey('social-x', 'user-a', '👍'));

        await shimMirrorRemoveGroupReaction('post-6', 'user-a', '👍');

        // Universal store untouched.
        expect(socialReactions.has(reactionKey('social-x', 'user-a', '👍'))).toBe(true);
        const calls = fakeClient.query.mock.calls.map(([sql]) => (sql as string).trim().toLowerCase());
        expect(calls.some((c) => c.startsWith('delete from app_social_reaction'))).toBe(false);
        expect(consoleWarnSpy).toHaveBeenCalledWith(
            expect.stringContaining('no social_entity_id link for remove'),
            expect.objectContaining({ legacyPostId: 'post-6' })
        );
    });

    it('is idempotent — deleting a non-existent reaction is silent', async () => {
        legacyById.set('post-7', 'social-7');
        // No reaction in the universal store to begin with.

        await expect(shimMirrorRemoveGroupReaction('post-7', 'user-a', '👍')).resolves.toBeUndefined();
        expect(socialReactions.size).toBe(0);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
    });

    it('swallows errors from the underlying DELETE (does not throw to the caller)', async () => {
        legacyById.set('post-8', 'social-8');
        socialReactions.add(reactionKey('social-8', 'user-a', '👍'));
        throwOnDelete = true;

        await expect(shimMirrorRemoveGroupReaction('post-8', 'user-a', '👍')).resolves.toBeUndefined();
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            expect.stringContaining('remove failed for group_feed_reactions'),
            expect.objectContaining({ legacyPostId: 'post-8' })
        );
        // The reaction is still there because the DELETE threw before the fake
        // mutated state — proves the legacy path stays decoupled from us.
        expect(socialReactions.has(reactionKey('social-8', 'user-a', '👍'))).toBe(true);
    });

    it('does not call DELETE for orphan posts even if reactions exist in the universal store under some other id', async () => {
        // Pre-shim post with no link. The universal-store row for *another*
        // entity must not be touched by this shim call.
        legacyById.set('orphan-post', null);
        socialReactions.add(reactionKey('other-entity', 'user-a', '👍'));

        await shimMirrorRemoveGroupReaction('orphan-post', 'user-a', '👍');

        expect(socialReactions.has(reactionKey('other-entity', 'user-a', '👍'))).toBe(true);
    });
});

describe('add + remove round-trip', () => {
    it('a follow-up remove cleanly clears the row added by the shim', async () => {
        legacyById.set('post-9', 'social-9');

        await shimMirrorAddGroupReaction('post-9', 'user-a', '🎉');
        expect(socialReactions.has(reactionKey('social-9', 'user-a', '🎉'))).toBe(true);

        await shimMirrorRemoveGroupReaction('post-9', 'user-a', '🎉');
        expect(socialReactions.has(reactionKey('social-9', 'user-a', '🎉'))).toBe(false);
    });
});
