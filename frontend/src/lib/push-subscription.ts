/**
 * Push subscription helper for exam reminders.
 *
 * Wraps the browser Push API (PushManager, Notification.permission) and the
 * backend `/api/v3/notifications/*` endpoints behind a small, typed surface so
 * the settings UI can stay focused on UX. All network calls go through
 * `fetchWithAuth` so cookies/Authorization + envelope conventions are reused.
 *
 * Never call `Notification.requestPermission()` outside of a user click — the
 * caller of `enableExamPush()` must already be inside a click handler.
 */
'use client';

import { fetchWithAuth, type ApiResponse } from '@/lib/api/core';
import { getNotificationCapability } from '@/lib/runtime-debug';

export interface ExamRemindersPrefs {
    enabled: boolean;
    oneDay: boolean;
    oneHour: boolean;
}

export type PushCapabilityReason = 'unsupported' | 'ios_pwa_required' | 'no_push_manager';

export interface PushCapability {
    supported: boolean;
    reason?: PushCapabilityReason;
}

export type EnableResult =
    | { ok: true }
    | {
          ok: false;
          reason:
              | 'unsupported'
              | 'ios_pwa_required'
              | 'no_push_manager'
              | 'denied'
              | 'no_public_key'
              | 'subscribe_failed'
              | 'backend_failed';
          message?: string;
      };

export interface DisableResult {
    ok: boolean;
    message?: string;
}

/**
 * Inspect runtime capability for web-push. Reuses the same iOS-PWA check used
 * by the schedule notifications layer, but additionally requires `PushManager`
 * on `window` since the exam reminders rely on server-pushed messages.
 */
export function getCapability(): PushCapability {
    if (typeof window === 'undefined') {
        return { supported: false, reason: 'unsupported' };
    }
    const base = getNotificationCapability();
    if (!base.supported) {
        return {
            supported: false,
            reason: base.reason === 'ios_pwa_required' ? 'ios_pwa_required' : 'unsupported',
        };
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        return { supported: false, reason: 'no_push_manager' };
    }
    return { supported: true };
}

/**
 * Lookup the currently active push subscription via the service worker
 * registration. Returns `null` when the SW is not yet ready or no subscription
 * exists.
 */
export async function getCurrentSubscription(): Promise<PushSubscription | null> {
    if (typeof window === 'undefined') return null;
    if (!('serviceWorker' in navigator)) return null;
    try {
        const registration = await navigator.serviceWorker.ready;
        return await registration.pushManager.getSubscription();
    } catch {
        return null;
    }
}

/**
 * Convert the base64url VAPID public key to an ArrayBuffer that
 * `PushManager.subscribe` accepts. We return an ArrayBuffer directly so the
 * shape unambiguously matches the `BufferSource` overload — under strict TS
 * the Uint8Array<ArrayBufferLike> shape produced by `new Uint8Array(n)` no
 * longer narrows to `ArrayBufferView<ArrayBuffer>`.
 */
function urlBase64ToBuffer(base64String: string): ArrayBuffer {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const buffer = new ArrayBuffer(rawData.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < rawData.length; i++) {
        view[i] = rawData.charCodeAt(i);
    }
    return buffer;
}

interface PublicKeyResponse extends ApiResponse {
    publicKey?: string;
}

async function fetchVapidPublicKey(): Promise<string | null> {
    const response = await fetchWithAuth<unknown>('/api/v3/notifications/public-key');
    const data = response as PublicKeyResponse;
    if (!data.success || typeof data.publicKey !== 'string' || !data.publicKey) {
        return null;
    }
    return data.publicKey;
}

/**
 * Full subscribe flow:
 *  1. Capability check
 *  2. Notification.requestPermission (must already be in a user gesture)
 *  3. Fetch VAPID public key
 *  4. PushManager.subscribe
 *  5. POST subscription JSON + userAgent to the backend
 */
export async function enableExamPush(): Promise<EnableResult> {
    const capability = getCapability();
    if (!capability.supported) {
        return { ok: false, reason: capability.reason ?? 'unsupported' };
    }

    let permission: NotificationPermission = Notification.permission;
    if (permission !== 'granted') {
        try {
            permission = await Notification.requestPermission();
        } catch (error) {
            return {
                ok: false,
                reason: 'denied',
                message: error instanceof Error ? error.message : 'permission_error',
            };
        }
    }
    if (permission !== 'granted') {
        return { ok: false, reason: 'denied' };
    }

    const publicKey = await fetchVapidPublicKey();
    if (!publicKey) {
        return { ok: false, reason: 'no_public_key' };
    }

    let registration: ServiceWorkerRegistration;
    try {
        registration = await navigator.serviceWorker.ready;
    } catch (error) {
        return {
            ok: false,
            reason: 'subscribe_failed',
            message: error instanceof Error ? error.message : 'sw_not_ready',
        };
    }

    let subscription: PushSubscription;
    try {
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
            subscription = existing;
        } else {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToBuffer(publicKey),
            });
        }
    } catch (error) {
        return {
            ok: false,
            reason: 'subscribe_failed',
            message: error instanceof Error ? error.message : 'subscribe_error',
        };
    }

    const json = subscription.toJSON();
    const endpoint = typeof json.endpoint === 'string' ? json.endpoint : subscription.endpoint;
    const keys = json.keys ?? {};
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh : '';
    const auth = typeof keys.auth === 'string' ? keys.auth : '';
    if (!endpoint || !p256dh || !auth) {
        return { ok: false, reason: 'subscribe_failed', message: 'missing_keys' };
    }

    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 512) : null;
    const response = await fetchWithAuth<unknown>('/api/v3/notifications/subscribe', {
        method: 'POST',
        body: JSON.stringify({ endpoint, keys: { p256dh, auth }, userAgent }),
    });
    if (!response.success) {
        return {
            ok: false,
            reason: 'backend_failed',
            message: response.error,
        };
    }
    return { ok: true };
}

/**
 * Best-effort disable flow: cancels the local push subscription and tells the
 * backend to drop the matching row. Either side may legitimately have nothing
 * to remove; we still report ok in that case.
 */
export async function disableExamPush(): Promise<DisableResult> {
    if (typeof window === 'undefined') {
        return { ok: false, message: 'no_window' };
    }
    const subscription = await getCurrentSubscription();
    const endpoint = subscription?.endpoint ?? null;

    if (subscription) {
        try {
            await subscription.unsubscribe();
        } catch {
            // ignore local unsubscribe failures; we still drop the server record
        }
    }

    if (endpoint) {
        const response = await fetchWithAuth<unknown>('/api/v3/notifications/subscribe', {
            method: 'DELETE',
            body: JSON.stringify({ endpoint }),
        });
        if (!response.success) {
            return { ok: false, message: response.error };
        }
    }
    return { ok: true };
}

interface PrefsResponse extends ApiResponse {
    prefs?: ExamRemindersPrefs;
}

export async function getPrefs(): Promise<{ ok: true; prefs: ExamRemindersPrefs } | { ok: false; message?: string }> {
    const response = await fetchWithAuth<unknown>('/api/v3/notifications/prefs');
    const data = response as PrefsResponse;
    if (!data.success || !data.prefs) {
        return { ok: false, message: data.error };
    }
    return { ok: true, prefs: data.prefs };
}

export async function setPrefs(
    patch: Partial<ExamRemindersPrefs>
): Promise<{ ok: true; prefs: ExamRemindersPrefs } | { ok: false; message?: string }> {
    const response = await fetchWithAuth<unknown>('/api/v3/notifications/prefs', {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });
    const data = response as PrefsResponse;
    if (!data.success || !data.prefs) {
        return { ok: false, message: data.error };
    }
    return { ok: true, prefs: data.prefs };
}

export async function sendTestPush(): Promise<{ ok: boolean; message?: string }> {
    const response = await fetchWithAuth<unknown>('/api/v3/notifications/test', {
        method: 'POST',
        body: JSON.stringify({}),
    });
    if (!response.success) {
        return { ok: false, message: response.error };
    }
    return { ok: true };
}
