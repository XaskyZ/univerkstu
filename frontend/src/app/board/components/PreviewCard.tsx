'use client';

import { Eye, Heart, MapPin, Megaphone, MessageCircle, Pencil, Pin, PinOff, ThumbsUp, Trash2 } from 'lucide-react';
import { API_URL } from '@/lib/api/core';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import type { BoardAnnouncement, BoardCategory } from '@/lib/api/board';
import { authorInitials, CATEGORY_ICON, categoryColor, categoryLabel } from '../categories';

interface PreviewCardProps {
    announcement: BoardAnnouncement;
    onOpen: (announcement: BoardAnnouncement) => void;
    selected?: boolean;
    onPreview?: (announcement: BoardAnnouncement) => void;
    canModerate?: boolean;
    onPin?: (announcement: BoardAnnouncement) => void;
    onEdit?: (announcement: BoardAnnouncement) => void;
    onDelete?: (announcement: BoardAnnouncement) => void;
    onFavorite?: (announcement: BoardAnnouncement) => void;
}

export function PreviewCard({
    announcement,
    onOpen,
    selected = false,
    onPreview,
    canModerate = false,
    onPin,
    onEdit,
    onDelete,
    onFavorite,
}: PreviewCardProps) {
    const { messages, language } = useLanguage();
    const { entity, isPinned } = announcement;
    const category = (entity.payload.category as BoardCategory | undefined) ?? 'other';
    const color = categoryColor(category);
    const CatIcon = CATEGORY_ICON[category] ?? Megaphone;
    const author = announcement.authorLabel || entity.authorUserId;
    const coverUrl = announcement.coverFileId
        ? `${API_URL}/api/v3/files/${encodeURIComponent(announcement.coverFileId)}`
        : null;
    const reactionCount = announcement.reactions.reduce((sum, r) => sum + r.count, 0);
    const status = entity.payload.status ?? 'active';
    const dealType = entity.payload.dealType ?? 'product';
    const time = new Date(entity.createdAt).toLocaleDateString(localeTag(language), { day: '2-digit', month: 'short' });
    const eventDate = entity.payload.eventAt
        ? new Date(entity.payload.eventAt).toLocaleDateString(localeTag(language), { day: '2-digit', month: 'short' })
        : null;

    return (
        <article
            className="board-tile"
            data-selected={selected ? 'true' : 'false'}
            style={{ '--cat': color } as React.CSSProperties}
            onFocus={() => onPreview?.(announcement)}
            onMouseEnter={() => onPreview?.(announcement)}
        >
            <button type="button" className="board-tile-open" onClick={() => onOpen(announcement)}>
                <div
                    className="board-tile-cover"
                    style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined}
                >
                    {!coverUrl ? <CatIcon className="board-tile-cover-icon" size={34} strokeWidth={1.6} aria-hidden /> : null}
                    <span className="board-tile-cat">
                        <CatIcon size={12} strokeWidth={2.4} aria-hidden />
                        {categoryLabel(messages, category)}
                    </span>
                    {isPinned ? (
                        <span className="board-tile-pin" aria-label={messages.board.pinnedBadge} title={messages.board.pinnedBadge}>
                            <Pin size={13} strokeWidth={2.2} aria-hidden />
                        </span>
                    ) : null}
                </div>
                <div className="board-tile-body">
                    <div className="board-tile-title">{entity.payload.title}</div>
                    <div className="board-tile-badges">
                        <span className="board-info-badge">{DEAL_TYPE_LABEL[dealType] ?? 'Товар'}</span>
                        <span className="board-status-badge" data-status={status}>{getStatusLabel(status, category)}</span>
                        {entity.payload.price ? <span className="board-info-badge">{entity.payload.price}</span> : null}
                        {dealType === 'service' && entity.payload.serviceFormat ? <span className="board-info-badge">{entity.payload.serviceFormat}</span> : null}
                        {category === 'lost_found' && entity.payload.lostFoundType ? <span className="board-info-badge">{LOST_FOUND_LABEL[entity.payload.lostFoundType] ?? entity.payload.lostFoundType}</span> : null}
                        {eventDate ? <span className="board-info-badge">{eventDate}</span> : null}
                        {entity.payload.location ? (
                            <span className="board-info-badge"><MapPin size={11} strokeWidth={2} aria-hidden />{entity.payload.location}</span>
                        ) : null}
                    </div>
                    <div className="board-tile-meta">
                        <span className="board-tile-avatar" aria-hidden>{authorInitials(author)}</span>
                        <span className="board-tile-author">{author}</span>
                        <span aria-hidden>Â·</span>
                        <span style={{ flexShrink: 0 }}>{time}</span>
                    </div>
                    <div className="board-tile-counts">
                        <span className="board-tile-count" aria-label={`Просмотры: ${announcement.viewCount}`} title={`Просмотры: ${announcement.viewCount}`}><Eye size={12} strokeWidth={2} aria-hidden />{announcement.viewCount}</span>
                        <span className="board-tile-count" aria-label={`Реакции: ${reactionCount}`} title={`Реакции: ${reactionCount}`}><ThumbsUp size={12} strokeWidth={2} aria-hidden />{reactionCount}</span>
                        <span className="board-tile-count" aria-label={`Комментарии: ${announcement.commentCount}`} title={`Комментарии: ${announcement.commentCount}`}><MessageCircle size={12} strokeWidth={2} aria-hidden />{announcement.commentCount}</span>
                        <span className="board-tile-count" aria-label={`В избранном: ${announcement.favoriteCount}`} title={`В избранном: ${announcement.favoriteCount}`}><Heart size={12} strokeWidth={2} aria-hidden />{announcement.favoriteCount}</span>
                    </div>
                </div>
            </button>
            <button
                type="button"
                className="board-tile-favorite"
                data-active={announcement.isFavorite ? 'true' : 'false'}
                onClick={() => onFavorite?.(announcement)}
                aria-label={announcement.isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
                title={announcement.isFavorite ? 'Убрать из избранного' : 'Добавить в избранное'}
            >
                <Heart size={15} strokeWidth={2.25} aria-hidden />
            </button>
            {canModerate ? (
                <div className="board-tile-admin-actions" aria-label="Moderation actions">
                    <button type="button" onClick={() => onPin?.(announcement)} aria-label={isPinned ? messages.board.unpin : messages.board.pin} title={isPinned ? messages.board.unpin : messages.board.pin}>
                        {isPinned ? <PinOff size={13} strokeWidth={2.2} aria-hidden /> : <Pin size={13} strokeWidth={2.2} aria-hidden />}
                    </button>
                    <button type="button" onClick={() => onEdit?.(announcement)} aria-label={messages.board.edit} title={messages.board.edit}>
                        <Pencil size={13} strokeWidth={2.2} aria-hidden />
                    </button>
                    <button type="button" data-danger="true" onClick={() => onDelete?.(announcement)} aria-label={messages.board.delete} title={messages.board.delete}>
                        <Trash2 size={13} strokeWidth={2.2} aria-hidden />
                    </button>
                </div>
            ) : null}
        </article>
    );
}
const STATUS_LABEL: Record<string, string> = {
    active: 'Активно',
    closed: 'Закрыто',
    sold: 'Продано',
    found: 'Найдено',
    archived: 'Архив',
};
function getStatusLabel(status: string, category: BoardCategory): string {
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
