/**
 * Service worker update helper.
 *
 * The browser registers `/sw.js` from `lib/push-subscription.ts` (and a few
 * other entry points). When a new version is published, the existing tab still
 * controls the page with the old SW until either the user closes all tabs or
 * we call `skipWaiting` from the new worker and the browser swaps controllers.
 *
 * `subscribeToSwUpdates` exposes a tiny imperative surface that fires
 * `onUpdateAvailable` exactly once per browser session when a fresh worker
 * becomes the active controller — the UI layer then shows a toast offering
 * a reload.
 *
 * We deliberately keep this module DOM-free (no React) so it can be invoked
 * inside `useEffect` or even bare `<script>` glue without dragging extra deps.
 */
'use client';

/**
 * Subscribe to service-worker controller swaps. Returns an unsubscribe fn.
 *
 * The callback fires on the *second* controller for a tab — the first
 * `controllerchange` after a hard refresh just installs the SW for the first
 * time and should not surface as "a new version is available".
 */
export function subscribeToSwUpdates(onUpdateAvailable: () => void): () => void {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
        return () => undefined;
    }

    // If we were loaded without a controller (very first SW install), the
    // upcoming controllerchange is just the initial activation, not a real
    // update. Skip exactly one event in that case.
    let skipNext = !navigator.serviceWorker.controller;
    let fired = false;

    const handler = () => {
        if (skipNext) {
            skipNext = false;
            return;
        }
        if (fired) return;
        fired = true;
        try {
            onUpdateAvailable();
        } catch {
            // Never let UI code break the SW glue.
        }
    };

    navigator.serviceWorker.addEventListener('controllerchange', handler);
    return () => {
        navigator.serviceWorker.removeEventListener('controllerchange', handler);
    };
}
