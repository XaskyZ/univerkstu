'use client';

import { useEffect, useRef, useState } from 'react';

interface AnimatedNumberProps {
    value: number;
    duration?: number;
    format?: (n: number) => string;
    className?: string;
}

/**
 * Counts up smoothly when `value` changes, using rAF + ease-out.
 * Skips animation when prefers-reduced-motion is set, or when the change is
 * smaller than 2 — small deltas would just feel jittery.
 */
export function AnimatedNumber({
    value,
    duration = 700,
    format = (n) => Math.round(n).toLocaleString('ru-RU'),
    className,
}: AnimatedNumberProps) {
    const [display, setDisplay] = useState(value);
    const fromRef = useRef(value);
    const startTimeRef = useRef(0);
    const rafRef = useRef<number | null>(null);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const delta = Math.abs(value - display);
        if (reduceMotion || delta < 2) {
            setDisplay(value);
            return;
        }

        fromRef.current = display;
        startTimeRef.current = performance.now();

        const tick = (now: number) => {
            const elapsed = now - startTimeRef.current;
            const t = Math.min(1, elapsed / duration);
            // ease-out cubic
            const eased = 1 - Math.pow(1 - t, 3);
            const current = fromRef.current + (value - fromRef.current) * eased;
            setDisplay(current);
            if (t < 1) {
                rafRef.current = requestAnimationFrame(tick);
            }
        };

        rafRef.current = requestAnimationFrame(tick);
        return () => {
            if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value, duration]);

    return <span className={className}>{format(display)}</span>;
}
