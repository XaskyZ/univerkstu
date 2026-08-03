'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { PageMain, PageShell } from '@/components/PageShell';
import { PasswordChangeForm } from './components/PasswordChangeForm';

export default function SettingsPasswordPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const text = messages.settings.password;
    const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    useEffect(() => {
        return () => {
            if (redirectTimerRef.current) {
                clearTimeout(redirectTimerRef.current);
            }
        };
    }, []);

    if (loading || !isAuth) {
        return null;
    }

    const handleSuccess = () => {
        // iOS-style: after a successful change, briefly show the inline success
        // banner and then navigate back to /settings. Short delay so the user
        // sees confirmation without feeling teleported.
        if (redirectTimerRef.current) {
            clearTimeout(redirectTimerRef.current);
        }
        redirectTimerRef.current = setTimeout(() => {
            router.push('/settings');
        }, 1200);
    };

    return (
        <PageShell>
            <header className="app-header">
                <div className="app-header-top">
                    <button
                        type="button"
                        onClick={() => router.push('/settings')}
                        aria-label={text.back}
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
                        <span>{text.back}</span>
                    </button>
                </div>
                <div className="mt-4">
                    <h1 className="app-header-title">{text.screenTitle}</h1>
                    <p className="app-header-subtitle">{text.screenSubtitle}</p>
                </div>
            </header>

            <PageMain className="space-y-4" spacing="lg">
                <section className="card p-5 sm:p-6">
                    <PasswordChangeForm onSuccess={handleSuccess} />
                </section>
            </PageMain>
        </PageShell>
    );
}
