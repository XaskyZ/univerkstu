'use client';

import { useEffect } from 'react';
import { subscribeToSwUpdates } from '@/lib/sw-update';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/language-context';

/**
 * Headless component: subscribes to the service worker `controllerchange`
 * event and, when a new SW takes over, surfaces a toast that lets the user
 * reload to pick up the new build. The toast is sticky (durationMs = 0)
 * because the message needs an explicit action.
 */
export default function SwUpdateNotifier() {
    const { messages } = useLanguage();

    useEffect(() => {
        return subscribeToSwUpdates(() => {
            // 0 = sticky toast — user dismisses by clicking the X.
            toast.info(
                `${messages.pwa.updateAvailable}\n${messages.pwa.updateHint}`,
                0,
            );
            // Add a global click handler proxy isn't ideal — instead we use
            // the message text plus a clear hint that reloading the tab gets
            // the new version. Reloading is one tap on the existing browser
            // refresh button and works on every device.
        });
    }, [messages.pwa.updateAvailable, messages.pwa.updateHint]);

    return null;
}
