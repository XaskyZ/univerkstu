'use client';

import '../styles/global-chat.css';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFocusHighlight } from '@/lib/use-focus-highlight';
import {
    BellOff,
    Check,
    Flag,
    Loader2,
    MessageSquare,
    Paperclip,
    Pin,
    PinOff,
    Send,
    Trash2,
    Users,
    VolumeX,
    X,
} from 'lucide-react';
import { PageStateCard } from '@/components/PageShell';
import UserProfileSheet from '@/components/UserProfileSheet';
import AttachmentsList from '@/components/AttachmentsList';
import EntityShareButton from '@/components/EntityShareButton';
import MentionPickerDropdown from '@/components/MentionPickerDropdown';
import { getAttachmentsUi } from '@/components/attachments-list-i18n';
import type { GlobalChatMessageView, ReactionAggregate } from '@/lib/api';
import ReactionsBar from '@/app/group/components/ReactionsBar';
import { useLanguage } from '@/lib/language-context';
import { confirmDialog } from '@/lib/confirm-dialog';
import { validateAttachmentFile } from '@/app/group/utils/social-attachment-upload';
import { useMentionableTextarea } from '@/lib/mention-autocomplete';
import { buildDraftKey, useDraft } from '@/lib/use-draft';
import DraftRestoredHint from '@/components/DraftRestoredHint';
import { usePresence, useTypingIndicator } from '@/lib/use-presence';
import type { UseGlobalChatReturn } from '../hooks/useGlobalChat';
import {
    formatPinnedSnippet,
    getPinUi,
    type PinUi,
} from '../utils/pin-helpers';
import { ActionButton } from './ActionButton';
import { ReasonModal } from './ReasonModal';

/**
 * Side-channel surface for inline message reactions. The global-chat read
 * source (`useGlobalChat`) tracks the legacy shape and has no `reactions`
 * field, so beta callers feed reactions via this map keyed by message id.
 * When unset (or the message id is missing from the map) the reactions bar
 * is not rendered for that row.
 */
export interface GlobalChatReactionsBridge {
    /** Look up the reaction aggregate for a message id. */
    getReactions: (messageId: string) => { reactions: ReactionAggregate[]; mine: string[] } | null;
    /**
     * Toggle a reaction for the given message. Must throw on failure so the
     * embedded `ReactionsBar` can roll back its optimistic counter overlay.
     */
    onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
}

/**
 * Side-channel surface for the pin/unpin affordance. Mirrors the reactions
 * bridge pattern — the parent owns the API call + post-success refresh, the
 * panel only needs a deterministic lookup + handler pair.
 *
 * Mod gate: the caller (chat page) computes `canPin` against the legacy
 * `viewerState.canModerate`; the panel just renders the affordance when the
 * lookup returns a non-null entry. Pinned items also feed the sticky rail
 * above the thread via `pinnedMessages`.
 */
export interface GlobalChatPinBridge {
    /**
     * Pinned messages for the current chat scope. Order is preserved (caller
     * is responsible for any sort). Empty array hides the sticky rail.
     */
    pinnedMessages: Array<{ id: string; body: string; authorUserId: string; authorLabel: string }>;
    /**
     * Toggle pin state for a message id. Argument is the **target** state so
     * the panel can branch on a single click without re-reading the current
     * boolean. Throws on failure so the panel can surface an inline error.
     */
    onTogglePin: (messageId: string, nextPinned: boolean) => Promise<void>;
    /** Whether the viewer is allowed to flip the pin state. */
    canPin: boolean;
}

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function formatTime(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatDay(value: Date, locale: string): string {
    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'long' }).format(value);
}

function avatarLetter(label: string): string {
    return (label || '?').trim().charAt(0).toUpperCase() || '?';
}

interface GlobalPanelProps {
    globalChat: UseGlobalChatReturn;
    muteSummary: string | null;
    locale: string;
    onSubmitGlobalMessage: () => void;
    onMuteUser: (userId: string, durationMinutes: number, reason?: string) => void;
    onUnmuteUser: (userId: string) => void;
    threadEndRef: RefObject<HTMLDivElement | null>;
    /**
     * Optional bridge that exposes per-message reaction aggregates + a toggle
     * callback. When provided, `ChatRow` renders a `ReactionsBar` under the
     * bubble. Beta-only — the legacy global chat path does not surface
     * reactions today and the bridge stays `undefined` in legacy mode.
     */
    reactionsBridge?: GlobalChatReactionsBridge;
    /**
     * Viewer id — required by `AttachmentsList` and by the attachments
     * affordance gate (no upload UI for unauthenticated readers). When unset
     * the panel still renders normally; the attachments surface is simply
     * not shown.
     */
    currentUserId?: string;
    /**
     * Beta-mode flag — when on AND `currentUserId` is set, the panel renders
     * the read-only `AttachmentsList` under each bubble (skipping pending
     * optimistic ids) and exposes a Paperclip button in the composer for
     * queuing files to upload alongside the next send.
     */
    socialBeta?: boolean;
    /**
     * Upload callback invoked once per queued file after the message has
     * successfully landed. The parent controls the entity-id resolution (the
     * social-store create response carries the new id) so the panel just
     * needs a stable hook to call. Throw on failure so the panel can surface
     * a single inline error to the user.
     */
    onUploadAttachment?: (entityId: string, file: File) => Promise<void>;
    /**
     * Beta-only submit override: when provided AND `socialBeta` is true the
     * panel calls this in place of `onSubmitGlobalMessage`, passing the
     * queued files. Returns the newly-created entity id (or `null` on
     * failure). The panel uses this id to upload pending attachments.
     */
    onSubmitGlobalMessageBeta?: (files: File[]) => Promise<{ entityId: string | null }>;
    /**
     * Pin/unpin bridge — when provided, the panel renders a sticky pinned
     * rail above the thread and exposes a Pin/PinOff button in each row's
     * action group. Hidden in legacy mode where pinning is not wired up.
     */
    pinBridge?: GlobalChatPinBridge;
    /**
     * Latest `presence-changed` frame forwarded from the SSE bridge in
     * `chat/page.tsx`. The parent owns the EventSource (matches the
     * DialogsPanel pattern); we just consume the snapshot here via
     * `usePresence(global:chat, …)`. `null` when no frame has arrived.
     */
    lastPresenceEvent?: { scope: string; onlineUserIds: string[]; receivedAt: number } | null;
    /**
     * Latest `typing` frame forwarded from the SSE bridge. Same forwarding
     * model as `lastPresenceEvent` — consumed by
     * `useTypingIndicator(global:chat, …)` below. `null` when idle.
     */
    lastTypingEvent?: { scope: string; userId: string; startedAt: number } | null;
}

/** Pending reason prompt state — drives the shared <ReasonModal>. */
interface ReasonPrompt {
    title: string;
    onSubmit: (reason: string) => void;
}

export function GlobalPanel({
    globalChat,
    muteSummary,
    locale,
    onSubmitGlobalMessage,
    onMuteUser,
    onUnmuteUser,
    threadEndRef,
    reactionsBridge,
    currentUserId,
    socialBeta,
    onUploadAttachment,
    onSubmitGlobalMessageBeta,
    pinBridge,
    lastPresenceEvent,
    lastTypingEvent,
}: GlobalPanelProps) {
    const { messages, language } = useLanguage();
    const pinUi = useMemo<PinUi>(() => getPinUi(language), [language]);
    const viewer = globalChat.viewerState;
    const [reasonPrompt, setReasonPrompt] = useState<ReasonPrompt | null>(null);
    const attachmentsUi = useMemo(() => getAttachmentsUi(language), [language]);
    // Permalink focus highlight — used to scroll-and-pulse a message after a
    // `?focus=<messageId>` redirect from `/social/e/<id>`. Hook self-clears
    // the highlight after the 3s animation window.
    const searchParams = useSearchParams();
    const focusParam = searchParams?.get('focus') ?? null;
    const focusHighlight = useFocusHighlight(focusParam);
    // Pending attachments queued for the next send. Only consumed when the
    // beta submit override is wired up; otherwise the Paperclip button stays
    // hidden so the queue never fills.
    const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const composerFileInputRef = useRef<HTMLInputElement | null>(null);
    const attachmentsEnabled = Boolean(socialBeta && currentUserId);

    // Presence + typing tracking — only active on the beta path. The parent
    // (`chat/page.tsx`) opens the SSE bridge and forwards frames via the
    // `lastPresenceEvent` / `lastTypingEvent` props. When the flag is off we
    // pass `null` scope so both hooks return their inert defaults.
    const presenceScope = socialBeta ? 'global:chat' : null;
    usePresence(presenceScope, { lastEvent: lastPresenceEvent ?? null });
    const typing = useTypingIndicator(presenceScope, { lastEvent: lastTypingEvent ?? null });
    // Trim the typer list so the indicator copy stays short. We exclude the
    // viewer themselves — `setMyTyping(true)` reflects back as a typing frame
    // and the user obviously shouldn't see "you typing".
    const otherTypingUserIds = useMemo(
        () => typing.typingUserIds.filter((id) => id !== currentUserId),
        [typing.typingUserIds, currentUserId],
    );

    // @mention autocomplete — wired against the recently-added `global:chat`
    // scope on the backend (`searchSocialUsers`). When the beta flag is off
    // we pass an empty scope so the hook stays inert and the dropdown does
    // not render (the empty-string scope means `parseSocialUserScope` returns
    // null inside the backend and the search would just be a no-op anyway).
    const mentionScope = socialBeta ? 'global:chat' : '';
    const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const composerMentions = useMentionableTextarea({
        scope: mentionScope,
        value: globalChat.composerValue,
        onChange: globalChat.setComposerValue,
    });
    // Re-position the caret after the picker rewrites the composer value.
    // Mirrors the DialogsPanel pattern — the textarea is a controlled
    // component, so we have to manually sync the selection range to the
    // mention hook's notion of where the caret should sit.
    useEffect(() => {
        const el = composerTextareaRef.current;
        if (!el) return;
        if (document.activeElement !== el) return;
        const pos = composerMentions.caretPos;
        if (pos > 0 && pos <= globalChat.composerValue.length) {
            el.setSelectionRange(pos, pos);
        }
    }, [globalChat.composerValue, composerMentions.caretPos]);

    // Draft autosave — global chat composer keyed on a stable scope literal.
    // The user has exactly one global-chat surface so there is no per-room
    // dimension here. Disabled while the viewer is muted (the composer is
    // read-only anyway, no value to persist).
    const globalDraftKey = !viewer.isMuted ? buildDraftKey('global', 'chat') : '';
    const globalDraft = useDraft({
        key: globalDraftKey,
        value: globalChat.composerValue,
        onRestore: globalChat.setComposerValue,
    });

    const handleFileInputChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const fileList = event.target.files;
            event.target.value = '';
            if (!fileList || fileList.length === 0) return;
            setAttachmentError(null);
            const accepted: File[] = [];
            for (let i = 0; i < fileList.length; i++) {
                const file = fileList.item(i);
                if (!file) continue;
                const v = validateAttachmentFile(file);
                if (!v.ok) {
                    if (v.code === 'too-large') setAttachmentError(attachmentsUi.fileTooLarge);
                    else if (v.code === 'invalid-mime') setAttachmentError(attachmentsUi.invalidMime);
                    else setAttachmentError(attachmentsUi.uploadFailed);
                    continue;
                }
                accepted.push(file);
            }
            if (accepted.length > 0) {
                setPendingAttachments((prev) => [...prev, ...accepted]);
            }
        },
        [attachmentsUi.fileTooLarge, attachmentsUi.invalidMime, attachmentsUi.uploadFailed],
    );

    const removePendingAttachment = useCallback((index: number) => {
        setPendingAttachments((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // Submit dispatcher — chooses between the beta override (which knows how
    // to surface the new entity id) and the legacy `onSubmitGlobalMessage`
    // callback. When the override is wired we also drain pending attachments
    // sequentially against the new entity id.
    const dispatchSubmit = useCallback(async () => {
        if (attachmentsEnabled && onSubmitGlobalMessageBeta) {
            const filesToUpload = pendingAttachments;
            setPendingAttachments([]);
            setAttachmentError(null);
            const result = await onSubmitGlobalMessageBeta(filesToUpload);
            if (!result.entityId) {
                // Restore the queue so the user can retry; the parent has
                // already surfaced the send error via `globalChat.error`.
                setPendingAttachments(filesToUpload);
                return;
            }
            // Drop any persisted draft once the message has landed. The
            // legacy submit path clears the composer to '' on success which
            // auto-clears the draft via the hook's empty-value semantics; the
            // beta path has no such side-effect on the parent state, so we
            // clear explicitly here.
            globalDraft.clearDraft();
            if (filesToUpload.length === 0 || !onUploadAttachment) return;
            for (const file of filesToUpload) {
                try {
                    await onUploadAttachment(result.entityId, file);
                } catch (err) {
                    const code = err instanceof Error ? err.message : '';
                    if (code === 'file-too-large') setAttachmentError(attachmentsUi.fileTooLarge);
                    else if (code === 'invalid-mime') setAttachmentError(attachmentsUi.invalidMime);
                    else setAttachmentError(attachmentsUi.uploadFailed);
                }
            }
            return;
        }
        onSubmitGlobalMessage();
    }, [
        attachmentsEnabled,
        onSubmitGlobalMessage,
        onSubmitGlobalMessageBeta,
        onUploadAttachment,
        pendingAttachments,
        attachmentsUi.fileTooLarge,
        attachmentsUi.invalidMime,
        attachmentsUi.uploadFailed,
        globalDraft,
    ]);

    return (
        <section className="gx-shell" aria-label={messages.globalChat.subtitle}>
            {/* Compact hero — title/subtitle only, no stats / no identity / no segmented modes. */}
            <div className="gx-hero">
                <div className="gx-hero-top">
                    <span className="gx-hero-eyebrow">
                        <Users className="w-3 h-3" strokeWidth={2.4} aria-hidden />
                        Global
                    </span>
                </div>
                <h2 className="gx-hero-title">{messages.globalChat.title}</h2>
                <p className="gx-hero-subtitle">{messages.globalChat.subtitle}</p>

                {viewer.isMuted ? (
                    <div className="gx-mute">
                        <span className="gx-mute-icon">
                            <BellOff className="w-4 h-4" strokeWidth={2} aria-hidden />
                        </span>
                        <div className="gx-mute-body">
                            <div className="gx-mute-title">{messages.globalChat.mutedTitle}</div>
                            <div className="gx-mute-hint">{muteSummary || messages.globalChat.mutedNoExpiry}</div>
                        </div>
                    </div>
                ) : null}
            </div>

            {globalChat.error ? <PageStateCard message={globalChat.error} tone="danger" /> : null}
            {globalChat.moderationError ? <PageStateCard message={globalChat.moderationError} tone="danger" /> : null}

            <div className="gx-thread-shell">
                {pinBridge && pinBridge.pinnedMessages.length > 0 ? (
                    <PinnedRail
                        pinUi={pinUi}
                        items={pinBridge.pinnedMessages.map((item) => ({
                            ...item,
                            authorLabel: item.authorUserId === currentUserId ? '' : item.authorLabel,
                        }))}
                    />
                ) : null}
                <ChatThread
                    messages={globalChat.chatMessages}
                    locale={locale}
                    isLoading={globalChat.fetching}
                    threadEndRef={threadEndRef}
                    emptyState={(
                        <div className="gx-empty">
                            <span className="gx-empty-icon">
                                <MessageSquare className="w-8 h-8" strokeWidth={1.6} aria-hidden />
                            </span>
                            <div className="gx-empty-title">{messages.globalChat.empty}</div>
                            <div className="gx-empty-hint">{messages.globalChat.subtitle}</div>
                        </div>
                    )}
                    renderRow={(message, ctx) => {
                        // Pending optimistic inserts have a fake id that the
                        // social store does not own — skip the reactions bar
                        // for them. Otherwise look up the per-message
                        // aggregate from the bridge (when present) and pass
                        // the toggle handler bound to this message id.
                        const reactionsEntry = reactionsBridge && !message.id.startsWith('__pending_')
                            ? reactionsBridge.getReactions(message.id)
                            : null;
                        // Same gate as reactions: only render attachments for
                        // server-acknowledged ids on the beta path. Pending
                        // optimistic rows would 404 against the list endpoint.
                        const showAttachmentsForRow = attachmentsEnabled
                            && !message.id.startsWith('__pending_');
                        // Pin affordance gate — only mods may flip the state
                        // (the bridge.canPin signal is owned by the parent).
                        // Pending optimistic ids are excluded the same way as
                        // reactions/attachments because the universal endpoint
                        // would 404 against them.
                        const canPinThis = Boolean(
                            pinBridge
                            && pinBridge.canPin
                            && !message.id.startsWith('__pending_'),
                        );
                        return (
                            <div
                                key={message.id}
                                ref={focusHighlight.registerEntityNode(message.id)}
                                data-entity-id={message.id}
                                className={focusHighlight.isHighlighted(message.id) ? 'entity-highlighted' : undefined}
                            >
                                <ChatRow
                                    message={message}
                                    locale={locale}
                                    isContinuation={ctx.isContinuation}
                                    canModerate={viewer.canModerate}
                                    busyKey={globalChat.busyKey}
                                    onReport={() => setReasonPrompt({
                                        title: messages.globalChat.reportMessage,
                                        onSubmit: (reason) => void globalChat.reportMessage(message, reason),
                                    })}
                                    onDelete={() => void globalChat.deleteMessage(message.id)}
                                    onMute={() => setReasonPrompt({
                                        title: messages.globalChat.muteOneDay,
                                        onSubmit: (reason) => onMuteUser(message.authorUserId, 60 * 24, reason),
                                    })}
                                    reactionsEntry={reactionsEntry}
                                    onToggleReaction={
                                        reactionsBridge && reactionsEntry
                                            ? (emoji) => reactionsBridge.onToggleReaction(message.id, emoji)
                                            : undefined
                                    }
                                    showAttachments={showAttachmentsForRow}
                                    currentUserId={currentUserId}
                                    showShare={showAttachmentsForRow}
                                    pinned={message.isPinned}
                                    canPin={canPinThis}
                                    onTogglePin={
                                        canPinThis && pinBridge
                                            ? () => pinBridge.onTogglePin(message.id, !message.isPinned)
                                            : undefined
                                    }
                                    pinUi={pinUi}
                                />
                            </div>
                        );
                    }}
                />

                <div className="gx-composer">
                    {socialBeta && otherTypingUserIds.length > 0 ? (
                        // Lightweight typing indicator above the composer.
                        // Locale-aware copy — matches the DialogsPanel string
                        // style ("typing..." / "теріп жатыр..." / "печатает...")
                        // with a leading handle list capped at two names so
                        // the row stays compact in busy channels.
                        <div className="gx-typing" aria-live="polite">
                            <span className="gx-typing-dot" aria-hidden />
                            <span>
                                {(() => {
                                    const verb = locale === 'en'
                                        ? 'typing'
                                        : locale === 'kk-KZ'
                                            ? 'теріп жатыр'
                                            : 'печатает';
                                    const shown = otherTypingUserIds.slice(0, 2).join(', ');
                                    const more = otherTypingUserIds.length > 2
                                        ? (locale === 'en'
                                            ? ` and ${otherTypingUserIds.length - 2} more`
                                            : locale === 'kk-KZ'
                                                ? ` және ${otherTypingUserIds.length - 2} тағы`
                                                : ` и ещё ${otherTypingUserIds.length - 2}`)
                                        : '';
                                    return `${shown}${more} ${verb}…`;
                                })()}
                            </span>
                        </div>
                    ) : null}
                    {attachmentsEnabled && pendingAttachments.length > 0 ? (
                        <div className="gx-attach-chips">
                            {pendingAttachments.map((file, idx) => (
                                <span key={`${file.name}-${idx}`} className="gx-chip" title={file.name}>
                                    <Paperclip className="w-3 h-3" strokeWidth={2.2} aria-hidden />
                                    <span className="gx-chip-name">{file.name}</span>
                                    <span className="gx-chip-size">{attachmentsUi.formatSize(file.size)}</span>
                                    <button
                                        type="button"
                                        className="gx-chip-remove"
                                        onClick={() => removePendingAttachment(idx)}
                                        aria-label={attachmentsUi.deleteLabel}
                                    >
                                        <X className="w-3 h-3" strokeWidth={2.4} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {attachmentError ? (
                        <p role="alert" className="gx-attach-error">
                            {attachmentError}
                        </p>
                    ) : null}
                    {globalDraft.hasDraft ? (
                        <DraftRestoredHint
                            visible={globalDraft.hasDraft}
                            onDismiss={() => globalDraft.clearDraft()}
                        />
                    ) : null}
                    <div className="gx-composer-row">
                        {attachmentsEnabled ? (
                            <>
                                <input
                                    ref={composerFileInputRef}
                                    type="file"
                                    multiple
                                    onChange={handleFileInputChange}
                                    style={{ display: 'none' }}
                                    aria-hidden
                                />
                                <button
                                    type="button"
                                    className="gx-attach"
                                    onClick={() => composerFileInputRef.current?.click()}
                                    disabled={viewer.isMuted || globalChat.sending}
                                    title={attachmentsUi.attachButton}
                                    aria-label={attachmentsUi.attachButton}
                                >
                                    <Paperclip className="w-4 h-4" strokeWidth={2.2} aria-hidden />
                                </button>
                            </>
                        ) : null}
                        <textarea
                            ref={composerTextareaRef}
                            value={globalChat.composerValue}
                            onChange={(event) => {
                                const next = event.target.value;
                                globalChat.setComposerValue(next);
                                composerMentions.handleSelectionChange(
                                    event.target.selectionStart ?? next.length,
                                );
                                // Fire a typing ping when the composer has
                                // content. The hook throttles to one network
                                // call per 3s. We skip the ping on empty
                                // content — server-side TTL handles the fade.
                                if (socialBeta && next.trim().length > 0) {
                                    typing.setMyTyping(true);
                                }
                            }}
                            onSelect={(event) => {
                                composerMentions.handleSelectionChange(
                                    (event.target as HTMLTextAreaElement).selectionStart ?? 0,
                                );
                            }}
                            onBlur={() => {
                                // Tiny delay so the dropdown's mousedown
                                // handler still gets to run before we close.
                                setTimeout(() => composerMentions.autocomplete.close(), 100);
                            }}
                            placeholder={viewer.isMuted ? messages.globalChat.mutedComposerBlocked : messages.globalChat.inputPlaceholder}
                            className="gx-input"
                            rows={1}
                            disabled={viewer.isMuted}
                            onKeyDown={(event) => {
                                // The mention hook consumes ArrowUp/Down/Enter/Esc/Tab
                                // when the dropdown is open — must run BEFORE
                                // the Enter-to-send branch so picking a
                                // candidate doesn't accidentally submit.
                                const consumed = mentionScope
                                    ? composerMentions.handleKeyDown(event)
                                    : false;
                                if (consumed) return;
                                if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    if (globalChat.composerValue.trim() && !globalChat.sending && !viewer.isMuted) {
                                        void dispatchSubmit();
                                    }
                                }
                            }}
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
                        <button
                            type="button"
                            className="gx-send"
                            onClick={() => void dispatchSubmit()}
                            disabled={globalChat.sending || viewer.isMuted || !globalChat.composerValue.trim()}
                            title={messages.globalChat.sendShortcutHint}
                            aria-label={messages.common.send}
                        >
                            {globalChat.sending
                                ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} aria-hidden />
                                : <Send className="w-4 h-4" strokeWidth={2.2} aria-hidden />}
                        </button>
                    </div>
                </div>
            </div>

            {viewer.canModerate ? (
                <ModerationQueue
                    title={messages.globalChat.adminQueueTitle}
                    items={globalChat.reports.map((report) => ({
                        id: report.id,
                        messageAuthorLabel: report.messageAuthorLabel,
                        reporterLabel: report.reporterLabel,
                        reason: report.reason,
                        messageBody: report.messageBody,
                        messageId: report.messageId,
                        messageAuthorUserId: report.messageAuthorUserId,
                    }))}
                    busyKey={globalChat.busyKey}
                    onDismiss={(id) => setReasonPrompt({
                        title: messages.globalChat.dismissReport,
                        onSubmit: (note) => void globalChat.dismissReport(id, note),
                    })}
                    onDelete={(messageId) => {
                        void (async () => {
                            const ok = await confirmDialog(messages.globalChat.deleteConfirm);
                            if (!ok) return;
                            setReasonPrompt({
                                title: messages.globalChat.deleteMessage,
                                onSubmit: (reason) => void globalChat.deleteMessage(messageId, reason),
                            });
                        })();
                    }}
                    onMute={(userId, mins) => setReasonPrompt({
                        title: mins === 60 * 24 ? messages.globalChat.muteOneDay : messages.globalChat.muteSevenDays,
                        onSubmit: (reason) => onMuteUser(userId, mins, reason),
                    })}
                    onUnmute={(userId) => onUnmuteUser(userId)}
                />
            ) : null}

            <ReasonModal
                open={!!reasonPrompt}
                title={reasonPrompt?.title || ''}
                onSubmit={(reason) => {
                    reasonPrompt?.onSubmit(reason);
                    setReasonPrompt(null);
                }}
                onClose={() => setReasonPrompt(null)}
            />
        </section>
    );
}

/* ════════════════ THREAD ════════════════ */
interface ChatThreadProps {
    messages: GlobalChatMessageView[];
    locale: string;
    isLoading?: boolean;
    threadEndRef: RefObject<HTMLDivElement | null>;
    emptyState: ReactNode;
    renderRow: (message: GlobalChatMessageView, ctx: { isContinuation: boolean }) => ReactNode;
}

function ChatThread({ messages, locale, isLoading, threadEndRef, emptyState, renderRow }: ChatThreadProps) {
    const showLoading = isLoading && messages.length === 0;
    const showEmpty = !isLoading && messages.length === 0;

    return (
        <div className="gx-thread">
            {showLoading ? (
                <div className="gx-skeleton" aria-hidden>
                    {[
                        { own: false, len: 'long' as const },
                        { own: false, len: 'short' as const },
                        { own: true, len: 'long' as const },
                        { own: false, len: 'long' as const },
                        { own: true, len: 'short' as const },
                    ].map((s, i) => (
                        <div key={i} className={s.own ? 'gx-skeleton-row gx-skeleton-row--own' : 'gx-skeleton-row'}>
                            <span className="gx-skeleton-avatar" />
                            <span className={`gx-skeleton-bubble gx-skeleton-bubble--${s.len}`} />
                        </div>
                    ))}
                </div>
            ) : null}

            {showEmpty ? emptyState : null}

            {messages.map((message, index, list) => {
                const prev = index > 0 ? list[index - 1] : null;
                const messageDate = new Date(message.createdAt);
                const prevDate = prev ? new Date(prev.createdAt) : null;
                const sameDay = !!prevDate && prevDate.toDateString() === messageDate.toDateString();
                const showDay = !prev || !sameDay;
                const sameAuthorWindow = !!prev
                    && prev.authorUserId === message.authorUserId
                    && sameDay
                    && (messageDate.getTime() - prevDate!.getTime()) < GROUP_WINDOW_MS
                    && !showDay;

                return (
                    <div key={message.id}>
                        {showDay ? (
                            <div className="gx-day">{formatDay(messageDate, locale)}</div>
                        ) : null}
                        {renderRow(message, { isContinuation: sameAuthorWindow })}
                    </div>
                );
            })}
            <div ref={threadEndRef} />
        </div>
    );
}

/* ════════════════ MESSAGE ROW ════════════════ */
interface ChatRowProps {
    message: GlobalChatMessageView;
    locale: string;
    isContinuation: boolean;
    canModerate: boolean;
    busyKey: string | null;
    onReport: () => void;
    onDelete: () => void;
    onMute: () => void;
    /**
     * Per-message reactions side-channel — null hides the bar (legacy mode or
     * pending optimistic insert). Shape mirrors the `ReactionsBar` props
     * contract: aggregated counts + the viewer's own picks.
     */
    reactionsEntry: { reactions: ReactionAggregate[]; mine: string[] } | null;
    /**
     * Toggle handler scoped to this message id. Must throw on failure for
     * `ReactionsBar` to roll back its optimistic counter overlay.
     */
    onToggleReaction?: (emoji: string) => Promise<void>;
    /**
     * When true, render a read-only `AttachmentsList` under the bubble. Beta
     * path only — the legacy global-chat read source does not project
     * attachments and the list endpoint would 404 on legacy ids.
     */
    showAttachments?: boolean;
    /** Viewer id — required by `AttachmentsList` to render the surface. */
    currentUserId?: string;
    /**
     * When true, render the permalink share button in the actions row.
     * Beta path only — legacy global-chat ids do not resolve to
     * `social_entity.id` so the permalink would 404. Caller filters out
     * pending optimistic inserts.
     */
    showShare?: boolean;
    /** Whether the message is currently pinned. Drives the inline pin chip. */
    pinned?: boolean;
    /** Whether the viewer is allowed to flip the pin state. */
    canPin?: boolean;
    /**
     * Pin/unpin click handler. The target pin state has already been chosen
     * by the parent (current → !current) so the row just fires it.
     */
    onTogglePin?: () => void | Promise<void>;
    /** Locale-aware tooltips for the pin button. */
    pinUi?: PinUi;
}

function ChatRow({ message, locale, isContinuation, canModerate, busyKey, onReport, onDelete, onMute, reactionsEntry, onToggleReaction, showAttachments, currentUserId, showShare, pinned, canPin, onTogglePin, pinUi }: ChatRowProps) {
    const { messages } = useLanguage();
    const own = message.isOwn;
    const pending = message.id.startsWith('__pending_');

    const avatarNode = !isContinuation ? (
        <UserProfileSheet
            targetUserId={message.authorUserId}
            label={message.authorLabel}
            trigger={<span className="gx-avatar" aria-label={message.authorLabel}>{avatarLetter(message.authorLabel)}</span>}
        />
    ) : (
        <span className="gx-avatar gx-avatar--ghost" aria-hidden>·</span>
    );

    return (
        <div className={own ? 'gx-row gx-row--own' : 'gx-row'}>
            {avatarNode}
            <div className="gx-bubble-col">
                {!own && !isContinuation ? (
                    <UserProfileSheet
                        targetUserId={message.authorUserId}
                        label={message.authorLabel}
                        trigger={<span className="gx-author">{message.authorLabel}</span>}
                    />
                ) : null}
                <div
                    className={[
                        'gx-bubble',
                        own ? 'gx-bubble--own' : 'gx-bubble--other',
                        isContinuation ? 'gx-bubble--continued' : '',
                        pending ? 'gx-bubble--pending' : '',
                    ].filter(Boolean).join(' ')}
                    data-pinned={pinned || undefined}
                >
                    {pinned ? (
                        <div className="gx-bubble-pin" title={pinUi?.pinnedHeader} aria-label={pinUi?.pinnedHeader}>
                            <Pin className="w-3 h-3" strokeWidth={2.4} aria-hidden />
                            <span>{pinUi?.pinnedHeader}</span>
                        </div>
                    ) : null}
                    {message.body}
                </div>
                {reactionsEntry && onToggleReaction ? (
                    <div className="gx-reactions">
                        <ReactionsBar
                            reactions={reactionsEntry.reactions}
                            mine={reactionsEntry.mine}
                            onToggle={onToggleReaction}
                        />
                    </div>
                ) : null}
                {showAttachments && currentUserId ? (
                    <div className="gx-attachments">
                        <AttachmentsList
                            entityId={message.id}
                            currentUserId={currentUserId}
                            // Strict display — uploads happen at send-time via
                            // the composer Paperclip; the bubble surface never
                            // grants edit access.
                            enableEdit={false}
                        />
                    </div>
                ) : null}
                <div className="gx-meta">
                    <span>{formatTime(message.createdAt, locale)}</span>
                    {pending ? <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2.5} aria-hidden /> : null}
                    {!pending && own ? <Check className="w-3 h-3" strokeWidth={2.5} aria-hidden style={{ color: 'var(--good)' }} /> : null}
                    <div className="gx-actions" role="group" aria-label={messages.common.actions}>
                        {!message.isReportedByViewer && !own ? (
                            <button type="button" className="gx-action" onClick={onReport} disabled={busyKey === `report:${message.id}`} title={messages.globalChat.reportMessage} aria-label={messages.globalChat.reportMessage}>
                                <Flag className="w-3 h-3" strokeWidth={2.2} aria-hidden />
                            </button>
                        ) : null}
                        {(message.canDelete || canModerate) ? (
                            <button type="button" className="gx-action gx-action--danger" onClick={onDelete} disabled={busyKey === `delete:${message.id}`} title={messages.globalChat.deleteMessage} aria-label={messages.globalChat.deleteMessage}>
                                <Trash2 className="w-3 h-3" strokeWidth={2.2} aria-hidden />
                            </button>
                        ) : null}
                        {canModerate && !own ? (
                            <button type="button" className="gx-action" onClick={onMute} disabled={busyKey === `mute:${message.authorUserId}:1440`} title={messages.globalChat.muteOneDay} aria-label={messages.globalChat.muteOneDay}>
                                <VolumeX className="w-3 h-3" strokeWidth={2.2} aria-hidden />
                            </button>
                        ) : null}
                        {canPin && onTogglePin ? (
                            <button
                                type="button"
                                className="gx-action"
                                onClick={() => void onTogglePin()}
                                title={pinned ? pinUi?.unpin : pinUi?.pin}
                                aria-label={pinned ? pinUi?.unpin : pinUi?.pin}
                                aria-pressed={pinned || undefined}
                            >
                                {pinned ? (
                                    <PinOff className="w-3 h-3" strokeWidth={2.2} aria-hidden />
                                ) : (
                                    <Pin className="w-3 h-3" strokeWidth={2.2} aria-hidden />
                                )}
                            </button>
                        ) : null}
                        {showShare ? (
                            <EntityShareButton
                                entityId={message.id}
                                entityKind="global_message"
                                displayTitle={message.body.slice(0, 80)}
                            />
                        ) : null}
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ════════════════ PINNED RAIL ════════════════ */
/**
 * Sticky rail rendered above the thread when at least one message in the
 * current global chat is pinned. Mirrors the DialogsPanel implementation —
 * each card is a small button that scrolls the matching bubble into view via
 * a `data-entity-id` attribute on the message wrapper. "Show all (N)" toggles
 * between the default 3-card preview and the full set.
 */
interface PinnedRailItem {
    id: string;
    body: string;
    authorUserId: string;
    authorLabel: string;
}

interface PinnedRailProps {
    pinUi: PinUi;
    items: PinnedRailItem[];
}

function PinnedRail({ pinUi, items }: PinnedRailProps) {
    const [expanded, setExpanded] = useState(false);
    const visible = expanded ? items : items.slice(0, 3);
    const remaining = items.length - visible.length;

    const handleNavigate = useCallback((messageId: string) => {
        if (typeof window === 'undefined') return;
        const node = document.querySelector(`[data-entity-id="${messageId}"]`);
        if (node instanceof HTMLElement) {
            node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, []);

    return (
        <div className="gx-pinned-rail" role="region" aria-label={pinUi.pinnedHeader}>
            <div className="gx-pinned-head">
                <span className="gx-pinned-title">
                    <Pin className="w-3 h-3" strokeWidth={2.4} aria-hidden />
                    <span>{pinUi.pinnedHeader}</span>
                    <span className="gx-pinned-count">({items.length})</span>
                </span>
                {items.length > 3 ? (
                    <button
                        type="button"
                        className="gx-pinned-toggle"
                        onClick={() => setExpanded((prev) => !prev)}
                    >
                        {expanded ? pinUi.collapse : pinUi.showAll.replace('{count}', String(items.length))}
                    </button>
                ) : null}
            </div>
            <div className="gx-pinned-list" data-expanded={expanded}>
                {visible.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className="gx-pinned-card"
                        onClick={() => handleNavigate(item.id)}
                    >
                        <Pin className="w-3 h-3 gx-pinned-card-icon" strokeWidth={2.4} aria-hidden />
                        <span className="gx-pinned-card-text">
                            {item.authorLabel ? (
                                <span className="gx-pinned-card-author">{item.authorLabel}</span>
                            ) : null}
                            <span className="gx-pinned-card-body">{formatPinnedSnippet(item.body)}</span>
                        </span>
                    </button>
                ))}
                {!expanded && remaining > 0 ? (
                    <span className="gx-pinned-more">+{remaining}</span>
                ) : null}
            </div>
        </div>
    );
}

/* ════════════════ MODERATION QUEUE ════════════════ */
interface ModerationItem {
    id: string;
    messageAuthorLabel: string;
    reporterLabel: string;
    reason: string;
    messageBody: string;
    messageId: string;
    messageAuthorUserId: string;
}

interface ModerationQueueProps {
    title: string;
    items: ModerationItem[];
    busyKey: string | null;
    onDismiss: (id: string) => void;
    onDelete: (messageId: string) => void;
    onMute: (userId: string, durationMinutes: number) => void;
    onUnmute: (userId: string) => void;
}

function ModerationQueue({ title, items, busyKey, onDismiss, onDelete, onMute, onUnmute }: ModerationQueueProps) {
    const { messages } = useLanguage();
    return (
        <section className="gx-queue">
            <header className="gx-queue-head">
                <span className="gx-queue-title">{title}</span>
                <span className="gx-queue-count">{items.length}</span>
            </header>
            {items.length === 0 ? (
                <p className="gx-queue-empty">{messages.globalChat.noReports}</p>
            ) : items.map((report) => (
                <article key={report.id} className="gx-report">
                    <div className="gx-report-author">{report.messageAuthorLabel}</div>
                    <div className="gx-report-line">{messages.globalChat.reportedByLabel}: {report.reporterLabel}</div>
                    <div className="gx-report-reason">{report.reason}</div>
                    <div className="gx-report-quote">{report.messageBody}</div>
                    <div className="gx-report-actions">
                        <ActionButton label={messages.globalChat.dismissReport} onClick={() => onDismiss(report.id)} disabled={busyKey === `dismiss:${report.id}`} />
                        <ActionButton label={messages.globalChat.deleteMessage} onClick={() => onDelete(report.messageId)} disabled={busyKey === `delete:${report.messageId}`} variant="danger" />
                        <ActionButton label={messages.globalChat.muteOneDay} onClick={() => onMute(report.messageAuthorUserId, 60 * 24)} disabled={busyKey === `mute:${report.messageAuthorUserId}:1440`} variant="warning" />
                        <ActionButton label={messages.globalChat.muteSevenDays} onClick={() => onMute(report.messageAuthorUserId, 60 * 24 * 7)} disabled={busyKey === `mute:${report.messageAuthorUserId}:10080`} variant="warning" />
                        <ActionButton label={messages.globalChat.unmuteUser} onClick={() => onUnmute(report.messageAuthorUserId)} disabled={busyKey === `unmute:${report.messageAuthorUserId}`} />
                    </div>
                </article>
            ))}
        </section>
    );
}
