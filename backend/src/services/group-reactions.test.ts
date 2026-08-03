import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// In-memory shim that mimics the subset of PG queries used by group-reactions.ts.
// Lets us drive toggle / list / batch without touching real Postgres. The dispatch
// is based on the leading SQL text so the SQL fragments must stay in sync.

interface ReactionRow {
    post_id: string;
    user_id: string;
    emoji: string;
}

const store: ReactionRow[] = [];

function key(row: { post_id: string; user_id: string; emoji: string }): string {
    return `${row.post_id}::${row.user_id}::${row.emoji}`;
}

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            // Phase 1c dual-write: the shim looks up the social_entity_id
            // back-link on the legacy post and then writes the new-store row.
            // Tests in this file don't care about the mirror — return "no
            // link" so the shim warns + no-ops without touching app_social_*.
            if (text.startsWith('select social_entity_id from app_group_posts')) {
                return { rows: [{ social_entity_id: null }], rowCount: 1 };
            }
            if (text.startsWith('insert into app_social_reaction')) {
                return { rows: [], rowCount: 1 };
            }
            if (text.startsWith('delete from app_social_reaction')) {
                return { rows: [], rowCount: 0 };
            }

            // exists check
            if (text.startsWith('select 1 from app_group_feed_reactions')) {
                const [postId, userId, emoji] = params as [string, string, string];
                const hit = store.some((r) => r.post_id === postId && r.user_id === userId && r.emoji === emoji);
                return { rows: hit ? [{ '?column?': 1 }] : [], rowCount: hit ? 1 : 0 };
            }

            // delete
            if (text.startsWith('delete from app_group_feed_reactions')) {
                const [postId, userId, emoji] = params as [string, string, string];
                const before = store.length;
                const targetKey = key({ post_id: postId, user_id: userId, emoji });
                for (let i = store.length - 1; i >= 0; i--) {
                    if (key(store[i]) === targetKey) store.splice(i, 1);
                }
                return { rows: [], rowCount: before - store.length };
            }

            // insert
            if (text.startsWith('insert into app_group_feed_reactions')) {
                const [postId, userId, emoji] = params as [string, string, string];
                const targetKey = key({ post_id: postId, user_id: userId, emoji });
                if (!store.some((r) => key(r) === targetKey)) {
                    store.push({ post_id: postId, user_id: userId, emoji });
                }
                return { rows: [], rowCount: 1 };
            }

            // single-post aggregation
            if (text.startsWith('select emoji, count(*)::text as count')) {
                const [postId] = params as [string];
                const counts = new Map<string, number>();
                for (const row of store) {
                    if (row.post_id !== postId) continue;
                    counts.set(row.emoji, (counts.get(row.emoji) || 0) + 1);
                }
                const rows = Array.from(counts.entries())
                    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
                    .map(([emoji, count]) => ({ emoji, count: String(count) }));
                return { rows, rowCount: rows.length };
            }

            // batch aggregation
            if (text.startsWith('select post_id::text as post_id, emoji, count(*)::text as count')) {
                const [postIds] = params as [string[]];
                const ids = new Set(postIds);
                const grouped = new Map<string, Map<string, number>>();
                for (const row of store) {
                    if (!ids.has(row.post_id)) continue;
                    const bucket = grouped.get(row.post_id) || new Map<string, number>();
                    bucket.set(row.emoji, (bucket.get(row.emoji) || 0) + 1);
                    grouped.set(row.post_id, bucket);
                }
                const rows: Array<{ post_id: string; emoji: string; count: string }> = [];
                for (const [post_id, bucket] of grouped) {
                    for (const [emoji, count] of bucket) {
                        rows.push({ post_id, emoji, count: String(count) });
                    }
                }
                return { rows, rowCount: rows.length };
            }

            // mine lookup
            if (text.startsWith('select post_id::text as post_id, emoji')) {
                const [userId, postIds] = params as [string, string[]];
                const ids = new Set(postIds);
                const rows = store
                    .filter((r) => r.user_id === userId && ids.has(r.post_id))
                    .map((r) => ({ post_id: r.post_id, emoji: r.emoji }));
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

import {
    ALLOWED_EMOJI,
    isAllowedEmoji,
    toggleReaction,
    listReactions,
    listReactionsForPosts,
    getMyReactions,
} from './group-reactions.js';

let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    store.length = 0;
    // The Phase 1c dual-write shim warns on every toggle in these tests (no
    // mirror entity is wired up). Silence so test output stays clean.
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    consoleWarnSpy.mockRestore();
});

describe('ALLOWED_EMOJI', () => {
    it('exposes exactly the 5 spec-pinned emojis', () => {
        expect(ALLOWED_EMOJI).toEqual(['👍', '❤️', '😂', '🎉', '😢']);
    });

    it('isAllowedEmoji accepts only those 5', () => {
        for (const e of ALLOWED_EMOJI) {
            expect(isAllowedEmoji(e)).toBe(true);
        }
        expect(isAllowedEmoji('🔥')).toBe(false);
        expect(isAllowedEmoji('')).toBe(false);
        expect(isAllowedEmoji(null)).toBe(false);
        expect(isAllowedEmoji(undefined)).toBe(false);
        expect(isAllowedEmoji(0)).toBe(false);
    });
});

describe('toggleReaction validation', () => {
    it('rejects emojis outside the allow-list', async () => {
        await expect(toggleReaction('post-1', 'user-1', '🔥')).rejects.toThrow(/allowed/i);
        await expect(toggleReaction('post-1', 'user-1', '')).rejects.toThrow(/allowed/i);
        await expect(toggleReaction('post-1', 'user-1', 'javascript:')).rejects.toThrow(/allowed/i);
    });

    it('rejects empty postId / userId', async () => {
        await expect(toggleReaction('', 'user-1', '👍')).rejects.toThrow(/postId/);
        await expect(toggleReaction('   ', 'user-1', '👍')).rejects.toThrow(/postId/);
        await expect(toggleReaction('post-1', '', '👍')).rejects.toThrow(/userId/);
        await expect(toggleReaction('post-1', '   ', '👍')).rejects.toThrow(/userId/);
    });
});

describe('toggleReaction idempotency', () => {
    it('first call adds, second call removes (round-trip toggle)', async () => {
        const first = await toggleReaction('post-1', 'user-1', '👍');
        expect(first).toEqual({ added: true });

        const second = await toggleReaction('post-1', 'user-1', '👍');
        expect(second).toEqual({ added: false });

        // Back to clean state after the second toggle.
        expect(store).toHaveLength(0);
    });

    it('different users on the same post are independent', async () => {
        await toggleReaction('post-1', 'user-a', '👍');
        await toggleReaction('post-1', 'user-b', '👍');
        expect(store.filter((r) => r.post_id === 'post-1' && r.emoji === '👍')).toHaveLength(2);
    });

    it('the same user with different emojis are independent (one can pick several)', async () => {
        await toggleReaction('post-1', 'user-a', '👍');
        await toggleReaction('post-1', 'user-a', '❤️');
        expect(store).toHaveLength(2);

        // Removing one keeps the other.
        await toggleReaction('post-1', 'user-a', '👍');
        expect(store).toHaveLength(1);
        expect(store[0].emoji).toBe('❤️');
    });
});

describe('listReactions aggregation', () => {
    it('returns [] for a post with no reactions', async () => {
        expect(await listReactions('post-x')).toEqual([]);
    });

    it('counts correctly across users and emojis', async () => {
        await toggleReaction('post-1', 'user-a', '👍');
        await toggleReaction('post-1', 'user-b', '👍');
        await toggleReaction('post-1', 'user-c', '👍');
        await toggleReaction('post-1', 'user-a', '❤️');
        await toggleReaction('post-1', 'user-b', '❤️');
        await toggleReaction('post-1', 'user-a', '🎉');

        const aggregates = await listReactions('post-1');
        const byEmoji = Object.fromEntries(aggregates.map((r) => [r.emoji, r.count]));
        expect(byEmoji['👍']).toBe(3);
        expect(byEmoji['❤️']).toBe(2);
        expect(byEmoji['🎉']).toBe(1);
        // And that's it — never a row for an emoji nobody picked.
        expect(byEmoji['😂']).toBeUndefined();
    });

    it('returns only counts, never per-user identifiers (privacy guarantee)', async () => {
        await toggleReaction('post-1', 'user-secret', '👍');
        const aggregates = await listReactions('post-1');
        // Ensure the shape has only emoji+count and no userIds field at all.
        for (const row of aggregates) {
            expect(Object.keys(row).sort()).toEqual(['count', 'emoji']);
        }
    });
});

describe('listReactionsForPosts (batch)', () => {
    it('returns empty map when given no postIds', async () => {
        const map = await listReactionsForPosts([]);
        expect(map.size).toBe(0);
    });

    it('aggregates per-post and skips posts with zero reactions', async () => {
        await toggleReaction('post-1', 'user-a', '👍');
        await toggleReaction('post-1', 'user-b', '👍');
        await toggleReaction('post-2', 'user-a', '❤️');

        const map = await listReactionsForPosts(['post-1', 'post-2', 'post-3']);
        const post1 = map.get('post-1') || [];
        const post2 = map.get('post-2') || [];
        expect(post1.find((r) => r.emoji === '👍')?.count).toBe(2);
        expect(post2.find((r) => r.emoji === '❤️')?.count).toBe(1);
        expect(map.has('post-3')).toBe(false);
    });

    it('deduplicates input postIds defensively', async () => {
        await toggleReaction('post-1', 'user-a', '👍');
        const map = await listReactionsForPosts(['post-1', 'post-1', 'post-1']);
        expect(map.get('post-1')?.find((r) => r.emoji === '👍')?.count).toBe(1);
    });
});

describe('getMyReactions', () => {
    it('returns only the emojis the asking user toggled', async () => {
        await toggleReaction('post-1', 'me', '👍');
        await toggleReaction('post-1', 'me', '❤️');
        await toggleReaction('post-1', 'someone-else', '🎉');
        await toggleReaction('post-2', 'me', '😂');

        const mine = await getMyReactions(['post-1', 'post-2', 'post-3'], 'me');
        expect((mine.get('post-1') || []).sort()).toEqual(['❤️', '👍'].sort());
        expect(mine.get('post-2')).toEqual(['😂']);
        expect(mine.has('post-3')).toBe(false);

        // Other users do not show up in MY view.
        const theirs = await getMyReactions(['post-1'], 'someone-else');
        expect(theirs.get('post-1')).toEqual(['🎉']);
    });

    it('returns empty map for empty user or empty list', async () => {
        expect((await getMyReactions(['post-1'], '')).size).toBe(0);
        expect((await getMyReactions([], 'me')).size).toBe(0);
    });
});
