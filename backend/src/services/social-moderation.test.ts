/**
 * Service-layer tests for the universal social moderation surface
 * (reports + mutes). Uses an in-memory shim that mirrors the shape of the
 * `app_social_report`, `app_social_mute` and `app_social_entity` queries
 * issued by `services/social-moderation.ts`. SQL dispatch is by leading-text
 * matching — the fragments here must stay in sync with the service.
 *
 * Coverage:
 *   - reportEntity: validation, missing-entity 404, idempotent re-reports,
 *     reason cap, normalization of empty reasons → null
 *   - listReports: status filter, pagination, default newest-first ordering
 *   - reviewReport: dismiss vs remove (delegates to softDeleteEntity),
 *     "already reviewed" guard, missing report 404
 *   - muteUser / unmuteUser: scope isolation, idempotent upsert, permanent vs
 *     timed mutes, reason cap
 *   - isUserMuted: scope sensitivity, expiry honouring
 *   - getActiveMutes: filters expired rows, sorts newest-first
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- In-memory store + fake pg client ----------------------------------

interface EntityRow {
    id: string;
    deleted_at: Date | null;
    deleted_by_user_id: string | null;
    deleted_reason: string | null;
    author_user_id: string;
}

interface ReportRow {
    id: string;
    entity_id: string;
    reporter_user_id: string;
    reason: string | null;
    status: 'pending' | 'dismissed' | 'actioned';
    reviewer_user_id: string | null;
    reviewed_at: Date | null;
    created_at: Date;
}

interface MuteRow {
    user_id: string;
    scope_type: string;
    scope_id: string;
    muted_until: Date | null;
    reason: string | null;
    moderator_user_id: string;
    created_at: Date;
}

const store = {
    entities: [] as EntityRow[],
    reports: [] as ReportRow[],
    mutes: [] as MuteRow[],
};

let idCounter = 0;
function nextId(): string {
    idCounter += 1;
    return `id-${idCounter.toString().padStart(6, '0')}`;
}

function reset(): void {
    store.entities.length = 0;
    store.reports.length = 0;
    store.mutes.length = 0;
    idCounter = 0;
}

interface FakeClient {
    query: ReturnType<typeof vi.fn>;
}

function makeClient(): FakeClient {
    return {
        query: vi.fn(async (sql: string, params: unknown[] = []) => {
            const text = sql.trim().toLowerCase();

            // === Entity lookups ===
            if (text.startsWith('select id::text as id from app_social_entity')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id);
                return { rows: row ? [{ id: row.id }] : [], rowCount: row ? 1 : 0 };
            }

            // softDeleteEntity full row select (from services/social.ts)
            if (text.startsWith('select * from app_social_entity where id =')) {
                const [id] = params as [string];
                const row = store.entities.find((e) => e.id === id);
                return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
            }

            // services/social.ts delete update
            if (text.includes('set deleted_at = now()')) {
                const [id, actor, reason] = params as [string, string, string | null];
                const row = store.entities.find((e) => e.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.deleted_at = new Date();
                row.deleted_by_user_id = actor;
                row.deleted_reason = reason;
                return { rows: [], rowCount: 1 };
            }

            // social.ts insertRevision — accept all writes, no assertion needed
            if (text.startsWith('insert into app_social_revision')) {
                return { rows: [], rowCount: 1 };
            }
            // social.ts insertMentions — same
            if (text.startsWith('insert into app_social_mention')) {
                return { rows: [], rowCount: 1 };
            }

            // === Report inserts ===
            if (text.startsWith('insert into app_social_report')) {
                const [entityId, reporter, reason] = params as [string, string, string | null];
                const row: ReportRow = {
                    id: nextId(),
                    entity_id: entityId,
                    reporter_user_id: reporter,
                    reason,
                    status: 'pending',
                    reviewer_user_id: null,
                    reviewed_at: null,
                    created_at: new Date(),
                };
                store.reports.push(row);
                return { rows: [{ id: row.id }], rowCount: 1 };
            }

            // === Report select for review ===
            if (text.startsWith('select id::text as id, entity_id::text as entity_id, status')) {
                const [id] = params as [string];
                const row = store.reports.find((r) => r.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                return {
                    rows: [{ id: row.id, entity_id: row.entity_id, status: row.status }],
                    rowCount: 1,
                };
            }

            // === Report update (review) ===
            if (text.startsWith('update app_social_report')) {
                const [id, status, reviewer] = params as [string, ReportRow['status'], string];
                const row = store.reports.find((r) => r.id === id);
                if (!row) return { rows: [], rowCount: 0 };
                row.status = status;
                row.reviewer_user_id = reviewer;
                row.reviewed_at = new Date();
                return { rows: [], rowCount: 1 };
            }

            // === Report list ===
            if (
                text.startsWith('select')
                && text.includes('from app_social_report')
                && text.includes('order by created_at desc')
            ) {
                let filtered = store.reports.slice();
                let limitIdx: number;
                let offsetIdx: number;
                if (params.length === 3) {
                    const [status] = params as [string, number, number];
                    filtered = filtered.filter((r) => r.status === status);
                    limitIdx = 1;
                    offsetIdx = 2;
                } else {
                    limitIdx = 0;
                    offsetIdx = 1;
                }
                filtered.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
                const limit = params[limitIdx] as number;
                const offset = params[offsetIdx] as number;
                const paged = filtered.slice(offset, offset + limit).map((r) => ({
                    id: r.id,
                    entity_id: r.entity_id,
                    reporter_user_id: r.reporter_user_id,
                    reason: r.reason,
                    status: r.status,
                    reviewer_user_id: r.reviewer_user_id,
                    reviewed_at: r.reviewed_at,
                    created_at: r.created_at,
                }));
                return { rows: paged, rowCount: paged.length };
            }

            // === Force-delete fallback (reviewer-not-author path) ===
            if (
                text.startsWith('update app_social_entity')
                && text.includes("deleted_reason = 'moderation'")
            ) {
                const [entityId, reviewer] = params as [string, string];
                const row = store.entities.find((e) => e.id === entityId);
                if (!row || row.deleted_at) return { rows: [], rowCount: 0 };
                row.deleted_at = new Date();
                row.deleted_by_user_id = reviewer;
                row.deleted_reason = 'moderation';
                return { rows: [], rowCount: 1 };
            }

            // === Mute upsert ===
            if (text.startsWith('insert into app_social_mute')) {
                const [userId, scopeType, scopeId, mutedUntilRaw, reason, moderator] = params as [
                    string, string, string, string | null, string | null, string,
                ];
                const mutedUntil = mutedUntilRaw ? new Date(mutedUntilRaw) : null;
                const existing = store.mutes.find(
                    (m) => m.user_id === userId && m.scope_type === scopeType && m.scope_id === scopeId,
                );
                if (existing) {
                    existing.muted_until = mutedUntil;
                    existing.reason = reason;
                    existing.moderator_user_id = moderator;
                    existing.created_at = new Date();
                } else {
                    store.mutes.push({
                        user_id: userId,
                        scope_type: scopeType,
                        scope_id: scopeId,
                        muted_until: mutedUntil,
                        reason,
                        moderator_user_id: moderator,
                        created_at: new Date(),
                    });
                }
                return { rows: [], rowCount: 1 };
            }

            // === Mute delete ===
            if (text.startsWith('delete from app_social_mute')) {
                const [userId, scopeType, scopeId] = params as [string, string, string];
                const before = store.mutes.length;
                for (let i = store.mutes.length - 1; i >= 0; i--) {
                    const m = store.mutes[i];
                    if (m.user_id === userId && m.scope_type === scopeType && m.scope_id === scopeId) {
                        store.mutes.splice(i, 1);
                    }
                }
                return { rows: [], rowCount: before - store.mutes.length };
            }

            // === Mute lookup (isUserMuted) ===
            if (
                text.startsWith('select muted_until')
                && text.includes('from app_social_mute')
            ) {
                const [userId, scopeType, scopeId] = params as [string, string, string];
                const row = store.mutes.find(
                    (m) => m.user_id === userId && m.scope_type === scopeType && m.scope_id === scopeId,
                );
                return { rows: row ? [{ muted_until: row.muted_until }] : [], rowCount: row ? 1 : 0 };
            }

            // === Active mutes for a user ===
            if (
                text.startsWith('select')
                && text.includes('from app_social_mute')
                && text.includes('muted_until is null or muted_until > now()')
            ) {
                const [userId] = params as [string];
                const now = Date.now();
                const rows = store.mutes
                    .filter((m) => m.user_id === userId)
                    .filter((m) => m.muted_until === null || m.muted_until.getTime() > now)
                    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
                    .map((m) => ({ ...m }));
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
    SOCIAL_MUTE_REASON_MAX_LENGTH,
    SOCIAL_REPORT_REASON_MAX_LENGTH,
    getActiveMutes,
    isUserMuted,
    listReports,
    muteUser,
    reportEntity,
    reviewReport,
    unmuteUser,
} from './social-moderation.js';

function seedEntity(opts: Partial<EntityRow> = {}): EntityRow {
    const row: EntityRow = {
        id: nextId(),
        deleted_at: null,
        deleted_by_user_id: null,
        deleted_reason: null,
        author_user_id: 'author',
        ...opts,
    };
    store.entities.push(row);
    return row;
}

beforeEach(() => {
    reset();
});

describe('reportEntity', () => {
    it('inserts a pending report against an existing entity', async () => {
        const e = seedEntity();
        const res = await reportEntity(e.id, 'reporter-1', 'spam');
        expect(res.id).toMatch(/^id-/);
        const stored = store.reports.find((r) => r.id === res.id);
        expect(stored?.entity_id).toBe(e.id);
        expect(stored?.status).toBe('pending');
        expect(stored?.reason).toBe('spam');
    });

    it('normalizes an empty/whitespace reason to null', async () => {
        const e = seedEntity();
        const a = await reportEntity(e.id, 'r', '   ');
        const b = await reportEntity(e.id, 'r', undefined);
        expect(store.reports.find((r) => r.id === a.id)?.reason).toBeNull();
        expect(store.reports.find((r) => r.id === b.id)?.reason).toBeNull();
    });

    it('rejects when reason exceeds the cap', async () => {
        const e = seedEntity();
        const tooLong = 'x'.repeat(SOCIAL_REPORT_REASON_MAX_LENGTH + 1);
        await expect(reportEntity(e.id, 'r', tooLong)).rejects.toThrow(/reason too long/);
    });

    it('throws not found for an unknown entity', async () => {
        await expect(reportEntity('id-ghost', 'r', 'x')).rejects.toThrow(/not found/);
    });

    it('requires entityId and reporterUserId', async () => {
        await expect(reportEntity('', 'r')).rejects.toThrow(/entityId/);
        const e = seedEntity();
        await expect(reportEntity(e.id, '')).rejects.toThrow(/reporterUserId/);
    });
});

describe('listReports', () => {
    it('filters by status and orders newest first', async () => {
        const e = seedEntity();
        const a = await reportEntity(e.id, 'r1');
        await new Promise((r) => setTimeout(r, 1));
        const b = await reportEntity(e.id, 'r2');
        await reviewReport(b.id, 'mod', 'dismiss');

        const pending = await listReports({ status: 'pending' });
        expect(pending.map((r) => r.id)).toEqual([a.id]);

        const dismissed = await listReports({ status: 'dismissed' });
        expect(dismissed.map((r) => r.id)).toEqual([b.id]);
    });

    it('paginates with limit + offset', async () => {
        const e = seedEntity();
        for (let i = 0; i < 5; i++) {
            await reportEntity(e.id, `r${i}`);
            await new Promise((r) => setTimeout(r, 1));
        }
        const page1 = await listReports({ limit: 2, offset: 0 });
        const page2 = await listReports({ limit: 2, offset: 2 });
        expect(page1).toHaveLength(2);
        expect(page2).toHaveLength(2);
        expect(page1[0].id).not.toBe(page2[0].id);
    });
});

describe('reviewReport', () => {
    it('dismiss marks status without touching the entity', async () => {
        const e = seedEntity();
        const r = await reportEntity(e.id, 'rep');
        await reviewReport(r.id, 'mod', 'dismiss');

        expect(store.reports.find((row) => row.id === r.id)?.status).toBe('dismissed');
        expect(store.entities.find((en) => en.id === e.id)?.deleted_at).toBeNull();
    });

    it('remove soft-deletes the entity and marks the report actioned', async () => {
        const e = seedEntity({ author_user_id: 'mod' });
        const r = await reportEntity(e.id, 'rep');
        await reviewReport(r.id, 'mod', 'remove');

        expect(store.reports.find((row) => row.id === r.id)?.status).toBe('actioned');
        const entity = store.entities.find((en) => en.id === e.id);
        expect(entity?.deleted_at).not.toBeNull();
        expect(entity?.deleted_reason).toBe('moderation');
    });

    it('remove falls back to a force-delete when reviewer is not the author', async () => {
        const e = seedEntity({ author_user_id: 'someone-else' });
        const r = await reportEntity(e.id, 'rep');
        await reviewReport(r.id, 'mod', 'remove');

        const entity = store.entities.find((en) => en.id === e.id);
        expect(entity?.deleted_at).not.toBeNull();
        expect(entity?.deleted_by_user_id).toBe('mod');
    });

    it('rejects re-review of an already-resolved report', async () => {
        const e = seedEntity();
        const r = await reportEntity(e.id, 'rep');
        await reviewReport(r.id, 'mod', 'dismiss');
        await expect(reviewReport(r.id, 'mod', 'dismiss')).rejects.toThrow(/already reviewed/);
    });

    it('throws not found for unknown report id', async () => {
        await expect(reviewReport('id-ghost', 'mod', 'dismiss')).rejects.toThrow(/not found/);
    });

    it('rejects an invalid action', async () => {
        const e = seedEntity();
        const r = await reportEntity(e.id, 'rep');
        // @ts-expect-error — runtime check
        await expect(reviewReport(r.id, 'mod', 'banana')).rejects.toThrow(/invalid action/);
    });
});

describe('muteUser / unmuteUser / isUserMuted', () => {
    it('mutes are scope-isolated', async () => {
        await muteUser('alice', 'global', 'global:chat', 'mod');
        expect(await isUserMuted('alice', 'global', 'global:chat')).toBe(true);
        expect(await isUserMuted('alice', 'group', 'group:ITS-21')).toBe(false);
        expect(await isUserMuted('bob', 'global', 'global:chat')).toBe(false);
    });

    it('permanent mute persists; unmute removes it', async () => {
        await muteUser('alice', 'global', 'global:chat', 'mod');
        const stored = store.mutes.find((m) => m.user_id === 'alice');
        expect(stored?.muted_until).toBeNull();

        await unmuteUser('alice', 'global', 'global:chat');
        expect(await isUserMuted('alice', 'global', 'global:chat')).toBe(false);
    });

    it('timed mute honors expiry via durationMs', async () => {
        await muteUser('alice', 'global', 'global:chat', 'mod', { durationMs: 60_000 });
        const stored = store.mutes.find((m) => m.user_id === 'alice');
        expect(stored?.muted_until).not.toBeNull();
        expect(await isUserMuted('alice', 'global', 'global:chat')).toBe(true);
    });

    it('expired mute is treated as unmuted', async () => {
        await muteUser('alice', 'global', 'global:chat', 'mod', { durationMs: 50 });
        const row = store.mutes.find((m) => m.user_id === 'alice')!;
        row.muted_until = new Date(Date.now() - 1000);
        expect(await isUserMuted('alice', 'global', 'global:chat')).toBe(false);
    });

    it('upsert refreshes an existing mute row instead of inserting a duplicate', async () => {
        await muteUser('alice', 'global', 'global:chat', 'mod', { reason: 'first' });
        await muteUser('alice', 'global', 'global:chat', 'mod', { reason: 'second' });
        const rows = store.mutes.filter((m) => m.user_id === 'alice');
        expect(rows).toHaveLength(1);
        expect(rows[0].reason).toBe('second');
    });

    it('rejects an oversized reason', async () => {
        const tooLong = 'x'.repeat(SOCIAL_MUTE_REASON_MAX_LENGTH + 1);
        await expect(
            muteUser('alice', 'global', 'global:chat', 'mod', { reason: tooLong }),
        ).rejects.toThrow(/reason too long/);
    });

    it('unmute is idempotent when the row is missing', async () => {
        await expect(unmuteUser('ghost', 'global', 'global:chat')).resolves.toBeUndefined();
    });

    it('isUserMuted with missing userId/scopeId returns false', async () => {
        expect(await isUserMuted('', 'global', 'global:chat')).toBe(false);
        expect(await isUserMuted('alice', 'global', '')).toBe(false);
    });
});

describe('getActiveMutes', () => {
    it('returns only non-expired mutes for the user, newest first', async () => {
        await muteUser('alice', 'global', 'global:chat', 'mod');
        await new Promise((r) => setTimeout(r, 1));
        await muteUser('alice', 'group', 'group:ITS-21', 'mod', { durationMs: 60_000 });
        await new Promise((r) => setTimeout(r, 1));
        await muteUser('alice', 'dm', 'dm:expired', 'mod', { durationMs: 50 });
        // Force-expire the dm mute
        const expired = store.mutes.find((m) => m.scope_type === 'dm')!;
        expired.muted_until = new Date(Date.now() - 1000);

        const mutes = await getActiveMutes('alice');
        expect(mutes).toHaveLength(2);
        expect(mutes.map((m) => m.scopeType).sort()).toEqual(['global', 'group']);
    });

    it('returns empty array when user has no mutes', async () => {
        expect(await getActiveMutes('ghost')).toEqual([]);
    });
});
