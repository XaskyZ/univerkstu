'use client';

import { useLanguage } from '@/lib/language-context';

export default function Loading() {
    const { language } = useLanguage();
    const ui = {
        text: language === 'en' ? 'Loading...' : language === 'kz' ? 'Жүктелуде...' : 'Загрузка...',
    };
    return (
        <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
            <div className="flex flex-col items-center">
                <div
                    className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent mb-4"
                    style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
                />
                <p className="text-muted-fg">{ui.text}</p>
            </div>
        </div>
    );
}
