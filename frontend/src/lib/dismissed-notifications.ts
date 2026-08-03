/**
 * Client-side "dismissed" set for the Notification Center.
 *
 * The backend has no per-row delete for notifications (they are projected from
 * `app_social_mention`), and we deliberately avoid destructive server deletes.
 * Instead, "clear" hides notifications locally by remembering their ids in
 * localStorage and filtering them out of the list. Dismissing also marks the
 * rows read via the existing API so the unread badge stays consistent.
 *
 * Per-device by design: clearing on one device does not sync to others, but
 * dismissed items there are already marked read so they will not nag.
 */

const STORAGE_KEY = 'dismissed-notifications';
/** Cap so the list cannot grow without bound; we keep the most recent ids. */
const MAX_KEPT = 1000;

function read(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    } catch {
        return [];
    }
}

/** All currently-dismissed notification ids (newest last). */
export function getDismissedNotificationIds(): string[] {
    return read();
}

/**
 * Merge `ids` into the dismissed set, trimming to the most recent
 * {@link MAX_KEPT}. Returns the resulting list. No-op server side.
 */
export function addDismissedNotificationIds(ids: readonly string[]): string[] {
    if (typeof window === 'undefined') return [];
    const merged = read();
    const seen = new Set(merged);
    for (const id of ids) {
        if (typeof id === 'string' && id && !seen.has(id)) {
            seen.add(id);
            merged.push(id);
        }
    }
    const trimmed = merged.length > MAX_KEPT ? merged.slice(merged.length - MAX_KEPT) : merged;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch {
        // Ignore quota / serialization errors — dismissal is best-effort.
    }
    return trimmed;
}
