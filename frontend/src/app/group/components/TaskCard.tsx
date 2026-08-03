'use client';

import type { GroupTaskView } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import AttachmentsList from '@/components/AttachmentsList';
import CommentsThread from '@/components/CommentsThread';
import EntityShareButton from '@/components/EntityShareButton';
import RevisionHistoryButton from '@/components/RevisionHistoryButton';
import LinkPreviewCard from '@/components/LinkPreviewCard';
import { useFeatureFlag } from '@/lib/feature-flags';
import { extractFirstUrl } from '@/lib/extract-url';
import ReactionsBar from './ReactionsBar';

type ChipTone = 'danger' | 'warning' | 'muted' | 'primary' | 'success';

export function priorityTone(priority: GroupTaskView['priority']): ChipTone {
    if (priority === 'high') return 'danger';
    if (priority === 'medium') return 'warning';
    return 'muted';
}

export function deadlineTone(deadline?: string | null): 'overdue' | 'today' | 'normal' {
    if (!deadline) return 'normal';
    const date = new Date(deadline).getTime();
    const now = Date.now();
    if (date < now) return 'overdue';
    if (new Date(deadline).toDateString() === new Date().toDateString()) return 'today';
    return 'normal';
}

const DEADLINE_COLOR: Record<'overdue' | 'today' | 'normal', string> = {
    overdue: 'var(--danger)',
    today: '#d97706',
    normal: 'var(--muted)',
};

export default function TaskCard({
    task,
    actions,
    onToggle,
    onToggleReaction,
    currentUserId,
    refreshFeed,
    mentionScope,
    isAuthorOnline = false,
}: {
    task: GroupTaskView;
    actions?: React.ReactNode;
    onToggle?: (completed: boolean) => void;
    /**
     * Optional reaction-toggle callback. When provided AND `socialFeedBeta` is
     * on, the card renders the reactions bar under the body. Trash-list usages
     * omit it so deleted tasks do not expose a reaction surface — same
     * pattern as `PostCard`.
     */
    onToggleReaction?: (emoji: string) => Promise<void>;
    /**
     * Viewer's own user id. When provided alongside the `socialFeedBeta` flag,
     * `task.id` is guaranteed to be a `social_entity.id` (TasksTab projects the
     * universal store through `adapterToLegacyTask`) and the card renders the
     * universal `AttachmentsList` + `CommentsThread` surfaces. Optional so
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
     * the meta row. Wired by `TasksTab` when the `socialFeedBeta` flag is on
     * and the author is in the group's live presence roster. Stays `false`
     * for legacy/trash callers so no dot is shown outside the beta path.
     */
    isAuthorOnline?: boolean;
}) {
    const { messages, language } = useLanguage();
    const completed = task.completed;
    const dlTone = deadlineTone(task.deadline);
    // Comments + reactions + attachments share the `socialFeedBeta` gate:
    // only the beta read path guarantees `task.id` is a `social_entity.id`,
    // which is what the universal surfaces expect.
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const showAttachments = socialBeta && Boolean(currentUserId) && Boolean(task.id);
    const showReactions = socialBeta && Boolean(onToggleReaction);
    const showCommentsThread = socialBeta && Boolean(currentUserId);
    return (
        <article
            className="rounded-3xl p-4 space-y-3 transition surface-overlay-1"
            style={{ border: '1px solid var(--border)', opacity: completed ? 0.78 : 1 }}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="chip" data-tone={priorityTone(task.priority)}>
                            {task.priority}
                        </span>
                        {task.subject ? (
                            <span className="chip" data-tone="primary">
                                {task.subject}
                            </span>
                        ) : null}
                    </div>
                    <h4 className="text-lg font-semibold text-fg" style={{ textDecoration: completed ? 'line-through' : 'none', textDecorationThickness: completed ? '2px' : undefined }}>
                        {task.title}
                    </h4>
                </div>
                <div className="flex items-center gap-2">
                    {socialBeta && task.id ? (
                        <EntityShareButton entityId={task.id} entityKind="task" displayTitle={task.title} />
                    ) : null}
                    {socialBeta && task.id ? (
                        <RevisionHistoryButton entityId={task.id} />
                    ) : null}
                    {actions}
                </div>
            </div>
            {task.description ? <p className="text-sm whitespace-pre-wrap text-muted-fg" style={{ textDecoration: completed ? 'line-through' : 'none' }}>{task.description}</p> : null}
            {(() => {
                // Render an Open Graph unfurl card under the description when
                // the body contains an http(s) URL. The card self-hides when
                // metadata can't be resolved, so this is a render-skip
                // optimization only.
                const url = extractFirstUrl(task.description ?? '');
                return url ? <LinkPreviewCard url={url} /> : null;
            })()}
            {task.authorUserId ? (
                <div className="text-xs flex items-center gap-1 text-muted-fg">
                    <span>{task.authorUserId}</span>
                    {isAuthorOnline ? (
                        <span
                            // Author online dot — same shape/colors as
                            // `MemberCard` / `PostCard` so the visual language
                            // is consistent across the group surfaces.
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
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <button
                    type="button"
                    role="checkbox"
                    aria-checked={completed}
                    onClick={() => onToggle?.(!completed)}
                    className="flex items-center gap-2 text-sm transition text-fg"
                >
                    <span
                        className="inline-flex h-6 w-6 items-center justify-center rounded-xl border transition"
                        style={{
                            borderColor: completed ? 'rgba(var(--good-rgb), 0.45)' : 'var(--border)',
                            background: completed ? 'rgba(var(--good-rgb), 0.18)' : 'var(--surface-overlay-2)',
                            color: completed ? 'var(--good)' : 'var(--muted)',
                        }}
                    >
                        {completed ? '✓' : ''}
                    </span>
                    <span style={{ textDecoration: completed ? 'line-through' : 'none' }}>{messages.group.taskCompletedShort}</span>
                </button>
                <span className="text-sm" style={{ color: DEADLINE_COLOR[dlTone] }}>{task.deadline ? new Date(task.deadline).toLocaleString(localeTag(language)) : messages.group.noDeadline}</span>
            </div>
            {showReactions && onToggleReaction ? (
                <ReactionsBar
                    reactions={task.reactions?.items || []}
                    mine={task.reactions?.mine || []}
                    onToggle={onToggleReaction}
                />
            ) : null}
            {showCommentsThread && currentUserId ? (
                <div className="mt-3">
                    <CommentsThread
                        entityId={task.id}
                        currentUserId={currentUserId}
                        onCommentAdded={refreshFeed}
                        mentionScope={mentionScope}
                    />
                </div>
            ) : null}
            {showAttachments && currentUserId ? (
                <div className="mt-3">
                    <AttachmentsList
                        entityId={task.id}
                        currentUserId={currentUserId}
                        enableEdit={task.authorUserId === currentUserId}
                    />
                </div>
            ) : null}
        </article>
    );
}
