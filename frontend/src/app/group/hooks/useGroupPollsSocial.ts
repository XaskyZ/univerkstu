/**
 * `useGroupPollsSocial` — read-only group polls hook backed by the universal
 * social store (`/api/v3/social/*`).
 *
 * Mirrors `useGroupFeedSocial` but fetches `kind=poll` entities and projects
 * them through `socialEntityToPollView`. Used by `FeedTab` to render polls
 * inline with regular posts when the `socialFeedBeta` flag is on.
 *
 * Important boundaries:
 *  - **READ-only.** Voting / unvoting / closing happens directly from the
 *    `PollCard` component via the `/api/v3/social/polls/:id/*` endpoints.
 *  - Returns a shape close to `useGroupFeedSocial`: `polls`, `loading`,
 *    `error`, `refresh`. The adapter (`socialEntityToPollView`) needs the
 *    viewer's user id to compute `myVote`, so this hook accepts it as a
 *    second argument.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import {
    listSocialEntitiesByScope,
    type SocialEntityView,
} from '@/lib/api/social';
import {
    socialEntityToPollView,
    type PollAdapterShape,
} from '../utils/social-entity-to-poll';

export interface UseGroupPollsSocialResult {
    polls: PollAdapterShape[];
    loading: boolean;
    error: string;
    refresh: () => Promise<void>;
}

export interface UseGroupPollsSocialOptions {
    enabled?: boolean;
}

export async function loadGroupPollsSocial(
    groupKey: string,
    viewerUserId: string,
    fetcher: typeof listSocialEntitiesByScope = listSocialEntitiesByScope,
): Promise<
    | { ok: true; polls: PollAdapterShape[] }
    | { ok: false; error: string }
> {
    const scopeId = `group:${groupKey}`;
    const result: ApiResponse<{ entities: SocialEntityView[] }> = await fetcher('group', scopeId, {
        kind: 'poll',
        limit: 50,
        pinnedFirst: true,
    });
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load polls' };
    }
    const entities = result.data?.entities || [];
    return {
        ok: true,
        polls: entities.map((view) => socialEntityToPollView(view, viewerUserId)),
    };
}

export function useGroupPollsSocial(
    groupKey: string | undefined,
    viewerUserId: string | null | undefined,
    opts: UseGroupPollsSocialOptions = {},
): UseGroupPollsSocialResult {
    const enabled = opts.enabled !== false;
    const [polls, setPolls] = useState<PollAdapterShape[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !groupKey) {
            setPolls([]);
            return;
        }
        setLoading(true);
        setError('');
        const result = await loadGroupPollsSocial(groupKey, viewerUserId ?? '');
        if (!result.ok) {
            setError(result.error);
            setPolls([]);
            setLoading(false);
            return;
        }
        setPolls(result.polls);
        setLoading(false);
    }, [enabled, groupKey, viewerUserId]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    return { polls, loading, error, refresh };
}
