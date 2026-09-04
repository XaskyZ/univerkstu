'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { resolvePostLoginPath } from '@/lib/login-challenge';
import LoginForm from '@/components/LoginForm';
import Link from 'next/link';

export default function LoginPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const nextParam = searchParams.get('next');

    useEffect(() => {
        if (!loading && isAuth) {
            // `next` is only honored for same-origin relative paths (see sanitizeNextPath).
            router.push(resolvePostLoginPath(nextParam));
        }
    }, [isAuth, loading, nextParam, router]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
            </div>
        );
    }

    if (isAuth) {
        return null;
    }

    return (
        <>
            <LoginForm />
            <section className="px-4 pb-28">
                <div className="mx-auto max-w-2xl card p-4">
                    <h2 className="text-sm font-semibold mb-2 text-fg">
                        {messages.login.usefulPages}
                    </h2>
                    <div className="flex flex-wrap gap-2 text-sm">
                        <Link href="/univer-kstu" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.login.univerLink}
                        </Link>
                        <Link href="/raspisanie-kstu" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.publicPages.popularSchedule}
                        </Link>
                        <Link href="/vhod-univer-kstu" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.publicPages.popularLogin}
                        </Link>
                        <Link href="/kstu-raspisanie-par" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.publicPages.popularLessons}
                        </Link>
                        <Link href="/raspisanie-zanyatii-kstu" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.publicPages.popularClassSchedule}
                        </Link>
                        <Link href="/ocenki-univer-kstu" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.publicPages.popularGrades}
                        </Link>
                        <Link href="/ekzameny-kstu" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.publicPages.popularExams}
                        </Link>
                        <Link href="/univer" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.login.univerLink}
                        </Link>
                        <Link href="/about" className="px-3 py-1.5 rounded-lg hover:bg-white/5" style={{ border: '1px solid var(--border)' }}>
                            {messages.publicPages.aboutTitle}
                        </Link>
                    </div>
                </div>
            </section>
        </>
    );
}
