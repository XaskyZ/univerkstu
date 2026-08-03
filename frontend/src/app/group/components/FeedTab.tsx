'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/language-context';
import { useAuth } from '@/lib/auth-context';
import type { GroupPostView } from '@/lib/api';
import { useFeatureFlag } from '@/lib/feature-flags';
import { buildDraftKey, clearDraft } from '@/lib/use-draft';
import { useSocialStream } from '@/lib/use-social-stream';
import { forwardPresenceOrTyping, usePresence } from '@/lib/use-presence';
import { useFocusHighlight } from '@/lib/use-focus-highlight';
import { useGroupFeed } from '../hooks/useGroupFeed';
import { useGroupFeedSocial } from '../hooks/useGroupFeedSocial';
import { useGroupPollsSocial } from '../hooks/useGroupPollsSocial';
import { useGroupEventsSocial } from '../hooks/useGroupEventsSocial';
import {
    createPostUnified,
    deletePostUnified,
    permanentlyDeletePostUnified,
    restorePostUnified,
    togglePostReactionUnified,
    updatePostUnified,
} from '../utils/social-feed-actions';
import { getReactionsUi } from './reactions-i18n';
import { getPollsUi } from './polls-i18n';
import { getEventsUi } from './events-i18n';
import CreatePollModal from './CreatePollModal';
import CreateEventModal from './CreateEventModal';
import GroupFormModal from './GroupFormModal';
import GroupTrashSection from './GroupTrashSection';
import PollCard from './PollCard';
import PostCard from './PostCard';
import EventCard from './EventCard';
import { toggleSocialReaction, deleteSocialEntity } from '@/lib/api/social';

type FeedHookState = ReturnType<typeof useGroupFeed>;

export default function FeedTab({
    feed,
    canManage,
    groupKey,
}: {
    feed: FeedHookState;
    canManage: boolean;
    /**
     * Optional — when provided, enables the `socialFeedBeta` opt-in read path
     * through `/api/v3/social/*`. Writes / reactions stay on the legacy feed
     * regardless (Phase 1c dual-write keeps the two in sync).
     */
    groupKey?: string;
}) {
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const socialFeed = useGroupFeedSocial(groupKey, { enabled: socialBeta });
    const { userId } = useAuth();
    // Permalink focus highlight — when the URL carries `?focus=<entityId>`
    // we scroll the matching card into view and pulse its background for 3s.
    // The hook self-clears the highlight after the timer fires.
    const searchParams = useSearchParams();
    const focusParam = searchParams?.get('focus') ?? null;
    const focusHighlight = useFocusHighlight(focusParam);
    // Events live entirely in the universal social store too — no legacy
    // shim, no fallback. Same pattern as polls: the hook stays idle while
    // the beta flag is off so non-beta sessions pay nothing.
    const socialEvents = useGroupEventsSocial(
        socialBeta ? groupKey : undefined,
        userId ?? '',
        { enabled: socialBeta },
    );
    const [pollModalOpen, setPollModalOpen] = useState(false);
    const [eventModalOpen, setEventModalOpen] = useState(false);
    // One-shot mount log so we can see in browser devtools which path is live
    // for any given session. Only fires on mount and when the path actually
    // flips (e.g. user toggles the flag while the tab is open).
    const lastLoggedPath = useRef<'social-beta' | 'legacy' | null>(null);
    useEffect(() => {
        const current = socialBeta ? 'social-beta' : 'legacy';
        if (lastLoggedPath.current !== current) {
            console.log(`[group feed] using ${current}`);
            lastLoggedPath.current = current;
        }
    }, [socialBeta]);

    // Realtime SSE bridge — when the feature flag is on AND we have a group
    // scope, subscribe to `group:${groupKey}` and refresh the social feed on
    // every `entity-created` frame. We deliberately debounce the refresh by
    // ~500ms so a burst of N events (e.g. when several teammates post within
    // the same second) collapses into a single network call instead of N.
    // When the flag is off the hook stays in `idle` and never opens a socket.
    const socialFeedRefreshRef = useRef(socialFeed.refresh);
    useEffect(() => {
        socialFeedRefreshRef.current = socialFeed.refresh;
    }, [socialFeed.refresh]);
    const socialEventsRefreshRef = useRef(socialEvents.refresh);
    useEffect(() => {
        socialEventsRefreshRef.current = socialEvents.refresh;
    }, [socialEvents.refresh]);
    const refreshDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (refreshDebounceTimer.current !== null) {
            clearTimeout(refreshDebounceTimer.current);
            refreshDebounceTimer.current = null;
        }
    }, []);
    // Presence bridge — piggybacks on the already-open SSE connection. The
    // `presence-changed` frames are forwarded into local state so `usePresence`
    // can derive the online roster for the group. When the flag is off, no
    // socket is opened and the roster stays empty.
    const presenceScope = groupKey ? `group:${groupKey}` : null;
    const [lastPresenceEvent, setLastPresenceEvent] = useState<{
        scope: string;
        onlineUserIds: string[];
        receivedAt: number;
    } | null>(null);
    useSocialStream({
        scopes: groupKey ? [`group:${groupKey}`] : [],
        enabled: socialBeta,
        onEvent: (event) => {
            if (event.type === 'entity-created' && event.data.scopeType === 'group') {
                if (refreshDebounceTimer.current !== null) {
                    clearTimeout(refreshDebounceTimer.current);
                }
                refreshDebounceTimer.current = setTimeout(() => {
                    refreshDebounceTimer.current = null;
                    void socialFeedRefreshRef.current();
                    // Refresh events alongside posts on the same debounce —
                    // both hooks listen to the same scope so a single
                    // entity-created frame can target either.
                    void socialEventsRefreshRef.current();
                }, 500);
                return;
            }
            const forwarded = forwardPresenceOrTyping(event);
            if (forwarded?.kind === 'presence') {
                setLastPresenceEvent(forwarded.payload);
            }
        },
    });
    const presence = usePresence(presenceScope, { lastEvent: lastPresenceEvent });
    const onlineUserIds = useMemo(
        () => new Set(socialBeta ? presence.onlineUserIds : []),
        [presence.onlineUserIds, socialBeta],
    );

    const { messages, language } = useLanguage();
    const reactionsUi = useMemo(() => getReactionsUi(language), [language]);
    const pollsUi = useMemo(() => getPollsUi(language), [language]);
    const eventsUi = useMemo(() => getEventsUi(language), [language]);
    // Polls live entirely in the universal social store (no legacy shim).
    // We co-locate the fetch with the feed so a single tab renders the mixed
    // timeline. Hook stays idle while the beta flag is off so non-beta sessions
    // pay nothing for polls.
    const socialPolls = useGroupPollsSocial(
        socialBeta ? groupKey : undefined,
        userId,
        { enabled: socialBeta },
    );
    // Pass-through for the embedded `CommentsThread` in PostCard. When beta is
    // off the thread isn't rendered, so this collapses to a no-op naturally.
    // We keep the reference stable so PostCard doesn't see a fresh function
    // identity on every parent render.
    const refreshFeedForCards = useCallback(() => {
        if (socialBeta) {
            void socialFeed.refresh();
        }
    }, [socialBeta, socialFeed]);
    const currentUserIdForCards = userId ?? undefined;
    const [filter, setFilter] = useState<'all' | 'pinned' | 'regular'>('all');
    const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
    const [editingPost, setEditingPost] = useState<GroupPostView | null>(null);
    const [reactionError, setReactionError] = useState('');

    // Read path: in beta mode we surface `socialFeed.posts` (from
    // `/api/v3/social/*`), otherwise the legacy `feed.posts`. Both shapes are
    // structurally compatible with `GroupPostView` — the adapter widens the
    // social variant with a `tags: string[]` field that older PostCard usages
    // simply ignore. Loading/error states swap with them.
    const livePosts: GroupPostView[] = socialBeta ? socialFeed.posts : feed.posts;
    const liveLoading = socialBeta ? socialFeed.loading : feed.loading;
    const liveError = socialBeta ? socialFeed.error : feed.error;

    const pinnedPosts = useMemo(() => livePosts.filter((item) => item.pinned), [livePosts]);
    const regularPosts = useMemo(() => livePosts.filter((item) => !item.pinned), [livePosts]);
    const orderedPosts = useMemo(() => {
        if (filter === 'pinned') return pinnedPosts;
        if (filter === 'regular') return regularPosts;
        return [...pinnedPosts, ...regularPosts];
    }, [filter, pinnedPosts, regularPosts]);

    // Write-path handlers. Beta path goes directly through `/api/v3/social/*`
    // (`postId` is already the social entity id thanks to the
    // `socialEntityToPostView` adapter); legacy path keeps using the
    // existing `useGroupFeed` mutators so their in-hook cache stays valid.
    const handleDeletePost = useCallback(
        async (postId: string) => {
            if (socialBeta) {
                await deletePostUnified(postId, undefined, true);
                void socialFeed.refresh();
                return;
            }
            await feed.deletePost(postId);
        },
        [feed, socialBeta, socialFeed],
    );

    const handleRestorePost = useCallback(
        async (postId: string) => {
            if (socialBeta) {
                await restorePostUnified(postId, true);
                void socialFeed.refresh();
                return;
            }
            await feed.restorePost(postId);
        },
        [feed, socialBeta, socialFeed],
    );

    const handlePermanentlyDeletePost = useCallback(
        async (postId: string) => {
            if (socialBeta) {
                await permanentlyDeletePostUnified(postId, true);
                void socialFeed.refresh();
                return;
            }
            await feed.permanentlyDeletePost(postId);
        },
        [feed, socialBeta, socialFeed],
    );

    const makeReactionToggle = useCallback(
        (postId: string) => async (emoji: string) => {
            setReactionError('');
            // When the social-beta flag is on we hit `/api/v3/social/*`
            // directly (the `postId` here is already the `social_entity.id` —
            // the read path surfaces it via `socialEntityToPostView`). When
            // off, we delegate to the existing in-place patch logic on
            // `useGroupFeed` so the legacy aggregates flow back into local
            // state without a refresh.
            if (socialBeta) {
                if (!groupKey) {
                    const msg = reactionsUi.toggleFailed;
                    setReactionError(msg);
                    throw new Error(msg);
                }
                const result = await togglePostReactionUnified(groupKey, postId, emoji, true);
                if (!result.success) {
                    const msg = result.error || reactionsUi.toggleFailed;
                    setReactionError(msg);
                    throw new Error(msg);
                }
                // Social toggle is fire-and-forget for the local cache; a
                // refresh re-pulls the aggregates the server just updated.
                void socialFeed.refresh();
                return;
            }
            const result = await feed.toggleReaction(postId, emoji);
            if (!result.success) {
                setReactionError(result.error || reactionsUi.toggleFailed);
                throw new Error(result.error || reactionsUi.toggleFailed);
            }
        },
        [feed, groupKey, reactionsUi.toggleFailed, socialBeta, socialFeed],
    );

    return (
        <div className="space-y-4">
            <div className="card p-4 space-y-4 animate-fadeInUp">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="font-semibold text-fg">{messages.group.feedTitle}</h3>
                        <p className="text-sm mt-1 text-muted-fg">{messages.group.feedSubtitle}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {canManage ? <button onClick={() => { setEditingPost(null); setModalMode('create'); }} className="btn btn-primary px-4 py-2 text-sm" type="button">{messages.group.newAnnouncement}</button> : null}
                        {socialBeta && groupKey ? (
                            // Poll creation is opt-in (socialFeedBeta-only) and
                            // open to any member, not just curators — polls are
                            // a peer-organized feature unlike announcements.
                            <button
                                onClick={() => setPollModalOpen(true)}
                                className="btn btn-secondary px-4 py-2 text-sm"
                                type="button"
                            >
                                {pollsUi.createPoll}
                            </button>
                        ) : null}
                        {socialBeta && groupKey ? (
                            // Event creation mirrors polls — opt-in, open to
                            // any member. RSVPs are per-user; the author owns
                            // edit/delete via the universal store's owner-only
                            // rules (handled at the route layer).
                            <button
                                onClick={() => setEventModalOpen(true)}
                                className="btn btn-secondary px-4 py-2 text-sm"
                                type="button"
                            >
                                {eventsUi.newEvent}
                            </button>
                        ) : null}
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {[
                        ['all', messages.group.filterAll],
                        ['pinned', `📌 ${messages.group.pinnedBadge}`],
                        ['regular', messages.group.filterRegular],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            onClick={() => setFilter(value as 'all' | 'pinned' | 'regular')}
                            className="chip"
                            data-active={filter === value || undefined}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                </div>

                {liveLoading ? <p className="text-sm text-muted-fg">{messages.group.loadingFeed}</p> : null}
                {liveError ? <p className="text-sm text-danger-fg">{liveError}</p> : null}
                {reactionError ? <p className="text-sm text-danger-fg">{reactionError}</p> : null}
                {!liveLoading && !liveError && orderedPosts.length === 0 ? <p className="text-sm text-muted-fg">{messages.group.emptyFeed}</p> : null}
                {filter === 'all' && pinnedPosts.length > 0 ? (
                    <section className="space-y-3">
                        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--primary)' }}>
                            <span>📌</span>
                            <span>{messages.group.pinnedSection}</span>
                        </div>
                        {pinnedPosts.map((post) => (
                            <div
                                key={post.id}
                                ref={focusHighlight.registerEntityNode(post.id)}
                                className={focusHighlight.isHighlighted(post.id) ? 'entity-highlighted' : undefined}
                            >
                                <PostCard
                                    post={post}
                                    accent
                                    onToggleReaction={makeReactionToggle(post.id)}
                                    currentUserId={currentUserIdForCards}
                                    refreshFeed={refreshFeedForCards}
                                    mentionScope={groupKey ? `group:${groupKey}` : undefined}
                                    isAuthorOnline={onlineUserIds.has(post.authorUserId)}
                                    actions={canManage ? (
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => { setEditingPost(post); setModalMode('edit'); }} className="chip" type="button">{messages.common.edit}</button>
                                            <button onClick={() => void handleDeletePost(post.id)} className="chip" data-tone="danger" type="button">{messages.common.delete}</button>
                                        </div>
                                    ) : undefined}
                                />
                            </div>
                        ))}
                    </section>
                ) : null}
                <div className="space-y-3">
                    {(filter === 'all' ? regularPosts : orderedPosts).map((post) => (
                        <div
                            key={post.id}
                            ref={focusHighlight.registerEntityNode(post.id)}
                            className={focusHighlight.isHighlighted(post.id) ? 'entity-highlighted' : undefined}
                        >
                            <PostCard
                                post={post}
                                accent={post.pinned}
                                onToggleReaction={makeReactionToggle(post.id)}
                                currentUserId={currentUserIdForCards}
                                refreshFeed={refreshFeedForCards}
                                mentionScope={groupKey ? `group:${groupKey}` : undefined}
                                isAuthorOnline={onlineUserIds.has(post.authorUserId)}
                                actions={canManage ? (
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => { setEditingPost(post); setModalMode('edit'); }} className="chip" type="button">{messages.common.edit}</button>
                                        <button onClick={() => void handleDeletePost(post.id)} className="chip" data-tone="danger" type="button">{messages.common.delete}</button>
                                    </div>
                                ) : undefined}
                            />
                        </div>
                    ))}
                    {/* Polls list — appended after the post stream so the feed
                        reads top-down: announcements first, polls below. We
                        deliberately keep them separate so the post filters
                        (pinned / regular) don't accidentally exclude polls. */}
                    {socialBeta && socialPolls.polls.length > 0 ? (
                        <section className="space-y-3">
                            {socialPolls.polls.map((poll) => (
                                <div
                                    key={poll.id}
                                    ref={focusHighlight.registerEntityNode(poll.id)}
                                    className={focusHighlight.isHighlighted(poll.id) ? 'entity-highlighted' : undefined}
                                >
                                    <PollCard
                                        poll={poll}
                                        accent={poll.pinned}
                                        currentUserId={currentUserIdForCards}
                                        refreshFeed={socialPolls.refresh}
                                        mentionScope={groupKey ? `group:${groupKey}` : undefined}
                                        canManage={poll.authorUserId === currentUserIdForCards}
                                        onToggleReaction={async (emoji) => {
                                            // Polls toggle directly against the
                                            // universal store — no legacy path.
                                            const result = await toggleSocialReaction(poll.id, emoji);
                                            if (!result.success) {
                                                setReactionError(result.error || reactionsUi.toggleFailed);
                                                throw new Error(result.error || reactionsUi.toggleFailed);
                                            }
                                            void socialPolls.refresh();
                                        }}
                                    />
                                </div>
                            ))}
                        </section>
                    ) : null}
                    {/* Events list — same placement pattern as polls. The
                        feed's pinned/regular filters don't apply to events;
                        instead `EventCard` itself surfaces the pinned chip and
                        marks past events as read-only with a "состоялось" badge. */}
                    {socialBeta && socialEvents.events.length > 0 ? (
                        <section className="space-y-3">
                            {socialEvents.events.map((event) => (
                                <div
                                    key={event.id}
                                    ref={focusHighlight.registerEntityNode(event.id)}
                                    className={focusHighlight.isHighlighted(event.id) ? 'entity-highlighted' : undefined}
                                >
                                    <EventCard
                                        event={event}
                                        currentUserId={currentUserIdForCards}
                                        refreshFeed={socialEvents.refresh}
                                        mentionScope={groupKey ? `group:${groupKey}` : undefined}
                                        onRsvpChanged={() => { void socialEvents.refresh(); }}
                                        onToggleReaction={async (emoji) => {
                                            const result = await toggleSocialReaction(event.id, emoji);
                                            if (!result.success) {
                                                setReactionError(result.error || reactionsUi.toggleFailed);
                                                throw new Error(result.error || reactionsUi.toggleFailed);
                                            }
                                            void socialEvents.refresh();
                                        }}
                                        actions={event.authorUserId === currentUserIdForCards ? (
                                            // Author-only delete. Edit lives in
                                            // Phase-next; for now the workflow is
                                            // "delete + recreate" if you got the
                                            // schedule wrong.
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={async () => {
                                                        await deleteSocialEntity(event.id);
                                                        void socialEvents.refresh();
                                                    }}
                                                    className="chip"
                                                    data-tone="danger"
                                                    type="button"
                                                >
                                                    {messages.common.delete}
                                                </button>
                                            </div>
                                        ) : undefined}
                                    />
                                </div>
                            ))}
                        </section>
                    ) : null}
                </div>
            </div>

            {canManage ? (
                <GroupTrashSection title={messages.group.trashPostsTitle} hint={messages.group.softDeletedHint} count={feed.deletedPosts.length} emptyText={messages.group.trashPostsEmpty}>
                    <div className="space-y-3">
                        {feed.deletedPosts.map((post) => (
                            <PostCard
                                key={post.id}
                                post={post}
                                actions={
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => void handleRestorePost(post.id)} className="chip" data-tone="success" type="button">{messages.group.restore}</button>
                                        <button onClick={() => void handlePermanentlyDeletePost(post.id)} className="chip" data-tone="danger" type="button">{messages.group.deleteForever}</button>
                                    </div>
                                }
                            />
                        ))}
                    </div>
                </GroupTrashSection>
            ) : null}

            <GroupFormModal
                open={modalMode !== null}
                title={modalMode === 'edit' ? 'Edit post' : messages.group.newAnnouncement}
                submitLabel={modalMode === 'edit' ? 'Save' : 'Create'}
                loading={false}
                onCancel={() => { setModalMode(null); setEditingPost(null); }}
                fields={[
                    { name: 'title', label: 'Title', type: 'text', required: true, defaultValue: editingPost?.title || '' },
                    {
                        name: 'body',
                        label: 'Body',
                        type: 'textarea',
                        required: true,
                        defaultValue: editingPost?.body || '',
                        mentionScope: groupKey ? `group:${groupKey}` : undefined,
                        // Draft autosave on create only — edit mode pre-fills
                        // with the post's existing body and resurrecting a
                        // stale draft on top of it would silently overwrite
                        // the saved value. The key folds in the group scope
                        // so two groups maintain independent drafts.
                        draftKey: modalMode === 'create' && groupKey
                            ? buildDraftKey('feed-create', groupKey)
                            : undefined,
                    },
                    { name: 'pinned', label: messages.group.pinnedBadge, type: 'checkbox', defaultValue: editingPost?.pinned || false },
                ]}
                onSubmit={async (values) => {
                    const title = String(values.title || '');
                    const body = String(values.body || '');
                    const pinned = Boolean(values.pinned);
                    if (modalMode === 'edit' && editingPost) {
                        // Beta path goes straight to `/api/v3/social/*`
                        // (POC for the universal write surface); legacy path
                        // keeps `feed.updatePost` so its local cache stays in
                        // sync via the hook's own refresh.
                        if (socialBeta) {
                            await updatePostUnified(editingPost.id, { title, body, pinned }, true);
                        } else {
                            await feed.updatePost(editingPost.id, title, body, pinned);
                        }
                    } else {
                        if (socialBeta) {
                            if (groupKey) {
                                await createPostUnified(groupKey, { title, body, pinned }, true);
                            }
                        } else {
                            await feed.createPost(title, body, pinned);
                        }
                    }
                    // Beta writes don't touch `useGroupFeed`'s local state, so
                    // pull a fresh entity list. Legacy `feed.*` already
                    // refreshes its own state internally.
                    if (socialBeta) {
                        void socialFeed.refresh();
                    }
                    // Drop the post-body create draft once the post lands.
                    // Edit mode never has a draftKey wired so the clear is a
                    // no-op there; cancel intentionally leaves the draft in
                    // place so a retry recovers it.
                    if (modalMode === 'create' && groupKey) {
                        clearDraft(buildDraftKey('feed-create', groupKey));
                    }
                    setModalMode(null);
                    setEditingPost(null);
                }}
            />

            {socialBeta && groupKey ? (
                <CreatePollModal
                    open={pollModalOpen}
                    groupKey={groupKey}
                    onCancel={() => setPollModalOpen(false)}
                    onCreated={() => {
                        setPollModalOpen(false);
                        void socialPolls.refresh();
                    }}
                />
            ) : null}

            {socialBeta && groupKey ? (
                <CreateEventModal
                    open={eventModalOpen}
                    groupKey={groupKey}
                    onClose={() => setEventModalOpen(false)}
                    onCreated={() => {
                        setEventModalOpen(false);
                        void socialEvents.refresh();
                    }}
                />
            ) : null}
        </div>
    );
}
