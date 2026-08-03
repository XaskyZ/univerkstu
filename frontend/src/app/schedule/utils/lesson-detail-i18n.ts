/**
 * Local i18n factory for the lesson detail/note UI strings used by the
 * schedule lesson card. Kept here (instead of in the global locale files)
 * to avoid merge conflicts with other in-flight feature branches that
 * touch `frontend/src/lib/locales/*` or `frontend/src/lib/language-context.tsx`.
 *
 * Mirrors the `get*Ui(language)` factory pattern used in admin/.
 */

type Lang = 'ru' | 'kz' | 'en';

export interface LessonDetailUi {
    /** Label for the "Note" section / aria. */
    noteLabel: string;
    /** Textarea placeholder shown when there is no saved note yet. */
    savePlaceholder: string;
    /** Save button label. */
    save: string;
    /** Delete (clear) button label. */
    delete: string;
    /** Toast string after a successful save. */
    saved: string;
    /** Toast string after a successful delete. */
    deleted: string;
    /** Confirmation prompt before deleting a saved note. */
    confirmDelete: string;
    /** Live counter beneath the textarea — e.g. `12/500`. */
    charsLeft: (current: number, max: number) => string;
    /**
     * Aria/title text for the small corner indicator dot shown on the lesson
     * card when a note exists for that lesson.
     */
    hasNoteIndicator: string;
}

export function getLessonDetailUi(language: Lang): LessonDetailUi {
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    return {
        noteLabel: isRu ? 'Заметка' : isKz ? 'Жазба' : 'Note',
        savePlaceholder: isRu
            ? 'Напиши короткую заметку к этой паре...'
            : isKz
                ? 'Осы сабаққа қысқа жазба қалдырыңыз...'
                : 'Write a short note for this lesson...',
        save: isRu ? 'Сохранить' : isKz ? 'Сақтау' : 'Save',
        delete: isRu ? 'Удалить' : isKz ? 'Жою' : 'Delete',
        saved: isRu ? 'Заметка сохранена' : isKz ? 'Жазба сақталды' : 'Note saved',
        deleted: isRu ? 'Заметка удалена' : isKz ? 'Жазба жойылды' : 'Note deleted',
        confirmDelete: isRu
            ? 'Удалить эту заметку?'
            : isKz
                ? 'Бұл жазбаны жою керек пе?'
                : 'Delete this note?',
        charsLeft: (current: number, max: number) => `${current}/${max}`,
        hasNoteIndicator: isRu
            ? 'У этой пары есть заметка'
            : isKz
                ? 'Бұл сабақта жазба бар'
                : 'This lesson has a note',
    };
}
