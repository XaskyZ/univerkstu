/**
 * Сервис управления пользовательскими сессиями (устройствами)
 */

import { createHash, randomUUID } from 'crypto';
import { withSupabasePostgres } from '../db/postgres.js';

export interface UserSession {
    sessionId: string;
    userId: string;
    deviceName: string | null;
    userAgent: string | null;
    ip: string | null;
    platform: string | null;
    browser: string | null;
    createdAt: Date;
    lastActiveAt: Date;
    revokedAt: Date | null;
    isCurrent?: boolean;
}

function hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
}

/**
 * Статус токена в таблице сессий.
 *  - active  — строка есть и не отозвана
 *  - absent  — строки нет вообще (старый токен, выпущенный до фичи сессий)
 *  - revoked — строка есть и явно отозвана пользователем
 *  - unknown — статус прочитать не удалось (Postgres недоступен и т.п.)
 *
 * ВАЖНО: отказывать в доступе можно ТОЛЬКО по 'revoked'. 'absent' — это
 * легитимный backfill-путь, 'unknown' — авария инфраструктуры; ни то, ни другое
 * не должно превращаться в массовый разлогин.
 */
export type SessionTokenStatus = 'active' | 'absent' | 'revoked' | 'unknown';

type KnownSessionTokenStatus = Exclude<SessionTokenStatus, 'unknown'>;

/**
 * Проверка статуса выполняется на КАЖДОМ авторизованном запросе, поэтому
 * достоверно прочитанный результат кэшируется в памяти процесса на 30 секунд.
 *
 * Задержка отзыва: отзыв, выполненный этим же процессом (revokeUserSession /
 * revokeAllOtherSessions / revokeCurrentSession), сразу пишет 'revoked' в кэш —
 * то есть действует мгновенно. Если бэкенд когда-нибудь поднимут в несколько
 * инстансов, отзыв, сделанный на другом инстансе, вступит в силу здесь не
 * позднее чем через SESSION_STATUS_TTL_MS.
 */
const SESSION_STATUS_TTL_MS = 30_000;
const SESSION_STATUS_MAX_ENTRIES = 10_000;

const sessionStatusCache = new Map<string, { status: KnownSessionTokenStatus; expiresAt: number }>();

function readStatusCache(tokenHash: string): KnownSessionTokenStatus | null {
    const hit = sessionStatusCache.get(tokenHash);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
        sessionStatusCache.delete(tokenHash);
        return null;
    }
    return hit.status;
}

function writeStatusCache(tokenHash: string, status: KnownSessionTokenStatus): void {
    if (!sessionStatusCache.has(tokenHash) && sessionStatusCache.size >= SESSION_STATUS_MAX_ENTRIES) {
        const now = Date.now();
        for (const [key, value] of sessionStatusCache) {
            if (value.expiresAt <= now) sessionStatusCache.delete(key);
        }
        // Если протухшего не нашлось — сбрасываем целиком. Худшее последствие
        // сброса — лишний поход в Postgres, а не ошибочный отказ в доступе.
        if (sessionStatusCache.size >= SESSION_STATUS_MAX_ENTRIES) sessionStatusCache.clear();
    }
    sessionStatusCache.set(tokenHash, { status, expiresAt: Date.now() + SESSION_STATUS_TTL_MS });
}

/** Сброс кэша статусов (тесты, ручная инвалидация). */
export function resetSessionStatusCache(): void {
    sessionStatusCache.clear();
}

/**
 * Прочитать статус токена. Никогда не бросает: любая ошибка — это 'unknown'.
 */
export async function getSessionTokenStatus(token: string): Promise<SessionTokenStatus> {
    try {
        const tokenHash = hashToken(token);
        const cached = readStatusCache(tokenHash);
        if (cached) return cached;

        const lookup = await withSupabasePostgres(async (client) => {
            const res = await client.query<{ revoked_at: Date | null }>(
                `select revoked_at from app_user_sessions where token_hash = $1 limit 1`,
                [tokenHash]
            );
            const row = res.rows[0];
            return { found: Boolean(row), revoked: Boolean(row?.revoked_at) };
        });

        // withSupabasePostgres глотает ошибки и возвращает null. Для нас это
        // «не знаем», а не «сессии нет»: разлогинивать из-за блипа БД нельзя.
        if (!lookup) return 'unknown';

        const status: KnownSessionTokenStatus = !lookup.found
            ? 'absent'
            : lookup.revoked ? 'revoked' : 'active';
        writeStatusCache(tokenHash, status);
        return status;
    } catch (error) {
        console.warn('[Sessions] Token status lookup failed, failing open:', error);
        return 'unknown';
    }
}

/**
 * Отказывать в доступе только при явном отзыве. Всё остальное (включая
 * недоступность БД) — пропускаем.
 */
export async function isSessionRevoked(token: string): Promise<boolean> {
    return (await getSessionTokenStatus(token)) === 'revoked';
}

export function parsePlatform(ua: string): string | null {
    if (!ua) return null;
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android';
    if (/Windows NT/i.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'macOS';
    if (/Linux/i.test(ua)) return 'Linux';
    return null;
}

export function parseBrowser(ua: string): string | null {
    if (!ua) return null;
    if (/Edg\//i.test(ua)) return 'Edge';
    if (/OPR\//i.test(ua) || /Opera/i.test(ua)) return 'Opera';
    if (/YaBrowser\//i.test(ua)) return 'Яндекс';
    if (/SamsungBrowser\//i.test(ua)) return 'Samsung';
    if (/Chrome\//i.test(ua)) return 'Chrome';
    if (/Firefox\//i.test(ua)) return 'Firefox';
    if (/Safari\//i.test(ua)) return 'Safari';
    return null;
}

export function buildDeviceName(platform: string | null, browser: string | null): string | null {
    if (platform && browser) return `${platform} · ${browser}`;
    if (platform) return platform;
    if (browser) return browser;
    return 'Неизвестное устройство';
}

function rowToSession(row: {
    session_id: string;
    user_id: string;
    device_name: string | null;
    user_agent: string | null;
    ip: string | null;
    platform: string | null;
    browser: string | null;
    created_at: Date;
    last_active_at: Date;
    revoked_at: Date | null;
}): UserSession {
    return {
        sessionId: row.session_id,
        userId: row.user_id,
        deviceName: row.device_name,
        userAgent: row.user_agent,
        ip: row.ip,
        platform: row.platform,
        browser: row.browser,
        createdAt: new Date(row.created_at),
        lastActiveAt: new Date(row.last_active_at),
        revokedAt: row.revoked_at ? new Date(row.revoked_at) : null,
    };
}

/**
 * Создать запись сессии при логине
 */
export async function createUserSession(params: {
    userId: string;
    token: string;
    userAgent?: string | null;
    ip?: string | null;
}): Promise<UserSession | null> {
    const { userId, token, userAgent, ip } = params;
    const sessionId = randomUUID();
    const tokenHash = hashToken(token);
    const ua = userAgent || null;
    const platform = ua ? parsePlatform(ua) : null;
    const browser = ua ? parseBrowser(ua) : null;
    const deviceName = buildDeviceName(platform, browser);
    const now = new Date();

    return withSupabasePostgres(async (client) => {
        const result = await client.query<{
            session_id: string;
            user_id: string;
            device_name: string | null;
            user_agent: string | null;
            ip: string | null;
            platform: string | null;
            browser: string | null;
            created_at: Date;
            last_active_at: Date;
            revoked_at: Date | null;
        }>(
            `
                insert into app_user_sessions
                    (session_id, user_id, token_hash, device_name, user_agent, ip, platform, browser, created_at, last_active_at)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
                returning *
            `,
            [sessionId, userId, tokenHash, deviceName, ua, ip, platform, browser, now]
        );
        if (!result.rows[0]) return null;
        // Свежая сессия заведомо активна — не заставляем первый же запрос
        // после логина ходить в Postgres.
        writeStatusCache(tokenHash, 'active');
        return rowToSession(result.rows[0]);
    });
}

/**
 * sessionId активной сессии по токену. null — если строки нет, сессия отозвана
 * или БД недоступна: вызывающие используют это только как справочную ссылку
 * (например, «какой сессией подтверждён вход»), а не как проверку доступа.
 */
export async function findSessionIdByToken(token: string): Promise<string | null> {
    const tokenHash = hashToken(token);
    const result = await withSupabasePostgres(async (client) => {
        const res = await client.query<{ session_id: string }>(
            `select session_id from app_user_sessions where token_hash = $1 and revoked_at is null limit 1`,
            [tokenHash]
        );
        return res.rows[0]?.session_id ?? null;
    });
    return result ?? null;
}

/**
 * Получить активные сессии с маркером текущей
 */
export async function getUserSessionsWithCurrent(userId: string, currentToken?: string | null): Promise<UserSession[]> {
    const currentHash = currentToken ? hashToken(currentToken) : null;

    const rows = await withSupabasePostgres(async (client) => {
        const result = await client.query<{
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
        }>(
            `
                select * from app_user_sessions
                where user_id = $1
                  and revoked_at is null
                order by last_active_at desc
                limit 20
            `,
            [userId]
        );
        return result.rows;
    });

    if (!rows) return [];

    return rows.map((row) => ({
        ...rowToSession(row),
        isCurrent: currentHash ? row.token_hash === currentHash : false,
    }));
}

/**
 * Отозвать сессию по sessionId (только своя!)
 */
export async function revokeUserSession(userId: string, sessionId: string): Promise<boolean> {
    const revokedHashes = await withSupabasePostgres(async (client) => {
        const res = await client.query<{ token_hash: string }>(
            `
                update app_user_sessions
                set revoked_at = now()
                where session_id = $1
                  and user_id = $2
                  and revoked_at is null
                returning token_hash
            `,
            [sessionId, userId]
        );
        return res.rows;
    });
    if (!revokedHashes || revokedHashes.length === 0) return false;
    // Отзыв действует немедленно в этом процессе, не дожидаясь протухания кэша.
    for (const row of revokedHashes) writeStatusCache(row.token_hash, 'revoked');
    return true;
}

/**
 * Отозвать все сессии кроме текущей
 */
export async function revokeAllOtherSessions(userId: string, currentToken: string): Promise<number> {
    const currentHash = hashToken(currentToken);
    const revokedHashes = await withSupabasePostgres(async (client) => {
        const res = await client.query<{ token_hash: string }>(
            `
                update app_user_sessions
                set revoked_at = now()
                where user_id = $1
                  and token_hash <> $2
                  and revoked_at is null
                returning token_hash
            `,
            [userId, currentHash]
        );
        return res.rows;
    });
    if (!revokedHashes) return 0;
    for (const row of revokedHashes) writeStatusCache(row.token_hash, 'revoked');
    return revokedHashes.length;
}

/**
 * Отозвать текущую сессию (логаут)
 */
export async function revokeCurrentSession(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    const revokedCount = await withSupabasePostgres(async (client) => {
        const res = await client.query(
            `update app_user_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`,
            [tokenHash]
        );
        return res.rowCount ?? 0;
    });
    // Пишем в кэш только если строка реально отозвана в БД — иначе кэш начнёт
    // расходиться с источником правды (и мог бы «отозвать» токен без строки).
    if (revokedCount && revokedCount > 0) writeStatusCache(tokenHash, 'revoked');
}

/**
 * Обновить last_active_at для сессии по токену
 */
async function touchSession(token: string): Promise<void> {
    const tokenHash = hashToken(token);
    await withSupabasePostgres(async (client) => {
        await client.query(
            `update app_user_sessions set last_active_at = now() where token_hash = $1 and revoked_at is null`,
            [tokenHash]
        );
    });
}

/**
 * Убедиться что сессия для токена существует — если нет, создать (backfill для старых токенов).
 *
 * Раньше здесь читалось `where token_hash = $1 and revoked_at is null`, поэтому
 * отозванная сессия выглядела как «строки нет» и воскресала новой строкой:
 * устройство возвращалось в список, а отзыв фактически ничего не давал.
 * Теперь три случая разведены явно:
 *   - строки нет вообще → backfill (легитимный путь для токенов до фичи сессий);
 *   - строка есть и активна → просто обновляем last_active_at;
 *   - строка есть и отозвана → НЕ воскрешаем.
 */
export async function ensureSessionExists(params: {
    userId: string;
    token: string;
    userAgent?: string | null;
    ip?: string | null;
}): Promise<void> {
    const tokenHash = hashToken(params.token);
    const lookup = await withSupabasePostgres(async (client) => {
        const res = await client.query<{ revoked_at: Date | null }>(
            `select revoked_at from app_user_sessions where token_hash = $1 limit 1`,
            [tokenHash]
        );
        const row = res.rows[0];
        return { found: Boolean(row), revoked: Boolean(row?.revoked_at) };
    });

    // БД недоступна — ничего не делаем. Создавать строку «вслепую» нельзя:
    // именно так отозванная сессия и воскресала.
    if (!lookup) return;

    if (lookup.revoked) {
        writeStatusCache(tokenHash, 'revoked');
        return;
    }

    if (!lookup.found) {
        await createUserSession(params);
        return;
    }

    writeStatusCache(tokenHash, 'active');
    await touchSession(params.token);
}
