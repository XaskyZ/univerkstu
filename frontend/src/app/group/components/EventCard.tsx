'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import { localeTag } from '@/lib/locale-format';
import { useFeatureFlag } from '@/lib/feature-flags';
import AttachmentsList from '@/components/AttachmentsList';
import CommentsThread from '@/components/CommentsThread';
import EntityShareButton from '@/components/EntityShareButton';
import RevisionHistoryButton from '@/components/RevisionHistoryButton';
import {
    clearSocialEventRsvp,
    setSocialEventRsvp,
    type EventRsvpStatus,
} from '@/lib/api/social';
import type { EventAdapterShape } from '../utils/social-entity-to-event';
import ReactionsBar from './ReactionsBar';
import {
    formatEventDateTime,
    getEventsUi,
    isEventPast,
} from './events-i18n';

interface EventCardProps {
    event: EventAdapterShape;
    /**
     * Optional reaction-toggle callback. When provided AND `socialFeedBeta` is
     * on, the card renders the reactions bar under the body. Trash-list usages
     * omit it — same pattern as `PostCard` / `TaskCard`.
     */
    onToggleReaction?: (emoji: string) => Promise<void>;
    /**
     * Optional callback fired after an RSVP write succeeds. Used by the parent
     * (FeedTab) to re-fetch the feed so the counts reconcile across viewers.
     * Local state already reflects the new value optimistically — the refresh
     * is for cross-viewer sync.
     */
    onRsvpChanged?: () => void;
    /**
     * Viewer's own user id. Drives the comments thread + attachments list
     * surfaces (both gated by `socialFeedBeta`). Optional so trash usages
     * that never enter the beta path can omit it.
     */
    currentUserId?: string;
    /**
     * Advisory callback invoked when a new comment is posted via the embedded
     * `CommentsThread`. Lets the parent feed re-fetch aggregates.
     */
    refreshFeed?: () => void;
    /**
     * Scope string passed through to `CommentsThread` for the @mention
     * autocomplete picker. `group:KEY` for live tabs; omit for trash views.
     */
    mentionScope?: string;
    /**
     * Action chips rendered in the header — typically Edit + Delete for the
     * event author / curator.
     */
    actions?: React.ReactNode;
    /**
     * Override the "now" reference for past-event detection. Test-only; the
     * default uses `Date.now()` at render time.
     */
    now?: number;
}

/**
 * EventCard — read-only event tile with an RSVP control panel.
 *
 * Visuals mirror PostCard / TaskCard for consistency. The RSVP section sits
 * between the body and the reactions bar: three buttons (Yes / No / Maybe)
 * each with a tally. When the viewer's RSVP is set, the matching button gets
 * a "selected" tone and a `Clear` link is rendered below.
 *
 * Past events (endsAt < now, falling back to startsAt) render the RSVP
 * surface as read-only and add a "состоялось" badge to the header.
 */
export default function EventCard({
    event,
    onToggleReaction,
    onRsvpChanged,
    currentUserId,
    refreshFeed,
    mentionScope,
    actions,
    now,
}: EventCardProps) {
    const { messages, language } = useLanguage();
    void messages;
    const ui = useMemo(() => getEventsUi(language), [language]);
    const socialBeta = useFeatureFlag('socialFeedBeta');

    // Local optimistic state — RSVP writes update this immediately so the
    // selected button highlights without waiting for the server round-trip.
    // The server response replaces the optimistic snapshot to reconcile any
    // drift (other viewers RSVP'd between our last fetch and now).
    const [myRsvp, setMyRsvp] = useState<EventRsvpStatus | null>(event.myRsvp);
    const [counts, setCounts] = useState(event.rsvpCounts);
    const [rsvpBusy, setRsvpBusy] = useState(false);
    const [rsvpError, setRsvpError] = useState('');

    const past = isEventPast(event.startsAt, event.endsAt, now);
    const rsvpLocked = past || rsvpBusy;
    const showAttachments = socialBeta && Boolean(currentUserId);
    const showComments = socialBeta && Boolean(currentUserId);

    const handleRsvp = useCallback(
        async (status: EventRsvpStatus) => {
            if (rsvpLocked) return;
            // Optimistic update: bump counts as if the write succeeded so the
            // UI stays snappy. We rollback to the snapshot if the request
            // fails (the server is the source of truth).
            const previousRsvp = myRsvp;
            const previousCounts = counts;
            const nextCounts = { ...previousCounts };
            // Remove the old slot count if any.
            if (previousRsvp === 'yes') nextCounts.yes = Math.max(0, nextCounts.yes - 1);
            else if (previousRsvp === 'no') nextCounts.no = Math.max(0, nextCounts.no - 1);
            else if (previousRsvp === 'maybe') nextCounts.maybe = Math.max(0, nextCounts.maybe - 1);
            // Add the new slot only when it's actually changing.
            if (previousRsvp !== status) {
                if (status === 'yes') nextCounts.yes += 1;
                else if (status === 'no') nextCounts.no += 1;
                else if (status === 'maybe') nextCounts.maybe += 1;
                setMyRsvp(status);
                setCounts(nextCounts);
            }

            setRsvpBusy(true);
            setRsvpError('');
            try {
                const result = await setSocialEventRsvp(event.id, status);
                if (!result.success || !result.data) {
                    setMyRsvp(previousRsvp);
                    setCounts(previousCounts);
                    setRsvpError(result.error || ui.rsvpFailed);
                    return;
                }
                // Server returned authoritative state — tally fresh counts.
                const tallied = { yes: 0, no: 0, maybe: 0 };
                for (const value of Object.values(result.data.rsvpStatus)) {
                    if (value === 'yes') tallied.yes += 1;
                    else if (value === 'no') tallied.no += 1;
                    else if (value === 'maybe') tallied.maybe += 1;
                }
                setCounts(tallied);
                setMyRsvp(result.data.mine);
                onRsvpChanged?.();
            } catch {
                setMyRsvp(previousRsvp);
                setCounts(previousCounts);
                setRsvpError(ui.rsvpFailed);
            } finally {
                setRsvpBusy(false);
            }
        },
        [counts, event.id, myRsvp, onRsvpChanged, rsvpLocked, ui.rsvpFailed],
    );

    const handleClear = useCallback(async () => {
        if (rsvpLocked) return;
        if (myRsvp === null) return;
        const previousRsvp = myRsvp;
        const previousCounts = counts;
        const nextCounts = { ...previousCounts };
        if (previousRsvp === 'yes') nextCounts.yes = Math.max(0, nextCounts.yes - 1);
        else if (previousRsvp === 'no') nextCounts.no = Math.max(0, nextCounts.no - 1);
        else if (previousRsvp === 'maybe') nextCounts.maybe = Math.max(0, nextCounts.maybe - 1);
        setMyRsvp(null);
        setCounts(nextCounts);
        setRsvpBusy(true);
        setRsvpError('');
        try {
            const result = await clearSocialEventRsvp(event.id);
            if (!result.success || !result.data) {
                setMyRsvp(previousRsvp);
                setCounts(previousCounts);
                setRsvpError(result.error || ui.rsvpFailed);
                return;
            }
            const tallied = { yes: 0, no: 0, maybe: 0 };
            for (const value of Object.values(result.data.rsvpStatus)) {
                if (value === 'yes') tallied.yes += 1;
                else if (value === 'no') tallied.no += 1;
                else if (value === 'maybe') tallied.maybe += 1;
            }
            setCounts(tallied);
            setMyRsvp(result.data.mine);
            onRsvpChanged?.();
        } catch {
            setMyRsvp(previousRsvp);
            setCounts(previousCounts);
            setRsvpError(ui.rsvpFailed);
        } finally {
            setRsvpBusy(false);
        }
    }, [counts, event.id, myRsvp, onRsvpChanged, rsvpLocked, ui.rsvpFailed]);

    const formattedStart = formatEventDateTime(event.startsAt, localeTag(language)) || '—';
    const formattedEnd = event.endsAt ? formatEventDateTime(event.endsAt, localeTag(language)) : '';
    const dateRange = formattedEnd
        ? `${formattedStart} – ${formattedEnd}`
        : formattedStart;

    return (
        <article
            className="rounded-3xl p-4 space-y-3 transition surface-overlay-1"
            style={{ border: '1px solid var(--border)', opacity: past ? 0.85 : 1 }}
        >
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-2 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                        {event.pinned ? (
                            <span className="chip" data-tone="primary">📌</span>
                        ) : null}
                        {past ? (
                            <span className="chip" data-tone="muted">{ui.pastBadge}</span>
                        ) : null}
                        {event.seriesId && event.recurrenceKind === 'weekly' ? (
                            <span className="chip" data-tone="info">{ui.seriesBadgeWeekly}</span>
                        ) : null}
                        {event.seriesId && event.recurrenceKind === 'monthly' ? (
                            <span className="chip" data-tone="info">{ui.seriesBadgeMonthly}</span>
                        ) : null}
                        {event.seriesId && !event.recurrenceKind ? (
                            <span className="chip" data-tone="info">{ui.seriesMemberBadge}</span>
                        ) : null}
                    </div>
                    <h4 className="text-lg font-semibold text-fg">{event.title}</h4>
                </div>
                <div className="flex items-center gap-2">
                    {socialBeta && event.id ? (
                        <EntityShareButton entityId={event.id} entityKind="event" displayTitle={event.title} />
                    ) : null}
                    {socialBeta && event.id ? (
                        <RevisionHistoryButton entityId={event.id} />
                    ) : null}
                    {actions}
                </div>
            </div>
            {event.body ? (
                <p className="whitespace-pre-wrap text-sm leading-6 text-fg">{event.body}</p>
            ) : null}
            <div className="text-xs flex items-center gap-2 flex-wrap text-muted-fg">
                <span aria-label={ui.startsAtAria(formattedStart)}>📅 {dateRange}</span>
                {event.location ? (
                    <>
                        <span>•</span>
                        <span>📍 {event.location}</span>
                    </>
                ) : null}
                <span>•</span>
                <span>{event.authorUserId}</span>
            </div>

            {/* RSVP section */}
            <section
                className="space-y-2 rounded-2xl p-3"
                style={{ background: 'var(--surface-overlay-2)', border: '1px solid var(--border)' }}
                aria-label={ui.rsvpHeading}
            >
                <div className="text-xs font-semibold text-fg">{ui.rsvpHeading}</div>
                <div className="flex items-center gap-2 flex-wrap">
                    {(['yes', 'no', 'maybe'] as const).map((status) => {
                        const selected = myRsvp === status;
                        const label = status === 'yes' ? ui.rsvpYes : status === 'no' ? ui.rsvpNo : ui.rsvpMaybe;
                        const count = counts[status];
                        return (
                            <button
                                key={status}
                                type="button"
                                disabled={rsvpLocked}
                                onClick={() => void handleRsvp(status)}
                                className="chip"
                                data-active={selected || undefined}
                                data-tone={selected ? 'primary' : undefined}
                                aria-pressed={selected}
                            >
                                {label}
                                <span className="ml-1 opacity-75">· {count}</span>
                            </button>
                        );
                    })}
                </div>
                {myRsvp !== null && !past ? (
                    <button
                        type="button"
                        disabled={rsvpBusy}
                        onClick={() => void handleClear()}
                        className="text-xs underline text-muted-fg"
                    >
                        {ui.rsvpClear}
                    </button>
                ) : null}
                {past ? (
                    <p className="text-xs text-muted-fg">{ui.pastRsvpHint}</p>
                ) : null}
                {rsvpError ? (
                    <p className="text-xs text-danger-fg">{rsvpError}</p>
                ) : null}
            </section>

            {onToggleReaction && socialBeta ? (
                <ReactionsBar
                    reactions={event.reactions?.items || []}
                    mine={event.reactions?.mine || []}
                    onToggle={onToggleReaction}
                />
            ) : null}
            {showComments && currentUserId ? (
                <div className="mt-3">
                    <CommentsThread
                        entityId={event.id}
                        currentUserId={currentUserId}
                        onCommentAdded={refreshFeed}
                        mentionScope={mentionScope}
                    />
                </div>
            ) : null}
            {showAttachments && currentUserId ? (
                <div className="mt-3">
                    <AttachmentsList
                        entityId={event.id}
                        currentUserId={currentUserId}
                        enableEdit={event.authorUserId === currentUserId}
                    />
                </div>
            ) : null}
        </article>
    );
}
