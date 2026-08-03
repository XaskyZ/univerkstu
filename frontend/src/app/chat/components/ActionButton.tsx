'use client';

export function ActionButton({
    label,
    onClick,
    disabled,
    variant = 'default',
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    variant?: 'default' | 'danger' | 'warning' | 'primary';
}) {
    const style = variant === 'danger'
        ? { background: 'rgba(var(--danger-rgb), 0.12)', color: 'var(--danger)', border: '1px solid rgba(var(--danger-rgb), 0.24)' }
        : variant === 'warning'
            ? { background: 'var(--status-warning-bg)', color: 'var(--status-warning-color)', border: '1px solid var(--status-warning-border)' }
            : variant === 'primary'
                ? { background: 'var(--gradient-primary)', color: '#fff', border: '1px solid transparent' }
                : { background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' };

    return (
        <button type="button" onClick={onClick} disabled={disabled} className="px-3 py-2 rounded-xl text-xs font-medium disabled:opacity-60" style={style}>
            {label}
        </button>
    );
}
