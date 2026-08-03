'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { UMKD, UMKDCourse } from '@/lib/types';
import { SubScreenHeader } from '@/components/SubScreenHeader';
import { UMKDFileList } from '../components/UMKDFileList';
import { categorizeUmkdCourse, UMKD_CATEGORY_LABEL } from '../lib/categorize';
import { UMKD_CATEGORY_ICONS } from '../icons';

const UMKD_CACHE_KEY = 'umkd_cache_v2';

/**
 * Detail page for a single UMKD course.
 *
 * Data source: the same `umkd_cache_v2` localStorage entry that the index
 * page writes after a successful SSE load. That keeps the detail route free
 * of its own network logic — if the user lands here without a cache (e.g.
 * direct URL paste), we show a graceful "not found" state and a button
 * back to /umkd which will trigger a fresh load.
 */
export default function UMKDCourseDetailPage() {
    const { isAuth, loading } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();
    const params = useParams<{ courseId: string }>();
    const courseId = useMemo(() => {
        const raw = params?.courseId;
        if (!raw) return '';
        return Array.isArray(raw) ? raw[0] : raw;
    }, [params]);

    // Read UMKD cache during state init so we never re-render to read it.
    // The route is `'use client'` and pure CSR-driven, so SSR returns the
    // same initial null state anyway — no hydration concern here.
    const [umkd] = useState<UMKD | null>(() => {
        if (typeof window === 'undefined') return null;
        const cached = window.localStorage.getItem(UMKD_CACHE_KEY);
        if (!cached) return null;
        try {
            return JSON.parse(cached) as UMKD;
        } catch {
            return null;
        }
    });

    // Auth guard — same pattern as /umkd index.
    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    const course: UMKDCourse | undefined = useMemo(() => {
        if (!umkd || !courseId) return undefined;
        const decoded = decodeURIComponent(courseId);
        return umkd.courses.find((c) => c.id === decoded || c.id === courseId);
    }, [umkd, courseId]);

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div
                    className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
                    style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
                />
            </div>
        );
    }

    if (!isAuth) {
        return null;
    }

    if (!course) {
        return (
            <div className="animate-fadeIn">
                <SubScreenHeader
                    title={messages.umkd.title}
                    subtitle={messages.umkd.subtitle}
                    backHref="/umkd"
                />
                <main className="px-4 py-4">
                    <div className="card p-6 flex flex-col items-center gap-3 text-center">
                        <p style={{ color: 'var(--text)' }}>{messages.umkd.emptyTitle}</p>
                        <p className="text-sm" style={{ color: 'var(--muted)' }}>
                            {messages.umkd.emptyDesc}
                        </p>
                        <button
                            type="button"
                            onClick={() => router.push('/umkd')}
                            className="btn btn-primary"
                        >
                            {messages.umkd.detailBack}
                        </button>
                    </div>
                </main>
            </div>
        );
    }

    const categoryKey = categorizeUmkdCourse(course.name);
    const Icon = UMKD_CATEGORY_ICONS[categoryKey];
    const categoryLabel = UMKD_CATEGORY_LABEL[categoryKey][language];

    return (
        <div className="animate-fadeIn">
            <SubScreenHeader title={course.name} subtitle={course.kind} backHref="/umkd" />
            <main className="px-4 py-4">
                <div className="card overflow-hidden">
                    <div className="p-4 flex items-center gap-3">
                        <div
                            className="flex items-center justify-center w-12 h-12 rounded-xl flex-shrink-0"
                            style={{
                                background: 'rgba(var(--primary-rgb), 0.12)',
                                color: 'var(--primary)',
                            }}
                            aria-hidden
                            title={categoryLabel}
                        >
                            <Icon className="w-10 h-10" />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>
                                {categoryLabel}
                            </p>
                            <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                                {course.files.length === 0
                                    ? messages.umkd.empty
                                    : `${course.files.length}`}
                            </p>
                        </div>
                    </div>
                    <UMKDFileList course={course} />
                </div>
            </main>
        </div>
    );
}
