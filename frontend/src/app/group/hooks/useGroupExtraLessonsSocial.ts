/**
 * `useGroupExtraLessonsSocial` — read-only group extra-lessons hook backed by
 * the universal social store (`/api/v3/social/*`).
 *
 * This is the Phase 2 POC entry point for the social-store migration of the
 * extra-lessons list. It is gated by the `socialFeedBeta` feature flag (see
 * `LessonsTab.tsx`, same kill-switch as the feed) and is wired alongside the
 * legacy `useGroupLessons` so the two can be toggled at runtime.
 *
 * Important boundaries:
 *  - **READ-only.** Creating / editing / deleting / restoring still have a
 *    parallel write path in `social-extra-lesson-actions.ts`. This hook only
 *    surfaces the entity list.
 *  - Returns a shape close enough to `useGroupLessons` for `LessonsTab` to
 *    bridge with a thin adapter: `lessons`, `loading`, `error`, `refresh`.
 *  - Adapter is `social-entity-to-extra-lesson.ts` so the mapping stays
 *    unit-testable independently of the hook.
 *  - `pinnedFirst: false` — lessons are chronological, not feed-style.
 *    Ordering by `startsAt` ASC is applied **client-side after fetch** because
 *    the social API does not expose a `sortBy` query param (Phase 1c surface
 *    is fixed). When the server-side sort becomes available we can drop the
 *    in-memory sort below.
 *  - `limit: 100` — matches tasks; extra lessons accumulate at a similar rate
 *    (multiple events per week × semester).
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import {
    listSocialEntitiesByScope,
    type SocialEntityView,
} from '@/lib/api/social';
import {
    socialEntityToExtraLessonView,
    type GroupExtraLessonAdapterShape,
} from '../utils/social-entity-to-extra-lesson';

export interface UseGroupExtraLessonsSocialResult {
    lessons: GroupExtraLessonAdapterShape[];
    loading: boolean;
    error: string;
    refresh: () => Promise<void>;
}

export interface UseGroupExtraLessonsSocialOptions {
    /**
     * Gate the network call. Defaults to `true`. When `false` the hook clears
     * its state and skips fetching — used by `LessonsTab` to avoid paying for
     * both legacy + social requests when the beta flag is off.
     */
    enabled?: boolean;
}

/**
 * In-memory sort by `startsAt` ASC. Exposed so callers (and tests) can verify
 * the chronological ordering rule without re-implementing the comparator.
 * Lessons with malformed / empty `startsAt` sort last (Infinity), matching the
 * legacy renderer's "unknown time" tail behavior.
 */
function compareByStartsAt(
    left: GroupExtraLessonAdapterShape,
    right: GroupExtraLessonAdapterShape,
): number {
    const leftTime = left.startsAt ? new Date(left.startsAt).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = right.startsAt ? new Date(right.startsAt).getTime() : Number.POSITIVE_INFINITY;
    const leftSafe = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
    const rightSafe = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
    return leftSafe - rightSafe;
}

/**
 * Pure data-flow primitive for the social-extra-lessons read. Exposed for
 * unit testing — the hook below just lifts the result into React state.
 * Returns a discriminated result so a failure does not need to throw across
 * the hook boundary.
 *
 * `fetcher` is parameterized so tests can supply a fake without touching the
 * default-export module-level binding.
 */
export async function loadGroupExtraLessonsSocial(
    groupKey: string,
    fetcher: typeof listSocialEntitiesByScope = listSocialEntitiesByScope,
): Promise<
    | { ok: true; lessons: GroupExtraLessonAdapterShape[] }
    | { ok: false; error: string }
> {
    const scopeId = `group:${groupKey}`;
    const result: ApiResponse<{ entities: SocialEntityView[] }> = await fetcher('group', scopeId, {
        kind: 'extra_lesson',
        limit: 100,
        pinnedFirst: false,
    });
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load lessons' };
    }
    const entities = result.data?.entities || [];
    const lessons = entities.map(socialEntityToExtraLessonView).sort(compareByStartsAt);
    return { ok: true, lessons };
}

export function useGroupExtraLessonsSocial(
    groupKey?: string,
    opts: UseGroupExtraLessonsSocialOptions = {},
): UseGroupExtraLessonsSocialResult {
    const enabled = opts.enabled !== false;
    const [lessons, setLessons] = useState<GroupExtraLessonAdapterShape[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setLessons([]);
            return;
        }

        setLoading(true);
        setError('');
        const result = await loadGroupExtraLessonsSocial(groupKey);
        if (!result.ok) {
            setError(result.error);
            setLessons([]);
            setLoading(false);
            return;
        }
        setLessons(result.lessons);
        setLoading(false);
    }, [enabled, groupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    return { lessons, loading, error, refresh };
}
