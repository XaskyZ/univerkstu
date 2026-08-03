'use client';

import '../board.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, AtSign, CalendarDays, Eye, Flag, Heart, MapPin, Megaphone, MessageCircle, Pencil, Phone, Pin, PinOff, Send, Share2, ThumbsUp, Trash2, User } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { buildDirectRoomId } from '@/app/chat/utils/helpers';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { toast } from '@/lib/toast';
import { confirmDialog } from '@/lib/confirm-dialog';
import { API_URL } from '@/lib/api/core';
import { PageShell } from '@/components/PageShell';
import ReactionsBar from '@/app/group/components/ReactionsBar';
import CommentsThread from '@/components/CommentsThread';
import ImageLightbox from '@/components/ImageLightbox';
import UserProfileSheet from '@/components/UserProfileSheet';
import { buildLightboxItems, type LightboxItem } from '@/components/lightbox-helpers';
import {
    deleteBoardAnnouncement,
    getBoardAnnouncement,
    pinBoardAnnouncement,
    setBoardAnnouncementFavorite,
    updateBoardAnnouncement,
    type BoardAnnouncement,
    type BoardCategory,
    type BoardStatus,
} from '@/lib/api/board';
import { getSocialAttachments, toggleSocialReaction } from '@/lib/api/social';
import { AnnouncementComposer } from '../components/AnnouncementComposer';
import { SocialReportSheet } from '@/components/SocialReportSheet';
import { authorInitials, CATEGORY_ICON, categoryColor, categoryLabel } from '../categories';
import { buildInstagramHref, buildPhoneHref, buildTelegramHref } from '../contact-links';

type Phase = 'loading' | 'notfound' | 'error' | 'ready';
const STATUS_LABEL: Record<BoardStatus, string> = {
    active: 'Активно',
    closed: 'Закрыто',
    sold: 'Продано',
    found: 'Найдено',
    archived: 'Архив',
};
function getStatusActions(category: BoardCategory): BoardStatus[] {
    switch (category) {
        case 'sale':
        case 'buy':
            return ['active', 'sold', 'closed', 'archived'];
        case 'lost_found':
            return ['active', 'found', 'closed', 'archived'];
        case 'event':
        case 'service':
        case 'help':
            return ['active', 'closed', 'archived'];
        default:
            return ['active', 'closed', 'archived'];
    }
}
function getStatusLabel(status: BoardStatus, category: BoardCategory): string {
    if (status === 'sold' && category === 'buy') return 'Куплено';
    if (status === 'found' && category === 'lost_found') return 'Решено';
    return STATUS_LABEL[status] ?? status;
}
const DEAL_TYPE_LABEL: Record<string, string> = {
    product: 'Товар',
    service: 'Услуга',
    other: 'Другое',
};
const LOST_FOUND_LABEL: Record<string, string> = {
    lost: 'Потерял',
    found: 'Нашёл',
};

export default function BoardDetailPage() {
    const params = useParams<{ id: string }>();
    const router = useRouter();
    const { isAuth, loading: authLoading, userId } = useAuth();
    const { messages, language } = useLanguage();
    const ui = messages.board;

    const announcementId = useMemo(() => {
        const raw = params?.id;
        const value = Array.isArray(raw) ? raw[0] : raw;
        if (!value) return '';
        try { return decodeURIComponent(value); } catch { return value; }
    }, [params]);

    const [phase, setPhase] = useState<Phase>('loading');
    const [announcement, setAnnouncement] = useState<BoardAnnouncement | null>(null);
    const [canModerate, setCanModerate] = useState(false);
    const [images, setImages] = useState<LightboxItem[]>([]);
    const [mainIndex, setMainIndex] = useState(0);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
    const [composerOpen, setComposerOpen] = useState(false);
    const [reportOpen, setReportOpen] = useState(false);

    useEffect(() => {
        if (!authLoading && !isAuth) router.push('/');
    }, [authLoading, isAuth, router]);

    const loadImages = useCallback(async (entityId: string) => {
        const att = await getSocialAttachments(entityId);
        if (att.success && att.data) {
            setImages(buildLightboxItems(att.data.attachments, API_URL));
            setMainIndex(0);
        }
    }, []);

    const load = useCallback(async () => {
        if (!announcementId) return;
        const res = await getBoardAnnouncement(announcementId);
        if (!res.success || !res.data) {
            setPhase(res.statusCode === 404 || res.errorCode === 'BOARD_NOT_FOUND' ? 'notfound' : 'error');
            return;
        }
        setAnnouncement(res.data.announcement);
        setCanModerate(res.data.canModerate === true);
        setPhase('ready');
        await loadImages(res.data.announcement.entity.id);
    }, [announcementId, loadImages]);

    useEffect(() => {
        if (authLoading || !isAuth || !announcementId) return;
        const timer = window.setTimeout(() => { void load(); }, 0);
        return () => window.clearTimeout(timer);
    }, [authLoading, isAuth, announcementId, load]);

    const handleToggleReaction = useCallback(async (emoji: string) => {
        if (!announcement) return;
        const result = await toggleSocialReaction(announcement.entity.id, emoji);
        if (result.success && result.data) {
            const data = result.data;
            setAnnouncement((prev) => (prev ? { ...prev, reactions: data.reactions, myReactions: data.mine } : prev));
            return;
        }
        throw new Error(result.error || 'reaction failed');
    }, [announcement]);

    const handleDelete = useCallback(async () => {
        if (!announcement) return;
        const ok = await confirmDialog(ui.deleteConfirm, { danger: true });
        if (!ok) return;
        const result = await deleteBoardAnnouncement(announcement.entity.id);
        if (result.success) {
            toast.success(ui.deleted);
            router.push('/board');
        } else {
            toast.error(result.error || ui.deleteFailed);
        }
    }, [announcement, ui, router]);

    const handlePin = useCallback(async () => {
        if (!announcement) return;
        const result = await pinBoardAnnouncement(announcement.entity.id, !announcement.isPinned);
        if (result.success) {
            setAnnouncement((prev) => (prev ? { ...prev, isPinned: !prev.isPinned, entity: { ...prev.entity, pinned: !prev.isPinned } } : prev));
        } else {
            toast.error(result.error || ui.errorTitle);
        }
    }, [announcement, ui.errorTitle]);

    const handleFavorite = useCallback(async () => {
        if (!announcement) return;
        const previous = announcement;
        const next = !announcement.isFavorite;
        setAnnouncement({
            ...announcement,
            isFavorite: next,
            favoriteCount: Math.max(0, announcement.favoriteCount + (next ? 1 : -1)),
        });
        const result = await setBoardAnnouncementFavorite(announcement.entity.id, next);
        if (!result.success || !result.data) {
            setAnnouncement(previous);
            toast.error(result.error || 'Не удалось обновить избранное');
            return;
        }
        setAnnouncement((prev) => (prev ? {
            ...prev,
            isFavorite: result.data!.isFavorite,
            favoriteCount: result.data!.favoriteCount,
        } : prev));
    }, [announcement]);

    const handleStatus = useCallback(async (status: BoardStatus) => {
        if (!announcement || announcement.entity.payload.status === status) return;
        const result = await updateBoardAnnouncement(announcement.entity.id, { status });
        if (!result.success || !result.data) {
            toast.error(result.error || ui.createFailed);
            return;
        }
        setAnnouncement(result.data.announcement);
    }, [announcement, ui.createFailed]);

    const handleShare = useCallback(async () => {
        if (!announcement || typeof window === 'undefined') return;
        const url = `${window.location.origin}/board/${announcement.entity.id}`;
        const payload = { url, title: announcement.entity.payload.title, text: announcement.entity.payload.title };
        const nav = window.navigator;
        if (typeof nav?.share === 'function' && (typeof nav.canShare !== 'function' || nav.canShare(payload))) {
            try { await nav.share(payload); return; } catch (error) { if ((error as DOMException)?.name === 'AbortError') return; }
        }
        try { await nav.clipboard.writeText(url); toast.success(messages.share.copied); }
        catch { toast.error(messages.share.copyFailed); }
    }, [announcement, messages.share.copied, messages.share.copyFailed]);

    if (authLoading || !isAuth) return null;

    if (phase !== 'ready' || !announcement) {
        return (
            <PageShell>
                <div className="board-detail-main">
                    <div className="board-detail-top">
                        <button type="button" className="board-detail-back" onClick={() => router.push('/board')} aria-label={messages.common.back}>
                            <ArrowLeft size={20} strokeWidth={2} aria-hidden />
                        </button>
                    </div>
                    <div className={`board-state ${phase === 'error' ? 'board-state-error' : ''}`}>
                        <div className="board-state-title">
                            {phase === 'loading' ? ui.loading : phase === 'notfound' ? ui.noResults : ui.errorTitle}
                        </div>
                    </div>
                </div>
            </PageShell>
        );
    }

    const { entity, isPinned } = announcement;
    const category = (entity.payload.category as BoardCategory | undefined) ?? 'other';
    const color = categoryColor(category);
    const CatIcon = CATEGORY_ICON[category] ?? Megaphone;
    const isOwner = userId != null && entity.authorUserId === userId;
    const showEdit = isOwner || canModerate;
    const showDelete = isOwner || canModerate;
    const showPin = canModerate;
    const showReport = !isOwner && !canModerate;
    const author = announcement.authorLabel || entity.authorUserId;
    const reactionCount = announcement.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
    const payloadStatus = entity.payload.status ?? 'active';
    const dealType = entity.payload.dealType ?? 'product';
    const expiresAt = entity.payload.expiresAt
        ? new Date(entity.payload.expiresAt).toLocaleDateString(localeTag(language), { day: '2-digit', month: 'long' })
        : null;
    const eventAt = entity.payload.eventAt
        ? new Date(entity.payload.eventAt).toLocaleDateString(localeTag(language), { day: '2-digit', month: 'long' })
        : null;
    const statusActions = getStatusActions(category);
    const time = new Date(entity.createdAt).toLocaleString(localeTag(language), {
        day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit',
    });
    const telegramHref = buildTelegramHref(entity.payload.contactTelegram);
    const instagramHref = buildInstagramHref(entity.payload.contactInstagram);
    const phoneHref = buildPhoneHref(entity.payload.contactPhone);

    return (
        <PageShell>
            <div className="board-detail-main" style={{ '--cat': color } as React.CSSProperties}>
                <div className="board-detail-top">
                    <button type="button" className="board-detail-back" onClick={() => router.push('/board')} aria-label={messages.common.back}>
                        <ArrowLeft size={20} strokeWidth={2} aria-hidden />
                    </button>
                    <div className="board-detail-top-actions">
                        <button type="button" className="board-action-btn" onClick={() => void handleShare()} aria-label={messages.share.shareEntity} title={messages.share.shareEntity}>
                            <Share2 size={18} strokeWidth={2} aria-hidden />
                        </button>
                        <button type="button" className="board-action-btn" data-active={announcement.isFavorite ? 'true' : 'false'} onClick={() => void handleFavorite()} aria-label="Избранное" title="Избранное">
                            <Heart size={18} strokeWidth={2} aria-hidden />
                        </button>
                        {showPin ? (
                            <button type="button" className="board-action-btn" data-active={isPinned ? 'true' : 'false'} onClick={() => void handlePin()} aria-label={isPinned ? ui.unpin : ui.pin} title={isPinned ? ui.unpin : ui.pin}>
                                {isPinned ? <PinOff size={18} strokeWidth={2} aria-hidden /> : <Pin size={18} strokeWidth={2} aria-hidden />}
                            </button>
                        ) : null}
                        {showEdit ? (
                            <button type="button" className="board-action-btn" onClick={() => setComposerOpen(true)} aria-label={ui.edit} title={ui.edit}>
                                <Pencil size={18} strokeWidth={2} aria-hidden />
                            </button>
                        ) : null}
                        {showDelete ? (
                            <button type="button" className="board-action-btn" data-danger="true" onClick={() => void handleDelete()} aria-label={ui.delete} title={ui.delete}>
                                <Trash2 size={18} strokeWidth={2} aria-hidden />
                            </button>
                        ) : null}
                        {showReport ? (
                            <button type="button" className="board-action-btn" onClick={() => setReportOpen(true)} aria-label={ui.report} title={ui.report}>
                                <Flag size={18} strokeWidth={2} aria-hidden />
                            </button>
                        ) : null}
                    </div>
                </div>

                {images.length > 0 ? (
                    <div className="board-gallery">
                        <div className="board-gallery-main" onClick={() => setLightboxIndex(mainIndex)}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={images[mainIndex]?.downloadUrl} alt={images[mainIndex]?.filename ?? ''} />
                        </div>
                        {images.length > 1 ? (
                            <div className="board-gallery-thumbs">
                                {images.map((img, i) => (
                                    <button key={img.attachmentId} type="button" className="board-gallery-thumb" data-active={i === mainIndex ? 'true' : 'false'} onClick={() => setMainIndex(i)} aria-label={`${i + 1}`}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={img.downloadUrl} alt="" />
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                <div className="board-panel">
                    <div className="board-detail-pills">
                        <span className="board-cat-pill"><CatIcon className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden />{categoryLabel(messages, category)}</span>
                        <span className="board-info-badge">{DEAL_TYPE_LABEL[dealType] ?? 'Товар'}</span>
                        <span className="board-status-badge" data-status={payloadStatus}>{getStatusLabel(payloadStatus, category)}</span>
                        {isPinned ? <span className="board-pin-badge"><Pin className="w-3 h-3" strokeWidth={2.2} aria-hidden />{ui.pinnedBadge}</span> : null}
                    </div>
                    <h1 className="board-detail-title">{entity.payload.title}</h1>
                    <div className="board-detail-metrics">
                        <span aria-label={`Просмотры: ${announcement.viewCount}`} title={`Просмотры: ${announcement.viewCount}`}><Eye size={14} strokeWidth={2} aria-hidden />{announcement.viewCount}</span>
                        <span aria-label={`Реакции: ${reactionCount}`} title={`Реакции: ${reactionCount}`}><ThumbsUp size={14} strokeWidth={2} aria-hidden />{reactionCount}</span>
                        <span aria-label={`Комментарии: ${announcement.commentCount}`} title={`Комментарии: ${announcement.commentCount}`}><MessageCircle size={14} strokeWidth={2} aria-hidden />{announcement.commentCount}</span>
                        <span aria-label={`В избранном: ${announcement.favoriteCount}`} title={`В избранном: ${announcement.favoriteCount}`}><Heart size={14} strokeWidth={2} aria-hidden />{announcement.favoriteCount}</span>
                    </div>
                    <p className="board-detail-body">{entity.payload.body}</p>
                    {entity.payload.price || (dealType === 'product' && entity.payload.condition) || (dealType === 'service' && entity.payload.serviceFormat) || entity.payload.lostFoundType || eventAt || entity.payload.location || expiresAt ? (
                        <div className="board-detail-facts">
                            {entity.payload.price ? <span>{entity.payload.price}</span> : null}
                            {dealType === 'product' && entity.payload.condition ? <span>{entity.payload.condition}</span> : null}
                            {dealType === 'service' && entity.payload.serviceFormat ? <span>{entity.payload.serviceFormat}</span> : null}
                            {entity.payload.lostFoundType ? <span>{LOST_FOUND_LABEL[entity.payload.lostFoundType] ?? entity.payload.lostFoundType}</span> : null}
                            {eventAt ? <span><CalendarDays size={14} strokeWidth={2} aria-hidden />{eventAt}</span> : null}
                            {entity.payload.location ? <span><MapPin size={14} strokeWidth={2} aria-hidden />{entity.payload.location}</span> : null}
                            {expiresAt ? <span><CalendarDays size={14} strokeWidth={2} aria-hidden />до {expiresAt}</span> : null}
                        </div>
                    ) : null}
                    {showEdit ? (
                        <div className="board-status-actions">
                            {statusActions.map((statusKey) => (
                                <button
                                    key={statusKey}
                                    type="button"
                                    data-active={payloadStatus === statusKey ? 'true' : 'false'}
                                    onClick={() => void handleStatus(statusKey)}
                                >
                                    {getStatusLabel(statusKey, category)}
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>

                <div className="board-author-card">
                    <span className="board-avatar" aria-hidden>{authorInitials(author)}</span>
                    <div className="board-author-meta">
                        <div className="board-author-name">{author}</div>
                        <div className="board-author-sub" style={{ fontVariantNumeric: 'tabular-nums' }}>{time}</div>
                    </div>
                    {!isOwner ? (
                        <div className="board-author-actions">
                            <button
                                type="button"
                                className="board-contact-btn"
                                onClick={() => {
                                    if (!userId) return;
                                    router.push(`/chat?roomId=${encodeURIComponent(buildDirectRoomId(userId, entity.authorUserId))}`);
                                }}
                            >
                                <MessageCircle size={15} strokeWidth={2.2} aria-hidden />
                                {messages.friends.write}
                            </button>
                            <UserProfileSheet
                                targetUserId={entity.authorUserId}
                                label={author}
                                trigger={
                                    <span className="board-contact-btn-ghost">
                                        <User size={15} strokeWidth={2.2} aria-hidden />
                                        {messages.bottomNav.profile}
                                    </span>
                                }
                            />
                        </div>
                    ) : null}
                </div>

                {telegramHref || instagramHref || phoneHref ? (
                    <div className="board-panel">
                        <div className="board-contact-grid">
                            {telegramHref ? (
                                <a className="board-contact-link" href={telegramHref} target="_blank" rel="noreferrer">
                                    <Send size={16} strokeWidth={2} aria-hidden /> Telegram
                                </a>
                            ) : null}
                            {instagramHref ? (
                                <a className="board-contact-link" href={instagramHref} target="_blank" rel="noreferrer">
                                    <AtSign size={16} strokeWidth={2} aria-hidden /> Instagram
                                </a>
                            ) : null}
                            {phoneHref ? (
                                <a className="board-contact-link" href={phoneHref}>
                                    <Phone size={16} strokeWidth={2} aria-hidden /> {entity.payload.contactPhone}
                                </a>
                            ) : null}
                        </div>
                    </div>
                ) : null}

                <div className="board-panel">
                    <ReactionsBar reactions={announcement.reactions} mine={announcement.myReactions} onToggle={handleToggleReaction} />
                    <div style={{ marginTop: 14 }}>
                        <CommentsThread entityId={entity.id} currentUserId={userId ?? ''} initiallyOpen />
                    </div>
                </div>
            </div>

            <AnnouncementComposer
                open={composerOpen}
                mode="edit"
                initial={announcement}
                onClose={() => { setComposerOpen(false); void loadImages(entity.id); }}
                onSaved={(updated) => setAnnouncement(updated)}
            />

            <SocialReportSheet
                open={reportOpen}
                entityId={announcement.entity.id}
                title={ui.report}
                onClose={() => setReportOpen(false)}
                onSubmitted={() => setReportOpen(false)}
                onError={(message) => toast.error(message)}
            />

            {lightboxIndex !== null ? (
                <ImageLightbox items={images} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} />
            ) : null}
        </PageShell>
    );
}
