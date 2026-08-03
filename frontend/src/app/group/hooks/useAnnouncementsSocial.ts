/**
 * `useAnnouncementsSocial` — read-only coordinator announcements hook backed
 * by the universal social store (`/api/v3/social/*`).
 *
 * This is the Phase 2 POC entry point for the coordinator-announcement
 * surface migration. It is gated by the `socialFeedBeta` feature flag (the
 * single kill-switch for the whole social-store rollout, same as feed/tasks)
 * and is wired alongside the legacy
 * `getCoordinatorAnnouncementsForGroup` (starosta) and
 * `getAdminCoordinatorAnnouncements` (coordinator/curator) calls so the two
 * can be toggled at runtime.
 *
 * Important boundaries:
 *  - **READ-only.** Creating / revoking / restoring / pinning happens through
 *    the parallel write wrappers in `social-announcement-actions.ts`. This
 *    hook only surfaces the entity list.
 *  - View-count tracking via `markCoordinatorAnnouncementViewed` stays on the
 *    **legacy** path in this POC — the universal store has no per-entity view
 *    counter today. Callers that need view metrics should keep firing the
 *    legacy mark-viewed endpoint regardless of the feature flag.
 *  - Adapter is `social-entity-to-announcement.ts` so the mapping stays
 *    unit-testable independently of the hook.
 *  - `pinnedFirst: true` mirrors the feed hook — pinned announcements should
 *    surface at the top once the social-store pin endpoint is wired through
 *    `pinAnnouncementUnified`. Today legacy has no pin semantics for
 *    announcements; the flag is forward-compat.
 *  - Scope is the **global** announcement scope (`announcement:global`) —
 *    targeting is encoded in `payload.targetGroups`, not in the scope index.
 *    Callers that need to filter by group must do so post-fetch (the existing
 *    UI already implements this for the legacy path).
 *
 * Surface shape mirrors `useGroupFeedSocial` so callers can lift the
 * pattern: `announcements`, `isLoading`, `error`, `refresh`. The name is
 * `isLoading` (not `loading`) because the spec — and the existing
 * announcement state in `CoordinatorPage` — uses `announcementsLoading`,
 * which reads more naturally as a boolean variable.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import {
    listSocialEntitiesByScope,
    type SocialEntityView,
} from '@/lib/api/social';

const ANNOUNCEMENT_SCOPE_TYPE = 'announcement' as const;
const ANNOUNCEMENT_SCOPE_ID = 'announcement:global';
const ANNOUNCEMENT_LIMIT = 50;

export interface UseAnnouncementsSocialOptions {
    /**
     * Gate the network call. Defaults to `true`. When `false` the hook clears
     * its state and skips fetching — used by the coordinator/curator/starosta
     * pages to avoid paying for both legacy + social requests when the beta
     * flag is off.
     */
    enabled?: boolean;
}

export interface UseAnnouncementsSocialResult {
    announcements: SocialEntityView[];
    isLoading: boolean;
    error: string | null;
    refresh: () => void;
}

/**
 * Pure data-flow primitive for the social-announcements read. Exposed for
 * unit testing — the hook below just lifts the result into React state.
 * Returns a discriminated result so a failure does not need to throw across
 * the hook boundary.
 *
 * `fetcher` is parameterized so tests can supply a fake without touching the
 * default-export module-level binding (the repo convention — see
 * `loadGroupFeedSocial`).
 *
 * The return type intentionally surfaces the raw `SocialEntityView[]` rather
 * than the adapter shape. Some pages (coordinator) need to keep their
 * existing `CoordinatorAnnouncementView` consumer code working via a
 * back-mapping step, others (a fresh UI) can skip the legacy shape entirely
 * and read the universal entity directly. Returning the raw view leaves both
 * options open.
 */
export async function loadAnnouncementsSocial(
    fetcher: typeof listSocialEntitiesByScope = listSocialEntitiesByScope,
): Promise<
    | { ok: true; announcements: SocialEntityView[] }
    | { ok: false; error: string }
> {
    const result: ApiResponse<{ entities: SocialEntityView[] }> = await fetcher(
        ANNOUNCEMENT_SCOPE_TYPE,
        ANNOUNCEMENT_SCOPE_ID,
        {
            kind: 'announcement',
            limit: ANNOUNCEMENT_LIMIT,
            pinnedFirst: true,
        },
    );
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load announcements' };
    }
    const entities = result.data?.entities || [];
    return { ok: true, announcements: entities };
}

export function useAnnouncementsSocial(
    opts: UseAnnouncementsSocialOptions = {},
): UseAnnouncementsSocialResult {
    const enabled = opts.enabled !== false;
    const [announcements, setAnnouncements] = useState<SocialEntityView[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshAsync = useCallback(async () => {
        if (!enabled) {
            setAnnouncements([]);
            setIsLoading(false);
            setError(null);
            return;
        }

        setIsLoading(true);
        setError(null);
        const result = await loadAnnouncementsSocial();
        if (!result.ok) {
            setError(result.error);
            setAnnouncements([]);
            setIsLoading(false);
            return;
        }
        setAnnouncements(result.announcements);
        setIsLoading(false);
    }, [enabled]);

    // Public refresh is a `() => void` so callers can drop the result without
    // a `void` cast (matches the spec contract). Internally we kick off the
    // async load and let React batch state.
    const refresh = useCallback(() => {
        void refreshAsync();
    }, [refreshAsync]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshAsync();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refreshAsync]);

    return { announcements, isLoading, error, refresh };
}
