'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { useAuth } from '@/lib/auth-context';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useSocialStream } from '@/lib/use-social-stream';
import { forwardPresenceOrTyping, usePresence } from '@/lib/use-presence';
import { useFocusHighlight } from '@/lib/use-focus-highlight';
import type { GroupTaskView } from '@/lib/api';
import { useGroupTasks } from '../hooks/useGroupTasks';
import { useGroupTasksSocial } from '../hooks/useGroupTasksSocial';
import type { GroupTaskAdapterShape } from '../utils/social-entity-to-task';
import {
    createTaskUnified,
    deleteTaskUnified,
    restoreTaskUnified,
    toggleTaskCompletionUnified,
    toggleTaskReactionUnified,
    updateTaskUnified,
} from '../utils/social-task-actions';
import { getReactionsUi } from './reactions-i18n';
import GroupFormModal from './GroupFormModal';
import GroupTrashSection from './GroupTrashSection';
import TaskCard from './TaskCard';

type TasksHookState = ReturnType<typeof useGroupTasks>;

/**
 * Promote a beta-read `GroupTaskAdapterShape` to a `GroupTaskView` so the
 * existing UI (`TaskCard`, the filter/sort/group code paths) keeps working
 * unchanged. The universal payload does not yet carry the legacy-only fields
 * (subject, description as a distinct field, priority) — we provide sane
 * defaults so the renderer never sees `undefined` where it expects a string.
 *
 * `viewerUserId` toggles per-user completion derivation: when known, the
 * legacy boolean reflects whether *this* viewer has marked the task done;
 * when unknown (SSR / pre-hydration), we fall back to the group-level
 * "any completion" boolean the adapter computed.
 */
function adapterToLegacyTask(
    task: GroupTaskAdapterShape,
    viewerUserId: string | null,
): GroupTaskView {
    const completedForViewer = viewerUserId
        ? task.completedByUserIds.includes(viewerUserId)
        : task.completed;
    return {
        id: task.id,
        groupKey: task.groupKey,
        title: task.title,
        subject: null,
        description: task.body,
        deadline: task.dueAt ?? null,
        priority: 'medium',
        authorUserId: task.authorUserId,
        completed: completedForViewer,
        completedAt: task.completedAt ?? null,
        completedBy: task.completedBy ?? null,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        deletedAt: task.deletedAt,
        deletedBy: task.deletedBy,
        // Surface reactions from the universal store so `TaskCard` can render
        // `ReactionsBar` exactly like `PostCard`. The adapter already produces
        // `{ items, mine }` — pass it through verbatim.
        reactions: {
            items: task.reactions.items,
            mine: task.reactions.mine,
        },
    };
}

export default function TasksTab({
    tasksState,
    canManage,
    groupKey,
}: {
    tasksState: TasksHookState;
    canManage: boolean;
    /**
     * Optional — when provided, enables the `socialFeedBeta` opt-in read +
     * write path through `/api/v3/social/*`. Same kill switch as the feed
     * beta. When the flag is off, behaviour is identical to the legacy hook.
     */
    groupKey?: string;
}) {
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const socialTasks = useGroupTasksSocial(groupKey, { enabled: socialBeta });
    const { userId } = useAuth();
    // Permalink focus highlight — drives the 3s pulse + scroll when the
    // viewer lands here via `/social/e/<id>` → `/group?focus=<id>` redirect.
    const searchParams = useSearchParams();
    const focusParam = searchParams?.get('focus') ?? null;
    const focusHighlight = useFocusHighlight(focusParam);
    // One-shot mount log so we can see in browser devtools which path is live
    // for any given session. Only fires on mount and when the path flips.
    const lastLoggedPath = useRef<'social-beta' | 'legacy' | null>(null);
    useEffect(() => {
        const current = socialBeta ? 'social-beta' : 'legacy';
        if (lastLoggedPath.current !== current) {
            console.log(`[group tasks] using ${current}`);
            lastLoggedPath.current = current;
        }
    }, [socialBeta]);

    // Realtime SSE bridge — see `FeedTab.tsx` for the rationale. We share the
    // group scope subscription with the feed tab; both can be mounted at the
    // same time on the group page and each will open its own EventSource. This
    // is the simplest stable wiring while the social store rolls out — when
    // the cost matters we'll hoist the connection into a shared provider.
    const socialTasksRefreshRef = useRef(socialTasks.refresh);
    useEffect(() => {
        socialTasksRefreshRef.current = socialTasks.refresh;
    }, [socialTasks.refresh]);
    const refreshDebounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (refreshDebounceTimer.current !== null) {
            clearTimeout(refreshDebounceTimer.current);
            refreshDebounceTimer.current = null;
        }
    }, []);
    // Presence bridge — piggybacks on the already-open SSE connection. The
    // `presence-changed` frames are forwarded into local state so `usePresence`
    // can derive the online roster for the group.
    const presenceScope = groupKey ? `group:${groupKey}` : null;
    const [lastPresenceEvent, setLastPresenceEvent] = useState<{
        scope: string;
        onlineUserIds: string[];
        receivedAt: number;
    } | null>(null);
    useSocialStream({
        scopes: groupKey ? [`group:${groupKey}`] : [],
        enabled: socialBeta,
        onEvent: (event) => {
            if (event.type === 'entity-created' && event.data.scopeType === 'group' && event.data.kind === 'task') {
                if (refreshDebounceTimer.current !== null) {
                    clearTimeout(refreshDebounceTimer.current);
                }
                refreshDebounceTimer.current = setTimeout(() => {
                    refreshDebounceTimer.current = null;
                    void socialTasksRefreshRef.current();
                }, 500);
                return;
            }
            const forwarded = forwardPresenceOrTyping(event);
            if (forwarded?.kind === 'presence') {
                setLastPresenceEvent(forwarded.payload);
            }
        },
    });
    const presence = usePresence(presenceScope, { lastEvent: lastPresenceEvent });
    const onlineUserIds = useMemo(
        () => new Set(socialBeta ? presence.onlineUserIds : []),
        [presence.onlineUserIds, socialBeta],
    );

    const { messages, language } = useLanguage();
    const reactionsUi = useMemo(() => getReactionsUi(language), [language]);
    const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'completed'>('all');
    const [grouping, setGrouping] = useState<'subject' | 'deadline'>('subject');
    const [priorityFilter, setPriorityFilter] = useState<'all' | 'low' | 'medium' | 'high'>('all');
    const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
    const [editingTask, setEditingTask] = useState<GroupTaskView | null>(null);
    const [reactionError, setReactionError] = useState('');

    // Pass-through for the embedded `CommentsThread` in TaskCard. When beta is
    // off the thread isn't rendered, so this collapses to a no-op naturally.
    // We keep the reference stable so TaskCard doesn't see a fresh function
    // identity on every parent render.
    const refreshForCards = useCallback(() => {
        if (socialBeta) {
            void socialTasks.refresh();
        }
    }, [socialBeta, socialTasks]);

    // We track the underlying social adapter rows separately from the
    // `GroupTaskView[]` projection so completion-toggle can read the
    // authoritative `completedByUserIds` array when constructing its PATCH.
    const socialAdapterById = useMemo(() => {
        const map = new Map<string, GroupTaskAdapterShape>();
        for (const task of socialTasks.tasks) map.set(task.id, task);
        return map;
    }, [socialTasks.tasks]);

    // Read path: in beta mode we surface `socialTasks.tasks` (universal
    // store) projected to `GroupTaskView`; otherwise the legacy `tasksState`
    // hook keeps owning the list and trash.
    const liveTasks: GroupTaskView[] = useMemo(() => {
        if (!socialBeta) return tasksState.tasks;
        return socialTasks.tasks
            .filter((task) => !task.deletedAt)
            .map((task) => adapterToLegacyTask(task, userId));
    }, [socialBeta, socialTasks.tasks, tasksState.tasks, userId]);

    const liveDeletedTasks: GroupTaskView[] = useMemo(() => {
        if (!socialBeta) return tasksState.deletedTasks;
        // The social list endpoint excludes deleted entities by default, so
        // a dedicated trash list would need a second call with
        // `includeDeleted: true`. Phase 2 keeps trash on the legacy path —
        // when the flag is on we surface an empty array rather than the
        // legacy data, since the two would otherwise be out of sync.
        return [];
    }, [socialBeta, tasksState.deletedTasks]);

    const liveLoading = socialBeta ? socialTasks.loading : tasksState.loading;
    const liveError = socialBeta ? socialTasks.error : tasksState.error;

    const filteredTasks = useMemo(() => {
        const now = Number(new Date());
        return liveTasks.filter((task) => {
            if (priorityFilter !== 'all' && task.priority !== priorityFilter) return false;
            if (filter === 'completed') return task.completed;
            if (filter === 'pending') return !task.completed;
            if (filter === 'overdue') return !task.completed && !!task.deadline && new Date(task.deadline).getTime() < now;
            return true;
        }).sort((left, right) => {
            if (left.completed !== right.completed) return Number(left.completed) - Number(right.completed);
            const leftDeadline = left.deadline ? new Date(left.deadline).getTime() : Number.MAX_SAFE_INTEGER;
            const rightDeadline = right.deadline ? new Date(right.deadline).getTime() : Number.MAX_SAFE_INTEGER;
            if (leftDeadline !== rightDeadline) return leftDeadline - rightDeadline;
            return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
        });
    }, [filter, priorityFilter, liveTasks]);

    const groupedTasks = useMemo(() => {
        const map = new Map<string, GroupTaskView[]>();
        for (const task of filteredTasks) {
            const key = grouping === 'subject' ? (task.subject?.trim() || messages.group.noSubject) : (task.deadline ? new Date(task.deadline).toLocaleDateString(localeTag(language)) : messages.group.noDeadline);
            map.set(key, [...(map.get(key) || []), task]);
        }
        return Array.from(map.entries());
    }, [filteredTasks, grouping, messages.group.noDeadline, messages.group.noSubject, language]);

    // Write-path handlers. Beta path goes through `/api/v3/social/*` and then
    // refreshes the social hook; legacy path keeps using the existing
    // `tasksState` mutators so the hook's in-place cache stays valid.
    const handleToggle = useCallback(
        async (taskId: string, completed: boolean) => {
            if (socialBeta) {
                if (!userId) return;
                const adapter = socialAdapterById.get(taskId);
                const current = adapter?.completedByUserIds ?? [];
                // Optimistic guard: if our derived `completed` flag already
                // matches the requested state, skip the toggle — the legacy
                // checkbox calls onToggle with `!completed`, so this only
                // trips on rapid double-clicks.
                const alreadyDone = current.includes(userId);
                if (alreadyDone === completed) return;
                await toggleTaskCompletionUnified(taskId, userId, current, true);
                void socialTasks.refresh();
                return;
            }
            await tasksState.toggleCompleted(taskId, completed);
        },
        [socialAdapterById, socialBeta, socialTasks, tasksState, userId],
    );

    const handleDelete = useCallback(
        async (taskId: string) => {
            if (socialBeta) {
                await deleteTaskUnified(taskId, undefined, true);
                void socialTasks.refresh();
                return;
            }
            await tasksState.deleteTaskItem(taskId);
        },
        [socialBeta, socialTasks, tasksState],
    );

    const handleRestore = useCallback(
        async (taskId: string) => {
            if (socialBeta) {
                await restoreTaskUnified(taskId, true);
                void socialTasks.refresh();
                return;
            }
            await tasksState.restoreTask(taskId);
        },
        [socialBeta, socialTasks, tasksState],
    );

    // Reaction toggle factory — mirrors `FeedTab.makeReactionToggle` so card UX
    // stays consistent across post / task / lesson surfaces. Tasks have no
    // legacy reaction endpoint, so when the flag is off the wrapper surfaces a
    // discoverable error and we render it next to the list.
    const makeReactionToggle = useCallback(
        (taskId: string) => async (emoji: string) => {
            setReactionError('');
            const result = await toggleTaskReactionUnified(taskId, emoji, socialBeta, groupKey);
            if (!result.success) {
                const msg = result.error || reactionsUi.toggleFailed;
                setReactionError(msg);
                throw new Error(msg);
            }
            if (socialBeta) {
                // Social toggle is fire-and-forget for the local cache; a
                // refresh re-pulls the aggregates the server just updated.
                void socialTasks.refresh();
            }
        },
        [groupKey, reactionsUi.toggleFailed, socialBeta, socialTasks],
    );

    return (
        <div className="space-y-4">
            <div className="card p-4 space-y-4 animate-fadeInUp">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="font-semibold text-fg">{messages.group.tasksTitle}</h3>
                        <p className="text-sm mt-1 text-muted-fg">{messages.group.tasksSubtitle}</p>
                    </div>
                    {canManage ? <button onClick={() => { setEditingTask(null); setModalMode('create'); }} className="btn btn-primary px-4 py-2 text-sm" type="button">{messages.group.newTask}</button> : null}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    {[
                        ['all', messages.group.filterAll],
                        ['pending', messages.group.filterMyOpen],
                        ['overdue', messages.group.filterOverdue],
                        ['completed', messages.group.filterCompleted],
                    ].map(([value, label]) => (
                        <button key={value} onClick={() => setFilter(value as typeof filter)} className="chip" data-active={filter === value || undefined} type="button">{label}</button>
                    ))}
                    <button onClick={() => setGrouping(grouping === 'subject' ? 'deadline' : 'subject')} className="chip" type="button">{grouping === 'subject' ? messages.group.groupBySubject : messages.group.groupByDeadline}</button>
                    <select value={priorityFilter} onChange={(e) => setPriorityFilter(e.target.value as typeof priorityFilter)} className="chip outline-none" style={{ color: 'var(--text)', border: '1px solid var(--border)' }}>
                        <option value="all">{messages.group.allPriorities}</option>
                        <option value="high">high</option>
                        <option value="medium">medium</option>
                        <option value="low">low</option>
                    </select>
                </div>

                {liveLoading ? <p className="text-sm text-muted-fg">{messages.group.loadingTasks}</p> : null}
                {liveError ? <p className="text-sm text-danger-fg">{liveError}</p> : null}
                {reactionError ? <p className="text-sm text-danger-fg">{reactionError}</p> : null}
                {!liveLoading && !liveError && filteredTasks.length === 0 ? <p className="text-sm text-muted-fg">{messages.group.emptyTasks}</p> : null}

                <div className="space-y-4">
                    {groupedTasks.map(([groupLabel, items]) => (
                        <section key={groupLabel} className="space-y-3">
                            <h4 className="text-sm font-semibold uppercase tracking-wide text-muted-fg">{groupLabel}</h4>
                            {items.map((task) => (
                                <div
                                    key={task.id}
                                    ref={focusHighlight.registerEntityNode(task.id)}
                                    className={focusHighlight.isHighlighted(task.id) ? 'entity-highlighted' : undefined}
                                >
                                    <TaskCard
                                        task={task}
                                        currentUserId={userId ?? undefined}
                                        onToggle={(completed) => void handleToggle(task.id, completed)}
                                        onToggleReaction={makeReactionToggle(task.id)}
                                        refreshFeed={refreshForCards}
                                        mentionScope={groupKey ? `group:${groupKey}` : undefined}
                                        isAuthorOnline={onlineUserIds.has(task.authorUserId)}
                                        actions={canManage ? (
                                            <div className="flex items-center gap-2">
                                                <button onClick={() => { setEditingTask(task); setModalMode('edit'); }} className="chip" type="button">{messages.common.edit}</button>
                                                <button onClick={() => void handleDelete(task.id)} className="chip" data-tone="danger" type="button">{messages.common.delete}</button>
                                            </div>
                                        ) : undefined}
                                    />
                                </div>
                            ))}
                        </section>
                    ))}
                </div>
            </div>

            {canManage ? (
                <GroupTrashSection title={messages.group.tasksTrash} hint={messages.group.softDeletedHint} count={liveDeletedTasks.length} emptyText={messages.group.emptyTasksTrash}>
                    <div className="space-y-3">
                        {liveDeletedTasks.map((task) => (
                            <TaskCard key={task.id} task={task} actions={<button onClick={() => void handleRestore(task.id)} className="chip" data-tone="success" type="button">{messages.group.restore}</button>} />
                        ))}
                    </div>
                </GroupTrashSection>
            ) : null}

            <GroupFormModal
                open={modalMode !== null}
                title={modalMode === 'edit' ? 'Edit task' : 'New task'}
                submitLabel={modalMode === 'edit' ? 'Save' : 'Create'}
                onCancel={() => { setModalMode(null); setEditingTask(null); }}
                onSubmit={async (values) => {
                    const payload = { title: String(values.title || ''), subject: String(values.subject || ''), description: String(values.description || ''), deadline: String(values.deadline || ''), priority: String(values.priority || 'medium') as GroupTaskView['priority'] };
                    if (socialBeta) {
                        // Universal payload only carries title/body/dueAt today
                        // — subject + priority stay on the legacy table and
                        // will be promoted into the payload in a later phase.
                        // We collapse description into `body` so the beta
                        // surface still preserves the user's input.
                        const input = {
                            title: payload.title,
                            body: payload.description,
                            dueAt: payload.deadline || undefined,
                        };
                        if (modalMode === 'edit' && editingTask) {
                            await updateTaskUnified(editingTask.id, input, true);
                        } else if (groupKey) {
                            await createTaskUnified(groupKey, input, true);
                        }
                        void socialTasks.refresh();
                    } else {
                        if (modalMode === 'edit' && editingTask) {
                            await tasksState.updateTaskItem(editingTask.id, payload);
                        } else {
                            await tasksState.createTask(payload);
                        }
                    }
                    setModalMode(null);
                    setEditingTask(null);
                }}
                fields={[
                    { name: 'title', label: 'Title', type: 'text', required: true, defaultValue: editingTask?.title || '' },
                    { name: 'subject', label: 'Subject', type: 'text', defaultValue: editingTask?.subject || '' },
                    {
                        name: 'description',
                        label: 'Description',
                        type: 'textarea',
                        defaultValue: editingTask?.description || '',
                        // Mention autocomplete is gated on the same flag as the
                        // rest of the social surface — when the legacy path is
                        // active the body field stays a plain textarea.
                        mentionScope: socialBeta && groupKey ? `group:${groupKey}` : undefined,
                    },
                    { name: 'deadline', label: 'Deadline', type: 'datetime', defaultValue: editingTask?.deadline ? editingTask.deadline.slice(0, 16) : '' },
                    { name: 'priority', label: 'Priority', type: 'select', defaultValue: editingTask?.priority || 'medium', options: [{ label: 'High', value: 'high' }, { label: 'Medium', value: 'medium' }, { label: 'Low', value: 'low' }] },
                ]}
            />
        </div>
    );
}
