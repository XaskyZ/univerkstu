'use client';

import type { GroupExtraLessonView } from '@/lib/api';
import AttachmentsList from '@/components/AttachmentsList';
import CommentsThread from '@/components/CommentsThread';
import EntityShareButton from '@/components/EntityShareButton';
import RevisionHistoryButton from '@/components/RevisionHistoryButton';
import LinkPreviewCard from '@/components/LinkPreviewCard';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { extractFirstUrl } from '@/lib/extract-url';
import ReactionsBar from './ReactionsBar';

export default function LessonCard({
    lesson,
    actions,
    onExportIcs,
    onToggleReaction,
    currentUserId,
    refreshFeed,
    mentionScope,
    isAuthorOnline = false,
}: {
    lesson: GroupExtraLessonView;
    actions?: React.ReactNode;
    onExportIcs?: () => void;
    /**
     * Optional reaction-toggle callback. When provided AND `socialFeedBeta` is
     * on, the card renders the reactions bar under the body. Trash-list usages
     * omit it so deleted lessons do not expose a reaction surface — same
     * pattern as `PostCard` / `TaskCard`.
     */
    onToggleReaction?: (emoji: string) => Promise<void>;
    /**
     * Viewer's own user id. When provided alongside the `socialFeedBeta` flag,
     * `lesson.id` is guaranteed to be a `social_entity.id` (LessonsTab projects
     * the universal store through `adapterToLegacyLesson`) and the card renders
     * the universal `AttachmentsList` + `CommentsThread` surfaces. Optional so
     * legacy/trash callers that never enter the beta render path can omit it.
     */
    currentUserId?: string;
    /**
     * Advisory callback invoked when a new comment is posted via the embedded
     * `CommentsThread`. Lets the parent tab re-fetch aggregates. Only fires
     * when beta is on.
     */
    refreshFeed?: () => void;
    /**
     * Scope string passed through to `CommentsThread` for the @mention
     * autocomplete picker. `group:KEY` for live tabs; omit for trash views.
     */
    mentionScope?: string;
    /**
     * When true, renders a small green presence dot next to the author id in
     * the meta row. Wired by `LessonsTab` when the `socialFeedBeta` flag is on
     * and the author is in the group's live presence roster. Stays `false`
     * for legacy/trash callers so no dot is shown outside the beta path.
     */
    isAuthorOnline?: boolean;
}) {
    // Comments + reactions + attachments share the `socialFeedBeta` gate:
    // only the beta read path guarantees `lesson.id` is a `social_entity.id`,
    // which is what the universal surfaces expect.
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const { language, messages } = useLanguage();
    const showAttachments = socialBeta && Boolean(currentUserId) && Boolean(lesson.id);
    const showReactions = socialBeta && Boolean(onToggleReaction);
    const showCommentsThread = socialBeta && Boolean(currentUserId);
    return (
        <article className="rounded-3xl p-4 space-y-3 surface-overlay-1" style={{ border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-xs uppercase tracking-wide text-muted-fg">{new Date(lesson.date).toLocaleDateString(localeTag(language))}</div>
                    <h4 className="text-lg font-semibold mt-1 text-fg">{lesson.title}</h4>
                </div>
                <div className="flex items-center gap-2">
                    {socialBeta && lesson.id ? (
                        <EntityShareButton entityId={lesson.id} entityKind="extra_lesson" displayTitle={lesson.title} />
                    ) : null}
                    {socialBeta && lesson.id ? (
                        <RevisionHistoryButton entityId={lesson.id} />
                    ) : null}
                    {onExportIcs ? (
                        <button onClick={onExportIcs} className="chip" data-tone="primary" type="button">
                            .ics
                        </button>
                    ) : null}
                    {actions}
                </div>
            </div>
            <div className="text-sm flex flex-wrap gap-3 text-muted-fg">
                <span>{lesson.startTime}–{lesson.endTime}</span>
                {lesson.room ? <span>• {lesson.room}</span> : null}
                {lesson.teacher ? <span>• {lesson.teacher}</span> : null}
            </div>
            {lesson.note ? <p className="text-sm whitespace-pre-wrap text-fg">{lesson.note}</p> : null}
            {(() => {
                // Render an Open Graph unfurl card under the lesson note when
                // it contains an http(s) URL. Self-hides on resolution failure.
                const url = extractFirstUrl(lesson.note ?? '');
                return url ? <LinkPreviewCard url={url} /> : null;
            })()}
            {lesson.authorUserId ? (
                <div className="text-xs flex items-center gap-1 text-muted-fg">
                    <span>{lesson.authorUserId}</span>
                    {isAuthorOnline ? (
                        <span
                            // Author online dot — same shape/colors as
                            // `MemberCard` / `PostCard` / `TaskCard` so the
                            // visual language is consistent across the group
                            // surfaces.
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
                </div>
            ) : null}
            {showReactions && onToggleReaction ? (
                <ReactionsBar
                    reactions={lesson.reactions?.items || []}
                    mine={lesson.reactions?.mine || []}
                    onToggle={onToggleReaction}
                />
            ) : null}
            {showCommentsThread && currentUserId ? (
                <div className="mt-3">
                    <CommentsThread
                        entityId={lesson.id}
                        currentUserId={currentUserId}
                        onCommentAdded={refreshFeed}
                        mentionScope={mentionScope}
                    />
                </div>
            ) : null}
            {showAttachments && currentUserId ? (
                <div className="mt-3">
                    <AttachmentsList
                        entityId={lesson.id}
                        currentUserId={currentUserId}
                        enableEdit={lesson.authorUserId === currentUserId}
                    />
                </div>
            ) : null}
        </article>
    );
}
