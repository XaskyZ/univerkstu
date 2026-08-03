'use client';

export function HintChip({
    label,
    value,
    danger = false,
    tooltip,
}: {
    label: string;
    value: string;
    danger?: boolean;
    tooltip?: string;
}) {
    return (
        <div
            title={tooltip}
            className={danger ? 'hint-chip hint-chip-danger' : 'hint-chip'}
            style={{ cursor: tooltip ? 'help' : 'default' }}
        >
            <span className="hint-chip-label">{label}</span>
            <span className="hint-chip-value">{value}</span>
        </div>
    );
}
