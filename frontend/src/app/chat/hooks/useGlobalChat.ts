'use client';

import { useCallback, useState } from 'react';
import {
    createGlobalChatMessage,
    deleteGlobalChatMessage,
    getGlobalChatMessages,
    getGlobalChatReports,
    muteGlobalChatUser,
    reportGlobalChatMessage,
    reviewGlobalChatReport,
    unmuteGlobalChatUser,
    type GlobalChatMessageView,
    type GlobalChatReportView,
    type GlobalChatViewerState,
} from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { confirmDialog } from '@/lib/confirm-dialog';
import { DEFAULT_MAX_MESSAGE_LENGTH, DEFAULT_VIEWER_STATE } from '../types';

export function useGlobalChat(userId: string | null) {
    const { messages } = useLanguage();
    const [chatMessages, setChatMessages] = useState<GlobalChatMessageView[]>([]);
    const [reports, setReports] = useState<GlobalChatReportView[]>([]);
    const [viewerState, setViewerState] = useState<GlobalChatViewerState>(DEFAULT_VIEWER_STATE);
    const [fetching, setFetching] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [moderationError, setModerationError] = useState<string | null>(null);
    const [composerValue, setComposerValue] = useState('');
    const [maxMessageLength, setMaxMessageLength] = useState(DEFAULT_MAX_MESSAGE_LENGTH);
    const [busyKey, setBusyKey] = useState<string | null>(null);

    const loadReports = useCallback(async () => {
        const result = await getGlobalChatReports('open', 60);
        if (result.success && result.data) {
            setReports(result.data.reports || []);
            setModerationError(null);
            return;
        }
        if (result.statusCode === 403) {
            setReports([]);
            return;
        }
        setModerationError(result.error || messages.globalChat.loadReportsFailed);
    }, [messages.globalChat.loadReportsFailed]);

    const load = useCallback(async (showLoader = false) => {
        if (showLoader) setFetching(true);
        const result = await getGlobalChatMessages(120);
        if (result.success && result.data) {
            setChatMessages(result.data.messages || []);
            setMaxMessageLength(result.data.maxMessageLength || DEFAULT_MAX_MESSAGE_LENGTH);
            setViewerState(result.data.viewer || DEFAULT_VIEWER_STATE);
            setError(null);
            if (result.data.viewer?.canModerate) await loadReports();
            else {
                setReports([]);
                setModerationError(null);
            }
        } else if (showLoader || chatMessages.length === 0) {
            setError(result.error || messages.globalChat.loadFailed);
        }
        if (showLoader) setFetching(false);
    }, [chatMessages.length, loadReports, messages.globalChat.loadFailed]);

    const submit = useCallback(async (muteSummary: string | null) => {
        const trimmed = composerValue.trim();
        if (!trimmed || sending) return;
        if (trimmed.length > maxMessageLength) {
            setError(messages.globalChat.tooLong);
            return;
        }
        if (viewerState.isMuted) {
            setError(muteSummary || messages.globalChat.mutedComposerBlocked);
            return;
        }

        const composerSnapshot = composerValue;
        setComposerValue('');
        setError(null);
        setSending(true);

        const optimisticId = `__pending_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const optimistic: GlobalChatMessageView = {
            id: optimisticId,
            authorUserId: userId || '__me',
            authorLabel: '…',
            body: trimmed,
            createdAt: new Date().toISOString(),
            isOwn: true,
            isPinned: false,
            pinnedAt: null,
            canDelete: true,
            isReportedByViewer: false,
            reportCount: 0,
        };
        setChatMessages((current) => [...current, optimistic]);

        const result = await createGlobalChatMessage(trimmed);
        if (result.success && result.data) {
            const real = result.data;
            setChatMessages((current) => {
                const withoutOptimistic = current.filter((item) => item.id !== optimisticId);
                if (withoutOptimistic.some((item) => item.id === real.id)) return withoutOptimistic;
                return [...withoutOptimistic, real];
            });
        } else {
            setChatMessages((current) => current.filter((item) => item.id !== optimisticId));
            setComposerValue(composerSnapshot);
            if (result.statusCode === 429) {
                setError(messages.globalChat.cooldown);
            } else {
                setError(result.error || messages.globalChat.sendFailed);
            }
        }
        setSending(false);
    }, [composerValue, maxMessageLength, messages.globalChat.cooldown, messages.globalChat.mutedComposerBlocked, messages.globalChat.sendFailed, messages.globalChat.tooLong, sending, userId, viewerState.isMuted]);

    const reportMessage = useCallback(async (message: GlobalChatMessageView, reason?: string) => {
        setBusyKey(`report:${message.id}`);
        const result = await reportGlobalChatMessage(message.id, { reason: (reason || '').trim() });
        if (result.success) {
            setChatMessages((current) => current.map((item) => item.id === message.id ? { ...item, isReportedByViewer: true, reportCount: item.reportCount + 1 } : item));
            setError(messages.globalChat.reportSent);
        } else {
            setError(result.error || messages.globalChat.reportFailed);
        }
        setBusyKey(null);
    }, [messages.globalChat.reportFailed, messages.globalChat.reportSent]);

    const deleteMessage = useCallback(async (messageId: string, reason?: string) => {
        if (!await confirmDialog(messages.globalChat.deleteConfirm)) return;
        setBusyKey(`delete:${messageId}`);
        const result = await deleteGlobalChatMessage(messageId, reason ? reason.trim() : null);
        if (result.success) await load(false);
        else setModerationError(result.error || messages.globalChat.deleteFailed);
        setBusyKey(null);
    }, [load, messages.globalChat.deleteConfirm, messages.globalChat.deleteFailed]);

    const muteUser = useCallback(async (userId: string, durationMinutes: number, reason?: string) => {
        setBusyKey(`mute:${userId}:${durationMinutes}`);
        const result = await muteGlobalChatUser(userId, { reason: reason ? reason.trim() : null, durationMinutes });
        if (result.success) {
            setModerationError(null);
            await load(false);
        } else {
            setModerationError(result.error || messages.globalChat.muteFailed);
        }
        setBusyKey(null);
        return result.success;
    }, [load, messages.globalChat.muteFailed]);

    const unmuteUser = useCallback(async (userId: string) => {
        setBusyKey(`unmute:${userId}`);
        const result = await unmuteGlobalChatUser(userId);
        if (result.success) {
            setModerationError(null);
            await load(false);
        } else {
            setModerationError(result.error || messages.globalChat.unmuteFailed);
        }
        setBusyKey(null);
        return result.success;
    }, [load, messages.globalChat.unmuteFailed]);

    const dismissReport = useCallback(async (reportId: string, resolutionNote?: string) => {
        setBusyKey(`dismiss:${reportId}`);
        const result = await reviewGlobalChatReport(reportId, { status: 'dismissed', resolutionNote: resolutionNote ? resolutionNote.trim() : null });
        if (result.success) await load(false);
        else setModerationError(result.error || messages.globalChat.dismissFailed);
        setBusyKey(null);
    }, [load, messages.globalChat.dismissFailed]);

    return {
        chatMessages,
        reports,
        viewerState,
        fetching,
        sending,
        error,
        moderationError,
        composerValue,
        setComposerValue,
        maxMessageLength,
        busyKey,
        load,
        submit,
        reportMessage,
        deleteMessage,
        muteUser,
        unmuteUser,
        dismissReport,
        setError,
        setModerationError,
    };
}

export type UseGlobalChatReturn = ReturnType<typeof useGlobalChat>;
