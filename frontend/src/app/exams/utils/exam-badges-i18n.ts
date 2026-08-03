/**
 * Local i18n factory for the exam meta badges chips (online / additional /
 * final / state). Kept here instead of in `frontend/src/lib/locales/*.ts`
 * to avoid merge conflicts with other in-flight feature branches that touch
 * the global language context. Mirrors the `get*Ui(language)` pattern used in
 * other admin/feature modules.
 */
type Lang = 'ru' | 'kz' | 'en';

export interface ExamBadgesUi {
    online: string;
    additional: string;
    final: string;
    state: string;
}

export function getExamBadgesUi(language: Lang): ExamBadgesUi {
    if (language === 'en') {
        return {
            online: 'Online',
            additional: 'Retake',
            final: 'Final',
            state: 'State',
        };
    }
    if (language === 'kz') {
        return {
            online: 'Онлайн',
            additional: 'Қосымша',
            final: 'Қорытынды',
            state: 'Мемлекеттік',
        };
    }
    return {
        online: 'Онлайн',
        additional: 'Пересдача',
        final: 'Итоговый',
        state: 'Госэкзамен',
    };
}
