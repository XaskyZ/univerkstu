'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { PageMain, PageShell } from '@/components/PageShell';
import { GpaCalculator } from '../components/GpaCalculator';

export default function GradesCalculatorPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const copy = messages.gradeCalculator;

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    if (loading) {
        return (
            <div
                className="min-h-screen flex items-center justify-center"
                style={{ color: 'var(--muted)' }}
            >
                {messages.grades.loadingShort}
            </div>
        );
    }

    if (!isAuth) {
        return null;
    }

    return (
        <PageShell>
            <header className="app-header">
                <div className="app-header-top">
                    <Link
                        href="/grades"
                        className="btn btn-secondary"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 14px',
                            fontSize: '13px',
                        }}
                    >
                        <span>←</span>
                        <span>{copy.backToGrades}</span>
                    </Link>
                </div>
                <div className="mt-4">
                    <h1 className="app-header-title">{copy.title}</h1>
                    <p className="app-header-subtitle">{copy.description}</p>
                </div>
            </header>

            <PageMain spacing="md">
                <GpaCalculator />
            </PageMain>
        </PageShell>
    );
}
