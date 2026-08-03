/**
 * Per-kind push notification preferences API client.
 *
 * Distinct from `@/lib/push-subscription` (which owns the legacy exam-reminder
 * flags and the browser PushManager flow). These two paths intentionally share
 * the `/api/v3/notifications/*` namespace but address different storage rows:
 *
 *   - `/prefs` (here: `push-subscription.getPrefs/setPrefs`) ← exam reminders
 *   - `/kind-prefs` (this file)                              ← universal PushKind opt-in/out
 *
 * The frontend only sends the keys the user actually toggled — the backend
 * merges over the existing map. A missing key always means "default-on".
 */
'use client';

import { fetchWithAuth, type ApiResponse } from '@/lib/api/core';

export type NotificationKind =
    | '1day'
    | '1hour'
    | 'social_mention'
    | 'social_dm'
    | 'social_comment'
    | 'social_group_post'
    | 'social_announcement'
    | 'event_1day'
    | 'event_1hour';

/**
 * Subset of `NotificationKind` that the social UI surface controls. The
 * explicit tuple type (instead of a widened `readonly NotificationKind[]`)
 * lets consumers index by `(typeof ...)[number]` and get the narrowed union
 * — useful for building exhaustive Record<Kind, string> label maps.
 */
export const SOCIAL_NOTIFICATION_KINDS = [
    'social_mention',
    'social_dm',
    'social_comment',
    'social_group_post',
    'social_announcement',
    'event_1day',
    'event_1hour',
] as const satisfies readonly NotificationKind[];

export type SocialNotificationKind = (typeof SOCIAL_NOTIFICATION_KINDS)[number];

export interface NotificationPrefs {
    userId: string;
    enabledKinds: Partial<Record<NotificationKind, boolean>>;
    updatedAt: string;
    createdAt: string;
}

interface PrefsResponse extends ApiResponse {
    data?: NotificationPrefs;
}

/**
 * Fetch the per-kind opt-in map for the current user. The backend returns an
 * effective view: a row is synthesized for users who have never written prefs
 * so the caller does not need to handle a 404.
 */
export async function getNotificationPrefs(): Promise<
    { ok: true; prefs: NotificationPrefs } | { ok: false; message?: string }
> {
    const response = await fetchWithAuth<unknown>('/api/v3/notifications/kind-prefs');
    const data = response as PrefsResponse;
    if (!data.success || !data.data) {
        return { ok: false, message: data.error };
    }
    return { ok: true, prefs: data.data };
}

/**
 * Partial-update the per-kind opt-in map. Only the keys present in `updates`
 * are changed server-side; other keys keep their existing value (or implicit
 * default-on for keys that were never set).
 *
 * Returns `{ ok: true }` on a 204 No Content response. The route deliberately
 * does not echo the new state — callers should hold an optimistic copy locally.
 */
export async function setNotificationPrefs(
    updates: Partial<Record<NotificationKind, boolean>>,
): Promise<{ ok: true } | { ok: false; message?: string }> {
    const response = await fetchWithAuth<unknown>('/api/v3/notifications/kind-prefs', {
        method: 'PUT',
        body: JSON.stringify({ enabledKinds: updates }),
    });
    const data = response as ApiResponse;
    if (!data.success) {
        return { ok: false, message: data.error };
    }
    return { ok: true };
}

/**
 * Resolve the effective enabled-state for a single kind from a prefs object.
 * Missing key → true (default-on). Exposed as a helper so the UI never
 * accidentally treats undefined as off.
 */
export function isKindEnabled(
    prefs: NotificationPrefs | null,
    kind: NotificationKind,
): boolean {
    if (!prefs) return true;
    const value = prefs.enabledKinds[kind];
    if (value === undefined) return true;
    return value === true;
}
