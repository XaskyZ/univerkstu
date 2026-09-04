'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import RegisterForm from '@/components/RegisterForm';
import { LoginSkeleton } from '@/components/ThemeSkeleton';
import { useAuth } from '@/lib/auth-context';
import { DEFAULT_POST_LOGIN_PATH } from '@/lib/login-challenge';

export default function RegisterPage() {
    const { isAuth, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!loading && isAuth) {
            router.push(DEFAULT_POST_LOGIN_PATH);
        }
    }, [isAuth, loading, router]);

    if (loading) {
        return <LoginSkeleton />;
    }

    if (isAuth) {
        return null;
    }

    return <RegisterForm />;
}
