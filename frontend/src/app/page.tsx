'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import LoginForm from '@/components/LoginForm';
import { LoginSkeleton } from '@/components/ThemeSkeleton';

export default function Home() {
  const { isAuth, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && isAuth) {
      router.push('/schedule');
    }
  }, [isAuth, loading, router]);

  if (loading) {
    return <LoginSkeleton />;
  }

  if (isAuth) {
    return null; // редирект в useEffect
  }

  // SEO landing chips were here previously — they polluted the login screen for
  // real users. They live as standalone routes and are reachable from /about.
  return <LoginForm />;
}
