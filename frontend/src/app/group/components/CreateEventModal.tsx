'use client';

import { useCallback, useMemo, useState } from 'react';
import { useLanguage } from '@/lib/language-context';
import { createSocialEntity } from '@/lib/api/social';
import { buildDraftKey, clearDraft } from '@/lib/use-draft';
import GroupFormModal, { type GroupFormField } from './GroupFormModal';
import { getEventsUi } from './events-i18n';

interface CreateEventModalProps {
    open: boolean;
    groupKey: string;
    /** Closes the modal — invoked on cancel and after a successful create. */
    onClose: () => void;
    /**
     * Optional callback fired after a successful create so the parent feed
     * can refresh. The new entity id is forwarded for parents that want to
     * scroll-to it or open it inline.
     */
    onCreated?: (eventId: string) => void;
}

/**
 * Internal datetime-local → ISO conversion. The HTML `datetime-local` input
 * surfaces a string like `"2026-06-01T10:00"` (no timezone, no seconds). We
 * coerce it into an ISO string at the user's local timezone before posting
 * to the backend so the entity row stores an unambiguous instant.
 *
 * Returns an empty string for empty / unparseable input.
 */
export function datetimeLocalToIso(value: string): string {
    if (!value) return '';
    // Append a seconds segment so older browsers parse consistently; the
    // browser is responsible for picking the right timezone offset for the
    // local-time string.
    const parsed = new Date(value.length === 16 ? `${value}:00` : value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString();
}

/**
 * Pure helper — returns a validation error message (or null on success) for
 * the modal's collected form values. Exported so the unit test can assert
 * each branch without rendering React.
 */
export function validateCreateEventForm(
    values: {
        title: string;
        startsAt: string;
        endsAt: string;
    },
    ui: { errorTitleRequired: string; errorStartsAtRequired: string; errorEndsBeforeStart: string },
): string | null {
    if (!values.title.trim()) return ui.errorTitleRequired;
    if (!values.startsAt.trim()) return ui.errorStartsAtRequired;
    if (values.endsAt.trim()) {
        const starts = new Date(values.startsAt).getTime();
        const ends = new Date(values.endsAt).getTime();
        if (!Number.isNaN(starts) && !Number.isNaN(ends) && ends < starts) {
            return ui.errorEndsBeforeStart;
        }
    }
    return null;
}

/**
 * Modal to create a new `kind='event'` entity in the given group scope.
 *
 * Layout: title, body (optional, mentionable), startsAt (datetime-local),
 * endsAt (optional, datetime-local), location (optional).
 *
 * The submit handler validates client-side, converts datetime-local strings
 * into ISO instants, and POSTs to `/api/v3/social/entities`. On success the
 * modal calls `onCreated(id)` and then `onClose()`. Failures surface inline.
 */
export default function CreateEventModal({
    open,
    groupKey,
    onClose,
    onCreated,
}: CreateEventModalProps) {
    const { language } = useLanguage();
    const ui = useMemo(() => getEventsUi(language), [language]);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    // Stable per-group draft key — only the body field is persisted (per spec:
    // "только текст value"). Used both to enable autosave inside the form
    // modal and to clear the persisted draft once the event lands successfully.
    const bodyDraftKey = useMemo(() => buildDraftKey('event-create', groupKey), [groupKey]);

    const fields: GroupFormField[] = useMemo(() => ([
        { name: 'title', label: ui.titleField, type: 'text', required: true },
        {
            name: 'body',
            label: ui.bodyField,
            type: 'textarea',
            rows: 3,
            mentionScope: `group:${groupKey}`,
            draftKey: bodyDraftKey,
        },
        { name: 'startsAt', label: ui.startsAtField, type: 'datetime', required: true },
        { name: 'endsAt', label: ui.endsAtField, type: 'datetime' },
        { name: 'location', label: ui.locationField, type: 'text' },
        {
            name: 'recurrence',
            label: ui.recurrenceField,
            type: 'select',
            defaultValue: 'none',
            options: [
                { label: ui.recurrenceNone, value: 'none' },
                { label: ui.recurrenceWeekly, value: 'weekly' },
                { label: ui.recurrenceMonthly, value: 'monthly' },
            ],
        },
        { name: 'recurrenceUntil', label: ui.recurrenceUntilField, type: 'date' },
    ]), [groupKey, ui, bodyDraftKey]);

    const handleSubmit = useCallback(
        async (values: Record<string, string | boolean>) => {
            setSubmitError('');
            const collected = {
                title: String(values.title || ''),
                body: String(values.body || ''),
                startsAt: String(values.startsAt || ''),
                endsAt: String(values.endsAt || ''),
                location: String(values.location || ''),
                recurrence: String(values.recurrence || 'none'),
                recurrenceUntil: String(values.recurrenceUntil || ''),
            };
            const error = validateCreateEventForm(collected, ui);
            if (error) {
                setSubmitError(error);
                return;
            }
            setSubmitting(true);
            try {
                // datetime-local → ISO. We deliberately do this here (not in
                // the adapter) so the input field can still display the raw
                // local-time string while we send the canonical ISO instant.
                const payload: Record<string, unknown> = {
                    title: collected.title.trim(),
                    startsAt: datetimeLocalToIso(collected.startsAt),
                };
                if (collected.body.trim()) payload.body = collected.body.trim();
                if (collected.endsAt) {
                    const endsIso = datetimeLocalToIso(collected.endsAt);
                    if (endsIso) payload.endsAt = endsIso;
                }
                if (collected.location.trim()) payload.location = collected.location.trim();

                // Recurrence: only attach the descriptor when the user picked
                // weekly/monthly. The default 'none' option keeps the event
                // one-off, matching the existing CreateEventModal contract.
                if (collected.recurrence === 'weekly' || collected.recurrence === 'monthly') {
                    const recurrence: Record<string, unknown> = { kind: collected.recurrence };
                    if (collected.recurrenceUntil) {
                        // date → ISO at end-of-day in the local zone so the
                        // backend's inclusive "until" matches the day the
                        // user picked. We use noon UTC as a safe midpoint.
                        const untilIso = datetimeLocalToIso(`${collected.recurrenceUntil}T23:59`);
                        if (untilIso) recurrence.until = untilIso;
                    }
                    payload.recurrence = recurrence;
                }

                const result = await createSocialEntity({
                    kind: 'event',
                    scopeType: 'group',
                    scopeId: `group:${groupKey}`,
                    payload,
                });
                if (!result.success || !result.data) {
                    setSubmitError(result.error || ui.rsvpFailed);
                    return;
                }
                // Drop the persisted body draft now that the event has
                // landed. Cancel intentionally leaves the draft in place so
                // a retry recovers it.
                clearDraft(bodyDraftKey);
                onCreated?.(result.data.id);
                onClose();
            } catch {
                setSubmitError(ui.rsvpFailed);
            } finally {
                setSubmitting(false);
            }
        },
        [groupKey, onClose, onCreated, ui, bodyDraftKey],
    );

    return (
        <>
            <GroupFormModal
                open={open}
                title={ui.createTitle}
                submitLabel={ui.submitCreate}
                loading={submitting}
                onCancel={() => {
                    setSubmitError('');
                    onClose();
                }}
                fields={fields}
                onSubmit={handleSubmit}
            />
            {submitError && open ? (
                <p
                    role="alert"
                    className="text-xs text-danger-fg fixed bottom-4 right-4"
                    style={{ background: 'var(--surface-overlay-2)', padding: 8, borderRadius: 8, border: '1px solid var(--border)', zIndex: 1000 }}
                >
                    {submitError}
                </p>
            ) : null}
        </>
    );
}
