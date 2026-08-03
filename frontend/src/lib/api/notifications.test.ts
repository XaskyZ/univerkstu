/**
 * Smoke tests for the per-kind notification preferences API client. Verifies
 * URL/method/body construction and ApiResponse mapping for GET + PUT, plus the
 * `isKindEnabled` default-on helper that the UI relies on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getNotificationPrefs,
    isKindEnabled,
    setNotificationPrefs,
    SOCIAL_NOTIFICATION_KINDS,
} from './notifications';
import { API_URL } from './core';

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
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
    const status = init.status ?? 200;
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: {
            get: (name: string) => init.headers?.[name] ?? null,
        },
        json: async () => body,
    } as unknown as Response;
}

beforeEach(() => {
    localStorage = new MemoryStorage();
    sessionStorage = new MemoryStorage();
    vi.stubGlobal('window', { localStorage, sessionStorage });
    vi.stubGlobal('localStorage', localStorage);
    vi.stubGlobal('sessionStorage', sessionStorage);
    vi.stubGlobal('crypto', { randomUUID: () => 'test-session-uuid' });
    fetchMock = vi.fn(async () => jsonResponse({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('getNotificationPrefs', () => {
    it('GETs /api/v3/notifications/kind-prefs and unwraps the data envelope', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: true,
            data: {
                userId: 'alice',
                enabledKinds: { social_mention: false },
                updatedAt: 'x', createdAt: 'x',
            },
        }));
        const result = await getNotificationPrefs();
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.prefs.userId).toBe('alice');
            expect(result.prefs.enabledKinds).toEqual({ social_mention: false });
        }
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${API_URL}/api/v3/notifications/kind-prefs`);
        expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
    });

    it('reports ok=false when the response envelope says success=false', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse({
            success: false,
            error: 'nope',
        }, { status: 200 }));
        const result = await getNotificationPrefs();
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).toBe('nope');
        }
    });
});

describe('setNotificationPrefs', () => {
    it('PUTs the enabledKinds payload', async () => {
        // 204 No Content — body parse will fail, fetchWithAuth still returns success.
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 204,
            headers: { get: () => null },
            json: async () => { throw new Error('no body'); },
        } as unknown as Response);
        const result = await setNotificationPrefs({ social_dm: false });
        expect(result.ok).toBe(true);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${API_URL}/api/v3/notifications/kind-prefs`);
        expect((init.method ?? '').toUpperCase()).toBe('PUT');
        expect(JSON.parse(String(init.body))).toEqual({
            enabledKinds: { social_dm: false },
        });
    });

    it('returns ok=false on a 4xx with error envelope', async () => {
        fetchMock.mockResolvedValueOnce(jsonResponse(
            { error: 'bad', errorCode: 'PUSH_KIND_PREFS_VALIDATION' },
            { status: 400 },
        ));
        const result = await setNotificationPrefs({ social_dm: false });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.message).toBe('bad');
        }
    });
});

describe('isKindEnabled', () => {
    it('returns true when prefs are null (still loading)', () => {
        expect(isKindEnabled(null, 'social_mention')).toBe(true);
    });

    it('returns true when the kind key is absent (default-on)', () => {
        expect(isKindEnabled(
            { userId: 'a', enabledKinds: {}, updatedAt: 'x', createdAt: 'x' },
            'social_mention',
        )).toBe(true);
    });

    it('returns false for an explicit opt-out', () => {
        expect(isKindEnabled(
            { userId: 'a', enabledKinds: { social_mention: false }, updatedAt: 'x', createdAt: 'x' },
            'social_mention',
        )).toBe(false);
    });

    it('returns true for an explicit opt-in', () => {
        expect(isKindEnabled(
            { userId: 'a', enabledKinds: { social_mention: true }, updatedAt: 'x', createdAt: 'x' },
            'social_mention',
        )).toBe(true);
    });

    it('covers every social kind via the exported tuple', () => {
        for (const kind of SOCIAL_NOTIFICATION_KINDS) {
            // Every kind must be a string in the typed enum — sanity check.
            expect(typeof kind).toBe('string');
        }
    });
});
