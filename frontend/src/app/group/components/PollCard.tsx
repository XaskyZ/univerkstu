'use client';

import { useCallback, useMemo, useState } from 'react';
import AttachmentsList from '@/components/AttachmentsList';
import CommentsThread from '@/components/CommentsThread';
import EntityShareButton from '@/components/EntityShareButton';
import RevisionHistoryButton from '@/components/RevisionHistoryButton';
import FriendActionButton from '@/components/FriendActionButton';
import { closePoll, unvotePoll, voteOnPoll } from '@/lib/api/social';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { confirmDialog } from '@/lib/confirm-dialog';
import type { PollAdapterShape, PollOptionView } from '../utils/social-entity-to-poll';
import { getPollsUi } from './polls-i18n';
import ReactionsBar from './ReactionsBar';

function formatDate(value: string, locale: string) {
    return new Date(value).toLocaleString(locale, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Percentage helper — protects against `totalVotes === 0` (division by zero
 * would render `NaN%`). Caller passes the option's voteCount and the poll's
 * grand total.
 */
function percentOf(count: number, total: number): number {
    if (total <= 0 || count <= 0) return 0;
    return Math.round((count / total) * 100);
}

/**
 * `PollCard` — renders a single poll entity from the universal social store.
 *
 * Render modes:
 *   - **Active** (`closedAt === null`, viewer hasn't voted): each option is a
 *     clickable row that issues `voteOnPoll(pollId, optionId)`.
 *   - **Active, voted**: the chosen option is highlighted and an "Unvote"
 *     button appears under the list.
 *   - **Closed**: every row is read-only with the final bar; the winning
 *     option (highest count, ties broken by render order) is annotated.
 *
 * Reactions / comments / attachments share the same gate pattern as
 * `PostCard` (universal surfaces require the social store id, which the
 * adapter guarantees).
 */
export default function PollCard({
    poll,
    accent = false,
    actions,
    currentUserId,
    onToggleReaction,
    refreshFeed,
    mentionScope,
    canManage = false,
}: {
    poll: PollAdapterShape;
    accent?: boolean;
    actions?: React.ReactNode;
    currentUserId?: string;
    /**
     * Reaction toggle callback. When provided the reactions bar renders below
     * the options list. Omitted by trash views so deleted polls do not expose
     * a reaction surface.
     */
    onToggleReaction?: (emoji: string) => Promise<void>;
    /**
     * Called after a successful vote / unvote / close so the parent feed can
     * re-fetch aggregates. The card itself does not own the data — it bubbles
     * up to the hook that returned `poll`.
     */
    refreshFeed?: () => void;
    mentionScope?: string;
    /**
     * Show the "Close poll" affordance for the author. Pure UI hint — the
     * backend re-checks owner-only access on `POST /polls/:id/close`.
     */
    canManage?: boolean;
}) {
    const { language } = useLanguage();
    const ui = useMemo(() => getPollsUi(language), [language]);

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');

    const isClosed = poll.closedAt !== null;
    const myVote = poll.myVote;
    const myVotes = useMemo(() => new Set(poll.myVotes ?? (poll.myVote ? [poll.myVote] : [])), [poll.myVote, poll.myVotes]);
    const isMulti = poll.multiChoice === true;
    const isAuthor = Boolean(currentUserId) && currentUserId === poll.authorUserId;
    const showAuthorClose = canManage && isAuthor && !isClosed;

    // Universal surfaces all depend on the same id-guarantee that PostCard
    // relies on — the card consumes adapter output, so `poll.id` is already a
    // `social_entity.id`. We still gate by `currentUserId` for parity.
    const showCommentsThread = Boolean(currentUserId);
    const showAttachments = Boolean(currentUserId) && Boolean(poll.id);

    // Winning option (highest voteCount). On ties we surface the first one in
    // render order — matches the legacy poll plugin behaviour.
    const winningId = useMemo<string | null>(() => {
        if (!isClosed) return null;
        let best: PollOptionView | null = null;
        for (const opt of poll.options) {
            if (!best || opt.voteCount > best.voteCount) best = opt;
        }
        return best && best.voteCount > 0 ? best.id : null;
    }, [isClosed, poll.options]);

    const handleVote = useCallback(
        async (optionId: string) => {
            if (busy || isClosed) return;
            setError('');
            setBusy(true);
            const result = await voteOnPoll(poll.id, optionId);
            setBusy(false);
            if (!result.success) {
                setError(result.error || ui.voteFailed);
                return;
            }
            refreshFeed?.();
        },
        [busy, isClosed, poll.id, refreshFeed, ui.voteFailed],
    );

    const handleUnvote = useCallback(async () => {
        if (busy || isClosed) return;
        setError('');
        setBusy(true);
        const result = await unvotePoll(poll.id);
        setBusy(false);
        if (!result.success) {
            setError(result.error || ui.unvoteFailed);
            return;
        }
        refreshFeed?.();
    }, [busy, isClosed, poll.id, refreshFeed, ui.unvoteFailed]);

    const handleClose = useCallback(async () => {
        if (busy || isClosed) return;
        if (!(await confirmDialog(ui.closePollConfirm, { danger: true }))) return;
        setError('');
        setBusy(true);
        const result = await closePoll(poll.id);
        setBusy(false);
        if (!result.success) {
            setError(result.error || ui.closeFailed);
            return;
        }
        refreshFeed?.();
    }, [busy, isClosed, poll.id, refreshFeed, ui.closeFailed, ui.closePollConfirm]);

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
                    <div className="flex items-center gap-2 flex-wrap">
                        {poll.pinned ? <span className="chip" data-tone="primary">📌</span> : null}
                        {isClosed ? <span className="chip" data-tone="muted">{ui.closed}</span> : null}
                        {isMulti ? <span className="chip" data-tone="info">{ui.multiChoiceBadge}</span> : null}
                    </div>
                    <h4 className="text-lg font-semibold text-fg">{poll.question}</h4>
                </div>
                <div className="flex items-center gap-2">
                    {poll.id ? (
                        <EntityShareButton entityId={poll.id} entityKind="poll" displayTitle={poll.question} />
                    ) : null}
                    {poll.id ? <RevisionHistoryButton entityId={poll.id} /> : null}
                    {actions}
                </div>
            </div>

            <div
                className="space-y-2"
                role={isMulti ? 'group' : 'radiogroup'}
                aria-label={poll.question}
            >
                {poll.options.map((opt) => {
                    const pct = percentOf(opt.voteCount, poll.totalVotes);
                    const isMine = isMulti ? myVotes.has(opt.id) : myVote === opt.id;
                    const isWinner = winningId === opt.id;
                    const clickable = !isClosed && !busy;
                    return (
                        <button
                            key={opt.id}
                            type="button"
                            role={isMulti ? 'checkbox' : 'radio'}
                            aria-checked={isMine}
                            disabled={!clickable}
                            onClick={() => void handleVote(opt.id)}
                            className="w-full text-left rounded-2xl p-3 transition"
                            style={{
                                border: isMine
                                    ? '1px solid rgba(var(--primary-rgb), 0.5)'
                                    : '1px solid var(--border)',
                                background: isMine
                                    ? 'rgba(var(--primary-rgb), 0.10)'
                                    : 'var(--surface-overlay-2)',
                                cursor: clickable ? 'pointer' : 'default',
                                opacity: clickable ? 1 : 0.95,
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                        >
                            {/* Vote-share bar — laid down behind the label so
                                the row reads naturally even when nearly full. */}
                            <span
                                aria-hidden="true"
                                style={{
                                    position: 'absolute',
                                    inset: 0,
                                    width: `${pct}%`,
                                    background: isMine
                                        ? 'rgba(var(--primary-rgb), 0.18)'
                                        : 'rgba(var(--primary-rgb), 0.08)',
                                    transition: 'width 200ms ease',
                                }}
                            />
                            <span className="relative z-10 flex items-center justify-between gap-3">
                                <span className="text-sm text-fg flex items-center gap-2">
                                    <span>{opt.label}</span>
                                    {isWinner ? (
                                        <span className="chip" data-tone="primary">
                                            {ui.winningOption}
                                        </span>
                                    ) : null}
                                </span>
                                <span className="text-xs text-muted-fg whitespace-nowrap">
                                    {pct}% · {opt.voteCount}
                                </span>
                            </span>
                        </button>
                    );
                })}
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="text-xs text-muted-fg">
                    {ui.totalVotes(poll.totalVotes)}
                </span>
                <div className="flex items-center gap-2">
                    {(myVote || myVotes.size > 0) && !isClosed ? (
                        <button
                            type="button"
                            onClick={() => void handleUnvote()}
                            disabled={busy}
                            className="chip"
                        >
                            {isMulti && myVotes.size > 1 ? ui.unvoteAll : ui.unvote}
                        </button>
                    ) : null}
                    {showAuthorClose ? (
                        <button
                            type="button"
                            onClick={() => void handleClose()}
                            disabled={busy}
                            className="chip"
                            data-tone="warning"
                        >
                            {ui.closePoll}
                        </button>
                    ) : null}
                </div>
            </div>

            {error ? <p className="text-sm text-danger-fg">{error}</p> : null}

            <div className="text-xs flex items-center gap-2 flex-wrap text-muted-fg">
                <span>{poll.authorUserId}</span>
                <span>•</span>
                <span>{formatDate(poll.updatedAt || poll.createdAt, localeTag(language))}</span>
            </div>

            {onToggleReaction ? (
                <ReactionsBar
                    reactions={poll.reactions?.items || []}
                    mine={poll.reactions?.mine || []}
                    onToggle={onToggleReaction}
                />
            ) : null}
            {showCommentsThread && currentUserId ? (
                <div className="mt-3">
                    <CommentsThread
                        entityId={poll.id}
                        currentUserId={currentUserId}
                        onCommentAdded={refreshFeed}
                        mentionScope={mentionScope}
                    />
                </div>
            ) : null}
            {showAttachments && currentUserId ? (
                <div className="mt-3">
                    <AttachmentsList
                        entityId={poll.id}
                        currentUserId={currentUserId}
                        enableEdit={poll.authorUserId === currentUserId}
                    />
                </div>
            ) : null}
            <FriendActionButton targetUserId={poll.authorUserId} compact />
        </article>
    );
}
