'use client';

import './board.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
    BarChart3,
    Clipboard,
    Eye,
    Image as ImageIcon,
    Info,
    Megaphone,
    MessageCircle,
    Pencil,
    Pin,
    PinOff,
    Plus,
    RefreshCw,
    Search,
    ShieldCheck,
    SlidersHorizontal,
    Trash2,
    X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { useSocialStream } from '@/lib/use-social-stream';
import { PageShell } from '@/components/PageShell';
import { confirmDialog } from '@/lib/confirm-dialog';
import { toast } from '@/lib/toast';
import {
    BOARD_CATEGORIES,
    BOARD_SORTS,
    BOARD_STATUSES,
    BOARD_SCOPE_KEY,
    clearBoardAnnouncements,
    deleteBoardAnnouncement,
    listBoardAnnouncements,
    pinBoardAnnouncement,
    setBoardAnnouncementFavorite,
    type BoardAnnouncement,
    type BoardCategory,
    type BoardSort,
    type BoardStatus,
} from '@/lib/api/board';
import { PreviewCard } from './components/PreviewCard';
import { AnnouncementComposer } from './components/AnnouncementComposer';
import { categoryColor, categoryLabel } from './categories';

const PAGE_SIZE = 30;
const STATUS_LABEL: Record<BoardStatus, string> = {
    active: 'Активные',
    closed: 'Закрытые',
    sold: 'Продано',
    found: 'Найдено',
    archived: 'Архив',
};
function getStatusLabel(status: BoardStatus, category: BoardCategory | 'all'): string {
    if (status === 'sold' && category === 'buy') return 'Куплено';
    if (status === 'found' && category === 'lost_found') return 'Решено';
    return STATUS_LABEL[status];
}

function getStatusOptions(category: BoardCategory | 'all'): readonly BoardStatus[] {
    switch (category) {
        case 'sale':
        case 'buy':
            return ['active', 'sold', 'closed', 'archived'];
        case 'lost_found':
            return ['active', 'found', 'closed', 'archived'];
        case 'event':
        case 'service':
        case 'help':
        case 'other':
            return ['active', 'closed', 'archived'];
        case 'all':
        default:
            return BOARD_STATUSES;
    }
}

function isStatusAllowed(status: BoardStatus | 'all', category: BoardCategory | 'all'): boolean {
    return status === 'all' || getStatusOptions(category).includes(status);
}

const SORT_LABEL: Record<BoardSort, string> = {
    newest: 'Новые',
    popular: 'Популярные',
    discussed: 'Обсуждаемые',
    views: 'Просмотры',
    favorites: 'Избранное',
};

export default function BoardPage() {
    const { isAuth, loading: authLoading } = useAuth();
    const { messages } = useLanguage();
    const ui = messages.board;
    const router = useRouter();

    const [items, setItems] = useState<BoardAnnouncement[]>([]);
    const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
    const [hasMore, setHasMore] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [composerOpen, setComposerOpen] = useState(false);
    const [editingAnnouncement, setEditingAnnouncement] = useState<BoardAnnouncement | null>(null);
    const [categoryFilter, setCategoryFilter] = useState<BoardCategory | 'all'>('all');
    const [favoriteOnly, setFavoriteOnly] = useState(false);
    const [mineOnly, setMineOnly] = useState(false);
    const [statusFilter, setStatusFilter] = useState<BoardStatus | 'all'>('all');
    const [sortMode, setSortMode] = useState<BoardSort>('newest');
    const [search, setSearch] = useState('');
    const [canModerate, setCanModerate] = useState(false);
    const [canSuperModerate, setCanSuperModerate] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [adminView, setAdminView] = useState<'all' | 'pinned' | 'media' | 'quiet'>('all');

    useEffect(() => {
        if (!authLoading && !isAuth) router.push('/');
    }, [authLoading, isAuth, router]);

    const statusOptions = useMemo(() => getStatusOptions(categoryFilter), [categoryFilter]);

    const fetchPage = useCallback(async (opts: { append: boolean; offset: number }) => {
        if (opts.append) setLoadingMore(true); else setStatus('loading');
        const result = await listBoardAnnouncements({
            limit: PAGE_SIZE,
            offset: opts.offset,
            favoriteOnly,
            mineOnly,
            q: search.trim() || undefined,
            category: categoryFilter === 'all' ? undefined : categoryFilter,
            status: statusFilter === 'all' ? undefined : statusFilter,
            sort: sortMode,
        });
        if (!result.success || !result.data) {
            if (!opts.append) setStatus('error');
            setLoadingMore(false);
            return;
        }
        const fetched = result.data.announcements;
        setItems((prev) => {
            if (!opts.append) return fetched;
            const seen = new Set(prev.map((item) => item.entity.id));
            return [...prev, ...fetched.filter((item) => {
                if (seen.has(item.entity.id)) return false;
                seen.add(item.entity.id);
                return true;
            })];
        });
        setCanModerate(result.data.canModerate === true);
        setCanSuperModerate(result.data.canSuperModerate === true);
        setHasMore(fetched.length >= PAGE_SIZE);
        setStatus('ready');
        setLoadingMore(false);
    }, [categoryFilter, favoriteOnly, mineOnly, search, sortMode, statusFilter]);

    useEffect(() => {
        if (!isAuth) return;
        const timer = window.setTimeout(() => {
            void fetchPage({ append: false, offset: 0 });
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isAuth, fetchPage]);

    // Live updates: refresh (debounced) when anyone posts to the board.
    const liveRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useSocialStream({
        scopes: [BOARD_SCOPE_KEY],
        enabled: isAuth === true,
        onEvent: (event) => {
            if (event.type !== 'entity-created') return;
            if (liveRefreshTimer.current !== null) clearTimeout(liveRefreshTimer.current);
            liveRefreshTimer.current = setTimeout(() => {
                liveRefreshTimer.current = null;
                void fetchPage({ append: false, offset: 0 });
            }, 600);
        },
    });

    const isFiltering = favoriteOnly || mineOnly || categoryFilter !== 'all' || statusFilter !== 'all' || adminView !== 'all' || search.trim().length > 0;
    const visible = useMemo(() => {
        return items.filter((a) => {
            if (adminView === 'pinned' && !a.isPinned) return false;
            if (adminView === 'media' && !a.coverFileId) return false;
            if (adminView === 'quiet' && (a.commentCount > 0 || a.reactions.length > 0)) return false;
            return true;
        });
    }, [items, adminView]);

    const stats = useMemo(() => {
        const categoryCounts = new Map<BoardCategory, number>();
        let pinned = 0;
        let withMedia = 0;
        let comments = 0;
        let reactions = 0;
        for (const item of items) {
            const category = ((item.entity.payload.category as BoardCategory | undefined) ?? 'other');
            categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
            if (item.isPinned) pinned += 1;
            if (item.coverFileId) withMedia += 1;
            comments += item.commentCount;
            reactions += item.reactions.reduce((sum, reaction) => sum + reaction.count, 0);
        }
        return { total: items.length, pinned, withMedia, comments, reactions, categoryCounts };
    }, [items]);

    const activeSelectedId = visible.some((item) => item.entity.id === selectedId)
        ? selectedId
        : visible[0]?.entity.id ?? null;
    const selectedAnnouncement = useMemo(
        () => items.find((item) => item.entity.id === activeSelectedId) ?? null,
        [activeSelectedId, items],
    );

    const handleSaved = useCallback((saved: BoardAnnouncement) => {
        // New post → open its detail page so the author can add photos / share.
        setItems((prev) => [saved, ...prev.filter((a) => a.entity.id !== saved.entity.id)]);
        router.push(`/board/${saved.entity.id}`);
    }, [router]);

    const openCreate = useCallback(() => setComposerOpen(true), []);
    const handleOpen = useCallback((a: BoardAnnouncement) => router.push(`/board/${a.entity.id}`), [router]);

    const handleCategoryFilter = useCallback((next: BoardCategory | 'all') => {
        setCategoryFilter(next);
        setStatusFilter((prev) => (isStatusAllowed(prev, next) ? prev : 'all'));
    }, []);

    const resetFilters = useCallback(() => {
        handleCategoryFilter('all');
        setFavoriteOnly(false);
        setMineOnly(false);
        setStatusFilter('all');
        setAdminView('all');
        setSearch('');
        setSortMode('newest');
    }, [handleCategoryFilter]);

    const refreshFirstPage = useCallback(() => {
        void fetchPage({ append: false, offset: 0 });
    }, [fetchPage]);

    const handlePin = useCallback(async (announcement: BoardAnnouncement) => {
        const pinned = !announcement.isPinned;
        const result = await pinBoardAnnouncement(announcement.entity.id, pinned);
        if (!result.success) {
            toast.error(result.error || ui.errorTitle);
            return;
        }
        setItems((prev) => prev.map((item) => (
            item.entity.id === announcement.entity.id
                ? { ...item, isPinned: pinned, entity: { ...item.entity, pinned } }
                : item
        )));
    }, [ui.errorTitle]);

    const handleDelete = useCallback(async (announcement: BoardAnnouncement) => {
        const ok = await confirmDialog(ui.deleteConfirm, { danger: true });
        if (!ok) return;
        const result = await deleteBoardAnnouncement(announcement.entity.id);
        if (!result.success) {
            toast.error(result.error || ui.deleteFailed);
            return;
        }
        setItems((prev) => prev.filter((item) => item.entity.id !== announcement.entity.id));
        toast.success(ui.deleted);
    }, [ui.deleteConfirm, ui.deleteFailed, ui.deleted]);

    const handleClearAll = useCallback(async () => {
        const ok = await confirmDialog(
            'Удалить все объявления во вкладке? Действие очистит всю ленту для всех пользователей.',
            { danger: true },
        );
        if (!ok) return;

        const result = await clearBoardAnnouncements();
        if (!result.success) {
            toast.error(result.error || 'Не удалось очистить объявления');
            return;
        }

        setItems([]);
        setSelectedId(null);
        toast.success(`Удалено объявлений: ${result.data?.deletedCount ?? 0}`);
    }, []);

    const handleShare = useCallback(async (announcement: BoardAnnouncement) => {
        if (typeof window === 'undefined') return;
        const url = `${window.location.origin}/board/${announcement.entity.id}`;
        try {
            await window.navigator.clipboard.writeText(url);
            toast.success(messages.share.copied);
        } catch {
            toast.error(messages.share.copyFailed);
        }
    }, [messages.share.copied, messages.share.copyFailed]);

    const handleFavorite = useCallback(async (announcement: BoardAnnouncement) => {
        const next = !announcement.isFavorite;
        setItems((prev) => prev.map((item) => item.entity.id === announcement.entity.id
            ? {
                ...item,
                isFavorite: next,
                favoriteCount: Math.max(0, item.favoriteCount + (next ? 1 : -1)),
            }
            : item));
        const result = await setBoardAnnouncementFavorite(announcement.entity.id, next);
        if (!result.success || !result.data) {
            setItems((prev) => prev.map((item) => item.entity.id === announcement.entity.id ? announcement : item));
            toast.error(result.error || 'Не удалось обновить избранное');
            return;
        }
        setItems((prev) => prev
            .map((item) => item.entity.id === announcement.entity.id
                ? { ...item, isFavorite: result.data!.isFavorite, favoriteCount: result.data!.favoriteCount }
                : item)
            .filter((item) => !favoriteOnly || item.isFavorite));
    }, [favoriteOnly]);

    const handleLoadMore = useCallback(() => {
        if (loadingMore) return;
        void fetchPage({ append: true, offset: items.length });
    }, [loadingMore, fetchPage, items.length]);

    if (authLoading || !isAuth) return null;

    return (
        <PageShell>
            <div className={canSuperModerate ? 'board-super-layout' : undefined}>
                {canSuperModerate ? (
                    <aside className="board-admin-rail board-admin-rail-left" aria-label="Super admin board controls">
                        <div className="board-admin-rail-head">
                            <ShieldCheck size={18} strokeWidth={2.2} aria-hidden />
                            <div>
                                <div className="board-admin-rail-title">Супер-админ</div>
                                <div className="board-admin-rail-sub">Управление вкладкой</div>
                            </div>
                        </div>
                        <div className="board-admin-stats">
                            <div><span>{stats.total}</span><small>всего</small></div>
                            <div><span>{stats.pinned}</span><small>закреплено</small></div>
                            <div><span>{stats.withMedia}</span><small>с фото</small></div>
                            <div><span>{stats.comments}</span><small>комментов</small></div>
                        </div>
                        <div className="board-admin-block">
                            <div className="board-admin-block-title"><SlidersHorizontal size={14} aria-hidden /> Режим ленты</div>
                            {[
                                ['all', 'Все объявления'],
                                ['pinned', 'Только закрепленные'],
                                ['media', 'С фотографиями'],
                                ['quiet', 'Без реакции'],
                            ].map(([key, label]) => (
                                <button
                                    key={key}
                                    type="button"
                                    className="board-admin-row-btn"
                                    data-active={adminView === key ? 'true' : 'false'}
                                    onClick={() => setAdminView(key as typeof adminView)}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <div className="board-admin-block">
                            <div className="board-admin-block-title"><BarChart3 size={14} aria-hidden /> Категории</div>
                            {BOARD_CATEGORIES.map((key) => (
                                <button
                                    key={key}
                                    type="button"
                                    className="board-admin-category-row"
                                    data-active={categoryFilter === key ? 'true' : 'false'}
                                    onClick={() => handleCategoryFilter(categoryFilter === key ? 'all' : key)}
                                >
                                    <span>{categoryLabel(messages, key)}</span>
                                    <strong>{stats.categoryCounts.get(key) ?? 0}</strong>
                                </button>
                            ))}
                        </div>
                        <button type="button" className="board-admin-wide-btn" onClick={refreshFirstPage}>
                            <RefreshCw size={15} strokeWidth={2.2} aria-hidden />
                            Обновить ленту
                        </button>
                        <button type="button" className="board-admin-wide-btn" onClick={() => router.push('/admin/social-moderation')}>
                            <ShieldCheck size={15} strokeWidth={2.2} aria-hidden />
                            Жалобы и модерация
                        </button>
                        <button type="button" className="board-admin-wide-btn" data-danger="true" onClick={() => void handleClearAll()} disabled={items.length === 0}>
                            <Trash2 size={15} strokeWidth={2.2} aria-hidden />
                            Очистить все
                        </button>
                    </aside>
                ) : null}

                <div className="board-main">
                <header className="board-hero">
                    <div className="board-hero-text">
                        <h1 className="board-hero-title">{ui.title}</h1>
                        <p className="board-hero-sub">{ui.subtitle}</p>
                    </div>
                    <button type="button" className="board-hero-btn" onClick={openCreate}>
                        <Plus className="w-4 h-4" strokeWidth={2.4} aria-hidden />
                        <span className="hidden sm:inline">{ui.create}</span>
                    </button>
                </header>

                {canModerate ? (
                    <div className="board-admin-strip">
                        <div className="board-admin-strip-icon"><ShieldCheck size={18} strokeWidth={2.2} aria-hidden /></div>
                        <div>
                            <div className="board-admin-strip-title">{canSuperModerate ? 'Полный режим модерации' : 'Режим модератора'}</div>
                            <div className="board-admin-strip-text">
                                Быстрые действия доступны в карточке справа и на странице объявления.
                            </div>
                        </div>
                        <button type="button" className="board-admin-strip-btn" onClick={refreshFirstPage}>
                            <RefreshCw size={15} strokeWidth={2.2} aria-hidden />
                        </button>
                    </div>
                ) : null}

                <div className="board-intro">
                    <Info className="board-intro-icon" size={20} strokeWidth={2} aria-hidden />
                    <div className="min-w-0">
                        <div className="board-intro-title">{ui.introTitle}</div>
                        <div className="board-intro-text">{ui.introText}</div>
                    </div>
                </div>

                <div className="board-toolbar">
                    <div className="board-search">
                        <Search size={18} strokeWidth={2} aria-hidden className="board-search-icon" />
                        <input
                            type="search"
                            className="board-search-input"
                            placeholder={ui.searchPlaceholder}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                        />
                        {search.length > 0 ? (
                            <button type="button" className="board-search-clear" onClick={() => setSearch('')} aria-label={ui.searchClear}>
                                <X size={16} strokeWidth={2} aria-hidden />
                            </button>
                        ) : null}
                    </div>
                    <select
                        className="board-select"
                        value={sortMode}
                        onChange={(event) => setSortMode(event.target.value as BoardSort)}
                        aria-label="Сортировка"
                    >
                        {BOARD_SORTS.map((key) => <option key={key} value={key}>{SORT_LABEL[key]}</option>)}
                    </select>
                </div>

                <div className="board-filters" role="group" aria-label={ui.fieldCategory}>
                    <button
                        type="button"
                        className="board-filter"
                        data-active={categoryFilter === 'all' && !favoriteOnly && !mineOnly && statusFilter === 'all' ? 'true' : 'false'}
                        onClick={() => {
                            handleCategoryFilter('all');
                            setFavoriteOnly(false);
                            setMineOnly(false);
                            setStatusFilter('all');
                        }}
                        style={{ '--cat': '#8b5cf6' } as React.CSSProperties}
                    >
                        {ui.filterAll}
                    </button>
                    <button
                        type="button"
                        className="board-filter"
                        data-active={mineOnly ? 'true' : 'false'}
                        onClick={() => setMineOnly((prev) => !prev)}
                        style={{ '--cat': '#14b8a6' } as React.CSSProperties}
                    >
                        Мои
                    </button>
                    <button
                        type="button"
                        className="board-filter"
                        data-active={favoriteOnly ? 'true' : 'false'}
                        onClick={() => setFavoriteOnly((prev) => !prev)}
                        style={{ '--cat': '#f43f5e' } as React.CSSProperties}
                    >
                        Избранные
                    </button>
                    {statusOptions.map((key) => (
                        <button
                            key={key}
                            type="button"
                            className="board-filter"
                            data-active={statusFilter === key ? 'true' : 'false'}
                            onClick={() => setStatusFilter(statusFilter === key ? 'all' : key)}
                            style={{ '--cat': '#64748b' } as React.CSSProperties}
                        >
                            {getStatusLabel(key, categoryFilter)}
                        </button>
                    ))}
                </div>

                <div className="board-filters" role="group" aria-label={ui.fieldCategory}>
                    {BOARD_CATEGORIES.map((key) => (
                        <button
                            key={key}
                            type="button"
                            className="board-filter"
                            data-active={categoryFilter === key ? 'true' : 'false'}
                            onClick={() => handleCategoryFilter(categoryFilter === key ? 'all' : key)}
                            style={{ '--cat': categoryColor(key) } as React.CSSProperties}
                        >
                            {categoryLabel(messages, key)}
                        </button>
                    ))}
                </div>

                {isFiltering || sortMode !== 'newest' ? (
                    <div className="board-filter-summary">
                        <span>Показано {visible.length} из {items.length}</span>
                        <button type="button" onClick={resetFilters}>
                            <X size={14} strokeWidth={2.2} aria-hidden />
                            Сбросить
                        </button>
                    </div>
                ) : null}

                {status === 'idle' || status === 'loading' ? (
                    <div className="board-grid">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                            <div key={i} className="board-skel-tile">
                                <div className="board-skel-shimmer" />
                                <div className="board-skel-tile-cover" />
                                <div className="board-skel-tile-body">
                                    <div className="board-skel-line" style={{ width: '85%' }} />
                                    <div className="board-skel-line" style={{ width: '55%', marginTop: 8, height: 10 }} />
                                </div>
                            </div>
                        ))}
                    </div>
                ) : status === 'error' ? (
                    <div className="board-state board-state-error">
                        <div className="board-state-icon"><Megaphone size={26} strokeWidth={2} aria-hidden /></div>
                        <div className="board-state-title">{ui.errorTitle}</div>
                        <button
                            type="button"
                            className="board-ghost-btn"
                            style={{ maxWidth: 240, margin: '16px auto 0' }}
                            onClick={() => void fetchPage({ append: false, offset: 0 })}
                        >
                            {ui.retry}
                        </button>
                    </div>
                ) : items.length === 0 ? (
                    <div className="board-state">
                        <div className="board-state-icon"><Megaphone size={26} strokeWidth={2} aria-hidden /></div>
                        <div className="board-state-title">{ui.emptyTitle}</div>
                        <div className="board-state-text">{ui.emptyHint}</div>
                        <button type="button" className="board-primary-btn" onClick={openCreate}>
                            <Plus className="w-4 h-4" strokeWidth={2.4} aria-hidden />
                            {ui.create}
                        </button>
                    </div>
                ) : isFiltering && visible.length === 0 ? (
                    <div className="board-state">
                        <div className="board-state-icon" style={{ background: 'linear-gradient(135deg, #64748b, #475569)', boxShadow: '0 8px 22px rgba(100,116,139,0.3)' }}>
                            <Search size={26} strokeWidth={2} aria-hidden />
                        </div>
                        <div className="board-state-title">{ui.noResults}</div>
                        <button
                            type="button"
                            className="board-ghost-btn"
                            style={{ maxWidth: 240, margin: '16px auto 0' }}
                            onClick={resetFilters}
                        >
                            Сбросить фильтры
                        </button>
                        {hasMore ? (
                            <button
                                type="button"
                                className="board-ghost-btn"
                                style={{ maxWidth: 240, margin: '10px auto 0' }}
                                onClick={handleLoadMore}
                                disabled={loadingMore}
                            >
                                {loadingMore ? ui.loading : ui.loadMore}
                            </button>
                        ) : null}
                    </div>
                ) : (
                    <>
                        <div className="board-grid">
                            {visible.map((a) => (
                                <PreviewCard
                                    key={a.entity.id}
                                    announcement={a}
                                    onOpen={handleOpen}
                                    selected={a.entity.id === selectedAnnouncement?.entity.id}
                                    onPreview={(announcement) => setSelectedId(announcement.entity.id)}
                                    canModerate={canModerate}
                                    onPin={(announcement) => void handlePin(announcement)}
                                    onEdit={(announcement) => setEditingAnnouncement(announcement)}
                                    onDelete={(announcement) => void handleDelete(announcement)}
                                    onFavorite={(announcement) => void handleFavorite(announcement)}
                                />
                            ))}
                        </div>
                        {hasMore ? (
                            <button type="button" className="board-ghost-btn" onClick={handleLoadMore} disabled={loadingMore}>
                                {loadingMore ? ui.loading : ui.loadMore}
                            </button>
                        ) : null}
                    </>
                )}
                </div>

                {canSuperModerate ? (
                    <aside className="board-admin-rail board-admin-rail-right" aria-label="Selected announcement inspector">
                        {selectedAnnouncement ? (
                            <>
                                <div className="board-admin-rail-head">
                                    <Eye size={18} strokeWidth={2.2} aria-hidden />
                                    <div>
                                        <div className="board-admin-rail-title">Инспектор</div>
                                        <div className="board-admin-rail-sub">Выбранное объявление</div>
                                    </div>
                                </div>
                                <div className="board-admin-selected">
                                    <div className="board-admin-selected-title">{selectedAnnouncement.entity.payload.title}</div>
                                    <div className="board-admin-selected-meta">
                                        {selectedAnnouncement.authorLabel || selectedAnnouncement.entity.authorUserId}
                                    </div>
                                    <div className="board-admin-selected-body">{selectedAnnouncement.entity.payload.body}</div>
                                </div>
                                <div className="board-admin-metrics">
                                    <span><Eye size={13} aria-hidden />{selectedAnnouncement.viewCount}</span>
                                    <span><MessageCircle size={13} aria-hidden />{selectedAnnouncement.commentCount}</span>
                                    <span><ImageIcon size={13} aria-hidden />{selectedAnnouncement.attachmentCount}</span>
                                    <span><BarChart3 size={13} aria-hidden />{selectedAnnouncement.reactions.reduce((sum, reaction) => sum + reaction.count, 0)}</span>
                                </div>
                                <div className="board-admin-actions">
                                    <button type="button" onClick={() => handleOpen(selectedAnnouncement)}><Eye size={15} aria-hidden />Открыть</button>
                                    <button type="button" onClick={() => void handlePin(selectedAnnouncement)}>
                                        {selectedAnnouncement.isPinned ? <PinOff size={15} aria-hidden /> : <Pin size={15} aria-hidden />}
                                        {selectedAnnouncement.isPinned ? 'Открепить' : 'Закрепить'}
                                    </button>
                                    <button type="button" onClick={() => setEditingAnnouncement(selectedAnnouncement)}><Pencil size={15} aria-hidden />Править</button>
                                    <button type="button" onClick={() => void handleShare(selectedAnnouncement)}><Clipboard size={15} aria-hidden />Ссылка</button>
                                    <button type="button" data-danger="true" onClick={() => void handleDelete(selectedAnnouncement)}><Trash2 size={15} aria-hidden />Удалить</button>
                                </div>
                            </>
                        ) : (
                            <div className="board-admin-empty">Наведи курсор на объявление, чтобы открыть инспектор.</div>
                        )}
                    </aside>
                ) : null}
            </div>

            <AnnouncementComposer
                open={composerOpen}
                mode="create"
                initial={null}
                onClose={() => setComposerOpen(false)}
                onSaved={handleSaved}
            />
            <AnnouncementComposer
                open={editingAnnouncement !== null}
                mode="edit"
                initial={editingAnnouncement}
                onClose={() => setEditingAnnouncement(null)}
                onSaved={(updated) => {
                    setItems((prev) => prev.map((item) => item.entity.id === updated.entity.id ? updated : item));
                    setEditingAnnouncement(null);
                }}
            />
        </PageShell>
    );
}
