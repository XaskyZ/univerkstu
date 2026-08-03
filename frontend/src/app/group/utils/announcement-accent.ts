import type { CoordinatorAnnouncementPriority } from '@/lib/api';

export interface AnnouncementAccent {
    border: string;
    glow: string;
    stripe: string;
    pillBg: string;
    pillColor: string;
}

/**
 * Shared accent tokens for coordinator announcement cards.
 *
 * - `border` is consumed by both the coordinator card (paired with `glow`) and
 *   the starosta card (paired with `stripe`).
 * - `glow` is a box-shadow gradient — used by CoordinatorPage cards.
 * - `stripe` is a vertical accent bar background — used by StarostaPage cards.
 * - `pillBg` / `pillColor` style the small priority pill badge in both surfaces.
 */
export function getAnnouncementAccent(priority: CoordinatorAnnouncementPriority): AnnouncementAccent {
    if (priority === 'critical') {
        return {
            border: '1px solid rgba(var(--status-danger-rgb), 0.45)',
            glow: '0 20px 40px rgba(var(--status-danger-rgb), 0.12)',
            stripe: 'linear-gradient(180deg, rgba(var(--status-danger-rgb), 0.95), rgba(var(--status-danger-rgb), 0.55))',
            pillBg: 'rgba(var(--status-danger-rgb), 0.18)',
            pillColor: 'var(--danger)',
        };
    }
    if (priority === 'warning') {
        return {
            border: '1px solid rgba(var(--status-warning-rgb), 0.42)',
            glow: '0 20px 40px rgba(var(--status-warning-rgb), 0.1)',
            stripe: 'linear-gradient(180deg, rgba(var(--status-warning-rgb), 0.95), rgba(var(--status-warning-rgb), 0.5))',
            pillBg: 'rgba(var(--status-warning-rgb), 0.16)',
            pillColor: 'var(--status-warning-color)',
        };
    }
    return {
        border: '1px solid rgba(var(--status-info-rgb), 0.35)',
        glow: '0 20px 40px rgba(var(--status-info-rgb), 0.1)',
        stripe: 'linear-gradient(180deg, rgba(var(--status-info-rgb), 0.95), rgba(var(--status-info-rgb), 0.45))',
        pillBg: 'rgba(var(--status-info-rgb), 0.16)',
        pillColor: 'var(--status-info-color)',
    };
}
