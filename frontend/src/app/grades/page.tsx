'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import GradesView from '@/components/GradesView';
import { GradesAuthLoadingState } from './components/GradesAuthLoadingState';

export default function GradesPage() {
    const { isAuth, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    if (loading) {
        return <GradesAuthLoadingState />;
    }

    if (!isAuth) {
        return null;
    }

    return <GradesView />;
}
