/**
 * Shared CORS origin policy.
 *
 * Used by the @fastify/cors registration AND by SSE routes that `reply.hijack()`
 * the response — hijacking bypasses the cors plugin's onSend hook, so those
 * routes must set the `Access-Control-*` headers themselves or the browser
 * blocks the cross-origin EventSource (frontend on a different port/domain).
 */
import type { ServerResponse } from 'node:http';

export const PROD_ALLOWED_ORIGINS = new Set<string>([
    'https://univerkstu.app',
    'https://www.univerkstu.app',
    'https://universchedule.vercel.app',
]);

/** Mirrors the @fastify/cors `origin` callback policy. */
export function isCorsOriginAllowed(origin: string | undefined | null): boolean {
    if (process.env.NODE_ENV !== 'production') return true;
    if (!origin) return true;
    return PROD_ALLOWED_ORIGINS.has(origin);
}

/**
 * Set CORS headers on a hijacked (raw) response. Echoes the request origin when
 * allowed — credentialed CORS requires echoing the specific origin, not `*`.
 * No-op for missing/disallowed origins.
 */
export function applyHijackedCorsHeaders(
    res: ServerResponse,
    requestOrigin: string | undefined | null,
): void {
    if (typeof requestOrigin !== 'string' || !requestOrigin) return;
    if (!isCorsOriginAllowed(requestOrigin)) return;
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
}
