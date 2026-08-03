'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getAcademicContext, getExams, getSchedule, refreshSchedule, type AcademicContext } from '@/lib/api';
import { Exams, Schedule } from '@/lib/types';
import ScheduleView from '@/components/ScheduleView';
import { getFromCache, saveToCache, getCacheAge, CacheKeys } from '@/lib/cache';
import { toUserErrorMessage } from '@/lib/error-utils';
import { useLanguage } from '@/lib/language-context';
import { isExamSessionContext } from '@/lib/session-mode';
import { shouldSkipBootstrapRevalidate } from '@/lib/startup-bootstrap';
import { ScheduleAuthLoadingState, ScheduleErrorState, ScheduleLoadingState } from './components/ScheduleStates';

// `getCacheAge` возвращает возраст в минутах. Если кеш академ. контекста старше
// этого порога — форсируем рефреш, чтобы переход «теория → сессия → каникулы»
// не зависел от случайной даты последнего открытия страницы.
const STALE_ACADEMIC_CONTEXT_MIN = 30;

export default function SchedulePage() {
    const { isAuth, loading, logout } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();
    const [schedule, setSchedule] = useState<Schedule | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [isStale, setIsStale] = useState(false); // Показывает что данные из кеша
    const [cacheAge, setCacheAge] = useState<number | null>(null);
    const [hasHydratedCache, setHasHydratedCache] = useState(false);
    const [hadCachedSchedule, setHadCachedSchedule] = useState(false);
    const [academicContext, setAcademicContext] = useState<AcademicContext | null>(null);
    const [sessionExams, setSessionExams] = useState<Exams | null>(null);
    const [hasRefreshedAcademicContext, setHasRefreshedAcademicContext] = useState(false);

    const sessionMode = useMemo(() => isExamSessionContext(academicContext), [academicContext]);

    // Проверка авторизации
    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    const fetchSchedule = useCallback(async (showLoader = true, hasCachedData = false) => {
        if (showLoader) setFetching(true);
        setError(null);

        const result = await getSchedule();

        if (result.success && result.data) {
            setSchedule(result.data);
            saveToCache(CacheKeys.SCHEDULE, result.data);
            setIsStale(false);
            setCacheAge(null);
        } else if (result.errorCode === 'AUTH_RELOGIN_REQUIRED' || result.statusCode === 401) {
            if (!hasCachedData) {
                await logout('expired');
                router.push('/');
                return;
            }
        } else if (!hasCachedData) {
            // Показываем ошибку только если нет кешированных данных
            // (hasCachedData передаётся явно, чтобы избежать stale closure на schedule)
            const errorMsg = toUserErrorMessage({
                error: result.error,
                statusCode: result.statusCode,
                errorCode: result.errorCode,
                fallback: messages.schedule.fallbackLoadError,
                language,
            });
            setError(errorMsg);
        }

        setFetching(false);
    }, [language, logout, messages.schedule.fallbackLoadError, router]);

    const fetchAcademic = useCallback(async (forceRefresh = false, hasExistingContext = false) => {
        const result = await getAcademicContext(forceRefresh);
        if (result.success && result.data) {
            setAcademicContext(result.data);
            saveToCache(CacheKeys.ACADEMIC_CONTEXT, result.data);
        } else if (result.errorCode === 'AUTH_RELOGIN_REQUIRED' || result.statusCode === 401) {
            if (!hasExistingContext) {
                await logout('expired');
                router.push('/');
            }
        }
        return result;
    }, [logout, router]);

    // Гидратация кеша на клиенте (избегаем hydration mismatch)
    useEffect(() => {
        if (!isAuth) return;

        const timer = window.setTimeout(() => {
            const cachedSchedule = getFromCache<Schedule>(CacheKeys.SCHEDULE);
            const hasCachedData = Boolean(cachedSchedule);

            if (cachedSchedule) {
                setSchedule(cachedSchedule);
                setIsStale(true);
                setCacheAge(getCacheAge(CacheKeys.SCHEDULE));
                setFetching(false);
            }

            const cachedAcademicContext = getFromCache<AcademicContext>(CacheKeys.ACADEMIC_CONTEXT);
            if (cachedAcademicContext) {
                setAcademicContext(cachedAcademicContext);
            }

            // Surface cached exams when academic context already says we're in
            // an exam session — keeps the session view warm before any network.
            if (isExamSessionContext(cachedAcademicContext)) {
                const cachedExams = getFromCache<Exams>(CacheKeys.EXAMS);
                if (cachedExams) setSessionExams(cachedExams);
            }

            setHadCachedSchedule(hasCachedData);
            setHasHydratedCache(true);
        }, 0);

        return () => window.clearTimeout(timer);
    }, [isAuth]);

    // Загрузка расписания с кешированием
    useEffect(() => {
        if (!isAuth || !hasHydratedCache) return;

        const deferImmediateFetch = hadCachedSchedule && shouldSkipBootstrapRevalidate('schedule');
        const timer = window.setTimeout(() => {
            void fetchSchedule(!hadCachedSchedule && !deferImmediateFetch, hadCachedSchedule);
        }, deferImmediateFetch ? 12_000 : 0);

        return () => window.clearTimeout(timer);
    }, [isAuth, fetchSchedule, hasHydratedCache, hadCachedSchedule]);

    useEffect(() => {
        if (!isAuth || !hasHydratedCache || hasRefreshedAcademicContext) return;

        const academicCacheAge = getCacheAge(CacheKeys.ACADEMIC_CONTEXT);
        const forceRefresh =
            academicCacheAge === null ||
            academicCacheAge >= STALE_ACADEMIC_CONTEXT_MIN ||
            !isExamSessionContext(academicContext);
        const delayMs = forceRefresh ? 0 : 8_000;
        const timer = window.setTimeout(() => {
            void fetchAcademic(forceRefresh, Boolean(academicContext)).finally(() => {
                setHasRefreshedAcademicContext(true);
            });
        }, delayMs);

        return () => window.clearTimeout(timer);
    }, [academicContext, fetchAcademic, hasHydratedCache, hasRefreshedAcademicContext, isAuth]);

    // Fetch exams in the background when session mode is active, so the
    // session panel surfaces upcoming exams alongside the regular schedule.
    // Both setState calls run inside setTimeout callbacks so they don't trip
    // the `react-hooks/set-state-in-effect` rule and they match the cache
    // hydration pattern used for the schedule itself above.
    useEffect(() => {
        if (!isAuth || !hasHydratedCache || !sessionMode) return;

        let revalidateTimer: number | null = null;

        const primeTimer = window.setTimeout(() => {
            const cachedExams = getFromCache<Exams>(CacheKeys.EXAMS);
            if (cachedExams) setSessionExams((prev) => prev ?? cachedExams);

            const deferImmediateFetch = Boolean(cachedExams) && shouldSkipBootstrapRevalidate('exams');
            revalidateTimer = window.setTimeout(async () => {
                const result = await getExams();
                if (result.success && result.data) {
                    setSessionExams(result.data);
                    saveToCache(CacheKeys.EXAMS, result.data);
                }
                // Silently swallow exam-fetch failures: the panel falls back
                // to "Расписание экзаменов пока недоступно" and the regular
                // schedule below stays usable.
            }, deferImmediateFetch ? 12_000 : 600);
        }, 0);

        return () => {
            window.clearTimeout(primeTimer);
            if (revalidateTimer !== null) window.clearTimeout(revalidateTimer);
        };
    }, [isAuth, hasHydratedCache, sessionMode]);

    const handleRefresh = async () => {
        setRefreshing(true);
        setError(null);

        const [scheduleRefresh, academicRefresh, examsRefresh] = await Promise.allSettled([
            refreshSchedule(),
            fetchAcademic(true, Boolean(academicContext)),
            getExams(true),
        ]);

        const result = scheduleRefresh.status === 'fulfilled'
            ? scheduleRefresh.value
            : {
                success: false,
                error: scheduleRefresh.reason instanceof Error ? scheduleRefresh.reason.message : 'refresh_failed',
            };

        if (examsRefresh.status === 'fulfilled' && examsRefresh.value.success && examsRefresh.value.data) {
            setSessionExams(examsRefresh.value.data);
            saveToCache(CacheKeys.EXAMS, examsRefresh.value.data);
        }

        if (academicRefresh.status === 'fulfilled' && academicRefresh.value.success) {
            setHasRefreshedAcademicContext(true);
        }

        if (result.success && result.data) {
            setSchedule(result.data);
            saveToCache(CacheKeys.SCHEDULE, result.data);
            setIsStale(false);
            setCacheAge(null);
        } else if (result.errorCode === 'AUTH_RELOGIN_REQUIRED' || result.statusCode === 401) {
            if (!schedule) {
                await logout('expired');
                router.push('/');
                return;
            }
        } else {
            const errorMsg = toUserErrorMessage({
                error: result.error,
                statusCode: result.statusCode,
                errorCode: result.errorCode,
                fallback: messages.schedule.fallbackRefreshError,
                language,
            });
            setError(errorMsg);
        }

        setRefreshing(false);
    };

    // Loading states
    if (loading) {
        return <ScheduleAuthLoadingState />;
    }

    if (!isAuth) {
        return null;
    }

    return (
        <>
            {fetching && !schedule ? (
                <ScheduleLoadingState withHint />
            ) : schedule ? (
                <ScheduleView
                    schedule={schedule}
                    academicContext={academicContext}
                    onRefresh={handleRefresh}
                    refreshing={refreshing}
                    isStale={isStale}
                    cacheAge={cacheAge}
                    sessionMode={sessionMode}
                    sessionExams={sessionExams}
                />
            ) : error ? (
                <ScheduleErrorState error={error} onRetry={() => fetchSchedule(true)} />
            ) : null}
        </>
    );
}
