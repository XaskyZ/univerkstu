/**
 * Challenge-вход («подтверди на другом устройстве»): QR и push.
 *
 * Модель безопасности:
 *  - approveSecret знает тот, кто видит QR (или получил push). Им можно только
 *    посмотреть/подтвердить/отклонить запрос — и только из авторизованной сессии.
 *  - pollSecret знает только устройство-запросчик; в QR он не попадает. Только
 *    по нему выдаётся JWT — злоумышленник, сфотографировавший QR, токен не получит.
 *  - В БД секреты лежат как sha256, JWT requester'а — зашифрованным и отдаётся
 *    ровно один раз (status 'approved' → 'consumed').
 */

import { createHash, randomBytes, randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { withSupabasePostgres } from '../db/postgres.js';
import { constantTimeEquals } from './users.js';
import { buildDeviceName, parseBrowser, parsePlatform } from './sessions.js';

export type LoginChallengeKind = 'qr' | 'push';
export type LoginChallengeStatus = 'pending' | 'approved' | 'consumed' | 'denied' | 'expired';

export interface LoginChallenge {
    challengeId: string;
    kind: LoginChallengeKind;
    status: LoginChallengeStatus;
    targetUserId: string | null;
    requesterUserAgent: string | null;
    requesterIp: string | null;
    requesterDeviceName: string | null;
    approvedByUserId: string | null;
    approvedBySessionId: string | null;
    createdAt: Date;
    expiresAt: Date;
    approvedAt: Date | null;
    consumedAt: Date | null;
}

export interface CreatedLoginChallenge {
    challenge: LoginChallenge;
    /** Открытый approveSecret — отдаётся вызывающему один раз, в БД только хэш. */
    approveSecret: string;
    /** Открытый pollSecret — то же самое. */
    pollSecret: string;
}

interface LoginChallengeRow {
    challenge_id: string;
    kind: string;
    status: string;
    approve_secret_hash: string;
    poll_secret_hash: string;
    target_user_id: string | null;
    requester_user_agent: string | null;
    requester_ip: string | null;
    requester_device_name: string | null;
    approved_by_user_id: string | null;
    approved_by_session_id: string | null;
    token_encrypted: string | null;
    created_at: Date;
    expires_at: Date;
    approved_at: Date | null;
    consumed_at: Date | null;
}

/** Время жизни challenge: пользователь должен успеть достать телефон и отсканировать. */
export const LOGIN_CHALLENGE_TTL_MS = 120_000;
/** Строки старше этого возраста удаляются при создании нового challenge. */
const LOGIN_CHALLENGE_RETENTION_MS = 24 * 60 * 60 * 1000;

// Crockford base32: без I, L, O, U — их путают с 1/0/V при ручном вводе.
const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const APPROVE_SECRET_LENGTH = 12;
const APPROVE_SECRET_PATTERN = /^[0-9A-HJKMNP-TV-Z]+$/;

const DEFAULT_PUBLIC_APP_URL = 'https://univerkstu.app';

// === Чистые функции (покрыты login-challenges.test.ts) =======================

/**
 * 12 символов Crockford base32 из crypto.randomBytes. Байт & 31 даёт равномерное
 * распределение, т.к. 256 кратно 32.
 */
export function generateApproveSecret(): string {
    const bytes = randomBytes(APPROVE_SECRET_LENGTH);
    let out = '';
    for (const byte of bytes) {
        out += CROCKFORD_ALPHABET[byte & 31];
    }
    return out;
}

/** 32 случайных байта в base64url — знает только устройство-запросчик. */
export function generatePollSecret(): string {
    return randomBytes(32).toString('base64url');
}

/** `ABCDEFGHJKMN` → `ABCD-EFGH-JKMN` — так код показывается пользователю. */
export function formatManualCode(approveSecret: string): string {
    const groups = approveSecret.match(/.{1,4}/g);
    return groups ? groups.join('-') : approveSecret;
}

/**
 * Нормализация ручного ввода кода: регистр, разделители и типичные опечатки
 * Crockford (O→0, I/L→1). Идемпотентна: для валидного секрета возвращает его же.
 */
export function normalizeApproveSecret(input: string): string {
    return String(input ?? '')
        .toUpperCase()
        .replace(/[\s-]/g, '')
        .replace(/O/g, '0')
        .replace(/[IL]/g, '1');
}

/** Формальная проверка уже нормализованного секрета (чтобы не ходить в БД зря). */
export function isValidApproveSecret(normalized: string): boolean {
    return normalized.length === APPROVE_SECRET_LENGTH && APPROVE_SECRET_PATTERN.test(normalized);
}

export function hashSecret(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
}

function secretMatchesHash(secret: string, storedHash: string): boolean {
    return constantTimeEquals(hashSecret(secret), storedHash);
}

/** PUBLIC_APP_URL без завершающего слэша; дефолт — прод-домен. */
export function getPublicAppUrl(): string {
    const raw = (process.env.PUBLIC_APP_URL || '').trim();
    return (raw || DEFAULT_PUBLIC_APP_URL).replace(/\/+$/, '');
}

/** Относительный путь страницы подтверждения — для push (sw.js открывает `data.url`). */
export function buildApprovePath(challengeId: string, approveSecret: string): string {
    const query = new URLSearchParams({ c: challengeId, s: approveSecret });
    return `/login/approve?${query.toString()}`;
}

/** Абсолютный URL для QR. pollSecret сюда НЕ попадает. */
export function buildQrUrl(challengeId: string, approveSecret: string): string {
    return `${getPublicAppUrl()}${buildApprovePath(challengeId, approveSecret)}`;
}

/** Истёк ли pending-challenge на момент `now`. Для остальных статусов — false. */
export function isChallengeExpired(challenge: Pick<LoginChallenge, 'status' | 'expiresAt'>, now: number = Date.now()): boolean {
    return challenge.status === 'pending' && challenge.expiresAt.getTime() <= now;
}

// === Хранилище =================================================================

async function requireLoginChallengesPostgres<T>(
    operation: string,
    handler: (client: PoolClient) => Promise<T>
): Promise<T> {
    const result = await withSupabasePostgres(handler);
    if (result === null) {
        throw new Error(`[LoginChallenges] Supabase/Postgres is unavailable during ${operation}`);
    }
    return result;
}

function rowToChallenge(row: LoginChallengeRow): LoginChallenge {
    return {
        challengeId: row.challenge_id,
        kind: row.kind as LoginChallengeKind,
        status: row.status as LoginChallengeStatus,
        targetUserId: row.target_user_id,
        requesterUserAgent: row.requester_user_agent,
        requesterIp: row.requester_ip,
        requesterDeviceName: row.requester_device_name,
        approvedByUserId: row.approved_by_user_id,
        approvedBySessionId: row.approved_by_session_id,
        createdAt: new Date(row.created_at),
        expiresAt: new Date(row.expires_at),
        approvedAt: row.approved_at ? new Date(row.approved_at) : null,
        consumedAt: row.consumed_at ? new Date(row.consumed_at) : null,
    };
}

async function findRow(client: PoolClient, challengeId: string): Promise<LoginChallengeRow | null> {
    const result = await client.query<LoginChallengeRow>(
        `select * from app_login_challenges where challenge_id = $1 limit 1`,
        [challengeId]
    );
    return result.rows[0] ?? null;
}

async function markExpiredIfNeeded(client: PoolClient, row: LoginChallengeRow): Promise<LoginChallengeRow> {
    if (row.status !== 'pending' || new Date(row.expires_at).getTime() > Date.now()) {
        return row;
    }
    await client.query(
        `update app_login_challenges set status = 'expired' where challenge_id = $1 and status = 'pending'`,
        [row.challenge_id]
    );
    return { ...row, status: 'expired' };
}

/**
 * Создать challenge. Секреты генерируются здесь и возвращаются в открытом виде
 * один раз; в БД пишутся только хэши. Попутно удаляем строки старше суток.
 */
export async function createLoginChallenge(params: {
    kind: LoginChallengeKind;
    targetUserId?: string | null;
    userAgent?: string | null;
    ip?: string | null;
}): Promise<CreatedLoginChallenge> {
    const challengeId = randomUUID();
    const approveSecret = generateApproveSecret();
    const pollSecret = generatePollSecret();
    const ua = params.userAgent || null;
    const deviceName = ua ? buildDeviceName(parsePlatform(ua), parseBrowser(ua)) : buildDeviceName(null, null);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LOGIN_CHALLENGE_TTL_MS);

    const challenge = await requireLoginChallengesPostgres('createLoginChallenge', async (client) => {
        await client.query(
            `delete from app_login_challenges where created_at < $1`,
            [new Date(now.getTime() - LOGIN_CHALLENGE_RETENTION_MS)]
        );
        const result = await client.query<LoginChallengeRow>(
            `
                insert into app_login_challenges
                    (challenge_id, kind, status, approve_secret_hash, poll_secret_hash, target_user_id,
                     requester_user_agent, requester_ip, requester_device_name, created_at, expires_at)
                values ($1, $2, 'pending', $3, $4, $5, $6, $7, $8, $9, $10)
                returning *
            `,
            [
                challengeId,
                params.kind,
                hashSecret(approveSecret),
                hashSecret(pollSecret),
                params.targetUserId ?? null,
                ua,
                params.ip || null,
                deviceName,
                now,
                expiresAt,
            ]
        );
        const row = result.rows[0];
        if (!row) {
            throw new Error('[LoginChallenges] insert returned no row');
        }
        return rowToChallenge(row);
    });

    return { challenge, approveSecret, pollSecret };
}

async function findBySecret(
    operation: string,
    challengeId: string,
    secret: string,
    column: 'poll_secret_hash' | 'approve_secret_hash'
): Promise<LoginChallenge | null> {
    // Обёртка нужна, чтобы отличить «не найдено» (null внутри) от «БД
    // недоступна» (withSupabasePostgres вернул null снаружи → бросаем).
    const found = await requireLoginChallengesPostgres(operation, async (client): Promise<{ challenge: LoginChallenge | null }> => {
        const row = await findRow(client, challengeId);
        if (!row) return { challenge: null };
        if (!secretMatchesHash(secret, row[column])) return { challenge: null };
        return { challenge: rowToChallenge(await markExpiredIfNeeded(client, row)) };
    });
    return found.challenge;
}

/** Для поллинга с устройства-запросчика. Истёкший pending помечается 'expired' при чтении. */
export async function findLoginChallengeByPollSecret(challengeId: string, pollSecret: string): Promise<LoginChallenge | null> {
    return findBySecret('findLoginChallengeByPollSecret', challengeId, pollSecret, 'poll_secret_hash');
}

/**
 * Для inspect/approve/deny с авторизованного устройства. Секрет должен быть уже
 * нормализован. Если challengeId пустой (пользователь ввёл ручной код без
 * ссылки), ищем по хэшу секрета среди ещё не истёкших pending-строк.
 */
export async function findLoginChallengeByApproveSecret(challengeId: string, approveSecret: string): Promise<LoginChallenge | null> {
    if (challengeId) {
        return findBySecret('findLoginChallengeByApproveSecret', challengeId, approveSecret, 'approve_secret_hash');
    }
    const found = await requireLoginChallengesPostgres('findLoginChallengeByManualCode', async (client): Promise<{ challenge: LoginChallenge | null }> => {
        const result = await client.query<LoginChallengeRow>(
            `
                select * from app_login_challenges
                where approve_secret_hash = $1 and status = 'pending' and expires_at > $2
                order by created_at desc
                limit 1
            `,
            [hashSecret(approveSecret), new Date()]
        );
        const row = result.rows[0];
        if (!row || !secretMatchesHash(approveSecret, row.approve_secret_hash)) return { challenge: null };
        return { challenge: rowToChallenge(row) };
    });
    return found.challenge;
}

/**
 * Перевести pending → approved. Атомарно: условие по статусу и сроку в самом
 * update, поэтому два одновременных подтверждения не выдадут два токена.
 */
export async function approveLoginChallenge(params: {
    challengeId: string;
    approvedByUserId: string;
    approvedBySessionId: string | null;
    tokenEncrypted: string;
}): Promise<boolean> {
    const now = new Date();
    return requireLoginChallengesPostgres('approveLoginChallenge', async (client) => {
        const result = await client.query(
            `
                update app_login_challenges
                set status = 'approved',
                    approved_by_user_id = $2,
                    approved_by_session_id = $3,
                    token_encrypted = $4,
                    approved_at = $5
                where challenge_id = $1 and status = 'pending' and expires_at > $5
            `,
            [params.challengeId, params.approvedByUserId, params.approvedBySessionId, params.tokenEncrypted, now]
        );
        return (result.rowCount ?? 0) > 0;
    });
}

/** pending → denied. false, если challenge уже не pending. */
export async function denyLoginChallenge(challengeId: string): Promise<boolean> {
    return requireLoginChallengesPostgres('denyLoginChallenge', async (client) => {
        const result = await client.query(
            `update app_login_challenges set status = 'denied' where challenge_id = $1 and status = 'pending'`,
            [challengeId]
        );
        return (result.rowCount ?? 0) > 0;
    });
}

/** pending → expired (например, push никому не доставлен). */
export async function expireLoginChallenge(challengeId: string): Promise<boolean> {
    return requireLoginChallengesPostgres('expireLoginChallenge', async (client) => {
        const result = await client.query(
            `update app_login_challenges set status = 'expired' where challenge_id = $1 and status = 'pending'`,
            [challengeId]
        );
        return (result.rowCount ?? 0) > 0;
    });
}

/**
 * approved → consumed, одноразово: возвращает зашифрованный токен только тому
 * вызову, который реально перевёл статус. После выдачи токен из строки стирается.
 */
export async function consumeLoginChallenge(challengeId: string): Promise<{ tokenEncrypted: string; userId: string } | null> {
    const now = new Date();
    return requireLoginChallengesPostgres('consumeLoginChallenge', async (client) => {
        const result = await client.query<{ token_encrypted: string | null; approved_by_user_id: string | null }>(
            `
                update app_login_challenges
                set status = 'consumed', consumed_at = $2
                where challenge_id = $1 and status = 'approved'
                returning token_encrypted, approved_by_user_id
            `,
            [challengeId, now]
        );
        const row = result.rows[0];
        if (!row || !row.token_encrypted || !row.approved_by_user_id) return null;
        await client.query(
            `update app_login_challenges set token_encrypted = null where challenge_id = $1`,
            [challengeId]
        );
        return { tokenEncrypted: row.token_encrypted, userId: row.approved_by_user_id };
    });
}
