'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ActiveLeaderboardPanel } from '../components/ActiveLeaderboardPanel';

export default function SettingsActivityPage() {
    const { isAuth, loading } = useAuth();
    const router = useRouter();
    const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'ru';

    const ui = {
        ru: {
            back: 'Назад',
            title: 'Зал славы',
            subtitle: 'Активность, предметы, преподы и рефералы в одном общем топе UniverSchedule.',
        },
        kz: {
            back: 'Артқа',
            title: 'Даңқ залы',
            subtitle: 'Белсенділік, пәндер, оқытушылар және рефералдар бір ортақ топта.',
        },
        en: {
            back: 'Back',
            title: 'Hall of Fame',
            subtitle: 'Activity, subjects, teachers and referrals in one UniverSchedule top.',
        },
    }[lang === 'kz' ? 'kz' : lang === 'en' ? 'en' : 'ru'];

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    if (loading || !isAuth) {
        return null;
    }

    return (
        <div className="animate-fadeIn min-h-screen">
            <header className="app-header">
                <div className="app-header-top">
                    <button
                        type="button"
                        onClick={() => router.push('/settings')}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 14px',
                            borderRadius: '14px',
                            border: '1px solid var(--border)',
                            background: 'var(--card)',
                            color: 'var(--text)',
                            fontSize: '13px',
                            fontWeight: 700,
                            cursor: 'pointer',
                        }}
                    >
                        <span>←</span>
                        <span>{ui.back}</span>
                    </button>
                </div>
                <div className="mt-4">
                    <h1 className="app-header-title">{ui.title}</h1>
                    <p className="app-header-subtitle">{ui.subtitle}</p>
                </div>
            </header>

            <main className="px-4 py-4 space-y-4" style={{ paddingBottom: '110px' }}>
                <ActiveLeaderboardPanel />
            </main>
        </div>
    );
}
