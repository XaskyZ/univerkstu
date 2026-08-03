/**
 * `useDmMessagesSocial` — read-only DM-thread hook backed by the universal
 * social store (`/api/v3/social/*`).
 *
 * This is the Phase 2 POC entry point for the social-store migration of the
 * direct-message thread renderer. It is gated by the `socialFeedBeta` feature
 * flag (see `DialogsPanel.tsx`, same kill-switch as the feed / tasks / extra
 * lessons betas) and is wired alongside the legacy `useDialogs` + `useChatPolling`
 * so the two can be toggled at runtime.
 *
 * Important boundaries:
 *  - **READ-only.** Sending / editing / deleting still flow through
 *    `social-dm-actions.ts`. This hook only surfaces the message list for a
 *    given room.
 *  - Returns a shape close enough to the legacy thread data for `DialogsPanel`
 *    to bridge with a thin adapter: `messages`, `isLoading`, `error`, `refresh`.
 *    Room metadata (`canWrite`, `unreadCount`, peer info) stays on the legacy
 *    `useDialogs` hook — the social store does not own DM-room state, only
 *    the messages themselves.
 *  - Adapter is `social-entity-to-dm-message.ts` so the mapping stays
 *    unit-testable independently of the hook.
 *  - `pinnedFirst: false` — DM messages are chronological, not feed-style.
 *    `limit: 100` matches the legacy `getChatRoomDetail(roomId, 100)` ceiling.
 *  - Sort ASC by `createdAt` client-side because the social list endpoint
 *    returns DESC (newest first) — chat UI expects oldest at the top, newest
 *    at the bottom (scroll-to-bottom on send).
 *  - `roomId` is nullable so the hook can be mounted unconditionally; when
 *    null it clears state and skips the fetch.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import {
    listSocialEntitiesByScope,
    type SocialEntityView,
} from '@/lib/api/social';
import {
    socialEntityToDmMessageView,
    type DmMessageAdapterShape,
} from '../utils/social-entity-to-dm-message';

export interface UseDmMessagesSocialResult {
    messages: DmMessageAdapterShape[];
    isLoading: boolean;
    error: string;
    refresh: () => Promise<void>;
}

export interface UseDmMessagesSocialOptions {
    /**
     * Gate the network call. Defaults to `true`. When `false` the hook clears
     * its state and skips fetching — used by `DialogsPanel` to avoid paying
     * for both legacy + social requests when the beta flag is off.
     */
    enabled?: boolean;
}

/**
 * In-memory sort by `createdAt` ASC (oldest first). Exposed so callers (and
 * tests) can verify the chronological ordering rule without re-implementing
 * the comparator. Messages with malformed `createdAt` sort last (Infinity)
 * so a corrupt row does not jump to the top of the thread.
 */
function compareByCreatedAtAsc(
    left: DmMessageAdapterShape,
    right: DmMessageAdapterShape,
): number {
    const leftTime = left.createdAt ? new Date(left.createdAt).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = right.createdAt ? new Date(right.createdAt).getTime() : Number.POSITIVE_INFINITY;
    const leftSafe = Number.isFinite(leftTime) ? leftTime : Number.POSITIVE_INFINITY;
    const rightSafe = Number.isFinite(rightTime) ? rightTime : Number.POSITIVE_INFINITY;
    return leftSafe - rightSafe;
}

/**
 * Pure data-flow primitive for the social-DM-thread read. Exposed for unit
 * testing — the hook below just lifts the result into React state. Returns a
 * discriminated result so a failure does not need to throw across the hook
 * boundary.
 *
 * `fetcher` is parameterized so tests can supply a fake without touching the
 * default-export module-level binding (repo convention — see
 * `loadGroupFeedSocial` in `useGroupFeedSocial.ts`).
 */
export async function loadDmMessagesSocial(
    roomId: string,
    fetcher: typeof listSocialEntitiesByScope = listSocialEntitiesByScope,
): Promise<
    | { ok: true; messages: DmMessageAdapterShape[] }
    | { ok: false; error: string }
> {
    const scopeId = `dm:${roomId}`;
    const result: ApiResponse<{ entities: SocialEntityView[] }> = await fetcher('dm', scopeId, {
        kind: 'dm_message',
        limit: 100,
        pinnedFirst: false,
    });
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load messages' };
    }
    const entities = result.data?.entities || [];
    const messages = entities.map(socialEntityToDmMessageView).sort(compareByCreatedAtAsc);
    return { ok: true, messages };
}

export function useDmMessagesSocial(
    roomId: string | null,
    opts: UseDmMessagesSocialOptions = {},
): UseDmMessagesSocialResult {
    const enabled = opts.enabled !== false;
    const [messages, setMessages] = useState<DmMessageAdapterShape[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    const refresh = useCallback(async () => {
        if (!enabled || !roomId) {
            setMessages([]);
            return;
        }

        setIsLoading(true);
        setError('');
        const result = await loadDmMessagesSocial(roomId);
        if (!result.ok) {
            setError(result.error);
            setMessages([]);
            setIsLoading(false);
            return;
        }
        setMessages(result.messages);
        setIsLoading(false);
    }, [enabled, roomId]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refresh();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refresh]);

    return { messages, isLoading, error, refresh };
}
