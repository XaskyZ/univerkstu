import type { CSSProperties, MouseEvent, ReactNode } from 'react';

export type MetricTone = 'primary' | 'good' | 'accent' | 'danger' | 'warning';

interface MetricCardProps {
    label: string;
    /** Big primary number. Omit to render only the label (e.g. for grouped sub-stats). */
    value?: ReactNode;
    /** Optional supporting text under the value (e.g. "+12 за 24 часа"). */
    subValue?: ReactNode;
    /** Emoji or short string rendered inside the colored circle. */
    icon: ReactNode;
    /** Visual tone for the icon background. Defaults to `primary`. */
    tone?: MetricTone;
    /** Extra content rendered below the header — progress bars, breakdowns, etc. */
    children?: ReactNode;
    className?: string;
}

/**
 * Stat tile used across admin overview, settings, and dashboards.
 * Replaces the dozens of bespoke `<div className="card p-5">` blocks that each
 * hand-rolled their own emoji-circle + label + value layout with slightly
 * different paddings, alphas, and color values.
 */
export function MetricCard({
    label,
    value,
    subValue,
    icon,
    tone = 'primary',
    children,
    className,
}: MetricCardProps) {
    const handlePointerMove = (event: MouseEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const mx = ((event.clientX - rect.left) / rect.width) * 100;
        const my = ((event.clientY - rect.top) / rect.height) * 100;
        event.currentTarget.style.setProperty('--mx', `${mx}%`);
        event.currentTarget.style.setProperty('--my', `${my}%`);
    };

    return (
        <div
            className={`metric-card${className ? ` ${className}` : ''}`}
            data-tone={tone}
            onMouseMove={handlePointerMove}
            style={{ '--mx': '50%', '--my': '0%' } as CSSProperties}
        >
            <div className="flex items-center gap-3 mb-3">
                <div className="metric-card-icon" aria-hidden>
                    {icon}
                </div>
                <div className="min-w-0">
                    <p className="text-sm text-muted-fg">{label}</p>
                    {value !== undefined && value !== null ? (
                        <p className="text-2xl font-bold text-fg leading-tight">{value}</p>
                    ) : null}
                    {subValue ? (
                        <p className="text-xs mt-1 text-muted-fg">{subValue}</p>
                    ) : null}
                </div>
            </div>
            {children}
        </div>
    );
}
