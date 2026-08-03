import type { FastifyReply, FastifyRequest } from 'fastify';

export const USER_SESSION_COOKIE = 'user_session';

const DEFAULT_TTL_DAYS = 365;

function getUserSessionTtlSec(): number {
    const parsed = Number.parseInt(
        process.env.USER_SESSION_TTL_DAYS || process.env.JWT_COOKIE_TTL_DAYS || '',
        10
    );
    const ttlDays = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_DAYS;
    return ttlDays * 24 * 60 * 60;
}

function getUserSessionCookieOptions() {
    return {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' as const : 'lax' as const,
        maxAge: getUserSessionTtlSec(),
    };
}

export function setUserSessionCookie(reply: FastifyReply, token: string): void {
    reply.setCookie(USER_SESSION_COOKIE, token, getUserSessionCookieOptions());
}

export function clearUserSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(USER_SESSION_COOKIE, { path: '/' });
}

export function readUserSessionToken(request: FastifyRequest): string | null {
    const cookieValue = request.cookies?.[USER_SESSION_COOKIE];
    return typeof cookieValue === 'string' && cookieValue.trim() ? cookieValue : null;
}

export function readBearerToken(request: FastifyRequest): string | null {
    const raw = request.headers.authorization;
    if (typeof raw !== 'string') return null;
    if (!raw.startsWith('Bearer ')) return null;
    const token = raw.slice('Bearer '.length).trim();
    return token || null;
}

/**
 * Зависимости обработчика авторизации. Вынесены явно, чтобы логику
 * `app.authenticate` можно было покрыть юнит-тестами: цена ошибки здесь —
 * разлогин всех живых пользователей.
 */
export interface AuthenticateDeps {
    /** Проверка подписи и срока (app.jwt.verify). Бросает при невалидном/протухшем токене. */
    verifyToken: (token: string) => { userId: string };
    /** Разбор payload без проверки срока (app.jwt.decode). */
    decodeToken: (token: string) => { userId?: string } | null;
    /** Выпуск нового токена (app.jwt.sign). */
    signToken: (payload: { userId: string }) => string;
    /** Существует ли пользователь в базе. */
    userExists: (userId: string) => Promise<boolean>;
    /**
     * Явно ли отозвана сессия этого токена. Должна возвращать false во всех
     * неопределённых случаях (нет строки, БД недоступна) — отказ допустим
     * только по подтверждённому отзыву.
     */
    isSessionRevoked: (token: string) => Promise<boolean>;
    /** Хук после успешной авторизации (обновление request-контекста). */
    onAuthenticated?: () => void;
}

/**
 * Тело декоратора `app.authenticate`.
 *
 * Правила отказа:
 *  - нет токена → 401;
 *  - подпись невалидна → 401;
 *  - сессия токена явно отозвана → 401 (SESSION_REVOKED), в том числе на ветке
 *    автопродления: отозванный токен не должен перевыпускать сам себя;
 *  - токен протух, но сессия не отозвана и юзер есть в базе → перевыпуск, как и раньше.
 *
 * Отказ по отзыву — единственный «жёсткий». Любая ошибка самой проверки
 * (Postgres лёг) трактуется как «не отозван»: блип БД не должен становиться
 * массовым разлогином.
 */
export async function runAuthenticate(
    request: FastifyRequest,
    reply: FastifyReply,
    deps: AuthenticateDeps
): Promise<void> {
    const bearerToken = readBearerToken(request);
    const cookieToken = readUserSessionToken(request);
    const token = bearerToken || cookieToken;

    if (!token) {
        reply.status(401).send({ error: 'Unauthorized' });
        return;
    }

    const isRevoked = async (): Promise<boolean> => {
        try {
            return await deps.isSessionRevoked(token);
        } catch (statusError) {
            console.warn('[Auth] Session revocation check failed, allowing request:', statusError);
            return false;
        }
    };

    let verified: { userId: string } | null = null;
    let verifyError: (Error & { code?: string }) | null = null;
    try {
        verified = deps.verifyToken(token);
    } catch (err: any) {
        verifyError = err;
    }

    if (verified && !verifyError) {
        if (await isRevoked()) {
            console.warn(`[Auth] Rejected revoked session for ${verified.userId}`);
            reply.status(401).send({ error: 'Unauthorized', errorCode: 'SESSION_REVOKED' });
            return;
        }
        request.user = { userId: verified.userId };
        deps.onAuthenticated?.();
        return;
    }

    // Если токен просто протух — перевыпускаем, если юзер существует в базе
    if (verifyError?.code === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
        try {
            // Декодируем payload без проверки срока
            const decoded = deps.decodeToken(token);

            if (decoded?.userId && !(await isRevoked())) {
                const exists = await deps.userExists(decoded.userId);
                if (exists) {
                    // Юзер есть в базе — выдаём новый токен
                    const newToken = deps.signToken({ userId: decoded.userId });
                    reply.header('X-Renewed-Token', newToken);
                    setUserSessionCookie(reply, newToken);
                    // Подставляем user в request чтобы route handlers работали
                    request.user = { userId: decoded.userId };
                    deps.onAuthenticated?.();
                    console.log(`[Auth] Auto-renewed expired JWT for ${decoded.userId}`);
                    return; // Пропускаем дальше
                }
            }
        } catch (renewErr) {
            console.error('[Auth] Token renewal failed:', renewErr);
        }
    }

    const tokenPreview = `${token.substring(0, 20)}...`;
    const source = bearerToken ? 'bearer' : 'cookie';
    console.error(`[Auth] JWT verify failed: ${verifyError?.message} | code: ${verifyError?.code} | source: ${source} | token: ${tokenPreview}`);
    reply.status(401).send({ error: 'Unauthorized' });
}
