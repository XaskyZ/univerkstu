/**
 * Local i18n factory for the universal CommentsThread component. Kept here
 * (next to the component) instead of in `lib/locales/*` so concurrent feature
 * branches that touch the global locale tables do not collide while Phase 2
 * lands. Mirrors the `get*Ui(language)` factory pattern used elsewhere in
 * the project (e.g. `reactions-i18n.ts`, `lesson-detail-i18n.ts`).
 *
 * Pure function — no React, no localStorage, no DOM. Tests only need to
 * exercise locale parity.
 */

type Lang = 'ru' | 'kz' | 'en';

export interface CommentsThreadUi {
    /** Button label when the thread is collapsed: "Показать N комментариев". */
    showComments: (count: number) => string;
    /** Button label when the thread is expanded: "Скрыть комментарии". */
    hideComments: string;
    /** Textarea placeholder for the composer. */
    placeholder: string;
    /** Send button label. */
    send: string;
    /** Reply button label on a top-level comment. */
    reply: string;
    /** Cancel button label inside the inline reply composer. */
    cancel: string;
    /** Loading-skeleton row label / aria text. */
    loading: string;
    /** Empty-state copy when the entity has no comments yet. */
    empty: string;
    /** Error copy when the initial fetch failed. */
    loadFailed: string;
    /** Error copy when posting a comment failed. */
    sendFailed: string;
    /** "X/2000" character counter under the composer. */
    charCount: (current: number, max: number) => string;
    /** Placeholder body shown in place of a soft-deleted comment (future). */
    deletedComment: string;
    /** ARIA label for the thread region as a whole. */
    threadAriaLabel: string;
}

export function getCommentsThreadUi(language: Lang): CommentsThreadUi {
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    return {
        showComments: (count: number) => {
            if (isRu) {
                // Russian pluralization for "комментарий" via classic 3-form rule.
                const mod10 = count % 10;
                const mod100 = count % 100;
                if (mod10 === 1 && mod100 !== 11) {
                    return `Показать ${count} комментарий`;
                }
                if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
                    return `Показать ${count} комментария`;
                }
                return `Показать ${count} комментариев`;
            }
            if (isKz) {
                return `${count} пікірді көрсету`;
            }
            return count === 1 ? `Show 1 comment` : `Show ${count} comments`;
        },
        hideComments: isRu
            ? 'Скрыть комментарии'
            : isKz
                ? 'Пікірлерді жасыру'
                : 'Hide comments',
        placeholder: isRu
            ? 'Напишите комментарий…'
            : isKz
                ? 'Пікір жазыңыз…'
                : 'Write a comment…',
        send: isRu ? 'Отправить' : isKz ? 'Жіберу' : 'Send',
        reply: isRu ? 'Ответить' : isKz ? 'Жауап беру' : 'Reply',
        cancel: isRu ? 'Отмена' : isKz ? 'Болдырмау' : 'Cancel',
        loading: isRu
            ? 'Загрузка комментариев…'
            : isKz
                ? 'Пікірлер жүктелуде…'
                : 'Loading comments…',
        empty: isRu
            ? 'Пока нет комментариев. Будь первым.'
            : isKz
                ? 'Әзірге пікір жоқ. Бірінші болыңыз.'
                : 'No comments yet. Be the first.',
        loadFailed: isRu
            ? 'Не удалось загрузить комментарии'
            : isKz
                ? 'Пікірлерді жүктеу мүмкін болмады'
                : 'Failed to load comments',
        sendFailed: isRu
            ? 'Не удалось отправить комментарий'
            : isKz
                ? 'Пікірді жіберу мүмкін болмады'
                : 'Failed to send the comment',
        charCount: (current: number, max: number) => `${current}/${max}`,
        deletedComment: isRu
            ? 'Комментарий удалён'
            : isKz
                ? 'Пікір жойылған'
                : 'Comment deleted',
        threadAriaLabel: isRu
            ? 'Комментарии'
            : isKz
                ? 'Пікірлер'
                : 'Comments',
    };
}
