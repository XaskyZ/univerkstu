import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    apiText,
    getToken,
    getUserId,
    getClientSessionId,
    setToken,
    removeToken,
    isAuthenticated,
    inferFeatureFromEndpoint,
} from './core';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

let localStorage: MemoryStorage;
let sessionStorage: MemoryStorage;

beforeEach(() => {
    localStorage = new MemoryStorage();
    sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('apiText', () => {
    it('defaults to Russian when no language stored', () => {
        const text = apiText();
        expect(text.language).toBe('ru');
        expect(text.requestError).toBe('Ошибка запроса');
        expect(text.timeout).toContain('Превышено');
        expect(text.networkError).toBe('Ошибка сети');
    });

    it('returns Russian for invalid stored value', () => {
        localStorage.setItem('app-language', 'xx');
        const text = apiText();
        expect(text.language).toBe('ru');
        expect(text.requestError).toBe('Ошибка запроса');
    });

    it('returns Kazakh strings when "kz" stored', () => {
        localStorage.setItem('app-language', 'kz');
        const text = apiText();
        expect(text.language).toBe('kz');
        expect(text.requestError).toBe('Сұрау қатесі');
        expect(text.networkError).toBe('Желі қатесі');
    });

    it('returns English strings when "en" stored', () => {
        localStorage.setItem('app-language', 'en');
        const text = apiText();
        expect(text.language).toBe('en');
        expect(text.requestError).toBe('Request failed');
        expect(text.networkError).toBe('Network error');
    });

    it('all three languages return the same set of keys', () => {
        const keys = new Set<string>();
        for (const lang of ['ru', 'kz', 'en']) {
            localStorage.setItem('app-language', lang);
            const text = apiText() as Record<string, unknown>;
            for (const k of Object.keys(text)) keys.add(k);
        }
        // Each language must produce the same shape — no missing keys.
        for (const lang of ['ru', 'kz', 'en']) {
            localStorage.setItem('app-language', lang);
            const text = apiText() as Record<string, unknown>;
            expect(new Set(Object.keys(text))).toEqual(keys);
        }
    });
});

describe('getToken', () => {
    it('returns null when no token stored', () => {
        expect(getToken()).toBe(null);
    });

    it('returns stored token', () => {
        localStorage.setItem('token', 'abc.def.ghi');
        expect(getToken()).toBe('abc.def.ghi');
    });
});

describe('getUserId', () => {
    it('returns null when no userId stored', () => {
        expect(getUserId()).toBe(null);
    });

    it('returns stored userId', () => {
        localStorage.setItem('userId', 'u123');
        expect(getUserId()).toBe('u123');
    });
});

describe('getClientSessionId', () => {
    it('generates and persists a session id on first call', () => {
        const id = getClientSessionId();
        expect(id).toBeTruthy();
        expect(typeof id).toBe('string');
        expect(sessionStorage.getItem('client_trace_session_id')).toBe(id);
    });

    it('returns the same id on subsequent calls', () => {
        const first = getClientSessionId();
        const second = getClientSessionId();
        expect(first).toBe(second);
    });

    it('uses existing id if already stored', () => {
        sessionStorage.setItem('client_trace_session_id', 'preset-id');
        expect(getClientSessionId()).toBe('preset-id');
    });
});

describe('setToken / isAuthenticated', () => {
    it('setToken writes to localStorage', () => {
        setToken('new-token');
        expect(localStorage.getItem('token')).toBe('new-token');
    });

    it('isAuthenticated returns true when token present', () => {
        setToken('something');
        expect(isAuthenticated()).toBe(true);
    });

    it('isAuthenticated returns false when no token', () => {
        expect(isAuthenticated()).toBe(false);
    });
});

describe('removeToken', () => {
    it('removes token and userId from localStorage', () => {
        localStorage.setItem('token', 't');
        localStorage.setItem('userId', 'u');
        removeToken();
        expect(localStorage.getItem('token')).toBe(null);
        expect(localStorage.getItem('userId')).toBe(null);
    });

    it('removes startup_bootstrap_meta_v1 from sessionStorage', () => {
        sessionStorage.setItem('startup_bootstrap_meta_v1', JSON.stringify({ foo: 'bar' }));
        removeToken();
        expect(sessionStorage.getItem('startup_bootstrap_meta_v1')).toBe(null);
    });

    it('removes all startup-prefetch:* keys from sessionStorage', () => {
        sessionStorage.setItem('startup-prefetch:schedule', 'x');
        sessionStorage.setItem('startup-prefetch:exams', 'y');
        sessionStorage.setItem('keep-me', 'z');
        removeToken();
        expect(sessionStorage.getItem('startup-prefetch:schedule')).toBe(null);
        expect(sessionStorage.getItem('startup-prefetch:exams')).toBe(null);
        expect(sessionStorage.getItem('keep-me')).toBe('z');
    });

    it('also removes the user identity even if startup keys are absent', () => {
        localStorage.setItem('token', 't');
        // No startup-prefetch keys exist
        expect(() => removeToken()).not.toThrow();
        expect(localStorage.getItem('token')).toBe(null);
    });
});

describe('inferFeatureFromEndpoint', () => {
    it('maps each /api/v3/<feature> prefix to its feature label', () => {
        // This is the analytics tag dispatch table — every api_error event downstream
        // is bucketed by these labels. Document the full mapping.
        expect(inferFeatureFromEndpoint('/api/v3/app/hydrate')).toBe('app');
        expect(inferFeatureFromEndpoint('/api/v3/academic/courses')).toBe('academic');
        expect(inferFeatureFromEndpoint('/api/v3/chat/messages')).toBe('chat');
        expect(inferFeatureFromEndpoint('/api/v3/referrals/code')).toBe('referrals');
        expect(inferFeatureFromEndpoint('/api/v3/schedule')).toBe('schedule');
        expect(inferFeatureFromEndpoint('/api/v3/exams')).toBe('exams');
        expect(inferFeatureFromEndpoint('/api/v3/umkd/list')).toBe('umkd');
        expect(inferFeatureFromEndpoint('/api/v3/profile')).toBe('profile');
        expect(inferFeatureFromEndpoint('/api/v3/support/tickets')).toBe('support');
        expect(inferFeatureFromEndpoint('/api/v3/platonus/login')).toBe('platonus');
        expect(inferFeatureFromEndpoint('/api/v3/group/CIT-23-1')).toBe('group');
        expect(inferFeatureFromEndpoint('/api/v3/auth/login')).toBe('auth');
    });

    it('falls back to "api" for unknown endpoints', () => {
        expect(inferFeatureFromEndpoint('/api/v3/unknown-feature')).toBe('api');
        expect(inferFeatureFromEndpoint('/api/v4/future')).toBe('api');
        expect(inferFeatureFromEndpoint('/something-else')).toBe('api');
        expect(inferFeatureFromEndpoint('')).toBe('api');
    });

    it('matches by prefix not by substring (avoid "/api/v3/notgroup" being labeled "group")', () => {
        // The check is startsWith, so a hypothetical longer prefix like `/api/v3/groupless`
        // would still match 'group'. Documenting that explicitly so adding a new feature
        // prefix that happens to start with an existing one (e.g. 'group-foo') won't go unnoticed.
        expect(inferFeatureFromEndpoint('/api/v3/groupless')).toBe('group');
        // But entirely unrelated paths fall to 'api':
        expect(inferFeatureFromEndpoint('/v3/group')).toBe('api'); // missing /api/ prefix
    });

    it('respects exact prefix match (handles query strings & trailing path segments)', () => {
        expect(inferFeatureFromEndpoint('/api/v3/profile?force=true')).toBe('profile');
        expect(inferFeatureFromEndpoint('/api/v3/schedule/refresh')).toBe('schedule');
        expect(inferFeatureFromEndpoint('/api/v3/group/CIT-23-1/members')).toBe('group');
    });
});
