'use client';

import { useEffect } from 'react';

/**
 * Delegated pointer tracker — sets `--mx`/`--my` on the nearest
 * `.card-interactive` ancestor under the cursor. Lets the cursor-tracked
 * radial-gradient halo defined in globals.css follow the pointer without
 * requiring per-component handlers.
 *
 * Skipped on coarse-pointer devices (touch) where hover sheen is irrelevant
 * and would cost battery. Also bails out under prefers-reduced-motion.
 */
export default function CardSheenTracker() {
    useEffect(() => {
        if (typeof window === 'undefined') return;

        const coarse = window.matchMedia('(pointer: coarse)').matches;
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (coarse || reduced) return;

        let frame = 0;
        let pendingTarget: HTMLElement | null = null;
        let pendingX = 0;
        let pendingY = 0;

        const flush = () => {
            frame = 0;
            const card = pendingTarget;
            if (!card) return;
            const rect = card.getBoundingClientRect();
            const mx = ((pendingX - rect.left) / rect.width) * 100;
            const my = ((pendingY - rect.top) / rect.height) * 100;
            card.style.setProperty('--mx', `${mx}%`);
            card.style.setProperty('--my', `${my}%`);
        };

        const onMove = (event: PointerEvent) => {
            const target = (event.target as Element | null)?.closest<HTMLElement>('.card-interactive');
            if (!target) return;
            pendingTarget = target;
            pendingX = event.clientX;
            pendingY = event.clientY;
            if (!frame) frame = requestAnimationFrame(flush);
        };

        document.addEventListener('pointermove', onMove, { passive: true });
        return () => {
            document.removeEventListener('pointermove', onMove);
            if (frame) cancelAnimationFrame(frame);
        };
    }, []);

    return null;
}
