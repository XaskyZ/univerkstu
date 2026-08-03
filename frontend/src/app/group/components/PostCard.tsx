'use client';

import type { GroupPostView } from '@/lib/api';
import FriendActionButton from '@/components/FriendActionButton';
import CommentsThread from '@/components/CommentsThread';
import AttachmentsList from '@/components/AttachmentsList';
import EntityShareButton from '@/components/EntityShareButton';
import RevisionHistoryButton from '@/components/RevisionHistoryButton';
import LinkPreviewCard from '@/components/LinkPreviewCard';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { extractFirstUrl } from '@/lib/extract-url';
import ReactionsBar from './ReactionsBar';

function formatDate(value: string, locale: string) {
    return new Date(value).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function PostCard({
    post,
    accent = false,
    actions,
    onToggleReaction,
    currentUserId,
    refreshFeed,
    mentionScope,
    isAuthorOnline = false,
}: {
    post: GroupPostView;
    accent?: boolean;
    actions?: React.ReactNode;
    /**
     * Optional reaction-toggle callback. When provided, the card renders the
     * reactions bar under the body. Trash-list usages omit it so deleted posts
     * do not expose a reaction surface.
     */
    onToggleReaction?: (emoji: string) => Promise<void>;
    /**
     * Viewer's own user id. Required by `CommentsThread` (rendered only when
     * the `socialFeedBeta` flag is on). Optional here so legacy/trash callers
     * that never enter the beta render path can omit it.
     */
    currentUserId?: string;
    /**
     * Advisory callback invoked when a new comment is posted via the embedded
     * `CommentsThread`. Lets the parent feed re-fetch aggregates (e.g. the
     * `commentCount` field on `SocialEntityView`). Only fires when beta is on.
     */
    refreshFeed?: () => void;
    /**
     * Scope string passed through to `CommentsThread` for the @mention
     * autocomplete picker. `group:KEY` for feed posts; omit for trash views.
     */
    mentionScope?: string;
    /**
     * When true, renders a small green presence dot next to the author id in
     * the meta row. Wired by `FeedTab` when the `socialFeedBeta` flag is on
     * and the author is in the group's live presence roster. Stays `false`
     * for legacy/trash callers so no dot is shown outside the beta path.
     */
    isAuthorOnline?: boolean;
}) {
    // Comments live exclusively in the universal social store — they have no
    // legacy fallback. Gate the thread behind the same `socialFeedBeta` flag
    // that controls the feed read path so `post.id` is guaranteed to be a
    // `social_entity.id` (the adapter ensures it) and not a legacy post id.
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const { language, messages } = useLanguage();
    const showCommentsThread = socialBeta && Boolean(currentUserId);
    // Attachments share the same beta gate as comments — both consume the
    // universal social store and need `post.id` to be a `social_entity.id`
    // (guaranteed only on the beta read path).
    const showAttachments = socialBeta && Boolean(currentUserId) && Boolean(post.id);
    return (
        <article
            className="rounded-3xl p-4 space-y-3"
            style={{
                border: accent ? '1px solid rgba(var(--primary-rgb), 0.3)' : '1px solid var(--border)',
                borderLeft: accent ? '3px solid rgba(var(--primary-rgb), 0.8)' : '1px solid var(--border)',
                background: accent ? 'rgba(var(--primary-rgb), 0.06)' : 'var(--surface-overlay-1)',
            }}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                    {post.pinned ? (
                        <span className="chip" data-tone="primary">
                            📌 {messages.group.pinnedBadge}
                        </span>
                    ) : null}
                    <h4 className="text-lg font-semibold text-fg">{post.title}</h4>
                </div>
                <div className="flex items-center gap-2">
                    {socialBeta && post.id ? (
                        <EntityShareButton entityId={post.id} entityKind="post" displayTitle={post.title} />
                    ) : null}
                    {socialBeta && post.id ? (
                        <RevisionHistoryButton entityId={post.id} />
                    ) : null}
                    {actions}
                </div>
            </div>
            <p className="whitespace-pre-wrap text-sm leading-6 text-fg">{post.body}</p>
            {(() => {
                // Render an Open Graph unfurl card under the body when the
                // post body contains an http(s) URL. The card fetches its own
                // metadata lazily and self-hides on failure, so this gate is
                // purely a render-skip optimization.
                const url = extractFirstUrl(post.body);
                return url ? <LinkPreviewCard url={url} /> : null;
            })()}
            <div className="text-xs flex items-center gap-2 flex-wrap text-muted-fg">
                <span className="inline-flex items-center gap-1">
                    <span>{post.authorUserId}</span>
                    {isAuthorOnline ? (
                        <span
                            // Author online dot — same shape/colors as
                            // `MemberCard` so the visual language is consistent
                            // across the group surfaces.
                            aria-label={messages.common.online}
                            title={messages.common.online}
                            style={{
                                display: 'inline-block',
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                background: 'var(--status-success-color, #2ecc71)',
                                border: '2px solid var(--surface-base, #fff)',
                                boxSizing: 'border-box',
                                flex: '0 0 auto',
                            }}
                        />
                    ) : null}
                </span>
                <span>•</span>
                <span>{formatDate(post.updatedAt || post.createdAt, localeTag(language))}</span>
            </div>
            {onToggleReaction ? (
                <ReactionsBar
                    reactions={post.reactions?.items || []}
                    mine={post.reactions?.mine || []}
                    onToggle={onToggleReaction}
                />
            ) : null}
            {showCommentsThread && currentUserId ? (
                <div className="mt-3">
                    <CommentsThread
                        entityId={post.id}
                        currentUserId={currentUserId}
                        onCommentAdded={refreshFeed}
                        mentionScope={mentionScope}
                    />
                </div>
            ) : null}
            {showAttachments && currentUserId ? (
                <div className="mt-3">
                    <AttachmentsList
                        entityId={post.id}
                        currentUserId={currentUserId}
                        enableEdit={post.authorUserId === currentUserId}
                    />
                </div>
            ) : null}
            <FriendActionButton targetUserId={post.authorUserId} compact />
        </article>
    );
}
