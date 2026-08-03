/**
 * Local i18n factory for the Revision History modal.
 *
 * Kept here (next to the component) instead of in the global locale files so
 * concurrent feature branches that touch `frontend/src/lib/locales/*` or
 * `language-context.tsx` don't collide. Mirrors the `get*Ui(language)` factory
 * pattern used by `events-i18n.ts`, `polls-i18n.ts`, `reactions-i18n.ts`.
 */

type Lang = 'ru' | 'kz' | 'en';

export interface RevisionHistoryUi {
    /** Modal title bar. */
    title: string;
    /** Action chip on a card that opens the modal (tooltip + aria label). */
    openLabel: string;
    /** Visible loading text while revisions are fetching. */
    loading: string;
    /** Empty-state body when the entity has no revisions yet (shouldn't happen — every entity has at least one `create` row, but defensive). */
    empty: string;
    /** Generic error fallback when the fetch fails for an unknown reason. */
    errorGeneric: string;
    /** Close-button label / aria label. */
    close: string;
    /** Heading inside an expanded `update` revision showing the diff against the previous revision. */
    diffHeading: string;
    /** Fallback when the diff between two adjacent revisions is empty (rare — usually means a no-op edit). */
    diffEmpty: string;
    /** Toggle label to expand an `update` row's diff. */
    expand: string;
    /** Toggle label to collapse an `update` row's diff. */
    collapse: string;
    /** Section label for the "previous value" column in the diff. */
    diffBefore: string;
    /** Section label for the "new value" column in the diff. */
    diffAfter: string;
    /** Diff-row chip text for an added field. */
    diffAdded: string;
    /** Diff-row chip text for a removed field. */
    diffRemoved: string;
    /** Diff-row chip text for a changed field. */
    diffChanged: string;
    /** Note prefix shown when a `delete` revision has an attached reason. */
    deleteNoteLabel: string;
    /** Kind chip label — entity creation event. */
    kindCreate: string;
    /** Kind chip label — entity edited. */
    kindUpdate: string;
    /** Kind chip label — entity soft-deleted. */
    kindDelete: string;
    /** Kind chip label — entity restored from soft-delete. */
    kindRestore: string;
}

export function getRevisionHistoryUi(language: Lang): RevisionHistoryUi {
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    return {
        title: isRu ? 'История изменений' : isKz ? 'Өзгерістер тарихы' : 'Edit history',
        openLabel: isRu ? 'История' : isKz ? 'Тарих' : 'History',
        loading: isRu ? 'Загрузка истории…' : isKz ? 'Тарих жүктелуде…' : 'Loading history…',
        empty: isRu
            ? 'История пока пуста.'
            : isKz
                ? 'Тарих әзірге бос.'
                : 'No revisions yet.',
        errorGeneric: isRu
            ? 'Не удалось загрузить историю изменений.'
            : isKz
                ? 'Өзгерістер тарихын жүктеу мүмкін болмады.'
                : 'Failed to load edit history.',
        close: isRu ? 'Закрыть' : isKz ? 'Жабу' : 'Close',
        diffHeading: isRu
            ? 'Что изменилось'
            : isKz
                ? 'Не өзгерді'
                : 'What changed',
        diffEmpty: isRu
            ? 'Изменений в полях не обнаружено.'
            : isKz
                ? 'Өрістерде өзгерістер табылмады.'
                : 'No field changes detected.',
        expand: isRu ? 'Показать изменения' : isKz ? 'Өзгерістерді көрсету' : 'Show changes',
        collapse: isRu ? 'Скрыть изменения' : isKz ? 'Өзгерістерді жасыру' : 'Hide changes',
        diffBefore: isRu ? 'Было' : isKz ? 'Бұрын' : 'Before',
        diffAfter: isRu ? 'Стало' : isKz ? 'Қазір' : 'After',
        diffAdded: isRu ? 'добавлено' : isKz ? 'қосылды' : 'added',
        diffRemoved: isRu ? 'удалено' : isKz ? 'жойылды' : 'removed',
        diffChanged: isRu ? 'изменено' : isKz ? 'өзгертілді' : 'changed',
        deleteNoteLabel: isRu ? 'Причина' : isKz ? 'Себебі' : 'Reason',
        kindCreate: isRu ? 'Создано' : isKz ? 'Жасалды' : 'Created',
        kindUpdate: isRu ? 'Изменено' : isKz ? 'Өзгертілді' : 'Edited',
        kindDelete: isRu ? 'Удалено' : isKz ? 'Жойылды' : 'Deleted',
        kindRestore: isRu ? 'Восстановлено' : isKz ? 'Қалпына келтірілді' : 'Restored',
    };
}
