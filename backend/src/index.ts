import { config as loadEnv } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';

import { isCorsOriginAllowed } from './utils/cors.js';
import { appRoutes } from './routes/app.js';
import { academicRoutes } from './routes/academic.js';
import { authRoutes } from './routes/auth.js';
import { scheduleRoutes } from './routes/schedule.js';
import { examsRoutes } from './routes/exams.js';
import { statusRoutes } from './routes/status.js';
import { profileRoutes } from './routes/profile.js';
import { umkdRoutes } from './routes/umkd.js';
import { filesRoutes } from './routes/files.js';
import { teacherRoutes } from './routes/teacher.js';
import { platonusRoutes } from './routes/platonus.js';
import { feedbackRoutes } from './routes/feedback.js';
import { groupRoutes } from './routes/group.js';
import { globalChatRoutes } from './routes/global-chat.js';
import { messagingRoutes } from './routes/messaging.js';
import { sessionsRoutes } from './routes/sessions.js';
import { referralRoutes } from './routes/referrals.js';
import { notificationRoutes } from './routes/notifications.js';
import { socialRoutes } from './routes/social.js';
import { socialFriendshipRoutes } from './routes/social-friends.js';
import { socialStreamRoutes } from './routes/social-stream.js';
import { boardRoutes } from './routes/board.js';
import { leaderboardRoutes } from './routes/leaderboard.js';
import { startExamRemindersScheduler } from './jobs/exam-reminders.js';
import { startEventRemindersScheduler } from './jobs/event-reminders.js';
import { startPresenceJanitor } from './services/presence.js';
// Side-effect import: registers socialEvents listeners that fan out @mention
// push notifications. Must stay above start() so the listener is wired before
// the first request arrives.
import './services/social-events.js';
import { getUser } from './services/users.js';
import { logRequestAudit } from './utils/requestAudit.js';
import { enterRequestContext, updateRequestContext } from './utils/requestContext.js';
import { traceRuntime } from './utils/runtimeTrace.js';
import { runAuthenticate } from './utils/userSession.js';
import { isSessionRevoked } from './services/sessions.js';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
// Also load repo-root .env (used in local dev), without overriding already defined vars.
loadEnv({ path: path.resolve(currentDir, '../../.env'), override: false });

const app = Fastify({
    logger: true,
    trustProxy: true,  // read real IP from X-Forwarded-For (set by Railway/Vercel/nginx)
    // JSON API не принимает крупные boundary'ы — режем дефолтный 1MB до 256KB.
    // Per-route overrides (например analytics.ts: 128KB) сохраняют свой scope.
    bodyLimit: 256 * 1024,
});

function getRouteKind(pathname: string): string {
    if (pathname.startsWith('/api/v3/app')) return 'app';
    if (pathname.startsWith('/api/v3/academic')) return 'academic';
    if (pathname.startsWith('/api/v3/auth')) return 'auth';
    if (pathname.startsWith('/api/v3/group')) return 'group';
    if (pathname.startsWith('/api/v3/chat')) return 'chat';
    if (pathname.startsWith('/api/v3/files')) return 'files';
    if (pathname.startsWith('/api/v3/platonus')) return 'platonus';
    if (pathname.startsWith('/api/v3/schedule')) return 'schedule';
    if (pathname.startsWith('/api/v3/exams')) return 'exams';
    if (pathname.startsWith('/api/v3/umkd')) return 'umkd';
    if (pathname.startsWith('/api/v3/profile')) return 'profile';
    if (pathname.startsWith('/api/v3/referrals')) return 'referrals';
    if (pathname.startsWith('/api/v3/notifications')) return 'notifications';
    if (pathname.startsWith('/api/v3/social')) return 'social';
    if (pathname.startsWith('/api/v3/status') || pathname.startsWith('/api/v3/info')) return 'status';
    return 'other';
}

function getRequestSource(request: FastifyRequest): 'webapp' | 'direct' | 'unknown' {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : '';
    const referer = typeof request.headers.referer === 'string' ? request.headers.referer : '';
    const value = `${origin} ${referer}`.toLowerCase();
    if (!value.trim()) return 'unknown';
    if (
        value.includes('univerkstu.app')
        || value.includes('universchedule.vercel.app')
        || value.includes('localhost:3001')
        || value.includes('localhost:3000')
    ) {
        return 'webapp';
    }
    return 'direct';
}

// Plugins
await app.register(cors, {
    origin(origin, callback) {
        callback(null, isCorsOriginAllowed(origin));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Client-Session-Id'],
    exposedHeaders: ['X-Renewed-Token', 'Server-Timing'],
    optionsSuccessStatus: 204,
    strictPreflight: false,
});

await app.register(cookie);

// Security headers: CSP off (we serve JSON, not HTML — no script context),
// CORP=cross-origin так как фронт живёт на отдельном домене (Vercel) и должен
// получать ответы и бинарники (file-download).
await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
});

app.addHook('onRequest', async (request) => {
    (request as any).__startedAtMs = Date.now();
    const urlPath = request.url.split('?')[0] || request.url;
    enterRequestContext({
        reqId: request.id,
        sessionId: typeof request.headers['x-client-session-id'] === 'string' ? request.headers['x-client-session-id'] : null,
        routeKind: getRouteKind(urlPath),
        path: urlPath,
        source: getRequestSource(request),
    });
});

app.addHook('onError', async (request, _reply, error) => {
    (request as any).__auditErrorMessage = error?.message || 'unknown error';
    traceRuntime({
        source: 'backend',
        scope: 'backend.request',
        event: 'request_error',
        level: 'error',
        message: `${request.method} ${request.url}: ${error?.message || 'unknown error'}`,
        userId: (request as any).user?.userId || null,
        metadata: {
            stack: error?.stack || null,
        },
    });
});

app.addHook('onSend', async (request, reply, payload) => {
    const startedAt = (request as any).__startedAtMs as number | undefined;
    if (typeof startedAt === 'number') {
        const dur = Math.max(0, Date.now() - startedAt);
        // W3C Server-Timing — browsers surface this in DevTools Network → Timing.
        // Single metric "app" with millisecond granularity is enough for the
        // common "why is this request slow?" debugging case.
        reply.header('Server-Timing', `app;dur=${dur}`);
    }
    return payload;
});

app.addHook('onSend', async (request, reply, payload) => {
    if (reply.statusCode < 400) return payload;

    const setAudit = (errorCode: string | null, errorMessage: string | null, responseBytes: number | null) => {
        (request as any).__auditErrorCode = errorCode;
        (request as any).__auditErrorMessage = errorMessage || (request as any).__auditErrorMessage || null;
        (request as any).__auditResponseBytes = responseBytes;
    };

    if (Buffer.isBuffer(payload)) {
        const buf = payload as Buffer;
        setAudit(null, (request as any).__auditErrorMessage || null, buf.length);
        return payload;
    }

    if (typeof payload === 'string') {
        let errorCode: string | null = null;
        let errorMessage: string | null;
        try {
            const parsed = JSON.parse(payload) as { error?: string; errorCode?: string; message?: string };
            errorCode = typeof parsed.errorCode === 'string' ? parsed.errorCode : null;
            errorMessage = typeof parsed.error === 'string'
                ? parsed.error
                : typeof parsed.message === 'string'
                    ? parsed.message
                    : null;
        } catch {
            errorMessage = payload.slice(0, 300);
        }
        setAudit(errorCode, errorMessage, Buffer.byteLength(payload));
        return payload;
    }

    if (payload && typeof payload === 'object') {
        const maybePayload = payload as { error?: string; errorCode?: string; message?: string };
        const serialized = JSON.stringify(payload);
        setAudit(
            typeof maybePayload.errorCode === 'string' ? maybePayload.errorCode : null,
            typeof maybePayload.error === 'string'
                ? maybePayload.error
                : typeof maybePayload.message === 'string'
                    ? maybePayload.message
                    : null,
            Buffer.byteLength(serialized)
        );
    }

    return payload;
});

app.addHook('onResponse', async (request, reply) => {
    const startedAt = (request as any).__startedAtMs as number | undefined;
    const durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
    const urlPath = request.url.split('?')[0] || request.url;
    const userId = (request as any).user?.userId && typeof (request as any).user.userId === 'string'
        ? (request as any).user.userId
        : null;

    logRequestAudit({
        reqId: request.id,
        routeKind: getRouteKind(urlPath),
        method: request.method,
        url: request.url,
        path: urlPath,
        statusCode: reply.statusCode,
        durationMs,
        ip: request.ip || null,
        userId,
        sessionId: typeof request.headers['x-client-session-id'] === 'string' ? request.headers['x-client-session-id'] : null,
        source: getRequestSource(request),
        host: typeof request.headers.host === 'string' ? request.headers.host : null,
        userAgent: typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'] : null,
        referer: typeof request.headers.referer === 'string' ? request.headers.referer : null,
        origin: typeof request.headers.origin === 'string' ? request.headers.origin : null,
        contentLength: typeof request.headers['content-length'] === 'string'
            ? Number.parseInt(request.headers['content-length'], 10) || null
            : null,
        responseBytes: reply.getHeader('content-length')
            ? Number.parseInt(String(reply.getHeader('content-length')), 10) || null
            : ((request as any).__auditResponseBytes as number | undefined) ?? null,
        errorCode: ((request as any).__auditErrorCode as string | undefined) ?? null,
        errorMessage: ((request as any).__auditErrorMessage as string | undefined) ?? null,
    });
});

if (!process.env.JWT_SECRET) {
    console.error('❌ FATAL: JWT_SECRET environment variable is not defined.');
    process.exit(1);
}

process.on('unhandledRejection', (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason || 'Unknown rejection');
    traceRuntime({
        source: 'backend',
        scope: 'backend.process',
        event: 'unhandled_rejection',
        level: 'error',
        message,
        metadata: {
            stack: reason instanceof Error ? reason.stack || null : null,
        },
    });
    app.log.error(reason);
});

process.on('uncaughtException', (error) => {
    traceRuntime({
        source: 'backend',
        scope: 'backend.process',
        event: 'uncaught_exception',
        level: 'error',
        message: error.message || 'Unknown uncaught exception',
        metadata: {
            stack: error.stack || null,
        },
    });
    app.log.error(error);
});

await app.register(jwt, {
    secret: process.env.JWT_SECRET,
    sign: {
        // Юзер логинится один раз и живёт с этим.
        // Перелогин нужен только если сменил пароль на univer.kstu.kz.
        expiresIn: process.env.JWT_EXPIRES_IN || '365d',
    },
});

// Декоратор для проверки авторизации (с автопродлением протухших токенов).
// Тело вынесено в utils/userSession.ts (runAuthenticate) — там оно покрыто
// тестами, включая отказ по отозванной сессии и fail-open при недоступной БД.
app.decorate('authenticate', async function (request: any, reply: any) {
    await runAuthenticate(request, reply, {
        verifyToken: (token) => app.jwt.verify<{ userId: string }>(token),
        decodeToken: (token) => app.jwt.decode(token) as { userId?: string } | null,
        signToken: (payload) => app.jwt.sign(payload),
        userExists: async (userId) => Boolean(await getUser(userId)),
        isSessionRevoked,
        onAuthenticated: () => updateRequestContext({}),
    });
});

// Tolerate empty JSON bodies. The frontend fetch helper always sends
// `Content-Type: application/json`, so a bodyless request (e.g. DELETE) would
// otherwise 400 with FST_ERR_CTP_EMPTY_JSON_BODY. Treat an empty body as "no
// body" instead of erroring; still reject genuinely malformed JSON.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (text.length === 0) {
        done(null, undefined);
        return;
    }
    try {
        done(null, JSON.parse(text));
    } catch {
        const error = new Error('Invalid JSON body') as Error & { statusCode?: number };
        error.statusCode = 400;
        done(error, undefined);
    }
});

// Routes
app.register(appRoutes, { prefix: '/api/v3' });
app.register(academicRoutes, { prefix: '/api/v3' });
app.register(authRoutes, { prefix: '/api/v3/auth' });
app.register(scheduleRoutes, { prefix: '/api/v3' });
app.register(examsRoutes, { prefix: '/api/v3' });
app.register(profileRoutes, { prefix: '/api/v3' });
app.register(umkdRoutes, { prefix: '/api/v3' });
app.register(filesRoutes, { prefix: '/api/v3' });
app.register(statusRoutes, { prefix: '/api/v3' });
app.register(feedbackRoutes, { prefix: '/api/v3' });
app.register(referralRoutes, { prefix: '/api/v3' });
app.register(groupRoutes, { prefix: '/api/v3' });
app.register(globalChatRoutes, { prefix: '/api/v3' });
app.register(messagingRoutes, { prefix: '/api/v3' });
app.register(teacherRoutes, { prefix: '/api/v3' });
app.register(platonusRoutes, { prefix: '/api/v3/platonus' });
app.register(sessionsRoutes, { prefix: '/api/v3/auth' });
app.register(notificationRoutes, { prefix: '/api/v3/notifications' });
app.register(socialRoutes, { prefix: '/api/v3' });
app.register(socialFriendshipRoutes, { prefix: '/api/v3' });
app.register(socialStreamRoutes, { prefix: '/api/v3' });
app.register(boardRoutes, { prefix: '/api/v3' });
app.register(leaderboardRoutes, { prefix: '/api/v3' });

// Health check
app.get('/', async () => ({ status: 'ok', service: 'univer-backend-v4', version: '4.0.0' }));
app.get('/health', async () => ({ status: 'ok', version: '4.0.0' }));
app.get('/api/v3/health', async () => ({ status: 'ok', version: '4.0.0' }));

// Start server
const start = async () => {
    try {
        startExamRemindersScheduler();
        console.log('✅ Exam reminders scheduler started');

        startEventRemindersScheduler();
        console.log('✅ Event reminders scheduler started');

        startPresenceJanitor();
        console.log('✅ Presence janitor started');

        const port = Number.parseInt(process.env.PORT || '3000', 10);
        await app.listen({ port, host: '0.0.0.0' });
        console.log(`🚀 Server running on http://localhost:${port}`);
    } catch (err) {
        app.log.error(err);
        process.exit(1);
    }
};

start();
