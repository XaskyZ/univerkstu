/**
 * `useGroupTasksSocial` — read-only group tasks hook backed by the universal
 * social store (`/api/v3/social/*`).
 *
 * This is the Phase 2 POC entry point for the social-store migration of the
 * tasks list. It is gated by the `socialFeedBeta` feature flag (see
 * `TasksTab.tsx`, same kill-switch as the feed) and is wired alongside the
 * legacy `useGroupTasks` so the two can be toggled at runtime.
 *
 * Important boundaries:
 *  - **READ-only.** Creating / editing / deleting / completion-toggling still
 *    have a parallel write path in `social-task-actions.ts`. This hook only
 *    surfaces the entity list.
 *  - Returns a shape close enough to `useGroupTasks` for `TasksTab` to bridge
 *    with a thin adapter: `tasks`, `loading`, `error`, `refresh`.
 *  - Adapter is `social-entity-to-task.ts` so the mapping stays unit-testable
 *    independently of the hook.
 *  - `pinnedFirst: false` — tasks don't have a curated-pinned section in the
 *    UI; ordering is by completion / deadline / updatedAt (handled in
 *    `TasksTab`).
 *  - `limit: 100` — twice the feed default since open tasks accumulate faster.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import {
    listSocialEntitiesByScope,
    type SocialEntityView,
} from '@/lib/api/social';
import {
    socialEntityToTaskView,
    type GroupTaskAdapterShape,
} from '../utils/social-entity-to-task';

export interface UseGroupTasksSocialResult {
    tasks: GroupTaskAdapterShape[];
    loading: boolean;
    error: string;
    refresh: () => Promise<void>;
}

export interface UseGroupTasksSocialOptions {
    /**
     * Gate the network call. Defaults to `true`. When `false` the hook clears
     * its state and skips fetching — used by `TasksTab` to avoid paying for
     * both legacy + social requests when the beta flag is off.
     */
    enabled?: boolean;
}

/**
 * Pure data-flow primitive for the social-tasks read. Exposed for unit testing
 * — the hook below just lifts the result into React state. Returns a
 * discriminated result so a failure does not need to throw across the hook
 * boundary.
 *
 * `fetcher` is parameterized so tests can supply a fake without touching the
 * default-export module-level binding.
 */
export async function loadGroupTasksSocial(
    groupKey: string,
    fetcher: typeof listSocialEntitiesByScope = listSocialEntitiesByScope,
): Promise<
    | { ok: true; tasks: GroupTaskAdapterShape[] }
    | { ok: false; error: string }
> {
    const scopeId = `group:${groupKey}`;
    const result: ApiResponse<{ entities: SocialEntityView[] }> = await fetcher('group', scopeId, {
        kind: 'task',
        limit: 100,
        pinnedFirst: false,
    });
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load tasks' };
    }
    const entities = result.data?.entities || [];
    return { ok: true, tasks: entities.map(socialEntityToTaskView) };
}

export function useGroupTasksSocial(
    groupKey?: string,
    opts: UseGroupTasksSocialOptions = {},
): UseGroupTasksSocialResult {
    const enabled = opts.enabled !== false;
    const [tasks, setTasks] = useState<GroupTaskAdapterShape[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setTasks([]);
            return;
        }

        setLoading(true);
        setError('');
        const result = await loadGroupTasksSocial(groupKey);
        if (!result.ok) {
            setError(result.error);
            setTasks([]);
            setLoading(false);
            return;
        }
        setTasks(result.tasks);
        setLoading(false);
    }, [enabled, groupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    return { tasks, loading, error, refresh };
}
