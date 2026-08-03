/**
 * Local i18n factory for the polls UI (PollCard + CreatePollModal). Kept here
 * instead of in the global locale files so concurrent feature branches that
 * touch `frontend/src/lib/locales/*` or `language-context.tsx` don't collide.
 *
 * Mirrors the `get*Ui(language)` factory pattern used elsewhere in the
 * project (see `reactions-i18n.ts`).
 */

type Lang = 'ru' | 'kz' | 'en';

export interface PollsUi {
    /** Label shown above the create-poll form / used as the create button. */
    createPoll: string;
    /** Modal title when composing a new poll. */
    createPollTitle: string;
    questionLabel: string;
    questionPlaceholder: string;
    optionsLabel: string;
    optionPlaceholder: (index: number) => string;
    addOption: string;
    removeOption: string;
    submit: string;
    cancel: string;
    minOptions: string;
    maxOptions: string;
    /** Single-vote breakdown — `${count} ${votesPluralLabel(count)}`. */
    votesPluralLabel: (count: number) => string;
    totalVotes: (count: number) => string;
    closed: string;
    closePoll: string;
    closePollConfirm: string;
    voted: string;
    unvote: string;
    voteFailed: string;
    unvoteFailed: string;
    closeFailed: string;
    winningOption: string;
    /** Toggle label in CreatePollModal — when on the poll accepts multiple selections per voter. */
    multiChoiceToggle: string;
    /** Hint copy under the toggle. */
    multiChoiceHint: string;
    /** Chip rendered on the poll header when `multiChoice === true`. */
    multiChoiceBadge: string;
    /** Variant of the "Unvote" affordance when the viewer has multiple selections (multi-choice). */
    unvoteAll: string;
}

function pluralRu(count: number, one: string, few: string, many: string): string {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
    return many;
}

export function getPollsUi(language: Lang): PollsUi {
    const isRu = language === 'ru';
    const isKz = language === 'kz';

    return {
        createPoll: isRu ? 'Создать опрос' : isKz ? 'Сауалнама жасау' : 'Create poll',
        createPollTitle: isRu ? 'Новый опрос' : isKz ? 'Жаңа сауалнама' : 'New poll',
        questionLabel: isRu ? 'Вопрос' : isKz ? 'Сұрақ' : 'Question',
        questionPlaceholder: isRu
            ? 'Например: какую тему повторим?'
            : isKz
                ? 'Мысалы: қай тақырыпты қайталаймыз?'
                : 'e.g. which topic to review?',
        optionsLabel: isRu ? 'Варианты' : isKz ? 'Нұсқалар' : 'Options',
        optionPlaceholder: (index: number) =>
            isRu ? `Вариант ${index + 1}` : isKz ? `${index + 1}-нұсқа` : `Option ${index + 1}`,
        addOption: isRu ? 'Добавить вариант' : isKz ? 'Нұсқа қосу' : 'Add option',
        removeOption: isRu ? 'Удалить' : isKz ? 'Жою' : 'Remove',
        submit: isRu ? 'Создать' : isKz ? 'Жасау' : 'Create',
        cancel: isRu ? 'Отмена' : isKz ? 'Бас тарту' : 'Cancel',
        minOptions: isRu
            ? 'Нужно минимум 2 варианта'
            : isKz
                ? 'Кемінде 2 нұсқа қажет'
                : 'At least 2 options required',
        maxOptions: isRu
            ? 'Максимум 8 вариантов'
            : isKz
                ? 'Ең көп дегенде 8 нұсқа'
                : 'At most 8 options',
        votesPluralLabel: (count: number) => {
            if (isRu) return pluralRu(count, 'голос', 'голоса', 'голосов');
            if (isKz) return 'дауыс';
            return count === 1 ? 'vote' : 'votes';
        },
        totalVotes: (count: number) => {
            if (isRu) return `${count} ${pluralRu(count, 'голос', 'голоса', 'голосов')}`;
            if (isKz) return `${count} дауыс`;
            return `${count} ${count === 1 ? 'vote' : 'votes'}`;
        },
        closed: isRu ? 'Опрос закрыт' : isKz ? 'Сауалнама жабылды' : 'Poll closed',
        closePoll: isRu ? 'Закрыть опрос' : isKz ? 'Сауалнаманы жабу' : 'Close poll',
        closePollConfirm: isRu
            ? 'Закрыть опрос? После этого голосовать будет нельзя.'
            : isKz
                ? 'Сауалнаманы жабасыз ба? Содан кейін дауыс беру мүмкін болмайды.'
                : 'Close this poll? Voting will be disabled after that.',
        voted: isRu ? 'Вы проголосовали' : isKz ? 'Сіз дауыс бердіңіз' : 'You voted',
        unvote: isRu ? 'Отменить голос' : isKz ? 'Дауысты алып тастау' : 'Unvote',
        voteFailed: isRu
            ? 'Не удалось сохранить голос'
            : isKz
                ? 'Дауысты сақтау сәтсіз аяқталды'
                : 'Failed to save vote',
        unvoteFailed: isRu
            ? 'Не удалось отменить голос'
            : isKz
                ? 'Дауысты алып тастау сәтсіз аяқталды'
                : 'Failed to unvote',
        closeFailed: isRu
            ? 'Не удалось закрыть опрос'
            : isKz
                ? 'Сауалнаманы жабу сәтсіз аяқталды'
                : 'Failed to close poll',
        winningOption: isRu ? 'Лидирует' : isKz ? 'Көш бастап тұр' : 'Winning',
        multiChoiceToggle: isRu
            ? 'Несколько вариантов выбора'
            : isKz
                ? 'Бірнеше нұсқаны таңдау'
                : 'Allow multiple selections',
        multiChoiceHint: isRu
            ? 'Каждый может выбрать несколько вариантов и менять выбор повторным нажатием.'
            : isKz
                ? 'Әр қатысушы бірнеше нұсқаны таңдай алады, қайта басу таңдауды алып тастайды.'
                : 'Voters can pick more than one option; tapping a selected option again clears it.',
        multiChoiceBadge: isRu
            ? 'Мульти-выбор'
            : isKz
                ? 'Көп таңдау'
                : 'Multi-choice',
        unvoteAll: isRu
            ? 'Сбросить все'
            : isKz
                ? 'Барлығын тазалау'
                : 'Clear all',
    };
}
