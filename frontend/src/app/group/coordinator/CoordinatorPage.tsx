'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFocusHighlight } from '@/lib/use-focus-highlight';
import {
    assignAdminGroupRole,
    createAdminGroupSpace,
    getAdminCoordinatorAnnouncements,
    getAdminGroupRoles,
    getAdminGroupSpaces,
    getAdminGroupUserPhone,
    getGroupMembers,
    revokeAdminGroupRole,
    toggleSocialReaction,
    updateAdminGroupSpace,
    type CoordinatorAnnouncementPriority,
    type CoordinatorAnnouncementTargetMode,
    type CoordinatorAnnouncementView,
    type GroupRoleAssignmentView,
    type GroupSpaceSummary,
} from '@/lib/api';
import AttachmentsList from '@/components/AttachmentsList';
import CommentsThread from '@/components/CommentsThread';
import { useAuth } from '@/lib/auth-context';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { forwardPresenceOrTyping, usePresence } from '@/lib/use-presence';
import { useSocialStream } from '@/lib/use-social-stream';
import EntityShareButton from '@/components/EntityShareButton';
import RevisionHistoryButton from '@/components/RevisionHistoryButton';
import AnnouncementViewBridge from '../components/AnnouncementViewBridge';
import GroupFormModal from '../components/GroupFormModal';
import ReactionsBar from '../components/ReactionsBar';
import { useAnnouncementsSocial } from '../hooks/useAnnouncementsSocial';
import {
    createAnnouncementUnified,
    revokeAnnouncementUnified,
    type AnnouncementInput,
} from '../utils/social-announcement-actions';
import {
    socialAnnouncementToCoordinatorView,
    socialEntityToAnnouncementView,
    type AnnouncementAdapterShape,
} from '../utils/social-entity-to-announcement';
import type { GroupWorkspaceContextValue } from '../workspace-types';
import { MemberCard, ResponsibleMemberCard } from './MemberCard';
import { EMPTY_GROUP_STATE, type GroupListFilter, type GroupMembersState, type ManagedRole } from './types';
import { getStatLabels, getUi } from './strings';
import {
    filterMembers,
    getAnnouncementAccent,
    matchesGroupSearch,
    mergeCoordinatorGroups,
    sortGroups,
    sortMembers,
} from './utils';

/**
 * Reverse of `priorityToLegacyEnum` in the announcement adapter — the
 * coordinator UI inputs a legacy `CoordinatorAnnouncementPriority` enum, but
 * the unified write wrapper accepts the social-store union. We collapse
 * `'info'` → `'low'`, `'warning'` → `'high'`, `'critical'` → `'critical'` so
 * the legacy create flow keeps working when the beta flag is on.
 */
function legacyPriorityToSocial(priority: CoordinatorAnnouncementPriority): AnnouncementInput['priority'] {
    switch (priority) {
        case 'info':
            return 'low';
        case 'warning':
            return 'high';
        case 'critical':
            return 'critical';
        default:
            return 'medium';
    }
}

export default function CoordinatorPage({ workspace }: { workspace: GroupWorkspaceContextValue }) {
    const { language, messages } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const focusParam = searchParams?.get('focus') ?? null;
    const focusHighlight = useFocusHighlight(focusParam);
    const { userId } = useAuth();
    const ui = getUi(language);
    const statLabels = getStatLabels(language);
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const [groups, setGroups] = useState<GroupSpaceSummary[]>([]);
    const [roleAssignments, setRoleAssignments] = useState<GroupRoleAssignmentView[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedGroupKey, setExpandedGroupKey] = useState('');
    const [groupQuery, setGroupQuery] = useState('');
    const [groupListFilter, setGroupListFilter] = useState<GroupListFilter>('all');
    const [membersByGroup, setMembersByGroup] = useState<Record<string, GroupMembersState>>({});
    const [memberFilters, setMemberFilters] = useState<Record<string, string>>({});
    const [phoneCache, setPhoneCache] = useState<Record<string, {
        phone: string | null;
        source: 'profile_cache' | 'admin_snapshot' | null;
        missingReason: 'profile_not_cached' | 'phone_not_provided' | null;
    } | undefined>>({});
    const [phoneLoadingUserId, setPhoneLoadingUserId] = useState('');
    const [roleActionKey, setRoleActionKey] = useState('');
    // Legacy read path — populated when `socialBeta` is OFF. When ON we switch
    // to `socialAnnouncements` (back-mapped to the same legacy view shape so
    // the rest of the render code is unchanged).
    const [legacyAnnouncements, setLegacyAnnouncements] = useState<CoordinatorAnnouncementView[]>([]);
    const [legacyAnnouncementsLoading, setLegacyAnnouncementsLoading] = useState(true);
    // Social read path — gated behind the beta flag so we never pay for both
    // requests at once.
    const socialAnnouncementsState = useAnnouncementsSocial({ enabled: socialBeta });
    // Presence bridge for the global announcement scope. We open a parallel
    // SSE connection (the announcements hook above does HTTP-only) and forward
    // `presence-changed` frames into local state so `usePresence` can derive
    // an online roster of announcement authors. Gated by `socialBeta` — when
    // the flag is off no socket is opened and the roster stays empty, so the
    // legacy path never shows the dot. Mirrors the bridge pattern used by
    // `MembersTab` / `FeedTab`.
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
    const [announcementSubmitting, setAnnouncementSubmitting] = useState(false);
    const [announcementTitle, setAnnouncementTitle] = useState('');
    const [announcementBody, setAnnouncementBody] = useState('');
    const [announcementPriority, setAnnouncementPriority] = useState<CoordinatorAnnouncementPriority>('info');
    const [announcementTargetMode, setAnnouncementTargetMode] = useState<CoordinatorAnnouncementTargetMode>('all_starostas');
    const [announcementTargetGroups, setAnnouncementTargetGroups] = useState<string[]>([]);
    const [announcementExpiresAt, setAnnouncementExpiresAt] = useState('');
    const [groupModalOpen, setGroupModalOpen] = useState(false);
    const [groupEditModalOpen, setGroupEditModalOpen] = useState(false);
    const membersByGroupRef = useRef<Record<string, GroupMembersState>>({});
    const memberLoadsInFlightRef = useRef<Set<string>>(new Set());
    const deferredGroupQuery = useDeferredValue(groupQuery);

    // Render-side selector — when beta is on, project the social entities back
    // into the legacy view shape so the existing JSX keeps working. When off,
    // pass the legacy list straight through. View counts are zeroed under
    // beta (the universal store has no per-entity view counter today); the
    // legacy `markCoordinatorAnnouncementViewed` endpoint is still the
    // authoritative source on the starosta surface.
    const announcements = useMemo<CoordinatorAnnouncementView[]>(() => {
        if (socialBeta) {
            return socialAnnouncementsState.announcements.map((entity) =>
                socialAnnouncementToCoordinatorView(socialEntityToAnnouncementView(entity)),
            );
        }
        return legacyAnnouncements;
    }, [legacyAnnouncements, socialAnnouncementsState.announcements, socialBeta]);
    const announcementsLoading = socialBeta ? socialAnnouncementsState.isLoading : legacyAnnouncementsLoading;

    // When beta is on, build an id→adapter-shape lookup so the announcement
    // render can surface reactions / comments / attachments alongside the
    // legacy-shaped projection used by everything else on this page. The
    // adapter shape carries the social-side fields (reactions envelope,
    // raw social_entity id) that the legacy view shape intentionally omits.
    const socialAnnouncementById = useMemo<Map<string, AnnouncementAdapterShape>>(() => {
        if (!socialBeta) return new Map();
        const map = new Map<string, AnnouncementAdapterShape>();
        for (const entity of socialAnnouncementsState.announcements) {
            const shape = socialEntityToAnnouncementView(entity);
            map.set(shape.id, shape);
        }
        return map;
    }, [socialAnnouncementsState.announcements, socialBeta]);

    // Reaction toggle for the announcement card. `toggleSocialReaction` is
    // safe to call on any entity id (the universal store has no per-kind
    // restriction); we refresh the announcement list on success so the
    // aggregate counts reflect the server's reply.
    const handleAnnouncementReactionToggle = useCallback(
        async (announcementId: string, emoji: string) => {
            const result = await toggleSocialReaction(announcementId, emoji);
            if (result.success) {
                socialAnnouncementsState.refresh();
            }
        },
        [socialAnnouncementsState],
    );

    // Stable callback for the embedded `CommentsThread` — lets the thread
    // signal the parent to re-fetch aggregates after a successful post. We
    // only refresh on the social path because the legacy list has no
    // comment surface.
    const refreshAnnouncementsForCards = useCallback(() => {
        if (socialBeta) socialAnnouncementsState.refresh();
    }, [socialBeta, socialAnnouncementsState]);

    const refreshDashboard = useCallback(async () => {
        setLoading(true);
        setError('');
        // Always pull groups + roles. Announcements come from the social
        // hook when beta is on (it self-refreshes via its own effect, and we
        // call `refresh()` after writes); when off, we still hit the legacy
        // admin endpoint here.
        const announcementsPromise = socialBeta
            ? Promise.resolve(null)
            : getAdminCoordinatorAnnouncements();
        const [groupsRes, rolesRes, announcementsRes] = await Promise.all([
            getAdminGroupSpaces(),
            getAdminGroupRoles(),
            announcementsPromise,
        ]);

        if (!groupsRes.success) {
            setError(groupsRes.error || ui.loadFailed);
            setLoading(false);
            setLegacyAnnouncementsLoading(false);
            return;
        }

        const nextGroups = mergeCoordinatorGroups(workspace.catalog, groupsRes.data?.groups || []);
        setGroups(nextGroups);
        setRoleAssignments(rolesRes.success ? (rolesRes.data?.assignments || []) : []);
        if (!socialBeta && announcementsRes) {
            setLegacyAnnouncements(announcementsRes.success ? (announcementsRes.data?.announcements || []) : []);
            setLegacyAnnouncementsLoading(false);
        }
        setLoading(false);
    }, [socialBeta, ui.loadFailed, workspace.catalog]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void refreshDashboard();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [refreshDashboard]);

    useEffect(() => {
        membersByGroupRef.current = membersByGroup;
    }, [membersByGroup]);

    const loadMembersForGroup = useCallback(async (groupKey: string, force = false) => {
        const currentState = membersByGroupRef.current[groupKey];
        if (!force && (currentState?.members.length || memberLoadsInFlightRef.current.has(groupKey))) {
            return;
        }

        memberLoadsInFlightRef.current.add(groupKey);

        setMembersByGroup((current) => ({
            ...current,
            [groupKey]: {
                loading: true,
                error: '',
                members: current[groupKey]?.members || [],
            },
        }));

        const result = await getGroupMembers(groupKey);
        memberLoadsInFlightRef.current.delete(groupKey);
        setMembersByGroup((current) => ({
            ...current,
            [groupKey]: {
                loading: false,
                error: result.success ? '' : (result.error || 'Failed to load members'),
                members: result.success ? sortMembers(result.data?.members || []) : [],
            },
        }));
    }, []);

    useEffect(() => {
        if (!expandedGroupKey) return;
        const timer = window.setTimeout(() => {
            void loadMembersForGroup(expandedGroupKey);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [expandedGroupKey, loadMembersForGroup]);

    const displayGroups = useMemo(() => {
        const roleMap = new Map<string, { starostas: string[]; helpers: string[] }>();

        for (const assignment of roleAssignments) {
            if (assignment.scopeType !== 'group') continue;
            const entry = roleMap.get(assignment.scopeId) || { starostas: [], helpers: [] };
            if (assignment.roleId === 'starosta' && !entry.starostas.includes(assignment.userId)) {
                entry.starostas.push(assignment.userId);
            }
            if (assignment.roleId === 'helper' && !entry.helpers.includes(assignment.userId)) {
                entry.helpers.push(assignment.userId);
            }
            roleMap.set(assignment.scopeId, entry);
        }

        return sortGroups(groups.map((group) => {
            const membersState = membersByGroup[group.groupKey];
            const roleEntry = roleMap.get(group.groupKey);
            return {
                ...group,
                memberCount: membersState?.members.length ?? group.memberCount,
                starostas: roleEntry?.starostas || group.starostas,
                helpers: roleEntry?.helpers || group.helpers,
            };
        }));
    }, [groups, membersByGroup, roleAssignments]);

    const expandedGroup = useMemo(
        () => displayGroups.find((group) => group.groupKey === expandedGroupKey) || null,
        [displayGroups, expandedGroupKey]
    );

    const visibleGroups = useMemo(() => {
        return displayGroups.filter((group) => {
            if (!matchesGroupSearch(group, deferredGroupQuery)) return false;

            switch (groupListFilter) {
                case 'with_roles':
                    return group.starostas.length > 0 || group.helpers.length > 0;
                case 'without_starosta':
                    return group.memberCount > 0 && group.starostas.length === 0;
                case 'without_helper':
                    return group.memberCount > 0 && group.helpers.length === 0;
                case 'with_members':
                    return group.memberCount > 0;
                case 'empty':
                    return group.memberCount === 0;
                default:
                    return true;
            }
        });
    }, [deferredGroupQuery, displayGroups, groupListFilter]);

    const problemGroups = useMemo(() => {
        const withoutStarosta = displayGroups.filter((group) => group.memberCount > 0 && group.starostas.length === 0);
        const withoutHelper = displayGroups.filter((group) => group.memberCount > 0 && group.helpers.length === 0);
        const empty = displayGroups.filter((group) => group.memberCount === 0);
        return {
            withoutStarosta,
            withoutHelper,
            empty,
        };
    }, [displayGroups]);

    useEffect(() => {
        if (!expandedGroupKey) return;
        if (visibleGroups.some((group) => group.groupKey === expandedGroupKey)) return;
        const timer = window.setTimeout(() => {
            setExpandedGroupKey('');
        }, 0);
        return () => window.clearTimeout(timer);
    }, [expandedGroupKey, visibleGroups]);

    const stats = useMemo(() => {
        const activeRoles = roleAssignments.length;
        const coordinatorAssignments = roleAssignments.filter((assignment) => assignment.roleId === 'coordinator' || assignment.roleId === 'curator').length;
        return {
            groups: displayGroups.length,
            coordinators: Math.max(coordinatorAssignments, workspace.me.access.roles.some((role) => role === 'coordinator' || role === 'curator') ? 1 : 0),
            activeRoles,
            announcements: announcements.filter((item) => !item.revokedAt).length,
        };
    }, [announcements, displayGroups.length, roleAssignments, workspace.me.access.roles]);

    const toggleTargetGroup = (groupKey: string) => {
        setAnnouncementTargetGroups((current) => (
            current.includes(groupKey)
                ? current.filter((item) => item !== groupKey)
                : [...current, groupKey]
        ));
    };

    const handlePhoneReveal = async (userId: string) => {
        if (phoneCache[userId] !== undefined) return;
        setPhoneLoadingUserId(userId);
        const result = await getAdminGroupUserPhone(userId);
        setPhoneCache((current) => ({
            ...current,
            [userId]: result.success
                ? {
                    phone: result.data?.phone ?? null,
                    source: result.data?.source ?? null,
                    missingReason: result.data?.missingReason ?? null,
                }
                : {
                    phone: null,
                    source: null,
                    missingReason: null,
                },
        }));
        setPhoneLoadingUserId('');
    };

    const handleRoleToggle = async (groupKey: string, userId: string, roleId: ManagedRole, enabled: boolean) => {
        const actionKey = `${groupKey}:${userId}:${roleId}:${enabled ? 'assign' : 'revoke'}`;
        setRoleActionKey(actionKey);
        const result = enabled
            ? await assignAdminGroupRole(userId, roleId, groupKey)
            : await revokeAdminGroupRole(userId, roleId, groupKey);

        if (result.success) {
            await Promise.all([refreshDashboard(), loadMembersForGroup(groupKey, true)]);
        }
        setRoleActionKey('');
    };

    const handleAnnouncementSubmit = async () => {
        const title = announcementTitle.trim();
        const body = announcementBody.trim();
        if (!title || !body) return;

        setAnnouncementSubmitting(true);
        // Unified write wrapper handles both paths. The legacy `targetMode`
        // flag is derived from `targetGroups` presence inside the wrapper, so
        // we only need to forward the array (or an empty one when broadcasting).
        const targetGroups = announcementTargetMode === 'groups' ? announcementTargetGroups : [];
        const result = await createAnnouncementUnified(
            {
                title,
                body,
                priority: legacyPriorityToSocial(announcementPriority),
                targetGroups,
                expiresAt: announcementExpiresAt || undefined,
            },
            socialBeta,
        );

        if (result.success) {
            setAnnouncementTitle('');
            setAnnouncementBody('');
            setAnnouncementPriority('info');
            setAnnouncementTargetMode('all_starostas');
            setAnnouncementTargetGroups([]);
            setAnnouncementExpiresAt('');
            await refreshDashboard();
            if (socialBeta) socialAnnouncementsState.refresh();
        }
        setAnnouncementSubmitting(false);
    };

    const handleAnnouncementRevoke = async (announcementId: string) => {
        const result = await revokeAnnouncementUnified(announcementId, socialBeta);
        if (result.success) {
            await refreshDashboard();
            if (socialBeta) socialAnnouncementsState.refresh();
        }
    };

    const renderVisibleMembers = (group: GroupSpaceSummary) => {
        const membersState = membersByGroup[group.groupKey] || EMPTY_GROUP_STATE;
        const visibleMembers = filterMembers(membersState.members, memberFilters[group.groupKey] || '');

        if (membersState.loading) {
            return <p className="text-sm text-muted-fg">{ui.loading}</p>;
        }
        if (membersState.error) {
            return <p className="text-sm text-danger-fg">{membersState.error}</p>;
        }
        if (visibleMembers.length === 0) {
            return <p className="text-sm text-muted-fg">{ui.noMembers}</p>;
        }

        return (
            <div className="space-y-3">
                {visibleMembers.map((member) => (
                    <MemberCard
                        key={`${group.groupKey}-${member.userId}`}
                        group={group}
                        member={member}
                        ui={ui}
                        locale={localeTag(language)}
                        phoneCache={phoneCache[member.userId]}
                        phoneLoadingUserId={phoneLoadingUserId}
                        roleActionKey={roleActionKey}
                        onRoleToggle={(groupKey, userId, roleId, enabled) => { void handleRoleToggle(groupKey, userId, roleId, enabled); }}
                        onPhoneReveal={(userId) => { void handlePhoneReveal(userId); }}
                    />
                ))}
            </div>
        );
    };

    const renderResponsibleMembers = (group: GroupSpaceSummary) => {
        const membersState = membersByGroup[group.groupKey] || EMPTY_GROUP_STATE;
        const roleMembers = membersState.members.filter((member) => member.roles.includes('starosta') || member.roles.includes('helper'));

        if (membersState.loading) {
            return <p className="text-sm text-muted-fg">{ui.loading}</p>;
        }

        if (roleMembers.length === 0) {
            return <p className="text-sm text-muted-fg">{ui.noResponsibles}</p>;
        }

        return (
            <div className="grid gap-3 md:grid-cols-2">
                {roleMembers.map((member) => (
                    <ResponsibleMemberCard
                        key={`${group.groupKey}:responsible:${member.userId}`}
                        member={member}
                        ui={ui}
                    />
                ))}
            </div>
        );
    };

    return (
        <main className="relative overflow-hidden px-4 py-3 space-y-4" data-workspace-mode={workspace.mode}>
            <div className="pointer-events-none absolute inset-x-0 top-0 h-[320px] overflow-hidden">
                <div className="absolute -left-20 top-0 h-44 w-44 rounded-full blur-3xl" style={{ background: 'rgba(var(--status-info-rgb), 0.16)' }} />
                <div className="absolute right-0 top-8 h-52 w-52 rounded-full blur-3xl" style={{ background: 'rgba(var(--primary-rgb), 0.18)' }} />
                <div className="absolute left-1/3 top-20 h-36 w-36 rounded-full blur-3xl" style={{ background: 'rgba(var(--good-rgb), 0.1)' }} />
            </div>

            <section className="workspace-hero relative overflow-hidden p-4 sm:p-5 animate-fadeInUp">
                <div className="absolute inset-0 opacity-60" style={{ background: 'radial-gradient(circle at top right, rgba(255,255,255,0.12), transparent 34%), radial-gradient(circle at bottom left, rgba(var(--status-info-rgb), 0.18), transparent 28%)' }} />
                <div className="relative grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.72fr)]">
                    <div className="space-y-3">
                        <div className="inline-flex items-center gap-2 chip uppercase tracking-[0.22em]" data-tone="muted">
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--good)', boxShadow: '0 0 12px rgba(var(--good-rgb), 0.6)' }} />
                            {statLabels.mode}
                        </div>
                        <div className="space-y-2 max-w-3xl">
                            <h1 className="text-[30px] sm:text-[34px] font-bold tracking-[-0.04em] leading-tight" style={{ color: '#f8fbff' }}>{ui.title}</h1>
                            <p className="text-sm sm:text-[14px] leading-6 max-w-2xl" style={{ color: 'rgba(226,232,240,0.82)' }}>{ui.subtitle}</p>
                        </div>
                    </div>

                    <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-1">
                        <div className="workspace-glass p-3.5 sm:p-4" style={{ backdropFilter: 'blur(18px)' }}>
                            <div className="text-[11px] uppercase tracking-[0.18em]" style={{ color: 'rgba(191,219,254,0.74)' }}>{statLabels.focus}</div>
                            <div className="mt-2 text-base font-semibold tracking-[-0.03em]" style={{ color: '#fff' }}>{expandedGroup?.title || statLabels.focusFallback}</div>
                            <div className="mt-1.5 text-sm leading-5" style={{ color: 'rgba(226,232,240,0.72)' }}>
                                {expandedGroup ? `${expandedGroup.groupKey} • ${expandedGroup.memberCount} ${ui.members.toLowerCase()}` : statLabels.urgentDetail}
                            </div>
                        </div>
                        <div className="flex flex-col gap-2.5 sm:items-end xl:items-stretch">
                            <button onClick={() => setGroupModalOpen(true)} className="btn btn-primary px-4 py-2.5 text-sm" type="button">
                                {ui.createGroup}
                            </button>
                            {expandedGroup ? (
                                <button onClick={() => router.push(`/group?groupKey=${encodeURIComponent(expandedGroup.groupKey)}`)} className="chip" data-tone="muted" data-size="lg" type="button">
                                    {ui.openSpace}
                                </button>
                            ) : null}
                        </div>
                    </div>
                </div>

                <div className="relative grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4 mt-4">
                    {[
                        [ui.groups, stats.groups, 'rgba(var(--primary-rgb), 0.18)'],
                        [statLabels.coordinators, stats.coordinators, 'rgba(var(--status-info-rgb), 0.16)'],
                        [statLabels.activeRoles, stats.activeRoles, 'rgba(var(--good-rgb), 0.16)'],
                        [statLabels.announcements, stats.announcements, 'rgba(var(--status-warning-rgb), 0.16)'],
                    ].map(([label, value, accent]) => (
                        <div key={String(label)} className="workspace-glass px-3.5 py-3">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-[10px] uppercase tracking-[0.2em]" style={{ color: 'rgba(191,219,254,0.76)' }}>{label}</div>
                                <span className="h-2 w-2 rounded-full" style={{ background: String(accent) }} />
                            </div>
                            <div className="text-2xl font-semibold tracking-[-0.04em] mt-2" style={{ color: '#fff' }}>{value}</div>
                        </div>
                    ))}
                </div>
            </section>

            {error ? <section className="card p-4"><p className="text-sm text-danger-fg">{error}</p></section> : null}

            <section className="card p-4 animate-fadeInUp overflow-hidden" style={{ animationDelay: '20ms', background: 'linear-gradient(180deg, rgba(30,41,81,0.72), rgba(15,23,42,0.52))', border: '1px solid rgba(148,163,184,0.1)' }}>
                <div className="space-y-2">
                    <h2 className="text-base font-semibold text-fg">{ui.oversight}</h2>
                    <p className="text-sm text-muted-fg">{ui.oversightHint}</p>
                </div>

                <div className="grid gap-2.5 md:grid-cols-3 mt-3.5">
                    {([
                        ['without_starosta', ui.filterWithoutStarosta, problemGroups.withoutStarosta.length, 'rgba(var(--status-danger-rgb), 0.16)', 'var(--danger)'],
                        ['without_helper', ui.filterWithoutHelper, problemGroups.withoutHelper.length, 'rgba(var(--status-warning-rgb), 0.16)', 'rgb(253,230,138)'],
                        ['empty', ui.filterEmpty, problemGroups.empty.length, 'rgba(148,163,184,0.16)', 'rgb(226,232,240)'],
                    ] as Array<[GroupListFilter, string, number, string, string]>).map(([value, label, count, background, color]) => (
                        <button
                            key={value}
                            onClick={() => setGroupListFilter(value)}
                            className="rounded-[20px] px-3.5 py-3 text-left transition-transform hover:-translate-y-0.5"
                            style={{
                                background: `linear-gradient(180deg, ${background}, rgba(15,23,42,0.42))`,
                                border: groupListFilter === value ? '1px solid rgba(var(--primary-rgb), 0.45)' : '1px solid rgba(255,255,255,0.06)',
                            }}
                        >
                            <div className="text-xs uppercase tracking-[0.16em]" style={{ color }}>{label}</div>
                            <div className="text-xl font-semibold mt-1.5 text-fg">{count}</div>
                        </button>
                    ))}
                </div>
            </section>

            <section className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.9fr)]">
                <div className="space-y-4">
                    <section className="card p-5 animate-fadeInUp" style={{ animationDelay: '40ms', background: 'linear-gradient(180deg, rgba(20,29,55,0.72), rgba(8,13,28,0.62))', border: '1px solid rgba(148,163,184,0.1)' }}>
                        <div className="flex items-end justify-between gap-4 flex-wrap">
                            <div>
                                <h2 className="text-xl font-semibold tracking-[-0.03em] text-fg">{ui.groups}</h2>
                                <p className="text-sm mt-1 text-muted-fg">{ui.groupsHint}</p>
                            </div>
                            {expandedGroup ? (
                                <button onClick={() => router.push(`/group?groupKey=${encodeURIComponent(expandedGroup.groupKey)}`)} className="chip" data-tone="primary" data-size="lg" type="button">
                                    {ui.openSpace}
                                </button>
                            ) : null}
                        </div>

                        <div className="mt-5 rounded-[28px] p-3 sm:p-4 space-y-3" style={{ background: 'rgba(6,10,24,0.34)', border: '1px solid rgba(148,163,184,0.08)' }}>
                            <input
                                value={groupQuery}
                                onChange={(event) => setGroupQuery(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Escape' && groupQuery) { event.preventDefault(); setGroupQuery(''); } }}
                                placeholder={ui.groupSearch}
                                className="input text-sm"
                            />
                            <div className="flex gap-2 flex-wrap">
                                {([
                                    ['all', ui.filterAll],
                                    ['with_roles', ui.filterWithRoles],
                                    ['without_starosta', ui.filterWithoutStarosta],
                                    ['without_helper', ui.filterWithoutHelper],
                                    ['with_members', ui.filterWithMembers],
                                    ['empty', ui.filterEmpty],
                                ] as Array<[GroupListFilter, string]>).map(([value, label]) => (
                                    <button
                                        key={value}
                                        onClick={() => setGroupListFilter(value)}
                                        className="px-3 py-2 rounded-xl text-sm font-medium"
                                        style={{
                                            background: groupListFilter === value ? 'var(--gradient-primary)' : 'rgba(255,255,255,0.05)',
                                            color: groupListFilter === value ? '#fff' : 'var(--muted)',
                                        }}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="mt-5 space-y-3">
                            {loading ? <p className="text-sm text-muted-fg">{ui.loading}</p> : null}
                            {!loading && visibleGroups.length === 0 ? <p className="text-sm text-muted-fg">{ui.noGroups}</p> : null}
                            {visibleGroups.map((group) => {
                                const isExpanded = group.groupKey === expandedGroupKey;
                                const needsAttention = group.memberCount > 0 && (group.starostas.length === 0 || group.helpers.length === 0);
                                const accentStripe = group.memberCount === 0
                                    ? 'linear-gradient(180deg, rgba(148,163,184,0.8), rgba(100,116,139,0.24))'
                                    : needsAttention
                                        ? 'linear-gradient(180deg, rgba(var(--status-warning-rgb), 0.9), rgba(var(--status-danger-rgb), 0.3))'
                                        : 'linear-gradient(180deg, rgba(59,130,246,0.9), rgba(var(--good-rgb), 0.35))';
                                return (
                                    <article
                                        key={group.groupKey}
                                        className="relative rounded-[30px] overflow-hidden transition-all"
                                        style={{
                                            border: isExpanded ? '1px solid rgba(var(--primary-rgb), 0.3)' : '1px solid rgba(148,163,184,0.1)',
                                            background: isExpanded
                                                ? 'linear-gradient(180deg, rgba(var(--primary-rgb), 0.1), rgba(255,255,255,0.02))'
                                                : 'linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.02))',
                                            boxShadow: isExpanded ? '0 18px 42px rgba(15,23,42,0.24)' : 'none',
                                        }}
                                    >
                                        <div className="absolute left-0 top-0 h-full w-1.5" style={{ background: accentStripe }} />
                                        <div className="p-4 sm:p-5 pl-6">
                                            <div className="flex items-start justify-between gap-4 flex-wrap">
                                                <div className="space-y-2 min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h3 className="text-lg font-semibold tracking-[-0.03em] text-fg">{group.title}</h3>
                                                        <span className="chip" data-tone="muted">{group.groupKey}</span>
                                                        {needsAttention ? (
                                                            <span className="chip" data-tone="warning">
                                                                {statLabels.urgent}
                                                            </span>
                                                        ) : null}
                                                    </div>
                                                    <div className="flex gap-2 flex-wrap text-xs">
                                                        <span className="chip" data-tone="muted">{group.memberCount} {ui.members.toLowerCase()}</span>
                                                        <span className="chip" data-tone="primary">{group.starostas.length} {ui.starosta.toLowerCase()}</span>
                                                        <span className="chip" data-tone="success">{group.helpers.length} {ui.helper.toLowerCase()}</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <button type="button" onClick={() => { setExpandedGroupKey(isExpanded ? '' : group.groupKey); if (!isExpanded) void loadMembersForGroup(group.groupKey); }} className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.08)' }}>
                                                        {isExpanded ? ui.collapse : ui.expand}
                                                    </button>
                                                    <button type="button" onClick={() => { setExpandedGroupKey(group.groupKey); setGroupEditModalOpen(true); }} className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                                        {ui.editGroup}
                                                    </button>
                                                </div>
                                            </div>

                                            {isExpanded ? (
                                                <div className="mt-5 pt-5 grid gap-4 xl:grid-cols-[minmax(260px,0.65fr)_minmax(0,1.35fr)]" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                                                    <div className="rounded-[24px] p-4 space-y-3" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(148,163,184,0.08)' }}>
                                                        <h4 className="text-sm font-semibold uppercase tracking-[0.16em]" style={{ color: 'rgba(191,219,254,0.78)' }}>{ui.responsibles}</h4>
                                                        {renderResponsibleMembers(group)}
                                                    </div>
                                                    <div className="rounded-[24px] p-4 space-y-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(148,163,184,0.08)' }}>
                                                        <div className="flex items-center justify-between gap-3 flex-wrap">
                                                            <h4 className="text-sm font-semibold uppercase tracking-[0.16em]" style={{ color: 'rgba(191,219,254,0.78)' }}>{ui.members}</h4>
                                                            <input
                                                                value={memberFilters[group.groupKey] || ''}
                                                                onChange={(event) => setMemberFilters((current) => ({ ...current, [group.groupKey]: event.target.value }))}
                                                                placeholder={ui.memberFilter}
                                                                className="input sm:w-72 text-sm"
                                                            />
                                                        </div>
                                                        {renderVisibleMembers(group)}
                                                    </div>
                                                </div>
                                            ) : null}
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                </div>

                <div className="space-y-4 xl:sticky xl:top-24 self-start">
                    <section className="card p-5 animate-fadeInUp overflow-hidden" style={{ animationDelay: '80ms', background: 'linear-gradient(180deg, rgba(28,39,78,0.78), rgba(9,14,30,0.68))', border: '1px solid rgba(148,163,184,0.1)' }}>
                        <div className="space-y-2">
                            <h2 className="text-xl font-semibold tracking-[-0.03em] text-fg">{ui.broadcasts}</h2>
                            <p className="text-sm text-muted-fg">{ui.broadcastsHint}</p>
                        </div>

                        <div className="space-y-4 mt-5">
                            <label className="block space-y-2">
                                <span className="text-sm font-medium text-fg">{ui.announcementTitle}</span>
                                <input value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} className="input" />
                            </label>

                            <label className="block space-y-2">
                                <span className="text-sm font-medium text-fg">{ui.announcementBody}</span>
                                <textarea value={announcementBody} onChange={(event) => setAnnouncementBody(event.target.value)} rows={5} className="input resize-y" />
                            </label>

                            <div className="grid gap-3 sm:grid-cols-2">
                                <label className="block space-y-2">
                                    <span className="text-sm font-medium text-fg">{ui.announcementPriority}</span>
                                    <select value={announcementPriority} onChange={(event) => setAnnouncementPriority(event.target.value as CoordinatorAnnouncementPriority)} className="input">
                                        <option value="info">{ui.priorityInfo}</option>
                                        <option value="warning">{ui.priorityWarning}</option>
                                        <option value="critical">{ui.priorityCritical}</option>
                                    </select>
                                </label>

                                <label className="block space-y-2">
                                    <span className="text-sm font-medium text-fg">{ui.expiresAt}</span>
                                    <input type="datetime-local" value={announcementExpiresAt} onChange={(event) => setAnnouncementExpiresAt(event.target.value)} className="input" />
                                </label>
                            </div>

                            <div className="space-y-3">
                                <span className="text-sm font-medium text-fg">{ui.announcementTargeting}</span>
                                <div className="flex gap-2 flex-wrap">
                                    {[['all_starostas', ui.allStarostas], ['groups', ui.selectedGroups]].map(([value, label]) => (
                                        <button key={value} type="button" onClick={() => setAnnouncementTargetMode(value as CoordinatorAnnouncementTargetMode)} className="px-4 py-2 rounded-xl text-sm font-medium" style={{ background: announcementTargetMode === value ? 'var(--gradient-primary)' : 'rgba(255,255,255,0.05)', color: announcementTargetMode === value ? '#fff' : 'var(--muted)' }}>
                                            {label}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {announcementTargetMode === 'groups' ? (
                                <div className="rounded-[24px] p-4 space-y-3" style={{ border: '1px solid var(--border)', background: 'rgba(255,255,255,0.03)' }}>
                                    <div className="text-sm font-medium text-fg">{ui.targetedGroups}</div>
                                    <div className="flex gap-2 flex-wrap">
                                        {displayGroups.map((group) => {
                                            const checked = announcementTargetGroups.includes(group.groupKey);
                                            return (
                                                <button key={`announcement-target-${group.groupKey}`} type="button" onClick={() => toggleTargetGroup(group.groupKey)} className="px-3 py-2 rounded-xl text-sm font-medium" style={{ background: checked ? 'rgba(var(--primary-rgb), 0.16)' : 'rgba(255,255,255,0.05)', color: checked ? 'var(--primary)' : 'var(--muted)' }}>
                                                    {group.title}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : null}

                            <button onClick={() => void handleAnnouncementSubmit()} disabled={announcementSubmitting || !announcementTitle.trim() || !announcementBody.trim() || (announcementTargetMode === 'groups' && announcementTargetGroups.length === 0)} className="btn btn-primary w-full py-3 disabled:opacity-60" type="button">
                                {announcementSubmitting ? ui.loading : ui.publish}
                            </button>
                        </div>
                    </section>

                    <section className="card p-5 animate-fadeInUp" style={{ animationDelay: '120ms', background: 'linear-gradient(180deg, rgba(17,24,39,0.72), rgba(9,14,28,0.62))', border: '1px solid rgba(148,163,184,0.1)' }}>
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold text-fg">{ui.recentAnnouncements}</h2>
                            {announcementsLoading ? <span className="text-xs text-muted-fg">{ui.loading}</span> : null}
                        </div>

                        <div className="space-y-3 mt-4">
                            {!announcementsLoading && announcements.length === 0 ? <p className="text-sm text-muted-fg">{ui.noAnnouncements}</p> : null}
                            {announcements.map((announcement) => {
                                const accent = getAnnouncementAccent(announcement.priority);
                                const status = announcement.revokedAt ? ui.revoked : (announcement.expiresAt && new Date(announcement.expiresAt).getTime() < Number(new Date()) ? ui.expired : ui.active);
                                // Social-side companion shape — present only when the beta
                                // read path is live AND this announcement's id maps back to
                                // a universal entity. When the flag is off we never render
                                // reactions / comments / attachments because the id is the
                                // legacy `app_coordinator_announcements.id`, not the social
                                // entity id the universal endpoints expect.
                                const socialShape = socialBeta ? socialAnnouncementById.get(announcement.id) : undefined;
                                const showSocialUi = socialBeta && Boolean(socialShape) && !announcement.revokedAt;
                                const canEditAttachments = workspace.isCoordinator || (Boolean(userId) && announcement.authorUserId === userId);
                                return (
                                    <article
                                        key={announcement.id}
                                        ref={focusHighlight.registerEntityNode(announcement.id)}
                                        className={`rounded-3xl p-4 space-y-3 surface-overlay-1 ${focusHighlight.isHighlighted(announcement.id) ? 'entity-highlighted' : ''}`}
                                        style={{ border: accent.border, boxShadow: accent.glow }}
                                    >
                                        {/*
                                            View-tracking bridge — fires a
                                            single `recordSocialView` after a
                                            2s dwell on this card, gated by
                                            `socialBeta`. Drives the universal
                                            `viewCount` aggregate; the legacy
                                            view path stays untouched.
                                        */}
                                        <AnnouncementViewBridge
                                            entityId={announcement.id}
                                            enabled={socialBeta && !announcement.revokedAt}
                                        />
                                        <div className="flex items-start justify-between gap-3">
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
                                                    <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{ background: accent.pillBg, color: accent.pillColor }}>{announcement.priority}</span>
                                                    <span className="chip" data-tone="muted" data-size="sm">{status}</span>
                                                </div>
                                                <p className="text-sm whitespace-pre-wrap text-fg">{announcement.body}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {socialBeta && socialShape ? (
                                                    <EntityShareButton
                                                        entityId={announcement.id}
                                                        entityKind="announcement"
                                                        displayTitle={announcement.title}
                                                    />
                                                ) : null}
                                                {socialBeta && socialShape ? (
                                                    <RevisionHistoryButton entityId={announcement.id} />
                                                ) : null}
                                                {!announcement.revokedAt ? (
                                                    <button onClick={() => void handleAnnouncementRevoke(announcement.id)} className="chip" data-tone="danger" data-size="lg" type="button">
                                                        {ui.revokeAnnouncement}
                                                    </button>
                                                ) : null}
                                            </div>
                                        </div>

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

                                        <div className="flex gap-2 flex-wrap text-xs text-muted-fg">
                                            <span>{ui.createdAt}: {new Date(announcement.createdAt).toLocaleString(localeTag(language))}</span>
                                            <span>{ui.viewCount}: {announcement.viewCount}</span>
                                            <span>{announcement.targetMode === 'all_starostas' ? ui.allGroupsBadge : `${ui.targetedGroups}: ${announcement.targetGroups.join(', ')}`}</span>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    </section>
                </div>
            </section>

            <GroupFormModal
                open={groupModalOpen}
                title={ui.createGroup}
                submitLabel={ui.createGroup}
                onCancel={() => setGroupModalOpen(false)}
                onSubmit={async (values) => {
                    const nextGroupKey = String(values.groupKey || '').trim();
                    const result = await createAdminGroupSpace(nextGroupKey, String(values.title || ''));
                    if (result.success) {
                        await Promise.all([refreshDashboard(), workspace.refreshBase()]);
                        setExpandedGroupKey(nextGroupKey.toUpperCase());
                    }
                    setGroupModalOpen(false);
                }}
                fields={[
                    { name: 'title', label: ui.groupTitle, type: 'text', required: true },
                    { name: 'groupKey', label: ui.groupKey, type: 'text', required: true },
                ]}
            />

            <GroupFormModal
                open={groupEditModalOpen}
                title={ui.editGroup}
                submitLabel={ui.save}
                onCancel={() => setGroupEditModalOpen(false)}
                onSubmit={async (values) => {
                    if (!expandedGroup) return;
                    const result = await updateAdminGroupSpace(expandedGroup.groupKey, String(values.title || ''));
                    if (result.success) {
                        await Promise.all([refreshDashboard(), workspace.refreshBase()]);
                    }
                    setGroupEditModalOpen(false);
                }}
                fields={[
                    { name: 'groupKey', label: ui.groupKey, type: 'text', defaultValue: expandedGroup?.groupKey || '', disabled: true },
                    { name: 'title', label: ui.groupTitle, type: 'text', required: true, defaultValue: expandedGroup?.title || '' },
                ]}
            />
        </main>
    );
}
