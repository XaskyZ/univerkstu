'use client';

import { getGradeTone } from '../utils/grades-helpers';

export function GradeBadge({ value, isTotal = false }: { value: string; isTotal?: boolean }) {
    const displayValue = value === '-' || value === '' ? '—' : value;
    const tone = getGradeTone(value);

    return (
        <span
            className={isTotal ? 'grade-badge grade-badge-total' : 'grade-badge'}
            style={{
                ['--tone-border' as string]: tone.border,
                ['--tone-bg' as string]: tone.bg,
                ['--tone-color' as string]: tone.color,
            }}
        >
            {displayValue}
        </span>
    );
}
