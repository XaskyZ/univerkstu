/**
 * Notification Center i18n strings + tiny pure helpers.
 *
 * Local factory pattern (mirrors `frontend/src/app/admin/components/overview/strings.ts`):
 * a `get*Ui(language)` function returning a typed bag. The locale-parity test
 * (`strings.test.ts`) keeps the three locales in lockstep — adding a new key
 * to any one of them fails the test until the other two are filled in.
 */

import type { AppLanguage } from '@/lib/api/core';
import type { SocialNotificationKind } from '@/lib/api/social';
import { pluralForms } from './grouping';

export interface NotificationsCenterUi {
    /** Header / chrome */
    screenTitle: string;
    screenSubtitle: string;
    backLabel: string;
    /** Buttons */
    markAllRead: string;
    markAllReadDisabled: string;
    markGroupRead: string;
    loadMore: string;
    loading: string;
    /** Empty / error states */
    emptyTitle: string;
    emptySubtitle: string;
    emptyUnread: string;
    errorTitle: string;
    errorRetry: string;
    /** Filter toggles */
    showAll: string;
    showUnread: string;
    /** Time labels */
    justNow: string;
    minutesAgo: (n: number) => string;
    hoursAgo: (n: number) => string;
    daysAgo: (n: number) => string;
    /** Kind chips */
    kindLabel: Record<SocialNotificationKind, string>;
    /** Card "actor → kind" caption template */
    actorAction: Record<SocialNotificationKind, (actor: string) => string>;
    /** Grouped-row header — "5 упоминаний" / "5 mentions" / etc. */
    groupedTitle: (count: number, kind: SocialNotificationKind) => string;
    /** Overflow caption — "+ 3 человека" / "+ 3 more" used after the actor list. */
    groupMore: (n: number) => string;
    /** Expand / collapse affordances on a grouped row. */
    expandGroup: string;
    collapseGroup: string;
}

// === RU =====================================================================

const RU_KIND_FORMS: Record<SocialNotificationKind, readonly [string, string, string]> = {
    mention: ['упоминание', 'упоминания', 'упоминаний'],
    dm: ['сообщение', 'сообщения', 'сообщений'],
    comment: ['комментарий', 'комментария', 'комментариев'],
    group_post: ['публикация', 'публикации', 'публикаций'],
    announcement: ['объявление', 'объявления', 'объявлений'],
};

const RU: NotificationsCenterUi = {
    screenTitle: 'Уведомления',
    screenSubtitle: 'Здесь собраны последние упоминания и события для тебя.',
    backLabel: 'Назад',
    markAllRead: 'Прочитать всё',
    markAllReadDisabled: 'Всё прочитано',
    markGroupRead: 'Отметить группу как прочитанную',
    loadMore: 'Показать ещё',
    loading: 'Загрузка…',
    emptyTitle: 'Тишина',
    emptySubtitle: 'Пока никто не упоминал тебя и не писал в твои треды.',
    emptyUnread: 'Непрочитанных уведомлений нет.',
    errorTitle: 'Не удалось загрузить уведомления',
    errorRetry: 'Повторить',
    showAll: 'Все',
    showUnread: 'Непрочитанные',
    justNow: 'только что',
    minutesAgo: (n) => `${n} мин назад`,
    hoursAgo: (n) => `${n} ч назад`,
    daysAgo: (n) => `${n} дн назад`,
    kindLabel: {
        mention: 'Упоминание',
        dm: 'Сообщение',
        comment: 'Комментарий',
        group_post: 'В группе',
        announcement: 'Объявление',
    },
    actorAction: {
        mention: (actor) => `${actor} упомянул тебя`,
        dm: (actor) => `${actor} написал тебе`,
        comment: (actor) => `${actor} ответил на твой пост`,
        group_post: (actor) => `${actor} опубликовал в группе`,
        announcement: (actor) => `${actor} опубликовал объявление`,
    },
    groupedTitle: (count, kind) => `${count} ${pluralForms(count, RU_KIND_FORMS[kind])}`,
    groupMore: (n) => `и ещё ${n} ${pluralForms(n, ['человек', 'человека', 'человек'])}`,
    expandGroup: 'Развернуть',
    collapseGroup: 'Свернуть',
};

// === KZ =====================================================================

const KZ_KIND_NOUN: Record<SocialNotificationKind, string> = {
    mention: 'аталым',
    dm: 'хабарлама',
    comment: 'пікір',
    group_post: 'жазба',
    announcement: 'хабарландыру',
};

const KZ: NotificationsCenterUi = {
    screenTitle: 'Хабарландырулар',
    screenSubtitle: 'Соңғы аталымдар мен оқиғалар осы жерде жиналған.',
    backLabel: 'Артқа',
    markAllRead: 'Барлығын оқылды деп белгілеу',
    markAllReadDisabled: 'Бәрі оқылды',
    markGroupRead: 'Топты оқылды деп белгілеу',
    loadMore: 'Тағы көрсету',
    loading: 'Жүктелуде…',
    emptyTitle: 'Тыныштық',
    emptySubtitle: 'Әзірге сені ешкім атаған жоқ және хабарлама жазбаған.',
    emptyUnread: 'Оқылмаған хабарландырулар жоқ.',
    errorTitle: 'Хабарландыруларды жүктеу мүмкін болмады',
    errorRetry: 'Қайталау',
    showAll: 'Барлығы',
    showUnread: 'Оқылмағандар',
    justNow: 'дәл қазір',
    minutesAgo: (n) => `${n} мин бұрын`,
    hoursAgo: (n) => `${n} сағ бұрын`,
    daysAgo: (n) => `${n} күн бұрын`,
    kindLabel: {
        mention: 'Аталым',
        dm: 'Хабарлама',
        comment: 'Пікір',
        group_post: 'Топта',
        announcement: 'Хабарландыру',
    },
    actorAction: {
        mention: (actor) => `${actor} сені атап өтті`,
        dm: (actor) => `${actor} саған жазды`,
        comment: (actor) => `${actor} жазбаңа жауап берді`,
        group_post: (actor) => `${actor} топта жариялады`,
        announcement: (actor) => `${actor} хабарландыру жариялады`,
    },
    // Kazakh nouns don't inflect for plural the way Russian does — the
    // numeric prefix already conveys plurality, so we use the bare noun.
    groupedTitle: (count, kind) => `${count} ${KZ_KIND_NOUN[kind]}`,
    groupMore: (n) => `және тағы ${n} адам`,
    expandGroup: 'Жазу',
    collapseGroup: 'Жасыру',
};

// === EN =====================================================================

const EN_KIND_FORMS: Record<SocialNotificationKind, readonly [string, string]> = {
    mention: ['mention', 'mentions'],
    dm: ['message', 'messages'],
    comment: ['comment', 'comments'],
    group_post: ['group post', 'group posts'],
    announcement: ['announcement', 'announcements'],
};

const EN: NotificationsCenterUi = {
    screenTitle: 'Notifications',
    screenSubtitle: 'Recent mentions and events targeted at you.',
    backLabel: 'Back',
    markAllRead: 'Mark all as read',
    markAllReadDisabled: 'All read',
    markGroupRead: 'Mark group as read',
    loadMore: 'Show more',
    loading: 'Loading…',
    emptyTitle: 'Quiet here',
    emptySubtitle: 'No one has mentioned you or posted in your threads yet.',
    emptyUnread: 'No unread notifications.',
    errorTitle: 'Could not load notifications',
    errorRetry: 'Retry',
    showAll: 'All',
    showUnread: 'Unread',
    justNow: 'just now',
    minutesAgo: (n) => `${n} min ago`,
    hoursAgo: (n) => `${n} h ago`,
    daysAgo: (n) => `${n} d ago`,
    kindLabel: {
        mention: 'Mention',
        dm: 'Message',
        comment: 'Comment',
        group_post: 'Group post',
        announcement: 'Announcement',
    },
    actorAction: {
        mention: (actor) => `${actor} mentioned you`,
        dm: (actor) => `${actor} sent you a message`,
        comment: (actor) => `${actor} replied to your post`,
        group_post: (actor) => `${actor} posted in a group`,
        announcement: (actor) => `${actor} posted an announcement`,
    },
    groupedTitle: (count, kind) => `${count} ${pluralForms(count, EN_KIND_FORMS[kind])}`,
    groupMore: (n) => `+ ${n} more`,
    expandGroup: 'Expand',
    collapseGroup: 'Collapse',
};

export function getNotificationsCenterUi(language: AppLanguage): NotificationsCenterUi {
    if (language === 'kz') return KZ;
    if (language === 'en') return EN;
    return RU;
}

// === Pure helpers (exported for unit tests) =================================

/**
 * Format an ISO timestamp as a relative time label. Pure — depends on `now`
 * being passed in so the unit tests can drive deterministic snapshots.
 * Negative deltas (future timestamps) are flattened to "just now".
 */
export function formatRelativeTime(
    iso: string,
    now: number,
    ui: NotificationsCenterUi,
): string {
    const parsed = new Date(iso).getTime();
    if (!Number.isFinite(parsed)) return '';
    const deltaSeconds = Math.max(0, Math.floor((now - parsed) / 1000));
    if (deltaSeconds < 60) return ui.justNow;
    const minutes = Math.floor(deltaSeconds / 60);
    if (minutes < 60) return ui.minutesAgo(minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return ui.hoursAgo(hours);
    const days = Math.floor(hours / 24);
    return ui.daysAgo(days);
}

/**
 * UI-side cap for the unread badge. Anything ≥ this is rendered as `"99+"`
 * to keep the badge box from blowing up on a long-quiet account.
 */
export const UNREAD_BADGE_CAP = 99;

export function formatUnreadBadge(count: number): string {
    if (!Number.isFinite(count) || count <= 0) return '';
    if (count > UNREAD_BADGE_CAP) return `${UNREAD_BADGE_CAP}+`;
    return String(Math.floor(count));
}

/**
 * Resolve the destination URL the user should land on when tapping a card.
 * Today the universal social UI is not wired across all scopes, so we land
 * on the most-specific surface that already exists and fall back to `/` when
 * the scope isn't navigable yet.
 */
export function resolveNotificationHref(
    scopeType: string,
    scopeId: string,
): string {
    if (scopeType === 'group') {
        const raw = scopeId.startsWith('group:') ? scopeId.slice('group:'.length) : scopeId;
        const trimmed = raw.trim();
        if (trimmed) return `/group/${encodeURIComponent(trimmed)}`;
        return '/group';
    }
    if (scopeType === 'dm') {
        return '/chat';
    }
    if (scopeType === 'global') {
        return '/chat';
    }
    if (scopeType === 'announcement') {
        return '/';
    }
    return '/';
}
