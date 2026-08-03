'use client';

import './styles/chat-modern.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Globe, MessageCircle } from 'lucide-react';
import type { GlobalChatMessageView, ReactionAggregate } from '@/lib/api';
import { toggleSocialReaction } from '@/lib/api';
import { PageMain, PageShell } from '@/components/PageShell';
import { useAuth } from '@/lib/auth-context';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useSocialStream } from '@/lib/use-social-stream';
import { forwardPresenceOrTyping } from '@/lib/use-presence';
import { useLanguage } from '@/lib/language-context';
import { uploadAndAttachFile } from '@/app/group/utils/social-attachment-upload';
import type { ChatTab } from './types';
import { AddFriendSheet } from './components/AddFriendSheet';
import { DialogsPanel, type DialogsPanelStrings } from './components/DialogsPanel';
import { FriendRequestsSheet } from './components/FriendRequestsSheet';
import { GlobalPanel, type GlobalChatReactionsBridge } from './components/GlobalPanel';
import { useGlobalChat, type UseGlobalChatReturn } from './hooks/useGlobalChat';
import { useGlobalChatSocial } from './hooks/useGlobalChatSocial';
import { useDialogs } from './hooks/useDialogs';
import { useFriends } from './hooks/useFriends';
import { useChatPolling } from './hooks/useChatPolling';
import { useChatActions } from './hooks/useChatActions';
import { socialGlobalMessageToLegacyView } from './utils/social-entity-to-global-message';
import {
    deleteGlobalMessageUnified,
    sendGlobalMessageUnified,
} from './utils/social-global-chat-actions';
import { pinSocialEntity } from '@/lib/api/social';
import type { GlobalChatPinBridge } from './components/GlobalPanel';

export default function ChatPage() {
    const { isAuth, loading, userId } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const locale = language === 'en' ? 'en-US' : language === 'kz' ? 'kk-KZ' : 'ru-RU';
    const requestedRoomId = searchParams.get('roomId')?.trim() || '';

    const ui = useMemo(() => ({
        title: language === 'en' ? 'Chats' : language === 'kz' ? 'Чаттар' : 'Чаты',
        subtitle: language === 'en' ? 'Personal dialogs and the global chat.' : language === 'kz' ? 'Жеке диалогтар мен жаһандық чат.' : 'Личные диалоги и общий чат.',
        dialogsEmptyTitle: language === 'en' ? 'No dialogs yet' : language === 'kz' ? 'Әзірге диалог жоқ' : 'Пока нет диалогов',
        dialogsEmptyHint: language === 'en' ? 'Add a friend or accept an incoming request to start a direct chat.' : language === 'kz' ? 'Жеке чат бастау үшін досқа қосыңыз немесе сұранысты қабылдаңыз.' : 'Добавь друга или прими входящую заявку, чтобы открыть личку.',
        dialogsEmptyAction: language === 'en' ? 'Find people' : language === 'kz' ? 'Адамдарды табу' : 'Найти людей',
        roomPlaceholderTitle: language === 'en' ? 'Choose a dialog' : language === 'kz' ? 'Диалогты таңдаңыз' : 'Выберите диалог',
        roomPlaceholderHint: language === 'en' ? 'Select a conversation on the left or open a profile to start a new direct chat.' : language === 'kz' ? 'Сол жақтан диалогты таңдаңыз немесе профильді ашып, жаңа жеке чат бастаңыз.' : 'Выбери диалог слева или начни новую личку через карточку профиля.',
        searchBlocked: language === 'en' ? 'Direct chat is unavailable because one of you blocked the other.' : language === 'kz' ? 'Біреуіңіз екіншіңізді бұғаттағандықтан, жеке чат қолжетімсіз.' : 'Личка недоступна, потому что один из вас заблокировал другого.',
        searchFriend: language === 'en' ? 'You are already friends.' : language === 'kz' ? 'Сіздер әлдеқашан доссыздар.' : 'Вы уже друзья.',
        openDirect: language === 'en' ? 'Message' : language === 'kz' ? 'Жазу' : 'Написать',
        unblock: language === 'en' ? 'Unblock' : language === 'kz' ? 'Бұғаттан шығару' : 'Разблокировать',
        block: language === 'en' ? 'Block' : language === 'kz' ? 'Бұғаттау' : 'Заблокировать',
        roomReadOnly: language === 'en' ? 'You cannot write in this direct chat right now.' : language === 'kz' ? 'Қазір бұл жеке чатқа жаза алмайсыз.' : 'Сейчас ты не можешь писать в эту личку.',
        roomComposerPlaceholder: language === 'en' ? 'Write a direct message…' : language === 'kz' ? 'Жеке хабарлама жазыңыз…' : 'Напиши сообщение…',
        tabs: {
            dialogs: language === 'en' ? 'Personal' : language === 'kz' ? 'Жеке' : 'Личные',
            global: language === 'en' ? 'Chat' : language === 'kz' ? 'Чат' : 'Чат',
        },
    }), [language]);

    const [activeTab, setActiveTab] = useState<ChatTab>('dialogs');
    const [addFriendOpen, setAddFriendOpen] = useState(false);
    const [friendRequestsOpen, setFriendRequestsOpen] = useState(false);

    const socialBeta = useFeatureFlag('socialFeedBeta');
    const globalChat = useGlobalChat(userId);
    const socialChat = useGlobalChatSocial({ enabled: socialBeta });
    const dialogs = useDialogs(requestedRoomId, userId);
    const friends = useFriends();

    // A deep-linked fresh DM (?roomId=direct:… from a board announcement or a
    // friend card) has no entry in the room list, so eagerly load its detail to
    // populate the room header + composer. No-op for non-direct deep links.
    const { loadRoomDetail: loadDeepLinkedRoom } = dialogs;
    useEffect(() => {
        if (!isAuth || !userId) return;
        if (!requestedRoomId.startsWith('direct:')) return;
        void loadDeepLinkedRoom(requestedRoomId);
    }, [isAuth, userId, requestedRoomId, loadDeepLinkedRoom]);

    // One-shot mount log so we can see in browser devtools which path is live
    // for any given session. Only fires on mount and when the path actually
    // flips (e.g. user toggles the flag while the tab is open). Mirrors the
    // `FeedTab.tsx` pattern.
    const lastLoggedPath = useRef<'social-beta' | 'legacy' | null>(null);
    useEffect(() => {
        const current = socialBeta ? 'social-beta' : 'legacy';
        if (lastLoggedPath.current !== current) {
            console.log(`[global chat] using ${current}`);
            lastLoggedPath.current = current;
        }
    }, [socialBeta]);

    /**
     * When the `socialFeedBeta` flag is on, swap the message list (and
     * fetching state) from the legacy `useGlobalChat` hook for the
     * back-mapped social-store entities. Everything else — viewer state,
     * moderation queue, composer, mute summary — stays on the legacy path:
     *  - viewer state (`canModerate`, `isMuted`) has no universal endpoint
     *  - moderation queue lives in `app_global_chat_reports`, not the
     *    universal store
     *  - composer / busy keys are owned by the legacy hook
     *
     * `socialGlobalMessageToLegacyView` produces a `GlobalChatMessageView`-
     * compatible row with conservative defaults — `isReportedByViewer` and
     * `reportCount` are always 0 in beta mode (the flag button hides
     * automatically) and `canDelete` is derived from viewer-vs-author. We OR
     * in `globalChat.viewerState.canModerate` here so moderators keep their
     * delete affordance regardless of authorship.
     */
    const socialMessagesForView: GlobalChatMessageView[] = useMemo(() => {
        if (!socialBeta) return [];
        const canModerate = globalChat.viewerState.canModerate;
        return socialChat.messages.map((message) => {
            const legacy = socialGlobalMessageToLegacyView(message, userId);
            return {
                ...legacy,
                // Author label join is out of scope for the POC — keep the
                // raw userId so `avatarLetter()` and the profile sheet still
                // resolve, then refine in a follow-up if needed.
                authorLabel: legacy.authorLabel,
                canDelete: legacy.canDelete || canModerate,
            };
        });
    }, [globalChat.viewerState.canModerate, socialBeta, socialChat.messages, userId]);

    /**
     * Synthetic `UseGlobalChatReturn`-shaped view passed to `GlobalPanel`. In
     * legacy mode this is exactly `globalChat`. In beta mode we override:
     *  - `chatMessages` → back-mapped social messages
     *  - `fetching` → social loading state (OR'd with legacy so the existing
     *    skeleton still shows during the legacy moderation/viewer-state load
     *    on first paint)
     *  - `submit` → unified send wrapper (routes through the social write
     *    path; clears composer + handles optimistic insert via a manual
     *    refresh from the social hook)
     *  - `deleteMessage` → unified delete wrapper
     *
     * Reports / mute / report-message / dismiss-report stay legacy as
     * documented in the integration boundaries.
     */
    const wrappedSubmit = useCallback(async (muteSummary: string | null) => {
        if (!socialBeta) return globalChat.submit(muteSummary);
        const trimmed = globalChat.composerValue.trim();
        if (!trimmed || globalChat.sending) return;
        if (trimmed.length > globalChat.maxMessageLength) {
            globalChat.setError(messages.globalChat.tooLong);
            return;
        }
        if (globalChat.viewerState.isMuted) {
            globalChat.setError(muteSummary || messages.globalChat.mutedComposerBlocked);
            return;
        }
        const composerSnapshot = globalChat.composerValue;
        globalChat.setComposerValue('');
        globalChat.setError(null);
        const result = await sendGlobalMessageUnified({ body: trimmed }, true);
        if (!result.success) {
            globalChat.setComposerValue(composerSnapshot);
            if (result.statusCode === 429) {
                globalChat.setError(messages.globalChat.cooldown);
            } else {
                globalChat.setError(result.error || messages.globalChat.sendFailed);
            }
            return;
        }
        socialChat.refresh();
    }, [globalChat, messages.globalChat.cooldown, messages.globalChat.mutedComposerBlocked, messages.globalChat.sendFailed, messages.globalChat.tooLong, socialBeta, socialChat]);

    const wrappedDeleteMessage = useCallback(async (messageId: string, reason?: string) => {
        if (!socialBeta) return globalChat.deleteMessage(messageId, reason);
        const result = await deleteGlobalMessageUnified(
            messageId,
            reason ? reason.trim() : null,
            true,
        );
        if (result.success) {
            socialChat.refresh();
        } else {
            globalChat.setModerationError(result.error || messages.globalChat.deleteFailed);
        }
    }, [globalChat, messages.globalChat.deleteFailed, socialBeta, socialChat]);

    const globalChatForView: UseGlobalChatReturn = useMemo(() => {
        if (!socialBeta) return globalChat;
        return {
            ...globalChat,
            chatMessages: socialMessagesForView,
            fetching: globalChat.fetching || socialChat.isLoading,
            error: globalChat.error ?? socialChat.error,
            submit: wrappedSubmit,
            deleteMessage: wrappedDeleteMessage,
        };
    }, [globalChat, socialBeta, socialChat.error, socialChat.isLoading, socialMessagesForView, wrappedDeleteMessage, wrappedSubmit]);

    // Reactions side-channel for the global chat. The legacy `GlobalChatMessageView`
    // does not carry a `reactions` field, so we build a small `messageId -> {reactions, mine}`
    // map from the social-store adapter (which already projects them through). The map is
    // null when the flag is off — `GlobalPanel` then renders no reactions UI, matching the
    // legacy capability set.
    const globalReactionsBridge: GlobalChatReactionsBridge | undefined = useMemo(() => {
        if (!socialBeta || !userId) return undefined;
        const byId = new Map<string, { reactions: ReactionAggregate[]; mine: string[] }>();
        for (const message of socialChat.messages) {
            byId.set(message.id, { reactions: message.reactions, mine: message.mine });
        }
        return {
            getReactions: (messageId: string) => byId.get(messageId) || null,
            onToggleReaction: async (messageId: string, emoji: string) => {
                // Direct call to the universal toggle endpoint. The embedded
                // `ReactionsBar` already manages optimistic counts + roll-back
                // on error; we just need to surface success/failure here and
                // refresh the social store so the next render replaces the
                // optimistic overlay with server-authoritative aggregates.
                const result = await toggleSocialReaction(messageId, emoji);
                if (!result.success) {
                    throw new Error(result.error || 'Reaction toggle failed');
                }
                socialChat.refresh();
            },
        };
    }, [socialBeta, socialChat, userId]);

    // Pin bridge for the global chat. Only wired when the beta flag is on
    // because the social-store pin endpoint requires entity ids that live
    // on `app_social_entity`; legacy global-chat ids do not. Auth model:
    // only moderators may flip the pin state for global chat — surfaced
    // via `globalChat.viewerState.canModerate`. The bridge also exposes
    // the pinned messages list to drive the sticky rail above the thread.
    const globalPinBridge: GlobalChatPinBridge | undefined = useMemo(() => {
        if (!socialBeta || !userId) return undefined;
        const pinnedMessages = socialChat.messages
            .filter((message) => message.pinned)
            .sort((left, right) => {
                const l = left.createdAt ? new Date(left.createdAt).getTime() : 0;
                const r = right.createdAt ? new Date(right.createdAt).getTime() : 0;
                return r - l;
            })
            .map((message) => ({
                id: message.id,
                body: message.body,
                authorUserId: message.authorUserId,
                authorLabel: message.authorUserId,
            }));
        return {
            pinnedMessages,
            canPin: globalChat.viewerState.canModerate === true,
            onTogglePin: async (messageId: string, nextPinned: boolean) => {
                const result = await pinSocialEntity(messageId, nextPinned);
                if (!result.success) {
                    throw new Error(result.error || 'Pin toggle failed');
                }
                socialChat.refresh();
            },
        };
    }, [globalChat.viewerState.canModerate, socialBeta, socialChat, userId]);

    const dialogsStrings: DialogsPanelStrings = useMemo(() => ({
        dialogsEmptyTitle: ui.dialogsEmptyTitle,
        dialogsEmptyHint: ui.dialogsEmptyHint,
        dialogsEmptyAction: ui.dialogsEmptyAction,
        roomPlaceholderTitle: ui.roomPlaceholderTitle,
        roomPlaceholderHint: ui.roomPlaceholderHint,
        roomReadOnly: ui.roomReadOnly,
        roomComposerPlaceholder: ui.roomComposerPlaceholder,
        searchBlocked: ui.searchBlocked,
        searchFriend: ui.searchFriend,
        openDirect: ui.openDirect,
        block: ui.block,
        unblock: ui.unblock,
    }), [ui]);

    const muteSummary = useMemo(() => {
        const viewer = globalChat.viewerState;
        if (!viewer.isMuted || !viewer.mute) return null;
        return viewer.mute.expiresAt
            ? `${messages.globalChat.mutedUntil} ${new Date(viewer.mute.expiresAt).toLocaleString(locale)}`
            : messages.globalChat.mutedNoExpiry;
    }, [globalChat.viewerState, locale, messages.globalChat.mutedNoExpiry, messages.globalChat.mutedUntil]);

    /**
     * Beta-mode submit that returns the new entity id. Same validation flow
     * as `wrappedSubmit` (above) but surfaces the universal-store create
     * response so the panel can chain attachment uploads against the
     * freshly-minted entity id. Returns `{ entityId: null }` on validation
     * failure or HTTP error — the panel uses this signal to keep the queued
     * files visible for retry. Files are passed through but not uploaded
     * here; the panel owns the upload loop (it has the queue state).
     */
    const wrappedSubmitBetaWithEntityId = useCallback(async (
        // Files are owned + iterated by the panel via `onUploadAttachment`;
        // we accept the array for API symmetry but never iterate it here.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _files: File[],
    ): Promise<{ entityId: string | null }> => {
        if (!socialBeta) return { entityId: null };
        const trimmed = globalChat.composerValue.trim();
        if (!trimmed || globalChat.sending) return { entityId: null };
        if (trimmed.length > globalChat.maxMessageLength) {
            globalChat.setError(messages.globalChat.tooLong);
            return { entityId: null };
        }
        if (globalChat.viewerState.isMuted) {
            globalChat.setError(muteSummary || messages.globalChat.mutedComposerBlocked);
            return { entityId: null };
        }
        const composerSnapshot = globalChat.composerValue;
        globalChat.setComposerValue('');
        globalChat.setError(null);
        const result = await sendGlobalMessageUnified({ body: trimmed }, true);
        if (!result.success) {
            globalChat.setComposerValue(composerSnapshot);
            if (result.statusCode === 429) {
                globalChat.setError(messages.globalChat.cooldown);
            } else {
                globalChat.setError(result.error || messages.globalChat.sendFailed);
            }
            return { entityId: null };
        }
        socialChat.refresh();
        // `createSocialEntity` returns `{ id, entity }` — see social.ts:160.
        // The wrapper types it as `unknown`, so we cast narrowly here.
        const entityId = (result.data as { id?: string } | undefined)?.id ?? null;
        return { entityId };
    }, [
        globalChat,
        messages.globalChat.cooldown,
        messages.globalChat.mutedComposerBlocked,
        messages.globalChat.sendFailed,
        messages.globalChat.tooLong,
        muteSummary,
        socialBeta,
        socialChat,
    ]);

    // Uploader the panel calls once per queued file after a successful send.
    // Errors surface back to the panel which renders an inline message.
    const handleUploadAttachment = useCallback(async (entityId: string, file: File) => {
        await uploadAndAttachFile(entityId, file);
        socialChat.refresh();
    }, [socialChat]);

    const globalListEndRef = useRef<HTMLDivElement | null>(null);
    const roomListEndRef = useRef<HTMLDivElement | null>(null);

    // Presence / typing forwarding state — populated by the SSE bridge below
    // and consumed by `usePresence` / `useTypingIndicator` inside GlobalPanel
    // (mirrors the DialogsPanel split: parent owns the channel, panel owns
    // the hook). We keep these as the last-seen frame (not a list) because
    // the hooks own their own internal state machine.
    const [lastGlobalPresenceEvent, setLastGlobalPresenceEvent] = useState<{
        scope: string;
        onlineUserIds: string[];
        receivedAt: number;
    } | null>(null);
    const [lastGlobalTypingEvent, setLastGlobalTypingEvent] = useState<{
        scope: string;
        userId: string;
        startedAt: number;
    } | null>(null);

    // Auth guard
    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    // Polling lifecycle — no global-feed branch, no friends-tab branch.
    // Polling always drives the legacy hook (viewer state, mute, reports
    // queue have no universal equivalent). When the beta flag is on, the
    // social hook polls itself on mount + on its own refresh() calls.
    useChatPolling({ isAuth, activeTab, dialogs, friends, globalChat });

    // Piggy-back on the legacy polling cadence: every time the legacy global
    // chat refreshes (initial load + interval + post-action loads), also
    // refresh the social store so the visible message list stays in sync.
    // We only do this in beta mode — otherwise the social hook is disabled
    // and refresh is a no-op anyway.
    useEffect(() => {
        if (!socialBeta || !isAuth) return;
        const intervalId = window.setInterval(() => {
            if (activeTab === 'global') socialChat.refresh();
        }, 15000);
        return () => window.clearInterval(intervalId);
    }, [activeTab, isAuth, socialBeta, socialChat]);

    // Realtime SSE bridge for the global chat — only opens when the user is
    // on the global tab AND the feature flag is on. Same 500ms debounce as
    // the group/DM bridges so a burst of inbound messages collapses into one
    // refresh. Polling above stays as a belt-and-suspenders fallback in case
    // the stream connection is killed (mobile background, network change).
    const socialChatRefreshRef = useRef(socialChat.refresh);
    useEffect(() => {
        socialChatRefreshRef.current = socialChat.refresh;
    }, [socialChat.refresh]);
    const globalRefreshDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (globalRefreshDebounce.current !== null) {
            clearTimeout(globalRefreshDebounce.current);
            globalRefreshDebounce.current = null;
        }
    }, []);
    useSocialStream({
        scopes: socialBeta && isAuth && activeTab === 'global' ? ['global:chat'] : [],
        enabled: socialBeta && isAuth && activeTab === 'global',
        onEvent: (event) => {
            if (event.type === 'entity-created' && event.data.kind === 'global_message') {
                if (globalRefreshDebounce.current !== null) {
                    clearTimeout(globalRefreshDebounce.current);
                }
                globalRefreshDebounce.current = setTimeout(() => {
                    globalRefreshDebounce.current = null;
                    socialChatRefreshRef.current();
                }, 500);
                return;
            }
            // Forward presence/typing frames into local state — `GlobalPanel`
            // owns the `usePresence` / `useTypingIndicator` hooks and reads
            // these as their `lastEvent` prop.
            const forwarded = forwardPresenceOrTyping(event);
            if (forwarded?.kind === 'presence') {
                setLastGlobalPresenceEvent(forwarded.payload);
            } else if (forwarded?.kind === 'typing') {
                setLastGlobalTypingEvent(forwarded.payload);
            }
        },
    });

    const actions = useChatActions({ setActiveTab, dialogs, friends, globalChat: globalChatForView, muteSummary });

    if (loading || !isAuth) {
        return null;
    }

    const tabConfig: Array<{ key: ChatTab; Icon: typeof MessageCircle; badge: number }> = [
        { key: 'dialogs', Icon: MessageCircle, badge: dialogs.totalUnreadRooms },
        { key: 'global', Icon: Globe, badge: 0 },
    ];

    return (
        <PageShell className="chat-modern">
            <header className="app-header">
                <div className="min-w-0">
                    <h1 className="app-header-title">{ui.title}</h1>
                    <p className="app-header-subtitle">{ui.subtitle}</p>
                </div>
            </header>

            <PageMain className="space-y-4">
                <div className="chat-tabs" role="tablist">
                    {tabConfig.map(({ key, Icon, badge }) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === key}
                            onClick={() => setActiveTab(key)}
                            className={activeTab === key ? 'chat-tab chat-tab--active' : 'chat-tab'}
                        >
                            <Icon className="w-4 h-4" strokeWidth={2} aria-hidden />
                            <span>{ui.tabs[key]}</span>
                            {badge > 0 ? <span className="chat-tab-badge">{badge}</span> : null}
                        </button>
                    ))}
                </div>

                {activeTab === 'dialogs' ? (
                    <DialogsPanel
                        dialogs={dialogs}
                        friends={friends}
                        locale={locale}
                        strings={dialogsStrings}
                        onOpenRoom={actions.handleOpenRoom}
                        onOpenDirectRoom={actions.handleOpenDirectRoom}
                        onBlockUser={(userId) => void actions.handleBlockUser(userId)}
                        onUnblockUser={(userId) => void actions.handleUnblockUser(userId)}
                        onSubmitRoomMessage={() => void actions.handleSubmitRoomMessage()}
                        onOpenAddFriend={() => setAddFriendOpen(true)}
                        onOpenFriendRequests={() => setFriendRequestsOpen(true)}
                        roomThreadEndRef={roomListEndRef}
                    />
                ) : null}

                {activeTab === 'global' ? (
                    <GlobalPanel
                        globalChat={globalChatForView}
                        muteSummary={muteSummary}
                        locale={locale}
                        onSubmitGlobalMessage={() => void actions.handleSubmitGlobal()}
                        onMuteUser={(userId, dur, reason) => void actions.handleMuteUser(userId, dur, reason)}
                        onUnmuteUser={(userId) => void actions.handleUnmuteUser(userId)}
                        threadEndRef={globalListEndRef}
                        reactionsBridge={globalReactionsBridge}
                        currentUserId={userId || undefined}
                        socialBeta={socialBeta}
                        onSubmitGlobalMessageBeta={wrappedSubmitBetaWithEntityId}
                        onUploadAttachment={handleUploadAttachment}
                        pinBridge={globalPinBridge}
                        lastPresenceEvent={lastGlobalPresenceEvent}
                        lastTypingEvent={lastGlobalTypingEvent}
                    />
                ) : null}
            </PageMain>

            <FriendRequestsSheet
                open={friendRequestsOpen}
                onClose={() => setFriendRequestsOpen(false)}
                friends={friends}
                onRespondFriendRequest={(id, decision) => void actions.handleRespondFriendRequest(id, decision)}
            />
            <AddFriendSheet
                open={addFriendOpen}
                onClose={() => setAddFriendOpen(false)}
                friends={friends}
            />
        </PageShell>
    );
}
