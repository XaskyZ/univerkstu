import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory shim that mimics the subset of PG queries used by
// notification-prefs.ts. Dispatch is based on the leading SQL text so the
// fragments must stay in sync with the service.

interface PrefsRow {
    user_id: string;
    enabled_kinds: Record<string, boolean>;
    updated_at: Date;
    created_at: Date;
}

const store: Map<string, PrefsRow> = new Map();
let pgUnavailable = false;
let throwOnSelect = false;

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            if (throwOnSelect && text.startsWith('select user_id, enabled_kinds')) {
                throw new Error('forced PG error');
            }

            if (text.startsWith('select user_id, enabled_kinds')) {
                const [userId] = params as [string];
                const row = store.get(userId);
                if (!row) return { rows: [], rowCount: 0 };
                return { rows: [row], rowCount: 1 };
            }

            if (text.startsWith('insert into app_notification_prefs')) {
                const [userId, enabledKindsJson, now] = params as [string, string, Date];
                const updates = JSON.parse(enabledKindsJson) as Record<string, boolean>;
                const existing = store.get(userId);
                if (existing) {
                    // ON CONFLICT … DO UPDATE … || excluded merges keys (excluded wins).
                    const merged = { ...existing.enabled_kinds, ...updates };
                    const next: PrefsRow = {
                        ...existing,
                        enabled_kinds: merged,
                        updated_at: now,
                    };
                    store.set(userId, next);
                    return { rows: [next], rowCount: 1 };
                }
                const row: PrefsRow = {
                    user_id: userId,
                    enabled_kinds: { ...updates },
                    updated_at: now,
                    created_at: now,
                };
                store.set(userId, row);
                return { rows: [row], rowCount: 1 };
            }

            throw new Error(`Unmocked SQL: ${sql}`);
        }),
    };
}

const fakeClient = makeClient();

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: FakeClient) => Promise<unknown>) => {
        if (pgUnavailable) return null;
        return await handler(fakeClient);
    }),
}));

import {
    getNotificationPrefs,
    setNotificationPrefs,
    isPushKindEnabledForUser,
    isValidNotificationKind,
    NOTIFICATION_KINDS,
} from './notification-prefs.js';

beforeEach(() => {
    store.clear();
    pgUnavailable = false;
    throwOnSelect = false;
    fakeClient.query.mockClear();
});

// === Validation helpers =====================================================

describe('isValidNotificationKind', () => {
    it('accepts every kind in the public union', () => {
        for (const kind of NOTIFICATION_KINDS) {
            expect(isValidNotificationKind(kind)).toBe(true);
        }
    });

    it('rejects unknown strings and non-strings', () => {
        expect(isValidNotificationKind('whatever')).toBe(false);
        expect(isValidNotificationKind('')).toBe(false);
        expect(isValidNotificationKind(undefined)).toBe(false);
        expect(isValidNotificationKind(42)).toBe(false);
        expect(isValidNotificationKind({})).toBe(false);
    });
});

// === getNotificationPrefs ====================================================

describe('getNotificationPrefs', () => {
    it('returns default-on (empty map) when no row exists', async () => {
        const prefs = await getNotificationPrefs('alice');
        expect(prefs.userId).toBe('alice');
        expect(prefs.enabledKinds).toEqual({});
        expect(typeof prefs.createdAt).toBe('string');
        expect(typeof prefs.updatedAt).toBe('string');
    });

    it('returns the stored map when a row exists', async () => {
        const now = new Date('2025-01-01T00:00:00.000Z');
        store.set('alice', {
            user_id: 'alice',
            enabled_kinds: { social_mention: false, social_dm: true },
            created_at: now,
            updated_at: now,
        });
        const prefs = await getNotificationPrefs('alice');
        expect(prefs.enabledKinds).toEqual({ social_mention: false, social_dm: true });
    });

    it('drops unknown keys defensively when sanitizing the row', async () => {
        const now = new Date();
        store.set('alice', {
            user_id: 'alice',
            // mash in a junk key that someone could have inserted directly.
            enabled_kinds: { social_mention: true, garbage: true, '1day': false } as Record<string, boolean>,
            created_at: now,
            updated_at: now,
        });
        const prefs = await getNotificationPrefs('alice');
        expect(prefs.enabledKinds).toEqual({ social_mention: true, '1day': false });
        expect(Object.prototype.hasOwnProperty.call(prefs.enabledKinds, 'garbage')).toBe(false);
    });

    it('returns defaults when PG is unavailable (fail-open)', async () => {
        pgUnavailable = true;
        const prefs = await getNotificationPrefs('alice');
        expect(prefs.enabledKinds).toEqual({});
    });
});

// === setNotificationPrefs ====================================================

describe('setNotificationPrefs', () => {
    it('inserts a new row with the provided keys (first write)', async () => {
        const out = await setNotificationPrefs('alice', { social_mention: false });
        expect(out.enabledKinds).toEqual({ social_mention: false });
        expect(store.get('alice')?.enabled_kinds).toEqual({ social_mention: false });
    });

    it('merges with an existing row (preserves untouched keys)', async () => {
        await setNotificationPrefs('alice', { social_mention: false, social_dm: true });
        await setNotificationPrefs('alice', { social_dm: false });
        const stored = store.get('alice');
        expect(stored?.enabled_kinds).toEqual({ social_mention: false, social_dm: false });
    });

    it('drops invalid keys silently', async () => {
        // Caller may have tried to write an unknown kind — the service drops
        // it without erroring so the rest of the patch still applies.
        const out = await setNotificationPrefs('alice', {
            social_mention: false,
            bogus_kind: true,
        } as Partial<Record<'social_mention' | 'bogus_kind', boolean>> as never);
        expect(out.enabledKinds).toEqual({ social_mention: false });
        expect(Object.keys(store.get('alice')?.enabled_kinds ?? {})).toEqual(['social_mention']);
    });

    it('drops non-boolean values silently', async () => {
        const out = await setNotificationPrefs('alice', {
            social_mention: 'yes',
        } as unknown as Partial<Record<'social_mention', boolean>>);
        expect(out.enabledKinds).toEqual({});
    });

    it('throws when PG is unavailable (caller decides how to surface)', async () => {
        pgUnavailable = true;
        await expect(setNotificationPrefs('alice', { social_mention: false }))
            .rejects.toThrow(/Postgres unavailable/);
    });
});

// === isPushKindEnabledForUser ================================================

describe('isPushKindEnabledForUser', () => {
    it('returns true when no row exists (default-on)', async () => {
        expect(await isPushKindEnabledForUser('alice', 'social_mention')).toBe(true);
    });

    it('returns true when the kind key is absent from the stored map', async () => {
        const now = new Date();
        store.set('alice', {
            user_id: 'alice',
            // other kinds present but the queried one is missing.
            enabled_kinds: { social_dm: false },
            created_at: now,
            updated_at: now,
        });
        expect(await isPushKindEnabledForUser('alice', 'social_mention')).toBe(true);
    });

    it('returns false for an explicit opt-out', async () => {
        const now = new Date();
        store.set('alice', {
            user_id: 'alice',
            enabled_kinds: { social_mention: false },
            created_at: now,
            updated_at: now,
        });
        expect(await isPushKindEnabledForUser('alice', 'social_mention')).toBe(false);
    });

    it('returns true when the user explicitly set the kind to true', async () => {
        const now = new Date();
        store.set('alice', {
            user_id: 'alice',
            enabled_kinds: { social_mention: true },
            created_at: now,
            updated_at: now,
        });
        expect(await isPushKindEnabledForUser('alice', 'social_mention')).toBe(true);
    });

    it('returns false for an unknown kind argument (defensive)', async () => {
        // An invalid kind value should never produce a delivery — the caller
        // is feeding garbage and we do not invent push for it.
        expect(
            await isPushKindEnabledForUser('alice', 'whatever' as never),
        ).toBe(false);
    });

    it('returns true (fail-open) when PG is unavailable', async () => {
        pgUnavailable = true;
        expect(await isPushKindEnabledForUser('alice', 'social_mention')).toBe(true);
    });

    it('returns true (fail-open) when the SELECT throws unexpectedly', async () => {
        throwOnSelect = true;
        expect(await isPushKindEnabledForUser('alice', 'social_mention')).toBe(true);
    });

    it('honors a freshly-written opt-out in a subsequent read', async () => {
        await setNotificationPrefs('alice', { social_dm: false });
        expect(await isPushKindEnabledForUser('alice', 'social_dm')).toBe(false);
        // Other kinds remain default-on.
        expect(await isPushKindEnabledForUser('alice', 'social_mention')).toBe(true);
    });
});
