/**
 * Auth API: login, curator login, logout, token verification.
 * These bypass `fetchWithAuth` because they manage the token themselves.
 */
import { trackAnalyticsEvent } from '../analytics';
import {
    API_URL,
    apiText,
    getClientSessionId,
    getToken,
    removeToken,
    setToken,
    type ApiResponse,
} from './core';

const IS_DEV = process.env.NODE_ENV !== 'production';

export interface LoginResponse {
    success: boolean;
    token?: string;
    user?: { userId: string };
    referral?: {
        status: 'missing' | 'applied' | 'invalid' | 'self' | 'already_claimed' | 'claim_window_expired' | 'error';
    };
    error?: string;
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

        const data = await response.json();

        if (data.success && data.token) {
            setToken(data.token);
            if (data.user?.userId) {
                localStorage.setItem('userId', data.user.userId);
            }
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
                details: data.error || 'login_failed',
                path: '/login',
            });
        }

        return data;
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
