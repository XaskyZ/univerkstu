'use client';

export type CoordinatorAnnouncementPriority = 'info' | 'warning' | 'critical';

export interface CoordinatorAnnouncement {
    id: string;
    title: string;
    body: string;
    priority: CoordinatorAnnouncementPriority;
    expiresAt?: string | null;
    targetMode: 'all_starostas' | 'groups';
    targetGroups: string[];
    revokedAt?: string | null;
    viewCount: number;
    createdAt: string;
}

let announcements: CoordinatorAnnouncement[] = [];
const listeners = new Set<() => void>();

function emit() {
    for (const listener of listeners) listener();
}

export function subscribeCoordinatorAnnouncements(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function getCoordinatorAnnouncements() {
    return announcements;
}

export function upsertCoordinatorAnnouncement(input: Omit<CoordinatorAnnouncement, 'id' | 'createdAt' | 'viewCount'> & { id?: string }) {
    const now = new Date().toISOString();
    if (input.id) {
        announcements = announcements.map((item) => item.id === input.id ? { ...item, ...input } : item);
    } else {
        announcements = [
            {
                id: `ann-${Date.now()}`,
                createdAt: now,
                viewCount: 0,
                ...input,
            },
            ...announcements,
        ];
    }
    emit();
}

export function revokeCoordinatorAnnouncement(id: string) {
    announcements = announcements.map((item) => item.id === id ? { ...item, revokedAt: new Date().toISOString() } : item);
    emit();
}

export function markCoordinatorAnnouncementViewed(id: string) {
    announcements = announcements.map((item) => item.id === id ? { ...item, viewCount: item.viewCount + 1 } : item);
    emit();
}
