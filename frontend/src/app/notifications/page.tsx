'use client';

/**
 * Notification Center page (`/notifications`).
 *
 * Centralized list of recent @mentions and social events targeted at the
 * viewer. Backed by `GET /api/v3/social/notifications` (see
 * `backend/src/routes/social.ts` + `services/social-notifications.ts`).
 *
 * Why this exists:
 *  - the push fan-out (`services/social-events.ts`) only sends ephemeral OS
 *    notifications. If the user dismisses, misses, or had push disabled, the
 *    event is lost from the UX even though the underlying `app_social_mention`
 *    row is durable.
 *  - this page surfaces those rows so a user can catch up on what they missed.
 *
 * Page contract (mirrors existing sub-screens like
 * `/settings/notifications`):
 *  - auth guard at the top — anonymous viewer is bounced to `/`.
 *  - `PageShell` + `SubScreenHeader` chrome with a back-link to root.
 *  - Filter chip ("All" / "Unread").
 *  - Card list, newest-first, with kind chip + actor caption + summary
 *    snippet + relative time. Tapping a card marks the row read and routes
 *    via `resolveNotificationHref`.
 *  - "Mark all as read" button at the top of the list (disabled when nothing
 *    is unread).
 *  - "Load more" cursor pagination using the oldest `createdAt` in the
 *    current page as `before`.
 *  - Loading / empty / error states use the shared `PageStateCard`.
 *
 * No theme-sensitive hardcoded colors are used in this page — every accent
 * resolves to `var(--text)`, `var(--muted)`, `var(--card)`, `var(--border)`,
 * `var(--primary)`, or `var(--primary-rgb)` as per the repo theme rules.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, MessageSquare, MessageCircle, Megaphone, Users, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { confirmDialog } from '@/lib/confirm-dialog';
import { getDismissedNotificationIds, addDismissedNotificationIds } from '@/lib/dismissed-notifications';
import { PageMain, PageShell, PageStateCard } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';
import {
    getSocialNotifications,
    markAllSocialNotificationsRead,
    markSocialNotificationsRead,
    SOCIAL_NOTIFICATION_DEFAULT_LIMIT,
    type SocialNotification,
    type SocialNotificationKind,
} from '@/lib/api/social';
import {
    formatRelativeTime,
    getNotificationsCenterUi,
    resolveNotificationHref,
    type NotificationsCenterUi,
} from './strings';
import {
    NOTIFICATION_GROUP_ACTOR_DISPLAY_CAP,
    collectUnreadIds,
    groupNotifications,
    type NotificationGroup,
} from './grouping';

type FilterMode = 'all' | 'unread';

export default function NotificationsCenterPage() {
    const { isAuth, loading: authLoading } = useAuth();
    const { language, messages } = useLanguage();
    const ui = useMemo(() => getNotificationsCenterUi(language), [language]);
    const router = useRouter();

    const [items, setItems] = useState<SocialNotification[]>([]);
    const [filter, setFilter] = useState<FilterMode>('all');
    const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle');
    const [loadingMore, setLoadingMore] = useState(false);
    const [markingAll, setMarkingAll] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    // Ticks every minute so the relative-time labels stay fresh while the
    // user is staring at the page. Cheap and contained — no global poll.
    const [nowTick, setNowTick] = useState(() => Date.now());
    // Client-side dismissed set (localStorage). The backend has no per-row
    // delete, so "clear" hides rows locally + marks them read.
    const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

    // Prevents stale responses from clobbering the current view when the
    // user flips the filter mid-fetch. Incrementing the ref invalidates any
    // in-flight load.
    const requestSeqRef = useRef(0);

    useEffect(() => {
        if (!authLoading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, authLoading, router]);

    useEffect(() => {
        const interval = window.setInterval(() => setNowTick(Date.now()), 60_000);
        return () => window.clearInterval(interval);
    }, []);

    // Hydrate the dismissed set from localStorage after mount (SSR-safe).
    useEffect(() => {
        setDismissedIds(new Set(getDismissedNotificationIds()));
    }, []);

    const fetchPage = useCallback(
        async (opts: { mode: FilterMode; before?: string; append: boolean }) => {
            const seq = ++requestSeqRef.current;
            if (opts.append) {
                setLoadingMore(true);
            } else {
                setStatus('loading');
            }
            const result = await getSocialNotifications({
                limit: SOCIAL_NOTIFICATION_DEFAULT_LIMIT,
                unreadOnly: opts.mode === 'unread',
                before: opts.before,
            });
            // Stale-fetch guard — a newer request has fired since this one
            // started, so swallow the result.
            if (seq !== requestSeqRef.current) return;
            if (!result.success || !result.data) {
                setStatus('error');
                if (opts.append) setLoadingMore(false);
                return;
            }
            const fetched = result.data.notifications;
            setItems((prev) => (opts.append ? [...prev, ...fetched] : fetched));
            setHasMore(fetched.length >= SOCIAL_NOTIFICATION_DEFAULT_LIMIT);
            setStatus('ready');
            if (opts.append) setLoadingMore(false);
        },
        [],
    );

    // Refetch whenever the filter flips. Initial mount counts as the first
    // run with mode='all'.
    useEffect(() => {
        if (!isAuth) return;
        void fetchPage({ mode: filter, append: false });
    }, [isAuth, filter, fetchPage]);

    // Rows the user has locally dismissed are filtered out of the view.
    const visibleItems = useMemo(
        () => items.filter((n) => !dismissedIds.has(n.id)),
        [items, dismissedIds],
    );

    const unreadCount = useMemo(
        () => visibleItems.reduce((acc, n) => (n.readAt === null ? acc + 1 : acc), 0),
        [visibleItems],
    );

    const handleMarkAll = useCallback(async () => {
        if (markingAll) return;
        if (unreadCount === 0) return;
        setMarkingAll(true);
        // Optimistic: stamp every visible row with readAt = now() so the
        // badge collapses immediately. If the server rejects we roll back.
        const snapshot = items;
        const stampedAt = new Date().toISOString();
        setItems((prev) => prev.map((n) => (n.readAt === null ? { ...n, readAt: stampedAt } : n)));
        try {
            const result = await markAllSocialNotificationsRead();
            if (!result.success) {
                setItems(snapshot);
                toast.error(result.error || ui.errorTitle);
            }
        } finally {
            setMarkingAll(false);
        }
    }, [markingAll, unreadCount, items, ui.errorTitle]);

    const handleClearAll = useCallback(async () => {
        if (visibleItems.length === 0) return;
        const ok = await confirmDialog(
            language === 'en'
                ? 'Clear all notifications? They will be hidden from this list.'
                : language === 'kz'
                    ? 'Барлық хабарландыруларды тазалау керек пе? Олар тізімнен жасырылады.'
                    : 'Очистить все уведомления? Они будут скрыты из этого списка.',
            { danger: true },
        );
        if (!ok) return;
        const next = addDismissedNotificationIds(visibleItems.map((n) => n.id));
        setDismissedIds(new Set(next));
        // Mark read server-side (best-effort) so the unread badge clears too.
        void markAllSocialNotificationsRead().catch(() => {
            // Silent — dismissal already hides the rows locally.
        });
    }, [visibleItems, language]);

    const handleDismiss = useCallback((ids: string[]) => {
        if (ids.length === 0) return;
        const next = addDismissedNotificationIds(ids);
        setDismissedIds(new Set(next));
        // Mark just the dismissed unread rows read (best-effort).
        const idSet = new Set(ids);
        const unread = items.filter((n) => idSet.has(n.id) && n.readAt === null).map((n) => n.id);
        if (unread.length > 0) {
            void markSocialNotificationsRead(unread).catch(() => {
                // Silent — the row is already hidden locally.
            });
        }
    }, [items]);

    const handleCardClick = useCallback(
        async (notification: SocialNotification) => {
            const href = resolveNotificationHref(notification.scopeType, notification.scopeId);
            // Optimistic local update so the card collapses to "read" state
            // before navigation. We intentionally do NOT await the POST: the
            // user's primary intent is the navigation, and the read-state
            // flip can race-finish on the server. The badge is recomputed
            // next time this page mounts.
            if (notification.readAt === null) {
                const stampedAt = new Date().toISOString();
                setItems((prev) =>
                    prev.map((n) => (n.id === notification.id ? { ...n, readAt: stampedAt } : n)),
                );
                void markSocialNotificationsRead([notification.id]).catch(() => {
                    // Silent best-effort — the next page mount will pick up
                    // the canonical state regardless.
                });
            }
            router.push(href);
        },
        [router],
    );

    /**
     * Mark every unread child of a group as read in one batched POST. Unlike
     * `handleCardClick` this does NOT navigate — the user is still on the
     * notifications screen and wants the badge to clear without leaving.
     */
    const handleMarkGroupRead = useCallback(
        (group: NotificationGroup) => {
            const unreadIds = collectUnreadIds(group);
            if (unreadIds.length === 0) return;
            const idSet = new Set(unreadIds);
            const stampedAt = new Date().toISOString();
            setItems((prev) =>
                prev.map((n) => (idSet.has(n.id) ? { ...n, readAt: stampedAt } : n)),
            );
            void markSocialNotificationsRead(unreadIds).catch(() => {
                // Best-effort — next page mount reconciles canonical state.
            });
        },
        [],
    );

    const handleLoadMore = useCallback(() => {
        if (loadingMore || items.length === 0) return;
        const oldest = items[items.length - 1];
        if (!oldest) return;
        void fetchPage({ mode: filter, before: oldest.createdAt, append: true });
    }, [loadingMore, items, filter, fetchPage]);

    const handleRetry = useCallback(() => {
        void fetchPage({ mode: filter, append: false });
    }, [fetchPage, filter]);

    if (authLoading || !isAuth) {
        return null;
    }

    return (
        <PageShell>
            <SubScreenHeader title={ui.screenTitle} subtitle={ui.screenSubtitle} backHref="/" />
            <PageMain className="space-y-3">
                <FilterRow
                    filter={filter}
                    onChange={setFilter}
                    onMarkAll={() => void handleMarkAll()}
                    markingAll={markingAll}
                    unreadCount={unreadCount}
                    onClearAll={() => void handleClearAll()}
                    canClear={visibleItems.length > 0}
                    clearLabel={messages.common.clear}
                    ui={ui}
                />

                <NotificationsBody
                    status={status}
                    items={visibleItems}
                    filter={filter}
                    nowTick={nowTick}
                    ui={ui}
                    onCardClick={(n) => void handleCardClick(n)}
                    onMarkGroupRead={handleMarkGroupRead}
                    onDismiss={handleDismiss}
                    dismissLabel={messages.common.dismiss}
                    onRetry={handleRetry}
                />

                {status === 'ready' && items.length > 0 && hasMore ? (
                    <button
                        type="button"
                        className="btn btn-secondary w-full"
                        onClick={handleLoadMore}
                        disabled={loadingMore}
                    >
                        {loadingMore ? ui.loading : ui.loadMore}
                    </button>
                ) : null}
            </PageMain>
        </PageShell>
    );
}

// === Filter + mark-all row ==================================================

interface FilterRowProps {
    filter: FilterMode;
    onChange: (mode: FilterMode) => void;
    onMarkAll: () => void;
    markingAll: boolean;
    unreadCount: number;
    onClearAll: () => void;
    canClear: boolean;
    clearLabel: string;
    ui: NotificationsCenterUi;
}

function FilterRow({ filter, onChange, onMarkAll, markingAll, unreadCount, onClearAll, canClear, clearLabel, ui }: FilterRowProps) {
    const canMark = unreadCount > 0 && !markingAll;
    return (
        <div className="flex items-center justify-between gap-3 flex-wrap">
            <div role="tablist" aria-label={ui.screenTitle} className="flex gap-2">
                <FilterChip active={filter === 'all'} onClick={() => onChange('all')} label={ui.showAll} />
                <FilterChip active={filter === 'unread'} onClick={() => onChange('unread')} label={ui.showUnread} />
            </div>
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={onMarkAll}
                    disabled={!canMark}
                    className="text-[13px] font-medium"
                    style={{
                        padding: '8px 12px',
                        borderRadius: '12px',
                        border: '1px solid var(--border)',
                        background: 'var(--card)',
                        color: canMark ? 'var(--primary)' : 'var(--muted)',
                        cursor: canMark ? 'pointer' : 'default',
                        opacity: canMark ? 1 : 0.7,
                    }}
                >
                    {canMark ? ui.markAllRead : ui.markAllReadDisabled}
                </button>
                <button
                    type="button"
                    onClick={onClearAll}
                    disabled={!canClear}
                    className="text-[13px] font-medium"
                    style={{
                        padding: '8px 12px',
                        borderRadius: '12px',
                        border: '1px solid var(--border)',
                        background: 'var(--card)',
                        color: canClear ? 'var(--text)' : 'var(--muted)',
                        cursor: canClear ? 'pointer' : 'default',
                        opacity: canClear ? 1 : 0.7,
                    }}
                >
                    {clearLabel}
                </button>
            </div>
        </div>
    );
}

interface FilterChipProps {
    active: boolean;
    onClick: () => void;
    label: string;
}

function FilterChip({ active, onClick, label }: FilterChipProps) {
    return (
        <button
            type="button"
            role="tab"
            aria-selected={active}
            onClick={onClick}
            className="text-[13px] font-medium"
            style={{
                padding: '8px 14px',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                background: active ? 'rgba(var(--primary-rgb), 0.12)' : 'var(--card)',
                color: active ? 'var(--primary)' : 'var(--text)',
                cursor: 'pointer',
            }}
        >
            {label}
        </button>
    );
}

// === Body (state machine) ===================================================

interface NotificationsBodyProps {
    status: 'idle' | 'loading' | 'error' | 'ready';
    items: SocialNotification[];
    filter: FilterMode;
    nowTick: number;
    ui: NotificationsCenterUi;
    onCardClick: (notification: SocialNotification) => void;
    onMarkGroupRead: (group: NotificationGroup) => void;
    onDismiss: (ids: string[]) => void;
    dismissLabel: string;
    onRetry: () => void;
}

function NotificationsBody({
    status,
    items,
    filter,
    nowTick,
    ui,
    onCardClick,
    onMarkGroupRead,
    onDismiss,
    dismissLabel,
    onRetry,
}: NotificationsBodyProps) {
    // Group every page render — grouping is pure + O(n) so it's safe inline.
    // useMemo not strictly required here but keeps React reconciliation
    // stable when other state (e.g. nowTick) re-renders the body.
    const groups = useMemo(() => groupNotifications(items), [items]);

    if (status === 'idle' || status === 'loading') {
        return <PageStateCard message={ui.loading} />;
    }
    if (status === 'error') {
        return (
            <div className="space-y-2">
                <PageStateCard message={ui.errorTitle} tone="danger" />
                <button type="button" className="btn btn-secondary w-full" onClick={onRetry}>
                    {ui.errorRetry}
                </button>
            </div>
        );
    }
    if (items.length === 0) {
        const message = filter === 'unread' ? ui.emptyUnread : (
            <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{ui.emptyTitle}</div>
                <div style={{ color: 'var(--muted)' }}>{ui.emptySubtitle}</div>
            </div>
        );
        return <PageStateCard message={message} />;
    }
    return (
        <ul className="space-y-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {groups.map((group) => (
                <li key={group.key} style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        {group.notifications.length === 1 ? (
                            // Single-child groups skip the collapse chrome and fall
                            // back to the original flat card to preserve the
                            // existing tap-to-navigate UX.
                            <NotificationCard
                                notification={group.notifications[0]}
                                nowTick={nowTick}
                                ui={ui}
                                onClick={() => onCardClick(group.notifications[0])}
                            />
                        ) : (
                            <NotificationGroupCard
                                group={group}
                                nowTick={nowTick}
                                ui={ui}
                                onCardClick={onCardClick}
                                onMarkGroupRead={() => onMarkGroupRead(group)}
                            />
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => onDismiss(group.notifications.map((n) => n.id))}
                        aria-label={dismissLabel}
                        title={dismissLabel}
                        style={{
                            flex: '0 0 auto',
                            width: 36,
                            borderRadius: 12,
                            border: '1px solid var(--border)',
                            background: 'var(--card)',
                            color: 'var(--muted)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <X className="w-4 h-4" aria-hidden />
                    </button>
                </li>
            ))}
        </ul>
    );
}

// === Card ===================================================================

const KIND_ICON: Record<SocialNotificationKind, (props: { className?: string; strokeWidth?: number }) => React.ReactElement> = {
    mention: (p) => <AtSign className={p.className} strokeWidth={p.strokeWidth} />,
    dm: (p) => <MessageSquare className={p.className} strokeWidth={p.strokeWidth} />,
    comment: (p) => <MessageCircle className={p.className} strokeWidth={p.strokeWidth} />,
    group_post: (p) => <Users className={p.className} strokeWidth={p.strokeWidth} />,
    announcement: (p) => <Megaphone className={p.className} strokeWidth={p.strokeWidth} />,
};

interface NotificationCardProps {
    notification: SocialNotification;
    nowTick: number;
    ui: NotificationsCenterUi;
    onClick: () => void;
}

function NotificationCard({ notification, nowTick, ui, onClick }: NotificationCardProps) {
    const { messages } = useLanguage();
    const unread = notification.readAt === null;
    const Icon = KIND_ICON[notification.kind] ?? KIND_ICON.mention;
    const relativeTime = formatRelativeTime(notification.createdAt, nowTick, ui);

    return (
        <button
            type="button"
            onClick={onClick}
            className="card w-full text-left"
            style={{
                padding: '14px 16px',
                borderRadius: '16px',
                border: unread
                    ? '1px solid rgba(var(--primary-rgb), 0.55)'
                    : '1px solid var(--border)',
                background: unread
                    ? 'rgba(var(--primary-rgb), 0.06)'
                    : 'var(--card)',
                cursor: 'pointer',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start',
            }}
        >
            <span
                aria-hidden
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: '12px',
                    background: 'rgba(var(--primary-rgb), 0.12)',
                    color: 'var(--primary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                <Icon className="w-4 h-4" strokeWidth={2} />
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span
                        className="text-[11px] font-semibold uppercase"
                        style={{
                            padding: '2px 8px',
                            borderRadius: '8px',
                            background: 'rgba(var(--primary-rgb), 0.12)',
                            color: 'var(--primary)',
                            letterSpacing: '0.04em',
                        }}
                    >
                        {ui.kindLabel[notification.kind]}
                    </span>
                    <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                        {relativeTime}
                    </span>
                    {unread ? (
                        <span
                            aria-label={messages.common.unread}
                            style={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                background: 'var(--primary)',
                            }}
                        />
                    ) : null}
                </div>
                <p
                    className="text-[14px] font-semibold mt-1"
                    style={{ color: 'var(--text)' }}
                >
                    {ui.actorAction[notification.kind](notification.actorUserId)}
                </p>
                {notification.summary ? (
                    <p
                        className="text-[13px] mt-1"
                        style={{ color: 'var(--muted)', wordBreak: 'break-word' }}
                    >
                        {notification.summary}
                    </p>
                ) : null}
            </div>
        </button>
    );
}

// === Grouped card ===========================================================

interface NotificationGroupCardProps {
    group: NotificationGroup;
    nowTick: number;
    ui: NotificationsCenterUi;
    onCardClick: (notification: SocialNotification) => void;
    onMarkGroupRead: () => void;
}

function NotificationGroupCard({
    group,
    nowTick,
    ui,
    onCardClick,
    onMarkGroupRead,
}: NotificationGroupCardProps) {
    // Collapsed by default. Expanding the group ALSO batches a mark-read for
    // every unread child — matches Telegram-style "tap to view, becomes read".
    const { messages } = useLanguage();
    const [expanded, setExpanded] = useState(false);
    const Icon = KIND_ICON[group.kind] ?? KIND_ICON.mention;
    const relativeTime = formatRelativeTime(group.latestAt, nowTick, ui);
    const unread = group.unreadCount > 0;

    const visibleActors = group.actorUserIds.slice(0, NOTIFICATION_GROUP_ACTOR_DISPLAY_CAP);
    const overflowCount = Math.max(0, group.actorUserIds.length - visibleActors.length);

    const handleToggle = useCallback(() => {
        setExpanded((prev) => {
            const next = !prev;
            if (next && group.unreadCount > 0) {
                // Mark the whole bucket read on expand. Mirrors the per-card
                // flow but batched so a single POST clears the badge.
                onMarkGroupRead();
            }
            return next;
        });
    }, [group.unreadCount, onMarkGroupRead]);

    return (
        <div
            className="card w-full"
            style={{
                padding: '14px 16px',
                borderRadius: '16px',
                border: unread
                    ? '1px solid rgba(var(--primary-rgb), 0.55)'
                    : '1px solid var(--border)',
                background: unread
                    ? 'rgba(var(--primary-rgb), 0.06)'
                    : 'var(--card)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
            }}
        >
            <button
                type="button"
                onClick={handleToggle}
                aria-expanded={expanded}
                className="w-full text-left"
                style={{
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'flex-start',
                }}
            >
                <span
                    aria-hidden
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: '12px',
                        background: 'rgba(var(--primary-rgb), 0.12)',
                        color: 'var(--primary)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                    }}
                >
                    <Icon className="w-4 h-4" strokeWidth={2} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span
                            className="text-[11px] font-semibold uppercase"
                            style={{
                                padding: '2px 8px',
                                borderRadius: '8px',
                                background: 'rgba(var(--primary-rgb), 0.12)',
                                color: 'var(--primary)',
                                letterSpacing: '0.04em',
                            }}
                        >
                            {ui.groupedTitle(group.notifications.length, group.kind)}
                        </span>
                        <span className="text-[12px]" style={{ color: 'var(--muted)' }}>
                            {relativeTime}
                        </span>
                        {unread ? (
                            <span
                                aria-label={messages.common.unread}
                                style={{
                                    minWidth: 18,
                                    height: 18,
                                    padding: '0 6px',
                                    borderRadius: '9px',
                                    background: 'var(--primary)',
                                    color: 'var(--on-primary, #fff)',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                }}
                            >
                                {group.unreadCount}
                            </span>
                        ) : null}
                    </div>
                    <p
                        className="text-[14px] font-semibold mt-1"
                        style={{ color: 'var(--text)' }}
                    >
                        {visibleActors.join(', ')}
                        {overflowCount > 0 ? (
                            <span style={{ color: 'var(--muted)', fontWeight: 400 }}>
                                {' '}
                                {ui.groupMore(overflowCount)}
                            </span>
                        ) : null}
                    </p>
                    {group.entitySummary ? (
                        <p
                            className="text-[13px] mt-1"
                            style={{ color: 'var(--muted)', wordBreak: 'break-word' }}
                        >
                            {group.entitySummary}
                        </p>
                    ) : null}
                </div>
                <span
                    aria-hidden
                    style={{
                        color: 'var(--muted)',
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        height: 24,
                    }}
                >
                    {expanded ? (
                        <ChevronUp className="w-4 h-4" strokeWidth={2} />
                    ) : (
                        <ChevronDown className="w-4 h-4" strokeWidth={2} />
                    )}
                </span>
            </button>

            {expanded ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <ul
                        className="space-y-2"
                        style={{ listStyle: 'none', padding: 0, margin: 0 }}
                    >
                        {group.notifications.map((n) => (
                            <li key={n.id}>
                                <NotificationCard
                                    notification={n}
                                    nowTick={nowTick}
                                    ui={ui}
                                    onClick={() => onCardClick(n)}
                                />
                            </li>
                        ))}
                    </ul>
                    {unread ? (
                        <button
                            type="button"
                            onClick={onMarkGroupRead}
                            className="text-[12px] font-medium"
                            style={{
                                alignSelf: 'flex-end',
                                padding: '6px 10px',
                                borderRadius: '10px',
                                border: '1px solid var(--border)',
                                background: 'var(--card)',
                                color: 'var(--primary)',
                                cursor: 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                            }}
                        >
                            <Check className="w-3 h-3" strokeWidth={2} />
                            {ui.markGroupRead}
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
