import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'crypto';

// In-memory shim over the subset of SQL app_user_sessions uses. Dispatch is by
// leading SQL text, so the fragments here must stay in sync with sessions.ts.

interface SessionRow {
    session_id: string;
    user_id: string;
    token_hash: string;
    device_name: string | null;
    user_agent: string | null;
    ip: string | null;
    platform: string | null;
    browser: string | null;
    created_at: Date;
    last_active_at: Date;
    revoked_at: Date | null;
}

const store: SessionRow[] = [];

// Управление «здоровьем» БД: реальный withSupabasePostgres при отсутствии пула
// или при любой ошибке запроса возвращает null, а НЕ бросает. Шим повторяет это
// поведение — на нём и держится вся проверка fail-open.
const dbState = { available: true, throwOnQuery: false };

let queryCalls = 0;

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function seedSession(token: string, opts: { userId?: string; sessionId?: string; revoked?: boolean } = {}): SessionRow {
    const row: SessionRow = {
        session_id: opts.sessionId ?? `sess-${store.length + 1}`,
        user_id: opts.userId ?? 'S123',
        token_hash: sha256(token),
        device_name: 'Windows · Chrome',
        user_agent: 'ua',
        ip: '127.0.0.1',
        platform: 'Windows',
        browser: 'Chrome',
        created_at: new Date('2026-01-01T00:00:00Z'),
        last_active_at: new Date('2026-01-01T00:00:00Z'),
        revoked_at: opts.revoked ? new Date('2026-01-02T00:00:00Z') : null,
    };
    store.push(row);
    return row;
}

function normalize(sql: string): string {
    return sql.trim().toLowerCase().replace(/\s+/g, ' ');
}

const fakeClient = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
        queryCalls += 1;
        if (dbState.throwOnQuery) throw new Error('connection terminated unexpectedly');
        const text = normalize(sql);

        if (text.startsWith('select revoked_at from app_user_sessions where token_hash')) {
            const [tokenHash] = params as [string];
            const row = store.find((r) => r.token_hash === tokenHash);
            return { rows: row ? [{ revoked_at: row.revoked_at }] : [], rowCount: row ? 1 : 0 };
        }

        if (text.startsWith('select * from app_user_sessions where user_id')) {
            const [userId] = params as [string];
            const rows = store
                .filter((r) => r.user_id === userId && r.revoked_at === null)
                .sort((a, b) => b.last_active_at.getTime() - a.last_active_at.getTime());
            return { rows, rowCount: rows.length };
        }

        if (text.startsWith('insert into app_user_sessions')) {
            const [sessionId, userId, tokenHash, deviceName, ua, ip, platform, browser, now] =
                params as [string, string, string, string | null, string | null, string | null, string | null, string | null, Date];
            const row: SessionRow = {
                session_id: sessionId,
                user_id: userId,
                token_hash: tokenHash,
                device_name: deviceName,
                user_agent: ua,
                ip,
                platform,
                browser,
                created_at: now,
                last_active_at: now,
                revoked_at: null,
            };
            store.push(row);
            return { rows: [row], rowCount: 1 };
        }

        if (text.startsWith('update app_user_sessions set last_active_at')) {
            const [tokenHash] = params as [string];
            const hits = store.filter((r) => r.token_hash === tokenHash && r.revoked_at === null);
            for (const row of hits) row.last_active_at = new Date('2026-06-01T00:00:00Z');
            return { rows: [], rowCount: hits.length };
        }

        if (text.startsWith('update app_user_sessions set revoked_at = now() where session_id')) {
            const [sessionId, userId] = params as [string, string];
            const hits = store.filter(
                (r) => r.session_id === sessionId && r.user_id === userId && r.revoked_at === null
            );
            for (const row of hits) row.revoked_at = new Date('2026-06-01T00:00:00Z');
            return { rows: hits.map((r) => ({ token_hash: r.token_hash })), rowCount: hits.length };
        }

        if (text.startsWith('update app_user_sessions set revoked_at = now() where user_id')) {
            const [userId, currentHash] = params as [string, string];
            const hits = store.filter(
                (r) => r.user_id === userId && r.token_hash !== currentHash && r.revoked_at === null
            );
            for (const row of hits) row.revoked_at = new Date('2026-06-01T00:00:00Z');
            return { rows: hits.map((r) => ({ token_hash: r.token_hash })), rowCount: hits.length };
        }

        if (text.startsWith('update app_user_sessions set revoked_at = now() where token_hash')) {
            const [tokenHash] = params as [string];
            const hits = store.filter((r) => r.token_hash === tokenHash && r.revoked_at === null);
            for (const row of hits) row.revoked_at = new Date('2026-06-01T00:00:00Z');
            return { rows: [], rowCount: hits.length };
        }

        throw new Error(`Unmocked SQL: ${sql}`);
    }),
};

vi.mock('../db/postgres.js', () => ({
    withSupabasePostgres: vi.fn(async (handler: (client: typeof fakeClient) => Promise<unknown>) => {
        // Нет пула — обёртка отдаёт null, не бросая.
        if (!dbState.available) return null;
        try {
            return await handler(fakeClient);
        } catch {
            // Реальная обёртка ловит ошибку запроса и тоже возвращает null.
            return null;
        }
    }),
}));

import {
    parsePlatform,
    parseBrowser,
    buildDeviceName,
    getSessionTokenStatus,
    isSessionRevoked,
    resetSessionStatusCache,
    ensureSessionExists,
    createUserSession,
    revokeUserSession,
    revokeAllOtherSessions,
    revokeCurrentSession,
    getUserSessionsWithCurrent,
} from './sessions.js';

describe('parsePlatform', () => {
    it('returns null for empty input', () => {
        expect(parsePlatform('')).toBe(null);
    });

    it('detects iPhone', () => {
        expect(parsePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
    });

    it('detects iPad', () => {
        expect(parsePlatform('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)')).toBe('iPad');
    });

    it('detects Android (not iOS)', () => {
        expect(parsePlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)')).toBe('Android');
    });

    it('detects Windows', () => {
        expect(parsePlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Windows');
    });

    it('detects macOS via "Macintosh"', () => {
        expect(parsePlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)')).toBe('macOS');
    });

    it('detects macOS via "Mac OS X" without "Macintosh"', () => {
        expect(parsePlatform('Some/UA Mac OS X 14_0')).toBe('macOS');
    });

    it('detects Linux (not Android-flavored)', () => {
        // Plain Linux desktop — no "Android" in UA.
        expect(parsePlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('Linux');
    });

    it('Android takes precedence over the bare Linux substring it contains', () => {
        // Real Android UAs include "Linux" — Android branch must win because it comes first.
        expect(parsePlatform('Mozilla/5.0 (Linux; Android 14)')).toBe('Android');
    });

    it('iPhone takes precedence over Mac OS X substring inside iOS UA', () => {
        // iOS UAs include "like Mac OS X" — iPhone branch must win because it comes first.
        expect(parsePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('iPhone');
    });

    it('returns null for unrecognized UA', () => {
        expect(parsePlatform('Mozilla/5.0 (Compatible; SomeBot/1.0)')).toBe(null);
    });
});

describe('parseBrowser', () => {
    it('returns null for empty input', () => {
        expect(parseBrowser('')).toBe(null);
    });

    it('detects Edge via Edg/', () => {
        expect(parseBrowser('Mozilla/5.0 Chrome/120 Edg/120')).toBe('Edge');
    });

    it('detects Opera via OPR/', () => {
        expect(parseBrowser('Mozilla/5.0 Chrome/120 OPR/100')).toBe('Opera');
    });

    it('detects YaBrowser before Chrome', () => {
        // YaBrowser UA contains Chrome — YaBrowser branch must win.
        expect(parseBrowser('Mozilla/5.0 Chrome/120 YaBrowser/24.0')).toBe('Яндекс');
    });

    it('detects SamsungBrowser before Chrome', () => {
        expect(parseBrowser('Mozilla/5.0 SamsungBrowser/23.0 Chrome/115')).toBe('Samsung');
    });

    it('detects plain Chrome (after specific Chrome-based clients)', () => {
        expect(parseBrowser('Mozilla/5.0 Chrome/120')).toBe('Chrome');
    });

    it('detects Firefox', () => {
        expect(parseBrowser('Mozilla/5.0 Firefox/120')).toBe('Firefox');
    });

    it('detects Safari (when not Chrome)', () => {
        expect(parseBrowser('Mozilla/5.0 Safari/605')).toBe('Safari');
    });

    it('returns null for unrecognized UA', () => {
        expect(parseBrowser('Mozilla/5.0 (Compatible; SomeBot/1.0)')).toBe(null);
    });

    it('Edge wins over Chrome despite Chrome substring in UA', () => {
        expect(parseBrowser('Mozilla/5.0 (Windows NT 10) Chrome/120 Edg/120')).toBe('Edge');
    });
});

describe('buildDeviceName', () => {
    it('joins platform and browser with " · "', () => {
        expect(buildDeviceName('iPhone', 'Safari')).toBe('iPhone · Safari');
    });

    it('returns platform alone when browser missing', () => {
        expect(buildDeviceName('Windows', null)).toBe('Windows');
    });

    it('returns browser alone when platform missing', () => {
        expect(buildDeviceName(null, 'Chrome')).toBe('Chrome');
    });

    it('returns Russian "Неизвестное устройство" fallback when both missing', () => {
        expect(buildDeviceName(null, null)).toBe('Неизвестное устройство');
    });
});

// ---------------------------------------------------------------------------
// Отзыв сессий. До фикса отозванный токен продолжал работать, а /auth/verify
// воскрешал его строку — устройство возвращалось в список. Здесь закрепляем,
// что отказ происходит ТОЛЬКО по явному revoked_at и никогда по «нет строки»
// или «БД недоступна».
// ---------------------------------------------------------------------------

describe('session revocation', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        store.length = 0;
        dbState.available = true;
        dbState.throwOnQuery = false;
        queryCalls = 0;
        resetSessionStatusCache();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    describe('getSessionTokenStatus', () => {
        it('returns "active" for a live session row', async () => {
            seedSession('tok-active');
            expect(await getSessionTokenStatus('tok-active')).toBe('active');
        });

        it('returns "revoked" for an explicitly revoked row', async () => {
            seedSession('tok-revoked', { revoked: true });
            expect(await getSessionTokenStatus('tok-revoked')).toBe('revoked');
        });

        it('returns "absent" when there is no row at all (legacy token)', async () => {
            expect(await getSessionTokenStatus('tok-legacy')).toBe('absent');
        });

        it('returns "unknown" when the pool is unavailable', async () => {
            seedSession('tok-active');
            dbState.available = false;
            expect(await getSessionTokenStatus('tok-active')).toBe('unknown');
        });

        it('returns "unknown" when the query throws', async () => {
            seedSession('tok-active');
            dbState.throwOnQuery = true;
            expect(await getSessionTokenStatus('tok-active')).toBe('unknown');
        });

        it('never caches "unknown" — recovers as soon as the DB is back', async () => {
            seedSession('tok-active');
            dbState.available = false;
            expect(await getSessionTokenStatus('tok-active')).toBe('unknown');
            dbState.available = true;
            expect(await getSessionTokenStatus('tok-active')).toBe('active');
        });

        it('caches a known result so repeat requests skip Postgres', async () => {
            seedSession('tok-active');
            expect(await getSessionTokenStatus('tok-active')).toBe('active');
            const afterFirst = queryCalls;
            expect(await getSessionTokenStatus('tok-active')).toBe('active');
            expect(await getSessionTokenStatus('tok-active')).toBe('active');
            expect(queryCalls).toBe(afterFirst);
        });

        it('revoking in-process invalidates the cached "active" immediately', async () => {
            const row = seedSession('tok-active', { sessionId: 'sess-A', userId: 'S123' });
            expect(await getSessionTokenStatus('tok-active')).toBe('active');
            expect(await revokeUserSession('S123', row.session_id)).toBe(true);
            // Без немедленной инвалидации отзыв ждал бы протухания кэша.
            expect(await getSessionTokenStatus('tok-active')).toBe('revoked');
        });
    });

    describe('isSessionRevoked', () => {
        it('is true only for a confirmed revoked row', async () => {
            seedSession('tok-revoked', { revoked: true });
            expect(await isSessionRevoked('tok-revoked')).toBe(true);
        });

        it('is false for an active row', async () => {
            seedSession('tok-active');
            expect(await isSessionRevoked('tok-active')).toBe(false);
        });

        it('is false when no row exists (legacy tokens keep working)', async () => {
            expect(await isSessionRevoked('tok-legacy')).toBe(false);
        });

        it('is false when the DB is down (fail open, no mass logout)', async () => {
            seedSession('tok-revoked', { revoked: true });
            dbState.available = false;
            resetSessionStatusCache();
            expect(await isSessionRevoked('tok-revoked')).toBe(false);
        });
    });

    describe('ensureSessionExists', () => {
        it('backfills a row when none exists (tokens issued before the feature)', async () => {
            await ensureSessionExists({ userId: 'S123', token: 'tok-legacy', userAgent: 'ua', ip: '1.1.1.1' });
            const row = store.find((r) => r.token_hash === sha256('tok-legacy'));
            expect(row).toBeDefined();
            expect(row?.user_id).toBe('S123');
            expect(row?.revoked_at).toBeNull();
        });

        it('touches an existing active row instead of inserting a duplicate', async () => {
            seedSession('tok-active');
            await ensureSessionExists({ userId: 'S123', token: 'tok-active' });
            expect(store.filter((r) => r.token_hash === sha256('tok-active'))).toHaveLength(1);
            expect(store[0].last_active_at.toISOString()).toBe('2026-06-01T00:00:00.000Z');
        });

        it('does NOT resurrect a revoked row', async () => {
            seedSession('tok-revoked', { revoked: true });
            await ensureSessionExists({ userId: 'S123', token: 'tok-revoked' });
            const rows = store.filter((r) => r.token_hash === sha256('tok-revoked'));
            expect(rows).toHaveLength(1);
            expect(rows[0].revoked_at).not.toBeNull();
            expect(await getSessionTokenStatus('tok-revoked')).toBe('revoked');
        });

        it('inserts nothing when the DB is unavailable', async () => {
            dbState.available = false;
            await ensureSessionExists({ userId: 'S123', token: 'tok-legacy' });
            expect(store).toHaveLength(0);
        });
    });

    describe('revoke helpers', () => {
        it('createUserSession primes the cache as active', async () => {
            await createUserSession({ userId: 'S123', token: 'tok-new', userAgent: 'ua', ip: null });
            const before = queryCalls;
            expect(await getSessionTokenStatus('tok-new')).toBe('active');
            expect(queryCalls).toBe(before);
        });

        it('revokeUserSession returns false when nothing matched', async () => {
            seedSession('tok-active', { sessionId: 'sess-A', userId: 'S123' });
            expect(await revokeUserSession('OTHER', 'sess-A')).toBe(false);
            expect(await getSessionTokenStatus('tok-active')).toBe('active');
        });

        it('revokeUserSession hides the device from the list afterwards', async () => {
            const row = seedSession('tok-active', { sessionId: 'sess-A', userId: 'S123' });
            expect(await revokeUserSession('S123', row.session_id)).toBe(true);
            expect(await getUserSessionsWithCurrent('S123', 'tok-active')).toHaveLength(0);
        });

        it('revokeAllOtherSessions revokes every token but the current one', async () => {
            seedSession('tok-current', { sessionId: 'sess-A', userId: 'S123' });
            seedSession('tok-other-1', { sessionId: 'sess-B', userId: 'S123' });
            seedSession('tok-other-2', { sessionId: 'sess-C', userId: 'S123' });
            expect(await revokeAllOtherSessions('S123', 'tok-current')).toBe(2);
            expect(await getSessionTokenStatus('tok-current')).toBe('active');
            expect(await getSessionTokenStatus('tok-other-1')).toBe('revoked');
            expect(await getSessionTokenStatus('tok-other-2')).toBe('revoked');
        });

        it('revokeCurrentSession (logout) marks the token revoked', async () => {
            seedSession('tok-active', { sessionId: 'sess-A', userId: 'S123' });
            await revokeCurrentSession('tok-active');
            expect(await getSessionTokenStatus('tok-active')).toBe('revoked');
        });

        it('revokeCurrentSession does not cache "revoked" for a token with no row', async () => {
            // Иначе кэш начал бы расходиться с БД и мог бы отказать легаси-токену.
            await revokeCurrentSession('tok-legacy');
            expect(await getSessionTokenStatus('tok-legacy')).toBe('absent');
        });
    });
});
