/**
 * Сервис работы с пользователями
 */

import { randomUUID, timingSafeEqual } from 'crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { User, UserSettings, ExamRemindersSettings, AppThemeId } from '../types/index.js';
import { encrypt, decrypt } from '../utils/crypto.js';

function parseExamReminders(raw: unknown): ExamRemindersSettings | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const candidate = raw as Partial<ExamRemindersSettings>;
    return {
        enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : true,
        oneDay: typeof candidate.oneDay === 'boolean' ? candidate.oneDay : true,
        oneHour: typeof candidate.oneHour === 'boolean' ? candidate.oneHour : true,
    };
}

const KNOWN_THEMES: ReadonlySet<AppThemeId> = new Set<AppThemeId>([
    'light',
    'dark',
    'system',
    'deep-blue',
    'aurora',
    'sunset',
    'matrix',
    'pastel',
    'referral-nebula',
    'referral-sherbet',
    'supporter-midnight',
    'supporter-paper',
]);

export function normalizeTheme(value: unknown): AppThemeId {
    if (typeof value === 'string' && KNOWN_THEMES.has(value as AppThemeId)) {
        return value as AppThemeId;
    }
    return 'system';
}

export function parseUserSettings(raw: unknown): UserSettings | undefined {
    if (!raw || typeof raw !== 'object') return undefined;
    const candidate = raw as Partial<UserSettings>;
    const leaderboardDisplayName = typeof candidate.leaderboardDisplayName === 'string'
        ? candidate.leaderboardDisplayName.trim().slice(0, 40)
        : '';
    const leaderboardContacts = candidate.leaderboardContacts && typeof candidate.leaderboardContacts === 'object'
        ? {
            telegram: typeof candidate.leaderboardContacts.telegram === 'string'
                ? candidate.leaderboardContacts.telegram.trim().slice(0, 40) || undefined
                : undefined,
            instagram: typeof candidate.leaderboardContacts.instagram === 'string'
                ? candidate.leaderboardContacts.instagram.trim().slice(0, 40) || undefined
                : undefined,
        }
        : undefined;
    return {
        language: candidate.language === 'kz' || candidate.language === 'en' ? candidate.language : 'ru',
        notifications: typeof candidate.notifications === 'boolean' ? candidate.notifications : true,
        theme: normalizeTheme(candidate.theme),
        leaderboardDisplayName: leaderboardDisplayName || undefined,
        leaderboardContacts: leaderboardContacts?.telegram || leaderboardContacts?.instagram ? leaderboardContacts : undefined,
        dmPrivacy: candidate.dmPrivacy === 'friends_only' ? 'friends_only' : 'open',
        gradesLeaderboardOptOut: candidate.gradesLeaderboardOptOut === true ? true : undefined,
        examReminders: parseExamReminders(candidate.examReminders),
    };
}

export function toPgUser(row: {
    user_id: string;
    password_encrypted: string;
    created_at: Date;
    last_login: Date;
    settings_json: unknown;
}): User {
    return {
        userId: row.user_id,
        passwordEncrypted: row.password_encrypted,
        createdAt: new Date(row.created_at),
        lastLogin: new Date(row.last_login),
        settings: parseUserSettings(row.settings_json),
    };
}

async function requireUsersPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres<{ value: T }>(async (client) => ({
        value: await handler(client),
    }));
    if (result === null) {
        throw new Error(`[Users] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result.value;
}

async function ensureAppUserRecord(
    client: PoolClient,
    userId: string,
    touchLastLogin = false
): Promise<User> {
    const now = new Date();
    const placeholderPassword = encrypt(`staff:${randomUUID()}`);
    const result = await client.query<{
        user_id: string;
        password_encrypted: string;
        created_at: Date;
        last_login: Date;
        settings_json: unknown;
    }>(
        `
            insert into app_users (user_id, password_encrypted, created_at, last_login)
            values ($1, $2, $3, $3)
            on conflict (user_id)
            do update set
                last_login = case when $4 then excluded.last_login else app_users.last_login end
            returning user_id, password_encrypted, created_at, last_login, settings_json
        `,
        [userId, placeholderPassword, now, touchLastLogin]
    );

    return toPgUser(result.rows[0]);
}

/**
 * Создание или обновление пользователя
 */
export async function upsertUser(
    userId: string,
    password: string
): Promise<User> {
    const encryptedPassword = encrypt(password);
    const now = new Date();
    return requireUsersPostgres('upsertUser', async (client) => {
        const result = await client.query<{
            user_id: string;
            password_encrypted: string;
            created_at: Date;
            last_login: Date;
            settings_json: unknown;
        }>(
            `
                insert into app_users (user_id, password_encrypted, created_at, last_login)
                values ($1, $2, $3, $3)
                on conflict (user_id)
                do update set
                    password_encrypted = excluded.password_encrypted,
                    last_login = excluded.last_login
                returning user_id, password_encrypted, created_at, last_login, settings_json
            `,
            [userId, encryptedPassword, now]
        );

        return toPgUser(result.rows[0]);
    });
}

export async function touchUserLastLogin(userId: string): Promise<User> {
    return requireUsersPostgres('touchUserLastLogin', async (client) =>
        ensureAppUserRecord(client, userId, true)
    );
}

export async function upsertStaffAccount(userId: string, password: string): Promise<{ userId: string }> {
    const encryptedPassword = encrypt(password);
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
        throw new Error('userId is required');
    }

    return requireUsersPostgres('upsertStaffAccount', async (client) => {
        await client.query(
            `
                insert into app_staff_accounts (user_id, password_encrypted, created_at, updated_at)
                values ($1, $2, $3, $3)
                on conflict (user_id)
                do update set
                    password_encrypted = excluded.password_encrypted,
                    updated_at = excluded.updated_at
            `,
            [normalizedUserId, encryptedPassword, new Date()]
        );

        await ensureAppUserRecord(client, normalizedUserId, false);
        return { userId: normalizedUserId };
    });
}

export async function verifyStaffPassword(userId: string, password: string): Promise<boolean> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId || !password) {
        return false;
    }

    return requireUsersPostgres('verifyStaffPassword', async (client) => {
        const result = await client.query<{ password_encrypted: string }>(
            `
                select password_encrypted
                from app_staff_accounts
                where user_id = $1
                limit 1
            `,
            [normalizedUserId]
        );

        const encrypted = result.rows[0]?.password_encrypted;
        if (!encrypted) {
            return false;
        }

        return constantTimeEquals(decrypt(encrypted), password);
    });
}

/**
 * Compare two secrets without leaking their common prefix length through timing.
 * `===` on strings short-circuits at the first differing byte, which makes a
 * password check measurably faster the earlier it fails. Same guard shape as
 * `utils/adminSession.ts`: `timingSafeEqual` throws unless both buffers are the
 * same length, so the length check happens first (length is not itself secret).
 * Exported for unit testing.
 */
export function constantTimeEquals(left: string, right: string): boolean {
    const leftBuf = Buffer.from(String(left ?? ''), 'utf8');
    const rightBuf = Buffer.from(String(right ?? ''), 'utf8');
    if (leftBuf.length !== rightBuf.length) return false;
    if (leftBuf.length === 0) return true;
    return timingSafeEqual(leftBuf, rightBuf);
}

/**
 * Получение пользователя по ID
 */
export async function getUser(userId: string): Promise<User | null> {
    return requireUsersPostgres('getUser', async (client) => {
        const result = await client.query<{
            user_id: string;
            password_encrypted: string;
            created_at: Date;
            last_login: Date;
            settings_json: unknown;
        }>(
            `
                select user_id, password_encrypted, created_at, last_login, settings_json
                from app_users
                where user_id = $1
                limit 1
            `,
            [userId]
        );

        if (!result.rows[0]) {
            return null;
        }

        return toPgUser(result.rows[0]);
    });
}

/**
 * Получение расшифрованного пароля
 */
export async function getUserPassword(userId: string): Promise<string | null> {
    const user = await getUser(userId);
    if (!user) return null;
    return decrypt(user.passwordEncrypted);
}

/**
 * Обновление настроек пользователя
 */
export async function updateUserSettings(
    userId: string,
    settings: Partial<UserSettings>
): Promise<boolean> {
    return requireUsersPostgres('updateUserSettings', async (client) => {
        const current = await client.query<{ settings_json: unknown }>(
            `select settings_json from app_users where user_id = $1 limit 1`,
            [userId]
        );
        if (!current.rows[0]) {
            return false;
        }

        const merged = {
            ...(parseUserSettings(current.rows[0].settings_json) || { language: 'ru', notifications: true, theme: 'system' as const }),
            ...settings,
        };

        const result = await client.query(
            `update app_users set settings_json = $2::jsonb where user_id = $1`,
            [userId, JSON.stringify(merged)]
        );

        if (result.rowCount && result.rowCount > 0) {
            return true;
        }

        return false;
    });
}

/**
 * Удаление пользователя
 */
export async function deleteUser(userId: string): Promise<boolean> {
    return requireUsersPostgres('deleteUser', async (client) => {
        const result = await client.query(`delete from app_users where user_id = $1`, [userId]);
        return Boolean(result.rowCount && result.rowCount > 0);
    });
}

/**
 * Проверка существования пользователя
 */
export async function userExists(userId: string): Promise<boolean> {
    return requireUsersPostgres('userExists', async (client) => {
        const result = await client.query<{ exists: boolean }>(
            `select exists(select 1 from app_users where user_id = $1) as exists`,
            [userId]
        );
        return Boolean(result.rows[0]?.exists);
    });
}

/**
 * Получение всех пользователей (для админки, без паролей)
 */
export async function getAllUsers(): Promise<Array<{
    userId: string;
    lastLogin: Date;
    createdAt: Date;
    settings?: UserSettings;
}>> {
    return requireUsersPostgres('getAllUsers', async (client) => {
        const result = await client.query<{
            user_id: string;
            password_encrypted: string;
            created_at: Date;
            last_login: Date;
            settings_json: unknown;
        }>(`select user_id, password_encrypted, created_at, last_login, settings_json from app_users order by created_at desc`);

        return result.rows.map((row) => {
            const user = toPgUser(row);
            return {
                userId: user.userId,
                lastLogin: user.lastLogin,
                createdAt: user.createdAt,
                settings: user.settings,
            };
        });
    });
}
