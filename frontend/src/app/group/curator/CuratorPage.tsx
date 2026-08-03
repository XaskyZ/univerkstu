'use client';

import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import AttachmentsList from '@/components/AttachmentsList';
import CommentsThread from '@/components/CommentsThread';
import { useFocusHighlight } from '@/lib/use-focus-highlight';
import { useAuth } from '@/lib/auth-context';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { forwardPresenceOrTyping, usePresence } from '@/lib/use-presence';
import { useSocialStream } from '@/lib/use-social-stream';
import {
    assignAdminGroupRole,
    getAdminCoordinatorAnnouncements,
    getCuratorStudentDetail,
    getCuratorStudents,
    getGroupMembershipDisputes,
    getGroupJoinRequests,
    revokeAdminGroupRole,
    reviewGroupMembershipDispute,
    reviewGroupJoinRequest,
    toggleSocialReaction,
    type CoordinatorAnnouncementView,
    type CuratorStudentDetail,
    type CuratorStudentSummary,
    type GroupJoinRequestView,
    type GroupMembershipDisputeView,
} from '@/lib/api';
import EntityShareButton from '@/components/EntityShareButton';
import RevisionHistoryButton from '@/components/RevisionHistoryButton';
import AnnouncementViewBridge from '../components/AnnouncementViewBridge';
import ReactionsBar from '../components/ReactionsBar';
import { useAnnouncementsSocial } from '../hooks/useAnnouncementsSocial';
import { getAnnouncementAccent } from '../utils/announcement-accent';
import { createAnnouncementUnified } from '../utils/social-announcement-actions';
import {
    socialAnnouncementToCoordinatorView,
    socialEntityToAnnouncementView,
    type AnnouncementAdapterShape,
} from '../utils/social-entity-to-announcement';
import type { GroupWorkspaceContextValue } from '../workspace-types';
import CuratorStudentDetailModal from './CuratorStudentDetailModal';
import NotifyGroupModal from './NotifyGroupModal';
import { StudentCard } from './StudentCard';
import { getCuratorUi } from './strings';
import type { CuratorTab, ManagedRole } from './types';
import { formatDateTime } from './utils';

export default function CuratorPage({ workspace }: { workspace: GroupWorkspaceContextValue }) {
    const { language, messages } = useLanguage();
    const { userId } = useAuth();
    const locale = language === 'en' ? 'en-US' : language === 'kz' ? 'kk-KZ' : 'ru-RU';
    // Permalink focus highlight — announcement permalinks land here with
    // `?focus=<announcementId>`. The matching card scrolls into view and
    // pulses for 3s; the hook self-clears the highlight after the timer.
    const searchParams = useSearchParams();
    const focusParam = searchParams?.get('focus') ?? null;
    const focusHighlight = useFocusHighlight(focusParam);

    const ui = useMemo(() => getCuratorUi(language), [language]);
    const notifyUi = messages.curator.notify;

    const socialBeta = useFeatureFlag('socialFeedBeta');
    const socialAnnouncementsState = useAnnouncementsSocial({ enabled: socialBeta });
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
    const [activeTab, setActiveTab] = useState<CuratorTab>('students');
    const [studentQuery, setStudentQuery] = useState('');
    const [surfaceLoading, setSurfaceLoading] = useState(true);
    const [surfaceError, setSurfaceError] = useState('');
    const [students, setStudents] = useState<CuratorStudentSummary[]>([]);
    // Legacy read state — used only when `socialBeta` is OFF. Beta mode reads
    // from `socialAnnouncementsState` and projects through the back-mapper.
    const [legacyAnnouncements, setLegacyAnnouncements] = useState<CoordinatorAnnouncementView[]>([]);
    const [joinRequests, setJoinRequests] = useState<GroupJoinRequestView[]>([]);
    const [disputes, setDisputes] = useState<GroupMembershipDisputeView[]>([]);
    const [selectedStudentId, setSelectedStudentId] = useState('');
    const [selectedStudent, setSelectedStudent] = useState<CuratorStudentDetail | null>(null);
    const [studentDetailLoading, setStudentDetailLoading] = useState(false);
    const [roleAction, setRoleAction] = useState<ManagedRole | ''>('');
    const [requestNotes, setRequestNotes] = useState<Record<string, string>>({});
    const [disputeNotes, setDisputeNotes] = useState<Record<string, string>>({});
    const [requestActionId, setRequestActionId] = useState('');
    const [disputeActionId, setDisputeActionId] = useState('');
    const [notifyOpen, setNotifyOpen] = useState(false);
    const deferredStudentQuery = useDeferredValue(studentQuery.trim().toLowerCase());

    const curatorGroups = useMemo(() => {
        if (workspace.catalog.length > 0) return workspace.catalog;
        return workspace.currentGroupKey ? [{ groupKey: workspace.currentGroupKey, title: workspace.currentGroupTitle || workspace.currentGroupKey, slug: workspace.currentGroupKey.toLowerCase() }] : [];
    }, [workspace.catalog, workspace.currentGroupKey, workspace.currentGroupTitle]);

    const loadSurface = useCallback(async () => {
        if (!workspace.currentGroupKey) {
            setStudents([]);
            setJoinRequests([]);
            setDisputes([]);
            setLegacyAnnouncements([]);
            setSurfaceLoading(false);
            return;
        }

        setSurfaceLoading(true);
        setSurfaceError('');
        const groupKey = workspace.currentGroupKey;

        // Skip the legacy announcements fetch when the beta flag is on — the
        // social hook is already in flight and we don't want to pay for both
        // requests. The hook self-refreshes via its own effect.
        const announcementsPromise = socialBeta
            ? Promise.resolve(null)
            : getAdminCoordinatorAnnouncements();
        const [studentsRes, announcementsRes, requestsRes, disputesRes] = await Promise.all([
            getCuratorStudents(groupKey),
            announcementsPromise,
            getGroupJoinRequests(groupKey, 'pending'),
            getGroupMembershipDisputes(groupKey, 'pending'),
        ]);

        if (!studentsRes.success) {
            setSurfaceError(studentsRes.error || ui.loadError);
            setSurfaceLoading(false);
            return;
        }

        setStudents(studentsRes.data?.students || []);
        if (!socialBeta && announcementsRes) {
            setLegacyAnnouncements(announcementsRes.success ? (announcementsRes.data?.announcements || []) : []);
        }
        setJoinRequests(
            (requestsRes.success ? (requestsRes.data?.requests || []) : [])
                .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        );
        setDisputes(
            (disputesRes.success ? (disputesRes.data?.disputes || []) : [])
                .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
        );
        setSurfaceLoading(false);
    }, [socialBeta, ui.loadError, workspace.currentGroupKey]);

    // Render-side selector — same shape under both flags so the JSX below is
    // unchanged. When beta is on we project the social entities back into the
    // legacy view shape via the adapter chain.
    const announcements = useMemo<CoordinatorAnnouncementView[]>(() => {
        if (socialBeta) {
            return socialAnnouncementsState.announcements.map((entity) =>
                socialAnnouncementToCoordinatorView(socialEntityToAnnouncementView(entity)),
            );
        }
        return legacyAnnouncements;
    }, [legacyAnnouncements, socialAnnouncementsState.announcements, socialBeta]);

    const loadStudentDetail = useCallback(async (userId: string) => {
        if (!workspace.currentGroupKey || !userId) return;
        setStudentDetailLoading(true);
        const result = await getCuratorStudentDetail(userId, workspace.currentGroupKey);
        setSelectedStudent(result.success ? (result.data?.student || null) : null);
        setStudentDetailLoading(false);
    }, [workspace.currentGroupKey]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void loadSurface(); }, 0);
        return () => window.clearTimeout(timer);
    }, [loadSurface]);

    useEffect(() => {
        setSelectedStudentId('');
        setSelectedStudent(null);
        setStudentDetailLoading(false);
    }, [workspace.currentGroupKey]);

    useEffect(() => {
        if (!selectedStudentId) return;
        const timer = window.setTimeout(() => { void loadStudentDetail(selectedStudentId); }, 0);
        return () => window.clearTimeout(timer);
    }, [loadStudentDetail, selectedStudentId]);

    const activeAnnouncements = useMemo(() => {
        const now = Date.now();
        return announcements.filter((announcement) => {
            if (announcement.revokedAt) return false;
            if (announcement.expiresAt && new Date(announcement.expiresAt).getTime() <= now) return false;
            if (!workspace.currentGroupKey) return false;
            return announcement.targetMode === 'all_starostas' || announcement.targetGroups.includes(workspace.currentGroupKey);
        });
    }, [announcements, workspace.currentGroupKey]);

    // Id-keyed adapter shape so the card render can mount the social
    // surfaces (reactions / comments / attachments) behind the beta flag
    // without losing the legacy-shaped data the rest of this page reads.
    // See `CoordinatorPage` for the same pattern.
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

    const mergedInbox = useMemo(() => {
        const requestItems = joinRequests.map((item) => ({ kind: 'request' as const, createdAt: item.createdAt, item }));
        const disputeItems = disputes.map((item) => ({ kind: 'dispute' as const, createdAt: item.createdAt, item }));
        return [...requestItems, ...disputeItems].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
    }, [disputes, joinRequests]);

    const filteredStudents = useMemo(() => {
        if (!deferredStudentQuery) return students;
        return students.filter((student) => {
            const searchable = [student.fullName, student.userId, student.profileSummary.specialty, student.profileSummary.faculty]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
            return searchable.includes(deferredStudentQuery);
        });
    }, [deferredStudentQuery, students]);

    const currentGroupTitle = workspace.currentGroupTitle || workspace.currentGroupKey || '—';
    const roleLabels = { starosta: ui.roleStarosta, helper: ui.roleHelper, member: ui.roleMember } as const;

    const summaryLine = ui.summaryLine
        .replace('{students}', String(students.length))
        .replace('{pending}', String(joinRequests.length + disputes.length))
        .replace('{broadcasts}', String(activeAnnouncements.length));

    async function openStudent(userId: string) {
        setSelectedStudentId(userId);
        setSelectedStudent(null);
        setStudentDetailLoading(true);
    }

    async function handleRoleToggle(roleId: ManagedRole, enabled: boolean) {
        if (!selectedStudent || !workspace.currentGroupKey) return;
        setRoleAction(roleId);
        await (enabled
            ? assignAdminGroupRole(selectedStudent.userId, roleId, workspace.currentGroupKey)
            : revokeAdminGroupRole(selectedStudent.userId, roleId, workspace.currentGroupKey));
        await Promise.all([loadSurface(), loadStudentDetail(selectedStudent.userId)]);
        setRoleAction('');
    }

    async function reviewRequest(request: GroupJoinRequestView, decision: 'approved' | 'rejected') {
        setRequestActionId(request.id);
        try {
            await reviewGroupJoinRequest(request.id, decision, requestNotes[request.id]);
            await loadSurface();
        } finally {
            setRequestActionId('');
        }
    }

    async function reviewDispute(dispute: GroupMembershipDisputeView, decision: 'approved' | 'rejected' | 'needs_admin') {
        setDisputeActionId(dispute.id);
        try {
            await reviewGroupMembershipDispute(dispute.id, decision, disputeNotes[dispute.id]);
            await loadSurface();
        } finally {
            setDisputeActionId('');
        }
    }

    async function submitNotify(payload: { title: string; body: string; priority: 'info' | 'warning' | 'critical' }) {
        if (!workspace.currentGroupKey) return;
        // Translate the legacy three-level enum to the social union — the
        // unified wrapper inputs the latter regardless of which path executes
        // (the legacy path coerces back internally). The lossy bridge
        // (`info→low`, `warning→high`, `critical→critical`) is documented in
        // `social-announcement-actions.ts`.
        const socialPriority = payload.priority === 'info'
            ? 'low'
            : payload.priority === 'warning'
                ? 'high'
                : 'critical';
        const result = await createAnnouncementUnified(
            {
                title: payload.title,
                body: payload.body,
                priority: socialPriority,
                targetGroups: [workspace.currentGroupKey],
            },
            socialBeta,
        );
        if (result.success) {
            toast.success(notifyUi.submitted);
            await loadSurface();
            if (socialBeta) socialAnnouncementsState.refresh();
        } else {
            toast.error(result.error || notifyUi.submitFailed);
        }
    }

    if (surfaceLoading) {
        return <main className="px-4 py-6"><section className="card p-6 text-muted-fg">{ui.loading}</section></main>;
    }

    if (surfaceError) {
        return <main className="px-4 py-6"><section className="card p-6 text-danger-fg">{surfaceError}</section></main>;
    }

    return (
        <main className="group-workspace-main group-workspace-main--wide px-4 py-4">
            <section className="card mx-auto max-w-[1800px] p-5 animate-fadeInUp space-y-5 overflow-hidden">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-2 min-w-0">
                        <h1 className="text-2xl font-bold text-fg">{ui.title}</h1>
                        <p className="text-sm max-w-3xl text-muted-fg">{ui.subtitle}</p>
                        <p className="text-sm font-medium text-fg">{summaryLine}</p>
                    </div>
                    <button
                        type="button"
                        onClick={() => setNotifyOpen(true)}
                        disabled={!workspace.currentGroupKey}
                        className="btn btn-primary px-4 py-2 text-sm disabled:opacity-60"
                    >
                        {notifyUi.triggerBtn}
                    </button>
                </div>

                {curatorGroups.length > 1 ? (
                    <div className="rounded-3xl p-4 md:p-5 flex items-center justify-between gap-4 flex-wrap" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)' }}>
                        <div className="min-w-0">
                            <div className="text-[11px] uppercase tracking-[0.18em] text-muted-fg">{ui.switchGroup}</div>
                            <div className="mt-2 text-lg font-semibold truncate text-fg">{currentGroupTitle}</div>
                            <div className="mt-1 text-sm text-muted-fg">{ui.currentGroup}</div>
                        </div>
                        <label className="w-full md:w-auto md:min-w-[320px]">
                            <span className="sr-only">{ui.switchGroup}</span>
                            <select
                                value={workspace.currentGroupKey || ''}
                                onChange={(event) => workspace.setSelectedGroupKey(event.target.value)}
                                className="w-full px-4 py-3 rounded-2xl outline-none"
                                style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }}
                            >
                                {curatorGroups.map((group) => (
                                    <option key={group.groupKey} value={group.groupKey}>
                                        {group.title}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                ) : null}

                <div className="flex gap-2 overflow-x-auto pb-1 md:flex-wrap md:overflow-visible">
                    {(['students', 'inbox'] as CuratorTab[]).map((tab) => (
                        <button key={tab} type="button" onClick={() => startTransition(() => setActiveTab(tab))} className="px-4 py-2 rounded-xl text-sm whitespace-nowrap" style={{ background: activeTab === tab ? 'var(--gradient-primary)' : 'var(--surface-overlay-2)', color: activeTab === tab ? '#fff' : 'var(--muted)' }}>
                            {ui[tab]}
                        </button>
                    ))}
                </div>

                {activeTab === 'students' ? (
                    <div className="space-y-4">
                        <div className="rounded-[28px] p-5" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)' }}>
                            <h2 className="font-semibold text-fg">{ui.students}</h2>
                            <p className="text-sm mt-1 text-muted-fg">{ui.studentsHint}</p>
                            <input value={studentQuery} onChange={(event) => setStudentQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && studentQuery) { event.preventDefault(); setStudentQuery(''); } }} placeholder={ui.searchPlaceholder} className="mt-4 w-full max-w-sm px-3 py-3 rounded-2xl outline-none" style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }} />
                        </div>

                        {filteredStudents.length === 0 ? (
                            <div className="rounded-[28px] p-6 text-sm" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)', color: 'var(--muted)' }}>{ui.noStudents}</div>
                        ) : (
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                {filteredStudents.map((student) => (
                                    <StudentCard
                                        key={student.userId}
                                        student={student}
                                        locale={locale}
                                        openLabel={ui.openProfile}
                                        roleLabels={roleLabels}
                                        courseLabel={ui.course}
                                        lastSeenLabel={ui.lastActivity}
                                        onlineNowLabel={ui.onlineNowLabel}
                                        onOpen={() => { void openStudent(student.userId); }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                ) : null}

                {activeTab === 'inbox' ? (
                    <div className="space-y-4">
                        <div className="rounded-[28px] p-5" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)' }}>
                            <h2 className="font-semibold text-fg">{ui.inbox}</h2>
                            <p className="text-sm mt-1 text-muted-fg">{ui.inboxHint}</p>
                        </div>

                        {mergedInbox.length === 0 ? (
                            <div className="rounded-[28px] p-6 text-sm" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)', color: 'var(--muted)' }}>{ui.noInbox}</div>
                        ) : (
                            <div className="space-y-3">
                                {mergedInbox.map((entry) => entry.kind === 'request' ? (
                                    <article key={`request-${entry.item.id}`} className="rounded-[26px] p-4 space-y-3" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)' }}>
                                        <div>
                                            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-fg">{ui.queueRequest}</div>
                                            <div className="mt-1 font-semibold text-fg">{entry.item.userId}</div>
                                            <div className="mt-1 text-xs text-muted-fg">{entry.item.groupKey} • {formatDateTime(entry.item.createdAt, locale)}</div>
                                        </div>
                                        {entry.item.reason ? <p className="text-sm whitespace-pre-wrap text-fg">{entry.item.reason}</p> : null}
                                        <textarea value={requestNotes[entry.item.id] || ''} onChange={(event) => setRequestNotes((current) => ({ ...current, [entry.item.id]: event.target.value }))} rows={3} placeholder={ui.notePlaceholder} className="w-full px-3 py-3 rounded-2xl outline-none resize-y" style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }} />
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <button type="button" disabled={requestActionId === entry.item.id} onClick={() => void reviewRequest(entry.item, 'approved')} className="px-4 py-2 rounded-xl text-sm disabled:opacity-50" style={{ background: 'rgba(var(--good-rgb), 0.18)', color: 'var(--good)' }}>{requestActionId === entry.item.id ? ui.reviewing : ui.approve}</button>
                                            <button type="button" disabled={requestActionId === entry.item.id} onClick={() => void reviewRequest(entry.item, 'rejected')} className="px-4 py-2 rounded-xl text-sm disabled:opacity-50" style={{ background: 'rgba(var(--status-danger-rgb), 0.16)', color: 'var(--danger)' }}>{ui.reject}</button>
                                        </div>
                                    </article>
                                ) : (
                                    <article key={`dispute-${entry.item.id}`} className="rounded-[26px] p-4 space-y-3" style={{ border: '1px solid var(--border)', background: 'var(--surface-overlay-1)' }}>
                                        <div>
                                            <div className="text-[11px] uppercase tracking-[0.16em] text-muted-fg">{ui.queueDispute}</div>
                                            <div className="mt-1 font-semibold text-fg">{entry.item.userId}</div>
                                            <div className="mt-1 text-xs text-muted-fg">{entry.item.groupKey} • {entry.item.issueType} • {formatDateTime(entry.item.createdAt, locale)}</div>
                                        </div>
                                        <p className="text-sm whitespace-pre-wrap text-fg">{entry.item.reason}</p>
                                        <textarea value={disputeNotes[entry.item.id] || ''} onChange={(event) => setDisputeNotes((current) => ({ ...current, [entry.item.id]: event.target.value }))} rows={3} placeholder={ui.notePlaceholder} className="w-full px-3 py-3 rounded-2xl outline-none resize-y" style={{ background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)' }} />
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <button type="button" disabled={disputeActionId === entry.item.id} onClick={() => void reviewDispute(entry.item, 'approved')} className="px-4 py-2 rounded-xl text-sm disabled:opacity-50" style={{ background: 'rgba(var(--good-rgb), 0.18)', color: 'var(--good)' }}>{disputeActionId === entry.item.id ? ui.reviewing : ui.approve}</button>
                                            <button type="button" disabled={disputeActionId === entry.item.id} onClick={() => void reviewDispute(entry.item, 'rejected')} className="px-4 py-2 rounded-xl text-sm disabled:opacity-50" style={{ background: 'rgba(var(--status-danger-rgb), 0.16)', color: 'var(--danger)' }}>{ui.reject}</button>
                                            <button type="button" disabled={disputeActionId === entry.item.id} onClick={() => void reviewDispute(entry.item, 'needs_admin')} className="px-4 py-2 rounded-xl text-sm disabled:opacity-50" style={{ background: 'rgba(var(--status-warning-rgb), 0.16)', color: 'var(--status-warning-color)' }}>{ui.escalate}</button>
                                        </div>
                                    </article>
                                ))}
                            </div>
                        )}
                    </div>
                ) : null}

                {socialBeta && activeAnnouncements.length > 0 ? (
                    <div className="space-y-3">
                        <h2 className="text-base font-semibold text-fg">{notifyUi.triggerBtn}</h2>
                        {activeAnnouncements.map((announcement) => {
                            const accent = getAnnouncementAccent(announcement.priority);
                            const socialShape = socialAnnouncementById.get(announcement.id);
                            if (!socialShape) return null;
                            const canEditAttachments = Boolean(userId) && socialShape.authorUserId === userId;
                            return (
                                <article
                                    key={announcement.id}
                                    ref={focusHighlight.registerEntityNode(announcement.id)}
                                    className={`rounded-3xl p-4 space-y-3 ${focusHighlight.isHighlighted(announcement.id) ? 'entity-highlighted' : ''}`}
                                    style={{ border: accent.border, background: 'var(--surface-overlay-1)' }}
                                >
                                    {/*
                                        View-tracking bridge — fires a single
                                        `recordSocialView` after a 2s dwell on
                                        this card. Gated by `socialBeta`; this
                                        section is already inside a
                                        `socialBeta && ...` branch but we
                                        still pass the flag through for
                                        symmetry with the other surfaces.
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
                                                <span className="px-2 py-1 rounded-full text-xs font-semibold uppercase" style={{ background: accent.pillBg, color: accent.pillColor }}>
                                                    {announcement.priority}
                                                </span>
                                            </div>
                                            <p className="text-xs text-muted-fg">
                                                {formatDateTime(announcement.createdAt, locale)}
                                                {announcement.expiresAt ? ` • ${formatDateTime(announcement.expiresAt, locale)}` : ''}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <EntityShareButton
                                                entityId={announcement.id}
                                                entityKind="announcement"
                                                displayTitle={announcement.title}
                                            />
                                            <RevisionHistoryButton entityId={announcement.id} />
                                        </div>
                                    </div>
                                    <p className="text-sm whitespace-pre-wrap text-fg">{announcement.body}</p>
                                    <ReactionsBar
                                        reactions={socialShape.reactions.items}
                                        mine={socialShape.reactions.mine}
                                        onToggle={(emoji) => handleAnnouncementReactionToggle(announcement.id, emoji)}
                                    />
                                    {userId ? (
                                        <div className="mt-3">
                                            <CommentsThread
                                                entityId={announcement.id}
                                                currentUserId={userId}
                                                onCommentAdded={refreshAnnouncementsForCards}
                                                mentionScope="announcement:global"
                                            />
                                        </div>
                                    ) : null}
                                    {userId ? (
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
                    </div>
                ) : null}
            </section>

            <CuratorStudentDetailModal
                student={selectedStudent}
                loading={studentDetailLoading}
                roleAction={roleAction}
                onClose={() => {
                    setSelectedStudentId('');
                    setSelectedStudent(null);
                    setStudentDetailLoading(false);
                }}
                onToggleRole={(roleId, enabled) => { void handleRoleToggle(roleId, enabled); }}
            />

            <NotifyGroupModal
                open={notifyOpen}
                onClose={() => setNotifyOpen(false)}
                groupKey={workspace.currentGroupKey || ''}
                onSubmit={submitNotify}
            />
        </main>
    );
}
