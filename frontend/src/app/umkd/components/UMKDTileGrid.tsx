'use client';

import { useMemo, useState } from 'react';
import { UMKDCourse } from '@/lib/types';
import { useLanguage } from '@/lib/language-context';
import { UMKDTile } from './UMKDTile';

interface UMKDTileGridProps {
    courses: UMKDCourse[];
    /**
     * Optional initial value for the "show empty" toggle. The grid keeps its
     * own state — pass this only if a parent wants to seed the value.
     */
    showEmpty?: boolean;
}

/**
 * Responsive tile grid for UMKD courses.
 *
 * Layout:
 *   - mobile (< 640px): 2 columns
 *   - sm+: `repeat(auto-fill, minmax(160px, 1fr))`
 *
 * Hides empty folders (zero files) by default; users opt in via the toggle.
 * Persists the toggle only in-memory — there's no compelling need to store it
 * across navigations for this page.
 */
export function UMKDTileGrid({ courses, showEmpty: initialShowEmpty = false }: UMKDTileGridProps) {
    const { messages } = useLanguage();
    const [showEmpty, setShowEmpty] = useState<boolean>(initialShowEmpty);

    const visibleCourses = useMemo(() => {
        if (showEmpty) return courses;
        return courses.filter((course) => course.files.length > 0);
    }, [courses, showEmpty]);

    const hiddenCount = courses.length - visibleCourses.length;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    {visibleCourses.length} / {courses.length}
                </span>
                <button
                    type="button"
                    onClick={() => setShowEmpty((v) => !v)}
                    className="btn"
                    aria-pressed={showEmpty}
                    style={{
                        fontSize: '13px',
                        padding: '8px 14px',
                        borderRadius: '12px',
                        border: '1px solid var(--border)',
                        background: 'var(--card)',
                        color: 'var(--text)',
                        cursor: 'pointer',
                    }}
                >
                    {showEmpty ? messages.umkd.hideEmpty : messages.umkd.showEmpty}
                    {!showEmpty && hiddenCount > 0 ? ` · ${hiddenCount}` : ''}
                </button>
            </div>

            <div
                className="umkd-tile-grid"
                style={{
                    display: 'grid',
                    gap: '12px',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                }}
            >
                {visibleCourses.map((course) => (
                    <UMKDTile key={course.id} course={course} />
                ))}
            </div>

            <style jsx>{`
                @media (min-width: 640px) {
                    .umkd-tile-grid {
                        grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)) !important;
                    }
                }
            `}</style>
        </div>
    );
}
