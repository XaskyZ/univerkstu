export function formatDateTime(value: string | null | undefined, locale: string) {
    if (!value) return '—';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function getRoleTone(role: string) {
    if (role === 'starosta') return { background: 'rgba(var(--primary-rgb), 0.18)', color: 'var(--primary)' };
    if (role === 'helper') return { background: 'rgba(var(--good-rgb), 0.16)', color: 'var(--good)' };
    return { background: 'var(--surface-overlay-3)', color: 'var(--text)' };
}
