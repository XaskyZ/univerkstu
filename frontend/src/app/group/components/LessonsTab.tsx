'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLanguage } from '@/lib/language-context';
import { useAuth } from '@/lib/auth-context';
import { useFeatureFlag } from '@/lib/feature-flags';
import { useSocialStream } from '@/lib/use-social-stream';
import { forwardPresenceOrTyping, usePresence } from '@/lib/use-presence';
import { useFocusHighlight } from '@/lib/use-focus-highlight';
import type { GroupExtraLessonView } from '@/lib/api';
import { useGroupLessons } from '../hooks/useGroupLessons';
import { useGroupExtraLessonsSocial } from '../hooks/useGroupExtraLessonsSocial';
import type { GroupExtraLessonAdapterShape } from '../utils/social-entity-to-extra-lesson';
import {
    createExtraLessonUnified,
    deleteExtraLessonUnified,
    restoreExtraLessonUnified,
    splitIsoToDateAndTime,
    toggleExtraLessonReactionUnified,
    updateExtraLessonUnified,
} from '../utils/social-extra-lesson-actions';
import { getReactionsUi } from './reactions-i18n';
import GroupFormModal from './GroupFormModal';
import GroupTrashSection from './GroupTrashSection';
import LessonCard from './LessonCard';

type LessonsHookState = ReturnType<typeof useGroupLessons>;

/**
 * Combine a `YYYY-MM-DD` date string and a `HH:MM` time into an ISO 8601
 * timestamp (UTC). Used to bridge the legacy form fields into the universal
 * `startsAt` / `endsAt` shape on the beta create/update path.
 *
 * Returns `''` when either piece is missing so the wrapper can decide whether
 * to forward the value or drop the optional field.
 */
function joinDateAndTimeToIso(date: string, time: string): string {
    if (!date || !time) return '';
    // Lock the seconds to `:00` and treat the input as UTC. This matches the
    // round-trip in `splitIsoToDateAndTime` so create→read→edit cycles do not
    // drift across timezones.
    return `${date}T${time}:00Z`;
}

/**
 * Promote a beta-read `GroupExtraLessonAdapterShape` to a legacy
 * `GroupExtraLessonView` so the existing UI (`LessonCard`, the .ics export,
 * the filter/search code paths) keeps working unchanged. The universal
 * payload uses `subject` + ISO `startsAt` / `endsAt`; the legacy view uses
 * `title` + separate `date` / `startTime` / `endTime`. We project once here
 * so downstream renderers see the shape they already know.
 *
 * Empty strings are preferred over `null` when the universal payload omits an
 * optional field, because the legacy renderer treats `undefined` and `''`
 * identically (truthy check) while `null` would break some date math.
 */
function adapterToLegacyLesson(
    lesson: GroupExtraLessonAdapterShape,
): GroupExtraLessonView {
    const start = splitIsoToDateAndTime(lesson.startsAt);
    const end = splitIsoToDateAndTime(lesson.endsAt);
    return {
        id: lesson.id,
        groupKey: lesson.groupKey,
        title: lesson.subject,
        date: start.date,
        startTime: start.time,
        endTime: end.time,
        room: lesson.room ?? null,
        teacher: lesson.teacher ?? null,
        note: lesson.note ?? null,
        authorUserId: lesson.authorUserId,
        createdAt: lesson.createdAt,
        updatedAt: lesson.updatedAt,
        deletedAt: lesson.deletedAt,
        deletedBy: lesson.deletedBy,
        // Surface reactions from the universal store so `LessonCard` can render
        // `ReactionsBar` exactly like `PostCard`. The adapter already produces
        // `{ items, mine }` — pass it through verbatim.
        reactions: {
            items: lesson.reactions.items,
            mine: lesson.reactions.mine,
        },
    };
}

function exportLessonAsIcs(lesson: GroupExtraLessonView) {
    const start = `${lesson.date}T${lesson.startTime}:00`;
    const end = `${lesson.date}T${lesson.endTime}:00`;
    const toUtc = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const body = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', `SUMMARY:${lesson.title}`, `DTSTART:${toUtc(start)}`, `DTEND:${toUtc(end)}`, lesson.room ? `LOCATION:${lesson.room}` : '', lesson.note ? `DESCRIPTION:${lesson.note.replace(/\n/g, '\\n')}` : '', 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
    const blob = new Blob([body], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${lesson.title}.ics`;
    link.click();
    URL.revokeObjectURL(url);
}

export default function LessonsTab({
    lessonsState,
    canManage,
    groupKey,
}: {
    lessonsState: LessonsHookState;
    canManage: boolean;
    /**
     * Optional — when provided, enables the `socialFeedBeta` opt-in read +
     * write path through `/api/v3/social/*`. Same kill switch as the feed +
     * tasks beta. When the flag is off, behaviour is identical to the legacy
     * `useGroupLessons` hook.
     */
    groupKey?: string;
}) {
    const socialBeta = useFeatureFlag('socialFeedBeta');
    const socialLessons = useGroupExtraLessonsSocial(groupKey, { enabled: socialBeta });
    const { userId } = useAuth();
    // Permalink focus highlight — pulse + scroll the card matching
    // `?focus=<entityId>` from the universal permalink resolver.
    const searchParams = useSearchParams();
    const focusParam = searchParams?.get('focus') ?? null;
    const focusHighlight = useFocusHighlight(focusParam);
    // One-shot mount log so we can see in browser devtools which path is live
    // for any given session. Only fires on mount and when the path flips.
    const lastLoggedPath = useRef<'social-beta' | 'legacy' | null>(null);
    useEffect(() => {
        const current = socialBeta ? 'social-beta' : 'legacy';
        if (lastLoggedPath.current !== current) {
            console.log(`[group lessons] using ${current}`);
            lastLoggedPath.current = current;
        }
    }, [socialBeta]);

    // Realtime SSE bridge — see `FeedTab.tsx` for the rationale. Only refresh
    // when the incoming event is an `extra_lesson` so the feed and tasks tabs
    // can't trigger a redundant lessons fetch.
    const socialLessonsRefreshRef = useRef(socialLessons.refresh);
    useEffect(() => {
        socialLessonsRefreshRef.current = socialLessons.refresh;
    }, [socialLessons.refresh]);
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
            if (event.type === 'entity-created' && event.data.scopeType === 'group' && event.data.kind === 'extra_lesson') {
                if (refreshDebounceTimer.current !== null) {
                    clearTimeout(refreshDebounceTimer.current);
                }
                refreshDebounceTimer.current = setTimeout(() => {
                    refreshDebounceTimer.current = null;
                    void socialLessonsRefreshRef.current();
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
    const [query, setQuery] = useState('');
    const [modalMode, setModalMode] = useState<'create' | 'edit' | null>(null);
    const [editingLesson, setEditingLesson] = useState<GroupExtraLessonView | null>(null);
    const [reactionError, setReactionError] = useState('');

    // Pass-through for the embedded `CommentsThread` in LessonCard. When beta
    // is off the thread isn't rendered, so this collapses to a no-op naturally.
    const refreshForCards = useCallback(() => {
        if (socialBeta) {
            void socialLessons.refresh();
        }
    }, [socialBeta, socialLessons]);

    // Read path: in beta mode we surface `socialLessons.lessons` (universal
    // store) projected to `GroupExtraLessonView`; otherwise the legacy
    // `lessonsState` hook keeps owning the list and trash.
    const liveLessons: GroupExtraLessonView[] = useMemo(() => {
        if (!socialBeta) return lessonsState.lessons;
        return socialLessons.lessons
            .filter((lesson) => !lesson.deletedAt)
            .map(adapterToLegacyLesson);
    }, [socialBeta, socialLessons.lessons, lessonsState.lessons]);

    const liveDeletedLessons: GroupExtraLessonView[] = useMemo(() => {
        if (!socialBeta) return lessonsState.deletedLessons;
        // The social list endpoint excludes deleted entities by default, so a
        // dedicated trash list would need a second call with
        // `includeDeleted: true`. Phase 2 keeps trash on the legacy path —
        // when the flag is on we surface an empty array rather than the
        // legacy data, since the two would otherwise be out of sync.
        return [];
    }, [socialBeta, lessonsState.deletedLessons]);

    const liveLoading = socialBeta ? socialLessons.loading : lessonsState.loading;
    const liveError = socialBeta ? socialLessons.error : lessonsState.error;

    const filteredLessons = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return liveLessons;
        return liveLessons.filter((lesson) => [lesson.title, lesson.teacher, lesson.room, lesson.note].filter(Boolean).some((value) => String(value).toLowerCase().includes(normalized)));
    }, [liveLessons, query]);

    const lessonSuggestions = useMemo(() => {
        return Array.from(new Set(liveLessons.flatMap((lesson) => [lesson.title, lesson.teacher || '', lesson.room || '', lesson.note || '']).map((value) => value.trim()).filter(Boolean))).slice(0, 60);
    }, [liveLessons]);

    // Write-path handlers. Beta path goes through `/api/v3/social/*` and then
    // refreshes the social hook; legacy path keeps using the existing
    // `lessonsState` mutators so the hook's in-place cache stays valid.
    const handleDelete = useCallback(
        async (lessonId: string) => {
            if (socialBeta) {
                await deleteExtraLessonUnified(lessonId, undefined, true);
                void socialLessons.refresh();
                return;
            }
            await lessonsState.deleteLessonItem(lessonId);
        },
        [socialBeta, socialLessons, lessonsState],
    );

    const handleRestore = useCallback(
        async (lessonId: string) => {
            if (socialBeta) {
                await restoreExtraLessonUnified(lessonId, true);
                void socialLessons.refresh();
                return;
            }
            await lessonsState.restoreLesson(lessonId);
        },
        [socialBeta, socialLessons, lessonsState],
    );

    // Reaction toggle factory — mirrors `FeedTab.makeReactionToggle` so card
    // UX stays consistent across post / task / lesson surfaces. Lessons have no
    // legacy reaction endpoint, so when the flag is off the wrapper surfaces a
    // discoverable error and we render it next to the list.
    const makeReactionToggle = useCallback(
        (lessonId: string) => async (emoji: string) => {
            setReactionError('');
            const result = await toggleExtraLessonReactionUnified(lessonId, emoji, socialBeta, groupKey);
            if (!result.success) {
                const msg = result.error || reactionsUi.toggleFailed;
                setReactionError(msg);
                throw new Error(msg);
            }
            if (socialBeta) {
                void socialLessons.refresh();
            }
        },
        [groupKey, reactionsUi.toggleFailed, socialBeta, socialLessons],
    );

    return (
        <div className="space-y-4">
            <div className="card p-4 space-y-4 animate-fadeInUp">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div>
                        <h3 className="font-semibold text-fg">{messages.group.extraLessonsTitle}</h3>
                        <p className="text-sm mt-1 text-muted-fg">{messages.group.extraLessonsSubtitle}</p>
                    </div>
                    {canManage ? <button onClick={() => { setEditingLesson(null); setModalMode('create'); }} className="btn btn-primary px-4 py-2 text-sm" type="button">{messages.group.addLesson}</button> : null}
                </div>

                <input list="group-lessons-search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); } }} placeholder={messages.group.lessonsSearchPlaceholder} className="input" />
                <datalist id="group-lessons-search">
                    {lessonSuggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}
                </datalist>
                {liveLoading ? <p className="text-sm text-muted-fg">{messages.group.loadingLessons}</p> : null}
                {liveError ? <p className="text-sm text-danger-fg">{liveError}</p> : null}
                {reactionError ? <p className="text-sm text-danger-fg">{reactionError}</p> : null}
                {!liveLoading && !liveError && filteredLessons.length === 0 ? <p className="text-sm text-muted-fg">{messages.group.emptyLessons}</p> : null}

                <div className="space-y-3">
                    {filteredLessons.map((lesson) => (
                        <div
                            key={lesson.id}
                            ref={focusHighlight.registerEntityNode(lesson.id)}
                            className={focusHighlight.isHighlighted(lesson.id) ? 'entity-highlighted' : undefined}
                        >
                            <LessonCard
                                lesson={lesson}
                                currentUserId={userId ?? undefined}
                                onExportIcs={() => exportLessonAsIcs(lesson)}
                                onToggleReaction={makeReactionToggle(lesson.id)}
                                refreshFeed={refreshForCards}
                                mentionScope={groupKey ? `group:${groupKey}` : undefined}
                                isAuthorOnline={onlineUserIds.has(lesson.authorUserId)}
                                actions={canManage ? (
                                    <div className="flex items-center gap-2">
                                        <button onClick={() => { setEditingLesson(lesson); setModalMode('edit'); }} className="chip" type="button">{messages.common.edit}</button>
                                        <button onClick={() => void handleDelete(lesson.id)} className="chip" data-tone="danger" type="button">{messages.common.delete}</button>
                                    </div>
                                ) : undefined}
                            />
                        </div>
                    ))}
                </div>
            </div>

            {canManage ? (
                <GroupTrashSection title={messages.group.lessonsTrash} hint={messages.group.softDeletedHint} count={liveDeletedLessons.length} emptyText={messages.group.emptyLessonsTrash}>
                    <div className="space-y-3">
                        {liveDeletedLessons.map((lesson) => (
                            <LessonCard key={lesson.id} lesson={lesson} actions={<button onClick={() => void handleRestore(lesson.id)} className="chip" data-tone="success" type="button">{messages.group.restore}</button>} />
                        ))}
                    </div>
                </GroupTrashSection>
            ) : null}

            <GroupFormModal
                open={modalMode !== null}
                title={modalMode === 'edit' ? 'Edit extra lesson' : 'Add extra lesson'}
                submitLabel={modalMode === 'edit' ? 'Save' : 'Create'}
                onCancel={() => { setModalMode(null); setEditingLesson(null); }}
                onSubmit={async (values) => {
                    const payload = { title: String(values.title || ''), date: String(values.date || ''), startTime: String(values.startTime || ''), endTime: String(values.endTime || ''), room: String(values.room || ''), teacher: String(values.teacher || ''), note: String(values.note || '') };
                    if (socialBeta) {
                        // Universal payload uses `subject` + ISO timestamps —
                        // bridge the legacy form fields here so the modal UI
                        // stays unchanged. Empty optional fields collapse to
                        // `undefined` so `buildLessonPayload` can drop them.
                        const startsAt = joinDateAndTimeToIso(payload.date, payload.startTime);
                        const endsAtRaw = joinDateAndTimeToIso(payload.date, payload.endTime);
                        const input = {
                            subject: payload.title,
                            startsAt,
                            endsAt: endsAtRaw || undefined,
                            room: payload.room || undefined,
                            teacher: payload.teacher || undefined,
                            note: payload.note || undefined,
                        };
                        if (modalMode === 'edit' && editingLesson) {
                            await updateExtraLessonUnified(editingLesson.id, input, true);
                        } else if (groupKey) {
                            await createExtraLessonUnified(groupKey, input, true);
                        }
                        void socialLessons.refresh();
                    } else {
                        if (modalMode === 'edit' && editingLesson) {
                            await lessonsState.updateLessonItem(editingLesson.id, payload);
                        } else {
                            await lessonsState.createLesson(payload);
                        }
                    }
                    setModalMode(null);
                    setEditingLesson(null);
                }}
                fields={[
                    { name: 'title', label: 'Title', type: 'text', required: true, defaultValue: editingLesson?.title || '' },
                    { name: 'date', label: 'Date', type: 'date', required: true, defaultValue: editingLesson?.date || '' },
                    { name: 'startTime', label: 'Start time', type: 'time', required: true, defaultValue: editingLesson?.startTime || '' },
                    { name: 'endTime', label: 'End time', type: 'time', required: true, defaultValue: editingLesson?.endTime || '' },
                    { name: 'room', label: 'Room', type: 'text', defaultValue: editingLesson?.room || '' },
                    { name: 'teacher', label: 'Teacher', type: 'text', defaultValue: editingLesson?.teacher || '' },
                    {
                        name: 'note',
                        label: 'Notes',
                        type: 'textarea',
                        defaultValue: editingLesson?.note || '',
                        // Mention autocomplete is gated on the same flag as the
                        // rest of the social surface — when the legacy path is
                        // active the note field stays a plain textarea.
                        mentionScope: socialBeta && groupKey ? `group:${groupKey}` : undefined,
                    },
                ]}
            />
        </div>
    );
}
