'use client';

import { type RefObject, useEffect, useState } from 'react';

const VIEW_MODE_KEY = 'schedule-view-mode';

export type ScheduleViewMode = 'vertical' | 'horizontal';

/**
 * View mode (vertical = all days listed, horizontal = day picker)
 * + selected day. Persists view mode to localStorage and scrolls
 * the active day button into view on horizontal-mode switch.
 */
export function useScheduleViewMode(
    currentDayKey: string,
    daysContainerRef: RefObject<HTMLDivElement | null>,
) {
    const [viewMode, setViewMode] = useState<ScheduleViewMode>(() => {
        if (typeof window === 'undefined') return 'horizontal';
        const saved = localStorage.getItem(VIEW_MODE_KEY);
        return saved === 'vertical' || saved === 'horizontal' ? saved : 'horizontal';
    });
    const [selectedDay, setSelectedDay] = useState(currentDayKey);

    useEffect(() => {
        localStorage.setItem(VIEW_MODE_KEY, viewMode);
    }, [viewMode]);

    useEffect(() => {
        if (viewMode !== 'horizontal') return;
        const container = daysContainerRef.current;
        if (!container) return;
        const selectedBtn = container.querySelector(`[data-day="${selectedDay}"]`);
        if (selectedBtn) {
            selectedBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, [viewMode, selectedDay, daysContainerRef]);

    return { viewMode, setViewMode, selectedDay, setSelectedDay };
}
