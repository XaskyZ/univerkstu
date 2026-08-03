/**
 * Universal social entity types.
 *
 * The legacy social schema spread "post-like" content across multiple parallel
 * tables (app_group_posts, app_group_tasks, app_group_extra_lessons,
 * app_coordinator_announcements, app_chat_messages, app_global_chat_messages)
 * with duplicated CRUD logic. This file defines a single discriminated model
 * (`kind` selects the shape of `payload`) that will eventually absorb all of
 * them — see docs/SOCIAL_STORE.md for the phased plan.
 *
 * Phase 1a — schema + types + validators + skeleton service only. CRUD
 * implementation, legacy-route shimming, and data migration come in
 * subsequent phases. Nothing in this file references the new tables at
 * runtime yet.
 */

export type SocialEntityKind =
    | 'post'
    | 'task'
    | 'extra_lesson'
    | 'poll'
    | 'event'
    | 'announcement'
    | 'dm_message'
    | 'global_message';

export type SocialScopeType = 'group' | 'dm' | 'global' | 'announcement';

/**
 * Discriminated payload shapes per kind. Each kind has its own typed payload;
 * the runtime row stores this in the `payload` jsonb column.
 */
export interface SocialPayloadByKind {
    post: {
        title?: string;
        body: string;
        tags?: string[];
    };
    task: {
        title: string;
        body: string;
        dueAt?: string;
        completedByUserIds?: string[];
        assignedUserIds?: string[];
    };
    extra_lesson: {
        subject: string;
        teacher?: string;
        room?: string;
        startsAt: string;
        endsAt?: string;
        note?: string;
    };
    poll: {
        question: string;
        options: Array<{ id: string; label: string }>;
        votes?: Record<string, string[]>;
        closedAt?: string;
        /**
         * When `true` voters may pick more than one option. The vote payload
         * primitive (`computeNextVotes`) toggles the viewer's userId in the
         * target bucket without touching the other buckets. Defaults to
         * `false` (single-choice — existing behavior).
         */
        multiChoice?: boolean;
    };
    event: {
        title: string;
        body?: string;
        startsAt: string;
        endsAt?: string;
        location?: string;
        rsvpStatus?: Record<string, 'yes' | 'no' | 'maybe'>;
        /**
         * Optional recurrence descriptor. When set on the *create* request,
         * the server materializes follow-up occurrences as separate
         * `app_social_entity` rows (kind='event') sharing the same `seriesId`.
         * The recurrence object itself is stored verbatim on the *first*
         * occurrence only; follow-up rows carry only `seriesId` so they can
         * be enumerated and extended via `POST /social/events/:id/extend-series`.
         */
        recurrence?: {
            kind: 'weekly' | 'monthly';
            /** ISO upper bound (inclusive). Optional — `occurrencesAhead` is the secondary cap. */
            until?: string;
            /** Number of future occurrences to generate up-front (subject to the hard cap of 26). */
            occurrencesAhead?: number;
        };
        /**
         * Shared id linking every occurrence of a recurring event. Populated
         * on every series row (including the original one). Absent on one-off
         * events.
         */
        seriesId?: string;
    };
    announcement: {
        title: string;
        body: string;
        priority: 'low' | 'medium' | 'high' | 'critical';
        targetGroups?: string[];
        expiresAt?: string;
        dealType?: 'product' | 'service' | 'other';
        status?: 'active' | 'closed' | 'sold' | 'found' | 'archived';
        price?: string | null;
        condition?: string | null;
        location?: string | null;
        serviceFormat?: string | null;
        eventAt?: string | null;
        lostFoundType?: 'lost' | 'found' | null;
        contactTelegram?: string;
        contactInstagram?: string;
        contactPhone?: string;
        /**
         * Optional category tag used by the student announcements board
         * (scope `announcement:student-board`). One of the keys in
         * `BOARD_CATEGORIES` (see services/board.ts). Coordinator announcements
         * leave this unset.
         */
        category?: string;
    };
    dm_message: {
        body: string;
        replyToMessageId?: string;
        editedAt?: string;
    };
    global_message: {
        body: string;
        replyToMessageId?: string;
        editedAt?: string;
    };
}

export interface SocialEntity<K extends SocialEntityKind = SocialEntityKind> {
    id: string;
    kind: K;
    scopeType: SocialScopeType;
    scopeId: string;
    authorUserId: string;
    payload: SocialPayloadByKind[K];
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    deletedByUserId: string | null;
    deletedReason: string | null;
}

export interface SocialComment {
    id: string;
    entityId: string;
    parentCommentId: string | null;
    authorUserId: string;
    body: string;
    depth: 0 | 1;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
}

export interface SocialReaction {
    entityId: string;
    userId: string;
    emoji: string;
    createdAt: string;
}

export interface SocialMention {
    id: string;
    entityId: string;
    sourceKind: 'entity' | 'comment';
    sourceId: string;
    authorUserId: string;
    mentionedUserId: string;
    createdAt: string;
}

export interface SocialAttachment {
    id: string;
    entityId: string;
    fileId: string;
    mime: string | null;
    sizeBytes: number | null;
    sortOrder: number;
    createdAt: string;
    /**
     * Original upload filename resolved from `app_umkd_files.filename` via a
     * LEFT JOIN on `file_id`. `null` when the file metadata row is missing
     * (e.g. orphaned attachment, or the file was uploaded via a non-UMKD
     * pathway). The UI falls back to a MIME-derived label in that case.
     */
    filename?: string | null;
}

export interface SocialRevision {
    id: string;
    entityId: string;
    authorUserId: string;
    snapshot: Record<string, unknown>;
    revisionKind: 'create' | 'update' | 'delete' | 'restore';
    note: string | null;
    createdAt: string;
}

/**
 * Aggregated view returned to clients: the entity plus the cheap rollups
 * (reaction counts, viewer's own reactions, comment / attachment counts).
 */
export interface SocialEntityView<K extends SocialEntityKind = SocialEntityKind> {
    entity: SocialEntity<K>;
    reactions: Array<{ emoji: string; count: number }>;
    myReactions: string[];
    commentCount: number;
    attachmentCount: number;
    isPinned: boolean;
    viewCount: number;
    hasViewed: boolean;
}
