'use client';

import { useEffect, useState } from 'react';

/**
 * Returns a timestamp that ticks every {tickMs} ms — used to drive lesson
 * progress UI and any other time-sensitive view derivations (upcoming/past
 * exam split, week parity auto-sync, cache-age label).
 *
 * The initial value is `Date.now()` evaluated lazily inside `useState` so that
 * the first render already reflects real wall-clock time. Seeding the clock
 * with the cache timestamp (a common but wrong instinct) made consumers
 * briefly believe it was still the moment data was cached, producing a
 * visible flicker until the first tick.
 */
export function useScheduleClock(tickMs = 2000) {
    const [currentTimestamp, setCurrentTimestamp] = useState(() => Date.now());

    useEffect(() => {
        const timer = window.setInterval(() => {
            setCurrentTimestamp(Date.now());
        }, tickMs);
        return () => window.clearInterval(timer);
    }, [tickMs]);

    return currentTimestamp;
}
