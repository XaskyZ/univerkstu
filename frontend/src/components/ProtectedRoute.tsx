'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';

interface ProtectedRouteProps {
    children: React.ReactNode;
}

export default function ProtectedRoute({ children }: ProtectedRouteProps) {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/login');
        }
    }, [isAuth, loading, router]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg)' }}>
                <div className="flex flex-col items-center">
                    <div
                        className="animate-spin rounded-full h-12 w-12 border-4 border-t-transparent mb-4"
                        style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
                    />
                    <p className="text-muted-fg">{messages.grades.loadingShort}</p>
                </div>
            </div>
        );
    }

    if (!isAuth) {
        return null;
    }

    return <>{children}</>;
}
