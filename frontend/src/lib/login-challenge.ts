/**
 * Pure helpers for the challenge-based login flow (QR / push) and the
 * password/QR/push mode switch on /login. No React, no fetch — safe to unit test.
 */

export type LoginMode = 'password' | 'qr' | 'push';
export type LoginChallengeStatus = 'pending' | 'approved' | 'consumed' | 'denied' | 'expired';

export const LOGIN_MODE_STORAGE_KEY = 'app-login-mode-v1';
export const LOGIN_CHALLENGE_POLL_INTERVAL_MS = 2000;
export const MANUAL_CODE_LENGTH = 12;

const LOGIN_MODES: readonly LoginMode[] = ['password', 'qr', 'push'];
const TERMINAL_STATUSES: readonly LoginChallengeStatus[] = ['approved', 'consumed', 'denied', 'expired'];

export function isLoginMode(value: unknown): value is LoginMode {
    return typeof value === 'string' && (LOGIN_MODES as readonly string[]).includes(value);
}

export function isTerminalChallengeStatus(status: string | null | undefined): boolean {
    return !!status && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Normalize a manual code typed by the user: uppercase, drop dashes/spaces and
 * everything outside the Crockford base32 alphabet, map ambiguous glyphs
 * (O→0, I/L→1). Mirrors the backend normalization so what the user sees is
 * what the server compares.
 */
export function normalizeManualCode(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .toUpperCase()
        .replace(/O/g, '0')
        .replace(/[IL]/g, '1')
        .replace(/[^0-9A-HJKMNP-TV-Z]/g, '')
        .slice(0, MANUAL_CODE_LENGTH);
}

/** Group a normalized code into `XXXX-XXXX-XXXX` (partial input is grouped as far as it goes). */
export function formatManualCode(value: string): string {
    const normalized = normalizeManualCode(value);
    const groups = normalized.match(/.{1,4}/g);
    return groups ? groups.join('-') : '';
}

export function isCompleteManualCode(value: string): boolean {
    return normalizeManualCode(value).length === MANUAL_CODE_LENGTH;
}

/** Whole seconds left until `expiresAt` (never negative). */
export function secondsUntil(expiresAt: string | number | Date | null | undefined, now: number = Date.now()): number {
    if (expiresAt === null || expiresAt === undefined) return 0;
    const target = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
    if (!Number.isFinite(target)) return 0;
    return Math.max(0, Math.ceil((target - now) / 1000));
}

/** `m:ss` countdown label, e.g. 119 → `1:59`, 5 → `0:05`, negative → `0:00`. */
export function formatCountdown(totalSeconds: number): string {
    const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
    const minutes = Math.floor(safe / 60);
    const seconds = safe % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Only same-origin relative paths are accepted as a post-login redirect target:
 * must start with a single `/`, must not be protocol-relative (`//`), must not
 * contain a backslash or control characters. Returns null when rejected.
 */
export function sanitizeNextPath(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed.startsWith('/')) return null;
    if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return null;
    if (/[\\\x00-\x1f\x7f]/.test(trimmed)) return null;
    if (/^\/[^/?#]*:/.test(trimmed)) return null;
    if (trimmed.length > 2048) return null;
    return trimmed;
}

export const DEFAULT_POST_LOGIN_PATH = '/schedule';

export function resolvePostLoginPath(next: unknown): string {
    return sanitizeNextPath(next) ?? DEFAULT_POST_LOGIN_PATH;
}

/** Build `/login?next=<path>` for a protected page the user must sign in to reach. */
export function buildLoginRedirect(currentPath: string): string {
    const safe = sanitizeNextPath(currentPath);
    if (!safe || safe === '/' || safe === '/login') return '/login';
    return `/login?next=${encodeURIComponent(safe)}`;
}

/** Extract challenge id + approve secret from an approve URL or query params. */
export function parseApproveParams(params: { get(name: string): string | null } | null | undefined): { challengeId: string; approveSecret: string } | null {
    if (!params) return null;
    const challengeId = (params.get('c') || '').trim();
    const approveSecret = normalizeManualCode(params.get('s') || '');
    if (!challengeId || approveSecret.length !== MANUAL_CODE_LENGTH) return null;
    return { challengeId, approveSecret };
}

export function readStoredLoginMode(storage: Pick<Storage, 'getItem'> | null | undefined): LoginMode | null {
    try {
        const raw = storage?.getItem(LOGIN_MODE_STORAGE_KEY);
        return isLoginMode(raw) ? raw : null;
    } catch {
        return null;
    }
}

export function storeLoginMode(storage: Pick<Storage, 'setItem'> | null | undefined, mode: LoginMode): void {
    try {
        storage?.setItem(LOGIN_MODE_STORAGE_KEY, mode);
    } catch {
        // Storage may be unavailable (private mode, quota, SSR) — remembering the mode is best-effort.
    }
}
