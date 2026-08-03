'use client';

export type RuntimeDebugLevel = 'debug' | 'info' | 'warn' | 'error';

export function getClientDebugEnvironment(): Record<string, unknown> {
    if (typeof window === 'undefined') return {};

    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isSafari = /Safari/i.test(ua) && !/Chrome|CriOS|EdgiOS|FxiOS/i.test(ua);
    const isStandalone = window.matchMedia?.('(display-mode: standalone)')?.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

    return {
        ua: ua.slice(0, 200),
        isIOS,
        isSafari,
        isStandalone,
        visibilityState: document.visibilityState,
        notificationSupported: 'Notification' in window,
        notificationPermission: 'Notification' in window ? Notification.permission : 'unsupported',
        serviceWorkerSupported: 'serviceWorker' in navigator,
        online: navigator.onLine,
    };
}

export function getNotificationCapability(): {
    supported: boolean;
    reason: 'unsupported' | 'ios_pwa_required' | null;
    environment: Record<string, unknown>;
} {
    const environment = getClientDebugEnvironment();
    const notificationSupported = environment.notificationSupported === true;
    const isIOS = environment.isIOS === true;
    const isStandalone = environment.isStandalone === true;

    if (!notificationSupported) {
        return { supported: false, reason: 'unsupported', environment };
    }

    if (isIOS && !isStandalone) {
        return { supported: false, reason: 'ios_pwa_required', environment };
    }

    return { supported: true, reason: null, environment };
}

/**
 * Инертная функция: ничего не отправляет. Сохранена, чтобы вызывающий код не
 * менялся.
 */
export async function recordRuntimeTrace(_input: {
    scope: string;
    event: string;
    message: string;
    level?: RuntimeDebugLevel;
    metadata?: Record<string, unknown>;
    throttleKey?: string;
    throttleMs?: number;
}): Promise<void> {
    // намеренно пусто — ничего не отправляем
}
