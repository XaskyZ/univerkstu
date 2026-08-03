/**
 * `useGlobalChatSocial` — read-only global chat hook backed by the universal
 * social store (`/api/v3/social/*`).
 *
 * This is the Phase 2 POC entry point for the global-chat migration. It is
 * gated by the `socialFeedBeta` feature flag (the single kill-switch for the
 * whole social-store rollout, same as feed/tasks/announcements) and is wired
 * alongside the legacy `useGlobalChat` so the two can be toggled at runtime.
 *
 * Important boundaries:
 *  - **READ-only.** Sending / deleting / pinning happens through the parallel
 *    write wrappers in `social-global-chat-actions.ts`. This hook only
 *    surfaces the message timeline.
 *  - **Moderation stays legacy.** Report submission, mute/unmute, and the
 *    moderation queue (`getGlobalChatReports`, `reviewGlobalChatReport`,
 *    `muteGlobalChatUser`, `unmuteGlobalChatUser`) continue to flow through
 *    the legacy chat API regardless of the flag. The universal store has no
 *    moderation-metadata join today — see `social-entity-to-global-message.ts`
 *    header notes. Callers that need moderation queue data must run the
 *    legacy hook in parallel and OR its viewer state into the UI.
 *  - **Viewer state** (`canModerate`, `isMuted`, mute expiry) comes from
 *    `getGlobalChatMessages` in the legacy hook — there is no universal
 *    endpoint that returns it. Beta mode renders messages from the social
 *    store but reads viewer state from the legacy path.
 *  - Adapter is `social-entity-to-global-message.ts` so the mapping stays
 *    unit-testable independently of the hook.
 *  - `pinnedFirst: true` mirrors the announcements hook — pinned messages
 *    should surface at the top of the chat. The legacy global-chat read
 *    already orders pinned messages first; we hold the line so the social
 *    pin endpoint surfaces above the fold once wired through
 *    `pinGlobalMessageUnified`.
 *  - **ASC ordering.** Chat threads are read oldest → newest (the universal
 *    `listSocialEntitiesByScope` returns DESC by default, then `pinnedFirst`
 *    moves pinned to the head). After fetching we reverse the non-pinned tail
 *    so the visible chat order matches what `ChatThread` expects (groups
 *    pinned-then-chronological).
 *  - Scope is `global:chat` — every global-message entity ever lives under
 *    this single scope id.
 *
 * Surface shape mirrors `useAnnouncementsSocial` — `messages`, `isLoading`,
 * `error`, `refresh` — so the chat integration layer can lift the pattern.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ApiResponse } from '@/lib/api/core';
import {
    listSocialEntitiesByScope,
    type SocialEntityView,
} from '@/lib/api/social';
import {
    socialEntityToGlobalMessageView,
    type GlobalMessageAdapterShape,
} from '../utils/social-entity-to-global-message';

const GLOBAL_CHAT_SCOPE_TYPE = 'global' as const;
const GLOBAL_CHAT_SCOPE_ID = 'global:chat';
const GLOBAL_CHAT_LIMIT = 100;

export interface UseGlobalChatSocialOptions {
    /**
     * Gate the network call. Defaults to `true`. When `false` the hook clears
     * its state and skips fetching — used by the chat page to avoid paying for
     * both legacy + social requests when the beta flag is off.
     */
    enabled?: boolean;
}

export interface UseGlobalChatSocialResult {
    messages: GlobalMessageAdapterShape[];
    isLoading: boolean;
    error: string | null;
    refresh: () => void;
}

/**
 * Sort entities into the chat-render order: pinned first (DESC by createdAt,
 * matching the universal store's `pinnedFirst` ordering), then the rest
 * reversed to ASC. The universal endpoint returns DESC by default; chat reads
 * oldest → newest so the visible thread feels like a chat, not a feed.
 *
 * Pure helper exposed for unit testing — the hook just composes it with the
 * load primitive.
 */
export function sortGlobalChatEntries(
    entities: GlobalMessageAdapterShape[],
): GlobalMessageAdapterShape[] {
    const pinned: GlobalMessageAdapterShape[] = [];
    const regular: GlobalMessageAdapterShape[] = [];
    for (const entity of entities) {
        if (entity.pinned) pinned.push(entity);
        else regular.push(entity);
    }
    // Regular messages arrived DESC from the API (newest first); reverse to
    // get ASC (oldest first, chat-natural). `reverse()` mutates in place — we
    // already split into a fresh array, so the caller's input stays intact.
    regular.reverse();
    // Pinned messages stay in API order — the universal store's pin chip
    // surfaces "most recently pinned" first, which matches the legacy chat
    // pin behaviour.
    return [...pinned, ...regular];
}

/**
 * Pure data-flow primitive for the social global-chat read. Exposed for unit
 * testing — the hook below just lifts the result into React state. Returns a
 * discriminated result so a failure does not need to throw across the hook
 * boundary.
 *
 * `fetcher` is parameterized so tests can supply a fake without touching the
 * default-export module-level binding (the repo convention — see
 * `loadAnnouncementsSocial`).
 *
 * The return type surfaces the adapter shape — chat consumers don't have a
 * legitimate reason to read the raw `SocialEntityView` (unlike the
 * announcements path, which has a coordinator/curator/starosta fan-out).
 */
export async function loadGlobalChatSocial(
    fetcher: typeof listSocialEntitiesByScope = listSocialEntitiesByScope,
): Promise<
    | { ok: true; messages: GlobalMessageAdapterShape[] }
    | { ok: false; error: string }
> {
    const result: ApiResponse<{ entities: SocialEntityView[] }> = await fetcher(
        GLOBAL_CHAT_SCOPE_TYPE,
        GLOBAL_CHAT_SCOPE_ID,
        {
            kind: 'global_message',
            limit: GLOBAL_CHAT_LIMIT,
            pinnedFirst: true,
        },
    );
    if (!result.success) {
        return { ok: false, error: result.error || 'Failed to load global chat' };
    }
    const entities = result.data?.entities || [];
    const mapped = entities.map(socialEntityToGlobalMessageView);
    return { ok: true, messages: sortGlobalChatEntries(mapped) };
}

export function useGlobalChatSocial(
    opts: UseGlobalChatSocialOptions = {},
): UseGlobalChatSocialResult {
    const enabled = opts.enabled !== false;
    const [messages, setMessages] = useState<GlobalMessageAdapterShape[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const refreshAsync = useCallback(async () => {
        if (!enabled) {
            setMessages([]);
            setIsLoading(false);
            setError(null);
            return;
        }

        setIsLoading(true);
        setError(null);
        const result = await loadGlobalChatSocial();
        if (!result.ok) {
            setError(result.error);
            setMessages([]);
            setIsLoading(false);
            return;
        }
        setMessages(result.messages);
        setIsLoading(false);
    }, [enabled]);

    // Public refresh is a `() => void` so callers can drop the result without
    // a `void` cast (matches the announcement-hook contract). Internally we
    // kick off the async load and let React batch state.
    const refresh = useCallback(() => {
        void refreshAsync();
    }, [refreshAsync]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshAsync();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refreshAsync]);

    return { messages, isLoading, error, refresh };
}
