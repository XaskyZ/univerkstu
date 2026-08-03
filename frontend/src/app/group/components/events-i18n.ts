/**
 * Local i18n factory for the events surface (EventCard + CreateEventModal).
 *
 * Kept here instead of in the global locale files so concurrent feature
 * branches that touch `frontend/src/lib/locales/*` or `language-context.tsx`
 * don't collide. Mirrors the `get*Ui(language)` factory pattern used by
 * `reactions-i18n.ts`.
 */

type Lang = 'ru' | 'kz' | 'en';

export interface EventsUi {
    /** Section heading for the create modal. */
    createTitle: string;
    /** Section heading for the edit modal (future — not wired yet). */
    editTitle: string;
    /** Affordance to open the create modal. */
    newEvent: string;
    /** Label for the title field in the modal form. */
    titleField: string;
    /** Label for the optional body field. */
    bodyField: string;
    /** Label for the required startsAt field. */
    startsAtField: string;
    /** Label for the optional endsAt field. */
    endsAtField: string;
    /** Label for the optional location field. */
    locationField: string;
    /** Submit button label on the create modal. */
    submitCreate: string;
    /** Submit button label on the edit modal. */
    submitEdit: string;
    /** Cancel button label. */
    cancel: string;
    /** RSVP section heading (above the buttons). */
    rsvpHeading: string;
    /** Label for the "Yes" RSVP button (and an aria-friendly variant). */
    rsvpYes: string;
    /** Label for the "No" RSVP button. */
    rsvpNo: string;
    /** Label for the "Maybe" RSVP button. */
    rsvpMaybe: string;
    /** "Clear" link below the buttons when myRsvp is set. */
    rsvpClear: string;
    /** Badge text for past events. */
    pastBadge: string;
    /** Read-only RSVP hint for past events. */
    pastRsvpHint: string;
    /** Body of the empty-state when there are no events yet. */
    emptyEvents: string;
    /** Toast text shown when an RSVP request fails. */
    rsvpFailed: string;
    /** Validation error — missing title in the modal. */
    errorTitleRequired: string;
    /** Validation error — missing startsAt in the modal. */
    errorStartsAtRequired: string;
    /** Validation error — endsAt is before startsAt. */
    errorEndsBeforeStart: string;
    /** Aria label for the "starts at" badge in the card header. */
    startsAtAria: (formatted: string) => string;
    /** Recurrence dropdown label in the create modal. */
    recurrenceField: string;
    /** Recurrence "None" option (one-off event, default). */
    recurrenceNone: string;
    /** Recurrence "Weekly" option. */
    recurrenceWeekly: string;
    /** Recurrence "Monthly" option. */
    recurrenceMonthly: string;
    /** Label for the optional `until` date control. */
    recurrenceUntilField: string;
    /** Label for the optional `occurrencesAhead` control. */
    recurrenceOccurrencesField: string;
    /** Helper hint shown under the recurrence dropdown. */
    recurrenceHint: string;
    /** Badge text for a series anchor — e.g. "Series — weekly". */
    seriesBadgeWeekly: string;
    /** Badge text for a monthly series anchor. */
    seriesBadgeMonthly: string;
    /** Badge text for a follow-up occurrence (no recurrence descriptor on the row). */
    seriesMemberBadge: string;
}

export function getEventsUi(language: Lang): EventsUi {
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    return {
        createTitle: isRu
            ? 'Новое событие'
            : isKz
                ? 'Жаңа іс-шара'
                : 'New event',
        editTitle: isRu
            ? 'Изменить событие'
            : isKz
                ? 'Іс-шараны өзгерту'
                : 'Edit event',
        newEvent: isRu
            ? 'Создать событие'
            : isKz
                ? 'Іс-шара жасау'
                : 'New event',
        titleField: isRu
            ? 'Название'
            : isKz
                ? 'Атауы'
                : 'Title',
        bodyField: isRu
            ? 'Описание'
            : isKz
                ? 'Сипаттамасы'
                : 'Description',
        startsAtField: isRu
            ? 'Начало'
            : isKz
                ? 'Басталуы'
                : 'Starts',
        endsAtField: isRu
            ? 'Окончание'
            : isKz
                ? 'Аяқталуы'
                : 'Ends',
        locationField: isRu
            ? 'Место'
            : isKz
                ? 'Орны'
                : 'Location',
        submitCreate: isRu
            ? 'Создать'
            : isKz
                ? 'Жасау'
                : 'Create',
        submitEdit: isRu
            ? 'Сохранить'
            : isKz
                ? 'Сақтау'
                : 'Save',
        cancel: isRu
            ? 'Отмена'
            : isKz
                ? 'Бас тарту'
                : 'Cancel',
        rsvpHeading: isRu
            ? 'Вы пойдёте?'
            : isKz
                ? 'Қатысасыз ба?'
                : 'Will you attend?',
        rsvpYes: isRu
            ? 'Да'
            : isKz
                ? 'Иә'
                : 'Yes',
        rsvpNo: isRu
            ? 'Нет'
            : isKz
                ? 'Жоқ'
                : 'No',
        rsvpMaybe: isRu
            ? 'Возможно'
            : isKz
                ? 'Мүмкін'
                : 'Maybe',
        rsvpClear: isRu
            ? 'Сбросить'
            : isKz
                ? 'Тазалау'
                : 'Clear',
        pastBadge: isRu
            ? 'состоялось'
            : isKz
                ? 'өткен'
                : 'past',
        pastRsvpHint: isRu
            ? 'Событие уже прошло'
            : isKz
                ? 'Іс-шара аяқталған'
                : 'This event has already ended',
        emptyEvents: isRu
            ? 'Пока нет событий'
            : isKz
                ? 'Әзірге іс-шаралар жоқ'
                : 'No events yet',
        rsvpFailed: isRu
            ? 'Не удалось сохранить ответ'
            : isKz
                ? 'Жауапты сақтау сәтсіз аяқталды'
                : 'Failed to save RSVP',
        errorTitleRequired: isRu
            ? 'Укажите название'
            : isKz
                ? 'Атауын көрсетіңіз'
                : 'Title is required',
        errorStartsAtRequired: isRu
            ? 'Укажите время начала'
            : isKz
                ? 'Басталу уақытын көрсетіңіз'
                : 'Start time is required',
        errorEndsBeforeStart: isRu
            ? 'Окончание раньше начала'
            : isKz
                ? 'Аяқталу басталудан ерте'
                : 'End is before start',
        startsAtAria: (formatted: string) =>
            isRu
                ? `Начало ${formatted}`
                : isKz
                    ? `Басталуы ${formatted}`
                    : `Starts ${formatted}`,
        recurrenceField: isRu
            ? 'Повторение'
            : isKz
                ? 'Қайталану'
                : 'Recurrence',
        recurrenceNone: isRu
            ? 'Не повторяется'
            : isKz
                ? 'Қайталанбайды'
                : 'Does not repeat',
        recurrenceWeekly: isRu
            ? 'Каждую неделю'
            : isKz
                ? 'Апта сайын'
                : 'Weekly',
        recurrenceMonthly: isRu
            ? 'Каждый месяц'
            : isKz
                ? 'Ай сайын'
                : 'Monthly',
        recurrenceUntilField: isRu
            ? 'Повторять до'
            : isKz
                ? 'Дейін қайталау'
                : 'Repeat until',
        recurrenceOccurrencesField: isRu
            ? 'Сколько вперёд'
            : isKz
                ? 'Алда қанша рет'
                : 'Occurrences ahead',
        recurrenceHint: isRu
            ? 'Серия создаст последующие события автоматически. Максимум 26 повторений.'
            : isKz
                ? 'Серия келесі іс-шараларды автоматты түрде жасайды. Ең көп 26 қайталау.'
                : 'A series creates follow-up events automatically. At most 26 occurrences.',
        seriesBadgeWeekly: isRu
            ? 'Серия — каждую неделю'
            : isKz
                ? 'Серия — апта сайын'
                : 'Series — weekly',
        seriesBadgeMonthly: isRu
            ? 'Серия — каждый месяц'
            : isKz
                ? 'Серия — ай сайын'
                : 'Series — monthly',
        seriesMemberBadge: isRu
            ? 'Часть серии'
            : isKz
                ? 'Серия бөлігі'
                : 'Part of series',
    };
}

/**
 * Pure helper — true when an event is "past" (its `endsAt` is in the past).
 * Falls back to `startsAt` when `endsAt` is missing so a single-instant event
 * (e.g. a lecture without a declared duration) is treated as ended once the
 * start has elapsed.
 *
 * Exported so EventCard's render logic and tests stay in sync.
 */
export function isEventPast(
    startsAt: string,
    endsAt: string | undefined,
    now: number = Date.now(),
): boolean {
    const reference = (endsAt && endsAt.length > 0 ? endsAt : startsAt) || '';
    if (!reference) return false;
    const parsed = new Date(reference).getTime();
    if (Number.isNaN(parsed)) return false;
    return parsed < now;
}

/**
 * Pure helper — format an ISO timestamp for display in the event header. The
 * `locale` matches the UI language (callers pass `localeTag(language)`), in line
 * with the rest of the group feed (PostCard / PollCard / TaskCard). Defaults to
 * `ru-RU` for callers/tests that don't supply one.
 *
 * Returns an empty string when the input cannot be parsed — the UI shows a
 * dash via `formatted || '—'`.
 */
export function formatEventDateTime(iso: string | undefined, locale = 'ru-RU'): string {
    if (!iso) return '';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(locale, {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    });
}
