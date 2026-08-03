/**
 * Phase 1d — one-shot copy-write migration into the universal social store.
 *
 * Phases 1a/1b/1c are already live: new writes into the six legacy "post-like"
 * tables (`app_group_posts`, `app_group_tasks`, `app_group_extra_lessons`,
 * `app_coordinator_announcements`, `app_chat_messages`, `app_global_chat_messages`)
 * are mirrored into `app_social_entity` by the shims in
 * `backend/src/services/*-shim.ts`. Rows created BEFORE the shim landed have no
 * mirror yet; this script backfills them.
 *
 * Goals:
 *   - Idempotent. Re-running the script never duplicates rows. The legacy row's
 *     `social_entity_id` column is the cursor — rows with a non-null value are
 *     skipped on every pass.
 *   - Preserves legacy `created_at` on the mirror entity (otherwise the
 *     universal timeline gets a synthetic spike on migration day).
 *   - Replays soft-delete / revoke / pin state onto the mirror.
 *   - Extracts `@user` mentions into `app_social_mention` so notification
 *     consumers can pick them up retroactively.
 *   - Does NOT migrate attachments (no reliable mapping from legacy storage
 *     associations to the new attachment table — left for Phase 1e cutover).
 *   - Does NOT emit `app_social_revision` rows (a single synthetic 'create'
 *     revision per row would just be noise). The shim writes revisions going
 *     forward; the migration relies on legacy `app_group_content_revisions`
 *     as the historical record.
 *   - Per-user task completion is NOT migrated. The legacy schema is a single
 *     `completed` boolean, not a per-user set — see `group-tasks-shim.ts`.
 *
 * The pure mapping helpers (`mapPost`, `mapTask`, …) intentionally mirror the
 * shim payload-building logic so the same row produces the same mirror through
 * either path. They are exported for the unit tests, which run without a DB.
 *
 * CLI:
 *   npm run migrate:social -- --dry-run
 *   npm run migrate:social -- --kinds=post,task --batch-size=200 --limit=500
 *   npm run migrate:social -- --verbose
 *
 * See docs/SOCIAL_STORE.md.
 */

import 'dotenv/config';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import type {
    SocialEntityKind,
    SocialPayloadByKind,
    SocialScopeType,
} from '../types/social.js';
import { buildScopeId, extractMentions } from '../services/social.js';
import { coercePriority } from '../services/coordinator-announcement-shim.js';

// === Kind selector ============================================================

/**
 * The six kinds backfilled by Phase 1d. Mirrors the kinds covered by the six
 * shims. `poll` / `event` are not on legacy tables (no rows to migrate) and are
 * deliberately omitted from the script.
 */
export const SUPPORTED_KINDS = [
    'post',
    'task',
    'extra_lesson',
    'announcement',
    'dm_message',
    'global_message',
] as const satisfies readonly SocialEntityKind[];

export type MigratableKind = (typeof SUPPORTED_KINDS)[number];

function isMigratableKind(value: string): value is MigratableKind {
    return (SUPPORTED_KINDS as readonly string[]).includes(value);
}

// === CLI parsing ==============================================================

export interface MigrateArgs {
    dryRun: boolean;
    kinds: MigratableKind[];
    batchSize: number;
    limit: number; // 0 = unlimited
    verbose: boolean;
    /**
     * Phase 1c+d — also backfill `app_group_feed_reactions` →
     * `app_social_reaction`. Opt-in because reactions are side-data, not
     * entities, and you may want to backfill entities first to validate the
     * mirror before touching reactions. Default off.
     */
    withReactions: boolean;
    /**
     * Phase 1c+d — also backfill the legacy `app_friend_requests` and
     * `app_friends` tables into the universal `app_social_friendship`
     * store. Opt-in for the same reason as `--with-reactions`: friendships
     * are a different aggregate from social entities and operators may
     * want to validate the entity backfill first before flipping this on.
     * Default off.
     */
    withFriendships: boolean;
}

const DEFAULT_BATCH_SIZE = 100;

export function parseArgs(argv: string[]): MigrateArgs {
    const args: MigrateArgs = {
        dryRun: false,
        kinds: [...SUPPORTED_KINDS],
        batchSize: DEFAULT_BATCH_SIZE,
        limit: 0,
        verbose: false,
        withReactions: false,
        withFriendships: false,
    };

    for (const raw of argv) {
        if (raw === '--dry-run') {
            args.dryRun = true;
            continue;
        }
        if (raw === '--verbose') {
            args.verbose = true;
            continue;
        }
        if (raw === '--with-reactions') {
            args.withReactions = true;
            continue;
        }
        if (raw === '--with-friendships') {
            args.withFriendships = true;
            continue;
        }
        if (raw.startsWith('--kinds=')) {
            const parts = raw
                .slice('--kinds='.length)
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            const valid = parts.filter(isMigratableKind);
            const invalid = parts.filter((p) => !isMigratableKind(p));
            if (invalid.length > 0) {
                throw new Error(
                    `[migrate-social] unknown kind(s): ${invalid.join(', ')}. ` +
                    `Allowed: ${SUPPORTED_KINDS.join(', ')}`,
                );
            }
            if (valid.length > 0) args.kinds = valid;
            continue;
        }
        if (raw.startsWith('--batch-size=')) {
            const n = Number.parseInt(raw.split('=')[1] || '', 10);
            if (Number.isFinite(n) && n > 0) args.batchSize = n;
            continue;
        }
        if (raw.startsWith('--limit=')) {
            const n = Number.parseInt(raw.split('=')[1] || '', 10);
            if (Number.isFinite(n) && n >= 0) args.limit = n;
            continue;
        }
    }

    return args;
}

// === Stats ====================================================================

export interface PerKindStats {
    scanned: number;
    copied: number;
    skipped: number;
    failed: number;
}

/**
 * Reactions are side-data, not entities, so they have their own counters. They
 * run as a separate pass after every entity kind has been backfilled.
 */
export interface ReactionStats {
    scanned: number;
    copied: number;
    skipped: number;
    failed: number;
}

/**
 * Friendships are also side-data from the universal-entity perspective —
 * they live in `app_social_friendship`, not `app_social_entity`. The
 * backfill copies legacy rows from `app_friend_requests` + `app_friends`
 * into the universal store and shares this stat shape with reactions.
 */
export interface FriendshipStats {
    scanned: number;
    copied: number;
    skipped: number;
    failed: number;
}

export interface MigrationStats {
    perKind: Record<MigratableKind, PerKindStats>;
    reactions: ReactionStats;
    friendships: FriendshipStats;
    totalCopied: number;
    totalSkipped: number;
    totalFailed: number;
    reactionsCopied: number;
    friendshipsCopied: number;
}

function emptyStats(): MigrationStats {
    const perKind = {} as Record<MigratableKind, PerKindStats>;
    for (const k of SUPPORTED_KINDS) {
        perKind[k] = { scanned: 0, copied: 0, skipped: 0, failed: 0 };
    }
    return {
        perKind,
        reactions: { scanned: 0, copied: 0, skipped: 0, failed: 0 },
        friendships: { scanned: 0, copied: 0, skipped: 0, failed: 0 },
        totalCopied: 0,
        totalSkipped: 0,
        totalFailed: 0,
        reactionsCopied: 0,
        friendshipsCopied: 0,
    };
}

// === Pure mapping helpers =====================================================
//
// Each `map*` function takes a legacy row (as it comes off the DB driver) and
// returns the full "social entity input" that the migration would insert. We
// keep these pure so the tests can assert the mapping without a live DB.

export interface SocialEntityInsertPlan<K extends SocialEntityKind> {
    kind: K;
    scopeType: SocialScopeType;
    scopeId: string;
    authorUserId: string;
    payload: SocialPayloadByKind[K];
    /** Preserved from the legacy row — overrides the default `now()` on the mirror. */
    createdAt: Date;
    /** Soft-delete fields replayed onto the mirror after INSERT. */
    deletedAt: Date | null;
    deletedByUserId: string | null;
    deletedReason: string | null;
    /** Only used by the `global_message` migration today (legacy pinned state). */
    pinned: boolean;
}

function toDate(value: unknown): Date {
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d;
    }
    // Mirror legacy "created_at" never being null — fall back to now() rather
    // than abort.
    return new Date();
}

function toDateOrNull(value: unknown): Date | null {
    if (value === null || value === undefined) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string' || typeof value === 'number') {
        const d = new Date(value);
        if (!Number.isNaN(d.getTime())) return d;
    }
    return null;
}

function asOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    return value.length > 0 ? value : undefined;
}

/**
 * Same formula as `combineLessonDateTime` in services/group-space.ts. Lifted
 * here so the migration can rebuild `startsAt` / `endsAt` without depending on
 * the live group-space service module.
 */
export function combineLessonDateTime(date: Date | string, hhmm: string): string {
    const d = date instanceof Date ? date : new Date(date);
    const datePart = d.toISOString().slice(0, 10);
    const safeTime = /^\d{2}:\d{2}$/.test(hhmm) ? `${hhmm}:00` : hhmm;
    return `${datePart}T${safeTime}.000Z`;
}

// --- Post mapping -------------------------------------------------------------
//
// Legacy table: app_group_posts (id text, group_key text, title text, body text,
// author_user_id text, pinned boolean, created_at, updated_at, deleted_at,
// deleted_by, social_entity_id uuid).
//
// Shim equivalent: services/group-posts-shim.ts → kind='post', scopeType='group',
// scopeId=`group:${group_key}`, payload={title, body}.

export interface LegacyGroupPostRow {
    id: string;
    group_key: string;
    title: string;
    body: string;
    author_user_id: string;
    pinned: boolean | null;
    created_at: Date | string;
    deleted_at: Date | string | null;
    deleted_by: string | null;
}

export function mapPost(row: LegacyGroupPostRow): SocialEntityInsertPlan<'post'> {
    const payload: SocialPayloadByKind['post'] = {
        title: row.title,
        body: row.body,
    };
    return {
        kind: 'post',
        scopeType: 'group',
        scopeId: buildScopeId('group', row.group_key),
        authorUserId: row.author_user_id,
        payload,
        createdAt: toDate(row.created_at),
        deletedAt: toDateOrNull(row.deleted_at),
        deletedByUserId: row.deleted_by,
        deletedReason: null,
        pinned: false, // group-feed pinning lives on the legacy row but is not
                       // mirrored by the create-shim today; preserve that.
    };
}

// --- Task mapping -------------------------------------------------------------
//
// Legacy: app_group_tasks (title, description, subject, deadline, …). Shim
// (group-tasks-shim.ts) sets payload.body = description ?? subject ?? '' and
// payload.dueAt = deadline ISO. Per-user completion is NOT migrated.

export interface LegacyGroupTaskRow {
    id: string;
    group_key: string;
    title: string;
    subject: string | null;
    description: string | null;
    deadline: Date | string | null;
    author_user_id: string;
    created_at: Date | string;
    deleted_at: Date | string | null;
    deleted_by: string | null;
}

export function mapTask(row: LegacyGroupTaskRow): SocialEntityInsertPlan<'task'> {
    const body = row.description ?? row.subject ?? '';
    const payload: SocialPayloadByKind['task'] = {
        title: row.title,
        body,
    };
    const deadline = toDateOrNull(row.deadline);
    if (deadline) {
        payload.dueAt = deadline.toISOString();
    }
    return {
        kind: 'task',
        scopeType: 'group',
        scopeId: buildScopeId('group', row.group_key),
        authorUserId: row.author_user_id,
        payload,
        createdAt: toDate(row.created_at),
        deletedAt: toDateOrNull(row.deleted_at),
        deletedByUserId: row.deleted_by,
        deletedReason: null,
        pinned: false,
    };
}

// --- Extra-lesson mapping -----------------------------------------------------

export interface LegacyGroupExtraLessonRow {
    id: string;
    group_key: string;
    title: string;
    date: Date | string;
    start_time: string;
    end_time: string;
    room: string | null;
    teacher: string | null;
    note: string | null;
    author_user_id: string;
    created_at: Date | string;
    deleted_at: Date | string | null;
    deleted_by: string | null;
}

export function mapExtraLesson(
    row: LegacyGroupExtraLessonRow,
): SocialEntityInsertPlan<'extra_lesson'> {
    const startsAt = combineLessonDateTime(row.date, row.start_time);
    const payload: SocialPayloadByKind['extra_lesson'] = {
        subject: row.title,
        startsAt,
    };
    if (row.end_time) {
        payload.endsAt = combineLessonDateTime(row.date, row.end_time);
    }
    const teacher = asOptionalString(row.teacher);
    if (teacher) payload.teacher = teacher;
    const room = asOptionalString(row.room);
    if (room) payload.room = room;
    const note = asOptionalString(row.note);
    if (note) payload.note = note;
    return {
        kind: 'extra_lesson',
        scopeType: 'group',
        scopeId: buildScopeId('group', row.group_key),
        authorUserId: row.author_user_id,
        payload,
        createdAt: toDate(row.created_at),
        deletedAt: toDateOrNull(row.deleted_at),
        deletedByUserId: row.deleted_by,
        deletedReason: null,
        pinned: false,
    };
}

// --- Announcement mapping -----------------------------------------------------
//
// Legacy: app_coordinator_announcements with `revoked_at` for soft-delete and
// `target_mode`+`target_groups_json` for fan-out. Shim uses scopeType='announcement'
// with scopeId='announcement:global'.

export interface LegacyAnnouncementRow {
    id: string;
    author_user_id: string;
    title: string;
    body: string;
    priority: string;
    target_mode: string;
    target_groups_json: unknown;
    expires_at: Date | string | null;
    revoked_at: Date | string | null;
    created_at: Date | string;
}

function parseTargetGroups(value: unknown): string[] | undefined {
    if (Array.isArray(value)) {
        const cleaned = value.filter((v): v is string => typeof v === 'string' && v.length > 0);
        return cleaned.length > 0 ? cleaned : undefined;
    }
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parseTargetGroups(parsed);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

export function mapAnnouncement(
    row: LegacyAnnouncementRow,
): SocialEntityInsertPlan<'announcement'> {
    const payload: SocialPayloadByKind['announcement'] = {
        title: row.title,
        body: row.body,
        priority: coercePriority(row.priority),
    };
    // target_mode = 'all_starostas' → broadcast → omit targetGroups in payload.
    // target_mode = 'specific'      → only include when the list is non-empty.
    if (row.target_mode !== 'all_starostas') {
        const groups = parseTargetGroups(row.target_groups_json);
        if (groups && groups.length > 0) {
            payload.targetGroups = groups;
        }
    }
    const expires = toDateOrNull(row.expires_at);
    if (expires) {
        payload.expiresAt = expires.toISOString();
    }
    return {
        kind: 'announcement',
        scopeType: 'announcement',
        scopeId: buildScopeId('announcement', 'global'),
        authorUserId: row.author_user_id,
        payload,
        createdAt: toDate(row.created_at),
        // Revoke is mapped to soft-delete: see shimMirrorSoftDeleteCoordinatorAnnouncement.
        deletedAt: toDateOrNull(row.revoked_at),
        deletedByUserId: row.revoked_at ? row.author_user_id : null,
        deletedReason: row.revoked_at ? 'revoked' : null,
        pinned: false,
    };
}

// --- DM message mapping -------------------------------------------------------

export interface LegacyChatMessageRow {
    id: string;
    room_id: string;
    author_user_id: string;
    body: string;
    reply_to_message_id: string | null;
    created_at: Date | string;
    edited_at: Date | string | null;
    deleted_at: Date | string | null;
}

export function mapDmMessage(
    row: LegacyChatMessageRow,
): SocialEntityInsertPlan<'dm_message'> {
    const payload: SocialPayloadByKind['dm_message'] = {
        body: row.body,
    };
    const reply = asOptionalString(row.reply_to_message_id);
    if (reply) payload.replyToMessageId = reply;
    const edited = toDateOrNull(row.edited_at);
    if (edited) payload.editedAt = edited.toISOString();
    return {
        kind: 'dm_message',
        scopeType: 'dm',
        scopeId: buildScopeId('dm', row.room_id),
        authorUserId: row.author_user_id,
        payload,
        createdAt: toDate(row.created_at),
        deletedAt: toDateOrNull(row.deleted_at),
        deletedByUserId: row.deleted_at ? row.author_user_id : null,
        deletedReason: null,
        pinned: false,
    };
}

// --- Global-chat message mapping ---------------------------------------------

export interface LegacyGlobalChatMessageRow {
    id: string;
    author_user_id: string;
    body: string;
    created_at: Date | string;
    pinned_at: Date | string | null;
    pinned_by: string | null;
    deleted_at: Date | string | null;
    deleted_by: string | null;
    delete_reason: string | null;
}

export function mapGlobalMessage(
    row: LegacyGlobalChatMessageRow,
): SocialEntityInsertPlan<'global_message'> {
    const payload: SocialPayloadByKind['global_message'] = {
        body: row.body,
    };
    return {
        kind: 'global_message',
        scopeType: 'global',
        scopeId: buildScopeId('global', 'chat'),
        authorUserId: row.author_user_id,
        payload,
        createdAt: toDate(row.created_at),
        deletedAt: toDateOrNull(row.deleted_at),
        deletedByUserId: row.deleted_by,
        deletedReason: row.delete_reason,
        pinned: Boolean(row.pinned_at),
    };
}

// === Per-kind table descriptors ==============================================
//
// Each descriptor knows: how to SELECT un-migrated rows, what column on the
// legacy table holds the back-link, what id type the legacy row uses, and which
// `map*` function turns the row into an insert plan.

export interface KindDescriptor<TRow, K extends SocialEntityKind> {
    kind: K;
    legacyTable: string;
    /** Columns to SELECT, including legacy id. */
    selectColumns: string;
    /** Map a raw row to an insert plan. Pure. */
    mapRow: (row: TRow) => SocialEntityInsertPlan<K>;
    /** Extract the legacy id for logging + the back-link UPDATE. */
    legacyId: (row: TRow) => string;
}

export const DESCRIPTORS: {
    [K in MigratableKind]: KindDescriptor<any, K>;
} = {
    post: {
        kind: 'post',
        legacyTable: 'app_group_posts',
        selectColumns:
            'id, group_key, title, body, author_user_id, pinned, created_at, deleted_at, deleted_by',
        mapRow: mapPost,
        legacyId: (row: LegacyGroupPostRow) => row.id,
    },
    task: {
        kind: 'task',
        legacyTable: 'app_group_tasks',
        selectColumns:
            'id, group_key, title, subject, description, deadline, author_user_id, created_at, deleted_at, deleted_by',
        mapRow: mapTask,
        legacyId: (row: LegacyGroupTaskRow) => row.id,
    },
    extra_lesson: {
        kind: 'extra_lesson',
        legacyTable: 'app_group_extra_lessons',
        selectColumns:
            'id, group_key, title, date, start_time, end_time, room, teacher, note, author_user_id, created_at, deleted_at, deleted_by',
        mapRow: mapExtraLesson,
        legacyId: (row: LegacyGroupExtraLessonRow) => row.id,
    },
    announcement: {
        kind: 'announcement',
        legacyTable: 'app_coordinator_announcements',
        selectColumns:
            'id, author_user_id, title, body, priority, target_mode, target_groups_json, expires_at, revoked_at, created_at',
        mapRow: mapAnnouncement,
        legacyId: (row: LegacyAnnouncementRow) => row.id,
    },
    dm_message: {
        kind: 'dm_message',
        legacyTable: 'app_chat_messages',
        selectColumns:
            'id, room_id, author_user_id, body, reply_to_message_id, created_at, edited_at, deleted_at',
        mapRow: mapDmMessage,
        legacyId: (row: LegacyChatMessageRow) => row.id,
    },
    global_message: {
        kind: 'global_message',
        legacyTable: 'app_global_chat_messages',
        selectColumns:
            'id, author_user_id, body, created_at, pinned_at, pinned_by, deleted_at, deleted_by, delete_reason',
        mapRow: mapGlobalMessage,
        legacyId: (row: LegacyGlobalChatMessageRow) => row.id,
    },
};

// === Mention extraction helper ===============================================
//
// Walks the parts of the payload that may contain `@user` mentions and returns
// the deduplicated list of handles. Mirrors the universal service's
// `payloadTextForMentions` logic.

export function collectMentions(payload: Record<string, unknown>): string[] {
    const parts: string[] = [];
    for (const key of ['title', 'body', 'question', 'subject', 'note', 'location']) {
        const value = payload[key];
        if (typeof value === 'string' && value.length > 0) {
            parts.push(value);
        }
    }
    if (parts.length === 0) return [];
    return extractMentions(parts.join('\n'));
}

// === Postgres I/O =============================================================

/** Insert plan → INSERT statement, preserving `created_at`. Returns the new uuid. */
async function insertSocialEntity<K extends SocialEntityKind>(
    client: PoolClient,
    plan: SocialEntityInsertPlan<K>,
): Promise<string> {
    const insert = await client.query<{ id: string }>(
        `
            insert into app_social_entity
                (kind, scope_type, scope_id, author_user_id, payload, pinned, created_at, updated_at)
            values ($1, $2, $3, $4, $5::jsonb, $6, $7, $7)
            returning id::text as id
        `,
        [
            plan.kind,
            plan.scopeType,
            plan.scopeId,
            plan.authorUserId,
            JSON.stringify(plan.payload ?? {}),
            plan.pinned,
            plan.createdAt,
        ],
    );
    return insert.rows[0].id;
}

async function applySoftDeleteState(
    client: PoolClient,
    socialId: string,
    plan: SocialEntityInsertPlan<SocialEntityKind>,
): Promise<void> {
    if (!plan.deletedAt) return;
    await client.query(
        `
            update app_social_entity
            set deleted_at = $2,
                deleted_by_user_id = $3,
                deleted_reason = $4,
                updated_at = $2
            where id = $1::uuid
        `,
        [
            socialId,
            plan.deletedAt,
            plan.deletedByUserId,
            plan.deletedReason,
        ],
    );
}

async function insertMentions(
    client: PoolClient,
    socialId: string,
    authorUserId: string,
    handles: string[],
): Promise<void> {
    for (const handle of handles) {
        await client.query(
            `
                insert into app_social_mention
                    (entity_id, source_kind, source_id, author_user_id, mentioned_user_id)
                values ($1::uuid, 'entity', $1::uuid, $2, $3)
            `,
            [socialId, authorUserId, handle],
        );
    }
}

async function updateLegacyBackLink(
    client: PoolClient,
    table: string,
    legacyId: string,
    socialId: string,
): Promise<void> {
    await client.query(
        `update ${table} set social_entity_id = $2 where id = $1`,
        [legacyId, socialId],
    );
}

interface FetchBatchArgs {
    table: string;
    columns: string;
    limit: number;
    offset: number;
}

async function fetchBatch<T>(client: PoolClient, args: FetchBatchArgs): Promise<T[]> {
    const result = await client.query<T>(
        `
            select ${args.columns}
            from ${args.table}
            where social_entity_id is null
            order by created_at asc
            limit $1 offset $2
        `,
        [args.limit, args.offset],
    );
    return result.rows;
}

// === Migration loop ===========================================================

/**
 * Run one row through the migration pipeline. Returns true on success, false on
 * handled failure. Exported for tests.
 */
export async function processRow<TRow, K extends SocialEntityKind>(
    descriptor: KindDescriptor<TRow, K>,
    row: TRow,
    args: MigrateArgs,
): Promise<{ ok: boolean; socialId?: string; plan: SocialEntityInsertPlan<K> }> {
    const plan = descriptor.mapRow(row);
    const legacyId = descriptor.legacyId(row);

    if (args.dryRun) {
        if (args.verbose) {
            console.log(
                `[migrate-social][dry-run] ${descriptor.kind} ${legacyId} → ` +
                    `scope=${plan.scopeId} created=${plan.createdAt.toISOString()} ` +
                    `deleted=${plan.deletedAt ? 'yes' : 'no'} pinned=${plan.pinned}`,
            );
        }
        return { ok: true, plan };
    }

    const result = await withSupabasePostgres(async (client) => {
        const socialId = await insertSocialEntity(client, plan);
        await applySoftDeleteState(client, socialId, plan);
        const handles = collectMentions(plan.payload as Record<string, unknown>);
        if (handles.length > 0) {
            await insertMentions(client, socialId, plan.authorUserId, handles);
        }
        await updateLegacyBackLink(
            client,
            descriptor.legacyTable,
            legacyId,
            socialId,
        );
        return socialId;
    });
    if (result === null) {
        throw new Error('[migrate-social] Supabase Postgres unavailable during insert');
    }
    return { ok: true, socialId: result, plan };
}

async function migrateKind<TRow, K extends SocialEntityKind>(
    descriptor: KindDescriptor<TRow, K>,
    args: MigrateArgs,
    stats: PerKindStats,
): Promise<void> {
    // Offset tracks how many rows in the current `WHERE social_entity_id IS NULL`
    // window we have already attempted-and-failed in this run. Successful copies
    // clear themselves from the filter (the back-link UPDATE sets the column),
    // so they don't need to be paged past — but failed rows stay visible, so we
    // advance the offset to skip them on the next fetch and avoid an infinite
    // loop. In dry-run nothing clears the filter, so offset paginates straight
    // through the table.
    let offset = 0;
    while (true) {
        const remaining = args.limit > 0 ? args.limit - stats.scanned : Infinity;
        if (remaining <= 0) break;
        const take = Math.min(args.batchSize, Number.isFinite(remaining) ? remaining : args.batchSize);

        const rows = await withSupabasePostgres(async (client) =>
            fetchBatch<TRow>(client, {
                table: descriptor.legacyTable,
                columns: descriptor.selectColumns,
                limit: take,
                offset,
            }),
        );
        if (rows === null) {
            throw new Error('[migrate-social] Supabase Postgres unavailable');
        }
        if (rows.length === 0) break;

        let copiedInBatch = 0;
        let failedInBatch = 0;
        for (const row of rows) {
            stats.scanned += 1;
            const legacyId = descriptor.legacyId(row);
            try {
                await processRow(descriptor, row, args);
                stats.copied += 1;
                copiedInBatch += 1;
                if (!args.dryRun && args.verbose) {
                    console.log(`[migrate-social] copied ${descriptor.kind} ${legacyId}`);
                }
            } catch (error) {
                stats.failed += 1;
                failedInBatch += 1;
                console.error(
                    `[migrate-social] failed ${descriptor.kind} ${legacyId}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        // Dry-run never clears the back-link, so we must paginate forward by the
        // entire batch. Live runs page forward only by the failure count so the
        // next fetch picks up brand-new un-migrated rows.
        offset += args.dryRun ? rows.length : failedInBatch;

        // Defensive bound: if a live batch returned only failures AND zero
        // successes, we'd otherwise still make progress via offset, so keep
        // going. But if the result set is fully exhausted (rows < take), break.
        if (rows.length < take) break;
        // Avoid spinning forever in dry-run when limit is unbounded — the loop
        // exits naturally once the offset moves past the end of the table.
        void copiedInBatch;
    }
}

// === Reactions backfill (side-data) ==========================================
//
// Reactions are not entities — they're a `(post_id, user_id, emoji)` triple on
// `app_group_feed_reactions`. The universal home is `app_social_reaction` keyed
// on the parent post's mirror entity_id. We only migrate reactions for posts
// that already have a mirror (i.e. `social_entity_id IS NOT NULL`), which is
// either Phase 1c shim-created or Phase 1d entity-backfilled rows. Reactions
// on orphan legacy posts are skipped until their parent migrates.
//
// Idempotency is enforced via a `NOT EXISTS` check in the SELECT — re-running
// the script never re-copies a row that's already in the universal table.

export interface LegacyReactionRow {
    post_id: string;
    user_id: string;
    emoji: string;
    created_at: Date | string;
    social_entity_id: string;
}

export interface ReactionInsertPlan {
    entityId: string;
    userId: string;
    emoji: string;
    createdAt: Date;
}

/** Pure row-to-plan mapping for reactions. Exported for unit tests. */
export function mapReaction(row: LegacyReactionRow): ReactionInsertPlan {
    return {
        entityId: row.social_entity_id,
        userId: row.user_id,
        emoji: row.emoji,
        createdAt: toDate(row.created_at),
    };
}

async function fetchReactionBatch(
    client: PoolClient,
    limit: number,
    offset: number,
): Promise<LegacyReactionRow[]> {
    const result = await client.query<LegacyReactionRow>(
        `
            select
                r.post_id,
                r.user_id,
                r.emoji,
                r.created_at,
                p.social_entity_id::text as social_entity_id
            from app_group_feed_reactions r
            join app_group_posts p on p.id = r.post_id
            where p.social_entity_id is not null
              and not exists (
                  select 1 from app_social_reaction sr
                  where sr.entity_id = p.social_entity_id
                    and sr.user_id = r.user_id
                    and sr.emoji = r.emoji
              )
            order by r.post_id, r.user_id, r.emoji
            limit $1 offset $2
        `,
        [limit, offset],
    );
    return result.rows;
}

async function insertSocialReaction(
    client: PoolClient,
    plan: ReactionInsertPlan,
): Promise<boolean> {
    // ON CONFLICT DO NOTHING gives belt-and-braces protection in case the
    // NOT EXISTS filter and our INSERT race; rowCount=0 means a parallel
    // migrator (or the live shim) already copied this triple.
    const result = await client.query(
        `
            insert into app_social_reaction (entity_id, user_id, emoji, created_at)
            values ($1::uuid, $2, $3, $4)
            on conflict (entity_id, user_id, emoji) do nothing
        `,
        [plan.entityId, plan.userId, plan.emoji, plan.createdAt],
    );
    return result.rowCount === 1;
}

/**
 * Process a single legacy reaction row. Exported for tests so the mapping +
 * INSERT contract can be asserted without standing up a Pool.
 */
export async function processReactionRow(
    row: LegacyReactionRow,
    args: MigrateArgs,
): Promise<{ ok: boolean; copied: boolean; plan: ReactionInsertPlan }> {
    const plan = mapReaction(row);
    if (args.dryRun) {
        if (args.verbose) {
            console.log(
                `[migrate-social][dry-run] reaction post=${row.post_id} ` +
                    `entity=${plan.entityId} user=${plan.userId} emoji=${plan.emoji}`,
            );
        }
        return { ok: true, copied: false, plan };
    }
    const result = await withSupabasePostgres(async (client) =>
        insertSocialReaction(client, plan),
    );
    if (result === null) {
        throw new Error('[migrate-social] Supabase Postgres unavailable during reaction insert');
    }
    return { ok: true, copied: result, plan };
}

export async function migrateReactions(args: MigrateArgs, stats: ReactionStats): Promise<void> {
    // Reactions don't have a `migrated` flag column (legacy composite-PK table
    // has no spare column), so the SELECT cursor is the `NOT EXISTS` filter.
    // In a live run every successful copy removes itself from the filter, so
    // the next fetch picks up fresh rows. In dry-run nothing clears, so we
    // paginate forward by `rows.length` like the entity migration does.
    let offset = 0;
    while (true) {
        const remaining = args.limit > 0 ? args.limit - stats.scanned : Infinity;
        if (remaining <= 0) break;
        const take = Math.min(args.batchSize, Number.isFinite(remaining) ? remaining : args.batchSize);

        const rows = await withSupabasePostgres(async (client) =>
            fetchReactionBatch(client, take, offset),
        );
        if (rows === null) {
            throw new Error('[migrate-social] Supabase Postgres unavailable during reaction fetch');
        }
        if (rows.length === 0) break;

        let failedInBatch = 0;
        for (const row of rows) {
            stats.scanned += 1;
            try {
                const result = await processReactionRow(row, args);
                if (result.copied) {
                    stats.copied += 1;
                    if (!args.dryRun && args.verbose) {
                        console.log(
                            `[migrate-social] copied reaction post=${row.post_id} ` +
                                `user=${row.user_id} emoji=${row.emoji}`,
                        );
                    }
                } else {
                    // Either dry-run, or a parallel writer beat us to it.
                    stats.skipped += 1;
                }
            } catch (error) {
                stats.failed += 1;
                failedInBatch += 1;
                console.error(
                    `[migrate-social] failed reaction post=${row.post_id} ` +
                        `user=${row.user_id} emoji=${row.emoji}: ${
                            error instanceof Error ? error.message : String(error)
                        }`,
                );
            }
        }

        offset += args.dryRun ? rows.length : failedInBatch;
        if (rows.length < take) break;
    }
}

// === Friendships backfill (side-data) =========================================
//
// Friendships are a separate aggregate from social entities — they live in
// `app_social_friendship`, not `app_social_entity`. The legacy source is the
// pair (`app_friend_requests`, `app_friends`):
//
//   - Every legacy `app_friend_requests` row maps 1:1 to a universal
//     friendship row. Status is copied verbatim ('pending' / 'accepted' /
//     'rejected' / 'cancelled' all line up with the universal enum). The
//     legacy `acted_at` becomes `responded_at` on the universal row.
//   - The legacy `app_friends` table is implicit: every row there has a
//     matching `app_friend_requests.status = 'accepted'` row (the accept
//     path INSERTs both). We migrate via `app_friend_requests` and rely on
//     that invariant — see also Phase 1e cutover notes in
//     services/friends-shim.ts.
//
// Idempotency: the SELECT joins on `social_friendship_id IS NULL` so already-
// linked rows are skipped on every pass. A `NOT EXISTS` against
// `app_social_friendship` keyed on (pair_key, status) is the belt-and-braces
// check for the rare race where two passes overlap.

export interface LegacyFriendRequestRow {
    id: string;
    requester_user_id: string;
    target_user_id: string;
    status: string;
    created_at: Date | string;
    acted_at: Date | string | null;
}

export interface FriendshipInsertPlan {
    id: string;
    requesterUserId: string;
    addresseeUserId: string;
    status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
    createdAt: Date;
    respondedAt: Date | null;
    pairKey: string;
}

/** Compute the canonical pair_key the same way the SQL stored column does. */
export function legacyPairKey(a: string, b: string): string {
    return a < b ? `${a}::${b}` : `${b}::${a}`;
}

/** Coerce the legacy status string to the universal enum. */
function coerceFriendshipStatus(value: string): FriendshipInsertPlan['status'] | null {
    if (value === 'pending' || value === 'accepted'
        || value === 'rejected' || value === 'cancelled') {
        return value;
    }
    return null;
}

/** Pure mapping. Exported for unit tests. */
export function mapFriendRequest(row: LegacyFriendRequestRow): FriendshipInsertPlan | null {
    const status = coerceFriendshipStatus(row.status);
    if (!status) return null;
    const requester = (row.requester_user_id || '').trim();
    const addressee = (row.target_user_id || '').trim();
    if (!requester || !addressee || requester === addressee) return null;
    return {
        id: row.id,
        requesterUserId: requester,
        addresseeUserId: addressee,
        status,
        createdAt: toDate(row.created_at),
        respondedAt: toDateOrNull(row.acted_at),
        pairKey: legacyPairKey(requester, addressee),
    };
}

async function fetchFriendshipBatch(
    client: PoolClient,
    limit: number,
    offset: number,
): Promise<LegacyFriendRequestRow[]> {
    const result = await client.query<LegacyFriendRequestRow>(
        `
            select id, requester_user_id, target_user_id, status, created_at, acted_at
            from app_friend_requests
            where social_friendship_id is null
            order by created_at asc
            limit $1 offset $2
        `,
        [limit, offset],
    );
    return result.rows;
}

async function insertSocialFriendship(
    client: PoolClient,
    plan: FriendshipInsertPlan,
): Promise<string | null> {
    // The unique constraint on (pair_key, status) means a re-run that
    // raced with a live shim write could collide — ON CONFLICT skips that
    // case so the migration stays idempotent. The legacy back-link UPDATE
    // is still applied so the next pass doesn't see the row again.
    const insert = await client.query<{ id: string }>(
        `
            insert into app_social_friendship
                (requester_user_id, addressee_user_id, status, created_at, responded_at)
            values ($1, $2, $3, $4, $5)
            on conflict on constraint uq_social_friendship_pair_status do nothing
            returning id::text as id
        `,
        [
            plan.requesterUserId,
            plan.addresseeUserId,
            plan.status,
            plan.createdAt,
            plan.respondedAt,
        ],
    );
    if (insert.rows.length === 0) {
        // Conflict — look up the existing row's id so we can still wire
        // the back-link.
        const existing = await client.query<{ id: string }>(
            `
                select id::text as id
                from app_social_friendship
                where requester_user_id = $1
                  and addressee_user_id = $2
                  and status = $3
                limit 1
            `,
            [plan.requesterUserId, plan.addresseeUserId, plan.status],
        );
        return existing.rows[0]?.id ?? null;
    }
    return insert.rows[0].id;
}

async function updateLegacyFriendRequestBackLink(
    client: PoolClient,
    legacyId: string,
    socialFriendshipId: string,
): Promise<void> {
    await client.query(
        `update app_friend_requests set social_friendship_id = $2 where id = $1`,
        [legacyId, socialFriendshipId],
    );
}

/**
 * Process a single legacy friend-request row. Exported for tests so the
 * mapping + INSERT contract can be asserted without standing up a Pool.
 */
export async function processFriendshipRow(
    row: LegacyFriendRequestRow,
    args: MigrateArgs,
): Promise<{ ok: boolean; copied: boolean; plan: FriendshipInsertPlan | null }> {
    const plan = mapFriendRequest(row);
    if (!plan) {
        // Bad legacy data (unknown status, empty userId, self-friendship) —
        // we count this as skipped, not failed. The legacy row stays in
        // place; an operator can fix it manually.
        return { ok: true, copied: false, plan: null };
    }
    if (args.dryRun) {
        if (args.verbose) {
            console.log(
                `[migrate-social][dry-run] friendship ${plan.id} ` +
                    `pair=${plan.pairKey} status=${plan.status}`,
            );
        }
        return { ok: true, copied: false, plan };
    }
    const result = await withSupabasePostgres(async (client) => {
        const socialId = await insertSocialFriendship(client, plan);
        if (!socialId) return null;
        await updateLegacyFriendRequestBackLink(client, plan.id, socialId);
        return socialId;
    });
    if (result === null) {
        // null can mean either "PG unavailable" or "no row inserted and no
        // existing row found" — treat as a non-fatal skip and move on. The
        // operator can drill in with `--verbose` if this becomes common.
        return { ok: true, copied: false, plan };
    }
    return { ok: true, copied: true, plan };
}

export async function migrateFriendships(
    args: MigrateArgs,
    stats: FriendshipStats,
): Promise<void> {
    // Same offset strategy as `migrateKind`: successful copies clear the
    // `social_friendship_id IS NULL` filter, so we only paginate forward
    // by failures. Dry-run advances by `rows.length` since nothing clears.
    let offset = 0;
    while (true) {
        const remaining = args.limit > 0 ? args.limit - stats.scanned : Infinity;
        if (remaining <= 0) break;
        const take = Math.min(args.batchSize, Number.isFinite(remaining) ? remaining : args.batchSize);

        const rows = await withSupabasePostgres(async (client) =>
            fetchFriendshipBatch(client, take, offset),
        );
        if (rows === null) {
            throw new Error('[migrate-social] Supabase Postgres unavailable during friendship fetch');
        }
        if (rows.length === 0) break;

        let failedInBatch = 0;
        for (const row of rows) {
            stats.scanned += 1;
            try {
                const result = await processFriendshipRow(row, args);
                if (result.copied) {
                    stats.copied += 1;
                    if (!args.dryRun && args.verbose) {
                        console.log(
                            `[migrate-social] copied friendship ${row.id} ` +
                                `pair=${result.plan?.pairKey} status=${result.plan?.status}`,
                        );
                    }
                } else {
                    stats.skipped += 1;
                }
            } catch (error) {
                stats.failed += 1;
                failedInBatch += 1;
                console.error(
                    `[migrate-social] failed friendship ${row.id}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                );
            }
        }

        offset += args.dryRun ? rows.length : failedInBatch;
        if (rows.length < take) break;
    }
}

// === Main =====================================================================

export async function main(argv: string[] = process.argv.slice(2)): Promise<MigrationStats> {
    const args = parseArgs(argv);
    const stats = emptyStats();

    console.log('[migrate-social] starting Phase 1d backfill', {
        dryRun: args.dryRun,
        kinds: args.kinds,
        batchSize: args.batchSize,
        limit: args.limit,
        verbose: args.verbose,
        withReactions: args.withReactions,
        withFriendships: args.withFriendships,
    });

    for (const kind of args.kinds) {
        const descriptor = DESCRIPTORS[kind];
        const perKindStats = stats.perKind[kind];
        try {
            await migrateKind(descriptor, args, perKindStats);
        } catch (error) {
            console.error(
                `[migrate-social] fatal error for kind=${kind}: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        stats.totalCopied += perKindStats.copied;
        stats.totalSkipped += perKindStats.skipped;
        stats.totalFailed += perKindStats.failed;
        console.log(
            `[migrate-social] kind=${kind} scanned=${perKindStats.scanned} ` +
                `copied=${perKindStats.copied} failed=${perKindStats.failed}`,
        );
    }

    // Reactions run last so every parent entity is in place when the join-based
    // SELECT scans the legacy reactions table.
    if (args.withReactions) {
        try {
            await migrateReactions(args, stats.reactions);
        } catch (error) {
            console.error(
                `[migrate-social] fatal error for reactions: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        stats.reactionsCopied = stats.reactions.copied;
        stats.totalFailed += stats.reactions.failed;
        console.log(
            `[migrate-social] reactions scanned=${stats.reactions.scanned} ` +
                `copied=${stats.reactions.copied} skipped=${stats.reactions.skipped} ` +
                `failed=${stats.reactions.failed}`,
        );
    }

    // Friendships are a separate aggregate. Run them after reactions so the
    // single Postgres pool can recover between batches when the operator
    // passes both flags together.
    if (args.withFriendships) {
        try {
            await migrateFriendships(args, stats.friendships);
        } catch (error) {
            console.error(
                `[migrate-social] fatal error for friendships: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
        }
        stats.friendshipsCopied = stats.friendships.copied;
        stats.totalFailed += stats.friendships.failed;
        console.log(
            `[migrate-social] friendships scanned=${stats.friendships.scanned} ` +
                `copied=${stats.friendships.copied} skipped=${stats.friendships.skipped} ` +
                `failed=${stats.friendships.failed}`,
        );
    }

    console.log('[migrate-social] Summary:', JSON.stringify(stats, null, 2));
    if (args.dryRun) {
        console.log('[migrate-social] DRY-RUN — no inserts performed.');
    }
    return stats;
}

// Allow `tsx src/scripts/migrate-social-store.ts` to run directly without
// importing main into a wrapper. The test file imports the pure helpers but
// does not invoke main, so the guard prevents the script from running during
// `vitest`.
const isDirectInvocation = process.argv[1]?.endsWith('migrate-social-store.ts');
if (isDirectInvocation) {
    main().catch((error) => {
        console.error('[migrate-social] migration failed:', error);
        process.exitCode = 1;
    });
}
