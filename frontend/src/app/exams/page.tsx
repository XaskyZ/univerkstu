'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getExams, refreshExams } from '@/lib/api';
import { Exams } from '@/lib/types';
import ExamsView from '@/components/ExamsView';
import { getFromCache, saveToCache, getCacheAge, CacheKeys } from '@/lib/cache';
import { toUserErrorMessage } from '@/lib/error-utils';
import { useLanguage } from '@/lib/language-context';
import { shouldSkipBootstrapRevalidate } from '@/lib/startup-bootstrap';
import { ExamsAuthLoadingState, ExamsErrorState, ExamsLoadingState } from './components/ExamsStates';

export default function ExamsPage() {
    const { isAuth, loading, logout } = useAuth();
    const { language, messages } = useLanguage();
    const router = useRouter();
    const [exams, setExams] = useState<Exams | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [isStale, setIsStale] = useState(false);
    const [cacheAge, setCacheAge] = useState<number | null>(null);
    const [hasHydratedCache, setHasHydratedCache] = useState(false);
    const [hadCachedExams, setHadCachedExams] = useState(false);
    const ui = messages.exams;

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    const fetchExams = useCallback(async (showLoader = true, hasCachedData = false) => {
        if (showLoader) setFetching(true);
        setError(null);

        const result = await getExams();

        if (result.success && result.data) {
            setExams(result.data);
            saveToCache(CacheKeys.EXAMS, result.data);
            setIsStale(false);
            setCacheAge(null);
        } else if (result.errorCode === 'AUTH_RELOGIN_REQUIRED' || result.statusCode === 401) {
            if (!hasCachedData) {
                await logout('expired');
                router.push('/');
                return;
            }
        } else if (!hasCachedData) {
            setError(toUserErrorMessage({
                error: result.error,
                statusCode: result.statusCode,
                errorCode: result.errorCode,
                fallback: ui.loadFailed,
                language,
            }));
        }

        setFetching(false);
    }, [language, logout, router, ui.loadFailed]);

    useEffect(() => {
        if (!isAuth) return;

        const timer = window.setTimeout(() => {
            const cachedExams = getFromCache<Exams>(CacheKeys.EXAMS);
            const hasCachedData = Boolean(cachedExams);

            if (cachedExams) {
                setExams(cachedExams);
                setIsStale(true);
                setCacheAge(getCacheAge(CacheKeys.EXAMS));
                setFetching(false);
            }

            setHadCachedExams(hasCachedData);
            setHasHydratedCache(true);
        }, 0);

        return () => window.clearTimeout(timer);
    }, [isAuth]);

    useEffect(() => {
        if (!isAuth || !hasHydratedCache) return;

        const deferImmediateFetch = hadCachedExams && shouldSkipBootstrapRevalidate('exams');
        const timer = window.setTimeout(() => {
            void fetchExams(!hadCachedExams && !deferImmediateFetch, hadCachedExams);
        }, deferImmediateFetch ? 15_000 : 0);

        return () => window.clearTimeout(timer);
    }, [isAuth, fetchExams, hasHydratedCache, hadCachedExams]);

    const handleRefresh = async () => {
        setRefreshing(true);
        setError(null);

        const result = await refreshExams();

        if (result.success && result.data) {
            setExams(result.data);
            saveToCache(CacheKeys.EXAMS, result.data);
            setIsStale(false);
            setCacheAge(null);
        } else if (result.errorCode === 'AUTH_RELOGIN_REQUIRED' || result.statusCode === 401) {
            if (!exams) {
                await logout('expired');
                router.push('/');
                return;
            }
        } else {
            setError(toUserErrorMessage({
                error: result.error,
                statusCode: result.statusCode,
                errorCode: result.errorCode,
                fallback: ui.refreshFailed,
                language,
            }));
        }

        setRefreshing(false);
    };

    if (loading) {
        return <ExamsAuthLoadingState />;
    }

    if (!isAuth) {
        return null;
    }

    return (
        <>
            {fetching && !exams ? (
                <ExamsLoadingState />
            ) : exams ? (
                <ExamsView
                    exams={exams}
                    onRefresh={handleRefresh}
                    refreshing={refreshing}
                    isStale={isStale}
                    cacheAge={cacheAge}
                />
            ) : error ? (
                <ExamsErrorState error={error} onRetry={() => fetchExams(true)} />
            ) : null}
        </>
    );
}
