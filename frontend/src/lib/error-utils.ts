import type { AppLanguage } from './language-context';

interface ErrorInput {
    error?: string;
    statusCode?: number;
    errorCode?: string;
    fallback: string;
    language?: AppLanguage;
}

export function toUserErrorMessage(input: ErrorInput): string {
    const { error, statusCode, errorCode, fallback, language = 'ru' } = input;
    const message = error || fallback;
    const ui = {
        ru: {
            upstreamAuthTemporary: 'Сервер университета временно отклонил сессию. Попробуйте позже, данные в приложении сохранятся.',
            reloginRequired: 'Сессия входа устарела. Войдите заново, когда появится стабильный интернет.',
            rateLimited: 'Превышен лимит запросов. Попробуйте через несколько минут.',
            universityUnavailable: 'Сервис университета временно недоступен. Попробуйте позже.',
            poorConnection: 'Плохое соединение. Работаем в ограниченном режиме, попробуйте позже.',
            networkHint: 'ошибка сети',
        },
        kz: {
            upstreamAuthTemporary: 'Университет сервері сессияны уақытша қабылдамады. Кейінірек қайталап көріңіз, қолданбадағы деректер сақталады.',
            reloginRequired: 'Кіру сессиясының мерзімі өтті. Тұрақты интернет болғанда қайта кіріңіз.',
            rateLimited: 'Сұрау лимиті асты. Бірнеше минуттан кейін қайталап көріңіз.',
            universityUnavailable: 'Университет сервисі уақытша қолжетімсіз. Кейінірек қайталап көріңіз.',
            poorConnection: 'Байланыс нашар. Қолданба шектеулі режимде жұмыс істеп тұр, кейінірек қайталап көріңіз.',
            networkHint: 'желі қатесі',
        },
        en: {
            upstreamAuthTemporary: 'The university server temporarily rejected the session. Try again later, your app data will stay intact.',
            reloginRequired: 'Your login session has expired. Sign in again when you have a stable connection.',
            rateLimited: 'Request limit exceeded. Please try again in a few minutes.',
            universityUnavailable: 'The university service is temporarily unavailable. Please try again later.',
            poorConnection: 'Poor connection. The app is working in a limited mode, please try again later.',
            networkHint: 'network error',
        },
    }[language];

    if (errorCode === 'UPSTREAM_AUTH_TEMPORARY') {
        return ui.upstreamAuthTemporary;
    }

    if (errorCode === 'PLATONUS_AUTH_REQUIRED') {
        return language === 'en'
            ? 'Exam data becomes available after authorization in Platonus.'
            : language === 'kz'
                ? 'Емтихан деректері Platonus-қа авторизациядан кейін қолжетімді болады.'
                : 'Данные об экзаменах можно получить после авторизации в Platonus.';
    }

    if (statusCode === 401 || errorCode === 'AUTH_RELOGIN_REQUIRED') {
        return ui.reloginRequired;
    }

    if (statusCode === 429 || message.includes('Too many requests')) {
        return ui.rateLimited;
    }

    if (statusCode === 502 || statusCode === 503 || statusCode === 504 || message.toLowerCase().includes('unavailable')) {
        return ui.universityUnavailable;
    }

    if (
        statusCode === 0 ||
        message.includes('Network') ||
        message.includes('Failed to fetch') ||
        message.toLowerCase().includes(ui.networkHint)
    ) {
        return ui.poorConnection;
    }

    return message;
}
