/**
 * Universal social entity API client — Phase 1c foundation for the upcoming
 * Phase 2 UI rewrite.
 *
 * Mirrors the backend routes in `backend/src/routes/social.ts` over the
 * `/api/v3/social/*` namespace. Types are duplicated here on purpose — the
 * frontend never imports backend types so the two sides can evolve under
 * a versioned contract.
 *
 * Every function delegates to `fetchWithAuth`, which already handles:
 *  - bearer-token attachment
 *  - timeout / abort
 *  - `Failed to fetch` → server-unavailable mapping
 *  - non-2xx → ApiResponse with `error` + `errorCode` (e.g. `AUTH_RELOGIN_REQUIRED`)
 *  - analytics tagging (status → api_error event)
 *
 * No UI consumes these yet — this module is intentionally a thin, fully-typed
 * surface that Phase 2 components (feed, tasks, polls, DMs, announcements)
 * will build on top of.
 */
import { fetchWithAuth, type ApiResponse } from './core';

// === Domain types ===========================================================

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

export interface SocialReactionAggregate {
    emoji: string;
    count: number;
}

export interface SocialEntity {
    id: string;
    kind: SocialEntityKind;
    scopeType: SocialScopeType;
    scopeId: string;
    authorUserId: string;
    payload: Record<string, unknown>;
    pinned: boolean;
    createdAt: string;
    updatedAt: string;
    deletedAt: string | null;
    deletedByUserId: string | null;
    deletedReason: string | null;
}

export interface SocialEntityView {
    entity: SocialEntity;
    reactions: SocialReactionAggregate[];
    myReactions: string[];
    commentCount: number;
    attachmentCount: number;
    isPinned: boolean;
    /**
     * Distinct-user view count from `app_social_view`. Populated by the
     * universal store enrichment in `listEntitiesByScope` / `getEntityView` —
     * unlike the legacy `app_coordinator_announcement_views` table this
     * spans every social entity kind. UI surfaces show the literal number;
     * `0` is rendered as-is (not hidden) so a fresh announcement reads
     * "0 viewers" instead of being silently blank.
     */
    viewCount: number;
    /**
     * Whether the current viewer has already been recorded as having seen
     * this entity. Used by the announcement / post UI to suppress "new"
     * badges and to skip re-firing `recordSocialView` on a re-render.
     */
    hasViewed: boolean;
}

/**
 * Threaded comment on a social entity. `depth` is capped at 1 server-side
 * (no replies-to-replies); replies always carry a non-null `parentCommentId`.
 * Soft-deleted comments are filtered out of the `getSocialComments` list — UI
 * never sees a row with `deletedAt !== null` from that endpoint today.
 */
export interface SocialCommentView {
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

export interface SocialReactionToggleResult {
    added: boolean;
    reactions: SocialReactionAggregate[];
    mine: string[];
}

export interface ListSocialEntitiesOptions {
    kind?: SocialEntityKind;
    limit?: number;
    offset?: number;
    includeDeleted?: boolean;
    pinnedFirst?: boolean;
}

// === Limits ================================================================

/**
 * Mirror of `SOCIAL_COMMENT_MAX_LENGTH` in `backend/src/services/social.ts`.
 * Kept here so UI char-counter logic does not duplicate the magic number.
 * If the backend raises this cap, bump it here in lockstep — there is no
 * runtime negotiation between client and server for this value.
 */
export const SOCIAL_COMMENT_MAX_LENGTH = 2000;

// === Allowed reaction emojis ================================================

/**
 * Single source of truth for reaction emojis. Kept in sync with
 * `ALLOWED_EMOJI` in `backend/src/routes/social.ts`. The backend validates the
 * emoji via AJV `enum`, so sending anything else will return
 * `errorCode: 'SOCIAL_INVALID_EMOJI'`.
 */
export const ALLOWED_SOCIAL_REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '😢'] as const;
export type AllowedSocialReactionEmoji = (typeof ALLOWED_SOCIAL_REACTION_EMOJI)[number];

// === Endpoint functions =====================================================

/**
 * GET /api/v3/social/scope/:scopeType/:scopeId/entities
 *
 * Lists entities in a scope. Query params are url-encoded; absent options are
 * omitted entirely (no `?` is appended when the option bag is empty).
 */
export async function listSocialEntitiesByScope(
    scopeType: SocialScopeType,
    scopeId: string,
    opts: ListSocialEntitiesOptions = {},
): Promise<ApiResponse<{ entities: SocialEntityView[] }>> {
    const params = new URLSearchParams();
    if (opts.kind) params.set('kind', opts.kind);
    if (typeof opts.limit === 'number' && Number.isFinite(opts.limit)) {
        params.set('limit', String(opts.limit));
    }
    if (typeof opts.offset === 'number' && Number.isFinite(opts.offset)) {
        params.set('offset', String(opts.offset));
    }
    if (typeof opts.includeDeleted === 'boolean') {
        params.set('includeDeleted', opts.includeDeleted ? 'true' : 'false');
    }
    if (typeof opts.pinnedFirst === 'boolean') {
        params.set('pinnedFirst', opts.pinnedFirst ? 'true' : 'false');
    }
    const query = params.toString();
    return fetchWithAuth(
        `/api/v3/social/scope/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeId)}/entities${query ? `?${query}` : ''}`,
    );
}

/** GET /api/v3/social/entities/:id */
export async function getSocialEntity(
    id: string,
): Promise<ApiResponse<{ entity: SocialEntityView }>> {
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(id)}`);
}

/** POST /api/v3/social/entities */
export async function createSocialEntity(input: {
    kind: SocialEntityKind;
    scopeType: SocialScopeType;
    scopeId: string;
    payload: Record<string, unknown>;
}): Promise<ApiResponse<{ id: string; entity: SocialEntityView }>> {
    return fetchWithAuth('/api/v3/social/entities', {
        method: 'POST',
        body: JSON.stringify({
            kind: input.kind,
            scopeType: input.scopeType,
            scopeId: input.scopeId,
            payload: input.payload,
        }),
    });
}

/**
 * PATCH /api/v3/social/entities/:id
 *
 * The backend expects `{ patch: { ... } }`, NOT the raw patch object — this
 * client wraps it so callers can pass the field map directly.
 */
export async function updateSocialEntity(
    id: string,
    patch: Record<string, unknown>,
): Promise<ApiResponse<{ entity: SocialEntityView }>> {
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ patch }),
    });
}

/**
 * DELETE /api/v3/social/entities/:id?reason=...
 *
 * Soft delete. Optional reason flows through as a querystring (the backend
 * keeps the audit string off the body for `DELETE` semantics).
 */
export async function deleteSocialEntity(
    id: string,
    reason?: string,
): Promise<ApiResponse<null>> {
    const query = reason ? `?reason=${encodeURIComponent(reason)}` : '';
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(id)}${query}`, {
        method: 'DELETE',
    });
}

/** POST /api/v3/social/entities/:id/restore */
export async function restoreSocialEntity(id: string): Promise<ApiResponse<null>> {
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(id)}/restore`, {
        method: 'POST',
    });
}

/** POST /api/v3/social/entities/:id/pin */
export async function pinSocialEntity(
    id: string,
    pinned: boolean,
): Promise<ApiResponse<null>> {
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(id)}/pin`, {
        method: 'POST',
        body: JSON.stringify({ pinned }),
    });
}

/**
 * Single row from `app_social_revision` exposed by `getSocialRevisions`. The
 * `snapshot` is the full per-kind payload at the time the revision was written
 * (NOT just the diffed fields) — diffs against the previous revision happen on
 * the client via `diffSnapshots` in `lib/social-diff.ts`.
 *
 * `revisionKind`:
 *   - `create`   first row, payload as inserted
 *   - `update`   owner edited; snapshot is the post-merge payload
 *   - `delete`   soft-delete tombstone; snapshot mirrors the payload at delete time, `note` carries the optional reason
 *   - `restore`  un-delete; snapshot mirrors the payload at restore time
 */
export interface SocialRevisionView {
    id: string;
    entityId: string;
    authorUserId: string;
    snapshot: Record<string, unknown>;
    revisionKind: 'create' | 'update' | 'delete' | 'restore';
    note: string | null;
    createdAt: string;
}

/**
 * GET /api/v3/social/entities/:id/revisions?limit=N
 *
 * Newest-first revision history for an entity. The backend enforces visibility
 * via `getEntityView` — missing / soft-deleted / forbidden entities surface as
 * a 404 (no existence leak). `limit` defaults server-side; pass an override to
 * cap larger histories. Frontend cards mount this lazily inside the revision
 * history modal so the cost is paid only when the user opens it.
 */
export async function getSocialRevisions(
    entityId: string,
    limit?: number,
): Promise<ApiResponse<{ revisions: SocialRevisionView[] }>> {
    const trimmed = (entityId || '').trim();
    if (!trimmed) {
        return { success: false, error: 'entityId is required' };
    }
    const params = new URLSearchParams();
    if (typeof limit === 'number' && Number.isFinite(limit)) {
        params.set('limit', String(Math.max(1, Math.floor(limit))));
    }
    const query = params.toString();
    return fetchWithAuth(
        `/api/v3/social/entities/${encodeURIComponent(trimmed)}/revisions${query ? `?${query}` : ''}`,
    );
}

/**
 * GET /api/v3/social/entities/:id/comments
 *
 * Returns all non-deleted comments for the entity ordered by `createdAt` ASC.
 * The backend returns `[]` when the entity is missing or has no comments —
 * the UI does not need to distinguish those two cases for a thread render.
 */
export async function getSocialComments(
    entityId: string,
): Promise<ApiResponse<{ comments: SocialCommentView[] }>> {
    return fetchWithAuth(
        `/api/v3/social/entities/${encodeURIComponent(entityId)}/comments`,
    );
}

/**
 * POST /api/v3/social/entities/:id/comments
 *
 * `parentCommentId` is omitted from the body when undefined (the backend
 * schema treats it as optional; sending `undefined` would JSON-stringify to
 * the key disappearing anyway, but we drop it explicitly for clarity).
 */
export async function addSocialComment(
    entityId: string,
    body: string,
    parentCommentId?: string,
): Promise<ApiResponse<{ id: string }>> {
    const payload: { body: string; parentCommentId?: string } = { body };
    if (parentCommentId) {
        payload.parentCommentId = parentCommentId;
    }
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(entityId)}/comments`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * POST /api/v3/social/entities/:id/reactions
 *
 * Toggle semantics: backend returns `{ added: boolean, reactions, mine }` so
 * the caller can update local aggregate counts without re-fetching the entity.
 */
export async function toggleSocialReaction(
    entityId: string,
    emoji: AllowedSocialReactionEmoji | string,
): Promise<ApiResponse<SocialReactionToggleResult>> {
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(entityId)}/reactions`, {
        method: 'POST',
        body: JSON.stringify({ emoji }),
    });
}

/**
 * Universal social attachment row mirrored from
 * `app_social_attachment`. Returned by `getSocialAttachments`.
 *
 * `filename` is resolved server-side via a LEFT JOIN to `app_umkd_files`
 * (the storage metadata table) so the UI can display the original upload
 * name (`Lecture-3.pdf`) instead of the MIME surrogate. It is `null` when
 * the file metadata row is missing (orphan / non-UMKD pathway); the UI
 * falls back to `formatMimeFallback(mime)` in that case.
 */
export interface SocialAttachment {
    id: string;
    entityId: string;
    fileId: string;
    mime: string | null;
    sizeBytes: number | null;
    sortOrder: number;
    createdAt: string;
    filename?: string | null;
}

/**
 * POST /api/v3/social/entities/:id/attachments
 *
 * Attach an already-uploaded file (by `fileId`) to a social entity. Mime/size
 * are optional metadata mirrors; `sortOrder` controls display order when the
 * UI renders multiple attachments.
 */
export async function attachSocialFile(
    entityId: string,
    fileId: string,
    mime?: string,
    sizeBytes?: number,
    sortOrder?: number,
): Promise<ApiResponse<{ id: string }>> {
    const payload: {
        fileId: string;
        mime?: string;
        sizeBytes?: number;
        sortOrder?: number;
    } = { fileId };
    if (mime !== undefined) payload.mime = mime;
    if (typeof sizeBytes === 'number') payload.sizeBytes = sizeBytes;
    if (typeof sortOrder === 'number') payload.sortOrder = sortOrder;
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(entityId)}/attachments`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * GET /api/v3/social/entities/:id/attachments
 *
 * Returns all attachments for the entity ordered by `sortOrder` ASC then
 * `createdAt` ASC. Mirrors `getSocialComments` semantics — the backend returns
 * `[]` for both unknown and empty entities so the UI never has to special-case
 * the missing-entity branch.
 */
export async function getSocialAttachments(
    entityId: string,
): Promise<ApiResponse<{ attachments: SocialAttachment[] }>> {
    return fetchWithAuth(
        `/api/v3/social/entities/${encodeURIComponent(entityId)}/attachments`,
    );
}

/**
 * DELETE /api/v3/social/entities/:id/attachments/:attachmentId
 *
 * Owner-only (parent entity's author). The backend does NOT delete the
 * underlying R2 binary — the storage abstraction dedupes by content hash so
 * the blob may be referenced elsewhere. This call only removes the
 * `app_social_attachment` row. Returns 204 on success.
 */
export async function removeSocialAttachment(
    entityId: string,
    attachmentId: string,
): Promise<ApiResponse<null>> {
    return fetchWithAuth(
        `/api/v3/social/entities/${encodeURIComponent(entityId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { method: 'DELETE' },
    );
}

// === User-hint search (@mention autocomplete) ===============================

/**
 * Single candidate returned by `searchSocialUsers`. Backed server-side by
 * `app_group_memberships` (for group scopes) or the DM peer lookup (for dm
 * scopes). `avatarUrl` is reserved for the future — the current backend does
 * not surface one yet so this is always undefined in practice.
 */
export interface SocialUserHint {
    userId: string;
    displayName?: string;
    avatarUrl?: string;
}

/**
 * GET /api/v3/social/users/search?scope=group:KEY&q=al&limit=10
 *
 * Scope-bounded user-hint search used by the @mention autocomplete dropdown.
 * The viewer is always filtered out server-side. Returns `{ users: [] }` for
 * unknown scopes / forbidden access — the UI does not need to special-case it.
 */
export async function searchSocialUsers(
    scope: string,
    query: string,
    limit?: number,
): Promise<ApiResponse<{ users: SocialUserHint[] }>> {
    const params = new URLSearchParams();
    params.set('scope', scope);
    params.set('q', query);
    if (typeof limit === 'number' && Number.isFinite(limit)) {
        params.set('limit', String(Math.max(1, Math.floor(limit))));
    }
    return fetchWithAuth(`/api/v3/social/users/search?${params.toString()}`);
}

// === Universal cross-scope text search ======================================

/**
 * Mirror of `SOCIAL_SEARCH_MIN_QUERY_LENGTH` / `MAX_LIMIT` in
 * `backend/src/services/social.ts`. Duplicated here so the client can guard
 * empty/short queries before round-tripping to the server. Bump in lockstep
 * with the backend if those limits change.
 */
export const SOCIAL_SEARCH_MIN_QUERY_LENGTH = 2;
export const SOCIAL_SEARCH_MAX_QUERY_LENGTH = 200;
export const SOCIAL_SEARCH_DEFAULT_LIMIT = 20;
export const SOCIAL_SEARCH_MAX_LIMIT = 50;

export interface SearchSocialEntitiesOptions {
    scopes?: SocialScopeType[];
    kinds?: SocialEntityKind[];
    limit?: number;
}

/**
 * Pure helper — build the querystring for the `/social/search` endpoint.
 * Extracted so the URL composition is testable without a `fetch` mock.
 * Arrays serialize as comma-separated lists (matches the backend handler's
 * CSV-split helper). Empty or invalid limit/scope/kind values are dropped so
 * the URL stays minimal.
 */
export function buildSocialSearchQueryString(
    query: string,
    opts: SearchSocialEntitiesOptions = {},
): string {
    const params = new URLSearchParams();
    params.set('q', query);
    if (Array.isArray(opts.scopes) && opts.scopes.length > 0) {
        params.set('scopes', opts.scopes.join(','));
    }
    if (Array.isArray(opts.kinds) && opts.kinds.length > 0) {
        params.set('kinds', opts.kinds.join(','));
    }
    if (typeof opts.limit === 'number' && Number.isFinite(opts.limit)) {
        const clamped = Math.max(1, Math.min(Math.floor(opts.limit), SOCIAL_SEARCH_MAX_LIMIT));
        params.set('limit', String(clamped));
    }
    return params.toString();
}

/**
 * GET /api/v3/social/search?q=&scopes=group,dm&kinds=post,task&limit=20
 *
 * Cross-scope universal text search. Backend filters group/dm hits to scopes
 * the viewer can read; global/announcement entities are open. Returns up to
 * `limit` (≤50) hits along with the total visible count.
 */
export async function searchSocialEntities(
    query: string,
    opts: SearchSocialEntitiesOptions = {},
): Promise<ApiResponse<{ results: SocialEntityView[]; total: number }>> {
    const queryString = buildSocialSearchQueryString(query, opts);
    return fetchWithAuth(`/api/v3/social/search?${queryString}`);
}

// === Events — RSVP =========================================================

/**
 * RSVP status for an event. Mirrors the union in
 * `backend/src/services/social-events-rsvp.ts` so the two sides stay in lockstep.
 */
export type EventRsvpStatus = 'yes' | 'no' | 'maybe';

/**
 * Response shape from `setSocialEventRsvp` / `clearSocialEventRsvp`. The
 * server returns the full updated `rsvpStatus` map alongside the viewer's
 * own pick (`null` when cleared) so the UI can re-render the buttons
 * without re-fetching the entity.
 */
export interface SocialEventRsvpResult {
    rsvpStatus: Record<string, EventRsvpStatus>;
    mine: EventRsvpStatus | null;
}

/**
 * POST /api/v3/social/events/:id/rsvp
 *
 * Sets / moves the viewer's RSVP on the event. The userId is sourced
 * server-side from the JWT — there is no client-side parameter for it.
 * Idempotent: sending the same status twice is a no-op on the backend.
 */
export async function setSocialEventRsvp(
    eventId: string,
    status: EventRsvpStatus,
): Promise<ApiResponse<SocialEventRsvpResult>> {
    return fetchWithAuth(`/api/v3/social/events/${encodeURIComponent(eventId)}/rsvp`, {
        method: 'POST',
        body: JSON.stringify({ status }),
    });
}

/**
 * POST /api/v3/social/events/:id/rsvp/clear
 *
 * Removes the viewer's RSVP from the event. Idempotent: clearing an absent
 * entry returns the current map verbatim.
 */
export async function clearSocialEventRsvp(
    eventId: string,
): Promise<ApiResponse<SocialEventRsvpResult>> {
    return fetchWithAuth(`/api/v3/social/events/${encodeURIComponent(eventId)}/rsvp/clear`, {
        method: 'POST',
    });
}

// === Read receipts / unread counts ==========================================

/**
 * POST /api/v3/social/read
 *
 * Upserts a viewer read cursor for the given social scope. After this call any
 * entity in `(scopeType, scopeId)` authored by someone other than the viewer
 * and created at or before now will be considered "read".
 *
 * `lastEntityId` is optional. The backend stores it but unread counts today
 * compute strictly against `last_read_at`; the field is forward-compatibility
 * for richer "since X" diff renderers.
 *
 * Returns `ApiResponse<null>` — backend responds 204 on success.
 */
export async function markScopeAsRead(
    scopeType: SocialScopeType,
    scopeId: string,
    lastEntityId?: string,
): Promise<ApiResponse<null>> {
    const payload: { scopeType: SocialScopeType; scopeId: string; lastEntityId?: string } = {
        scopeType,
        scopeId,
    };
    if (lastEntityId) {
        payload.lastEntityId = lastEntityId;
    }
    return fetchWithAuth('/api/v3/social/read', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * GET /api/v3/social/unread?scopes=dm:r1,dm:r2,group:ITS-21
 *
 * Batched unread-count fetch for a list of scope keys (`"type:id"` strings).
 * Returns a record keyed by scope key. Zero-count scopes are omitted from the
 * response — callers should treat missing keys as 0.
 *
 * Sends nothing when `scopes` is empty (returns `success: true, data: {}`) so
 * the UI can call this unconditionally during initial render.
 */
export async function getSocialUnreadCounts(
    scopes: string[],
): Promise<ApiResponse<{ counts: Record<string, number> }>> {
    const deduped = Array.from(new Set((scopes || []).filter((s) => typeof s === 'string' && s.length > 0)));
    if (deduped.length === 0) {
        return { success: true, data: { counts: {} } };
    }
    const params = new URLSearchParams();
    params.set('scopes', deduped.join(','));
    return fetchWithAuth(`/api/v3/social/unread?${params.toString()}`);
}

// === Notification Center ====================================================

/**
 * Per-recipient social notification surfaced by the Notification Center page.
 * Mirrors `services/social-notifications.ts#SocialNotification` on the backend.
 *
 * `kind` is a UI label derived server-side from the underlying mention's
 * `(source_kind, entity.kind)` tuple — it does NOT correspond 1:1 to the
 * push-fan-out `PushKind` set. The UI renders an icon chip + summary line
 * based on this label.
 */
export type SocialNotificationKind = 'mention' | 'dm' | 'comment' | 'group_post' | 'announcement';

export interface SocialNotification {
    id: string;
    kind: SocialNotificationKind;
    sourceKind: 'entity' | 'comment';
    sourceEntityId: string;
    entityId: string;
    actorUserId: string;
    summary: string;
    scopeType: SocialScopeType;
    scopeId: string;
    entityKind: SocialEntityKind;
    createdAt: string;
    readAt: string | null;
}

/** Backend hard cap; mirrored here so the UI can enforce it client-side. */
export const SOCIAL_NOTIFICATION_MAX_LIMIT = 100;
export const SOCIAL_NOTIFICATION_DEFAULT_LIMIT = 30;

export interface ListSocialNotificationsOptions {
    limit?: number;
    /** ISO timestamp keyset cursor (strict `<` semantics). */
    before?: string;
    unreadOnly?: boolean;
}

/**
 * GET /api/v3/social/notifications
 *
 * Returns the viewer's most-recent mention notifications, newest-first.
 * Pagination uses the oldest `createdAt` from the previous page as `before`.
 * Backend silently drops a malformed `before` and returns the first page.
 */
export async function getSocialNotifications(
    opts: ListSocialNotificationsOptions = {},
): Promise<ApiResponse<{ notifications: SocialNotification[] }>> {
    const params = new URLSearchParams();
    if (typeof opts.limit === 'number' && Number.isFinite(opts.limit)) {
        const clamped = Math.max(1, Math.min(Math.floor(opts.limit), SOCIAL_NOTIFICATION_MAX_LIMIT));
        params.set('limit', String(clamped));
    }
    if (typeof opts.before === 'string' && opts.before.length > 0) {
        params.set('before', opts.before);
    }
    if (opts.unreadOnly === true) {
        params.set('unreadOnly', 'true');
    }
    const query = params.toString();
    return fetchWithAuth(`/api/v3/social/notifications${query ? `?${query}` : ''}`);
}

/**
 * POST /api/v3/social/notifications/read
 *
 * Marks a list of notifications as read for the viewer. The backend ignores
 * ids that belong to a different user, so a malicious payload cannot flip
 * someone else's notifications. Returns 204 on success.
 *
 * No-ops on an empty input — the backend would 400, so we short-circuit here.
 */
export async function markSocialNotificationsRead(
    ids: string[],
): Promise<ApiResponse<null>> {
    const deduped = Array.from(new Set((ids || []).filter((id) => typeof id === 'string' && id.length > 0)));
    if (deduped.length === 0) {
        return { success: true };
    }
    return fetchWithAuth('/api/v3/social/notifications/read', {
        method: 'POST',
        body: JSON.stringify({ ids: deduped }),
    });
}

/**
 * POST /api/v3/social/notifications/read-all
 *
 * Marks every unread mention as read for the viewer. Returns 204 on success.
 */
export async function markAllSocialNotificationsRead(): Promise<ApiResponse<null>> {
    return fetchWithAuth('/api/v3/social/notifications/read-all', {
        method: 'POST',
    });
}

/**
 * GET /api/v3/social/notifications/unread-count
 *
 * Returns the raw count of unread mention rows. The UI is responsible for
 * capping the display (the common pattern is "99+" once the count exceeds 99).
 */
export async function getSocialUnreadNotificationCount(): Promise<ApiResponse<{ count: number }>> {
    return fetchWithAuth('/api/v3/social/notifications/unread-count');
}

// === Moderation ============================================================
//
// Surfaces the universal social moderation backend (reports + mutes). All
// admin endpoints expect an admin session/key — the client never sends one
// directly; the cookie or `x-admin-key` header is attached by the existing
// admin auth plumbing (admin page reuses the same `fetchWithAuth` cookies).

/** Mirrors `SOCIAL_REPORT_REASON_MAX_LENGTH` on the backend. */
export const SOCIAL_REPORT_REASON_MAX_LENGTH = 500;
/** Mirrors `SOCIAL_MUTE_REASON_MAX_LENGTH` on the backend. */
export const SOCIAL_MUTE_REASON_MAX_LENGTH = 500;

/** A single report row returned by the admin list endpoint. */
export interface SocialReport {
    id: string;
    entityId: string;
    reporterUserId: string;
    reason: string | null;
    status: 'pending' | 'dismissed' | 'actioned';
    reviewerUserId: string | null;
    reviewedAt: string | null;
    createdAt: string;
}

/**
 * POST /api/v3/social/entities/:id/report
 *
 * Files a report against any social entity (post, dm message, global message,
 * announcement, etc.). The reason field is optional — moderators can still
 * use the report row even without context. Returns 201 + the new report id.
 */
export async function reportSocialEntity(
    entityId: string,
    reason?: string,
): Promise<ApiResponse<{ id: string }>> {
    const payload: { reason?: string } = {};
    if (typeof reason === 'string' && reason.trim().length > 0) {
        payload.reason = reason.trim();
    }
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(entityId)}/report`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

export interface ListSocialReportsOptions {
    status?: 'pending' | 'dismissed' | 'actioned';
    limit?: number;
    offset?: number;
}

/**
 * GET /api/v3/social/admin/reports?status=pending
 *
 * Admin-only — lists moderation reports newest-first. The backend defaults to
 * "all statuses" when `status` is omitted; the moderation UI typically pins it
 * to `pending` so the queue shows just open items.
 */
export async function listSocialReports(
    opts: ListSocialReportsOptions = {},
): Promise<ApiResponse<{ reports: SocialReport[] }>> {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (typeof opts.limit === 'number' && Number.isFinite(opts.limit)) {
        params.set('limit', String(Math.max(1, Math.floor(opts.limit))));
    }
    if (typeof opts.offset === 'number' && Number.isFinite(opts.offset)) {
        params.set('offset', String(Math.max(0, Math.floor(opts.offset))));
    }
    const query = params.toString();
    return fetchWithAuth(`/api/v3/social/admin/reports${query ? `?${query}` : ''}`);
}

/**
 * POST /api/v3/social/admin/reports/:reportId/review
 *
 * Admin-only — resolves a pending report. `dismiss` leaves the underlying
 * entity intact; `remove` soft-deletes it through the universal store.
 * Returns 204 on success. `SOCIAL_ALREADY_REVIEWED` (409) is mapped through
 * `errorCode` when the report has already been resolved.
 */
export async function reviewSocialReport(
    reportId: string,
    action: 'dismiss' | 'remove',
): Promise<ApiResponse<null>> {
    return fetchWithAuth(`/api/v3/social/admin/reports/${encodeURIComponent(reportId)}/review`, {
        method: 'POST',
        body: JSON.stringify({ action }),
    });
}

export interface MuteSocialUserInput {
    userId: string;
    scopeType: SocialScopeType;
    scopeId: string;
    reason?: string;
    /** Duration in ms. Omitted / 0 / undefined → permanent mute. */
    durationMs?: number;
}

/**
 * POST /api/v3/social/admin/mute
 *
 * Admin-only — silences a user in a specific scope. The backend honors
 * `durationMs`; omit it (or pass `0`) for a permanent mute that only an
 * `unmuteSocialUser` call clears. Returns 204 on success.
 */
export async function muteSocialUser(input: MuteSocialUserInput): Promise<ApiResponse<null>> {
    const payload: {
        userId: string;
        scopeType: SocialScopeType;
        scopeId: string;
        reason?: string;
        durationMs?: number;
    } = {
        userId: input.userId,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
    };
    if (typeof input.reason === 'string' && input.reason.trim().length > 0) {
        payload.reason = input.reason.trim();
    }
    if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) && input.durationMs > 0) {
        payload.durationMs = Math.floor(input.durationMs);
    }
    return fetchWithAuth('/api/v3/social/admin/mute', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}

/**
 * POST /api/v3/social/admin/unmute
 *
 * Admin-only — removes a mute row. Idempotent: calling on an already-unmuted
 * user is a 204 no-op.
 */
export async function unmuteSocialUser(
    userId: string,
    scopeType: SocialScopeType,
    scopeId: string,
): Promise<ApiResponse<null>> {
    return fetchWithAuth('/api/v3/social/admin/unmute', {
        method: 'POST',
        body: JSON.stringify({ userId, scopeType, scopeId }),
    });
}

/**
 * Pure helper — clamp / sanitize a moderation reason for either reports or
 * mutes. Returns the trimmed reason, or `null` if the input is empty / not a
 * string. Throws when the reason exceeds the supplied cap so the caller can
 * surface a UI validation error before round-tripping to the server.
 *
 * Exported separately from the endpoint helpers so the report modal and the
 * mute modal can share a single validation routine.
 */
export function sanitizeModerationReason(
    input: unknown,
    maxLength: number = SOCIAL_REPORT_REASON_MAX_LENGTH,
): string | null {
    if (typeof input !== 'string') return null;
    const trimmed = input.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.length > maxLength) {
        throw new Error('reason too long');
    }
    return trimmed;
}

// === Polls =================================================================
//
// Polls live in `app_social_entity` like other kinds but voting cannot reuse
// `updateSocialEntity` — that route is owner-only. The dedicated endpoints
// below let any scope-member viewer cast / unvote, and gate close to the
// poll author. Server returns the fresh `votes` map plus the viewer's
// derived `myVote` so the client can re-render without a follow-up read.

/**
 * Aggregated vote state returned by every poll-mutation endpoint.
 * `votes` is the full per-option bucket map (`{ optionId: userIds[] }`);
 * `myVote` is the option the viewer is currently in, or `null` after a
 * successful unvote (or when the viewer hadn't voted yet).
 */
export interface SocialPollVoteResult {
    votes: Record<string, string[]>;
    /**
     * Viewer's currently-selected option for single-choice polls (or the
     * first selection in iteration order for multi-choice). Kept as a
     * legacy contract — `myVotes` (plural) is the canonical multi-choice
     * source.
     */
    myVote: string | null;
    /**
     * Every option the viewer has voted for. Always an array — length-1 for
     * single-choice, 0..N for multi-choice. Backend always populates this;
     * the optional marker keeps the type backwards-compatible during the
     * rollout.
     */
    myVotes?: string[];
}

/**
 * POST /api/v3/social/polls/:id/vote — single-choice. Casting a vote for B
 * when the viewer was previously in A silently moves them. Backend rejects
 * with:
 *   - 404 SOCIAL_NOT_FOUND for missing / soft-deleted / non-poll entities
 *   - 400 SOCIAL_POLL_INVALID_OPTION for unknown optionId
 *   - 409 SOCIAL_POLL_CLOSED once `payload.closedAt` is set
 *   - 403 SOCIAL_FORBIDDEN when the viewer lacks scope read access
 */
export async function voteOnPoll(
    pollId: string,
    optionId: string,
): Promise<ApiResponse<SocialPollVoteResult>> {
    return fetchWithAuth(`/api/v3/social/polls/${encodeURIComponent(pollId)}/vote`, {
        method: 'POST',
        body: JSON.stringify({ optionId }),
    });
}

/**
 * POST /api/v3/social/polls/:id/unvote — clears the viewer's vote (no-op when
 * they hadn't voted). Same 4xx error codes as `voteOnPoll`.
 */
export async function unvotePoll(
    pollId: string,
): Promise<ApiResponse<SocialPollVoteResult>> {
    return fetchWithAuth(`/api/v3/social/polls/${encodeURIComponent(pollId)}/unvote`, {
        method: 'POST',
    });
}

/**
 * POST /api/v3/social/polls/:id/close — author only. Idempotent: closing an
 * already-closed poll succeeds without rewriting `closedAt`. Returns 204 on
 * success (no body), 403 for non-authors, 404 for missing entities.
 */
export async function closePoll(
    pollId: string,
): Promise<ApiResponse<null>> {
    return fetchWithAuth(`/api/v3/social/polls/${encodeURIComponent(pollId)}/close`, {
        method: 'POST',
    });
}

// === Event series extension =================================================

export interface ExtendEventSeriesResult {
    seriesId: string;
    nextStartsAt: string | null;
    createdIds: string[];
    createdCount: number;
}

/**
 * POST /api/v3/social/events/:id/extend-series — materialize N more future
 * occurrences for a recurring event. Author-only. Pass any occurrence id of
 * the series; the backend walks from the latest occurrence forward.
 *
 * Server clamps `additional` to `[1, 26]` (MAX_SERIES_OCCURRENCES).
 * Server errors:
 *   - 404 SOCIAL_NOT_FOUND for missing / soft-deleted entities
 *   - 400 SOCIAL_EVENT_NOT_A_SERIES when the entity is a one-off event
 *   - 403 SOCIAL_FORBIDDEN for non-authors or lost scope access
 */
export async function extendEventSeries(
    eventId: string,
    additional?: number,
): Promise<ApiResponse<ExtendEventSeriesResult>> {
    const body: Record<string, unknown> = {};
    if (typeof additional === 'number' && additional > 0) {
        body.additional = Math.floor(additional);
    }
    return fetchWithAuth(`/api/v3/social/events/${encodeURIComponent(eventId)}/extend-series`, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

// === View tracking ==========================================================

/**
 * POST /api/v3/social/entities/:id/view
 *
 * Records that the authenticated viewer has seen this entity. Idempotent at
 * the per-user level (composite PK + ON CONFLICT DO NOTHING on the backend)
 * so repeated calls collapse to a single row.
 *
 * Drives the `viewCount` and `hasViewed` flags surfaced on `SocialEntityView`
 * — once a card calls this, subsequent list/get fetches will reflect the
 * incremented count and a true `hasViewed` for the same viewer.
 *
 * Returns `ApiResponse<null>` — backend responds 204 on success.
 *
 * No-ops on blank entity id — the backend would 400, so we short-circuit
 * here to keep `useSocialViewTracker` safe to call with a `null` id.
 */
export async function recordSocialView(
    entityId: string,
): Promise<ApiResponse<null>> {
    const trimmed = (entityId || '').trim();
    if (!trimmed) {
        return { success: true };
    }
    return fetchWithAuth(`/api/v3/social/entities/${encodeURIComponent(trimmed)}/view`, {
        method: 'POST',
    });
}

/**
 * Single viewer row returned by `getSocialEntityViewers`.
 */
export interface SocialEntityViewer {
    userId: string;
    /** ISO timestamp of when the view was first recorded. */
    viewedAt: string;
}

/**
 * GET /api/v3/social/entities/:id/views?limit=N
 *
 * Admin-only — backend rejects non-admin callers with 403. Returns the list
 * of distinct users who have viewed the entity, ordered by most-recent view
 * first. Used by moderation tooling to audit who saw an announcement.
 *
 * `limit` is clamped server-side to 2000.
 */
export async function getSocialEntityViewers(
    entityId: string,
    limit?: number,
): Promise<ApiResponse<{ viewers: SocialEntityViewer[]; count: number }>> {
    const params = new URLSearchParams();
    if (typeof limit === 'number' && Number.isFinite(limit)) {
        const clamped = Math.max(1, Math.min(Math.floor(limit), 2000));
        params.set('limit', String(clamped));
    }
    const query = params.toString();
    return fetchWithAuth(
        `/api/v3/social/entities/${encodeURIComponent(entityId)}/views${query ? `?${query}` : ''}`,
    );
}

// === Link preview / unfurl ==================================================

/**
 * Open Graph preview metadata for a URL. Mirrors the `LinkPreview` shape from
 * `backend/src/services/link-previews.ts`. Fields are independently nullable —
 * a successful fetch may still come back with no `imageUrl` if the upstream
 * page has no `<meta og:image>` tag.
 *
 * `status`:
 *   - `'ok'`      — fetched and parsed; metadata fields populated when present
 *   - `'failed'`  — upstream unreachable / non-HTML / parsing error
 *   - `'blocked'` — SSRF gate rejected the target (private IP, non-http, etc.)
 *
 * The card UI hides itself entirely when `status !== 'ok'` AND every metadata
 * field is null — there is nothing useful to render.
 */
export interface LinkPreview {
    url: string;
    title: string | null;
    description: string | null;
    imageUrl: string | null;
    siteName: string | null;
    status: 'ok' | 'failed' | 'blocked';
}

/**
 * GET /api/v3/social/link-preview?url=...
 *
 * Resolve Open Graph metadata for a URL. Auth-required + rate-limited
 * (10/min/user on the backend) — callers should debounce / cache locally.
 *
 * Short-circuits on a blank URL to keep `LinkPreviewCard` safe to render
 * before its parent has decided whether any URL is present.
 */
export async function getLinkPreview(
    url: string,
): Promise<ApiResponse<{ preview: LinkPreview }>> {
    const trimmed = (url || '').trim();
    if (!trimmed) {
        return {
            success: false,
            error: 'url is required',
            errorCode: 'SOCIAL_VALIDATION_REQUIRED',
        };
    }
    return fetchWithAuth(
        `/api/v3/social/link-preview?url=${encodeURIComponent(trimmed)}`,
    );
}
