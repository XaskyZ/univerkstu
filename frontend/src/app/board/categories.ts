import { BriefcaseBusiness, CalendarDays, LifeBuoy, Megaphone, Search, ShoppingBag, Tag, type LucideIcon } from 'lucide-react';
import type { LanguageMessages } from '@/lib/language-context';
import type { BoardCategory } from '@/lib/api/board';

/** Per-category lucide icon (used on pills, covers, the detail header). */
export const CATEGORY_ICON: Record<BoardCategory, LucideIcon> = {
    sale: Tag,
    buy: ShoppingBag,
    service: BriefcaseBusiness,
    event: CalendarDays,
    lost_found: Search,
    help: LifeBuoy,
    other: Megaphone,
};

export function categoryIcon(key: string): LucideIcon {
    return CATEGORY_ICON[key as BoardCategory] ?? Megaphone;
}

/**
 * Board-specific visual config. The board has its OWN design language (it does
 * not follow the global semantic-token system), so each category gets a fixed
 * accent color used for pills, the card's accent strip, and author avatars.
 */
export const CATEGORY_COLOR: Record<BoardCategory, string> = {
    sale: '#10b981',       // emerald
    buy: '#0ea5e9',        // sky
    service: '#14b8a6',    // teal
    event: '#8b5cf6',      // violet
    lost_found: '#f59e0b', // amber
    help: '#f43f5e',       // rose
    other: '#64748b',      // slate
};

export function categoryColor(key: string): string {
    return CATEGORY_COLOR[key as BoardCategory] ?? CATEGORY_COLOR.other;
}

export function categoryLabel(messages: LanguageMessages, key: string): string {
    const labels = messages.board.categories;
    switch (key) {
        case 'sale': return labels.sale;
        case 'buy': return labels.buy;
        case 'service': return labels.service;
        case 'event': return labels.event;
        case 'lost_found': return labels.lost_found;
        case 'help': return labels.help;
        default: return labels.other;
    }
}

/** Up-to-2-letter initials from a display name for the avatar. */
export function authorInitials(name: string): string {
    const parts = name.trim().split(/[\s_.-]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}
