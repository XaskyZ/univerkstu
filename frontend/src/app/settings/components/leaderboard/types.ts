import type { TeacherTier } from '@/lib/api';

export type LeaderboardPeriod = 'day' | 'week' | 'all';
export type LeaderboardViewMode = 'students' | 'subjects' | 'teachers' | 'referrals';

export interface LeaderboardUiCopy {
    title: string;
    subtitle: string;
    topLabel: string;
    refresh: string;
    showAll: string;
    collapse: string;
    loading: string;
    empty: string;
    error: string;
    updated: string;
    totalUsers: string;
    yourPlace: string;
    yourTime: string;
    whyNotAll: string;
    you: string;
    podiumDay: string;
    podiumWeek: string;
    podiumAll: string;
    teachersTitle: string;
    teachersSubtitle: string;
    teachersEmpty: string;
    teachersError: string;
    totalTeachers: string;
    totalVotes: string;
    yourTeacherVotes: string;
    studentsTab: string;
    subjectsTab: string;
    teachersTab: string;
    referralsTab: string;
    periodDay: string;
    periodWeek: string;
    periodAll: string;
    teacherSearchPlaceholder: string;
    teacherSearchHint: string;
    teacherSearchLoading: string;
    teacherSearchEmpty: string;
    addTeacher: string;
    addingTeacher: string;
    selectedTeacher: string;
    noTeacherSelected: string;
    chooseTier: string;
    chooseTags: string;
    tagsHint: string;
    saveTeacherRating: string;
    savingTeacherRating: string;
    teacherSaved: string;
    teacherFailed: string;
    teacherVotes: string;
    teacherYourVote: string;
    sourceProfile: string;
    noTopTags: string;
    topTeachersDay: string;
    topTeachersWeek: string;
    topTeachersAll: string;
    teacherRankHint: string;
    tagLimitReached: string;
    seedHint: string;
    myRatingCard: string;
    teacherUnverifiedLabel: string;
    teacherNameInvalidHint: string;
    teacherNotInScheduleTitle: string;
    teacherNotInScheduleBody: string;
    teacherNotInScheduleAddAnyway: string;
    teacherNotInScheduleCancel: string;
    teacherCanonicalSuggestionTitle: string;
    teacherCanonicalSuggestionUse: string;
    teacherCanonicalSuggestionKeep: string;
    referralsTitle: string;
    referralsSubtitle: string;
    referralsEmpty: string;
    referralsError: string;
    referralTotalUsers: string;
    yourReferralPlace: string;
    yourReferralPoints: string;
    rewardsTitle: string;
    rewardsHint: string;
    rewardRefs: string;
    rewardThemeSherbet: string;
    rewardThemeNebula: string;
    referralsCount: string;
    referralPoints: string;
    topReferrersDay: string;
    topReferrersWeek: string;
    topReferrersAll: string;
    timeOnSite: string;
    subjectsTitle: string;
    subjectsSubtitle: string;
    subjectSearchPlaceholder: string;
    subjectSearchClear: string;
    subjectNoSubjects: string;
    subjectNoSubjectsHint: string;
    subjectPickTitle: string;
    subjectPickHint: string;
    subjectErrorTitle: string;
    subjectRetry: string;
    subjectEmptyTitle: string;
    subjectEmptyHint: string;
    subjectYourRank: string;
    subjectNotRanked: string;
    subjectLearners: string;
    subjectYou: string;
    subjectMessage: string;
    subjectOptOutShow: string;
    subjectOptOutHint: string;
    subjectProfileTitle: string;
    subjectNicknameLabel: string;
    subjectContactsTitle: string;
    subjectContactsHint: string;
    subjectTelegramLabel: string;
    subjectInstagramLabel: string;
    subjectSaveProfile: string;
    subjectSavingProfile: string;
    subjectProfileSaved: string;
    subjectProfileFailed: string;
}

export interface LeaderboardSettingsMessages {
    settings: {
        leaderboard: {
            nicknameTitle: string;
            nicknameDesc: string;
            nicknameLabel: string;
            nicknamePlaceholder: string;
            nicknameHint: string;
            nicknameSave: string;
            nicknameSaving: string;
            nicknameSaved: string;
            nicknameFailed: string;
        };
    };
}

export const TIER_ORDER: TeacherTier[] = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

export const TEACHER_TAGS = [
    'лучший', 'безупречный', 'величайший', 'ангел', 'божественный', 'легенда', 'goat', 'база', 'уважаемый',
    'спаситель сессии', 'любимый', 'душевный', 'человечный', 'объясняет как людям', 'всё разжёвывает',
    'справедливый', 'объективный', 'адекватный', 'комфортный', 'харизматичный', 'вайбовый', 'мощный',
    'сильный', 'гений', 'профи', 'на опыте', 'огонь', 'имба', 'топчик', 'хочется ходить', 'средний',
    'нейтральный', 'терпимо', 'нормальный', 'как повезёт', 'спорный', 'странный', 'нестабильный',
    'рандомный', 'требовательный', 'строгий, но норм', 'сухой', 'тяжёлый вайб', 'плохой', 'худший',
    'отвратительный', 'мерзейший', 'ужасный', 'токсичный', 'неадекватный', 'неприятный', 'демон во плоти',
    'сущий демон', 'nightmare mode', 'never again', 'мрак', 'кринж', 'душнила', 'выносит мозг',
    'ломает психику', 'убивает мотивацию', 'унижает', 'придирается', 'валит', 'необъективный',
    'не объясняет', 'читает с листа', 'хаотичный', 'жесткач', 'минус вайб', 'антивдохновение',
    'хочется сбежать', 'рейдовый босс', 'final boss', 'walking W', 'walking L', 'green flag', 'red flag',
    'safe place', 'emotional damage', '💀',
];
