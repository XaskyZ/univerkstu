/**
 * UniverSchedule service worker.
 *
 * Responsibilities:
 *  - Push notifications (existing behaviour — must not regress).
 *  - Offline shell precache for the schedule landing experience.
 *  - Network-first HTML navigation with a cached fallback.
 *  - Stale-while-revalidate for `/api/v3/schedule/*` GET requests
 *    (keeps only the most recent response per URL to bound storage).
 *
 * Bump `CACHE_VERSION` whenever the cache layout changes so old caches
 * get pruned in the `activate` step.
 */

const CACHE_VERSION = 'v1';
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const HTML_CACHE = `html-${CACHE_VERSION}`;
const API_SCHEDULE_CACHE = `api-schedule-${CACHE_VERSION}`;
const OWNED_CACHES = new Set([SHELL_CACHE, HTML_CACHE, API_SCHEDULE_CACHE]);

const SHELL_URLS = [
    '/',
    '/schedule',
    '/manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png',
    '/android-chrome-192x192.png',
    '/android-chrome-512x512.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        try {
            const cache = await caches.open(SHELL_CACHE);
            // Use individual add() calls so a single 404/redirect doesn't
            // abort the whole precache step (e.g. if an icon is missing in
            // a dev branch).
            await Promise.all(SHELL_URLS.map(async (url) => {
                try {
                    await cache.add(url);
                } catch {
                    // Tolerate optional shell assets that might not exist.
                }
            }));
        } catch {
            // Cache API unavailable — skip precache silently.
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        try {
            const keys = await caches.keys();
            await Promise.all(keys.map((key) => {
                if (!OWNED_CACHES.has(key)) {
                    return caches.delete(key);
                }
                return Promise.resolve(false);
            }));
        } catch {
            // ignore — activation must continue regardless
        }
        await self.clients.claim();
    })());
});

/**
 * `stale-while-revalidate` for one URL. We store at most a single entry per
 * URL so the cache footprint stays bounded even after weeks of use.
 */
async function staleWhileRevalidate(request, cacheName) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const network = fetch(request)
        .then(async (response) => {
            if (response && response.ok) {
                try {
                    // Replace previous entry for this URL keeps quota bounded.
                    await cache.put(request, response.clone());
                } catch {
                    // Quota exceeded or opaque response — silently ignore.
                }
            }
            return response;
        })
        .catch(() => null);
    if (cached) {
        // Kick off background revalidation but return cache immediately.
        network.catch(() => undefined);
        return cached;
    }
    const networkResponse = await network;
    if (networkResponse) return networkResponse;
    return new Response(JSON.stringify({ success: false, error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * Network-first HTML navigation with cache fallback. We keep HTML responses
 * in a dedicated cache so the precached `/schedule` shell still survives.
 */
async function networkFirstHtml(request) {
    const cache = await caches.open(HTML_CACHE);
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            try {
                await cache.put(request, response.clone());
            } catch {
                // ignore quota errors
            }
        }
        return response;
    } catch {
        const cached = await cache.match(request);
        if (cached) return cached;
        const shellCache = await caches.open(SHELL_CACHE);
        const shellHit = (await shellCache.match('/schedule'))
            || (await shellCache.match('/'));
        if (shellHit) return shellHit;
        return new Response('Offline', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    }
}

function isHtmlNavigation(request) {
    if (request.method !== 'GET') return false;
    if (request.mode === 'navigate') return true;
    const accept = request.headers.get('accept') || '';
    return accept.includes('text/html');
}

function isScheduleApi(url) {
    if (url.pathname.startsWith('/api/v3/schedule')) return true;
    return false;
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (request.method !== 'GET') return;

    let url;
    try {
        url = new URL(request.url);
    } catch {
        return;
    }
    if (url.origin !== self.location.origin) return;

    if (isScheduleApi(url)) {
        event.respondWith(staleWhileRevalidate(request, API_SCHEDULE_CACHE));
        return;
    }

    if (isHtmlNavigation(request)) {
        event.respondWith(networkFirstHtml(request));
        return;
    }

    // Everything else — leave to the browser default.
});

self.addEventListener('push', (event) => {
    let payload = {};
    try {
        payload = event.data ? event.data.json() : {};
    } catch {}
    const title = payload.title || 'UniverSchedule';
    const options = {
        body: payload.body || '',
        icon: '/android-chrome-192x192.png',
        badge: '/android-chrome-192x192.png',
        tag: payload.tag || 'exam-reminder',
        data: { url: payload.url || '/exams' },
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = (event.notification.data && event.notification.data.url) || '/exams';
    event.waitUntil((async () => {
        const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        for (const c of all) {
            if (c.url.includes(target)) {
                c.focus();
                return;
            }
        }
        await self.clients.openWindow(target);
    })());
});
