/**
 * Local i18n factory for the academic history sub-screen (`/profile/history`).
 *
 * Kept here instead of in `frontend/src/lib/locales/*.ts` to avoid merge
 * conflicts with other in-flight feature branches that touch the global
 * language context. Mirrors the `get*Ui(language)` pattern used in other
 * admin/feature modules.
 */
export type HistoryLang = 'ru' | 'kz' | 'en';

export interface HistoryUi {
    // Header
    screenTitle: string;
    screenSubtitle: string;
    back: string;
    refresh: string;
    refreshing: string;

    // States
    loading: string;
    loadError: string;
    retry: string;
    emptyTitle: string;
    needsRelogin: string;

    // Section titles
    recbookSection: string;
    transcriptSection: string;

    // Common fields
    fullName: string;
    faculty: string;
    educationStep: string;
    educationLevel: string;
    formOfEducation: string;
    department: string;
    course: string;
    studyDuration: string;
    caseFile: string;

    // Recbook-specific
    recbookEmpty: string;
    recbookSpecialtyCode: string;
    recbookSpecialty: string;
    recbookSpecialization: string;
    recbookRecords: string;
    recbookRk: string;
    recbookMt: string;
    recbookPa: string;
    recbookFinal: string;
    recbookExamDate: string;
    recbookTeacher: string;
    recbookExaminer: string;
    recbookCredits: string;
    recbookNoTerm: string;
    recbookTermPrefix: string;

    // Transcript-specific
    transcriptEmpty: string;
    transcriptStudyProgram: string;
    transcriptProgramGroup: string;
    transcriptTotalSubjects: string;
    transcriptYearSummaries: string;
    transcriptYearLabel: string;
    transcriptYearCredits: string;
    transcriptYearGpa: string;
    transcriptSubjects: string;
    transcriptSubjectsSearchPlaceholder: string;
    transcriptSubjectsNoMatches: string;
    transcriptCode: string;
    transcriptCredits: string;
    transcriptGrade: string;
    transcriptGpa: string;
    transcriptPractices: string;
    transcriptPracticesEmpty: string;
    transcriptPracticeType: string;
    transcriptPracticePeriod: string;
    transcriptOrders: string;
    transcriptOrdersEmpty: string;
    transcriptOrderCourse: string;
    transcriptStatsTitle: string;
    transcriptStatsExcellent: string;
    transcriptStatsGood: string;
    transcriptStatsSatisfactory: string;
    transcriptStatsUnsatisfactory: string;

    // Profile entry link
    historyLinkLabel: string;
    historyLinkHint: string;
}

const RU: HistoryUi = {
    screenTitle: 'Академическая история',
    screenSubtitle: 'Зачётка и академическая выписка по данным KSTU',
    back: 'Назад',
    refresh: 'Обновить',
    refreshing: 'Обновление…',

    loading: 'Загружаем академическую историю…',
    loadError: 'Не удалось загрузить академическую историю',
    retry: 'Повторить',
    emptyTitle: 'Пока нет данных академической истории',
    needsRelogin: 'Требуется повторный вход, чтобы обновить историю',

    recbookSection: 'Зачётка',
    transcriptSection: 'Академическая выписка',

    fullName: 'ФИО',
    faculty: 'Факультет',
    educationStep: 'Ступень обучения',
    educationLevel: 'Уровень образования',
    formOfEducation: 'Форма обучения',
    department: 'Кафедра',
    course: 'Курс',
    studyDuration: 'Срок обучения',
    caseFile: 'Номер личного дела',

    recbookEmpty: 'Зачётка пока недоступна',
    recbookSpecialtyCode: 'Код специальности',
    recbookSpecialty: 'Специальность',
    recbookSpecialization: 'Специализация',
    recbookRecords: 'Записей',
    recbookRk: 'РК',
    recbookMt: 'МТ',
    recbookPa: 'ПА',
    recbookFinal: 'Итог',
    recbookExamDate: 'Дата экзамена',
    recbookTeacher: 'Преподаватель',
    recbookExaminer: 'Экзаменатор',
    recbookCredits: 'Кредиты',
    recbookNoTerm: 'Семестр не указан',
    recbookTermPrefix: 'Семестр',

    transcriptEmpty: 'Академическая выписка пока недоступна',
    transcriptStudyProgram: 'Образовательная программа',
    transcriptProgramGroup: 'Группа программы',
    transcriptTotalSubjects: 'Всего дисциплин',
    transcriptYearSummaries: 'GPA по годам',
    transcriptYearLabel: 'Период',
    transcriptYearCredits: 'Кредитов',
    transcriptYearGpa: 'GPA',
    transcriptSubjects: 'Дисциплины',
    transcriptSubjectsSearchPlaceholder: 'Поиск по дисциплине…',
    transcriptSubjectsNoMatches: 'Ничего не найдено',
    transcriptCode: 'Код',
    transcriptCredits: 'Кредиты',
    transcriptGrade: 'Оценка',
    transcriptGpa: 'GPA',
    transcriptPractices: 'Практики',
    transcriptPracticesEmpty: 'Практики не зафиксированы',
    transcriptPracticeType: 'Тип',
    transcriptPracticePeriod: 'Период',
    transcriptOrders: 'Приказы',
    transcriptOrdersEmpty: 'Приказы не зафиксированы',
    transcriptOrderCourse: 'Курс',
    transcriptStatsTitle: 'Сводка оценок',
    transcriptStatsExcellent: 'Отлично',
    transcriptStatsGood: 'Хорошо',
    transcriptStatsSatisfactory: 'Удовлетворительно',
    transcriptStatsUnsatisfactory: 'Неудовлетворительно',

    historyLinkLabel: 'Академическая история',
    historyLinkHint: 'Зачётка и выписка',
};

const KZ: HistoryUi = {
    screenTitle: 'Академиялық тарих',
    screenSubtitle: 'KSTU деректері бойынша сынақ кітапшасы мен академиялық анықтама',
    back: 'Артқа',
    refresh: 'Жаңарту',
    refreshing: 'Жаңартылуда…',

    loading: 'Академиялық тарих жүктелуде…',
    loadError: 'Академиялық тарихты жүктеу мүмкін болмады',
    retry: 'Қайталау',
    emptyTitle: 'Әзірге академиялық тарих деректері жоқ',
    needsRelogin: 'Тарихты жаңарту үшін қайта кіру қажет',

    recbookSection: 'Сынақ кітапшасы',
    transcriptSection: 'Академиялық анықтама',

    fullName: 'Аты-жөні',
    faculty: 'Факультет',
    educationStep: 'Оқу сатысы',
    educationLevel: 'Білім деңгейі',
    formOfEducation: 'Оқу нысаны',
    department: 'Кафедра',
    course: 'Курс',
    studyDuration: 'Оқу мерзімі',
    caseFile: 'Жеке іс нөмірі',

    recbookEmpty: 'Сынақ кітапшасы әзірге қолжетімсіз',
    recbookSpecialtyCode: 'Мамандық коды',
    recbookSpecialty: 'Мамандық',
    recbookSpecialization: 'Мамандану',
    recbookRecords: 'Жазбалар',
    recbookRk: 'РК',
    recbookMt: 'МТ',
    recbookPa: 'ПА',
    recbookFinal: 'Қорытынды',
    recbookExamDate: 'Емтихан күні',
    recbookTeacher: 'Оқытушы',
    recbookExaminer: 'Емтихан алушы',
    recbookCredits: 'Кредиттер',
    recbookNoTerm: 'Семестр көрсетілмеген',
    recbookTermPrefix: 'Семестр',

    transcriptEmpty: 'Академиялық анықтама әзірге қолжетімсіз',
    transcriptStudyProgram: 'Білім беру бағдарламасы',
    transcriptProgramGroup: 'Бағдарлама тобы',
    transcriptTotalSubjects: 'Барлық пәндер',
    transcriptYearSummaries: 'Жылдар бойынша GPA',
    transcriptYearLabel: 'Кезең',
    transcriptYearCredits: 'Кредиттер',
    transcriptYearGpa: 'GPA',
    transcriptSubjects: 'Пәндер',
    transcriptSubjectsSearchPlaceholder: 'Пәнді іздеу…',
    transcriptSubjectsNoMatches: 'Ештеңе табылмады',
    transcriptCode: 'Код',
    transcriptCredits: 'Кредиттер',
    transcriptGrade: 'Баға',
    transcriptGpa: 'GPA',
    transcriptPractices: 'Практикалар',
    transcriptPracticesEmpty: 'Практикалар тіркелмеген',
    transcriptPracticeType: 'Түрі',
    transcriptPracticePeriod: 'Кезең',
    transcriptOrders: 'Бұйрықтар',
    transcriptOrdersEmpty: 'Бұйрықтар тіркелмеген',
    transcriptOrderCourse: 'Курс',
    transcriptStatsTitle: 'Бағалар жиынтығы',
    transcriptStatsExcellent: 'Өте жақсы',
    transcriptStatsGood: 'Жақсы',
    transcriptStatsSatisfactory: 'Қанағаттанарлық',
    transcriptStatsUnsatisfactory: 'Қанағаттанарлықсыз',

    historyLinkLabel: 'Академиялық тарих',
    historyLinkHint: 'Сынақ кітапшасы мен анықтама',
};

const EN: HistoryUi = {
    screenTitle: 'Academic history',
    screenSubtitle: 'Record book and academic transcript from KSTU',
    back: 'Back',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',

    loading: 'Loading academic history…',
    loadError: 'Failed to load academic history',
    retry: 'Retry',
    emptyTitle: 'No academic history yet',
    needsRelogin: 'Sign in again to refresh history',

    recbookSection: 'Record book',
    transcriptSection: 'Academic transcript',

    fullName: 'Full name',
    faculty: 'Faculty',
    educationStep: 'Education step',
    educationLevel: 'Education level',
    formOfEducation: 'Form of study',
    department: 'Department',
    course: 'Year',
    studyDuration: 'Duration',
    caseFile: 'Case file number',

    recbookEmpty: 'Record book is not available yet',
    recbookSpecialtyCode: 'Specialty code',
    recbookSpecialty: 'Specialty',
    recbookSpecialization: 'Specialization',
    recbookRecords: 'Records',
    recbookRk: 'RK',
    recbookMt: 'MT',
    recbookPa: 'PA',
    recbookFinal: 'Final',
    recbookExamDate: 'Exam date',
    recbookTeacher: 'Teacher',
    recbookExaminer: 'Examiner',
    recbookCredits: 'Credits',
    recbookNoTerm: 'Term not specified',
    recbookTermPrefix: 'Term',

    transcriptEmpty: 'Transcript is not available yet',
    transcriptStudyProgram: 'Educational program',
    transcriptProgramGroup: 'Program group',
    transcriptTotalSubjects: 'Total subjects',
    transcriptYearSummaries: 'GPA by year',
    transcriptYearLabel: 'Period',
    transcriptYearCredits: 'Credits',
    transcriptYearGpa: 'GPA',
    transcriptSubjects: 'Subjects',
    transcriptSubjectsSearchPlaceholder: 'Search subjects…',
    transcriptSubjectsNoMatches: 'No matches',
    transcriptCode: 'Code',
    transcriptCredits: 'Credits',
    transcriptGrade: 'Grade',
    transcriptGpa: 'GPA',
    transcriptPractices: 'Practices',
    transcriptPracticesEmpty: 'No practices recorded',
    transcriptPracticeType: 'Type',
    transcriptPracticePeriod: 'Period',
    transcriptOrders: 'Orders',
    transcriptOrdersEmpty: 'No orders recorded',
    transcriptOrderCourse: 'Year',
    transcriptStatsTitle: 'Grade summary',
    transcriptStatsExcellent: 'Excellent',
    transcriptStatsGood: 'Good',
    transcriptStatsSatisfactory: 'Satisfactory',
    transcriptStatsUnsatisfactory: 'Unsatisfactory',

    historyLinkLabel: 'Academic history',
    historyLinkHint: 'Record book and transcript',
};

export function getHistoryUi(language: HistoryLang): HistoryUi {
    if (language === 'en') return EN;
    if (language === 'kz') return KZ;
    return RU;
}

/**
 * Maps a letter grade to a semantic status tone, so the UI can colour grade
 * chips using existing CSS vars (`--status-*-bg/color/border`) instead of
 * inlining hex values that would break themes.
 *
 * A/A- → success, B family → info, C/D family → warning, F/FX → danger.
 */
export type LetterGradeTone = 'success' | 'info' | 'warning' | 'danger' | 'muted';

export function letterGradeTone(letter: string | null | undefined): LetterGradeTone {
    if (!letter) return 'muted';
    const upper = letter.trim().toUpperCase();
    if (upper.startsWith('A')) return 'success';
    if (upper.startsWith('B')) return 'info';
    if (upper.startsWith('C') || upper.startsWith('D')) return 'warning';
    if (upper.startsWith('F')) return 'danger';
    return 'muted';
}
