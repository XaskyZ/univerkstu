/**
 * `useGroupEventsSocial` — read-only hook for `kind='event'` entities in a
 * group scope, backed by the universal social store (`/api/v3/social/*`).
 *
 * Mirrors `useGroupFeedSocial` (the post variant) but with the event adapter
 * and a different list filter. Stays read-only — writes (create / update /
 * delete) flow through dedicated helpers below (CreateEventModal posts via
 * `createSocialEntity` directly). The hook is gated by the `socialFeedBeta`
 * feature flag at the call site so it never fires when the beta is off.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import {
    listSocialEntitiesByScope,
    type SocialEntityView,
} from '@/lib/api/social';
import {
    socialEntityToEventView,
    type EventAdapterShape,
} from '../utils/social-entity-to-event';

export interface UseGroupEventsSocialResult {
    events: EventAdapterShape[];
    loading: boolean;
    error: string;
    refresh: () => Promise<void>;
}

export interface UseGroupEventsSocialOptions {
    /**
     * Gate the network call. Defaults to `true`. When `false` the hook
     * clears its state and skips fetching — same pattern as
     * `useGroupFeedSocial`.
     */
    enabled?: boolean;
}

/**
 * Pure data-flow primitive for the social-events read. Exposed for unit
 * testing — the hook below just lifts the result into React state.
 */
export async function loadGroupEventsSocial(
    groupKey: string,
    viewerUserId: string,
    fetcher: typeof listSocialEntitiesByScope = listSocialEntitiesByScope,
): Promise<
    | { ok: true; events: EventAdapterShape[] }
    | { ok: false; error: string }
> {
    const scopeId = `group:${groupKey}`;
    const result: ApiResponse<{ entities: SocialEntityView[] }> = await fetcher('group', scopeId, {
        kind: 'event',
        limit: 50,
        pinnedFirst: true,
    });
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load events' };
    }
    const entities = result.data?.entities || [];
    return {
        ok: true,
        events: entities.map((entity) => socialEntityToEventView(entity, viewerUserId)),
    };
}

export function useGroupEventsSocial(
    groupKey: string | undefined,
    viewerUserId: string,
    opts: UseGroupEventsSocialOptions = {},
): UseGroupEventsSocialResult {
    const enabled = opts.enabled !== false;
    const [events, setEvents] = useState<EventAdapterShape[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setEvents([]);
            return;
        }
        setLoading(true);
        setError('');
        const result = await loadGroupEventsSocial(groupKey, viewerUserId);
        if (!result.ok) {
            setError(result.error);
            setEvents([]);
            setLoading(false);
            return;
        }
        setEvents(result.events);
        setLoading(false);
    }, [enabled, groupKey, viewerUserId]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    return { events, loading, error, refresh };
}
