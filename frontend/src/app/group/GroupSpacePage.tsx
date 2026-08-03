'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useSocialStream } from '@/lib/use-social-stream';
import {
    formatUnreadBadge,
    useSocialUnread,
} from '@/lib/use-social-unread';
import { markScopeAsRead } from '@/lib/api/social';
import FeedTab from './components/FeedTab';
import FilesAndLinksTab from './components/FilesAndLinksTab';
import LessonsTab from './components/LessonsTab';
import MembersTab from './components/MembersTab';
import RequestsTab from './components/RequestsTab';
import RolesTab from './components/RolesTab';
import TasksTab from './components/TasksTab';
import { useGroupFeed } from './hooks/useGroupFeed';
import { useGroupLessons } from './hooks/useGroupLessons';
import { useGroupMembers } from './hooks/useGroupMembers';
import { useGroupRoles } from './hooks/useGroupRoles';
import { useGroupTasks } from './hooks/useGroupTasks';
import {
    buildGroupScopeKey,
    isGroupUnreadTab,
    shouldBumpGroupScope,
} from './utils/group-tab-unread';
import type { GroupWorkspaceContextValue } from './workspace-types';

type PublicTab = 'feed' | 'tasks' | 'lessons' | 'files' | 'members' | 'requests' | 'roles';

export default function GroupSpacePage({ workspace }: { workspace: GroupWorkspaceContextValue }) {
    const { messages } = useLanguage();
    const { userId } = useAuth();
    const [activeTab, setActiveTab] = useState<PublicTab>('feed');
    const feed = useGroupFeed(workspace.currentGroupKey, workspace.canReadCurrentGroup);
    const tasks = useGroupTasks(workspace.currentGroupKey, workspace.canReadCurrentGroup);
    const lessons = useGroupLessons(workspace.currentGroupKey, workspace.canReadCurrentGroup);
    const members = useGroupMembers(workspace.currentGroupKey, true);
    const roles = useGroupRoles(workspace.currentGroupKey, workspace.canManageRoles);

    // === Read-receipts wiring (socialFeedBeta-gated) =========================
    //
    // The universal social store carries one read cursor per
    // `(user_id, scope_type, scope_id)` triplet — for the group surface that
    // collapses Feed/Tasks/Lessons into a single `group:${groupKey}` scope.
    // When the beta is on we surface a small badge next to those three tab
    // labels driven by `useSocialUnread`. SSE `entity-created` frames bump the
    // count optimistically; the periodic 30s poll authoritatively reconciles.
    //
    // Outside the beta the badge stays dark and no socket / unread call is
    // issued — the existing legacy paths are unchanged.
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const groupScopeKey = useMemo(
        () => buildGroupScopeKey(workspace.currentGroupKey),
        [workspace.currentGroupKey],
    );
    const unreadScopes = useMemo<string[]>(
        () => (socialBeta && groupScopeKey ? [groupScopeKey] : []),
        [socialBeta, groupScopeKey],
    );
    const socialUnread = useSocialUnread(unreadScopes, {
        enabled: socialBeta && groupScopeKey !== null,
    });
    const groupUnreadCount = groupScopeKey
        ? (socialUnread.counts.get(groupScopeKey) ?? 0)
        : 0;

    // SSE bridge — when the beta flag is on we open (or piggyback on) a
    // connection scoped to the current group and convert peer-authored
    // `entity-created` frames into an optimistic `bumpScope` so the badge
    // reacts within ~1 RTT instead of waiting for the next 30s poll. We
    // deliberately do not refresh the feed/tasks/lessons content here — those
    // hooks already maintain their own SSE bridges inside their respective
    // tabs. Our job here is the badge total only.
    useSocialStream({
        scopes: socialBeta && groupScopeKey ? [groupScopeKey] : [],
        enabled: socialBeta && groupScopeKey !== null,
        onEvent: (event) => {
            if (event.type !== 'entity-created') return;
            const eligible = shouldBumpGroupScope({
                socialBeta,
                eventScopeType: event.data.scopeType,
                eventScopeId: event.data.scopeId,
                eventAuthorUserId: event.data.authorUserId,
                groupScopeKey,
                viewerUserId: userId ?? null,
            });
            if (!eligible || !groupScopeKey) return;
            socialUnread.bumpScope(groupScopeKey);
        },
    });

    // Auto-mark-read — whenever the active tab is one of feed/tasks/lessons we
    // schedule a `markScopeAsRead('group', groupKey)` after a 1s dwell. The
    // delay matches the DM auto-mark-read behaviour in DialogsPanel so quick
    // tab-flicking doesn't generate a write per click. `clearScope` drops the
    // local badge immediately; the next 30s poll re-validates against the
    // server. Network errors are non-fatal — the next mark-read attempt will
    // pick up the slack (cursor is advisory).
    const socialUnreadRef = useRef(socialUnread);
    useEffect(() => {
        socialUnreadRef.current = socialUnread;
    }, [socialUnread]);
    useEffect(() => {
        if (!socialBeta) return;
        if (!groupScopeKey) return;
        if (!isGroupUnreadTab(activeTab)) return;
        const groupKey = workspace.currentGroupKey;
        const timer = setTimeout(() => {
            void markScopeAsRead('group', groupKey).then(() => {
                socialUnreadRef.current.clearScope(groupScopeKey);
            }).catch(() => {
                // Non-fatal — the next mark-read attempt picks up the slack.
            });
        }, 1000);
        return () => clearTimeout(timer);
        // `socialUnread` is intentionally excluded — we read the latest helpers
        // through the ref above so we don't re-fire the mark-read on every
        // refresh tick. Including it would defeat the 1s debounce.
    }, [
        socialBeta,
        groupScopeKey,
        activeTab,
        workspace.currentGroupKey,
    ]);

    const tabs = useMemo(() => {
        const result: PublicTab[] = ['feed', 'tasks', 'lessons', 'files', 'members'];
        if (workspace.canManageMembers) result.push('requests');
        if (workspace.canManageRoles) result.push('roles');
        return result;
    }, [workspace.canManageMembers, workspace.canManageRoles]);
    const normalizedTitle = workspace.currentGroupTitle.trim().toLowerCase();
    const normalizedKey = workspace.currentGroupKey.trim().toLowerCase();
    const groupLine = workspace.currentGroupTitle
        ? (normalizedTitle && normalizedTitle === normalizedKey
            ? workspace.currentGroupTitle
            : `${workspace.currentGroupTitle} • ${workspace.currentGroupKey}`)
        : workspace.currentGroupKey;

    // Pre-compute the badge label once — same total across the three social
    // tabs since the read-marker is per group, not per kind. Returns null when
    // the count is zero so the JSX can short-circuit cleanly.
    const tabUnreadLabel = socialBeta ? formatUnreadBadge(groupUnreadCount) : null;

    return (
        <main className="px-4 py-4 space-y-4">
            <section className="card p-5 space-y-4 animate-fadeInUp">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <h1 className="text-2xl font-bold text-fg">{workspace.currentGroupTitle || messages.settings.quickActions.group}</h1>
                        {groupLine ? <p className="text-sm mt-1 text-muted-fg">{groupLine}</p> : null}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {workspace.me.access.roles.map((role) => (
                            <span key={role} className="chip" data-tone="primary">
                                {role}
                            </span>
                        ))}
                    </div>
                </div>
                <div className="flex gap-2 overflow-x-auto">
                    {tabs.map((tab) => {
                        // Only feed/tasks/lessons render the group-scope badge;
                        // files/members/requests/roles carry no social entities.
                        const showBadge = tabUnreadLabel !== null && isGroupUnreadTab(tab);
                        return (
                            <button
                                key={tab}
                                onClick={() => setActiveTab(tab)}
                                className="chip tab-unread-host"
                                data-active={activeTab === tab || undefined}
                                data-size="lg"
                                style={activeTab === tab ? { background: 'var(--gradient-primary)', color: '#fff', borderColor: 'transparent' } : undefined}
                                type="button"
                            >
                                {tab === 'feed' && messages.group.tabFeed}
                                {tab === 'tasks' && messages.group.tabTasks}
                                {tab === 'lessons' && messages.group.tabLessons}
                                {tab === 'files' && messages.group.tabFilesLinks}
                                {tab === 'members' && messages.group.tabMembers}
                                {tab === 'requests' && messages.group.tabRequests}
                                {tab === 'roles' && messages.group.tabRoles}
                                {showBadge ? (
                                    <span
                                        className="tab-unread-badge"
                                        aria-label={`${groupUnreadCount} unread`}
                                    >
                                        {tabUnreadLabel}
                                    </span>
                                ) : null}
                            </button>
                        );
                    })}
                </div>
            </section>

            {activeTab === 'feed' && <FeedTab feed={feed} canManage={workspace.canManageContent} groupKey={workspace.currentGroupKey} />}
            {activeTab === 'tasks' && <TasksTab tasksState={tasks} canManage={workspace.canManageContent} groupKey={workspace.currentGroupKey} />}
            {activeTab === 'lessons' && <LessonsTab lessonsState={lessons} canManage={workspace.canManageContent} groupKey={workspace.currentGroupKey} />}
            {activeTab === 'files' && <FilesAndLinksTab groupKey={workspace.currentGroupKey} canRead={workspace.canReadCurrentGroup} canManage={workspace.canManageContent} />}
            {activeTab === 'members' && <MembersTab membersState={members} catalog={workspace.catalog} canManageMembers={workspace.canManageMembers} groupKey={workspace.currentGroupKey} />}
            {activeTab === 'requests' && workspace.canManageMembers && <RequestsTab membersState={members} />}
            {activeTab === 'roles' && workspace.canManageRoles && <RolesTab rolesState={roles} canAssignStarosta={workspace.canAssignStarosta} />}
        </main>
    );
}
