'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getCoordinatorAnnouncementsForGroup, markCoordinatorAnnouncementViewed, toggleSocialReaction, type CoordinatorAnnouncementView } from '@/lib/api';
import { useFocusHighlight } from '@/lib/use-focus-highlight';
import AttachmentsList from '@/components/AttachmentsList';
import CommentsThread from '@/components/CommentsThread';
import EntityShareButton from '@/components/EntityShareButton';
import RevisionHistoryButton from '@/components/RevisionHistoryButton';
import { useAuth } from '@/lib/auth-context';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { forwardPresenceOrTyping, usePresence } from '@/lib/use-presence';
import { useSocialStream } from '@/lib/use-social-stream';
import AnnouncementViewBridge from '../components/AnnouncementViewBridge';
import FeedTab from '../components/FeedTab';
import LessonsTab from '../components/LessonsTab';
import MembersTab from '../components/MembersTab';
import ReactionsBar from '../components/ReactionsBar';
import RequestsTab from '../components/RequestsTab';
import TasksTab from '../components/TasksTab';
import { useAnnouncementsSocial } from '../hooks/useAnnouncementsSocial';
import { useGroupFeed } from '../hooks/useGroupFeed';
import { useGroupLessons } from '../hooks/useGroupLessons';
import { useGroupMembers } from '../hooks/useGroupMembers';
import { useGroupTasks } from '../hooks/useGroupTasks';
import { getAnnouncementAccent } from '../utils/announcement-accent';
import {
    socialAnnouncementToCoordinatorView,
    socialEntityToAnnouncementView,
    type AnnouncementAdapterShape,
} from '../utils/social-entity-to-announcement';
import type { GroupWorkspaceContextValue } from '../workspace-types';

type ContentTab = 'feed' | 'tasks' | 'lessons';

export default function StarostaPage({ workspace }: { workspace: GroupWorkspaceContextValue }) {
    const { language, messages } = useLanguage();
    // Permalink focus highlight for announcement permalinks lands here when
    // the URL carries `?focus=<announcementId>`. The hook self-clears after
    // the 3s pulse so the class only sticks for the animation window.
    const searchParams = useSearchParams();
    const focusParam = searchParams?.get('focus') ?? null;
    const focusHighlight = useFocusHighlight(focusParam);
    const { userId } = useAuth();
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const [contentTab, setContentTab] = useState<ContentTab>('feed');
    // Legacy read state — only meaningful when `socialBeta` is OFF. Beta mode
    // reads from `socialAnnouncementsState` and projects through the back-
    // mapper. The legacy path is per-group (server-side filtering), the
    // social path is global with `payload.targetGroups` matching done
    // client-side below.
    const [legacyAnnouncements, setLegacyAnnouncements] = useState<CoordinatorAnnouncementView[]>([]);
    const [legacyAnnouncementsLoading, setLegacyAnnouncementsLoading] = useState(true);
    const socialAnnouncementsState = useAnnouncementsSocial({
        enabled: socialBeta && Boolean(workspace.currentGroupKey) && workspace.canReadCurrentGroup,
    });
    // Presence bridge for the global announcement scope. Parallel SSE
    // subscription (the announcements hook above is HTTP-only) — when the
    // beta flag is off no socket is opened and the roster stays empty.
    // Mirrors the bridge pattern used by `MembersTab` / `FeedTab`.
    const announcementPresenceScope = 'announcement:global';
    const [lastAnnouncementPresenceEvent, setLastAnnouncementPresenceEvent] = useState<{
        scope: string;
        onlineUserIds: string[];
        receivedAt: number;
    } | null>(null);
    useSocialStream({
        scopes: [announcementPresenceScope],
        enabled: socialBeta,
        onEvent: (event) => {
            const forwarded = forwardPresenceOrTyping(event);
            if (forwarded?.kind === 'presence') {
                setLastAnnouncementPresenceEvent(forwarded.payload);
            }
        },
    });
    const announcementPresence = usePresence(announcementPresenceScope, { lastEvent: lastAnnouncementPresenceEvent });
    const onlineAnnouncementAuthorIds = useMemo(
        () => new Set(socialBeta ? announcementPresence.onlineUserIds : []),
        [announcementPresence.onlineUserIds, socialBeta],
    );
    const feed = useGroupFeed(workspace.currentGroupKey, workspace.canReadCurrentGroup);
    const tasks = useGroupTasks(workspace.currentGroupKey, workspace.canReadCurrentGroup);
    const lessons = useGroupLessons(workspace.currentGroupKey, workspace.canReadCurrentGroup);
    const members = useGroupMembers(workspace.currentGroupKey, workspace.canReadCurrentGroup);

    useEffect(() => {
        // When beta is on we skip this fetch entirely — the social hook is
        // the read path. Otherwise we keep the legacy `/api/v3/group/...`
        // call which already does server-side targetGroups matching.
        if (socialBeta) return;
        let cancelled = false;
        const timer = window.setTimeout(async () => {
            if (!workspace.currentGroupKey || !workspace.canReadCurrentGroup) {
                if (!cancelled) {
                    setLegacyAnnouncements([]);
                    setLegacyAnnouncementsLoading(false);
                }
                return;
            }

            setLegacyAnnouncementsLoading(true);
            const result = await getCoordinatorAnnouncementsForGroup(workspace.currentGroupKey);
            if (cancelled) return;
            setLegacyAnnouncements(result.success ? (result.data?.announcements || []) : []);
            setLegacyAnnouncementsLoading(false);
        }, 0);

        return () => {
            cancelled = true;
            window.clearTimeout(timer);
        };
    }, [socialBeta, workspace.canReadCurrentGroup, workspace.currentGroupKey]);

    // Render-side selector — when beta is on, project the social entities
    // through the adapter chain AND filter by the current group key. The
    // social store is a global scope; per-group targeting lives in
    // `payload.targetGroups` (absent means "broadcast to all-starostas").
    const announcements = useMemo<CoordinatorAnnouncementView[]>(() => {
        if (!socialBeta) return legacyAnnouncements;
        const currentGroup = workspace.currentGroupKey;
        return socialAnnouncementsState.announcements
            .map((entity) => socialAnnouncementToCoordinatorView(socialEntityToAnnouncementView(entity)))
            .filter((announcement) => {
                if (announcement.targetMode === 'all_starostas') return true;
                if (!currentGroup) return false;
                return announcement.targetGroups.includes(currentGroup);
            });
    }, [legacyAnnouncements, socialAnnouncementsState.announcements, socialBeta, workspace.currentGroupKey]);
    const announcementsLoading = socialBeta ? socialAnnouncementsState.isLoading : legacyAnnouncementsLoading;

    // Id-keyed lookup of the adapter shape (with reactions envelope + raw
    // social entity id) so the announcement card can mount ReactionsBar /
    // CommentsThread / AttachmentsList behind the beta flag without losing
    // the legacy-shaped projection used by the rest of the render.
    const socialAnnouncementById = useMemo<Map<string, AnnouncementAdapterShape>>(() => {
        if (!socialBeta) return new Map();
        const map = new Map<string, AnnouncementAdapterShape>();
        for (const entity of socialAnnouncementsState.announcements) {
            const shape = socialEntityToAnnouncementView(entity);
            map.set(shape.id, shape);
        }
        return map;
    }, [socialAnnouncementsState.announcements, socialBeta]);

    const handleAnnouncementReactionToggle = useCallback(
        async (announcementId: string, emoji: string) => {
            const result = await toggleSocialReaction(announcementId, emoji);
            if (result.success) {
                socialAnnouncementsState.refresh();
            }
        },
        [socialAnnouncementsState],
    );

    const refreshAnnouncementsForCards = useCallback(() => {
        if (socialBeta) socialAnnouncementsState.refresh();
    }, [socialBeta, socialAnnouncementsState]);

    const visibleAnnouncements = useMemo(() => {
        return announcements.filter((item) => {
            if (item.revokedAt) return false;
            if (item.expiresAt && new Date(item.expiresAt).getTime() < Number(new Date())) return false;
            return true;
        });
    }, [announcements]);

    useEffect(() => {
        if (!workspace.currentGroupKey) return;
        // View tracking stays on the legacy endpoint regardless of the beta
        // flag — the universal store has no per-entity view counter today.
        // This is an accepted gap documented in the POC report; once Phase 2
        // adds counters to the social model, this fan-out moves over too.
        for (const item of visibleAnnouncements) {
            if (item.viewedAt) continue;
            void markCoordinatorAnnouncementViewed(item.id, workspace.currentGroupKey);
        }
    }, [visibleAnnouncements, workspace.currentGroupKey]);

    const ui = language === 'en'
        ? { title: 'Starosta workspace', announcements: 'Coordinator announcements', content: 'Content management', members: 'Participants', emptyAnnouncements: 'No active coordinator announcements.' }
        : language === 'kz'
            ? { title: 'Староста кеңістігі', announcements: 'Координатор хабарландырулары', content: 'Контентті басқару', members: 'Қатысушылар', emptyAnnouncements: 'Белсенді координатор хабарландырулары жоқ.' }
            : { title: 'Пространство старосты', announcements: 'Объявления координатора', content: 'Управление контентом', members: 'Участники', emptyAnnouncements: 'Нет активных объявлений от координатора.' };
    const normalizedTitle = workspace.currentGroupTitle.trim().toLowerCase();
    const normalizedKey = workspace.currentGroupKey.trim().toLowerCase();
    const groupLine = workspace.currentGroupTitle
        ? (normalizedTitle && normalizedTitle === normalizedKey
            ? workspace.currentGroupTitle
            : `${workspace.currentGroupTitle} • ${workspace.currentGroupKey}`)
        : workspace.currentGroupKey;

    return (
        <main className="px-4 py-4 space-y-6">
            <section className="card p-5 animate-fadeInUp">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold text-fg">{ui.title}</h1>
                        {groupLine ? <p className="text-sm mt-1 text-muted-fg">{groupLine}</p> : null}
                    </div>
                    <div className="flex gap-2 flex-wrap">
                        <a href="#announcements" className="chip">{ui.announcements}</a>
                        <a href="#content" className="chip">{ui.content}</a>
                        <a href="#members" className="chip">{ui.members}</a>
                    </div>
                </div>
            </section>

            <section id="announcements" className="space-y-4">
                <h2 className="text-lg font-semibold text-fg">{ui.announcements}</h2>
                {announcementsLoading ? <div className="card p-6 text-sm animate-fadeInUp text-muted-fg">Loading…</div> : null}
                {!announcementsLoading && visibleAnnouncements.length === 0 ? <div className="card p-6 text-sm animate-fadeInUp text-muted-fg">{ui.emptyAnnouncements}</div> : null}
                {visibleAnnouncements.map((announcement) => {
                    const accent = getAnnouncementAccent(announcement.priority);
                    const socialShape = socialBeta ? socialAnnouncementById.get(announcement.id) : undefined;
                    const showSocialUi = socialBeta && Boolean(socialShape);
                    // Starostas typically do not author announcements, but the
                    // adapter still exposes `authorUserId` so we surface the
                    // attach controls only when the viewer matches. Coordinators
                    // view announcements on a different surface, so we don't
                    // grant the "always editable" branch here.
                    const canEditAttachments = Boolean(userId) && socialShape !== undefined && socialShape.authorUserId === userId;
                    return (
                        <article
                            key={announcement.id}
                            ref={focusHighlight.registerEntityNode(announcement.id)}
                            className={`card p-5 space-y-4 animate-fadeInUp ${focusHighlight.isHighlighted(announcement.id) ? 'entity-highlighted' : ''}`}
                            style={{ border: accent.border }}
                        >
                            {/*
                                View-tracking bridge — fires a single
                                `recordSocialView` after a 2s dwell on this
                                card, gated by `socialBeta`. The legacy
                                `markCoordinatorAnnouncementViewed` fan-out in
                                the parent effect continues to feed the legacy
                                `app_coordinator_announcement_views` table; the
                                two paths are independent on purpose.
                            */}
                            <AnnouncementViewBridge
                                entityId={announcement.id}
                                enabled={socialBeta && !announcement.revokedAt}
                            />
                            <div className="flex items-start justify-between gap-4">
                                <div className="space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h3 className="font-semibold text-fg inline-flex items-center gap-2">
                                            <span>{announcement.title}</span>
                                            {socialBeta && onlineAnnouncementAuthorIds.has(announcement.authorUserId) ? (
                                                <span
                                                    // Author online dot — same shape/colors as
                                                    // `MemberCard` / `PostCard` so the visual
                                                    // language stays consistent. Uses semantic
                                                    // status tokens so every theme adapts.
                                                    aria-label={messages.common.online}
                                                    title={messages.common.online}
                                                    style={{
                                                        display: 'inline-block',
                                                        width: 10,
                                                        height: 10,
                                                        borderRadius: '50%',
                                                        background: 'var(--status-success-color, #2ecc71)',
                                                        border: '2px solid var(--surface-base, #fff)',
                                                        boxSizing: 'border-box',
                                                        flex: '0 0 auto',
                                                    }}
                                                />
                                            ) : null}
                                        </h3>
                                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold uppercase" style={{ background: accent.pillBg, color: accent.pillColor }}>
                                            {announcement.priority}
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-fg">
                                        {new Date(announcement.createdAt).toLocaleString(localeTag(language))}
                                        {announcement.expiresAt ? ` • ${language === 'en' ? 'until' : language === 'kz' ? 'дейін' : 'до'} ${new Date(announcement.expiresAt).toLocaleString(localeTag(language))}` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {showSocialUi ? (
                                        <EntityShareButton
                                            entityId={announcement.id}
                                            entityKind="announcement"
                                            displayTitle={announcement.title}
                                        />
                                    ) : null}
                                    {showSocialUi ? (
                                        <RevisionHistoryButton entityId={announcement.id} />
                                    ) : null}
                                    <span className="w-2 h-12 rounded-full" style={{ background: accent.stripe }} />
                                </div>
                            </div>
                            <p className="text-sm whitespace-pre-wrap text-fg">{announcement.body}</p>
                            {showSocialUi && socialShape ? (
                                <ReactionsBar
                                    reactions={socialShape.reactions.items}
                                    mine={socialShape.reactions.mine}
                                    onToggle={(emoji) => handleAnnouncementReactionToggle(announcement.id, emoji)}
                                />
                            ) : null}
                            {showSocialUi && socialShape && userId ? (
                                <div className="mt-3">
                                    <CommentsThread
                                        entityId={announcement.id}
                                        currentUserId={userId}
                                        onCommentAdded={refreshAnnouncementsForCards}
                                        mentionScope="announcement:global"
                                    />
                                </div>
                            ) : null}
                            {showSocialUi && socialShape && userId ? (
                                <div className="mt-3">
                                    <AttachmentsList
                                        entityId={announcement.id}
                                        currentUserId={userId}
                                        enableEdit={canEditAttachments}
                                    />
                                </div>
                            ) : null}
                        </article>
                    );
                })}
            </section>

            <section id="content" className="space-y-4">
                <div className="flex items-center gap-2 flex-wrap">
                    {[
                        ['feed', 'Лента'],
                        ['tasks', 'Задачи'],
                        ['lessons', 'Доп. занятия'],
                    ].map(([value, label]) => (
                        <button
                            key={value}
                            onClick={() => setContentTab(value as ContentTab)}
                            className="chip"
                            data-active={contentTab === value || undefined}
                            data-size="lg"
                            style={contentTab === value ? { background: 'var(--gradient-primary)', color: '#fff', borderColor: 'transparent' } : undefined}
                            type="button"
                        >
                            {label}
                        </button>
                    ))}
                </div>
                {contentTab === 'feed' && <FeedTab feed={feed} canManage={workspace.canManageContent} groupKey={workspace.currentGroupKey} />}
                {contentTab === 'tasks' && <TasksTab tasksState={tasks} canManage={workspace.canManageContent} groupKey={workspace.currentGroupKey} />}
                {contentTab === 'lessons' && <LessonsTab lessonsState={lessons} canManage={workspace.canManageContent} groupKey={workspace.currentGroupKey} />}
            </section>

            {workspace.canManageMembers ? (
                <section id="members" className="space-y-4">
                    <h2 className="text-lg font-semibold text-fg">{ui.members}</h2>
                    <RequestsTab membersState={members} />
                    <MembersTab membersState={members} catalog={workspace.catalog} canManageMembers={workspace.canManageMembers} groupKey={workspace.currentGroupKey} />
                </section>
            ) : null}
        </main>
    );
}
