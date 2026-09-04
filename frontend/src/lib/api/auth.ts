/**
 * Auth API: login, curator login, logout, token verification.
 * These bypass `fetchWithAuth` because they manage the token themselves.
 */
import { trackAnalyticsEvent } from '../analytics';
import {
    API_URL,
    apiText,
    fetchWithAuth,
    getClientSessionId,
    getToken,
    removeToken,
    setToken,
    type ApiResponse,
} from './core';
import type { LoginChallengeStatus } from '../login-challenge';

const IS_DEV = process.env.NODE_ENV !== 'production';

export interface LoginResponse {
    success: boolean;
    token?: string;
    user?: { userId: string };
    referral?: {
        status: 'missing' | 'applied' | 'invalid' | 'self' | 'already_claimed' | 'claim_window_expired' | 'error';
    };
    error?: string;
    /** Backend error code, e.g. `AUTH_NOT_REGISTERED`, `AUTH_ALREADY_REGISTERED`, `AUTH_INVALID_CREDENTIALS`. */
    errorCode?: string;
    statusCode?: number;
}

/** Well-known auth error codes returned by `/api/v3/auth/*` (see backend contract). */
export const AUTH_ERROR_CODES = {
    invalidCredentials: 'AUTH_INVALID_CREDENTIALS',
    notRegistered: 'AUTH_NOT_REGISTERED',
    alreadyRegistered: 'AUTH_ALREADY_REGISTERED',
    challengeNotFound: 'LOGIN_CHALLENGE_NOT_FOUND',
    challengeForbidden: 'LOGIN_CHALLENGE_FORBIDDEN',
    challengeNotPending: 'LOGIN_CHALLENGE_NOT_PENDING',
} as const;

function networkErrorResponse(error: unknown): LoginResponse {
    const text = apiText();
    if (error instanceof TypeError && error.message === 'Failed to fetch') {
        return { success: false, error: text.cannotConnect, statusCode: 0 };
    }
    if (error instanceof Error && error.name === 'AbortError') {
        return { success: false, error: text.timeout, statusCode: 0 };
    }
    return { success: false, error: `${text.networkError}: ${error instanceof Error ? error.message : text.unknownError}`, statusCode: 0 };
}

/** Persist a freshly issued session token + userId the same way every login path does. */
function storeIssuedSession(token: string, userId: string | undefined): void {
    setToken(token);
    if (userId) {
        localStorage.setItem('userId', userId);
    }
}

async function readJsonSafe<T = Record<string, unknown>>(response: Response): Promise<T> {
    try {
        const parsed: unknown = await response.json();
        return (parsed && typeof parsed === 'object' ? parsed : {}) as T;
    } catch {
        return {} as T;
    }
}

export async function register(login: string, password: string, referralCode?: string): Promise<LoginResponse> {
    try {
        trackAnalyticsEvent('register_submit', {
            feature: 'auth',
            label: 'platonus_register',
            status: 'attempt',
            path: '/register',
        });
        const clientSessionId = getClientSessionId();
        const response = await fetch(`${API_URL}/api/v3/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(clientSessionId ? { 'X-Client-Session-Id': clientSessionId } : {}),
            },
            body: JSON.stringify({ login, password, referralCode: referralCode ?? null }),
            credentials: 'include',
        });

        const data = await readJsonSafe<LoginResponse>(response);

        if (data.success && data.token) {
            storeIssuedSession(data.token, data.user?.userId);
            trackAnalyticsEvent('register_success', {
                feature: 'auth',
                label: 'platonus_register',
                status: 'success',
                path: '/register',
            });
        } else {
            trackAnalyticsEvent('register_failure', {
                feature: 'auth',
                label: 'platonus_register',
                status: String(response.status || 'failed'),
                details: data.errorCode || data.error || 'register_failed',
                path: '/register',
            });
        }

        return { ...data, success: Boolean(data.success), statusCode: response.status };
    } catch (error: unknown) {
        if (IS_DEV) {
            console.error('[API] Register error:', error);
        }
        trackAnalyticsEvent('register_failure', {
            feature: 'auth',
            label: 'platonus_register',
            status: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network',
            details: error instanceof Error ? error.message : 'unknown',
            path: '/register',
        });
        return networkErrorResponse(error);
    }
}

export async function login(username: string, password: string, referralCode?: string): Promise<LoginResponse> {
    const text = apiText();
    try {
        trackAnalyticsEvent('login_submit', {
            feature: 'auth',
            label: 'platonus_login',
            status: 'attempt',
            path: '/login',
        });
        const clientSessionId = getClientSessionId();
        const response = await fetch(`${API_URL}/api/v3/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(clientSessionId ? { 'X-Client-Session-Id': clientSessionId } : {}),
            },
            body: JSON.stringify({ username, password, referralCode }),
            credentials: 'include',
        });

        const data = await readJsonSafe<LoginResponse>(response);

        if (data.success && data.token) {
            storeIssuedSession(data.token, data.user?.userId);
            trackAnalyticsEvent('login_success', {
                feature: 'auth',
                label: 'platonus_login',
                status: 'success',
                path: '/login',
            });
        } else {
            trackAnalyticsEvent('login_failure', {
                feature: 'auth',
                label: 'platonus_login',
                status: String(response.status || 'failed'),
                details: data.errorCode || data.error || 'login_failed',
                path: '/login',
            });
        }

        return { ...data, success: Boolean(data.success), statusCode: response.status };
    } catch (error: unknown) {
        if (IS_DEV) {
            console.error('[API] Login error:', error);
        }
        trackAnalyticsEvent('login_failure', {
            feature: 'auth',
            label: 'platonus_login',
            status: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network',
            details: error instanceof Error ? error.message : 'unknown',
            path: '/login',
        });

        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            return { success: false, error: text.cannotConnect };
        }
        if (error instanceof Error && error.name === 'AbortError') {
            return { success: false, error: text.timeout };
        }
        return { success: false, error: `${text.networkError}: ${error instanceof Error ? error.message : text.unknownError}` };
    }
}

export async function curatorLogin(userId: string, password: string): Promise<LoginResponse> {
    const text = apiText();
    try {
        trackAnalyticsEvent('login_submit', {
            feature: 'auth',
            label: 'curator_login',
            status: 'attempt',
            path: '/curator-login',
        });
        const clientSessionId = getClientSessionId();
        const response = await fetch(`${API_URL}/api/v3/auth/curator-login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(clientSessionId ? { 'X-Client-Session-Id': clientSessionId } : {}),
            },
            body: JSON.stringify({ userId, password }),
            credentials: 'include',
        });

        const data = await response.json();

        if (data.success && data.token) {
            setToken(data.token);
            if (data.user?.userId) {
                localStorage.setItem('userId', data.user.userId);
            }
            trackAnalyticsEvent('login_success', {
                feature: 'auth',
                label: 'curator_login',
                status: 'success',
                path: '/curator-login',
            });
        } else {
            trackAnalyticsEvent('login_failure', {
                feature: 'auth',
                label: 'curator_login',
                status: String(response.status || 'failed'),
                details: data.error || 'curator_login_failed',
                path: '/curator-login',
            });
        }

        return data;
    } catch (error: unknown) {
        if (IS_DEV) {
            console.error('[API] Curator login error:', error);
        }
        trackAnalyticsEvent('login_failure', {
            feature: 'auth',
            label: 'curator_login',
            status: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network',
            details: error instanceof Error ? error.message : 'unknown',
            path: '/curator-login',
        });

        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            return { success: false, error: text.cannotConnect };
        }
        if (error instanceof Error && error.name === 'AbortError') {
            return { success: false, error: text.timeout };
        }
        return { success: false, error: `${text.networkError}: ${error instanceof Error ? error.message : text.unknownError}` };
    }
}

export async function logout(): Promise<void> {
    const token = getToken();
    const clientSessionId = getClientSessionId();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
        await fetch(`${API_URL}/api/v3/auth/logout`, {
            method: 'POST',
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                ...(clientSessionId ? { 'X-Client-Session-Id': clientSessionId } : {}),
            },
            credentials: 'include',
            signal: controller.signal,
        });
    } catch (error) {
        if (IS_DEV) {
            console.warn('[API] Logout request failed:', error);
        }
    } finally {
        clearTimeout(timeout);
        removeToken();
    }
}

export async function verifyToken(): Promise<ApiResponse> {
    const text = apiText();
    const token = getToken();
    try {
        const clientSessionId = getClientSessionId();
        const response = await fetch(`${API_URL}/api/v3/auth/verify`, {
            method: 'GET',
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                ...(clientSessionId ? { 'X-Client-Session-Id': clientSessionId } : {}),
            },
            credentials: 'include',
        });

        const renewedToken = response.headers.get('X-Renewed-Token');
        if (renewedToken) {
            if (IS_DEV) {
                console.log('[API] Token auto-renewed during verify');
            }
            setToken(renewedToken);
        }

        const data = await response.json();
        return { ...data, statusCode: response.status };
    } catch (error: unknown) {
        if (IS_DEV) {
            console.error('[API] Verify error:', error);
        }
        const msg = error instanceof TypeError && error.message === 'Failed to fetch'
            ? text.serverUnavailableShort
            : (error instanceof Error ? error.message : text.networkError);
        return { success: false, error: msg, statusCode: 0 };
    }
}

// === Challenge login (QR / push): "confirm on another device" ===

export type LoginChallengeKind = 'qr' | 'push';

export interface LoginChallenge {
    challengeId: string;
    approveSecret: string;
    manualCode: string;
    pollSecret: string;
    qrUrl: string;
    expiresAt: string;
}

export interface PushLoginChallenge {
    challengeId: string | null;
    pollSecret: string | null;
    expiresAt: string | null;
    delivered: boolean;
}

export interface LoginChallengePollResult {
    success: boolean;
    status?: LoginChallengeStatus;
    /** Present only once, on the first `approved` poll (the row then becomes `consumed`). */
    user?: { userId: string };
    error?: string;
    errorCode?: string;
    statusCode?: number;
}

export interface LoginChallengeInfo {
    challengeId: string;
    kind: LoginChallengeKind;
    status: LoginChallengeStatus;
    requesterDeviceName: string | null;
    requesterIp: string | null;
    createdAt: string;
    expiresAt: string;
}

export interface LoginChallengeDecision {
    status: LoginChallengeStatus;
}

function challengeHeaders(): Record<string, string> {
    const clientSessionId = getClientSessionId();
    return {
        'Content-Type': 'application/json',
        ...(clientSessionId ? { 'X-Client-Session-Id': clientSessionId } : {}),
    };
}

/** Public (unauthenticated) POST for challenge creation — same envelope as fetchWithAuth, no bearer token. */
async function postPublic<T>(endpoint: string, body: unknown, path: string): Promise<ApiResponse<T>> {
    const text = apiText();
    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            method: 'POST',
            headers: challengeHeaders(),
            body: JSON.stringify(body ?? {}),
            credentials: 'include',
        });
        const data = await readJsonSafe<ApiResponse<T>>(response);
        if (!response.ok || !data.success) {
            trackAnalyticsEvent('api_error', {
                feature: 'auth',
                status: String(response.status),
                details: `POST ${endpoint}`,
                path,
            });
            return {
                success: false,
                error: data.error || text.requestError,
                errorCode: data.errorCode,
                statusCode: response.status,
            };
        }
        return { ...data, success: true, statusCode: response.status };
    } catch (error: unknown) {
        if (IS_DEV) {
            console.error(`[API] ${endpoint} error:`, error);
        }
        return networkErrorResponse(error) as ApiResponse<T>;
    }
}

/** Start a QR challenge: the QR encodes `qrUrl`, the poller keeps `pollSecret` locally. */
export async function createLoginChallenge(): Promise<ApiResponse<LoginChallenge>> {
    trackAnalyticsEvent('login_submit', {
        feature: 'auth',
        label: 'qr',
        status: 'challenge_create',
        path: '/login',
    });
    return postPublic<LoginChallenge>('/api/v3/auth/login/challenge', {}, '/login');
}

/** Start a push challenge for `username`; `delivered:false` means no device has push set up. */
export async function createPushLoginChallenge(username: string): Promise<ApiResponse<PushLoginChallenge>> {
    trackAnalyticsEvent('login_submit', {
        feature: 'auth',
        label: 'push',
        status: 'challenge_create',
        path: '/login',
    });
    return postPublic<PushLoginChallenge>('/api/v3/auth/login/push/challenge', { username }, '/login');
}

/**
 * Poll a challenge. On the first `approved` response the backend also returns a
 * token + user (once); we store them exactly like a password login does.
 */
export async function pollLoginChallenge(
    challengeId: string,
    pollSecret: string,
    kind: LoginChallengeKind = 'qr',
): Promise<LoginChallengePollResult> {
    try {
        const query = new URLSearchParams({ challengeId, pollSecret });
        const response = await fetch(`${API_URL}/api/v3/auth/login/challenge/status?${query.toString()}`, {
            method: 'GET',
            headers: challengeHeaders(),
            credentials: 'include',
        });
        const raw = await readJsonSafe<Record<string, unknown>>(response);
        const data = (raw.data && typeof raw.data === 'object' ? raw.data : {}) as Record<string, unknown>;
        const success = Boolean(raw.success) && response.ok;

        if (!success) {
            return {
                success: false,
                error: typeof raw.error === 'string' ? raw.error : apiText().requestError,
                errorCode: typeof raw.errorCode === 'string' ? raw.errorCode : undefined,
                statusCode: response.status,
            };
        }

        const status = (typeof data.status === 'string' ? data.status : undefined) as LoginChallengeStatus | undefined;
        // Token/user may sit at the top level (LoginResponse shape) or inside `data`.
        const token = typeof raw.token === 'string' ? raw.token : (typeof data.token === 'string' ? data.token : undefined);
        const userRaw = (raw.user ?? data.user) as { userId?: unknown } | undefined;
        const userId = userRaw && typeof userRaw.userId === 'string' ? userRaw.userId : undefined;

        if (status === 'approved' && token) {
            storeIssuedSession(token, userId);
            trackAnalyticsEvent('login_success', {
                feature: 'auth',
                label: kind,
                status: 'success',
                path: '/login',
            });
            return { success: true, status, user: userId ? { userId } : undefined, statusCode: response.status };
        }

        if (status === 'denied' || status === 'expired') {
            trackAnalyticsEvent('login_failure', {
                feature: 'auth',
                label: kind,
                status,
                path: '/login',
            });
        }

        return { success: true, status, statusCode: response.status };
    } catch (error: unknown) {
        if (IS_DEV) {
            console.error('[API] Login challenge poll error:', error);
        }
        return networkErrorResponse(error);
    }
}

/** Authenticated: who is asking to sign in (device, IP, when) before the user approves. */
export async function inspectLoginChallenge(challengeId: string, approveSecret: string): Promise<ApiResponse<LoginChallengeInfo>> {
    return fetchWithAuth<LoginChallengeInfo>('/api/v3/auth/login/challenge/inspect', {
        method: 'POST',
        body: JSON.stringify({ challengeId, approveSecret }),
    });
}

export async function approveLoginChallenge(challengeId: string, approveSecret: string): Promise<ApiResponse<LoginChallengeDecision>> {
    trackAnalyticsEvent('login_challenge_decision', {
        feature: 'auth',
        label: 'approve',
        path: '/login/approve',
    });
    return fetchWithAuth<LoginChallengeDecision>('/api/v3/auth/login/challenge/approve', {
        method: 'POST',
        body: JSON.stringify({ challengeId, approveSecret }),
    });
}

export async function denyLoginChallenge(challengeId: string, approveSecret: string): Promise<ApiResponse<LoginChallengeDecision>> {
    trackAnalyticsEvent('login_challenge_decision', {
        feature: 'auth',
        label: 'deny',
        path: '/login/approve',
    });
    return fetchWithAuth<LoginChallengeDecision>('/api/v3/auth/login/challenge/deny', {
        method: 'POST',
        body: JSON.stringify({ challengeId, approveSecret }),
    });
}
