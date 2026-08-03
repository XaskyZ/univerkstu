'use client';

import Link from 'next/link';
import { useLanguage } from '@/lib/language-context';

export default function NotFound() {
    const { language } = useLanguage();
    const ui = {
        ru: {
            title: 'Страница не найдена',
            description: 'К сожалению, запрашиваемая страница не существует или была перемещена.',
            schedule: 'К расписанию',
            home: 'На главную',
        },
        kz: {
            title: 'Бет табылмады',
            description: 'Өкінішке қарай, сұралған бет жоқ немесе басқа жерге көшірілген.',
            schedule: 'Кестеге',
            home: 'Басты бетке',
        },
        en: {
            title: 'Page not found',
            description: 'The page you requested does not exist or has been moved.',
            schedule: 'Go to schedule',
            home: 'Go home',
        },
    }[language];

    return (
        <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
            <div className="text-center">
                <div
                    className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-6"
                    style={{ background: 'var(--gradient-primary)' }}
                >
                    <span className="text-4xl font-bold text-white">404</span>
                </div>

                <h1 className="text-3xl font-bold mb-2 text-fg">{ui.title}</h1>
                <p className="mb-8 max-w-md text-muted-fg">
                    {ui.description}
                </p>

                <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <Link
                        href="/schedule"
                        className="btn btn-primary px-6 py-3"
                    >
                        {ui.schedule}
                    </Link>
                    <Link
                        href="/"
                        className="btn btn-secondary px-6 py-3"
                    >
                        {ui.home}
                    </Link>
                </div>
            </div>
        </div>
    );
}
