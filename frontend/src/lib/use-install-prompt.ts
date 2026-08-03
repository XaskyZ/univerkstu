'use client';

import { useCallback, useEffect, useState } from 'react';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { recordRuntimeTrace } from '@/lib/runtime-debug';

interface BeforeInstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export type InstallPromptStatus = 'checking' | 'available' | 'installed' | 'manual' | 'unavailable';

export interface InstallPromptState {
    status: InstallPromptStatus;
    available: boolean;
    isIos: boolean;
    isStandalone: boolean;
    dismissed: boolean;
    /**
     * Trigger the native install prompt. Resolves to true if the user accepted
     * the install, false if they dismissed it or the prompt was not available.
     */
    prompt: () => Promise<boolean>;
}

function isIosDevice(): boolean {
    if (typeof window === 'undefined') return false;
    return /iPhone|iPad|iPod/i.test(window.navigator.userAgent);
}

function isStandaloneApp(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)')?.matches
        || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function getInitialStatus(): InstallPromptStatus {
    if (isStandaloneApp()) return 'installed';
    if (isIosDevice()) return 'manual';
    return 'unavailable';
}

async function ensureServiceWorker() {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    try {
        const existing = await navigator.serviceWorker.getRegistration();
        if (existing) return;
        await navigator.serviceWorker.register('/sw.js');
    } catch {
        // Silent — install UI must not break the host page.
    }
}

/**
 * Hook that captures the `beforeinstallprompt` event, tracks dismissal, and
 * exposes a typed prompt() so any UI (bottom sheet, settings row, modal) can
 * trigger installation. Extracted from SettingsInstallCard so the new bottom
 * sheet can reuse the same logic.
 */
export function useInstallPrompt(): InstallPromptState {
    const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
    const [status, setStatus] = useState<InstallPromptStatus>(() => getInitialStatus());
    const [dismissed, setDismissed] = useState(false);
    const [isIos] = useState(() => isIosDevice());
    const [isStandalone] = useState(() => isStandaloneApp());

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setDeferred(event as BeforeInstallPromptEvent);
            setStatus('available');
            trackAnalyticsEvent('install_prompt_available', {
                feature: 'pwa_install',
                label: 'beforeinstallprompt',
                path: '/settings',
            });
        };

        const handleAppInstalled = () => {
            setDeferred(null);
            setStatus('installed');
            trackAnalyticsEvent('install_prompt_accepted', {
                feature: 'pwa_install',
                label: 'appinstalled',
                status: 'installed',
                path: '/settings',
            });
        };

        void ensureServiceWorker();
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    useEffect(() => {
        if (!isIos) return;
        void recordRuntimeTrace({
            scope: 'pwa.install',
            event: 'state',
            level: 'info',
            message: `iOS install state is ${status}`,
            metadata: {
                installStatus: status,
                hasDeferredPrompt: Boolean(deferred),
            },
            throttleKey: `pwa.install:${status}:${deferred ? 'prompt' : 'no-prompt'}`,
            throttleMs: 60_000,
        });
    }, [deferred, status, isIos]);

    const prompt = useCallback(async (): Promise<boolean> => {
        if (!deferred) return false;
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === 'accepted') {
            setDeferred(null);
            setStatus('installed');
            trackAnalyticsEvent('install_prompt_accepted', {
                feature: 'pwa_install',
                label: choice.platform || 'browser',
                status: 'accepted',
                path: '/settings',
            });
            return true;
        }
        setDeferred(null);
        setStatus('unavailable');
        setDismissed(true);
        trackAnalyticsEvent('install_prompt_dismissed', {
            feature: 'pwa_install',
            label: choice.platform || 'browser',
            status: 'dismissed',
            path: '/settings',
        });
        return false;
    }, [deferred]);

    return {
        status,
        available: Boolean(deferred) && status === 'available',
        isIos,
        isStandalone,
        dismissed,
        prompt,
    };
}
