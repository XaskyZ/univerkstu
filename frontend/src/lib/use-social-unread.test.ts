/**
 * Unit tests for the pure helpers behind `useSocialUnread`. The React side is
 * exercised in integration via DialogsPanel (per project test conventions:
 * skip React hooks in unit tests). Here we cover:
 *
 *   - `buildCountsMap` — server-shape → Map projection, edge values
 *   - `formatUnreadBadge` — 99+ cap, falsy handling
 *   - API client `getSocialUnreadCounts` URL shape (querystring + dedup)
 *   - API client `markScopeAsRead` body shape (omits lastEntityId when absent)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCountsMap, formatUnreadBadge } from './use-social-unread';
import {
    getSocialUnreadCounts,
    markScopeAsRead,
} from './api/social';
import { API_URL } from './api/core';

class MemoryStorage {
    private store = new Map<string, string>();
    getItem(key: string): string | null { return this.store.has(key) ? this.store.get(key)! : null; }
    setItem(key: string, value: string): void { this.store.set(key, value); }
    removeItem(key: string): void { this.store.delete(key); }
    clear(): void { this.store.clear(); }
    get length(): number { return this.store.size; }
    key(index: number): string | null { return Array.from(this.store.keys())[index] ?? null; }
}

let localStorageRef: MemoryStorage;
let sessionStorageRef: MemoryStorage;
let fetchMock: ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
    const status = init.status ?? 200;
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => init.headers?.[name] ?? null },
        json: async () => body,
    } as unknown as Response;
}

beforeEach(() => {
    localStorageRef = new MemoryStorage();
    sessionStorageRef = new MemoryStorage();
    vi.stubGlobal('window', { localStorage: localStorageRef, sessionStorage: sessionStorageRef });
    vi.stubGlobal('localStorage', localStorageRef);
    vi.stubGlobal('sessionStorage', sessionStorageRef);
    vi.stubGlobal('crypto', { randomUUID: () => 'test-session-uuid' });
    fetchMock = vi.fn(async () => jsonResponse({ success: true, data: { counts: {} } }));
    vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('buildCountsMap', () => {
    it('projects server-shape into a Map', () => {
        const m = buildCountsMap({ 'dm:r1': 3, 'dm:r2': 1 });
        expect(m.get('dm:r1')).toBe(3);
        expect(m.get('dm:r2')).toBe(1);
        expect(m.size).toBe(2);
    });

    it('drops zero / negative / NaN entries', () => {
        const m = buildCountsMap({ a: 0, b: -1, c: Number.NaN, d: 5 });
        expect(m.has('a')).toBe(false);
        expect(m.has('b')).toBe(false);
        expect(m.has('c')).toBe(false);
        expect(m.get('d')).toBe(5);
    });

    it('floors fractional counts (defensive)', () => {
        const m = buildCountsMap({ a: 2.9 });
        expect(m.get('a')).toBe(2);
    });

    it('returns empty map for null / undefined', () => {
        expect(buildCountsMap(null).size).toBe(0);
        expect(buildCountsMap(undefined).size).toBe(0);
    });
});

describe('formatUnreadBadge', () => {
    it('returns null for 0 / negative / NaN / undefined', () => {
        expect(formatUnreadBadge(0)).toBeNull();
        expect(formatUnreadBadge(-3)).toBeNull();
        expect(formatUnreadBadge(Number.NaN)).toBeNull();
        expect(formatUnreadBadge(undefined)).toBeNull();
        expect(formatUnreadBadge(null)).toBeNull();
    });

    it('formats small numbers verbatim', () => {
        expect(formatUnreadBadge(1)).toBe('1');
        expect(formatUnreadBadge(42)).toBe('42');
        expect(formatUnreadBadge(99)).toBe('99');
    });

    it('caps at 99+ for big numbers', () => {
        expect(formatUnreadBadge(100)).toBe('99+');
        expect(formatUnreadBadge(9999)).toBe('99+');
    });
});

describe('getSocialUnreadCounts', () => {
    it('returns an empty-data response without network call for empty scopes', async () => {
        const res = await getSocialUnreadCounts([]);
        expect(res).toEqual({ success: true, data: { counts: {} } });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('builds the expected querystring and dedups input scopes', async () => {
        await getSocialUnreadCounts(['dm:r1', 'dm:r1', 'dm:r2']);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url] = fetchMock.mock.calls[0] as [string];
        const u = new URL(url, API_URL);
        expect(u.pathname).toBe('/api/v3/social/unread');
        expect(u.searchParams.get('scopes')).toBe('dm:r1,dm:r2');
    });

    it('surfaces the parsed json response', async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ success: true, data: { counts: { 'dm:r1': 4 } } }),
        );
        const res = await getSocialUnreadCounts(['dm:r1']);
        expect(res.success).toBe(true);
        expect(res.data).toEqual({ counts: { 'dm:r1': 4 } });
    });
});

describe('markScopeAsRead', () => {
    it('posts JSON body with scopeType + scopeId (no lastEntityId when omitted)', async () => {
        await markScopeAsRead('dm', 'room-1');
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain('/api/v3/social/read');
        expect(init.method).toBe('POST');
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body).toEqual({ scopeType: 'dm', scopeId: 'room-1' });
    });

    it('includes lastEntityId when provided', async () => {
        await markScopeAsRead('dm', 'room-1', 'entity-42');
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body).toEqual({ scopeType: 'dm', scopeId: 'room-1', lastEntityId: 'entity-42' });
    });

    it('omits lastEntityId when explicitly empty string', async () => {
        await markScopeAsRead('dm', 'room-1', '');
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        const body = JSON.parse(init.body as string) as Record<string, unknown>;
        expect(body.lastEntityId).toBeUndefined();
    });
});
