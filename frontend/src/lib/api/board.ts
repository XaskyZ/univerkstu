/**
 * Student announcements board API client.
 *
 * Mirrors `backend/src/routes/board.ts` over `/api/v3/board/*`. Types are
 * defined locally (the frontend never imports backend types) and match the
 * base social-entity view the board returns — reactions / comments /
 * attachments / reports are handled by the generic `@/lib/api/social` helpers
 * keyed by `entity.id`.
 */
import { fetchWithAuth, type ApiResponse } from './core';

/** Category keys — kept in sync with BOARD_CATEGORIES in backend/src/services/board.ts. */
export const BOARD_CATEGORIES = ['sale', 'buy', 'service', 'event', 'lost_found', 'help', 'other'] as const;
export type BoardCategory = (typeof BOARD_CATEGORIES)[number];
export const BOARD_DEAL_TYPES = ['product', 'service', 'other'] as const;
export type BoardDealType = (typeof BOARD_DEAL_TYPES)[number];
export const BOARD_LOST_FOUND_TYPES = ['lost', 'found'] as const;
export type BoardLostFoundType = (typeof BOARD_LOST_FOUND_TYPES)[number];
export const BOARD_STATUSES = ['active', 'closed', 'sold', 'found', 'archived'] as const;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const BOARD_SORTS = ['newest', 'popular', 'discussed', 'views', 'favorites'] as const;
export type BoardSort = (typeof BOARD_SORTS)[number];

/**
 * SSE scope key for the board (mirrors backend BOARD_SCOPE_ID). Used to
 * subscribe to live entity-created events via useSocialStream.
 */
export const BOARD_SCOPE_KEY = 'announcement:student-board';

export interface BoardAnnouncementPayload {
    title: string;
    body: string;
    category?: string;
    dealType?: BoardDealType;
    priority?: string;
    status?: BoardStatus;
    price?: string | null;
    condition?: string | null;
    location?: string | null;
    serviceFormat?: string | null;
    eventAt?: string | null;
    lostFoundType?: BoardLostFoundType | null;
    contactTelegram?: string;
    contactInstagram?: string;
    contactPhone?: string;
    expiresAt?: string;
}

export interface BoardAnnouncementEntity {
    id: string;
    authorUserId: string;
    payload: BoardAnnouncementPayload;
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface BoardAnnouncement {
    entity: BoardAnnouncementEntity;
    reactions: Array<{ emoji: string; count: number }>;
    myReactions: string[];
    commentCount: number;
    attachmentCount: number;
    isPinned: boolean;
    viewCount: number;
    hasViewed: boolean;
    favoriteCount: number;
    isFavorite: boolean;
    /** Human display name of the author (server falls back to the raw id). */
    authorLabel?: string;
    /** file_id of the first image attachment, for the preview cover. */
    coverFileId?: string;
}

/** GET /api/v3/board/announcements */
export async function listBoardAnnouncements(
    opts: {
        limit?: number;
        offset?: number;
        favoriteOnly?: boolean;
        mineOnly?: boolean;
        q?: string;
        category?: BoardCategory;
        status?: BoardStatus;
        sort?: BoardSort;
    } = {},
): Promise<ApiResponse<{ announcements: BoardAnnouncement[]; canModerate: boolean; canSuperModerate?: boolean }>> {
    const params = new URLSearchParams();
    if (typeof opts.limit === 'number' && Number.isFinite(opts.limit)) params.set('limit', String(opts.limit));
    if (typeof opts.offset === 'number' && Number.isFinite(opts.offset)) params.set('offset', String(opts.offset));
    if (opts.favoriteOnly === true) params.set('favoriteOnly', 'true');
    if (opts.mineOnly === true) params.set('mineOnly', 'true');
    if (opts.q?.trim()) params.set('q', opts.q.trim());
    if (opts.category) params.set('category', opts.category);
    if (opts.status) params.set('status', opts.status);
    if (opts.sort) params.set('sort', opts.sort);
    const query = params.toString();
    return fetchWithAuth(`/api/v3/board/announcements${query ? `?${query}` : ''}`);
}

/** POST /api/v3/board/announcements/:id/favorite */
export async function setBoardAnnouncementFavorite(
    id: string,
    favorite: boolean,
): Promise<ApiResponse<{ isFavorite: boolean; favoriteCount: number }>> {
    return fetchWithAuth(`/api/v3/board/announcements/${encodeURIComponent(id)}/favorite`, {
        method: 'POST',
        body: JSON.stringify({ favorite }),
    });
}

/** GET /api/v3/board/announcements/:id */
export async function getBoardAnnouncement(
    id: string,
): Promise<ApiResponse<{ announcement: BoardAnnouncement; canModerate: boolean; canSuperModerate?: boolean }>> {
    return fetchWithAuth(`/api/v3/board/announcements/${encodeURIComponent(id)}`);
}

/** POST /api/v3/board/announcements */
export async function createBoardAnnouncement(input: {
    title: string;
    body: string;
    category: BoardCategory;
    dealType?: BoardDealType;
    status?: BoardStatus;
    price?: string;
    condition?: string;
    location?: string;
    serviceFormat?: string;
    eventAt?: string;
    lostFoundType?: BoardLostFoundType;
    contactTelegram?: string;
    contactInstagram?: string;
    contactPhone?: string;
    expiresAt?: string;
}): Promise<ApiResponse<{ announcement: BoardAnnouncement }>> {
    return fetchWithAuth('/api/v3/board/announcements', {
        method: 'POST',
        body: JSON.stringify(input),
    });
}

/** PATCH /api/v3/board/announcements/:id (owner; admin override) */
export async function updateBoardAnnouncement(
    id: string,
    patch: {
        title?: string;
        body?: string;
        category?: BoardCategory;
        dealType?: BoardDealType;
        status?: BoardStatus;
        price?: string;
        condition?: string;
        location?: string;
        serviceFormat?: string;
        eventAt?: string;
        lostFoundType?: BoardLostFoundType;
        contactTelegram?: string;
        contactInstagram?: string;
        contactPhone?: string;
        expiresAt?: string;
    },
): Promise<ApiResponse<{ announcement: BoardAnnouncement }>> {
    return fetchWithAuth(`/api/v3/board/announcements/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
    });
}

/** DELETE /api/v3/board/announcements/:id (owner; admin override) */
export async function deleteBoardAnnouncement(id: string): Promise<ApiResponse<null>> {
    return fetchWithAuth(`/api/v3/board/announcements/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });
}

/** DELETE /api/v3/board/announcements (super-admin only) */
export async function clearBoardAnnouncements(): Promise<ApiResponse<{ deletedCount: number }>> {
    return fetchWithAuth('/api/v3/board/announcements', {
        method: 'DELETE',
    });
}

/** POST /api/v3/board/announcements/:id/pin (admin-only) */
export async function pinBoardAnnouncement(id: string, pinned: boolean): Promise<ApiResponse<null>> {
    return fetchWithAuth(`/api/v3/board/announcements/${encodeURIComponent(id)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned }),
    });
}
