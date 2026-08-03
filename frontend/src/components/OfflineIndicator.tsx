'use client';

import { useEffect, useRef } from 'react';
import { toast, dismissToast } from '@/lib/toast';
import { useLanguage } from '@/lib/language-context';

/**
 * Headless component: watches the browser's online/offline state and surfaces a
 * sticky toast while the device is offline, plus a brief "back online" toast on
 * reconnect. Gives users a clear, proactive signal instead of only seeing
 * per-request "poor connection" errors after an action fails.
 */
export default function OfflineIndicator() {
    const { language } = useLanguage();
    const offlineToastId = useRef<number | null>(null);

    useEffect(() => {
        const text = {
            ru: {
                offline: 'Нет подключения к интернету. Работаем в офлайн-режиме.',
                online: 'Соединение восстановлено',
            },
            kz: {
                offline: 'Интернет байланысы жоқ. Офлайн режимінде жұмыс істеудеміз.',
                online: 'Байланыс қалпына келтірілді',
            },
            en: {
                offline: 'No internet connection. Working offline.',
                online: 'Back online',
            },
        }[language];

        const showOffline = () => {
            if (offlineToastId.current != null) return; // already shown
            offlineToastId.current = toast.error(text.offline, 0); // 0 = sticky
        };

        const clearOffline = (announceReconnect: boolean) => {
            if (offlineToastId.current == null) return;
            dismissToast(offlineToastId.current);
            offlineToastId.current = null;
            if (announceReconnect) toast.success(text.online, 2500);
        };

        const handleOffline = () => showOffline();
        const handleOnline = () => clearOffline(true);

        window.addEventListener('offline', handleOffline);
        window.addEventListener('online', handleOnline);

        // Reflect the current state on mount / language change.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            showOffline();
        }

        return () => {
            window.removeEventListener('offline', handleOffline);
            window.removeEventListener('online', handleOnline);
            // Avoid leaving a dangling sticky toast if we unmount or re-run.
            clearOffline(false);
        };
    }, [language]);

    return null;
}
