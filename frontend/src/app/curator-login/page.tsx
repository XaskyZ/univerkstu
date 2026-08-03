'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import CuratorLoginForm from '@/components/CuratorLoginForm';
import { LoginSkeleton } from '@/components/ThemeSkeleton';
import { useAuth } from '@/lib/auth-context';

export default function CuratorLoginPage() {
    const { isAuth, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && isAuth) {
            router.push('/group/curator');
        }
    }, [isAuth, loading, router]);

    if (loading) {
        return <LoginSkeleton />;
    }

    if (isAuth) {
        return null;
    }

    return <CuratorLoginForm />;
}
