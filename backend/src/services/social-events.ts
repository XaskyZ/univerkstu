/**
 * Social lifecycle event sink — Phase 1b push notifications.
 *
 * Subscribes to `socialEvents` emitted from `services/social.ts` and fans the
 * relevant rows out to web-push notifications via `services/push.ts`. This
 * follows the same delivery semantics as `jobs/exam-reminders.ts`:
 *
 *   - subscriptions fetched per-user via `getUserSubscriptions`
 *   - expired (404 / 410) subscriptions are cleaned up via `deleteSubscription`
 *   - `app_push_sends` provides idempotency on `(user_id, exam_id, kind)` —
 *     `exam_id` is repurposed here as a per-kind fingerprint
 *   - one failing user never blocks the rest; every per-user step is wrapped
 *     in try/catch and reported as a warning
 *
 * Push kinds handled here:
 *   - `social_mention`     — @user inside an entity body or a comment body
 *   - `social_dm`          — direct message to a peer (1 recipient)
 *   - `social_comment`     — top-level comment on someone's entity (≤ 2 recipients)
 *   - `social_group_post`  — new post/task/extra_lesson in a group (group members)
 *   - `social_announcement` — coordinator announcement (targeted or critical-broadcast)
 *
 * Spam-control notes:
 *   - DM and comment paths have hard recipient caps by construction (1 / 2).
 *   - Group post path is bounded by group size; no opt-out plumbing yet — that
 *     requires a future `app_notification_prefs` table. Users can still
 *     unsubscribe at the browser layer.
 *   - Announcement broadcast (no `targetGroups`) is gated on
 *     `priority === 'critical'` to avoid mass push for routine bulletins.
 *
 * IMPORTANT: this module is loaded for its side effects in `src/index.ts`.
 * Imports must be cheap and the listener registration must be top-level.
 */

import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import {
    deleteSubscription,
    getUserSubscriptions,
    hasBeenSent,
    isPushConfigured,
    recordSend,
    sendPushNotification,
    type PushKind,
    type PushPayload,
} from './push.js';
import { isPushKindEnabledForUser } from './notification-prefs.js';
import { socialEvents } from './social.js';
import type {
    SocialComment,
    SocialEntity,
    SocialEntityKind,
    SocialPayloadByKind,
} from '../types/social.js';

const MENTION_KIND: PushKind = 'social_mention';
const DM_KIND: PushKind = 'social_dm';
const COMMENT_KIND: PushKind = 'social_comment';
const GROUP_POST_KIND: PushKind = 'social_group_post';
const ANNOUNCEMENT_KIND: PushKind = 'social_announcement';

/**
 * Localized labels for the various entity kinds used in the push body. The
 * backend currently hardcodes Russian — frontend handles per-user language
 * rendering of the underlying entity. Adding kz/en here would need parity
 * with `services/push-i18n.ts`.
 */
const ENTITY_KIND_LABEL_RU: Record<SocialEntityKind, string> = {
    post: 'посте',
    task: 'задаче',
    extra_lesson: 'занятии',
    poll: 'опросе',
    event: 'событии',
    announcement: 'объявлении',
    dm_message: 'сообщении',
    global_message: 'сообщении',
};

/**
 * Active-voice label for group-post bodies ("опубликовал пост"). Distinct
 * from `ENTITY_KIND_LABEL_RU` which is locative ("в посте").
 */
const GROUP_POST_VERB_LABEL_RU: Partial<Record<SocialEntityKind, string>> = {
    post: 'пост',
    task: 'задачу',
    extra_lesson: 'занятие',
};

/**
 * Short, low-cardinality identifier for log correlation without leaking the
 * raw userId. Mirrors the pattern from `jobs/exam-reminders.ts`.
 */
function hashUserId(userId: string): string {
    return createHash('sha1').update(userId).digest('hex').slice(0, 8);
}

/** Snippet cap for embedding user-authored text in a push body. */
const BODY_SNIPPET_MAX = 80;
function snippet(value: unknown, max = BODY_SNIPPET_MAX): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (trimmed.length <= max) return trimmed;
    return `${trimmed.slice(0, max - 1)}…`;
}

// === Mention path (existing) =================================================

interface MentionTarget {
    mentionedUserId: string;
    authorUserId: string;
    sourceKind: 'entity' | 'comment';
    sourceId: string;
    entityId: string;
}

/**
 * Read pending @mentions for a given source row (entity or comment). We do
 * NOT filter on `mentioned_user_id != author_user_id` in SQL — the mention
 * extractor is conservative and may already have skipped the author, but a
 * caller that hand-inserts a row could still target the author. Filter in
 * memory so the SQL is reusable.
 */
async function selectMentions(
    client: PoolClient,
    sourceKind: 'entity' | 'comment',
    sourceId: string,
): Promise<MentionTarget[]> {
    const result = await client.query<{
        entity_id: string;
        source_kind: 'entity' | 'comment';
        source_id: string;
        author_user_id: string;
        mentioned_user_id: string;
    }>(
        `
            select entity_id::text as entity_id,
                   source_kind,
                   source_id::text as source_id,
                   author_user_id,
                   mentioned_user_id
            from app_social_mention
            where source_kind = $1 and source_id = $2
        `,
        [sourceKind, sourceId],
    );
    const out: MentionTarget[] = [];
    for (const row of result.rows) {
        out.push({
            mentionedUserId: row.mentioned_user_id,
            authorUserId: row.author_user_id,
            sourceKind: row.source_kind,
            sourceId: row.source_id,
            entityId: row.entity_id,
        });
    }
    return out;
}

/**
 * Build the push fingerprint that lands in `app_push_sends.exam_id`. Combines
 * the source ref and recipient so two users mentioned in the same comment do
 * not collide, and the same user mentioned again in an edit still fires.
 */
export function buildMentionFingerprint(target: Pick<MentionTarget, 'sourceKind' | 'sourceId' | 'mentionedUserId'>): string {
    return `${target.sourceKind}:${target.sourceId}:${target.mentionedUserId}`;
}

/**
 * Build the push payload for a mention notification. Pure function — exposed
 * for unit tests. Uses Russian copy because the backend has no user-language
 * lookup at this layer (frontend renders the entity in the user's language
 * once they tap through).
 */
export function buildMentionPayload(args: {
    authorUserId: string;
    entity: SocialEntity;
    sourceKind: 'entity' | 'comment';
    sourceId: string;
}): PushPayload {
    const label = ENTITY_KIND_LABEL_RU[args.entity.kind] ?? 'записи';
    return {
        title: 'Вас упомянули',
        body: `@${args.authorUserId} упомянул вас в ${label}`,
        data: {
            entityId: args.entity.id,
            scopeType: args.entity.scopeType,
            scopeId: args.entity.scopeId,
            sourceKind: args.sourceKind,
            sourceId: args.sourceId,
            kind: args.entity.kind,
        },
        url: '/',
        tag: `social-mention-${args.sourceKind}-${args.sourceId}`,
    };
}

// === Shared delivery primitive ===============================================

/**
 * Deliver one push notification to one user with the same expired-subscription
 * cleanup behavior as `jobs/exam-reminders.ts`. The fingerprint slot is the
 * caller's responsibility — every push kind owns its own fingerprint format.
 *
 * Returns the recorded status — useful for tests and structured logging.
 */
export async function deliverPushToUser(args: {
    userId: string;
    fingerprint: string;
    kind: PushKind;
    payload: PushPayload;
}): Promise<'sent' | 'no_subscriptions' | 'failed' | 'duplicate' | 'opted_out'> {
    const { userId, fingerprint, kind, payload } = args;

    // Per-kind opt-out gate. Default-on for every user via
    // `services/notification-prefs.ts`. We check this BEFORE the idempotency
    // lookup so a user who toggles a kind off does not consume the (user, fp,
    // kind) idempotency slot — if they toggle it back on later, redeliveries
    // can fire normally.
    try {
        const allowed = await isPushKindEnabledForUser(userId, kind);
        if (!allowed) {
            if (process.env.PUSH_PREFS_VERBOSE === '1') {
                console.log(`[push] skipped: kind ${kind} for user ${hashUserId(userId)} (opted out)`);
            }
            return 'opted_out';
        }
    } catch (error) {
        // Fail-open: a transient prefs lookup failure should not silently mute
        // users. The downstream send still respects idempotency, so the worst
        // case here is one bonus delivery for an opted-out user during a PG
        // blip — strictly better than dropping push silently.
        console.warn(
            `[SocialEvents] isPushKindEnabledForUser failed for user=${hashUserId(userId)} kind=${kind}:`,
            error instanceof Error ? error.message : 'unknown',
        );
    }

    // Idempotency check first so a redelivery is a cheap no-op.
    try {
        if (await hasBeenSent(userId, fingerprint, kind)) {
            return 'duplicate';
        }
    } catch (error) {
        console.warn(
            `[SocialEvents] hasBeenSent check failed for user=${hashUserId(userId)} kind=${kind}:`,
            error instanceof Error ? error.message : 'unknown',
        );
        // Fall through — better to risk a duplicate than to drop the push.
    }

    let subs;
    try {
        subs = await getUserSubscriptions(userId);
    } catch (error) {
        console.warn(
            `[SocialEvents] getUserSubscriptions failed for user=${hashUserId(userId)} kind=${kind}:`,
            error instanceof Error ? error.message : 'unknown',
        );
        return 'failed';
    }

    if (subs.length === 0) {
        try {
            await recordSend(userId, fingerprint, kind, 'no_subscriptions');
        } catch (error) {
            console.warn(
                `[SocialEvents] recordSend(no_subscriptions) failed:`,
                error instanceof Error ? error.message : 'unknown',
            );
        }
        return 'no_subscriptions';
    }

    let anyDelivered = false;
    let anyFailed = false;
    for (const sub of subs) {
        const result = await sendPushNotification(sub, payload);
        if (result.ok) {
            anyDelivered = true;
        } else if (result.expired) {
            try {
                await deleteSubscription(userId, sub.endpoint);
            } catch (cleanupError) {
                console.warn(
                    `[SocialEvents] Failed to delete expired subscription user=${hashUserId(userId)}:`,
                    cleanupError instanceof Error ? cleanupError.message : 'unknown',
                );
            }
        } else {
            anyFailed = true;
        }
    }

    const status = anyDelivered ? 'sent' : anyFailed ? 'failed' : 'failed';
    try {
        await recordSend(userId, fingerprint, kind, status);
    } catch (error) {
        console.warn(
            `[SocialEvents] recordSend(${status}) failed:`,
            error instanceof Error ? error.message : 'unknown',
        );
    }
    return status;
}

/**
 * Mention-flavored convenience wrapper around `deliverPushToUser`. Kept as a
 * named export because the existing `social-events.test.ts` already exercises
 * it and downstream code paths import it by name.
 */
export async function deliverMentionToUser(
    target: MentionTarget,
    payload: PushPayload,
): Promise<'sent' | 'no_subscriptions' | 'failed' | 'duplicate' | 'opted_out'> {
    return deliverPushToUser({
        userId: target.mentionedUserId,
        fingerprint: buildMentionFingerprint(target),
        kind: MENTION_KIND,
        payload,
    });
}

// === Recipient resolution helpers ============================================

/**
 * Extract DM participants from a `dm:<roomId>` scope id. The legacy room id
 * encoding is `direct:<lowUserId>::<highUserId>` (see
 * `services/messaging.ts#buildDirectRoomId`), so the scope id we receive is
 * typically `dm:direct:alice::bob`.
 *
 * If the room id is not in the recognized direct form, we currently return
 * `null` — there is no group-DM membership table in scope here, and we would
 * rather skip notifications than guess. Future multi-party DM rooms would
 * require a real `app_chat_rooms` schema (none exists in Postgres today).
 */
export function resolveDmParticipants(scopeId: string): string[] | null {
    if (typeof scopeId !== 'string') return null;
    let raw = scopeId;
    if (raw.startsWith('dm:')) raw = raw.slice('dm:'.length);
    // Direct room id encoding from services/messaging.ts#buildDirectRoomId:
    // `direct:<lowUserId>::<highUserId>`. Mirrored inline here to avoid the
    // import cycle (`messaging.ts` pulls in storage/group services that we
    // do NOT want in the social-events sink's import graph).
    if (!raw.startsWith('direct:')) return null;
    const payload = raw.slice('direct:'.length);
    const sep = payload.indexOf('::');
    if (sep <= 0 || sep === payload.length - 2) return null;
    const low = payload.slice(0, sep);
    const high = payload.slice(sep + 2);
    if (!low || !high) return null;
    return [low, high];
}

/**
 * Persist one notification-center row for a direct-message recipient.
 *
 * The Notification Center currently reads from `app_social_mention`; for DMs
 * this row is synthetic rather than a literal @mention. We keep it on the same
 * path so unread counts, pagination, and mark-read behavior stay consistent.
 */
export async function ensureDmNotificationRow(
    entity: SocialEntity<'dm_message'>,
    recipientUserId: string,
): Promise<void> {
    const target = (recipientUserId || '').trim();
    if (!target || target === entity.authorUserId) return;

    try {
        await withSupabasePostgres(async (client) => {
            await client.query(
                `
                    insert into app_social_mention
                        (entity_id, source_kind, source_id, author_user_id, mentioned_user_id)
                    select $1::uuid, 'entity', $1::uuid, $2, $3
                    where not exists (
                        select 1
                        from app_social_mention
                        where entity_id = $1::uuid
                          and source_kind = 'entity'
                          and source_id = $1::uuid
                          and mentioned_user_id = $3
                    )
                `,
                [entity.id, entity.authorUserId, target],
            );
        });
    } catch (error) {
        console.warn(
            `[SocialEvents] ensureDmNotificationRow failed user=${hashUserId(target)}:`,
            error instanceof Error ? error.message : 'unknown',
        );
    }
}

/**
 * Resolve the membership of a group by its raw key (without the `group:`
 * prefix). Uses `app_group_memberships` — the active membership table — and
 * filters out soft-removed / inactive rows. Returns `null` on PG-unavailable
 * so the caller can skip cleanly.
 */
export async function resolveGroupMembers(groupKey: string): Promise<string[] | null> {
    const trimmed = (groupKey || '').trim();
    if (!trimmed) return [];
    try {
        const result = await withSupabasePostgres<{ value: string[] }>(async (client) => {
            const rows = await client.query<{ user_id: string }>(
                `
                    select distinct user_id
                    from app_group_memberships
                    where group_key = $1 and active = true
                `,
                [trimmed],
            );
            return { value: rows.rows.map((r) => r.user_id) };
        });
        return result === null ? null : result.value;
    } catch (error) {
        console.warn(
            `[SocialEvents] resolveGroupMembers failed for group=${trimmed}:`,
            error instanceof Error ? error.message : 'unknown',
        );
        return null;
    }
}

/**
 * Resolve announcement recipients. If `payload.targetGroups` is non-empty,
 * union the members of those groups. Otherwise — and ONLY if priority is
 * 'critical' — broadcast to every user who currently has at least one push
 * subscription (we intentionally do not pull every known user account to
 * avoid notifying people who never enabled push).
 *
 * Returns `null` on PG-unavailable; returns `[]` when broadcast is requested
 * for non-critical priority (a deliberate no-op).
 */
export async function resolveAnnouncementRecipients(
    payload: SocialPayloadByKind['announcement'],
): Promise<string[] | null> {
    const targetGroups = Array.isArray(payload?.targetGroups) ? payload.targetGroups : [];
    if (targetGroups.length > 0) {
        const seen = new Set<string>();
        for (const groupKey of targetGroups) {
            const members = await resolveGroupMembers(groupKey);
            if (members === null) return null;
            for (const userId of members) {
                seen.add(userId);
            }
        }
        return Array.from(seen);
    }

    // Broadcast path — gated on critical priority only.
    if (payload?.priority !== 'critical') {
        return [];
    }

    try {
        const result = await withSupabasePostgres<{ value: string[] }>(async (client) => {
            const rows = await client.query<{ user_id: string }>(
                `select distinct user_id from app_push_subscriptions`,
            );
            return { value: rows.rows.map((r) => r.user_id) };
        });
        return result === null ? null : result.value;
    } catch (error) {
        console.warn(
            '[SocialEvents] resolveAnnouncementRecipients (broadcast) failed:',
            error instanceof Error ? error.message : 'unknown',
        );
        return null;
    }
}

/**
 * Resolve the recipient(s) for a comment-fan-out notification:
 *   1. Author of the parent entity (if not the commenter themselves).
 *   2. If the comment replies to another comment, the author of that
 *      parent comment (if not the commenter themselves).
 * Deduplicated as a Set.
 */
export async function resolveCommentRecipients(
    comment: SocialComment,
    parentEntity: SocialEntity,
): Promise<string[] | null> {
    const out = new Set<string>();
    if (parentEntity.authorUserId && parentEntity.authorUserId !== comment.authorUserId) {
        out.add(parentEntity.authorUserId);
    }
    const trimmedParentComment = (comment.parentCommentId ?? '').trim();
    if (trimmedParentComment) {
        try {
            const result = await withSupabasePostgres<{ value: string | null }>(async (client) => {
                const rows = await client.query<{ author_user_id: string }>(
                    `
                        select author_user_id
                        from app_social_comment
                        where id = $1::uuid
                        limit 1
                    `,
                    [trimmedParentComment],
                );
                if (rows.rowCount === 0) return { value: null };
                return { value: rows.rows[0].author_user_id };
            });
            if (result === null) return null;
            if (result.value && result.value !== comment.authorUserId) {
                out.add(result.value);
            }
        } catch (error) {
            console.warn(
                '[SocialEvents] resolveCommentRecipients lookup failed:',
                error instanceof Error ? error.message : 'unknown',
            );
            return null;
        }
    }
    return Array.from(out);
}

// === Payload builders (per kind) ============================================

export function buildDmPayload(args: {
    entity: SocialEntity<'dm_message'>;
    senderUserId: string;
    bodySnippet: string;
}): PushPayload {
    return {
        title: 'Новое сообщение',
        body: `${args.senderUserId}: ${args.bodySnippet}`,
        data: {
            entityId: args.entity.id,
            scopeType: args.entity.scopeType,
            scopeId: args.entity.scopeId,
            kind: args.entity.kind,
        },
        url: '/',
        tag: `social-dm-${args.entity.id}`,
    };
}

export function buildCommentPayload(args: {
    parentEntity: SocialEntity;
    comment: SocialComment;
    bodySnippet: string;
}): PushPayload {
    const label = ENTITY_KIND_LABEL_RU[args.parentEntity.kind] ?? 'записи';
    return {
        title: `Комментарий к вашему ${label}`,
        body: `${args.comment.authorUserId}: ${args.bodySnippet}`,
        data: {
            entityId: args.parentEntity.id,
            scopeType: args.parentEntity.scopeType,
            scopeId: args.parentEntity.scopeId,
            sourceKind: 'comment',
            sourceId: args.comment.id,
            kind: args.parentEntity.kind,
        },
        url: '/',
        tag: `social-comment-${args.comment.id}`,
    };
}

export function buildGroupPostPayload(args: {
    entity: SocialEntity;
}): PushPayload {
    const label = GROUP_POST_VERB_LABEL_RU[args.entity.kind] ?? 'запись';
    return {
        title: 'Новое в группе',
        body: `${args.entity.authorUserId} опубликовал ${label}`,
        data: {
            entityId: args.entity.id,
            scopeType: args.entity.scopeType,
            scopeId: args.entity.scopeId,
            kind: args.entity.kind,
        },
        url: '/',
        tag: `social-group-post-${args.entity.id}`,
    };
}

export function buildAnnouncementPayload(args: {
    entity: SocialEntity<'announcement'>;
}): PushPayload {
    const priority = args.entity.payload?.priority;
    const title = priority === 'critical' ? '🚨 Важное объявление' : '📢 Объявление';
    return {
        title,
        body: snippet(args.entity.payload?.title ?? 'Новое объявление', 120),
        data: {
            entityId: args.entity.id,
            scopeType: args.entity.scopeType,
            scopeId: args.entity.scopeId,
            kind: args.entity.kind,
            priority: priority ?? null,
        },
        url: '/',
        tag: `social-announcement-${args.entity.id}`,
    };
}

// === Per-kind fan-out handlers ===============================================

/**
 * Fetch + filter pending mentions for an entity, then fan out one push per
 * unique recipient. Exposed so tests can call it directly without the event
 * emitter detour. The `skipAuthor` flag is on by default — authors should not
 * be notified about their own mentions even if the extractor produced them.
 */
export async function onEntityCreated(
    entity: SocialEntity,
    opts?: { skipAuthor?: boolean },
): Promise<void> {
    if (!isPushConfigured()) {
        // Same behavior as exam-reminders: subscription CRUD still works, but
        // sending is a no-op. We deliberately still walk the mentions table
        // below so `app_push_sends` rows get written with status reflecting
        // the configuration; but we short-circuit if VAPID is missing — there
        // is no value in writing 'failed' rows for every mention while VAPID
        // is unconfigured (an admin-only condition).
        return;
    }
    const skipAuthor = opts?.skipAuthor !== false;

    try {
        const result = await withSupabasePostgres(async (client) => {
            return selectMentions(client, 'entity', entity.id);
        });
        if (result === null) {
            console.warn('[SocialEvents] Postgres unavailable, skipping entity mentions');
            return;
        }

        const targets = skipAuthor
            ? result.filter((t) => t.mentionedUserId !== entity.authorUserId)
            : result;
        if (targets.length === 0) return;

        // Deduplicate by mentionedUserId — the mention table could in theory
        // contain duplicates from edits before this rollout.
        const seen = new Set<string>();
        for (const target of targets) {
            if (seen.has(target.mentionedUserId)) continue;
            seen.add(target.mentionedUserId);
            const payload = buildMentionPayload({
                authorUserId: entity.authorUserId,
                entity,
                sourceKind: 'entity',
                sourceId: entity.id,
            });
            try {
                await deliverMentionToUser(target, payload);
            } catch (error) {
                console.warn(
                    `[SocialEvents] deliverMentionToUser failed user=${hashUserId(target.mentionedUserId)}:`,
                    error instanceof Error ? error.message : 'unknown',
                );
            }
        }
    } catch (error) {
        console.error(
            '[SocialEvents] onEntityCreated unhandled:',
            error instanceof Error ? error.message : 'unknown',
        );
    }
}

/**
 * Comment counterpart of `onEntityCreated`. Looks up mentions whose source is
 * the freshly inserted comment row. The parent entity is supplied by the
 * emitter so the payload can reference the originating entity without an
 * extra query.
 */
export async function onCommentCreated(
    comment: SocialComment,
    parentEntity: SocialEntity,
): Promise<void> {
    if (!isPushConfigured()) return;

    // Track which userIds already received a push from THIS comment event so
    // a user who is both the parent-entity author AND mentioned in the comment
    // does not get two pushes.
    const alreadyNotified = new Set<string>();

    try {
        const result = await withSupabasePostgres(async (client) => {
            return selectMentions(client, 'comment', comment.id);
        });
        if (result === null) {
            console.warn('[SocialEvents] Postgres unavailable, skipping comment mentions');
        } else {
            const mentionTargets = result.filter((t) => t.mentionedUserId !== comment.authorUserId);
            const seen = new Set<string>();
            for (const target of mentionTargets) {
                if (seen.has(target.mentionedUserId)) continue;
                seen.add(target.mentionedUserId);
                const payload = buildMentionPayload({
                    authorUserId: comment.authorUserId,
                    entity: parentEntity,
                    sourceKind: 'comment',
                    sourceId: comment.id,
                });
                try {
                    await deliverMentionToUser(target, payload);
                    alreadyNotified.add(target.mentionedUserId);
                } catch (error) {
                    console.warn(
                        `[SocialEvents] deliverMentionToUser failed user=${hashUserId(target.mentionedUserId)}:`,
                        error instanceof Error ? error.message : 'unknown',
                    );
                }
            }
        }
    } catch (error) {
        console.error(
            '[SocialEvents] onCommentCreated (mentions) unhandled:',
            error instanceof Error ? error.message : 'unknown',
        );
    }

    // Then the parent-author / parent-comment-author fan-out (new in this
    // expansion). Independent of the mention pass — if a mention covered the
    // same recipient we skip them via `alreadyNotified` so they do not get
    // both a "you were mentioned" and a "reply to your post" push.
    try {
        const recipients = await resolveCommentRecipients(comment, parentEntity);
        if (!recipients) return;

        const bodySnippet = snippet(comment.body);
        for (const userId of recipients) {
            if (alreadyNotified.has(userId)) continue;
            const payload = buildCommentPayload({
                parentEntity,
                comment,
                bodySnippet,
            });
            try {
                await deliverPushToUser({
                    userId,
                    fingerprint: `comment:${comment.id}:${userId}`,
                    kind: COMMENT_KIND,
                    payload,
                });
                alreadyNotified.add(userId);
            } catch (error) {
                console.warn(
                    `[SocialEvents] deliverPushToUser(comment) failed user=${hashUserId(userId)}:`,
                    error instanceof Error ? error.message : 'unknown',
                );
            }
        }
    } catch (error) {
        console.error(
            '[SocialEvents] onCommentCreated (comment-fanout) unhandled:',
            error instanceof Error ? error.message : 'unknown',
        );
    }
}

/**
 * DM fan-out: push the new DM to the room peer (not the author). DM rooms in
 * this product are strictly 2-party today, so there is always exactly one
 * other participant.
 */
export async function onSocialDmCreated(
    entity: SocialEntity<'dm_message'>,
): Promise<void> {
    try {
        const participants = resolveDmParticipants(entity.scopeId);
        if (!participants) {
            // Non-direct room shape — we do not know how to map it. Skip
            // quietly rather than spam stack traces.
            return;
        }
        const recipients = participants.filter((u) => u !== entity.authorUserId);
        if (recipients.length === 0) return;

        for (const userId of recipients) {
            await ensureDmNotificationRow(entity, userId);
        }

        if (!isPushConfigured()) return;

        const bodySnippet = snippet(entity.payload?.body);
        for (const userId of recipients) {
            const payload = buildDmPayload({
                entity,
                senderUserId: entity.authorUserId,
                bodySnippet,
            });
            try {
                await deliverPushToUser({
                    userId,
                    fingerprint: `dm:${entity.id}`,
                    kind: DM_KIND,
                    payload,
                });
            } catch (error) {
                console.warn(
                    `[SocialEvents] deliverPushToUser(dm) failed user=${hashUserId(userId)}:`,
                    error instanceof Error ? error.message : 'unknown',
                );
            }
        }
    } catch (error) {
        console.error(
            '[SocialEvents] onSocialDmCreated unhandled:',
            error instanceof Error ? error.message : 'unknown',
        );
    }
}

/**
 * Group-feed post fan-out: notify every active member of the group except the
 * author. Used for kinds {'post', 'task', 'extra_lesson'} that originate in a
 * group scope.
 */
export async function onGroupPostCreated(entity: SocialEntity): Promise<void> {
    if (!isPushConfigured()) return;
    if (entity.scopeType !== 'group') return;

    try {
        const prefix = 'group:';
        const groupKey = entity.scopeId.startsWith(prefix)
            ? entity.scopeId.slice(prefix.length)
            : entity.scopeId;
        if (!groupKey) return;

        const members = await resolveGroupMembers(groupKey);
        if (!members) return;

        const recipients = members.filter((u) => u !== entity.authorUserId);
        if (recipients.length === 0) return;

        const payload = buildGroupPostPayload({ entity });
        for (const userId of recipients) {
            try {
                await deliverPushToUser({
                    userId,
                    fingerprint: `group-post:${entity.id}:${userId}`,
                    kind: GROUP_POST_KIND,
                    payload,
                });
            } catch (error) {
                console.warn(
                    `[SocialEvents] deliverPushToUser(group-post) failed user=${hashUserId(userId)}:`,
                    error instanceof Error ? error.message : 'unknown',
                );
            }
        }
    } catch (error) {
        console.error(
            '[SocialEvents] onGroupPostCreated unhandled:',
            error instanceof Error ? error.message : 'unknown',
        );
    }
}

/**
 * Announcement fan-out. Targeted (payload.targetGroups) is the common path.
 * Broadcast (no targetGroups) is gated on `priority === 'critical'` to avoid
 * spamming push subscribers about routine bulletins. Always skips the
 * announcement author themselves.
 */
export async function onAnnouncementCreated(
    entity: SocialEntity<'announcement'>,
): Promise<void> {
    if (!isPushConfigured()) return;
    try {
        const recipients = await resolveAnnouncementRecipients(entity.payload);
        if (!recipients) return;

        const filtered = recipients.filter((u) => u && u !== entity.authorUserId);
        if (filtered.length === 0) return;

        const payload = buildAnnouncementPayload({ entity });
        for (const userId of filtered) {
            try {
                await deliverPushToUser({
                    userId,
                    fingerprint: `announcement:${entity.id}:${userId}`,
                    kind: ANNOUNCEMENT_KIND,
                    payload,
                });
            } catch (error) {
                console.warn(
                    `[SocialEvents] deliverPushToUser(announcement) failed user=${hashUserId(userId)}:`,
                    error instanceof Error ? error.message : 'unknown',
                );
            }
        }
    } catch (error) {
        console.error(
            '[SocialEvents] onAnnouncementCreated unhandled:',
            error instanceof Error ? error.message : 'unknown',
        );
    }
}

// === Listener registration ===================================================

/**
 * Dispatch a freshly-created entity to every relevant kind-specific handler.
 * Each handler is awaited sequentially so PG load stays bounded, but failures
 * are swallowed inside each handler — one failing path never aborts the
 * others.
 */
async function dispatchEntityCreated(entity: SocialEntity): Promise<void> {
    // Mentions fire for regular social entities. DM rows get their own
    // per-recipient notification row below, so they should not re-enter the
    // mention-push path on replay.
    if (entity.kind !== 'dm_message') {
        await onEntityCreated(entity);
    }

    // DM fan-out
    if (entity.kind === 'dm_message') {
        await onSocialDmCreated(entity as SocialEntity<'dm_message'>);
    }

    // Group feed fan-out
    if (
        entity.scopeType === 'group' &&
        (entity.kind === 'post' || entity.kind === 'task' || entity.kind === 'extra_lesson')
    ) {
        await onGroupPostCreated(entity);
    }

    // Announcements
    if (entity.kind === 'announcement') {
        await onAnnouncementCreated(entity as SocialEntity<'announcement'>);
    }
}

// Register listeners at import time. The void operator + .catch swallow keep
// the EventEmitter happy — listeners that return a Promise must handle their
// own rejection because EventEmitter does not.
socialEvents.on('entity-created', (entity: SocialEntity) => {
    void dispatchEntityCreated(entity).catch((error) => {
        console.warn(
            '[SocialEvents] entity-created dispatcher failed:',
            error instanceof Error ? error.message : 'unknown',
        );
    });
});

socialEvents.on('comment-created', (payload: { comment: SocialComment; parentEntity: SocialEntity }) => {
    void onCommentCreated(payload.comment, payload.parentEntity).catch((error) => {
        console.warn(
            '[SocialEvents] comment-created listener failed:',
            error instanceof Error ? error.message : 'unknown',
        );
    });
});

// Test-only export bundle — mirrors the pattern from exam-reminders.ts.
export const __testing = {
    selectMentions,
    hashUserId,
    snippet,
    dispatchEntityCreated,
    MENTION_KIND,
    DM_KIND,
    COMMENT_KIND,
    GROUP_POST_KIND,
    ANNOUNCEMENT_KIND,
};
