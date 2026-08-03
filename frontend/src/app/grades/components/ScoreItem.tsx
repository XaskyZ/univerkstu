'use client';

import { GradeBadge } from './GradeBadge';

export function ScoreItem({
    label,
    value,
    title,
    ariaLabel,
}: {
    label: string;
    value: string;
    title?: string;
    ariaLabel?: string;
}) {
    return (
        <div className="score-item" title={title} aria-label={ariaLabel}>
            <span className="score-item-label">{label}</span>
            <GradeBadge value={value} />
        </div>
    );
}
