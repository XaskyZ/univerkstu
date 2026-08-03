'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import {
    SOCIAL_COMMENT_MAX_LENGTH,
    addSocialComment,
    getSocialComments,
    type SocialCommentView,
} from '@/lib/api';
import { useMentionableTextarea } from '@/lib/mention-autocomplete';
import { buildDraftKey, useDraft } from '@/lib/use-draft';
import MentionPickerDropdown from './MentionPickerDropdown';
import DraftRestoredHint from './DraftRestoredHint';
import LinkPreviewCard from './LinkPreviewCard';
import { extractFirstUrl } from '@/lib/extract-url';
import { getCommentsThreadUi } from './comments-thread-i18n';

export interface CommentsThreadProps {
    /** Universal social entity id (`app_social_entity.id`). */
    entityId: string;
    /**
     * Viewer's own user id. Stored for future moderation affordances (own
     * comment delete, highlight, etc.). Not load-bearing for the initial
     * read — we keep the prop so callers do not have to refactor when the
     * Phase 2 reactions / moderation surfaces land.
     */
    currentUserId: string;
    /**
     * Notified after a comment has been successfully posted so the parent can
     * refresh its aggregate count (e.g. PostCard reactions/comment chip). The
     * thread itself already re-fetches the list locally — the callback is
     * advisory only.
     */
    onCommentAdded?: () => void;
    /** If true, render expanded on first mount. Defaults to false. */
    initiallyOpen?: boolean;
    /**
     * Scope for the @mention autocomplete picker (`group:KEY` or `dm:roomId`).
     * When absent the picker stays inert — the textarea renders unchanged so
     * legacy callers do not break.
     */
    mentionScope?: string;
}

/**
 * Standalone threaded comments UI for any social entity.
 *
 * Render shape:
 *   - Collapsed (default): single "Show N comments" toggle button. We fetch
 *     the comment count lazily on first expand so the collapsed state stays
 *     cheap to render on a feed list.
 *   - Expanded:
 *       1. List of top-level comments (depth=0) ordered by createdAt asc.
 *       2. Replies (depth=1) nested under their parent.
 *       3. Composer (textarea + Send) at the bottom of the thread.
 *       4. Per top-level comment: a "Reply" affordance that opens an inline
 *          composer scoped to that parent comment (depth-1 only — backend
 *          enforces).
 *
 * State machines:
 *   - `status`: 'collapsed' | 'loading' | 'ready' | 'error'
 *   - Composer guard: per-thread `sending` boolean (no concurrent posts) plus
 *     a separate `replySending` for the inline reply.
 *
 * No hex / `dark:*` classes — every coloured surface uses semantic CSS vars
 * (`var(--text)`, `var(--muted)`, `var(--border)`, etc.). The component is
 * intentionally side-effect free outside `entityId` — feed components can
 * mount/unmount it as posts scroll in and out.
 */
export default function CommentsThread({
    entityId,
    currentUserId,
    onCommentAdded,
    initiallyOpen = false,
    mentionScope,
}: CommentsThreadProps) {
    const { language } = useLanguage();
    const ui = useMemo(() => getCommentsThreadUi(language), [language]);

    type Status = 'collapsed' | 'loading' | 'ready' | 'error';
    const [status, setStatus] = useState<Status>(initiallyOpen ? 'loading' : 'collapsed');
    const [comments, setComments] = useState<SocialCommentView[]>([]);
    const [composerValue, setComposerValue] = useState('');
    const [sending, setSending] = useState(false);
    const [sendError, setSendError] = useState<string | null>(null);

    // Inline-reply state. Only one reply composer can be open at a time —
    // matches the depth-1 cap and avoids surfacing N concurrent text areas.
    const [replyParentId, setReplyParentId] = useState<string | null>(null);
    const [replyValue, setReplyValue] = useState('');
    const [replySending, setReplySending] = useState(false);

    // Currently-known comment count. While collapsed we display whatever the
    // last successful fetch returned (or 0 if we have never opened the
    // thread). The count refreshes on every successful expand+fetch and on
    // every successful send.
    const [knownCount, setKnownCount] = useState<number>(0);

    // @mention pickers — one per textarea. When `mentionScope` is falsy the
    // hook still runs but `searchSocialUsers` is never called (we gate the
    // dropdown render below on the scope being non-empty).
    const scopeForPicker = mentionScope ?? '';
    const composerMentions = useMentionableTextarea({
        scope: scopeForPicker,
        value: composerValue,
        onChange: setComposerValue,
    });
    const replyMentions = useMentionableTextarea({
        scope: scopeForPicker,
        value: replyValue,
        onChange: setReplyValue,
    });
    const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

    // Draft autosave — top-level composer is keyed on the entity id, the
    // inline reply composer is keyed on the active parent comment id. The
    // reply hook stays inert (empty key) until the user actually opens a
    // reply textarea so we do not stash an empty draft against a phantom
    // parent. Both hooks no-op on SSR.
    const topDraftKey = buildDraftKey('comment-top', entityId);
    const topDraft = useDraft({
        key: topDraftKey,
        value: composerValue,
        onRestore: setComposerValue,
    });
    const replyDraftKey = replyParentId ? buildDraftKey('comment-reply', replyParentId) : '';
    const replyDraft = useDraft({
        key: replyDraftKey,
        value: replyValue,
        onRestore: setReplyValue,
    });

    // When the picker rewrites the textarea value we have to re-position the
    // DOM caret to match `next` length. React's onChange runs AFTER state
    // commits, so we set the caret in a microtask following the value update.
    useEffect(() => {
        const el = composerTextareaRef.current;
        if (!el) return;
        if (document.activeElement !== el) return;
        const pos = composerMentions.caretPos;
        if (pos > 0 && pos <= composerValue.length) {
            el.setSelectionRange(pos, pos);
        }
    }, [composerValue, composerMentions.caretPos]);
    useEffect(() => {
        const el = replyTextareaRef.current;
        if (!el) return;
        if (document.activeElement !== el) return;
        const pos = replyMentions.caretPos;
        if (pos > 0 && pos <= replyValue.length) {
            el.setSelectionRange(pos, pos);
        }
    }, [replyValue, replyMentions.caretPos]);

    const fetchAll = useCallback(async () => {
        const response = await getSocialComments(entityId);
        if (!response.success) {
            throw new Error(response.error || 'load failed');
        }
        const next = response.data?.comments ?? [];
        setComments(next);
        setKnownCount(next.length);
        return next;
    }, [entityId]);

    const handleExpand = useCallback(async () => {
        setStatus('loading');
        setSendError(null);
        try {
            await fetchAll();
            setStatus('ready');
        } catch {
            setStatus('error');
        }
    }, [fetchAll]);

    const handleCollapse = useCallback(() => {
        setStatus('collapsed');
        setReplyParentId(null);
        setReplyValue('');
        setSendError(null);
    }, []);

    // Honour `initiallyOpen` once on mount — if the caller wants the thread
    // open by default, kick off the initial fetch.
    useEffect(() => {
        if (initiallyOpen) {
            void handleExpand();
        }
        // entityId / handleExpand intentionally omitted — mount-only effect.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleSendTopLevel = useCallback(async () => {
        const trimmed = composerValue.trim();
        if (!trimmed || sending) return;
        setSending(true);
        setSendError(null);
        try {
            const response = await addSocialComment(entityId, trimmed);
            if (!response.success) {
                setSendError(ui.sendFailed);
                return;
            }
            setComposerValue('');
            topDraft.clearDraft();
            await fetchAll();
            onCommentAdded?.();
        } catch {
            setSendError(ui.sendFailed);
        } finally {
            setSending(false);
        }
    }, [composerValue, sending, entityId, fetchAll, onCommentAdded, ui.sendFailed, topDraft]);

    const handleSendReply = useCallback(async () => {
        if (!replyParentId) return;
        const trimmed = replyValue.trim();
        if (!trimmed || replySending) return;
        setReplySending(true);
        setSendError(null);
        try {
            const response = await addSocialComment(entityId, trimmed, replyParentId);
            if (!response.success) {
                setSendError(ui.sendFailed);
                return;
            }
            setReplyValue('');
            replyDraft.clearDraft();
            setReplyParentId(null);
            await fetchAll();
            onCommentAdded?.();
        } catch {
            setSendError(ui.sendFailed);
        } finally {
            setReplySending(false);
        }
    }, [replyParentId, replyValue, replySending, entityId, fetchAll, onCommentAdded, ui.sendFailed, replyDraft]);

    // Pre-bucket replies by their parent_comment_id so a single pass over the
    // list builds the nested view.
    const { topLevel, repliesByParent } = useMemo(() => {
        const top: SocialCommentView[] = [];
        const byParent = new Map<string, SocialCommentView[]>();
        for (const comment of comments) {
            if (comment.parentCommentId) {
                const bucket = byParent.get(comment.parentCommentId);
                if (bucket) bucket.push(comment);
                else byParent.set(comment.parentCommentId, [comment]);
            } else {
                top.push(comment);
            }
        }
        return { topLevel: top, repliesByParent: byParent };
    }, [comments]);

    if (status === 'collapsed') {
        return (
            <div className="space-y-2">
                <button
                    type="button"
                    onClick={() => void handleExpand()}
                    className="text-sm"
                    style={{
                        color: 'var(--muted)',
                        background: 'transparent',
                        border: 'none',
                        padding: '4px 0',
                        cursor: 'pointer',
                    }}
                    aria-expanded={false}
                >
                    {ui.showComments(knownCount)}
                </button>
            </div>
        );
    }

    const composerLength = composerValue.length;
    const composerOverflow = composerLength > SOCIAL_COMMENT_MAX_LENGTH;
    const composerDisabled = sending || composerLength === 0 || composerOverflow;

    const replyLength = replyValue.length;
    const replyOverflow = replyLength > SOCIAL_COMMENT_MAX_LENGTH;
    const replyDisabled = replySending || replyLength === 0 || replyOverflow;

    return (
        <section
            aria-label={ui.threadAriaLabel}
            className="space-y-3"
            data-current-user={currentUserId}
        >
            <div className="flex items-center justify-between gap-2">
                <button
                    type="button"
                    onClick={handleCollapse}
                    className="text-sm"
                    style={{
                        color: 'var(--muted)',
                        background: 'transparent',
                        border: 'none',
                        padding: '4px 0',
                        cursor: 'pointer',
                    }}
                    aria-expanded={true}
                >
                    {ui.hideComments}
                </button>
            </div>

            {status === 'loading' ? (
                <CommentsLoadingSkeleton label={ui.loading} />
            ) : null}

            {status === 'error' ? (
                <div
                    role="alert"
                    className="card p-4"
                    style={{ borderColor: 'var(--status-danger-border)' }}
                >
                    <p
                        style={{
                            color: 'var(--status-danger-color, var(--text))',
                            fontSize: 14,
                            margin: 0,
                        }}
                    >
                        {ui.loadFailed}
                    </p>
                    <button
                        type="button"
                        onClick={() => void handleExpand()}
                        className="btn btn-primary"
                        style={{ marginTop: 12, fontSize: 13 }}
                    >
                        {ui.send}
                    </button>
                </div>
            ) : null}

            {status === 'ready' ? (
                <>
                    {topLevel.length === 0 ? (
                        <p
                            style={{
                                color: 'var(--muted)',
                                fontSize: 14,
                                margin: 0,
                                padding: '8px 0',
                            }}
                        >
                            {ui.empty}
                        </p>
                    ) : (
                        <ul
                            className="space-y-3"
                            style={{ listStyle: 'none', margin: 0, padding: 0 }}
                        >
                            {topLevel.map((comment) => {
                                const replies = repliesByParent.get(comment.id) ?? [];
                                const replyOpen = replyParentId === comment.id;
                                return (
                                    <li key={comment.id} className="space-y-2">
                                        <CommentRow comment={comment} />
                                        <div
                                            style={{
                                                paddingLeft: 12,
                                                display: 'flex',
                                                gap: 12,
                                                flexWrap: 'wrap',
                                            }}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (replyOpen) {
                                                        setReplyParentId(null);
                                                        setReplyValue('');
                                                    } else {
                                                        setReplyParentId(comment.id);
                                                        setReplyValue('');
                                                    }
                                                }}
                                                style={{
                                                    background: 'transparent',
                                                    border: 'none',
                                                    color: 'var(--muted)',
                                                    fontSize: 12,
                                                    padding: 0,
                                                    cursor: 'pointer',
                                                }}
                                            >
                                                {ui.reply}
                                            </button>
                                        </div>
                                        {replies.length > 0 ? (
                                            <ul
                                                className="space-y-2"
                                                style={{
                                                    listStyle: 'none',
                                                    margin: 0,
                                                    padding: 0,
                                                    paddingLeft: 24,
                                                    borderLeft: '2px solid var(--border)',
                                                }}
                                            >
                                                {replies.map((reply) => (
                                                    <li key={reply.id}>
                                                        <CommentRow comment={reply} />
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                        {replyOpen ? (
                                            <div
                                                style={{
                                                    paddingLeft: 24,
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: 6,
                                                    position: 'relative',
                                                }}
                                            >
                                                {replyDraft.hasDraft ? (
                                                    <DraftRestoredHint
                                                        visible={replyDraft.hasDraft}
                                                        onDismiss={() => replyDraft.clearDraft()}
                                                    />
                                                ) : null}
                                                <textarea
                                                    ref={replyTextareaRef}
                                                    value={replyValue}
                                                    onChange={(e) => {
                                                        setReplyValue(e.target.value);
                                                        replyMentions.handleSelectionChange(
                                                            e.target.selectionStart ?? e.target.value.length,
                                                        );
                                                    }}
                                                    onSelect={(e) => {
                                                        replyMentions.handleSelectionChange(
                                                            (e.target as HTMLTextAreaElement).selectionStart ?? 0,
                                                        );
                                                    }}
                                                    onKeyDown={(e) => {
                                                        if (!mentionScope) return;
                                                        replyMentions.handleKeyDown(e);
                                                    }}
                                                    onBlur={() => {
                                                        // Defer close so a mousedown on a dropdown row can fire first.
                                                        setTimeout(() => replyMentions.autocomplete.close(), 100);
                                                    }}
                                                    placeholder={ui.placeholder}
                                                    rows={2}
                                                    disabled={replySending}
                                                    className="input resize-y"
                                                    aria-label={ui.placeholder}
                                                />
                                                {mentionScope ? (
                                                    <MentionPickerDropdown
                                                        open={replyMentions.autocomplete.isOpen}
                                                        candidates={replyMentions.autocomplete.candidates}
                                                        selectedIndex={replyMentions.autocomplete.selectedIndex}
                                                        loading={replyMentions.autocomplete.loading}
                                                        onSelect={(handle) => replyMentions.handlePickCandidate(handle)}
                                                        onHover={(idx) => replyMentions.autocomplete.setSelectedIndex(idx)}
                                                    />
                                                ) : null}
                                                <div className="flex items-center justify-between gap-2">
                                                    <span
                                                        style={{
                                                            fontSize: 12,
                                                            color: replyOverflow
                                                                ? 'var(--status-danger-color, var(--muted))'
                                                                : 'var(--muted)',
                                                            fontVariantNumeric: 'tabular-nums',
                                                        }}
                                                    >
                                                        {ui.charCount(replyLength, SOCIAL_COMMENT_MAX_LENGTH)}
                                                    </span>
                                                    <div className="flex gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setReplyParentId(null);
                                                                setReplyValue('');
                                                            }}
                                                            disabled={replySending}
                                                            style={{
                                                                background: 'transparent',
                                                                border: '1px solid var(--border)',
                                                                color: 'var(--muted)',
                                                                padding: '6px 12px',
                                                                borderRadius: 10,
                                                                fontSize: 13,
                                                                cursor: 'pointer',
                                                            }}
                                                        >
                                                            {ui.cancel}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => void handleSendReply()}
                                                            disabled={replyDisabled}
                                                            className="btn btn-primary"
                                                            style={{
                                                                fontSize: 13,
                                                                opacity: replyDisabled ? 0.6 : 1,
                                                            }}
                                                        >
                                                            {ui.send}
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                    </li>
                                );
                            })}
                        </ul>
                    )}

                    <div
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            paddingTop: 8,
                            borderTop: '1px solid var(--border)',
                            position: 'relative',
                        }}
                    >
                        {topDraft.hasDraft ? (
                            <DraftRestoredHint
                                visible={topDraft.hasDraft}
                                onDismiss={() => topDraft.clearDraft()}
                            />
                        ) : null}
                        <textarea
                            ref={composerTextareaRef}
                            value={composerValue}
                            onChange={(e) => {
                                setComposerValue(e.target.value);
                                composerMentions.handleSelectionChange(
                                    e.target.selectionStart ?? e.target.value.length,
                                );
                            }}
                            onSelect={(e) => {
                                composerMentions.handleSelectionChange(
                                    (e.target as HTMLTextAreaElement).selectionStart ?? 0,
                                );
                            }}
                            onKeyDown={(e) => {
                                if (!mentionScope) return;
                                composerMentions.handleKeyDown(e);
                            }}
                            onBlur={() => {
                                setTimeout(() => composerMentions.autocomplete.close(), 100);
                            }}
                            placeholder={ui.placeholder}
                            rows={3}
                            disabled={sending}
                            className="input resize-y"
                            aria-label={ui.placeholder}
                        />
                        {mentionScope ? (
                            <MentionPickerDropdown
                                open={composerMentions.autocomplete.isOpen}
                                candidates={composerMentions.autocomplete.candidates}
                                selectedIndex={composerMentions.autocomplete.selectedIndex}
                                loading={composerMentions.autocomplete.loading}
                                onSelect={(handle) => composerMentions.handlePickCandidate(handle)}
                                onHover={(idx) => composerMentions.autocomplete.setSelectedIndex(idx)}
                            />
                        ) : null}
                        <div className="flex items-center justify-between gap-2">
                            <span
                                style={{
                                    fontSize: 12,
                                    color: composerOverflow
                                        ? 'var(--status-danger-color, var(--muted))'
                                        : 'var(--muted)',
                                    fontVariantNumeric: 'tabular-nums',
                                }}
                            >
                                {ui.charCount(composerLength, SOCIAL_COMMENT_MAX_LENGTH)}
                            </span>
                            <button
                                type="button"
                                onClick={() => void handleSendTopLevel()}
                                disabled={composerDisabled}
                                className="btn btn-primary"
                                style={{
                                    fontSize: 13,
                                    opacity: composerDisabled ? 0.6 : 1,
                                }}
                            >
                                {ui.send}
                            </button>
                        </div>
                        {sendError ? (
                            <p
                                role="alert"
                                style={{
                                    margin: 0,
                                    fontSize: 12,
                                    color: 'var(--status-danger-color, var(--text))',
                                }}
                            >
                                {sendError}
                            </p>
                        ) : null}
                    </div>
                </>
            ) : null}
        </section>
    );
}

function CommentsLoadingSkeleton({ label }: { label: string }) {
    return (
        <div
            role="status"
            aria-live="polite"
            aria-label={label}
            className="space-y-2"
        >
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    style={{
                        height: 48,
                        borderRadius: 12,
                        background: 'var(--surface-overlay-1)',
                        border: '1px solid var(--border)',
                        opacity: 0.7,
                    }}
                />
            ))}
        </div>
    );
}

function CommentRow({ comment }: { comment: SocialCommentView }) {
    const createdLabel = useMemo(() => {
        const date = new Date(comment.createdAt);
        if (Number.isNaN(date.getTime())) return comment.createdAt;
        return date.toLocaleString();
    }, [comment.createdAt]);

    return (
        <article
            style={{
                background: 'var(--surface-overlay-1)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
            }}
        >
            <div
                style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    color: 'var(--muted)',
                    fontSize: 12,
                }}
            >
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                    {comment.authorUserId}
                </span>
                <span aria-hidden="true">•</span>
                <span>{createdLabel}</span>
            </div>
            <p
                style={{
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    color: 'var(--text)',
                    fontSize: 14,
                    lineHeight: 1.5,
                }}
            >
                {comment.body}
            </p>
            {(() => {
                // Render an Open Graph unfurl card under the comment body when
                // it contains an http(s) URL. Self-hides on resolution failure.
                const url = extractFirstUrl(comment.body);
                return url ? <LinkPreviewCard url={url} /> : null;
            })()}
        </article>
    );
}
