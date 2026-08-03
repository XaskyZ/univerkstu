import type { FriendOverview } from '@/lib/api';

export function formatDateTime(value: string, locale: string) {
    return new Date(value).toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function clipText(value: string | null | undefined, limit = 84) {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}

function nameInitial(part: string): string {
    const [first] = Array.from(part.trim());
    return first ? `${first.toUpperCase()}.` : '';
}

export function formatPersonalChatName(value: string | null | undefined): string {
    const normalized = (value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';

    const parts = normalized.split(' ').filter(Boolean);
    if (parts.length < 2) return normalized;
    if (parts.some((part) => /\d|@/.test(part) || part.endsWith('.'))) return normalized;

    const [familyName, firstName, patronymic] = parts;
    if (!firstName) return normalized;

    const initials = [nameInitial(firstName), patronymic ? nameInitial(patronymic) : '']
        .filter(Boolean)
        .join(' ');

    return initials ? `${familyName} ${initials}` : normalized;
}

export function buildDirectRoomId(userA: string, userB: string) {
    const [low, high] = [userA.trim(), userB.trim()].sort((left, right) => left.localeCompare(right));
    return `direct:${low}::${high}`;
}

export function dedupeRecommendedFriends(overview: FriendOverview): FriendOverview {
    const seen = new Set<string>();
    const recommended = overview.recommended.filter((user) => {
        const key = user.userId.trim().toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    if (recommended.length === overview.recommended.length) {
        return overview;
    }

    return {
        ...overview,
        recommended,
    };
}
