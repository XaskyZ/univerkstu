'use client';

import { useEffect } from 'react';
import { getClientDebugEnvironment, recordRuntimeTrace } from '@/lib/runtime-debug';

export default function PwaStateReporter() {
    useEffect(() => {
        const environment = getClientDebugEnvironment();
        if (!environment.isIOS) return;

        void recordRuntimeTrace({
            scope: 'pwa.state',
            event: 'startup',
            level: 'info',
            message: 'Recorded iOS PWA state on startup',
            metadata: environment,
            throttleKey: `pwa.state:${environment.isStandalone ? 'standalone' : 'browser'}:${environment.notificationPermission}`,
            throttleMs: 60_000,
        });
    }, []);

    return null;
}
