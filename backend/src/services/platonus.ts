/**
 * Platonus session service
 * Кэширует сессию Platonus в Postgres, чтобы не логиниться каждый раз
 */

import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { platonusLogin, PlatonusSession } from '../parsers/platonus-client.js';

// Сессия живёт 4 часа (Platonus обычно дропает раньше)
const SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export interface PlatonusSessionDoc {
    userId: string;              // userId из JWT (univer login)
    platonusLogin: string;       // логин Платонуса
    passwordEncrypted: string;   // зашифрованный пароль Платонуса
    token: string;               // auth_token
    sid: string;                 // session id
    cookieString?: string;       // all cookies from login
    personID: string;            // ID студента
    createdAt: Date;
    expiresAt: Date;
}

export function toPgSessionDoc(row: {
    user_id: string;
    platonus_login: string;
    password_encrypted: string;
    token: string;
    sid: string;
    cookie_string: string | null;
    person_id: string;
    created_at: Date;
    expires_at: Date;
}): PlatonusSessionDoc {
    return {
        userId: row.user_id,
        platonusLogin: row.platonus_login,
        passwordEncrypted: row.password_encrypted,
        token: row.token,
        sid: row.sid,
        cookieString: row.cookie_string || undefined,
        personID: row.person_id,
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
    };
}

async function requirePlatonusPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Platonus] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

/**
 * Сохранить сессию Platonus для пользователя
 */
export async function savePlatonusSession(
    userId: string,
    platonusLoginStr: string,
    password: string,
    session: PlatonusSession
): Promise<void> {
    const now = new Date();
    const nextDoc: PlatonusSessionDoc = {
        userId,
        platonusLogin: platonusLoginStr,
        passwordEncrypted: encrypt(password),
        token: session.token,
        sid: session.sid,
        cookieString: session.cookieString,
        personID: session.personID,
        createdAt: now,
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
    };

    await requirePlatonusPostgres('savePlatonusSession', async (client) => {
        await client.query(
            `
                insert into app_platonus_sessions (
                    user_id, platonus_login, password_encrypted, token, sid, cookie_string, person_id, created_at, expires_at
                )
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                on conflict (user_id)
                do update set
                    platonus_login = excluded.platonus_login,
                    password_encrypted = excluded.password_encrypted,
                    token = excluded.token,
                    sid = excluded.sid,
                    cookie_string = excluded.cookie_string,
                    person_id = excluded.person_id,
                    created_at = excluded.created_at,
                    expires_at = excluded.expires_at
            `,
            [
                nextDoc.userId,
                nextDoc.platonusLogin,
                nextDoc.passwordEncrypted,
                nextDoc.token,
                nextDoc.sid,
                nextDoc.cookieString || null,
                nextDoc.personID,
                nextDoc.createdAt,
                nextDoc.expiresAt,
            ]
        );
    });
}

/**
 * Получить активную сессию Platonus
 * Если сессия просрочена — пытается перелогиниться автоматически
 */
export async function getActivePlatonusSession(
    userId: string
): Promise<PlatonusSession | null> {
    const pgSession = await requirePlatonusPostgres('getActivePlatonusSession', async (client) => {
        const result = await client.query<{
            user_id: string;
            platonus_login: string;
            password_encrypted: string;
            token: string;
            sid: string;
            cookie_string: string | null;
            person_id: string;
            created_at: Date;
            expires_at: Date;
        }>(
            `
                select user_id, platonus_login, password_encrypted, token, sid, cookie_string, person_id, created_at, expires_at
                from app_platonus_sessions
                where user_id = $1
                limit 1
            `,
            [userId]
        );
        if (!result.rows[0]) return null;
        return toPgSessionDoc(result.rows[0]);
    });

    if (!pgSession) {
        return null;
    }

    const now = new Date();

    if (pgSession.expiresAt > now) {
        return {
            token: pgSession.token,
            sid: pgSession.sid,
            cookieString: pgSession.cookieString,
            personID: pgSession.personID,
        };
    }

    console.log(`[Platonus Service] Session expired for ${userId}, re-logging in...`);
    try {
        const password = decrypt(pgSession.passwordEncrypted);
        const newSession = await platonusLogin(pgSession.platonusLogin, password);
        if (newSession) {
            await savePlatonusSession(userId, pgSession.platonusLogin, password, newSession);
            return newSession;
        }
    } catch (error) {
        console.error('[Platonus Service] Auto re-login failed:', error);
    }

    console.warn(`[Platonus Service] Keeping saved Platonus credentials for ${userId} after failed auto re-login`);
    return null;
}

/**
 * Принудительно обновляет сессию Platonus (перелогинивается)
 * Используется когда эндпоинт транскрипта возвращает 401,
 * хотя по нашему TTL сессия ещё «валидна»
 */
export async function forceRefreshSession(
    userId: string
): Promise<PlatonusSession | null> {
    const pgDoc = await requirePlatonusPostgres('forceRefreshSession', async (client) => {
        const result = await client.query<{
            user_id: string;
            platonus_login: string;
            password_encrypted: string;
        }>(
            `select user_id, platonus_login, password_encrypted from app_platonus_sessions where user_id = $1 limit 1`,
            [userId]
        );
        return result.rows[0] || null;
    });

    if (!pgDoc) {
        return null;
    }

    console.log(`[Platonus Service] Force-refreshing session for ${userId}...`);
    try {
        const password = decrypt(pgDoc.password_encrypted);
        const newSession = await platonusLogin(pgDoc.platonus_login, password);
        if (newSession) {
            await savePlatonusSession(userId, pgDoc.platonus_login, password, newSession);
            return newSession;
        }
    } catch (error) {
        console.error('[Platonus Service] Force refresh failed:', error);
    }

    return null;
}

/**
 * Проверить, подключён ли Platonus для пользователя
 */
export async function isPlatonusConnected(userId: string): Promise<{
    connected: boolean;
    login?: string;
}> {
    return requirePlatonusPostgres('isPlatonusConnected', async (client) => {
        const result = await client.query<{ platonus_login: string }>(
            `select platonus_login from app_platonus_sessions where user_id = $1 limit 1`,
            [userId]
        );
        if (!result.rows[0]) return { connected: false };
        const activeSession = await getActivePlatonusSession(userId);
        if (!activeSession) {
            return { connected: false };
        }
        return {
            connected: true,
            login: result.rows[0].platonus_login,
        };
    });
}

export async function getPlatonusSessionDiagnostics(userId: string): Promise<{
    login: string | null;
    password: string | null;
    createdAt: Date | null;
    expiresAt: Date | null;
} | null> {
    return requirePlatonusPostgres('getPlatonusSessionDiagnostics', async (client) => {
        const result = await client.query<{
            platonus_login: string;
            password_encrypted: string;
            created_at: Date;
            expires_at: Date;
        }>(
            `select platonus_login, password_encrypted, created_at, expires_at from app_platonus_sessions where user_id = $1 limit 1`,
            [userId]
        );
        if (!result.rows[0]) return null;
        return {
            login: result.rows[0].platonus_login || null,
            password: decrypt(result.rows[0].password_encrypted),
            createdAt: result.rows[0].created_at || null,
            expiresAt: result.rows[0].expires_at || null,
        };
    });
}

/**
 * Удалить сессию Platonus (disconnect)
 */
export async function deletePlatonusSession(userId: string): Promise<boolean> {
    return requirePlatonusPostgres('deletePlatonusSession', async (client) => {
        const result = await client.query(`delete from app_platonus_sessions where user_id = $1`, [userId]);
        return Boolean(result.rowCount && result.rowCount > 0);
    });
}
