/**
 * Centralized "your session expired" notice. Shown when the app force-logs the
 * user out after a 401 / AUTH_RELOGIN_REQUIRED, so the logout is no longer silent
 * and the user understands why they landed back on the login screen.
 */

import { toast } from './toast';
import type { AppLanguage } from './language-context';

const SESSION_EXPIRED_MESSAGE: Record<AppLanguage, string> = {
    ru: 'Сессия входа устарела. Войдите заново.',
    kz: 'Кіру сессиясының мерзімі өтті. Қайта кіріңіз.',
    en: 'Your login session has expired. Please sign in again.',
};

// Several screens can hit a 401 in parallel and each triggers a logout. Dedupe so
// the user sees a single toast instead of a stack of identical ones.
const DEDUPE_WINDOW_MS = 8000;
// NEGATIVE_INFINITY means "never shown", so the first call always passes the
// dedupe check regardless of the current clock value.
let lastShownAt = Number.NEGATIVE_INFINITY;

/** Reset the internal dedupe clock. Test-only. */
export function resetSessionExpiredNotice(): void {
    lastShownAt = Number.NEGATIVE_INFINITY;
}

/**
 * Show a one-time, themed "session expired" toast. Calls within
 * {@link DEDUPE_WINDOW_MS} of the previous one are ignored.
 * `now` is injectable for deterministic tests.
 */
export function notifySessionExpired(language: AppLanguage, now: number = Date.now()): void {
    if (now - lastShownAt < DEDUPE_WINDOW_MS) return;
    lastShownAt = now;
    toast.info(SESSION_EXPIRED_MESSAGE[language] ?? SESSION_EXPIRED_MESSAGE.ru, 5000);
}
