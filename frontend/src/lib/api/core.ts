/**
 * Core API helpers: shared response shape, fetchWithAuth, token + session-id storage,
 * authenticated status check. Imported by every domain-specific api module.
 */
import { trackAnalyticsEvent } from '../analytics';
import { API_BASE_URL } from '../api-base';

const CLIENT_SESSION_ID_KEY = 'client_trace_session_id';
const LANGUAGE_STORAGE_KEY = 'app-language';
const IS_DEV = process.env.NODE_ENV !== 'production';

export type AppLanguage = 'ru' | 'kz' | 'en';

export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    errorCode?: string;
    statusCode?: number;
    cached?: boolean;
    cacheAge?: number;
    stale?: boolean;
}

export const API_URL = API_BASE_URL;

export function inferFeatureFromEndpoint(endpoint: string): string {
    if (endpoint.startsWith('/api/v3/app')) return 'app';
    if (endpoint.startsWith('/api/v3/academic')) return 'academic';
    if (endpoint.startsWith('/api/v3/chat')) return 'chat';
    if (endpoint.startsWith('/api/v3/referrals')) return 'referrals';
    if (endpoint.startsWith('/api/v3/schedule')) return 'schedule';
    if (endpoint.startsWith('/api/v3/exams')) return 'exams';
    if (endpoint.startsWith('/api/v3/umkd')) return 'umkd';
    if (endpoint.startsWith('/api/v3/profile')) return 'profile';
    if (endpoint.startsWith('/api/v3/support')) return 'support';
    if (endpoint.startsWith('/api/v3/platonus')) return 'platonus';
    if (endpoint.startsWith('/api/v3/group')) return 'group';
    if (endpoint.startsWith('/api/v3/auth')) return 'auth';
    return 'api';
}

function getCurrentLanguage(): AppLanguage {
    if (typeof window === 'undefined') return 'ru';
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === 'kz' || stored === 'en' || stored === 'ru' ? stored : 'ru';
}

export function apiText() {
    const language = getCurrentLanguage();
    return {
        language,
        requestError: language === 'en' ? 'Request failed' : language === 'kz' ? 'Сұрау қатесі' : 'Ошибка запроса',
        timeout: language === 'en' ? 'Request timed out. The server did not respond.' : language === 'kz' ? 'Күту уақыты аяқталды. Сервер жауап бермеді.' : 'Превышено время ожидания. Сервер не ответил.',
        serverUnavailable: language === 'en' ? 'Server is unavailable. Check your internet connection.' : language === 'kz' ? 'Сервер қолжетімсіз. Интернет байланысын тексеріңіз.' : 'Сервер недоступен. Проверьте интернет-соединение.',
        networkError: language === 'en' ? 'Network error' : language === 'kz' ? 'Желі қатесі' : 'Ошибка сети',
        unknownError: language === 'en' ? 'unknown error' : language === 'kz' ? 'белгісіз қате' : 'неизвестная ошибка',
        cannotConnect: language === 'en' ? 'Could not connect to the server. Check your internet or try again later.' : language === 'kz' ? 'Серверге қосылу мүмкін болмады. Интернетті тексеріңіз немесе кейінірек қайталап көріңіз.' : 'Не удалось подключиться к серверу. Проверьте интернет или попробуйте позже.',
        serverUnavailableShort: language === 'en' ? 'Server unavailable' : language === 'kz' ? 'Сервер қолжетімсіз' : 'Сервер недоступен',
    };
}

export function getToken(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('token');
}

export function getUserId(): string | null {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem('userId');
}

export function getClientSessionId(): string | null {
    if (typeof window === 'undefined') return null;
    const existing = sessionStorage.getItem(CLIENT_SESSION_ID_KEY);
    if (existing) return existing;

    const generated = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    sessionStorage.setItem(CLIENT_SESSION_ID_KEY, generated);
    return generated;
}

export function setToken(token: string): void {
    localStorage.setItem('token', token);
}

export function removeToken(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    if (typeof window !== 'undefined') {
        sessionStorage.removeItem('startup_bootstrap_meta_v1');
        const keysToRemove: string[] = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (key?.startsWith('startup-prefetch:')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach((key) => sessionStorage.removeItem(key));
    }
}

export function isAuthenticated(): boolean {
    return !!getToken();
}

export async function fetchWithAuth<T>(
    endpoint: string,
    options: RequestInit = {},
    timeoutMs: number = 30000,
): Promise<ApiResponse<T>> {
    const text = apiText();
    const token = getToken();

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        (headers as Record<string, string>)['Authorization'] = `Bearer ${token}`;
    }
    const clientSessionId = getClientSessionId();
    if (clientSessionId) {
        (headers as Record<string, string>)['X-Client-Session-Id'] = clientSessionId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${API_URL}${endpoint}`, {
            ...options,
            headers,
            signal: controller.signal,
            credentials: options.credentials ?? 'include',
        });

        clearTimeout(timeout);

        const renewedToken = response.headers.get('X-Renewed-Token');
        if (renewedToken) {
            if (IS_DEV) {
                console.log('[API] Token auto-renewed by server');
            }
            setToken(renewedToken);
        }

        let data: { error?: string; message?: string; errorCode?: string } | null = null;
        try {
            data = await response.json();
        } catch {
            data = null;
        }

        if (!response.ok) {
            trackAnalyticsEvent('api_error', {
                feature: inferFeatureFromEndpoint(endpoint),
                status: String(response.status),
                details: `${options.method || 'GET'} ${endpoint}`,
            });
            return {
                success: false,
                error: data?.error || data?.message || text.requestError,
                errorCode: data?.errorCode,
                statusCode: response.status,
            };
        }

        return {
            ...(data as ApiResponse<T>),
            success: Boolean((data as ApiResponse<T> | null)?.success ?? true),
            statusCode: response.status,
        };
    } catch (error: unknown) {
        clearTimeout(timeout);
        const isAbortError = error instanceof Error && error.name === 'AbortError';
        if (IS_DEV && !isAbortError) {
            console.error('[API] Fetch error:', error);
        }

        if (isAbortError) {
            trackAnalyticsEvent('api_error', {
                feature: inferFeatureFromEndpoint(endpoint),
                status: 'timeout',
                details: `${options.method || 'GET'} ${endpoint}`,
            });
            return { success: false, error: text.timeout, statusCode: 0 };
        }
        if (error instanceof TypeError && error.message === 'Failed to fetch') {
            trackAnalyticsEvent('api_error', {
                feature: inferFeatureFromEndpoint(endpoint),
                status: 'network',
                details: `${options.method || 'GET'} ${endpoint}`,
            });
            return { success: false, error: text.serverUnavailable, statusCode: 0 };
        }
        trackAnalyticsEvent('api_error', {
            feature: inferFeatureFromEndpoint(endpoint),
            status: 'client_exception',
            details: `${options.method || 'GET'} ${endpoint}`,
        });
        return {
            success: false,
            error: `${text.networkError}: ${error instanceof Error ? error.message : text.unknownError}`,
            statusCode: 0,
        };
    }
}
