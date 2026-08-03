/**
 * Link preview / unfurl service.
 *
 * Given a URL found in a social entity body or a comment, we fetch the target
 * page, extract Open Graph metadata, and cache the result in
 * `app_link_preview_cache`. The frontend hydrates these previews lazily so a
 * post containing a URL renders a thumbnail/title/description card under the
 * body text.
 *
 * Safety (SSRF protection) — see `assertSafePublicHost` and the IP-range
 * checks in `isPrivateOrLoopbackIp`. The fetcher rejects:
 *   - non-http(s) schemes
 *   - hosts that resolve to private / loopback / link-local / multicast ranges
 *   - response bodies larger than `LINK_PREVIEW_MAX_BYTES` (256 KiB)
 *   - non-HTML content types
 *
 * Caching strategy:
 *   - `app_link_preview_cache` keyed by `sha256(normalizeUrl(url))`
 *   - Successful fetches: 7-day TTL (`expires_at`)
 *   - Permanent failures: cached as `status='failed'` with the same TTL so we
 *     don't hammer the upstream for known-bad URLs
 *   - Blocked SSRF targets: cached as `status='blocked'`
 *
 * Pure helpers (`normalizeUrl`, `extractFirstUrl`, `hashUrl`, `parseOpenGraph`,
 * `isPrivateOrLoopbackIp`) are exported for unit testing without DB / network.
 */

import { createHash } from 'node:crypto';
import { promises as dnsPromises } from 'node:dns';
import { Agent as HttpAgent } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { PoolClient } from 'pg';
import axios, { type AxiosResponse } from 'axios';
import { withSupabasePostgres } from '../db/postgres.js';

// === Public types ===========================================================

export interface LinkPreview {
    url: string;
    title: string | null;
    description: string | null;
    imageUrl: string | null;
    siteName: string | null;
    status: 'ok' | 'failed' | 'blocked';
}

export interface FetchPreviewOptions {
    /** Bypass the persistent cache (re-fetch even if a fresh row exists). */
    skipCache?: boolean;
}

// === Limits / constants =====================================================

export const LINK_PREVIEW_USER_AGENT = 'UniverKstuLinkPreview/1.0';
export const LINK_PREVIEW_TIMEOUT_MS = 5_000;
export const LINK_PREVIEW_MAX_BYTES = 256 * 1024;
export const LINK_PREVIEW_MAX_REDIRECTS = 3;
export const LINK_PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const URL_REGEX = /https?:\/\/[^\s<>"'`]+/i;
const URL_REGEX_GLOBAL = /https?:\/\/[^\s<>"'`]+/gi;

// === Pure helpers ===========================================================

/**
 * Normalize a URL for cache key purposes:
 *  - trim whitespace
 *  - validate http/https scheme
 *  - lowercase host
 *  - drop the fragment
 *  - strip a trailing `/` from a path-less URL
 *
 * Returns `null` when the input is not a parseable http(s) URL.
 */
export function normalizeUrl(input: string): string | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }
    const scheme = parsed.protocol.toLowerCase();
    if (scheme !== 'http:' && scheme !== 'https:') return null;
    parsed.protocol = scheme;
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = '';
    let out = parsed.toString();
    // URL serialization always adds a trailing slash for empty paths; strip it
    // so `https://example.com` and `https://example.com/` hash identically.
    if ((parsed.pathname === '/' || parsed.pathname === '') && !parsed.search) {
        out = out.replace(/\/$/, '');
    }
    return out;
}

/**
 * Return the first http/https URL embedded in a free-form text body, or null
 * when none is present. Matches the URL-detection rule we use both server-side
 * (extract on write) and client-side (highlight on render).
 *
 * Trailing punctuation that is NOT a valid URL char is trimmed conservatively
 * — `(`, `)`, `,`, `.`, `;`, `!`, `?`, `'`, `"`. We do not attempt to balance
 * parentheses; trimming a single trailing run is enough for typical chat text
 * like "see https://foo.com/a." or "(https://foo.com)".
 */
export function extractFirstUrl(text: string): string | null {
    if (typeof text !== 'string' || text.length === 0) return null;
    URL_REGEX_GLOBAL.lastIndex = 0;
    const match = text.match(URL_REGEX);
    if (!match) return null;
    let candidate = match[0];
    // Strip trailing punctuation that is almost never part of a URL.
    candidate = candidate.replace(/[).,;:!?'"`]+$/g, '');
    if (candidate.length === 0) return null;
    return candidate;
}

/** sha256(normalizeUrl(url)) hex digest, used as the cache PK. */
export function hashUrl(url: string): string {
    return createHash('sha256').update(url).digest('hex');
}

/**
 * Parse Open Graph + minimal fallback metadata out of an HTML document body.
 * Pure string parsing — no DOM library required. Returns at most the four
 * fields the cache schema persists; missing fields stay `null`.
 *
 * Recognized inputs:
 *   <meta property="og:title" content="...">
 *   <meta name="og:title" content="...">
 *   <meta property="og:description" ...>
 *   <meta property="og:image" ...>
 *   <meta property="og:site_name" ...>
 *   <title>...</title>                    (fallback for title)
 *   <meta name="description" ...>         (fallback for description)
 */
export function parseOpenGraph(html: string): Partial<LinkPreview> {
    if (typeof html !== 'string' || html.length === 0) return {};
    const out: Partial<LinkPreview> = {};

    // Limit scan window to the <head> region when present — keeps the regex
    // scan cheap on long pages.
    const headEnd = html.search(/<\/head>/i);
    const scope = headEnd >= 0 ? html.slice(0, headEnd) : html.slice(0, 65_536);

    const metaRegex = /<meta\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = metaRegex.exec(scope)) !== null) {
        const tag = match[0];
        const key = extractAttr(tag, 'property') ?? extractAttr(tag, 'name');
        const value = extractAttr(tag, 'content');
        if (!key || !value) continue;
        const lower = key.toLowerCase();
        const cleaned = decodeHtmlEntities(value).trim();
        if (cleaned.length === 0) continue;
        if (lower === 'og:title' && !out.title) out.title = cleaned;
        else if (lower === 'og:description' && !out.description) out.description = cleaned;
        else if (lower === 'og:image' && !out.imageUrl) out.imageUrl = cleaned;
        else if (lower === 'og:site_name' && !out.siteName) out.siteName = cleaned;
        else if (lower === 'twitter:title' && !out.title) out.title = cleaned;
        else if (lower === 'twitter:description' && !out.description) out.description = cleaned;
        else if (lower === 'twitter:image' && !out.imageUrl) out.imageUrl = cleaned;
        else if (lower === 'description' && !out.description) out.description = cleaned;
    }

    // <title> fallback when no og:title was found.
    if (!out.title) {
        const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(scope);
        if (titleMatch) {
            const cleaned = decodeHtmlEntities(titleMatch[1] || '').trim();
            if (cleaned.length > 0) out.title = cleaned;
        }
    }

    // The image URL is handed straight to the frontend and rendered as an
    // <img src>, so hold it to the same scheme allowlist `normalizeUrl` applies
    // to og:url. Anything that is not an absolute http(s) URL (javascript:,
    // data:, a relative path we have no base for) is dropped rather than
    // forwarded.
    if (out.imageUrl) {
        out.imageUrl = sanitizeImageUrl(out.imageUrl);
    }

    // Cap field lengths so a misbehaving page can't bloat the cache row.
    if (out.title && out.title.length > 300) out.title = out.title.slice(0, 300);
    if (out.description && out.description.length > 1000) out.description = out.description.slice(0, 1000);
    if (out.imageUrl && out.imageUrl.length > 2000) out.imageUrl = out.imageUrl.slice(0, 2000);
    if (out.siteName && out.siteName.length > 200) out.siteName = out.siteName.slice(0, 200);

    return out;
}

/**
 * Keep an `og:image` / `twitter:image` value only when it is an absolute
 * http(s) URL. Returns null for every other input. Exported for unit testing.
 */
export function sanitizeImageUrl(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        return null;
    }
    const scheme = parsed.protocol.toLowerCase();
    if (scheme !== 'http:' && scheme !== 'https:') return null;
    return trimmed;
}

function extractAttr(tag: string, attr: string): string | null {
    // Tolerant attribute extractor — covers `attr="value"`, `attr='value'`,
    // and bareword attributes (`attr=value`). HTML is case-insensitive.
    const re = new RegExp(`\\b${attr}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
    const m = tag.match(re);
    if (!m) return null;
    return m[2] ?? m[3] ?? m[4] ?? null;
}

function decodeHtmlEntities(value: string): string {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => {
            const n = Number(code);
            return Number.isFinite(n) && n >= 32 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
        });
}

// === SSRF guards ============================================================

/**
 * Return true when the given IPv4 / IPv6 string sits inside a private,
 * loopback, link-local, multicast or otherwise non-routable range. Caller
 * MUST short-circuit fetch requests against any host that resolves to such
 * an IP.
 *
 * Covered ranges (the common SSRF blocklist):
 *   IPv4:  0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16,
 *          172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.88.99.0/24,
 *          192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24,
 *          224.0.0.0/4 (multicast), 240.0.0.0/4 (reserved), 255.255.255.255
 *   IPv6:  ::, ::1, fc00::/7 (ULA), fe80::/10 (link-local), ff00::/8 (multicast),
 *          ::ffff:0:0/96 (IPv4-mapped, recursively checked)
 */
export function isPrivateOrLoopbackIp(ip: string): boolean {
    if (typeof ip !== 'string' || ip.length === 0) return true;
    const fam = isIP(ip);
    if (fam === 4) return isPrivateIPv4(ip);
    if (fam === 6) return isPrivateIPv6(ip);
    // Not a parseable IP — treat as unsafe so we never accidentally fetch via
    // some host-style address we don't understand.
    return true;
}

function isPrivateIPv4(ip: string): boolean {
    const parts = ip.split('.').map((n) => Number(n));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) {
        return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // 127.0.0.0/8
    if (a === 169 && b === 254) return true; // 169.254.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 + 192.0.2.0/24
    if (a === 192 && b === 88) return true; // 192.88.99.0/24
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15
    if (a === 198 && b === 51) return true; // 198.51.100.0/24
    if (a === 203 && b === 0) return true; // 203.0.113.0/24
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
    if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
    return false;
}

function isPrivateIPv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    // IPv4-mapped IPv6: ::ffff:a.b.c.d — recurse on the IPv4 portion
    const v4MappedRe = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i;
    const mapped = v4MappedRe.exec(lower);
    if (mapped) return isPrivateIPv4(mapped[1]);
    // ULA fc00::/7
    if (/^f[cd][0-9a-f]{2}:/i.test(lower)) return true;
    // Link-local fe80::/10
    if (/^fe[89ab][0-9a-f]:/i.test(lower)) return true;
    // Multicast ff00::/8
    if (/^ff[0-9a-f]{2}:/i.test(lower)) return true;
    return false;
}

/**
 * Resolve a hostname's first IP via DNS and verify it is not private/loopback.
 * Returns the resolved IP on success, or `null` when the host resolves to a
 * disallowed range (caller must treat null as a `blocked` status).
 *
 * Note: this still has a small TOCTOU window (an attacker could swap DNS
 * between our check and the actual axios fetch). For our threat model — a
 * defaulted-on link-preview feature on a small student app — the window is
 * acceptable. A future hardening pass can pin the resolved IP into axios via
 * a custom `httpAgent`.
 */
async function assertSafePublicHost(hostname: string): Promise<string | null> {
    if (typeof hostname !== 'string' || hostname.length === 0) return null;
    // If the hostname IS already an IP literal, check it directly.
    if (isIP(hostname)) {
        return isPrivateOrLoopbackIp(hostname) ? null : hostname;
    }
    // Block bare-name lookups that the OS may resolve via hosts file shenanigans.
    if (hostname === 'localhost' || hostname.endsWith('.localhost')) return null;
    try {
        const records = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
        if (!records || records.length === 0) return null;
        for (const r of records) {
            if (isPrivateOrLoopbackIp(r.address)) return null;
        }
        return records[0].address;
    } catch {
        return null;
    }
}

// === HTTP fetch + parsing ===================================================

interface FetchResult {
    status: 'ok' | 'failed' | 'blocked';
    meta?: Partial<LinkPreview>;
}

/**
 * Build http/https agents whose DNS `lookup` always answers with the single IP
 * we already validated. The hostname is still what axios sends in `Host:` and
 * what TLS uses for SNI / certificate verification — only the address the socket
 * dials is pinned. This is what makes `assertSafePublicHost` binding rather than
 * advisory: a second DNS answer (rebinding) can no longer redirect the socket to
 * a private address after the check passed.
 */
function buildPinnedAgents(ip: string): { httpAgent: HttpAgent; httpsAgent: HttpsAgent } {
    const family = isIP(ip);
    const lookup: LookupFunction = (_hostname, options, callback) => {
        // Node calls this with `{ all: true }` in some paths and expects an array
        // of records back; otherwise it wants (address, family) positionally.
        if (options && options.all) {
            callback(null, [{ address: ip, family }]);
        } else {
            callback(null, ip, family);
        }
    };

    return {
        httpAgent: new HttpAgent({ lookup }),
        httpsAgent: new HttpsAgent({ lookup }),
    };
}

/**
 * Extract the `Location` header from a 3xx response, resolved against the URL
 * that produced it. Returns null when the header is missing or unparseable.
 * Exported for unit testing.
 */
export function resolveRedirectTarget(location: unknown, currentUrl: string): string | null {
    if (typeof location !== 'string') return null;
    const trimmed = location.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed, currentUrl).toString();
    } catch {
        return null;
    }
}

/**
 * Fetch the target document, following redirects MANUALLY.
 *
 * axios' own `maxRedirects` follows hops inside the underlying request without
 * giving us a chance to look at them, which would leave hops 2..N unvalidated —
 * a public host could answer `302 Location: http://169.254.169.254/...` and the
 * follow-up request would hit internal infrastructure. So we set
 * `maxRedirects: 0` and re-run the full scheme + DNS + IP-range gate on every
 * hop before issuing the next request, capped at `LINK_PREVIEW_MAX_REDIRECTS`.
 */
async function fetchHtmlForPreview(url: string): Promise<FetchResult> {
    let currentUrl = url;

    // hop 0 is the original request; hops 1..MAX are the followed redirects.
    for (let hop = 0; hop <= LINK_PREVIEW_MAX_REDIRECTS; hop += 1) {
        let parsed: URL;
        try {
            parsed = new URL(currentUrl);
        } catch {
            return { status: 'failed' };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { status: 'blocked' };
        }
        const resolved = await assertSafePublicHost(parsed.hostname);
        if (!resolved) return { status: 'blocked' };

        let response: AxiosResponse<unknown>;
        try {
            response = await axios.get(currentUrl, {
                timeout: LINK_PREVIEW_TIMEOUT_MS,
                // Never let axios follow a hop we haven't validated ourselves.
                maxRedirects: 0,
                maxContentLength: LINK_PREVIEW_MAX_BYTES,
                // Defensive: stop the downloader once we've read the cap even if
                // upstream lies about Content-Length.
                maxBodyLength: LINK_PREVIEW_MAX_BYTES,
                responseType: 'text',
                transformResponse: [(data: unknown) => data], // keep as raw string
                headers: {
                    'User-Agent': LINK_PREVIEW_USER_AGENT,
                    Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
                    'Accept-Language': 'en-US,en;q=0.5,ru;q=0.3',
                },
                ...buildPinnedAgents(resolved),
                // Treat 4xx as failure (no retries, but also no exception storms);
                // 3xx must reach us as a normal response so we can inspect it.
                validateStatus: (status) => status >= 200 && status < 400,
            });
        } catch {
            // ECONNREFUSED/ENOTFOUND etc. → failed (host is unreachable). We could
            // arguably bucket as `blocked` but `failed` is fine since we already
            // ran the SSRF check before issuing the request.
            return { status: 'failed' };
        }

        if (response.status >= 300 && response.status < 400) {
            const next = resolveRedirectTarget(response.headers?.['location'], currentUrl);
            if (!next) return { status: 'failed' };
            currentUrl = next;
            continue;
        }

        const contentType = String(response.headers['content-type'] || '').toLowerCase();
        if (contentType && !contentType.includes('html') && !contentType.includes('xml')) {
            return { status: 'failed' };
        }
        const body = typeof response.data === 'string' ? response.data : '';
        if (!body) return { status: 'failed' };
        const truncated = body.length > LINK_PREVIEW_MAX_BYTES ? body.slice(0, LINK_PREVIEW_MAX_BYTES) : body;
        const meta = parseOpenGraph(truncated);
        return { status: 'ok', meta };
    }

    // Redirect budget exhausted — treat like any other unusable upstream.
    return { status: 'failed' };
}

// === Persistent cache layer =================================================

interface CacheRow {
    url_hash: string;
    url: string;
    title: string | null;
    description: string | null;
    image_url: string | null;
    site_name: string | null;
    fetched_at: Date | string;
    expires_at: Date | string;
    status: string;
}

async function readCache(client: PoolClient, urlHash: string): Promise<CacheRow | null> {
    const res = await client.query<CacheRow>(
        `select url_hash, url, title, description, image_url, site_name, fetched_at, expires_at, status
         from app_link_preview_cache where url_hash = $1`,
        [urlHash],
    );
    if (res.rowCount === 0) return null;
    return res.rows[0];
}

async function writeCache(
    client: PoolClient,
    urlHash: string,
    preview: LinkPreview,
): Promise<void> {
    await client.query(
        `
            insert into app_link_preview_cache (
                url_hash, url, title, description, image_url, site_name,
                fetched_at, expires_at, status
            )
            values ($1, $2, $3, $4, $5, $6, now(), now() + interval '7 days', $7)
            on conflict (url_hash) do update set
                url = excluded.url,
                title = excluded.title,
                description = excluded.description,
                image_url = excluded.image_url,
                site_name = excluded.site_name,
                fetched_at = excluded.fetched_at,
                expires_at = excluded.expires_at,
                status = excluded.status
        `,
        [
            urlHash,
            preview.url,
            preview.title,
            preview.description,
            preview.imageUrl,
            preview.siteName,
            preview.status,
        ],
    );
}

function rowToPreview(row: CacheRow): LinkPreview {
    const status: LinkPreview['status'] =
        row.status === 'ok' || row.status === 'failed' || row.status === 'blocked'
            ? row.status
            : 'failed';
    return {
        url: row.url,
        title: row.title ?? null,
        description: row.description ?? null,
        imageUrl: row.image_url ?? null,
        siteName: row.site_name ?? null,
        status,
    };
}

function isExpired(row: CacheRow): boolean {
    const t = row.expires_at instanceof Date ? row.expires_at.getTime() : new Date(row.expires_at).getTime();
    if (!Number.isFinite(t)) return true;
    return t <= Date.now();
}

// === Public service surface =================================================

/**
 * Resolve the preview for a single URL. Cache hits return synchronously; cache
 * misses (or expired entries) fetch and persist the new row before returning.
 *
 * Returns a `blocked` preview when the SSRF gate refuses the target. Returns
 * a `failed` preview when the upstream is unreachable or non-HTML. Never
 * throws on a network error — the caller is the messaging UI and we degrade
 * gracefully by showing the raw URL.
 */
export async function fetchPreview(
    url: string,
    opts: FetchPreviewOptions = {},
): Promise<LinkPreview> {
    const normalized = normalizeUrl(url);
    if (!normalized) {
        return {
            url,
            title: null,
            description: null,
            imageUrl: null,
            siteName: null,
            status: 'failed',
        };
    }
    const urlHash = hashUrl(normalized);

    // Cache lookup — if we have a fresh row, return it.
    if (!opts.skipCache) {
        const cached = await withSupabasePostgres((client) => readCache(client, urlHash));
        if (cached && !isExpired(cached)) {
            return rowToPreview(cached);
        }
    }

    // Fetch + parse.
    const result = await fetchHtmlForPreview(normalized);
    const preview: LinkPreview = {
        url: normalized,
        title: result.meta?.title ?? null,
        description: result.meta?.description ?? null,
        imageUrl: result.meta?.imageUrl ?? null,
        siteName: result.meta?.siteName ?? null,
        status: result.status,
    };

    // Cache write — best-effort. A PG outage must NOT propagate to the caller.
    try {
        await withSupabasePostgres((client) => writeCache(client, urlHash, preview));
    } catch (err) {
        console.warn('[link-previews] failed to persist cache row:', err);
    }

    return preview;
}

/**
 * Batch resolve previews for a list of URLs. Duplicates are collapsed before
 * the upstream fetches; the returned list preserves the input order (1:1) so
 * callers can zip the results onto their messages without a follow-up lookup.
 */
export async function batchFetchPreviews(urls: string[]): Promise<LinkPreview[]> {
    if (!Array.isArray(urls) || urls.length === 0) return [];
    const dedup = new Map<string, Promise<LinkPreview>>();
    return Promise.all(
        urls.map((u) => {
            const key = normalizeUrl(u) ?? u;
            let pending = dedup.get(key);
            if (!pending) {
                pending = fetchPreview(u);
                dedup.set(key, pending);
            }
            return pending;
        }),
    );
}

/**
 * Background helper invoked from the social CRUD layer after a write. Fires
 * `fetchPreview` for the first URL found in the supplied text and swallows
 * any failure — link previews are best-effort enrichment and must never fail
 * the originating write.
 */
export function prefetchLinkPreviewForText(text: string | null | undefined): void {
    if (!text) return;
    const url = extractFirstUrl(text);
    if (!url) return;
    // Intentionally fire-and-forget. The DB write happens inside fetchPreview;
    // we just need the side effect.
    void fetchPreview(url).catch((err) => {
        console.warn('[link-previews] prefetch failed:', err);
    });
}
