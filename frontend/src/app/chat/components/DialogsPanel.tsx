'use client';

import '../styles/conversation.css';
import '../styles/dialogs.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useFocusHighlight } from '@/lib/use-focus-highlight';
import {
    ArrowLeft,
    BellRing,
    Inbox,
    Loader2,
    MessageSquarePlus,
    Paperclip,
    Pencil,
    Pin,
    PinOff,
    Reply,
    Search,
    Send,
    UserCircle,
    UserPlus,
    X,
} from 'lucide-react';
import MentionPickerDropdown from '@/components/MentionPickerDropdown';
import { PageStateCard } from '@/components/PageShell';
import UserProfileSheet from '@/components/UserProfileSheet';
import AttachmentsList from '@/components/AttachmentsList';
import EntityShareButton from '@/components/EntityShareButton';
import { getAttachmentsUi } from '@/components/attachments-list-i18n';
import { useAuth } from '@/lib/auth-context';
import type { ChatMessageView, ReactionAggregate } from '@/lib/api';
import { toggleSocialReaction } from '@/lib/api';
import ReactionsBar from '@/app/group/components/ReactionsBar';
import { useFeatureFlag } from '@/lib/feature-flags';
import {
    uploadAndAttachFile,
    validateAttachmentFile,
} from '@/app/group/utils/social-attachment-upload';
import { useMentionableTextarea } from '@/lib/mention-autocomplete';
import { buildDraftKey, useDraft } from '@/lib/use-draft';
import DraftRestoredHint from '@/components/DraftRestoredHint';
import { useSocialStream } from '@/lib/use-social-stream';
import {
    forwardPresenceOrTyping,
    usePresence,
    useTypingIndicator,
} from '@/lib/use-presence';
import {
    formatUnreadBadge,
    useSocialUnread,
} from '@/lib/use-social-unread';
import { markScopeAsRead, pinSocialEntity } from '@/lib/api/social';
import { useLanguage } from '@/lib/language-context';
import { useDmMessagesSocial } from '../hooks/useDmMessagesSocial';
import type { UseDialogsReturn } from '../hooks/useDialogs';
import type { UseFriendsReturn } from '../hooks/useFriends';
import type { DmMessageAdapterShape } from '../utils/social-entity-to-dm-message';
import {
    editDmMessageUnified,
    sendDmMessageUnified,
} from '../utils/social-dm-actions';
import { clipText, formatPersonalChatName } from '../utils/helpers';
import {
    formatPinnedSnippet,
    getPinUi,
    isMessagePinnable,
    type PinUi,
} from '../utils/pin-helpers';
import { ChatThread } from './ChatThread';

function avatarInitial(label: string): string {
    const trimmed = (label || '').trim();
    if (!trimmed) return '?';
    return trimmed.charAt(0).toUpperCase();
}

function hueFor(seed: string): number {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 360;
}

// Gradient avatar background derived from a stable seed hue. Returns the
// indigo→violet family rotated by the seed so each peer reads as distinct
// while staying inside the app's accent language.
function avatarGradient(seed: string): string {
    const hue = hueFor(seed);
    return `linear-gradient(135deg, hsl(${hue}, 72%, 58%), hsl(${(hue + 40) % 360}, 65%, 50%))`;
}

function formatMessageTime(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatRoomTime(value: string, locale: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';

    const now = new Date();
    const diffMin = Math.max(0, Math.round((now.getTime() - date.getTime()) / 60000));

    if (diffMin < 1) return locale === 'en' ? 'now' : locale === 'kk-KZ' ? 'қазір' : 'сейчас';
    if (diffMin < 60) return `${diffMin} ${locale === 'en' ? 'm' : 'мин'}`;

    const sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
        return locale === 'en' ? 'yesterday' : locale === 'kk-KZ' ? 'кеше' : 'вчера';
    }

    return new Intl.DateTimeFormat(locale, { day: '2-digit', month: 'short' }).format(date);
}

interface Strings {
    dialogsEmptyTitle: string;
    dialogsEmptyHint: string;
    dialogsEmptyAction: string;
    roomPlaceholderTitle: string;
    roomPlaceholderHint: string;
    roomReadOnly: string;
    roomComposerPlaceholder: string;
    searchBlocked: string;
    searchFriend: string;
    openDirect: string;
    block: string;
    unblock: string;
}

interface DialogsPanelProps {
    dialogs: UseDialogsReturn;
    friends: UseFriendsReturn;
    locale: string;
    strings: Strings;
    onOpenRoom: (roomId: string) => void;
    onOpenDirectRoom: (targetUserId: string, roomId?: string | null) => void;
    onBlockUser: (targetUserId: string) => void;
    onUnblockUser: (targetUserId: string) => void;
    onSubmitRoomMessage: () => void;
    onOpenAddFriend: () => void;
    onOpenFriendRequests: () => void;
    roomThreadEndRef: React.RefObject<HTMLDivElement | null>;
}

export function DialogsPanel({
    dialogs,
    friends,
    locale,
    strings,
    onOpenRoom,
    onOpenDirectRoom,
    onBlockUser,
    onUnblockUser,
    onSubmitRoomMessage,
    onOpenAddFriend,
    onOpenFriendRequests,
    roomThreadEndRef,
}: DialogsPanelProps) {
    const { messages, language } = useLanguage();
    const { userId } = useAuth();
    const attachmentsUi = useMemo(() => getAttachmentsUi(language), [language]);
    // Permalink focus highlight — read `?focus=<messageId>` once and pulse +
    // scroll the matching message bubble for 3 seconds after the redirect
    // from `/social/e/<id>` lands the viewer on the DM panel.
    const searchParams = useSearchParams();
    const focusParam = searchParams?.get('focus') ?? null;
    const focusHighlight = useFocusHighlight(focusParam);
    // Pending attachments queued for the next send. Only consumed on the
    // social-beta write path — see `handleSubmitSocialBeta` below. We keep
    // a File[] (not a derived shape) so the preview chips can read both
    // `name` and `size` directly without an additional projection.
    const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
    const [attachmentError, setAttachmentError] = useState<string | null>(null);
    const composerFileInputRef = useRef<HTMLInputElement | null>(null);
    // POC: `socialFeedBeta` flag swaps the DM-thread read AND write paths over
    // to `/api/v3/social/*`. When off, the legacy `useDialogs` + 15s polling
    // path remains source of truth (and Phase 1c dual-write keeps the social
    // mirror in sync server-side, so toggling the flag mid-session works).
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const socialMessages = useDmMessagesSocial(
        socialBeta ? dialogs.selectedRoomId : null,
        { enabled: socialBeta },
    );
    // One-shot mount log so we can see in browser devtools which path is live
    // for any given session. Only fires on mount and when the path actually
    // flips (e.g. user toggles the flag while the tab is open).
    const lastLoggedPath = useRef<'social-beta' | 'legacy' | null>(null);
    useEffect(() => {
        const current = socialBeta ? 'social-beta' : 'legacy';
        if (lastLoggedPath.current !== current) {
            console.log(`[dm thread] using ${current}`);
            lastLoggedPath.current = current;
        }
    }, [socialBeta]);

    // Realtime SSE bridge — subscribe to the currently-open DM room only.
    // When the user switches rooms the scope array changes and the underlying
    // EventSource is torn down and reopened with the new room id (the hook
    // handles that via its `url` dep). When no room is selected we pass an
    // empty array so no connection is opened. Same 500ms debounce as the
    // group feed/tasks/lessons bridges to coalesce a burst of incoming
    // messages into a single refresh.
    const socialMessagesRefreshRef = useRef(socialMessages.refresh);
    useEffect(() => {
        socialMessagesRefreshRef.current = socialMessages.refresh;
    }, [socialMessages.refresh]);
    const refreshDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (refreshDebounceTimer.current !== null) {
            clearTimeout(refreshDebounceTimer.current);
            refreshDebounceTimer.current = null;
        }
    }, []);

    // Presence / typing forwarding state — populated by the SSE bridge below
    // and consumed by the `usePresence` / `useTypingIndicator` hooks. We keep
    // these as the last-seen frame (not a list) because both hooks own their
    // own internal state machine and just need a delivery channel.
    const [lastPresenceEvent, setLastPresenceEvent] = useState<{
        scope: string;
        onlineUserIds: string[];
        receivedAt: number;
    } | null>(null);
    const [lastTypingEvent, setLastTypingEvent] = useState<{
        scope: string;
        userId: string;
        startedAt: number;
    } | null>(null);
    const activeScope = socialBeta && dialogs.selectedRoomId
        ? `dm:${dialogs.selectedRoomId}`
        : null;

    useSocialStream({
        scopes: socialBeta && dialogs.selectedRoomId ? [`dm:${dialogs.selectedRoomId}`] : [],
        enabled: socialBeta,
        onEvent: (event) => {
            if (event.type === 'entity-created' && event.data.kind === 'dm_message') {
                if (refreshDebounceTimer.current !== null) {
                    clearTimeout(refreshDebounceTimer.current);
                }
                refreshDebounceTimer.current = setTimeout(() => {
                    refreshDebounceTimer.current = null;
                    void socialMessagesRefreshRef.current();
                }, 500);
                // Optimistic unread bump for peer-authored events. The room
                // is currently open so the auto-mark-read effect below will
                // clear it again within ~1s, but for the brief window before
                // that lands we still want the badge totals consistent. If
                // the author is the viewer we don't bump at all — that's the
                // viewer's own outgoing message. SSE `scopeId` already carries
                // the canonical `dm:roomId` form so we use it verbatim as the
                // key into the unread counts map.
                if (userId && event.data.authorUserId !== userId) {
                    socialUnread.bumpScope(event.data.scopeId);
                }
                return;
            }
            const forwarded = forwardPresenceOrTyping(event);
            if (forwarded?.kind === 'presence') {
                setLastPresenceEvent(forwarded.payload);
            } else if (forwarded?.kind === 'typing') {
                setLastTypingEvent(forwarded.payload);
            }
        },
    });

    // Presence + typing tracking, scoped to the open DM room.
    const presence = usePresence(activeScope, { lastEvent: lastPresenceEvent });
    const typing = useTypingIndicator(activeScope, { lastEvent: lastTypingEvent });

    const activeRoom = dialogs.activeRoom;
    const activeRoomDisplayName = formatPersonalChatName(activeRoom?.title);
    // Whenever the user switches rooms, drop any queued files — they were
    // chosen for the previous conversation and should not silently follow.
    // Derived from the current room id using the "useState + render-time
    // reconciliation" pattern (avoids the cascading-render lint warning that
    // a setState-in-useEffect approach triggers).
    const [lastTrackedRoomId, setLastTrackedRoomId] = useState<string | null>(dialogs.selectedRoomId);
    if (lastTrackedRoomId !== dialogs.selectedRoomId) {
        setLastTrackedRoomId(dialogs.selectedRoomId);
        if (pendingAttachments.length > 0) setPendingAttachments([]);
        if (attachmentError) setAttachmentError(null);
    }
    const composeMode = dialogs.replyTarget ? 'reply' : dialogs.editingMessage ? 'edit' : 'idle';
    const remainingChars = dialogs.maxMessageLength - dialogs.composerValue.length;

    // Draft autosave — only active in the social-beta path AND for the
    // "idle" compose mode. Edit mode pre-fills the textarea with the message
    // body and reply mode is a transient affordance, so a restored draft
    // there would surprise the user. Key is scoped per room so each
    // conversation keeps its own pending draft.
    const dmDraftEnabled = socialBeta && composeMode === 'idle' && Boolean(dialogs.selectedRoomId);
    const dmDraftKey = dmDraftEnabled
        ? buildDraftKey('dm', dialogs.selectedRoomId ?? '')
        : '';
    const dmDraft = useDraft({
        key: dmDraftKey,
        value: dialogs.composerValue,
        onRestore: dialogs.setComposerValue,
    });

    // @mention picker — scoped to the currently-open direct room. When no room
    // is selected we pass an empty scope so the hook stays inert; the dropdown
    // is gated below on `dialogs.selectedRoomId` being truthy.
    const dmMentionScope = dialogs.selectedRoomId ? `dm:${dialogs.selectedRoomId}` : '';
    const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const composerMentions = useMentionableTextarea({
        scope: dmMentionScope,
        value: dialogs.composerValue,
        onChange: dialogs.setComposerValue,
    });
    useEffect(() => {
        const el = composerTextareaRef.current;
        if (!el) return;
        if (document.activeElement !== el) return;
        const pos = composerMentions.caretPos;
        if (pos > 0 && pos <= dialogs.composerValue.length) {
            el.setSelectionRange(pos, pos);
        }
    }, [dialogs.composerValue, composerMentions.caretPos]);
    const filterRef = useRef<HTMLInputElement | null>(null);
    // Universal-social unread counts for every visible DM room. Active in
    // socialBeta mode only — legacy mode still drives `room.unreadCount` from
    // the chat-rooms detail call. We subscribe to the full list of visible
    // rooms so the badge stays accurate when the viewer switches between rooms.
    const socialUnreadScopes = useMemo(() => {
        if (!socialBeta) return [] as string[];
        return dialogs.rooms.map((room) => `dm:${room.roomId}`);
    }, [dialogs.rooms, socialBeta]);
    const socialUnread = useSocialUnread(socialUnreadScopes, { enabled: socialBeta });
    // Source-of-truth swap for per-room unread display: in socialBeta mode the
    // universal store cursor wins, otherwise legacy `room.unreadCount` does.
    const resolveRoomUnread = useCallback((roomId: string, legacy: number): number => {
        if (!socialBeta) return legacy || 0;
        return socialUnread.counts.get(`dm:${roomId}`) ?? 0;
    }, [socialBeta, socialUnread.counts]);
    const totalUnread = useMemo(() => {
        if (socialBeta) {
            let sum = 0;
            for (const count of socialUnread.counts.values()) sum += count;
            return sum;
        }
        return dialogs.rooms.reduce((sum, room) => sum + (room.unreadCount || 0), 0);
    }, [dialogs.rooms, socialBeta, socialUnread.counts]);
    const personalCopy = messages.globalChat.personal;
    const requestCount = friends.totalPendingRequests;

    const showThread = Boolean(dialogs.selectedRoomId);

    // Project the social-DM adapter shape into the legacy `ChatMessageView`
    // shape that `BubbleRow` and `ChatThread` expect. The universal entity
    // does not store `authorLabel` / `isOwn` / `replyTo` snapshot — those are
    // derived per-request from the viewer context:
    //   * `isOwn` — strict equality against the current `userId` from auth.
    //   * `authorLabel` — pulled from the active room's metadata when the
    //     author is the peer; falls back to the bare user id otherwise (the
    //     thread renderer accepts an empty string but a uuid is at least
    //     debug-friendly while the social store has no label join).
    //   * `replyTo` — looked up by id inside the same message list. Replies
    //     to messages older than the 100-message window collapse to `null`
    //     (matches legacy behaviour where the reply preview is server-built
    //     against the same window).
    const projectedSocialMessages = useMemo<ChatMessageView[]>(() => {
        if (!socialBeta || !activeRoom) return [];
        const byId = new Map<string, DmMessageAdapterShape>();
        for (const message of socialMessages.messages) {
            byId.set(message.id, message);
        }
        const peerLabel = formatPersonalChatName(activeRoom.title) || '';
        return socialMessages.messages.map<ChatMessageView>((message) => {
            const isOwn = userId ? message.authorUserId === userId : false;
            const replyParent = message.replyToMessageId ? byId.get(message.replyToMessageId) : null;
            return {
                id: message.id,
                roomId: message.roomId,
                roomKind: 'direct',
                authorUserId: message.authorUserId,
                authorLabel: isOwn ? '' : peerLabel,
                body: message.body,
                createdAt: message.createdAt,
                editedAt: message.editedAt ?? null,
                isOwn,
                replyTo: replyParent
                    ? {
                        id: replyParent.id,
                        authorUserId: replyParent.authorUserId,
                        authorLabel: replyParent.authorUserId === userId ? '' : peerLabel,
                        body: replyParent.body,
                    }
                    : null,
            };
        });
    }, [activeRoom, socialBeta, socialMessages.messages, userId]);

    // Source-of-truth swap: beta path reads from the social store, legacy
    // path keeps the existing `roomDetail.messages` source so the polling +
    // optimistic-insert path inside `useDialogs` stays valid when the flag
    // is off. Important: do NOT merge the two — that would double-render
    // each message during the brief window after a dual-write before the
    // legacy poll catches up.
    const threadMessages: ChatMessageView[] = socialBeta
        ? projectedSocialMessages
        : (dialogs.roomDetail?.messages || []);

    // Auto-mark-read for the active DM room (socialBeta path).
    //
    // Strategy: after the thread has been rendered for ~1s and we've observed
    // at least one message in the room (i.e. the thread is not "loading"),
    // upsert the read cursor with the newest visible entity id. We debounce
    // intentionally — switching rooms rapidly should not generate a write
    // per click, only one write per stable open. The clearScope helper drops
    // the local badge immediately so the UI feels snappy; the next poll cycle
    // (30s) re-validates against the server. When a new message lands while
    // the room is open, the SSE bridge above triggers a refresh which causes
    // `projectedSocialMessages` to update — which re-runs this effect and
    // advances the cursor.
    useEffect(() => {
        if (!socialBeta) return;
        const roomId = dialogs.selectedRoomId;
        if (!roomId) return;
        if (projectedSocialMessages.length === 0) return;
        const newest = projectedSocialMessages[projectedSocialMessages.length - 1];
        const scopeKey = `dm:${roomId}`;
        const timer = setTimeout(() => {
            void markScopeAsRead('dm', roomId, newest.id).then(() => {
                socialUnread.clearScope(scopeKey);
            }).catch(() => {
                // Network errors are non-fatal — the cursor is advisory and
                // the next mark-read attempt (on the next event or open) will
                // pick up the slack. We never log here because failures during
                // tab-close races are expected.
            });
        }, 1000);
        return () => clearTimeout(timer);
    // We intentionally key off `projectedSocialMessages.length` and the last
    // entity id so we don't fire a fresh mark-read on every re-render. The
    // socialUnread instance is stable across renders so it does not need
    // to be in the dep list, but lint-rule strictness includes it anyway.
    }, [
        socialBeta,
        dialogs.selectedRoomId,
        projectedSocialMessages,
        socialUnread,
    ]);

    // Side-map of `messageId -> { reactions, mine }` for the beta path. The
    // legacy DM table has no `reactions` column, so we only build this map
    // when the social-store read path is live. `BubbleRow` looks the row up by
    // id; missing ids resolve to empty data and skip the reactions bar.
    const reactionsByMessageId = useMemo(() => {
        if (!socialBeta) return null;
        const map = new Map<string, { reactions: ReactionAggregate[]; mine: string[] }>();
        for (const message of socialMessages.messages) {
            map.set(message.id, {
                reactions: message.reactions,
                mine: message.mine,
            });
        }
        return map;
    }, [socialBeta, socialMessages.messages]);

    // Side-map of `messageId -> pinned` for the beta path. The legacy DM
    // shape does not carry `pinned`, so this map stays null in legacy mode
    // and the pin affordance / chip is hidden across the bubble surface.
    const pinnedByMessageId = useMemo(() => {
        if (!socialBeta) return null;
        const map = new Map<string, boolean>();
        for (const message of socialMessages.messages) {
            map.set(message.id, message.pinned === true);
        }
        return map;
    }, [socialBeta, socialMessages.messages]);

    // Pinned messages currently rendered in the sticky rail above the thread.
    // Beta-only — legacy mode never populates `pinned` on the adapter. The
    // list is sorted by `createdAt` DESC so the most-recently-created pinned
    // surfaces first (matches the universal store's `pinnedFirst` semantic
    // and feels intuitive for the chat surface).
    const pinnedDmMessages = useMemo(() => {
        if (!socialBeta) return [];
        return socialMessages.messages
            .filter((message) => message.pinned)
            .sort((left, right) => {
                const l = left.createdAt ? new Date(left.createdAt).getTime() : 0;
                const r = right.createdAt ? new Date(right.createdAt).getTime() : 0;
                return r - l;
            });
    }, [socialBeta, socialMessages.messages]);

    // Pin/Unpin handler — calls the universal endpoint then refreshes the
    // social-store hook so the next render sees the new `pinned` boolean and
    // the sticky rail updates. The boolean we pass is the **target** state
    // (`!currentPinned`) so the dispatcher in the bubble can branch on a
    // single click without re-reading the current entity state.
    const handleTogglePinDm = useCallback(
        async (messageId: string, currentPinned: boolean) => {
            const result = await pinSocialEntity(messageId, !currentPinned);
            if (!result.success) {
                // Pin failures are non-fatal — surface them via a console
                // breadcrumb only. The hover affordance will fall back into
                // its previous state on the next refresh cycle.
                console.warn('[dm pin] toggle failed', result.error);
                return;
            }
            await socialMessages.refresh();
        },
        [socialMessages],
    );

    // i18n bundle for tooltips and the rail header. Local factory keeps the
    // per-locale literals out of the JSX tree.
    const pinUi = useMemo<PinUi>(() => getPinUi(language), [language]);

    // Toggle handler for DM-message reactions. Calls the universal social
    // endpoint directly — the inner `ReactionsBar` already maintains the
    // optimistic count + roll-back-on-error invariant, so we just need to
    // forward the result here. After success we refresh the social messages
    // hook so the next render sees fresh aggregates from the server (and the
    // optimistic overlay clears).
    const handleToggleDmReaction = useCallback(
        async (messageId: string, emoji: string) => {
            const result = await toggleSocialReaction(messageId, emoji);
            if (!result.success) {
                throw new Error(result.error || 'Reaction toggle failed');
            }
            await socialMessages.refresh();
        },
        [socialMessages],
    );

    // Beta-mode + authenticated viewer is the gate for inline reactions —
    // legacy DM has no reactions field and rendering the bar against legacy
    // messages would fire toggles at message ids that the social store does
    // not own. Computed once and passed down so `BubbleRow` does not pull the
    // flag itself.
    const showReactions = socialBeta && Boolean(userId);

    // Beta-mode submit handler. Writes directly through the universal store
    // (Phase 1c shim is bypassed entirely on this path), then refreshes
    // both the social thread and the legacy room list so unread counts /
    // last-message preview stay accurate. On failure we restore the
    // composer state — same UX guarantee `useDialogs.submitMessage`
    // provides for the legacy path.
    const handleSubmitSocialBeta = useCallback(async () => {
        const trimmed = dialogs.composerValue.trim();
        if (!dialogs.selectedRoomId || !trimmed || dialogs.roomBusy) return;
        if (trimmed.length > dialogs.maxMessageLength) return;

        const wasEditing = dialogs.editingMessage;
        const wasReplyTarget = dialogs.replyTarget;
        const composerSnapshot = dialogs.composerValue;
        // Snapshot the queue so a parallel file-pick mid-send doesn't sneak
        // a file into the upload loop without a corresponding preview row.
        const filesToUpload = pendingAttachments;

        // Clear composer immediately for snappy feel (matches legacy path).
        dialogs.setComposerValue('');
        dialogs.cancelComposeMode();
        setPendingAttachments([]);
        setAttachmentError(null);

        const result = wasEditing
            ? await editDmMessageUnified(wasEditing.id, trimmed, true)
            : await sendDmMessageUnified(
                dialogs.selectedRoomId,
                {
                    body: trimmed,
                    replyToMessageId: wasReplyTarget?.id || undefined,
                },
                true,
            );

        if (result.success) {
            // Drop any persisted draft for this room — the just-sent message
            // would otherwise resurrect itself on next mount. Safe to call
            // even when the draft hook is inert (the key is empty).
            dmDraft.clearDraft();
            // Pull the newly-created entity id out of the response so we
            // can attach any queued files to it. The wrappers type as
            // `ApiResponse<unknown>` but the underlying `createSocialEntity`
            // call returns `{ id, entity }` — see social.ts:160.
            const newEntityId = !wasEditing
                ? (result.data as { id?: string } | undefined)?.id
                : undefined;
            if (newEntityId && filesToUpload.length > 0) {
                // Run uploads sequentially so a single retry surface is enough
                // (concurrent uploads would race the surrounding refresh). Any
                // error here surfaces via `attachmentError`; the message has
                // already landed in either case.
                for (const file of filesToUpload) {
                    try {
                        await uploadAndAttachFile(newEntityId, file);
                    } catch (err) {
                        const code = err instanceof Error ? err.message : '';
                        if (code === 'file-too-large') {
                            setAttachmentError(attachmentsUi.fileTooLarge);
                        } else if (code === 'invalid-mime') {
                            setAttachmentError(attachmentsUi.invalidMime);
                        } else {
                            setAttachmentError(attachmentsUi.uploadFailed);
                        }
                    }
                }
            }
            // Social refresh re-renders the thread with the new entity.
            // The legacy `loadRooms` keeps unread counts + last-message
            // preview accurate in the sidebar (it reads from the legacy
            // table, which the Phase 1c social→legacy reverse-shim has
            // already populated by the time we get here in production;
            // pre-shim it's a stale row but converges within the next
            // 15s poll cycle).
            await Promise.all([socialMessages.refresh(), dialogs.loadRooms(false)]);
        } else {
            // Restore composer on failure so the user does not lose
            // their typed message. `cancelComposeMode` cleared all three
            // pieces above, so we have to push them back together.
            dialogs.setComposerValue(composerSnapshot);
            // Restore the file queue too — user expects "send failed →
            // attachments still selected" to match the text behaviour.
            setPendingAttachments(filesToUpload);
            if (wasReplyTarget) dialogs.replyToMessage({
                id: wasReplyTarget.id,
                roomId: dialogs.selectedRoomId,
                roomKind: 'direct',
                authorUserId: wasReplyTarget.authorUserId,
                authorLabel: wasReplyTarget.authorLabel,
                body: wasReplyTarget.body,
                createdAt: '',
                editedAt: null,
                isOwn: false,
                replyTo: null,
            });
            if (wasEditing) dialogs.editMessage(wasEditing);
        }
    }, [
        dialogs,
        socialMessages,
        pendingAttachments,
        attachmentsUi.fileTooLarge,
        attachmentsUi.invalidMime,
        attachmentsUi.uploadFailed,
        dmDraft,
    ]);

    // File-input change handler — validates and appends to the queue. We
    // accept multiple files in a single picker invocation because the UI
    // chip strip below already supports rendering N rows. Invalid files
    // surface via `attachmentError` and never enter the queue.
    const handleFileInputChange = useCallback(
        (event: React.ChangeEvent<HTMLInputElement>) => {
            const fileList = event.target.files;
            // Reset the input so re-selecting the same file works after an
            // error / remove.
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

    // Pick the right submit dispatcher based on the flag. Both keep the
    // same callsite signature so the JSX below is unchanged.
    const dispatchSubmit = useCallback(() => {
        if (socialBeta) {
            void handleSubmitSocialBeta();
            return;
        }
        onSubmitRoomMessage();
    }, [handleSubmitSocialBeta, onSubmitRoomMessage, socialBeta]);

    return (
        <div className="dx-shell" data-thread-open={showThread || undefined}>
            {/* ── List pane ── */}
            <aside className="dx-list-pane">
                <div className="dx-list-head">
                    <div className="dx-list-title-row">
                        <div className="dx-list-title">
                            <Inbox size={16} strokeWidth={2.2} aria-hidden />
                            <span>{messages.globalChat.dialogsTitle}</span>
                        </div>
                        {totalUnread > 0 ? (
                            <span className="dx-total-unread">
                                {formatUnreadBadge(totalUnread)}
                            </span>
                        ) : null}
                    </div>

                    {/* Inline CTAs that replace the old Друзья tab. */}
                    <div className="dx-cta-row">
                        <button
                            type="button"
                            onClick={onOpenAddFriend}
                            className="dx-cta"
                        >
                            <UserPlus size={14} strokeWidth={2.4} aria-hidden />
                            <span>{personalCopy.findPeopleCta}</span>
                        </button>
                        {requestCount > 0 ? (
                            <button
                                type="button"
                                onClick={onOpenFriendRequests}
                                className="dx-cta"
                                data-tone="warning"
                            >
                                <BellRing size={14} strokeWidth={2.4} aria-hidden />
                                <span>{personalCopy.requestsCta.replace('{count}', String(requestCount))}</span>
                            </button>
                        ) : null}
                    </div>

                    <div className="dx-search">
                        <Search size={14} strokeWidth={2.2} className="dx-search-icon" aria-hidden />
                        <input
                            ref={filterRef}
                            placeholder={messages.globalChat.dialogsFilterPlaceholder}
                            className="dx-search-input"
                            onChange={(event) => {
                                const term = event.target.value.toLowerCase().trim();
                                const list = event.currentTarget.closest('.dx-list-pane')?.querySelectorAll<HTMLElement>('.dx-row');
                                list?.forEach((el) => {
                                    if (!term) {
                                        el.removeAttribute('hidden');
                                        return;
                                    }
                                    const label = el.dataset.label?.toLowerCase() || '';
                                    if (label.includes(term)) el.removeAttribute('hidden');
                                    else el.setAttribute('hidden', '');
                                });
                            }}
                        />
                    </div>
                </div>

                {dialogs.dialogError ? <PageStateCard message={dialogs.dialogError} tone="danger" /> : null}

                {dialogs.roomsLoading && dialogs.rooms.length === 0 ? (
                    <div className="dx-skeleton">
                        {[0, 1, 2, 3].map((idx) => (
                            <div key={idx} className="dx-row dx-row--skel">
                                <div className="dx-skel-avatar" />
                                <div className="dx-skel-lines">
                                    <div className="dx-skel-line dx-skel-line--w70" />
                                    <div className="dx-skel-line dx-skel-line--w50" />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : dialogs.rooms.length === 0 ? (
                    <EmptyInbox
                        title={strings.dialogsEmptyTitle}
                        hint={strings.dialogsEmptyHint}
                        action={strings.dialogsEmptyAction}
                        onAction={onOpenAddFriend}
                    />
                ) : (
                    <div className="dx-list" role="list">
                        {dialogs.rooms.map((room) => {
                            const active = dialogs.selectedRoomId === room.roomId;
                            const roomDisplayName = formatPersonalChatName(room.title);
                            // Beta path: read from the universal-store cursor.
                            // Legacy path: keep the legacy `room.unreadCount`.
                            const effectiveUnread = resolveRoomUnread(room.roomId, room.unreadCount);
                            const badgeLabel = formatUnreadBadge(effectiveUnread);
                            return (
                                <button
                                    key={room.roomId}
                                    type="button"
                                    role="listitem"
                                    data-label={`${room.title} ${roomDisplayName}`}
                                    onClick={() => onOpenRoom(room.roomId)}
                                    className="dx-row"
                                    data-active={active || undefined}
                                    data-unread={(effectiveUnread > 0) || undefined}
                                >
                                    <div
                                        className="dx-avatar"
                                        aria-hidden
                                        style={{ background: avatarGradient(room.roomId) }}
                                    >
                                        {avatarInitial(roomDisplayName || room.title)}
                                    </div>
                                    <div className="dx-row-body">
                                        <div className="dx-row-line">
                                            <span className="dx-row-name">{roomDisplayName || room.title}</span>
                                            {room.lastMessageAt ? (
                                                <span className="dx-row-time">{formatRoomTime(room.lastMessageAt, locale)}</span>
                                            ) : null}
                                        </div>
                                        <div className="dx-row-line">
                                            <span className="dx-row-preview">
                                                {clipText(room.lastMessagePreview || room.subtitle || '') || '—'}
                                            </span>
                                            {badgeLabel ? (
                                                <span
                                                    className="dx-row-unread"
                                                    aria-label={`${effectiveUnread} unread`}
                                                >
                                                    {badgeLabel}
                                                </span>
                                            ) : null}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* New chat CTA — opens the find-people bottom sheet. */}
                <button
                    type="button"
                    className="dx-new"
                    onClick={onOpenAddFriend}
                    title={messages.globalChat.newDialogHint}
                >
                    <MessageSquarePlus size={16} strokeWidth={2.2} aria-hidden />
                    <span>{messages.globalChat.newDialog}</span>
                </button>
            </aside>

            {/* ── Thread pane ── (keeps `dlg-modern` so the shared ChatThread
                surface/day-separator/scroll-FAB overrides from conversation.css
                still apply; everything else here is rewritten as `dx-*`). */}
            <section className="dx-thread-pane dlg-modern">
                {dialogs.roomError ? <PageStateCard message={dialogs.roomError} tone="danger" /> : null}
                {!dialogs.selectedRoomId ? (
                    <div className="dx-placeholder">
                        <div className="dx-placeholder-icon" aria-hidden>
                            <UserCircle size={48} strokeWidth={1.4} />
                        </div>
                        <h3 className="dx-placeholder-title">{strings.roomPlaceholderTitle}</h3>
                        <p className="dx-placeholder-hint">{strings.roomPlaceholderHint}</p>
                    </div>
                ) : dialogs.roomLoading && !dialogs.roomDetail ? (
                    <div className="dx-loading">
                        <Loader2 size={20} strokeWidth={2.2} className="animate-spin" aria-hidden />
                        <span>{messages.globalChat.loading}</span>
                    </div>
                ) : activeRoom ? (
                    <div className="dx-thread">
                        <header className="dx-head">
                            <button
                                type="button"
                                className="dx-back"
                                onClick={() => dialogs.clearSelectedRoom()}
                                aria-label={messages.common.back}
                            >
                                <ArrowLeft size={18} strokeWidth={2.2} aria-hidden />
                            </button>
                            <div
                                className="dx-head-avatar"
                                style={{ background: avatarGradient(activeRoom.roomId) }}
                            >
                                <span aria-hidden>{avatarInitial(activeRoomDisplayName || activeRoom.title)}</span>
                                {activeRoom.peerUserId && presence.onlineUserIds.includes(activeRoom.peerUserId) ? (
                                    <span
                                        // Online dot — overlay on the avatar's bottom-right corner. Uses
                                        // semantic status tokens so it adapts to every theme without
                                        // hardcoded greens (light/dark/aurora/matrix/etc).
                                        className="dx-online-dot"
                                        aria-label={messages.common.online}
                                        title={messages.common.online}
                                    />
                                ) : null}
                            </div>
                            <div className="dx-head-meta">
                                <div className="dx-head-name">{activeRoomDisplayName || activeRoom.title}</div>
                                <div className="dx-head-sub">
                                    {typing.typingUserIds.length > 0
                                        ? (locale === 'en' ? 'typing...' : locale === 'kk-KZ' ? 'теріп жатыр...' : 'печатает...')
                                        : (activeRoom.subtitle || 'Личная переписка')}
                                </div>
                            </div>
                            {activeRoom.peerUserId ? (
                                <UserProfileSheet
                                    targetUserId={activeRoom.peerUserId}
                                    label={activeRoomDisplayName || activeRoom.title}
                                    subtitle={activeRoom.subtitle}
                                    description={friends.blockedUserIds.has(activeRoom.peerUserId) ? strings.searchBlocked : strings.searchFriend}
                                    actions={friends.blockedUserIds.has(activeRoom.peerUserId)
                                        ? <button type="button" className="peoplev2-btn peoplev2-btn-ghost" onClick={() => onUnblockUser(activeRoom.peerUserId!)}>{strings.unblock}</button>
                                        : <div className="flex flex-wrap gap-2">
                                            <button type="button" className="peoplev2-btn peoplev2-btn-primary" onClick={() => onOpenDirectRoom(activeRoom.peerUserId!, activeRoom.roomId)}>{strings.openDirect}</button>
                                            <button type="button" className="peoplev2-btn peoplev2-btn-ghost" data-tone="warning" onClick={() => onBlockUser(activeRoom.peerUserId!)}>{strings.block}</button>
                                        </div>}
                                    trigger={<UserCircle size={18} strokeWidth={2} aria-hidden />}
                                    triggerClassName="dx-profile-btn"
                                />
                            ) : null}
                        </header>

                        {socialBeta && pinnedDmMessages.length > 0 ? (
                            <PinnedRail
                                pinUi={pinUi}
                                items={pinnedDmMessages.map((message) => ({
                                    id: message.id,
                                    body: message.body,
                                    authorUserId: message.authorUserId,
                                    authorLabel: message.authorUserId === userId ? '' : (activeRoomDisplayName || activeRoom.title || ''),
                                }))}
                            />
                        ) : null}

                        <ChatThread<ChatMessageView>
                            messages={threadMessages}
                            getKey={(m) => m.id}
                            getAuthor={(m) => m.authorUserId}
                            getTimestamp={(m) => m.createdAt}
                            renderBubble={(message, { isContinuation }) => {
                                // Only beta-path messages carry reactions data
                                // (legacy DM table has no equivalent), so the
                                // bar is gated on the same flag that swaps the
                                // read source. Pending optimistic inserts (id
                                // starts with `__pending_`) get no bar either —
                                // there is no entity to react to yet.
                                const reactionsEntry = showReactions && reactionsByMessageId && !message.id.startsWith('__pending_')
                                    ? reactionsByMessageId.get(message.id) || { reactions: [], mine: [] }
                                    : null;
                                // Attachments are gated on the same flag — legacy DM
                                // has no `app_social_attachment` join, and pending
                                // optimistic inserts (id starts with `__pending_`)
                                // are not yet entities in the social store so the
                                // list endpoint would 404. Read-only here: the
                                // author attached files at send-time, the bubble
                                // surface only renders them.
                                const showAttachmentsForMessage = showReactions
                                    && Boolean(userId)
                                    && !message.id.startsWith('__pending_');
                                // Pin affordance gating: same beta + non-pending
                                // guard as reactions/attachments, plus the
                                // participant-only check from `isMessagePinnable`.
                                // The pin state itself comes from the side-map
                                // we built above; missing entries (legacy mode)
                                // resolve to false and the chip stays hidden.
                                const messagePinned = pinnedByMessageId?.get(message.id) === true;
                                const canPinThis = socialBeta
                                    && isMessagePinnable('dm', message, {
                                        userId: userId || null,
                                        peerUserId: activeRoom.peerUserId ?? null,
                                    });
                                return (
                                    <div
                                        ref={focusHighlight.registerEntityNode(message.id)}
                                        data-entity-id={message.id}
                                        className={focusHighlight.isHighlighted(message.id) ? 'entity-highlighted' : undefined}
                                    >
                                        <BubbleRow
                                            message={message}
                                            isContinuation={isContinuation}
                                            locale={locale}
                                            onReply={() => dialogs.replyToMessage(message)}
                                            onEdit={() => dialogs.editMessage(message)}
                                            reactionsEntry={reactionsEntry}
                                            onToggleReaction={
                                                reactionsEntry
                                                    ? (emoji) => handleToggleDmReaction(message.id, emoji)
                                                    : undefined
                                            }
                                            showAttachments={showAttachmentsForMessage}
                                            currentUserId={userId || undefined}
                                            showShare={showAttachmentsForMessage}
                                            pinned={messagePinned}
                                            canPin={canPinThis}
                                            onTogglePin={canPinThis ? () => handleTogglePinDm(message.id, messagePinned) : undefined}
                                            pinUi={pinUi}
                                        />
                                    </div>
                                );
                            }}
                            threadEndRef={roomThreadEndRef}
                            locale={locale}
                        />

                        <div className="dx-composer">
                            {composeMode === 'reply' && dialogs.replyTarget ? (
                                <div className="dx-context">
                                    <Reply size={14} strokeWidth={2.4} className="dx-context-icon" aria-hidden />
                                    <div className="dx-context-text">
                                        <div className="dx-context-label">
                                            {messages.globalChat.replyAuthor} {formatPersonalChatName(dialogs.replyTarget.authorLabel)}
                                        </div>
                                        <div className="dx-context-body">{clipText(dialogs.replyTarget.body, 120)}</div>
                                    </div>
                                    <button type="button" onClick={dialogs.cancelComposeMode} className="dx-context-close" aria-label={messages.common.cancel}>
                                        <X size={14} strokeWidth={2.4} />
                                    </button>
                                </div>
                            ) : null}
                            {composeMode === 'edit' && dialogs.editingMessage ? (
                                <div className="dx-context" data-tone="edit">
                                    <Pencil size={14} strokeWidth={2.4} className="dx-context-icon" aria-hidden />
                                    <div className="dx-context-text">
                                        <div className="dx-context-label">{messages.globalChat.editLabel}</div>
                                        <div className="dx-context-body">{clipText(dialogs.editingMessage.body, 120)}</div>
                                    </div>
                                    <button type="button" onClick={dialogs.cancelComposeMode} className="dx-context-close" aria-label={messages.common.cancel}>
                                        <X size={14} strokeWidth={2.4} />
                                    </button>
                                </div>
                            ) : null}
                            {socialBeta && pendingAttachments.length > 0 ? (
                                <div className="dx-attach-chips">
                                    {pendingAttachments.map((file, idx) => (
                                        <span
                                            key={`${file.name}-${idx}`}
                                            className="dx-attach-chip"
                                            title={file.name}
                                        >
                                            <Paperclip size={12} strokeWidth={2.2} aria-hidden />
                                            <span className="dx-attach-chip-name">
                                                {file.name}
                                            </span>
                                            <span className="dx-attach-chip-size">
                                                {attachmentsUi.formatSize(file.size)}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => removePendingAttachment(idx)}
                                                aria-label={attachmentsUi.deleteLabel}
                                                className="dx-attach-chip-remove"
                                            >
                                                <X size={12} strokeWidth={2.4} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            {attachmentError ? (
                                <p
                                    role="alert"
                                    className="dx-composer-error"
                                >
                                    {attachmentError}
                                </p>
                            ) : null}
                            {dmDraft.hasDraft ? (
                                <DraftRestoredHint
                                    visible={dmDraft.hasDraft}
                                    onDismiss={() => dmDraft.clearDraft()}
                                />
                            ) : null}
                            <div className="dx-composer-row">
                                {socialBeta && userId ? (
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
                                            className="dx-attach"
                                            onClick={() => composerFileInputRef.current?.click()}
                                            disabled={!dialogs.roomDetail?.canWrite || dialogs.roomBusy}
                                            title={attachmentsUi.attachButton}
                                            aria-label={attachmentsUi.attachButton}
                                        >
                                            <Paperclip size={16} strokeWidth={2.2} aria-hidden />
                                        </button>
                                    </>
                                ) : null}
                                <textarea
                                    ref={composerTextareaRef}
                                    value={dialogs.composerValue}
                                    onChange={(event) => {
                                        const next = event.target.value;
                                        dialogs.setComposerValue(next);
                                        composerMentions.handleSelectionChange(
                                            event.target.selectionStart ?? next.length,
                                        );
                                        // Fire a typing ping when the composer has content.
                                        // The hook throttles to one network call per 3s so a
                                        // keystroke burst does not flood the endpoint. We do
                                        // NOT ping on empty content — that's effectively
                                        // "stopped typing" and the server-side TTL handles it.
                                        if (next.trim().length > 0) {
                                            typing.setMyTyping(true);
                                        }
                                    }}
                                    onSelect={(event) => {
                                        composerMentions.handleSelectionChange(
                                            (event.target as HTMLTextAreaElement).selectionStart ?? 0,
                                        );
                                    }}
                                    onBlur={() => {
                                        setTimeout(() => composerMentions.autocomplete.close(), 100);
                                    }}
                                    placeholder={!dialogs.roomDetail?.canWrite ? strings.roomReadOnly : strings.roomComposerPlaceholder}
                                    disabled={!dialogs.roomDetail?.canWrite}
                                    className="dx-input"
                                    rows={1}
                                    onKeyDown={(event) => {
                                        // The mention hook consumes ArrowUp/Down/Enter/Esc/Tab
                                        // when the dropdown is open. We must check `consumed`
                                        // BEFORE the Enter-to-send branch so picking a candidate
                                        // doesn't trip the message submit.
                                        const consumed = dmMentionScope
                                            ? composerMentions.handleKeyDown(event)
                                            : false;
                                        if (consumed) return;
                                        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                                            event.preventDefault();
                                            if (dialogs.composerValue.trim() && dialogs.roomDetail?.canWrite && !dialogs.roomBusy) {
                                                dispatchSubmit();
                                            }
                                        }
                                    }}
                                />
                                {dmMentionScope ? (
                                    <MentionPickerDropdown
                                        open={composerMentions.autocomplete.isOpen}
                                        candidates={composerMentions.autocomplete.candidates}
                                        selectedIndex={composerMentions.autocomplete.selectedIndex}
                                        loading={composerMentions.autocomplete.loading}
                                        onSelect={(handle) => composerMentions.handlePickCandidate(handle)}
                                        onHover={(idx) => composerMentions.autocomplete.setSelectedIndex(idx)}
                                    />
                                ) : null}
                                <span
                                    className="dx-counter"
                                    data-warning={(remainingChars < 200 && remainingChars >= 50) || undefined}
                                    data-danger={(remainingChars < 50) || undefined}
                                >
                                    {remainingChars}
                                </span>
                                <button
                                    type="button"
                                    className="dx-send"
                                    onClick={dispatchSubmit}
                                    disabled={dialogs.roomBusy || !dialogs.composerValue.trim() || !dialogs.roomDetail?.canWrite}
                                    title={messages.globalChat.sendShortcutHint}
                                >
                                    {dialogs.roomBusy
                                        ? <Loader2 size={16} strokeWidth={2.5} className="animate-spin" aria-hidden />
                                        : <Send size={16} strokeWidth={2.4} aria-hidden />}
                                </button>
                            </div>
                            {dialogs.roomError ? (
                                <p className="dx-composer-error">{dialogs.roomError}</p>
                            ) : null}
                        </div>
                    </div>
                ) : null}
            </section>
        </div>
    );
}

interface BubbleRowProps {
    message: ChatMessageView;
    isContinuation?: boolean;
    locale: string;
    onReply: () => void;
    onEdit: () => void;
    /**
     * Reactions side-channel populated by the beta-path read. When null the
     * row hides the reactions bar (legacy DM, pending optimistic insert).
     */
    reactionsEntry: { reactions: ReactionAggregate[]; mine: string[] } | null;
    /**
     * Toggle handler scoped to this message id. Mirrors the contract
     * `ReactionsBar` expects — async, throw-on-error so the bar can roll back
     * its optimistic count.
     */
    onToggleReaction?: (emoji: string) => Promise<void>;
    /**
     * When true, render a read-only `AttachmentsList` under the bubble. Beta
     * path only — the legacy DM read source does not project attachments and
     * the list endpoint would 404 on legacy ids. Caller is responsible for
     * filtering out pending optimistic inserts.
     */
    showAttachments?: boolean;
    /** Viewer id — required by `AttachmentsList` to compute the edit gate. */
    currentUserId?: string;
    /**
     * When true, render the permalink share button inside the actions row.
     * Uses the same id-guarantee as `showAttachments` (beta path + not a
     * pending optimistic insert). Hidden in legacy mode where `message.id`
     * is not a `social_entity.id`.
     */
    showShare?: boolean;
    /**
     * Whether the message is currently pinned. Drives both the inline pin
     * chip next to the bubble header and the Pin/PinOff toggle icon in the
     * action row. False in legacy mode (no `pinned` field on legacy rows).
     */
    pinned?: boolean;
    /**
     * Whether the viewer is allowed to flip the pin state. When false the
     * action button is hidden entirely. Computed by `isMessagePinnable`
     * outside the row so the gate is unit-testable.
     */
    canPin?: boolean;
    /**
     * Pin / unpin handler. Fired with the target pin state already chosen
     * by the parent (current pin boolean → !current).
     */
    onTogglePin?: () => void | Promise<void>;
    /** Locale-aware tooltip strings for the pin/unpin button. */
    pinUi?: PinUi;
}

function BubbleRow({
    message,
    isContinuation,
    locale,
    onReply,
    onEdit,
    reactionsEntry,
    onToggleReaction,
    showAttachments,
    currentUserId,
    showShare,
    pinned,
    canPin,
    onTogglePin,
    pinUi,
}: BubbleRowProps) {
    const { messages } = useLanguage();
    const classes = [
        'dx-bubble',
        message.isOwn ? 'dx-bubble--own' : 'dx-bubble--peer',
        message.id.startsWith('__pending_') ? 'dx-bubble--pending' : '',
        isContinuation ? 'dx-bubble--continued' : '',
    ].filter(Boolean).join(' ');

    return (
        <div className={classes} data-pinned={pinned || undefined}>
            <div className="dx-bubble-content">
                {pinned ? (
                    <div
                        className="dx-bubble-pin-chip"
                        title={pinUi?.pinnedHeader}
                        aria-label={pinUi?.pinnedHeader}
                    >
                        <Pin size={11} strokeWidth={2.4} aria-hidden />
                        <span>{pinUi?.pinnedHeader}</span>
                    </div>
                ) : null}
                {message.replyTo ? (
                    <div className="dx-bubble-reply">
                        <div className="dx-bubble-reply-author">{formatPersonalChatName(message.replyTo.authorLabel)}</div>
                        <div>{clipText(message.replyTo.body, 160)}</div>
                    </div>
                ) : null}
                {message.body}
            </div>
            {reactionsEntry && onToggleReaction ? (
                <div className="dx-bubble-reactions">
                    <ReactionsBar
                        reactions={reactionsEntry.reactions}
                        mine={reactionsEntry.mine}
                        onToggle={onToggleReaction}
                    />
                </div>
            ) : null}
            {showAttachments ? (
                <div className="dx-bubble-attachments">
                    <AttachmentsList
                        entityId={message.id}
                        currentUserId={currentUserId}
                        // Strict display-only — author attaches at send-time, the
                        // bubble surface never exposes upload / delete. Even for
                        // own messages we keep `enableEdit` off so the universal
                        // list stays a passive reader here.
                        enableEdit={false}
                    />
                </div>
            ) : null}
            <div className="dx-bubble-meta">
                <span>{formatMessageTime(message.createdAt, locale)}</span>
                {message.editedAt ? <span className="dx-bubble-edited">{messages.globalChat.editedBadge}</span> : null}
                <div className="dx-bubble-actions" role="group" aria-label={messages.common.actions}>
                    <button type="button" className="dx-bubble-action" onClick={onReply}>
                        <Reply size={12} strokeWidth={2.4} aria-hidden />
                        <span>{messages.globalChat.replyActionLabel}</span>
                    </button>
                    {message.isOwn ? (
                        <button type="button" className="dx-bubble-action" onClick={onEdit}>
                            <Pencil size={12} strokeWidth={2.4} aria-hidden />
                            <span>{messages.globalChat.editActionLabel}</span>
                        </button>
                    ) : null}
                    {canPin && onTogglePin ? (
                        <button
                            type="button"
                            className="dx-bubble-action"
                            onClick={() => void onTogglePin()}
                            title={pinned ? pinUi?.unpin : pinUi?.pin}
                            aria-label={pinned ? pinUi?.unpin : pinUi?.pin}
                            aria-pressed={pinned || undefined}
                        >
                            {pinned ? (
                                <PinOff size={12} strokeWidth={2.4} aria-hidden />
                            ) : (
                                <Pin size={12} strokeWidth={2.4} aria-hidden />
                            )}
                            <span>{pinned ? pinUi?.unpin : pinUi?.pin}</span>
                        </button>
                    ) : null}
                    {showShare ? (
                        <EntityShareButton
                            entityId={message.id}
                            entityKind="dm_message"
                            displayTitle={clipText(message.body, 80)}
                        />
                    ) : null}
                </div>
            </div>
        </div>
    );
}

/**
 * Sticky horizontal rail rendered above the thread when the current room has
 * at least one pinned message. Each card surfaces a small icon + the first
 * ~80 chars of the body + the author label. Clicking a card scrolls the
 * matching bubble into view (using the same DOM ids the `ChatThread` registers
 * via the focus highlight + a fallback `data-message-id` attribute search).
 *
 * Up to 3 cards are shown by default; the "Show all (N)" toggle reveals the
 * rest. Kept inside the same file as `DialogsPanel` so the shared
 * `formatPinnedSnippet` helper and pin-UI strings stay co-located with the
 * panel that owns them.
 */
interface PinnedRailItem {
    id: string;
    body: string;
    authorUserId: string;
    /** Display label shown above the snippet (empty for the viewer's own messages). */
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

    // Scroll the matching message bubble into view. We look up the wrapper
    // node by the `data-entity-id` attribute the focus highlight already
    // registers — that wrapper is the closest stable anchor we have without
    // a fresh ref pipeline through `ChatThread`.
    const handleNavigate = useCallback((messageId: string) => {
        if (typeof window === 'undefined') return;
        const node = document.querySelector(`[data-entity-id="${messageId}"]`);
        if (node instanceof HTMLElement) {
            node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, []);

    return (
        <div
            className="dx-pinned-rail"
            role="region"
            aria-label={pinUi.pinnedHeader}
        >
            <div className="dx-pinned-rail-head">
                <span className="dx-pinned-rail-title">
                    <Pin size={12} strokeWidth={2.4} aria-hidden />
                    <span>{pinUi.pinnedHeader}</span>
                    <span className="dx-pinned-rail-count">
                        ({items.length})
                    </span>
                </span>
                {items.length > 3 ? (
                    <button
                        type="button"
                        className="dx-pinned-rail-toggle"
                        onClick={() => setExpanded((prev) => !prev)}
                    >
                        {expanded ? pinUi.collapse : pinUi.showAll.replace('{count}', String(items.length))}
                    </button>
                ) : null}
            </div>
            <div
                className="dx-pinned-rail-cards"
                data-collapsed={!expanded || undefined}
            >
                {visible.map((item) => (
                    <button
                        key={item.id}
                        type="button"
                        className="dx-pinned-card"
                        onClick={() => handleNavigate(item.id)}
                    >
                        <Pin size={11} strokeWidth={2.4} aria-hidden />
                        <span className="dx-pinned-card-text">
                            {item.authorLabel ? (
                                <span className="dx-pinned-card-author">
                                    {item.authorLabel}
                                </span>
                            ) : null}
                            <span className="dx-pinned-card-snippet">
                                {formatPinnedSnippet(item.body)}
                            </span>
                        </span>
                    </button>
                ))}
                {!expanded && remaining > 0 ? (
                    <span className="dx-pinned-rail-more">
                        +{remaining}
                    </span>
                ) : null}
            </div>
        </div>
    );
}

function EmptyInbox({ title, hint, action, onAction }: {
    title: string;
    hint: string;
    action: string;
    onAction: () => void;
}) {
    return (
        <div className="dx-empty">
            <div className="dx-empty-icon" aria-hidden>
                <Inbox size={32} strokeWidth={1.6} />
            </div>
            <h3 className="dx-empty-title">{title}</h3>
            <p className="dx-empty-hint">{hint}</p>
            <button type="button" className="dx-empty-cta" onClick={onAction}>
                {action}
            </button>
        </div>
    );
}

export type DialogsPanelStrings = Strings;
