'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface RouteErrorProps {
    error: Error & { digest?: string };
    reset: () => void;
    /** Lets the caller swap the title for context (e.g. "Admin error", "Chat error"). */
    titleKey?: 'generic' | 'admin' | 'chat' | 'grades' | 'schedule' | 'group' | 'exams' | 'umkd' | 'profile';
    /** Where the "home" button goes. Defaults to "/". */
    homeHref?: string;
}

const TITLES: Record<NonNullable<RouteErrorProps['titleKey']>, { ru: string; kz: string; en: string }> = {
    generic: { ru: 'Что-то пошло не так', kz: 'Бірдеңе дұрыс болмады', en: 'Something went wrong' },
    admin: { ru: 'Ошибка в админке', kz: 'Әкімшілік қатесі', en: 'Admin error' },
    chat: { ru: 'Ошибка чата', kz: 'Чат қатесі', en: 'Chat error' },
    grades: { ru: 'Ошибка оценок', kz: 'Бағалар қатесі', en: 'Grades error' },
    schedule: { ru: 'Ошибка расписания', kz: 'Кесте қатесі', en: 'Schedule error' },
    group: { ru: 'Ошибка пространства группы', kz: 'Топ кеңістігінің қатесі', en: 'Group workspace error' },
    exams: { ru: 'Ошибка экзаменов', kz: 'Емтихандар қатесі', en: 'Exams error' },
    umkd: { ru: 'Ошибка УМКД', kz: 'ОӘК қатесі', en: 'UMKD error' },
    profile: { ru: 'Ошибка профиля', kz: 'Профиль қатесі', en: 'Profile error' },
};

export function RouteError({ error, reset, titleKey = 'generic', homeHref = '/' }: RouteErrorProps) {
    const { language } = useLanguage();

    useEffect(() => {
        console.error(`[${titleKey}] Application error:`, error);
    }, [error, titleKey]);

    const title = TITLES[titleKey][language];
    const description = language === 'en'
        ? 'An error occurred while loading this section. Try again or return home.'
        : language === 'kz'
            ? 'Бұл бөлімді жүктеу кезінде қате пайда болды. Қайталап көріңіз немесе басты бетке оралыңыз.'
            : 'Произошла ошибка при загрузке этого раздела. Попробуйте ещё раз или вернитесь на главную.';
    const retry = language === 'en' ? 'Try again' : language === 'kz' ? 'Қайталап көру' : 'Попробовать снова';
    const home = language === 'en' ? 'Home' : language === 'kz' ? 'Басты бетке' : 'На главную';

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
            <div
                className="rounded-2xl p-8 max-w-md w-full text-center"
                style={{
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    boxShadow: 'var(--shadow)',
                }}
            >
                <div
                    className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6"
                    style={{ background: 'rgba(var(--danger-rgb), 0.12)' }}
                >
                    <AlertTriangle className="w-8 h-8" strokeWidth={2} style={{ color: 'var(--danger)' }} />
                </div>

                <h1 className="text-2xl font-bold mb-2 text-fg">{title}</h1>
                <p className="mb-6 text-muted-fg">{description}</p>

                {error.digest ? (
                    <p className="mb-4 font-mono text-xs text-muted-fg">id: {error.digest}</p>
                ) : null}

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                        onClick={reset}
                        className="btn btn-primary px-6 py-3"
                        type="button"
                    >
                        {retry}
                    </button>
                    <Link
                        href={homeHref}
                        className="btn btn-secondary px-6 py-3"
                    >
                        {home}
                    </Link>
                </div>
            </div>
        </div>
    );
}
