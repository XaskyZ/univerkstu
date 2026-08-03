export function formatUpdatedAt(value: string, lang: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(
        lang === 'kz' ? 'kk-KZ' : lang === 'en' ? 'en-US' : 'ru-RU',
        { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' },
    ).format(date);
}

export function formatLeaderboardDuration(totalSeconds: number, lang: string) {
    const safe = Math.max(0, Math.round(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    if (lang === 'kz') return `${hours} сағ ${minutes} мин`;
    if (lang === 'en') return `${hours} h ${minutes} min`;
    return `${hours} ч ${minutes} мин`;
}
