/**
 * `useGroupFeedSocial` — read-only group feed hook backed by the universal
 * social store (`/api/v3/social/*`).
 *
 * This is the Phase 2 POC entry point for the social-store migration. It is
 * gated by the `socialFeedBeta` feature flag (see `FeedTab.tsx`) and is wired
 * alongside the legacy `useGroupFeed` so the two can be toggled at runtime.
 *
 * Important boundaries:
 *  - **READ-only.** Creating / editing / deleting / reaction-toggling still
 *    flow through `useGroupFeed`. Phase 1c dual-write guarantees that posts
 *    created via legacy show up here.
 *  - Returns a shape close enough to `useGroupFeed` for the feed component to
 *    bridge with a thin adapter: `posts`, `loading`, `error`, `refresh`.
 *    Trash / write methods intentionally omitted.
 *  - Adapter is `social-entity-to-post.ts` so the mapping stays unit-testable
 *    independently of the hook.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import {
    listSocialEntitiesByScope,
    type SocialEntityView,
} from '@/lib/api/social';
import {
    socialEntityToPostView,
    type SocialPostAdapterResult,
} from '../utils/social-entity-to-post';

export interface UseGroupFeedSocialResult {
    posts: SocialPostAdapterResult[];
    loading: boolean;
    error: string;
    refresh: () => Promise<void>;
}

export interface UseGroupFeedSocialOptions {
    /**
     * Gate the network call. Defaults to `true`. When `false` the hook clears
     * its state and skips fetching — used by the feed component to avoid
     * paying for both legacy + social requests when the beta flag is off.
     */
    enabled?: boolean;
}

/**
 * Pure data-flow primitive for the social-feed read. Exposed for unit testing
 * — the hook below just lifts the result into React state. Returns a discriminated
 * result so a failure does not need to throw across the hook boundary.
 *
 * `fetcher` is parameterized so tests can supply a fake without touching the
 * default-export module-level binding.
 */
export async function loadGroupFeedSocial(
    groupKey: string,
    fetcher: typeof listSocialEntitiesByScope = listSocialEntitiesByScope,
): Promise<
    | { ok: true; posts: SocialPostAdapterResult[] }
    | { ok: false; error: string }
> {
    const scopeId = `group:${groupKey}`;
    const result: ApiResponse<{ entities: SocialEntityView[] }> = await fetcher('group', scopeId, {
        kind: 'post',
        limit: 50,
        pinnedFirst: true,
    });
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load feed' };
    }
    const entities = result.data?.entities || [];
    return { ok: true, posts: entities.map(socialEntityToPostView) };
}

export function useGroupFeedSocial(
    groupKey?: string,
    opts: UseGroupFeedSocialOptions = {},
): UseGroupFeedSocialResult {
    const enabled = opts.enabled !== false;
    const [posts, setPosts] = useState<SocialPostAdapterResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setPosts([]);
            return;
        }

        setLoading(true);
        setError('');
        const result = await loadGroupFeedSocial(groupKey);
        if (!result.ok) {
            setError(result.error);
            setPosts([]);
            setLoading(false);
            return;
        }
        setPosts(result.posts);
        setLoading(false);
    }, [enabled, groupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    return { posts, loading, error, refresh };
}
