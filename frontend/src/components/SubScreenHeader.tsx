'use client';

import { useRouter } from 'next/navigation';
import { useLanguage } from '@/lib/language-context';

interface SubScreenHeaderProps {
    title: string;
    subtitle?: string;
    backHref?: string;
    onBack?: () => void;
}

/**
 * Reusable header chrome for nested settings sub-screens.
 *
 * Extracted from the in-place patterns in /settings/activity and
 * /settings/password — same iOS-style "back chip + title + subtitle" layout,
 * one shared component so every sub-screen agent doesn't reinvent it.
 */
export function SubScreenHeader({ title, subtitle, backHref = '/settings', onBack }: SubScreenHeaderProps) {
    const router = useRouter();
    const { messages } = useLanguage();
    const backLabel = messages.common.back;

    const handleBack = () => {
        if (onBack) {
            onBack();
            return;
        }
        router.push(backHref);
    };

    return (
        <header className="app-header">
            <div className="app-header-top">
                <button
                    type="button"
                    onClick={handleBack}
                    aria-label={backLabel}
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
                    <span aria-hidden>←</span>
                    <span>{backLabel}</span>
                </button>
            </div>
            <div className="mt-4">
                <h1 className="app-header-title">{title}</h1>
                {subtitle ? <p className="app-header-subtitle">{subtitle}</p> : null}
            </div>
        </header>
    );
}
