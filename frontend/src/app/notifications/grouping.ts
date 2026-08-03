/**
 * Notification grouping — pure helpers for the Notification Center page.
 *
 * The flat `/api/v3/social/notifications` feed can return many rows targeted
 * at the same entity (e.g. five users @-mentioning the viewer in one post,
 * or one user replying five times to the same thread). The flat UI renders
 * each row as a separate card which becomes noisy fast.
 *
 * This module collapses the flat feed into a list of `NotificationGroup`s:
 *   - keyed by `(kind, sourceEntityId)`
 *   - groups sorted by their latest child's `createdAt` (desc)
 *   - children inside a group also sorted `createdAt` desc
 *   - per-group unread count + a unique-actor list (capped to 3 for display)
 *
 * No network / DOM / React imports — everything here is testable in vitest
 * without stubs. Keep it that way.
 */
import type { SocialNotification, SocialNotificationKind } from '@/lib/api/social';

/**
 * Maximum number of actor user ids surfaced in a group header. The UI shows
 * the first N names verbatim and renders "+ K more" for any overflow. Picked
 * to match Telegram / iOS-style mention summaries — small enough to fit on a
 * single line under the 4.5" mobile viewport we target.
 */
export const NOTIFICATION_GROUP_ACTOR_DISPLAY_CAP = 3;

/**
 * Single collapsed notification cluster — all notifications that share a
 * `(kind, sourceEntityId)` tuple. The frontend renders this as a single
 * card with an expand affordance when `notifications.length >= 2`; for
 * single-child groups it short-circuits back to the flat card layout.
 */
export interface NotificationGroup {
    /** Composite key used by React's reconciler — `"${kind}::${entityId}"`. */
    key: string;
    /** Entity id every child notification shares. */
    keyEntityId: string;
    /** The shared notification kind (mention / dm / comment / ...). */
    kind: SocialNotificationKind;
    /** First non-empty `summary` from the children — used as the headline. */
    entitySummary: string;
    /** Child rows, newest first. Same shape as the flat feed. */
    notifications: SocialNotification[];
    /** ISO timestamp of the newest child's `createdAt` — drives group sort. */
    latestAt: string;
    /** Number of children with `readAt === null`. */
    unreadCount: number;
    /**
     * Distinct actor user ids contributing to this group, in
     * most-recent-actor-first order. The UI usually slices the first
     * `NOTIFICATION_GROUP_ACTOR_DISPLAY_CAP` entries and renders the
     * remainder as "+ N more".
     */
    actorUserIds: string[];
}

/**
 * Pure grouping function. Stable / referentially safe on equal input
 * (does not depend on `Date.now()` or any other ambient).
 *
 * Returns `[]` for `null` / `undefined` / non-array input so callers can
 * pass the API response directly without a guard.
 */
export function groupNotifications(list: SocialNotification[] | null | undefined): NotificationGroup[] {
    if (!Array.isArray(list) || list.length === 0) return [];

    const groupsByKey = new Map<string, NotificationGroup>();

    for (const n of list) {
        // Skip anything that doesn't look like a real notification — defensive
        // because the network response is loosely typed once it crosses the
        // fetch boundary.
        if (!n || typeof n !== 'object') continue;
        if (typeof n.kind !== 'string') continue;
        if (typeof n.sourceEntityId !== 'string' || n.sourceEntityId.length === 0) continue;
        if (typeof n.createdAt !== 'string') continue;

        const key = `${n.kind}::${n.sourceEntityId}`;
        const existing = groupsByKey.get(key);
        if (existing) {
            existing.notifications.push(n);
        } else {
            groupsByKey.set(key, {
                key,
                keyEntityId: n.sourceEntityId,
                kind: n.kind,
                entitySummary: '',
                notifications: [n],
                latestAt: n.createdAt,
                unreadCount: 0,
                actorUserIds: [],
            });
        }
    }

    // Finalize each bucket: sort children, compute derived fields.
    const groups: NotificationGroup[] = [];
    for (const group of groupsByKey.values()) {
        group.notifications.sort((a, b) => compareDescIso(a.createdAt, b.createdAt));

        const latestChild = group.notifications[0];
        if (latestChild) {
            group.latestAt = latestChild.createdAt;
        }

        group.entitySummary = pickEntitySummary(group.notifications);
        group.unreadCount = group.notifications.reduce(
            (acc, n) => (n.readAt === null ? acc + 1 : acc),
            0,
        );
        group.actorUserIds = uniqueActorIds(group.notifications);

        groups.push(group);
    }

    // Sort groups by their latest child (newest first). Ties broken by key for
    // determinism so React doesn't reorder rows on identical timestamps.
    groups.sort((a, b) => {
        const delta = compareDescIso(a.latestAt, b.latestAt);
        if (delta !== 0) return delta;
        return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });

    return groups;
}

/**
 * Pluralize a count of grouped items using a per-locale forms tuple.
 * Russian uses the [one, few, many] paradigm (1 уведомление / 2-4 уведомления / 5+ уведомлений).
 * Kazakh and English use the [singular, plural] paradigm. Caller picks the
 * correct tuple for the active locale.
 */
export function pluralForms(count: number, forms: readonly [string, string, string] | readonly [string, string]): string {
    const safe = Math.max(0, Math.floor(Number.isFinite(count) ? count : 0));
    if (forms.length === 3) {
        return pluralRu(safe, forms[0], forms[1], forms[2]);
    }
    return safe === 1 ? forms[0] : forms[1];
}

/**
 * Russian count-pluralization. Exported for unit tests; kept here rather than
 * `strings.ts` so the grouping module is fully self-contained.
 */
export function pluralRu(count: number, one: string, few: string, many: string): string {
    const abs = Math.abs(count);
    const mod10 = abs % 10;
    const mod100 = abs % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
}

/**
 * Collect the unread child ids in a group — handy when the UI needs to
 * batch-mark them on expand or tap. Returns an empty array when nothing
 * is unread.
 */
export function collectUnreadIds(group: NotificationGroup): string[] {
    const ids: string[] = [];
    for (const n of group.notifications) {
        if (n.readAt === null && typeof n.id === 'string' && n.id.length > 0) {
            ids.push(n.id);
        }
    }
    return ids;
}

// === Internal helpers =======================================================

function compareDescIso(a: string, b: string): number {
    // Lexicographic comparison is correct for canonical ISO-8601 timestamps;
    // we don't pay the `Date` parse cost. Falls back to 0 for equal strings.
    if (a === b) return 0;
    return a < b ? 1 : -1;
}

function pickEntitySummary(children: SocialNotification[]): string {
    for (const n of children) {
        if (typeof n.summary === 'string' && n.summary.trim().length > 0) {
            return n.summary;
        }
    }
    return '';
}

function uniqueActorIds(children: SocialNotification[]): string[] {
    // children are already sorted desc by createdAt — preserve that order so
    // the "most-recent actor first" property the UI relies on for the
    // "actor1, actor2 + N more" caption holds without re-sorting.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const n of children) {
        if (typeof n.actorUserId === 'string' && n.actorUserId.length > 0 && !seen.has(n.actorUserId)) {
            seen.add(n.actorUserId);
            out.push(n.actorUserId);
        }
    }
    return out;
}
