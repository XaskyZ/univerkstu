'use client';

import { useCallback, useMemo, useState } from 'react';
import {
    createChatRoomMessage,
    editChatRoomMessage,
    getChatRoomDetail,
    getDialogRooms,
    markChatRoomRead,
    type ChatMessageView,
    type ChatReplyPreview,
    type ChatRoomDetail,
    type ChatRoomListItem,
} from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { DEFAULT_MAX_MESSAGE_LENGTH } from '../types';
import { buildDirectRoomId } from '../utils/helpers';

export function useDialogs(requestedRoomId: string, userId: string | null) {
    const { messages } = useLanguage();
    const [rooms, setRooms] = useState<ChatRoomListItem[]>([]);
    const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
    const [roomDetail, setRoomDetail] = useState<ChatRoomDetail | null>(null);
    const [roomsLoading, setRoomsLoading] = useState(true);
    const [roomLoading, setRoomLoading] = useState(false);
    const [dialogError, setDialogError] = useState<string | null>(null);
    const [roomError, setRoomError] = useState<string | null>(null);
    const [roomBusy, setRoomBusy] = useState(false);
    const [composerValue, setComposerValue] = useState('');
    const [replyTarget, setReplyTarget] = useState<ChatReplyPreview | null>(null);
    const [editingMessage, setEditingMessage] = useState<ChatMessageView | null>(null);
    const [maxMessageLength, setMaxMessageLength] = useState(DEFAULT_MAX_MESSAGE_LENGTH);

    const selectedRoom = useMemo(
        () => rooms.find((room) => room.roomId === selectedRoomId) || null,
        [rooms, selectedRoomId]
    );
    const activeRoom = useMemo(() => {
        if (roomDetail?.room?.roomId === selectedRoomId) return roomDetail.room;
        return selectedRoom;
    }, [roomDetail, selectedRoom, selectedRoomId]);
    const totalUnreadRooms = useMemo(
        () => rooms.reduce((sum, room) => sum + room.unreadCount, 0),
        [rooms]
    );

    const loadRooms = useCallback(async (showLoader = false) => {
        if (showLoader) setRoomsLoading(true);
        const result = await getDialogRooms();
        if (result.success && result.data) {
            const next = result.data.rooms || [];
            setRooms(next);
            setMaxMessageLength(result.data.maxMessageLength || DEFAULT_MAX_MESSAGE_LENGTH);
            setDialogError(null);
            setSelectedRoomId((current) => {
                // Honor a requested room even when it isn't in the list yet — a
                // fresh `direct:` DM (e.g. deep-linked from a board announcement
                // or a friend card) has no history, so it's absent from the room
                // list but is still a valid, openable conversation.
                if (requestedRoomId && (next.some((room) => room.roomId === requestedRoomId) || requestedRoomId.startsWith('direct:'))) {
                    return requestedRoomId;
                }
                return current && next.some((room) => room.roomId === current) ? current : next[0]?.roomId || null;
            });
        } else {
            setDialogError(result.error || 'Не удалось загрузить диалоги');
        }
        if (showLoader) setRoomsLoading(false);
    }, [requestedRoomId]);

    const loadRoomDetail = useCallback(async (roomId: string, showLoader = false) => {
        if (showLoader) setRoomLoading(true);
        const result = await getChatRoomDetail(roomId, 100);
        if (result.success && result.data) {
            setRoomDetail(result.data);
            setRoomError(null);
            if (result.data.room.unreadCount > 0) {
                void markChatRoomRead(roomId).then(() => loadRooms(false));
            }
        } else {
            setRoomDetail(null);
            setRoomError(result.error || 'Не удалось загрузить сообщения');
        }
        if (showLoader) setRoomLoading(false);
    }, [loadRooms]);

    const openRoom = useCallback((roomId: string) => {
        setSelectedRoomId(roomId);
        setReplyTarget(null);
        setEditingMessage(null);
        setComposerValue('');
        setRoomError(null);
    }, []);

    const openDirectRoom = useCallback((targetUserId: string, roomId?: string | null) => {
        if (!userId || !targetUserId || userId === targetUserId) return;
        const nextRoomId = roomId || buildDirectRoomId(userId, targetUserId);
        setSelectedRoomId(nextRoomId);
        setRoomDetail(null);
        setReplyTarget(null);
        setEditingMessage(null);
        setComposerValue('');
        setRoomError(null);
    }, [userId]);

    const replyToMessage = useCallback((message: ChatMessageView) => {
        setEditingMessage(null);
        setReplyTarget({
            id: message.id,
            authorUserId: message.authorUserId,
            authorLabel: message.authorLabel,
            body: message.body,
        });
    }, []);

    const editMessage = useCallback((message: ChatMessageView) => {
        setReplyTarget(null);
        setEditingMessage(message);
        setComposerValue(message.body);
    }, []);

    const cancelComposeMode = useCallback(() => {
        setReplyTarget(null);
        setEditingMessage(null);
        setComposerValue('');
        setRoomError(null);
    }, []);

    const submitMessage = useCallback(async (onAfterSend?: () => Promise<void> | void) => {
        const trimmed = composerValue.trim();
        if (!selectedRoomId || !trimmed || roomBusy) return;
        if (trimmed.length > maxMessageLength) {
            setRoomError('Сообщение слишком длинное');
            return;
        }

        // Snapshot current compose state (for restore on failure)
        const wasEditing = editingMessage;
        const wasReplyTarget = replyTarget;
        const composerSnapshot = composerValue;

        // Clear UI immediately for snappy feel
        setComposerValue('');
        setReplyTarget(null);
        setEditingMessage(null);
        setRoomError(null);
        setRoomBusy(true);

        // Optimistic insert: only for new messages, not edits
        const optimisticId = wasEditing ? null : `__pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (optimisticId) {
            setRoomDetail((current) => {
                if (!current) return current;
                const optimistic: ChatMessageView = {
                    id: optimisticId,
                    roomId: current.room.roomId,
                    roomKind: current.room.kind,
                    authorUserId: userId || '__me',
                    authorLabel: '',
                    body: trimmed,
                    createdAt: new Date().toISOString(),
                    editedAt: null,
                    isOwn: true,
                    replyTo: wasReplyTarget,
                };
                return {
                    ...current,
                    messages: [...current.messages, optimistic],
                };
            });
        }

        const result = wasEditing
            ? await editChatRoomMessage(wasEditing.id, trimmed)
            : await createChatRoomMessage(selectedRoomId, { body: trimmed, replyToMessageId: wasReplyTarget?.id || null });

        if (result.success) {
            await Promise.all([loadRoomDetail(selectedRoomId, false), loadRooms(false)]);
            if (onAfterSend) await onAfterSend();
        } else {
            // Roll back: remove optimistic message + restore composer state
            if (optimisticId) {
                setRoomDetail((current) => current ? {
                    ...current,
                    messages: current.messages.filter((m) => m.id !== optimisticId),
                } : current);
            }
            setComposerValue(composerSnapshot);
            setReplyTarget(wasReplyTarget);
            setEditingMessage(wasEditing);
            if (result.statusCode === 429) {
                setRoomError(messages.globalChat.cooldown);
            } else {
                setRoomError(result.error || (wasEditing ? 'Не удалось сохранить правки' : 'Не удалось отправить сообщение'));
            }
        }
        setRoomBusy(false);
    }, [composerValue, editingMessage, loadRoomDetail, loadRooms, maxMessageLength, messages.globalChat.cooldown, replyTarget, roomBusy, selectedRoomId, userId]);

    const clearSelectedRoom = useCallback(() => {
        setSelectedRoomId(null);
        setRoomDetail(null);
    }, []);

    return {
        rooms,
        selectedRoom,
        activeRoom,
        selectedRoomId,
        setSelectedRoomId,
        roomDetail,
        roomsLoading,
        roomLoading,
        dialogError,
        roomError,
        roomBusy,
        composerValue,
        setComposerValue,
        replyTarget,
        editingMessage,
        maxMessageLength,
        totalUnreadRooms,
        loadRooms,
        loadRoomDetail,
        openRoom,
        openDirectRoom,
        replyToMessage,
        editMessage,
        cancelComposeMode,
        submitMessage,
        clearSelectedRoom,
        setRoomDetail,
    };
}

export type UseDialogsReturn = ReturnType<typeof useDialogs>;
