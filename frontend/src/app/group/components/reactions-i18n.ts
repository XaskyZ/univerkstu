/**
 * Local i18n factory for the feed-post reactions bar. Kept here instead of in
 * the global locale files so concurrent feature branches that touch
 * `frontend/src/lib/locales/*` or `language-context.tsx` don't collide.
 *
 * Mirrors the `get*Ui(language)` factory pattern used elsewhere in the project.
 */

type Lang = 'ru' | 'kz' | 'en';

export interface ReactionsUi {
    /** ARIA label for the row of reaction buttons. */
    barLabel: string;
    /** ARIA label for a single emoji button — `${emoji} ${aria}`. */
    pickAria: (emoji: string) => string;
    /** Toast/error text shown when toggling failed. */
    toggleFailed: string;
}

export function getReactionsUi(language: Lang): ReactionsUi {
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    return {
        barLabel: isRu
            ? 'Реакции на пост'
            : isKz
                ? 'Жазбаға реакциялар'
                : 'Post reactions',
        pickAria: (emoji: string) =>
            isRu
                ? `Реакция ${emoji}`
                : isKz
                    ? `${emoji} реакциясы`
                    : `React with ${emoji}`,
        toggleFailed: isRu
            ? 'Не удалось сохранить реакцию'
            : isKz
                ? 'Реакцияны сақтау сәтсіз аяқталды'
                : 'Failed to save reaction',
    };
}
