/**
 * Adapter from `SocialEntityView` (universal social store) → an
 * announcement-shaped view used by the coordinator/curator/starosta announcement
 * surfaces.
 *
 * Used by the `socialFeedBeta` opt-in path: when enabled, the announcement
 * list is read from
 * `/api/v3/social/scope/announcement/announcement:global/entities?kind=announcement`
 * instead of `/api/v3/group/coordinator-announcements` (starosta) and
 * `/api/v3/admin/coordinator-announcements` (coordinator/curator). The adapter
 * intentionally keeps existing UI components — `CoordinatorPage`, `CuratorPage`,
 * `StarostaPage` — usable behind a thin re-shape, but the shape returned here
 * mirrors the **social payload directly** rather than the legacy
 * `CoordinatorAnnouncementView`. Callers that need the legacy enum (e.g.
 * `getAnnouncementAccent`) coerce via the helpers in
 * `social-announcement-actions.ts`.
 *
 * Mapping rules (mirror the Phase 1c shim in
 * `backend/src/services/coordinator-announcement-shim.ts`):
 *  - `scopeId` is `announcement:global`; we don't expose it back to the UI
 *    (the global scope is the only one announcements ever live under in
 *    Phase 1).
 *  - `payload` is `{ title, body, priority, targetGroups?, expiresAt? }`. The
 *    shim coerces legacy `'info' | 'warning' | 'critical'` into
 *    `'low' | 'medium' | 'high' | 'critical'` before writing the social mirror,
 *    so the value coming back here is **always** in the social union. Defensive
 *    fall-through to `'medium'` for unknown strings (matches the shim's escape
 *    hatch).
 *  - `deletedAt` doubles as `revokedAt` (the legacy schema's tombstone for
 *    announcements). `revokedAt` is surfaced as an alias so the existing UI
 *    that reads `announcement.revokedAt` stays compilable without a rename.
 *  - **`viewCount` is populated from the universal store.** The
 *    `app_social_view` table is updated by `recordSocialView` /
 *    `useSocialViewTracker`; `listEntitiesByScope` enriches each
 *    `SocialEntityView` with `viewCount` + `hasViewed` so the announcement
 *    card can render real numbers in beta mode. The legacy
 *    `markCoordinatorAnnouncementViewed` endpoint is left untouched on the
 *    legacy code path — the two view-tracking surfaces do not share a table.
 *  - `targetGroups` is lifted from payload; when the shim omits it (i.e. the
 *    announcement was created with `targetMode='all_starostas'`), the field is
 *    absent and the consumer can interpret the absence as a global broadcast.
 *
 * Pure function — no React, no fetch. Used by the hook AND by tests directly.
 */
import type { SocialEntityView } from '@/lib/api/social';
import type {
    CoordinatorAnnouncementPriority,
    CoordinatorAnnouncementView,
} from '@/lib/api';

export type SocialAnnouncementPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Announcement-shaped view returned by the adapter. Intentionally lightweight —
 * mirrors the **subset** of the social payload that the existing UI surfaces
 * read plus the cross-cutting entity fields (`id`, `authorUserId`,
 * timestamps, soft-delete state).
 *
 * The shape diverges from the legacy `CoordinatorAnnouncementView` on three
 * axes (see header docs):
 *  - `priority` enum is the social-store union, not the legacy one.
 *  - `revokedAt` is an alias for `deletedAt` so legacy-shaped UI compiles.
 *  - `viewCount` is optional and currently always absent — see header note.
 */
export interface AnnouncementAdapterShape {
    id: string;
    title: string;
    body: string;
    priority: SocialAnnouncementPriority;
    /**
     * Target groups lifted from `payload.targetGroups`. Absent when the
     * announcement targets all-starostas (the shim does not write the field
     * in that case). Consumers should treat an absent value as "global
     * broadcast" rather than "no targets".
     */
    targetGroups?: string[];
    /** ISO timestamp lifted from `payload.expiresAt`, when present. */
    expiresAt?: string;
    authorUserId: string;
    createdAt: string;
    updatedAt: string;
    /**
     * `app_social_entity.deleted_at` mirrors the legacy `revoked_at` column for
     * announcements. We surface it under both names so callers that read
     * `revokedAt` (existing pages) and callers that read `deletedAt` (new
     * code aligned with the universal model) both work.
     */
    deletedAt: string | null;
    revokedAt: string | null;
    /**
     * Distinct-user view count from `app_social_view`, surfaced via the
     * universal store enrichment. Always present (defaults to `0` for a
     * fresh entity). Previously absent during the early POC — now populated.
     */
    viewCount: number;
    /**
     * Whether the current viewer has already been recorded as having seen
     * this announcement. Drives the auto-mark-as-viewed bridge so a
     * re-render does not duplicate the recordView POST.
     */
    hasViewed: boolean;
    /**
     * Aggregated reactions on the universal entity, re-shaped into the
     * `{ items, mine }` envelope that the existing `ReactionsBar` consumes
     * (matches the convention in `social-entity-to-task` /
     * `social-entity-to-extra-lesson` / `social-entity-to-post`). Always
     * present — `items` is `[]` and `mine` is `[]` when the entity has no
     * reactions yet.
     */
    reactions: {
        items: Array<{ emoji: string; count: number }>;
        mine: string[];
    };
}

const ALLOWED_PRIORITIES: ReadonlySet<SocialAnnouncementPriority> = new Set([
    'low',
    'medium',
    'high',
    'critical',
]);

function readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    return typeof value === 'string' ? value : '';
}

function readOptionalString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === 'string' && value ? value : undefined;
}

function readPriority(payload: Record<string, unknown>): SocialAnnouncementPriority {
    const value = payload['priority'];
    if (typeof value === 'string' && ALLOWED_PRIORITIES.has(value as SocialAnnouncementPriority)) {
        return value as SocialAnnouncementPriority;
    }
    // Defensive fallback — matches the shim's "unknown legacy value →
    // 'medium'" branch. Surfacing an invalid enum upstream would crash
    // `getAnnouncementAccent` or render a literal `undefined` in the UI pill.
    return 'medium';
}

function readTargetGroups(payload: Record<string, unknown>): string[] | undefined {
    const value = payload['targetGroups'];
    if (!Array.isArray(value)) return undefined;
    const groups = value.filter((item): item is string => typeof item === 'string');
    return groups.length > 0 ? groups : undefined;
}

export function socialEntityToAnnouncementView(view: SocialEntityView): AnnouncementAdapterShape {
    const entity = view.entity;
    const payload = entity.payload || {};
    const targetGroups = readTargetGroups(payload);
    const expiresAt = readOptionalString(payload, 'expiresAt');
    const result: AnnouncementAdapterShape = {
        id: entity.id,
        title: readString(payload, 'title'),
        body: readString(payload, 'body'),
        priority: readPriority(payload),
        authorUserId: entity.authorUserId,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        deletedAt: entity.deletedAt,
        revokedAt: entity.deletedAt,
        // View tracking surfaced by the universal store. `viewCount` is the
        // distinct-user count from `app_social_view`; `hasViewed` flips to
        // true once the viewer's `recordSocialView` has been recorded.
        viewCount: typeof view.viewCount === 'number' && Number.isFinite(view.viewCount)
            ? Math.max(0, Math.floor(view.viewCount))
            : 0,
        hasViewed: Boolean(view.hasViewed),
        reactions: {
            items: view.reactions.map((aggregate) => ({
                emoji: aggregate.emoji,
                count: aggregate.count,
            })),
            mine: [...view.myReactions],
        },
    };
    if (targetGroups !== undefined) result.targetGroups = targetGroups;
    if (expiresAt !== undefined) result.expiresAt = expiresAt;
    return result;
}

/**
 * Bridge from the social-store priority union to the legacy
 * `CoordinatorAnnouncementPriority` enum used by the existing UI (the accent
 * helper, the priority pill copy). The social union has four levels and the
 * legacy enum has three — we fold `'low'` → `'info'`, `'medium'|'high'` →
 * `'warning'`, and pass `'critical'` straight through. Round-trips through
 * the legacy path are lossy but acceptable for the POC.
 */
function priorityToLegacyEnum(priority: SocialAnnouncementPriority): CoordinatorAnnouncementPriority {
    switch (priority) {
        case 'low':
            return 'info';
        case 'medium':
        case 'high':
            return 'warning';
        case 'critical':
            return 'critical';
        default:
            return 'warning';
    }
}

/**
 * Back-mapper: re-shape an `AnnouncementAdapterShape` into the legacy
 * `CoordinatorAnnouncementView` consumed by `CoordinatorPage` / `CuratorPage`
 * / `StarostaPage`. Used by the integration layer so the existing page
 * components stay unchanged when the `socialFeedBeta` flag is on.
 *
 * Fields that have no social-store equivalent in Phase 1 get safe defaults:
 *  - `viewCount`: now populated from `app_social_view` via the universal
 *    store enrichment. Was hard-coded to `0` in the early POC; the
 *    view-tracking migration (`useSocialViewTracker` + `recordSocialView` +
 *    `app_social_view`) backfills real numbers in beta mode.
 *  - `targetMode`: derived from `targetGroups` presence (matches the legacy
 *    contract — `'groups'` when an array is present, `'all_starostas'` when
 *    absent).
 *  - `viewedAt`: undefined (the social store tracks `hasViewed` as a boolean
 *    per viewer rather than a single timestamp).
 */
export function socialAnnouncementToCoordinatorView(
    announcement: AnnouncementAdapterShape,
): CoordinatorAnnouncementView {
    const targetGroups = announcement.targetGroups ?? [];
    return {
        id: announcement.id,
        authorUserId: announcement.authorUserId,
        title: announcement.title,
        body: announcement.body,
        priority: priorityToLegacyEnum(announcement.priority),
        targetMode: targetGroups.length > 0 ? 'groups' : 'all_starostas',
        targetGroups,
        expiresAt: announcement.expiresAt ?? null,
        revokedAt: announcement.revokedAt,
        createdAt: announcement.createdAt,
        updatedAt: announcement.updatedAt,
        viewCount: announcement.viewCount ?? 0,
        viewedAt: null,
    };
}
