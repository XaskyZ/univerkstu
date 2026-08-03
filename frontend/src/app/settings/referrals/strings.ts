export interface ReferralsUi {
    back: string;
    title: string;
    subtitle: string;
    copyLink: string;
    copyCode: string;
    share: string;
    copied: string;
    codeCopied: string;
    yourLink: string;
    yourCode: string;
    yourStats: string;
    referrals: string;
    points: string;
    rank: string;
    top: string;
    topHint: string;
    yourReferrals: string;
    noReferrals: string;
    rewardHistory: string;
    noRewards: string;
    invitedYou: string;
    claimedAt: string;
    manualClaimTitle: string;
    manualClaimHint: string;
    manualClaimExpired: string;
    manualInputPlaceholder: string;
    manualClaim: string;
    manualClaiming: string;
    pendingCode: string;
    inviteReward: string;
    welcomeReward: string;
    rewardInviteSuccess: string;
    rewardWelcome: string;
    rewardsTitle: string;
    rewardsHint: string;
    unlocked: string;
    locked: string;
    rewardBadge: string;
    rewardTheme: string;
    adminPreviewTitle: string;
    adminPreviewHint: string;
    adminPreviewEnable: string;
    adminPreviewDisable: string;
    adminPreviewState: string;
    adminPreviewManualHint: string;
    adminPreviewAction: string;
}

const RU: ReferralsUi = {
    back: 'Назад',
    title: 'Реферальная система',
    subtitle: 'Приглашай друзей по ссылке, получай награды и следи за топом рефералов.',
    copyLink: 'Скопировать ссылку',
    copyCode: 'Скопировать код',
    share: 'Поделиться',
    copied: 'Ссылка скопирована',
    codeCopied: 'Код скопирован',
    yourLink: 'Твоя реферальная ссылка',
    yourCode: 'Твой код',
    yourStats: 'Твои награды',
    referrals: 'Рефералов',
    points: 'Поинтов',
    rank: 'Место',
    top: 'Топ рефералов',
    topHint: 'Рейтинг строится по числу приглашённых и сумме наград.',
    yourReferrals: 'Твои приглашённые',
    noReferrals: 'Пока никто не пришёл по твоей ссылке.',
    rewardHistory: 'История наград',
    noRewards: 'Награды появятся после первой успешной привязки.',
    invitedYou: 'Тебя пригласил',
    claimedAt: 'Засчитано',
    manualClaimTitle: 'Не засчитало автоматически?',
    manualClaimHint: 'Если ты новый пользователь и ссылка не привязалась, введи код вручную.',
    manualClaimExpired: 'Окно для ручного ввода уже закончилось или реферал уже закреплён.',
    manualInputPlaceholder: 'Введи код',
    manualClaim: 'Применить код',
    manualClaiming: 'Применяю…',
    pendingCode: 'Сохранён код из ссылки',
    inviteReward: 'За каждого приглашённого',
    welcomeReward: 'Бонус новому пользователю',
    rewardInviteSuccess: 'Награда за приглашённого',
    rewardWelcome: 'Бонус за вход по рефералке',
    rewardsTitle: 'Настоящие награды',
    rewardsHint: 'Кроме поинтов ты открываешь badge в профиле и премиальные темы.',
    unlocked: 'Открыто',
    locked: 'Закрыто',
    rewardBadge: 'Badge в профиле',
    rewardTheme: 'Тема',
    adminPreviewTitle: 'Админский preview',
    adminPreviewHint: 'Показывает блок ручной привязки так, как его увидит новенький. Это только просмотр, без применения кода.',
    adminPreviewEnable: 'Смотреть как новенький',
    adminPreviewDisable: 'Вернуться к моему виду',
    adminPreviewState: 'Включён режим просмотра новичка',
    adminPreviewManualHint: 'Админский preview: поле ввода показано как у нового пользователя, но код реально не применяется.',
    adminPreviewAction: 'Только просмотр',
};

const KZ: ReferralsUi = {
    back: 'Артқа',
    title: 'Реферал жүйесі',
    subtitle: 'Достарды сілтеме арқылы шақырыңыз, сыйақы алыңыз және топ рефералдарды қадағалаңыз.',
    copyLink: 'Сілтемені көшіру',
    copyCode: 'Кодты көшіру',
    share: 'Бөлісу',
    copied: 'Сілтеме көшірілді',
    codeCopied: 'Код көшірілді',
    yourLink: 'Сіздің реферал сілтемеңіз',
    yourCode: 'Сіздің кодыңыз',
    yourStats: 'Сіздің сыйақыларыңыз',
    referrals: 'Рефералдар',
    points: 'Ұпайлар',
    rank: 'Орын',
    top: 'Топ рефералдар',
    topHint: 'Рейтинг шақырылғандар саны мен сыйақы ұпайлары бойынша құрылады.',
    yourReferrals: 'Сіздің шақырғандарыңыз',
    noReferrals: 'Әзірге сіздің сілтемеңізбен ешкім келмеді.',
    rewardHistory: 'Сыйақы тарихы',
    noRewards: 'Алғашқы сәтті байланыстан кейін сыйақылар пайда болады.',
    invitedYou: 'Сізді шақырған',
    claimedAt: 'Есептелген уақыты',
    manualClaimTitle: 'Автоматты түрде есептелмеді ме?',
    manualClaimHint: 'Егер сіз жаңа пайдаланушы болсаңыз және сілтеме байланбаса, кодты қолмен енгізіңіз.',
    manualClaimExpired: 'Қолмен енгізу терезесі аяқталды немесе реферал бекітіліп қойған.',
    manualInputPlaceholder: 'Кодты енгізіңіз',
    manualClaim: 'Кодты қолдану',
    manualClaiming: 'Қолданылуда…',
    pendingCode: 'Сілтемеден сақталған код',
    inviteReward: 'Әр шақырылған адам үшін',
    welcomeReward: 'Жаңа қолданушы бонусы',
    rewardInviteSuccess: 'Шақырылған адам үшін сыйақы',
    rewardWelcome: 'Реферал арқылы кіргені үшін бонус',
    rewardsTitle: 'Нақты сыйақылар',
    rewardsHint: 'Ұпайдан бөлек профиль badge-і мен premium тақырыптар ашылады.',
    unlocked: 'Ашық',
    locked: 'Жабық',
    rewardBadge: 'Профиль badge-і',
    rewardTheme: 'Тақырып',
    adminPreviewTitle: 'Әкімші preview',
    adminPreviewHint: 'Қолмен байлау блогын жаңа қолданушы қалай көретінін көрсетеді. Бұл тек көру режимі, код қолданылмайды.',
    adminPreviewEnable: 'Жаңадан келгендей қарау',
    adminPreviewDisable: 'Менің көрінісіме оралу',
    adminPreviewState: 'Жаңа қолданушы көру режимі қосулы',
    adminPreviewManualHint: 'Әкімші preview: енгізу өрісі жаңа қолданушыдағыдай көрсетіледі, бірақ код шын мәнінде қолданылмайды.',
    adminPreviewAction: 'Тек көру',
};

const EN: ReferralsUi = {
    back: 'Back',
    title: 'Referral system',
    subtitle: 'Invite people with a link, earn rewards, and track the top referrers.',
    copyLink: 'Copy link',
    copyCode: 'Copy code',
    share: 'Share',
    copied: 'Link copied',
    codeCopied: 'Code copied',
    yourLink: 'Your referral link',
    yourCode: 'Your code',
    yourStats: 'Your rewards',
    referrals: 'Referrals',
    points: 'Points',
    rank: 'Rank',
    top: 'Top referrers',
    topHint: 'The leaderboard uses invited users count and total reward points.',
    yourReferrals: 'Your invited users',
    noReferrals: 'Nobody has joined through your link yet.',
    rewardHistory: 'Reward history',
    noRewards: 'Rewards will appear after the first successful referral.',
    invitedYou: 'You were invited by',
    claimedAt: 'Counted at',
    manualClaimTitle: 'Did auto-detection fail?',
    manualClaimHint: 'If you are a new user and the link did not attach, enter the code manually.',
    manualClaimExpired: 'The manual claim window has ended or a referrer is already attached.',
    manualInputPlaceholder: 'Enter code',
    manualClaim: 'Apply code',
    manualClaiming: 'Applying…',
    pendingCode: 'Saved code from the invite link',
    inviteReward: 'Per invited user',
    welcomeReward: 'New user bonus',
    rewardInviteSuccess: 'Reward for an invited user',
    rewardWelcome: 'Bonus for joining with a referral',
    rewardsTitle: 'Actual rewards',
    rewardsHint: 'Besides points, you unlock a profile badge and premium themes.',
    unlocked: 'Unlocked',
    locked: 'Locked',
    rewardBadge: 'Profile badge',
    rewardTheme: 'Theme',
    adminPreviewTitle: 'Admin preview',
    adminPreviewHint: 'Shows the manual claim block the way a newcomer would see it. This is view-only and does not apply any code.',
    adminPreviewEnable: 'View as newcomer',
    adminPreviewDisable: 'Back to my view',
    adminPreviewState: 'Newcomer preview mode is enabled',
    adminPreviewManualHint: 'Admin preview: the input is shown like it is for a new user, but the code is not actually applied.',
    adminPreviewAction: 'View only',
};

export function getReferralsUi(language: 'ru' | 'kz' | 'en'): ReferralsUi {
    if (language === 'kz') return KZ;
    if (language === 'en') return EN;
    return RU;
}
