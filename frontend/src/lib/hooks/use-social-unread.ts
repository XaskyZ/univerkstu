'use client';

/**
 * `useSocialUnread` — viewer's unread Notification Center count.
 *
 * Drives the navigation badge. Polls `/api/v3/social/notifications/unread-count`
 * every 30 seconds while the page is visible. Pauses on `visibilitychange =
 * hidden` and resumes (with an immediate refetch) when the tab is foregrounded.
 *
 * Decoupled from the actual list page so it can be called from anywhere in the
 * authenticated shell (BottomNav, future top-bar bell, etc) without re-issuing
 * the network call — but each consumer still gets its own polling loop today.
 * If usage grows, this should move behind a single shared timer + ref-counted
 * subscribers; until then the lightweight per-mount poll is enough.
 *
 * Returns the raw count. The caller is responsible for capping the badge
 * display via `formatUnreadBadge`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getSocialUnreadNotificationCount } from '@/lib/api/social';

const POLL_INTERVAL_MS = 30_000;

export function useSocialUnread(enabled: boolean = true): number {
    const [count, setCount] = useState(0);
    const aliveRef = useRef(true);

    const refresh = useCallback(async () => {
        if (!enabled) return;
        try {
            const result = await getSocialUnreadNotificationCount();
            if (!aliveRef.current) return;
            if (result.success && result.data && Number.isFinite(result.data.count)) {
                setCount(result.data.count);
            }
        } catch {
            // Silent — the badge isn't critical UX. The next poll will retry.
        }
    }, [enabled]);

    useEffect(() => {
        aliveRef.current = true;
        if (!enabled) return undefined;

        let intervalId: number | null = null;

        const start = () => {
            if (intervalId !== null) return;
            void refresh();
            intervalId = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
        };
        const stop = () => {
            if (intervalId !== null) {
                window.clearInterval(intervalId);
                intervalId = null;
            }
        };

        const onVisibility = () => {
            if (document.visibilityState === 'visible') {
                start();
            } else {
                stop();
            }
        };

        if (document.visibilityState === 'visible') {
            start();
        }
        document.addEventListener('visibilitychange', onVisibility);

        return () => {
            aliveRef.current = false;
            stop();
            document.removeEventListener('visibilitychange', onVisibility);
        };
    }, [enabled, refresh]);

    return count;
}
