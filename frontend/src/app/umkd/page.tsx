'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { UMKD } from '@/lib/types';
import { toUserErrorMessage } from '@/lib/error-utils';
import { useLanguage } from '@/lib/language-context';
import { API_BASE_URL } from '@/lib/api-base';
import { UMKDHeader } from './components/UMKDHeader';
import { UMKDProgressBar } from './components/UMKDProgressBar';
import { UMKDLoadingState, UMKDErrorState, UMKDEmptyState } from './components/UMKDStates';
import { UMKDTileGrid } from './components/UMKDTileGrid';
import { UMKDFilteredEmpty, UMKDToolbar } from './components/UMKDToolbar';
import { ExamModeToggle, UmkdViewMode } from './components/ExamModeToggle';
import { ExamQuestionsSubjectCard } from './components/ExamQuestionsSubjectCard';
import {
    applyFilter,
    DEFAULT_FILTER_STATE,
    isFilterActive,
    parseFilterState,
    serializeFilterState,
    UmkdFilterState,
} from './utils/umkd-filters';
import { BookOpen } from 'lucide-react';

const UMKD_CACHE_KEY = 'umkd_cache_v2';
const UMKD_CACHE_TIME_KEY = 'umkd_cache_time_v2';
const IS_DEV = process.env.NODE_ENV !== 'production';

function hasInternalDownloadLinks(data: UMKD): boolean {
    return data.courses.every((course) =>
        course.files.every((file) => Boolean(file.downloadUrl || file.localUrl))
    );
}

type UmkdStreamMessage =
    | { type: 'progress'; status: string; percent: number }
    | { type: 'complete'; data: UMKD }
    | { type: 'error'; error: string; errorCode?: string };

async function readUmkdSseStream(
    response: Response,
    onMessage: (data: UmkdStreamMessage) => void
): Promise<void> {
    if (!response.body) {
        throw new Error('No body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            // Flush decoder tail and process possible last event.
            buffer += decoder.decode();
            if (buffer.trim()) {
                const events = buffer.split('\n\n');
                for (const event of events) {
                    const line = event.split('\n').find((l) => l.startsWith('data: '));
                    if (!line) continue;
                    try {
                        onMessage(JSON.parse(line.slice(6)) as UmkdStreamMessage);
                    } catch (e) {
                        if (IS_DEV) {
                            console.error('[UMKD] Final SSE parse error', e);
                        }
                    }
                }
            }
            break;
        }

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        // Keep last partial event in buffer
        buffer = events.pop() || '';

        for (const event of events) {
            const line = event.split('\n').find((l) => l.startsWith('data: '));
            if (!line) continue;
            try {
                onMessage(JSON.parse(line.slice(6)) as UmkdStreamMessage);
            } catch (e) {
                if (IS_DEV) {
                    console.error('[UMKD] SSE parse error', e);
                }
            }
        }
    }
}

export default function UMKDPage() {
    return (
        <Suspense fallback={<UMKDLoadingState />}>
            <UMKDPageInner />
        </Suspense>
    );
}

function UMKDPageInner() {
    const { isAuth, loading, logout } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [umkd, setUmkd] = useState<UMKD | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [progress, setProgress] = useState<{ status: string; percent: number } | null>(null);
    const [viewMode, setViewMode] = useState<UmkdViewMode>('all');

    // Filter state lives in the URL so it survives navigation and is shareable.
    const filterState: UmkdFilterState = useMemo(
        () => parseFilterState(new URLSearchParams(searchParams?.toString() ?? '')),
        [searchParams]
    );

    const updateFilterState = useCallback(
        (next: UmkdFilterState) => {
            const base = new URLSearchParams(searchParams?.toString() ?? '');
            const out = serializeFilterState(base, next);
            const qs = out.toString();
            router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
        },
        [pathname, router, searchParams]
    );

    const resetFilters = useCallback(() => {
        updateFilterState(DEFAULT_FILTER_STATE);
    }, [updateFilterState]);

    const filterResult = useMemo(() => {
        if (!umkd) return null;
        return applyFilter(umkd.courses, filterState);
    }, [umkd, filterState]);

    const filterActive = isFilterActive(filterState);

    // Проверка авторизации
    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    const fetchUMKD = useCallback(async () => {
        setFetching(true);
        setError(null);
        setProgress({ status: messages.umkd.streamLoading, percent: 0 });
        const hasCachedData = Boolean(localStorage.getItem(UMKD_CACHE_KEY));

        try {
            const token = localStorage.getItem('token');
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

            const response = await fetch(`${API_BASE_URL}/api/v3/umkd/stream`, {
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                signal: controller.signal,
                credentials: 'include',
            });

            clearTimeout(timeout);

            // Подхватываем автоматически обновлённый токен
            const renewedToken = response.headers.get('X-Renewed-Token');
            if (renewedToken) {
                if (IS_DEV) {
                    console.log('[UMKD] Token auto-renewed by server');
                }
                localStorage.setItem('token', renewedToken);
            }

            if (!response.ok) {
                let payload: { error?: string; errorCode?: string } | null = null;
                try {
                    payload = await response.json();
                } catch {
                    payload = null;
                }
                if (payload?.errorCode === 'AUTH_RELOGIN_REQUIRED' || response.status === 401) {
                    await logout('expired');
                    router.push('/');
                    return;
                }
                // Источник УМКД (univer.kstu.kz) отключён навсегда — показываем
                // текст бэкенда как есть, а не «временно недоступен».
                if (payload?.errorCode === 'UMKD_SOURCE_UNAVAILABLE' && payload.error) {
                    setError(payload.error);
                    return;
                }
                setError(toUserErrorMessage({
                    error: payload?.error || `HTTP ${response.status}`,
                    statusCode: response.status,
                    errorCode: payload?.errorCode,
                    fallback: messages.umkd.fallbackLoadError,
                    language,
                }));
                return;
            }
            await readUmkdSseStream(response, (data) => {
                if (data.type === 'progress') {
                    setProgress({ status: data.status, percent: data.percent });
                } else if (data.type === 'complete') {
                    setUmkd(data.data);
                    // Сохраняем в кэш
                    localStorage.setItem(UMKD_CACHE_KEY, JSON.stringify(data.data));
                    localStorage.setItem(UMKD_CACHE_TIME_KEY, Date.now().toString());
                } else if (data.type === 'error') {
                    if (data.errorCode === 'AUTH_RELOGIN_REQUIRED') {
                        void logout('expired').then(() => router.push('/'));
                        return;
                    }
                    setError(data.error);
                }
            });
        } catch (err: unknown) {
            if (IS_DEV) {
                console.error(err);
            }
            // Показываем ошибку только если нет кэша
            if (!hasCachedData) {
                const isAbort = err instanceof Error && err.name === 'AbortError';
                setError(toUserErrorMessage({
                    error: isAbort ? messages.umkd.timeoutExceeded : messages.umkd.networkError,
                    statusCode: isAbort ? 0 : undefined,
                    fallback: messages.umkd.fallbackLoadError,
                    language,
                }));
            }
        } finally {
            setFetching(false);
            setProgress(null);
        }
    }, [language, logout, messages.umkd.fallbackLoadError, messages.umkd.networkError, messages.umkd.streamLoading, messages.umkd.timeoutExceeded, router]);

    // Загрузка УМКД (сначала из кэша, потом с сервера)
    useEffect(() => {
        if (isAuth) {
            // Миграция: удаляем legacy-кеш старого формата
            localStorage.removeItem('umkd_cache');
            localStorage.removeItem('umkd_cache_time');

            const cached = localStorage.getItem(UMKD_CACHE_KEY);
            if (cached) {
                try {
                    const data = JSON.parse(cached) as UMKD;
                    if (hasInternalDownloadLinks(data)) {
                        setUmkd(data);
                    } else {
                        localStorage.removeItem(UMKD_CACHE_KEY);
                        localStorage.removeItem(UMKD_CACHE_TIME_KEY);
                    }
                } catch (e) {
                    if (IS_DEV) {
                        console.error('Cache parse error', e);
                    }
                    localStorage.removeItem(UMKD_CACHE_KEY);
                    localStorage.removeItem(UMKD_CACHE_TIME_KEY);
                }
            }
            void fetchUMKD();
        }
    }, [isAuth, fetchUMKD]);

    const handleRefresh = async () => {
        setRefreshing(true);
        setError(null);
        setProgress({ status: messages.umkd.streamConnecting, percent: 0 });

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE_URL}/api/v3/umkd/stream?refresh=true`, {
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                },
                credentials: 'include',
            });

            if (!response.ok) {
                // Подхватываем автоматически обновлённый токен
                const renewedToken = response.headers.get('X-Renewed-Token');
                if (renewedToken) {
                    if (IS_DEV) {
                        console.log('[UMKD refresh] Token auto-renewed by server');
                    }
                    localStorage.setItem('token', renewedToken);
                }

                let payload: { error?: string; errorCode?: string } | null = null;
                try {
                    payload = await response.json();
                } catch {
                    payload = null;
                }
                if (payload?.errorCode === 'AUTH_RELOGIN_REQUIRED' || response.status === 401) {
                    await logout('expired');
                    router.push('/');
                    return;
                }
                if (payload?.errorCode === 'UMKD_SOURCE_UNAVAILABLE' && payload.error) {
                    setError(payload.error);
                    return;
                }
                setError(toUserErrorMessage({
                    error: payload?.error || `HTTP ${response.status}`,
                    statusCode: response.status,
                    errorCode: payload?.errorCode,
                    fallback: messages.umkd.fallbackRefreshError,
                    language,
                }));
                return;
            }

            // Подхватываем обновлённый токен и из успешного ответа
            const renewedToken = response.headers.get('X-Renewed-Token');
            if (renewedToken) {
                if (IS_DEV) {
                    console.log('[UMKD refresh] Token auto-renewed by server');
                }
                localStorage.setItem('token', renewedToken);
            }

            await readUmkdSseStream(response, (data) => {
                if (data.type === 'progress') {
                    setProgress({ status: data.status, percent: data.percent });
                } else if (data.type === 'complete') {
                    setUmkd(data.data);
                    localStorage.setItem(UMKD_CACHE_KEY, JSON.stringify(data.data));
                    localStorage.setItem(UMKD_CACHE_TIME_KEY, Date.now().toString());
                } else if (data.type === 'error') {
                    if (data.errorCode === 'AUTH_RELOGIN_REQUIRED') {
                        void logout('expired').then(() => router.push('/'));
                        return;
                    }
                    setError(data.error);
                }
            });
        } catch (err) {
            if (IS_DEV) {
                console.error(err);
            }
            setError(toUserErrorMessage({
                error: messages.umkd.networkError,
                statusCode: 0,
                fallback: messages.umkd.fallbackRefreshError,
                language,
            }));
        } finally {
            setRefreshing(false);
            setProgress(null);
        }
    };

    // Loading states
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
                    style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
            </div>
        );
    }

    if (!isAuth) {
        return null;
    }

    const examSubjects = umkd?.examQuestionsBySubject ?? [];
    const examDisabled = examSubjects.length === 0;
    // Exam-questions tab temporarily hidden — feature not ready yet.
    // Re-enable by changing to `Boolean(umkd) && !error`.
    const showToggle = false;

    return (
        <div className="animate-fadeIn">
            <UMKDHeader
                refreshing={refreshing}
                fetching={fetching}
                onRefresh={handleRefresh}
            />

            {((fetching || refreshing) && progress) && (
                <UMKDProgressBar progress={progress} />
            )}

            {showToggle ? (
                <div className="px-4 pt-2">
                    <ExamModeToggle
                        mode={viewMode}
                        onChange={(next) => {
                            // If the exam pill is disabled, the toggle won't fire 'exam',
                            // but keep this defensive in case the prop wiring changes.
                            if (next === 'exam' && examDisabled) return;
                            setViewMode(next);
                        }}
                        examSubjectCount={examSubjects.length}
                        examDisabled={examDisabled}
                    />
                </div>
            ) : null}

            <main className="px-4 py-4">
                {fetching && !umkd ? (
                    <UMKDLoadingState />
                ) : error ? (
                    <UMKDErrorState error={error} onRetry={fetchUMKD} />
                ) : umkd && viewMode === 'exam' ? (
                    examSubjects.length > 0 ? (
                        <div className="flex flex-col gap-3">
                            {examSubjects.map((subject) => (
                                <ExamQuestionsSubjectCard
                                    key={subject.subjectId || subject.subjectName}
                                    subject={subject}
                                />
                            ))}
                        </div>
                    ) : (
                        <ExamQuestionsEmpty
                            title={messages.umkd.examQuestions.emptyTitle}
                            desc={messages.umkd.examQuestions.emptyDesc}
                            refreshLabel={messages.umkd.examQuestions.emptyRefreshBtn}
                            onRefresh={handleRefresh}
                            refreshing={refreshing}
                        />
                    )
                ) : umkd && umkd.courses.length > 0 ? (
                    <div className="flex flex-col gap-4">
                        <UMKDToolbar
                            state={filterState}
                            onChange={updateFilterState}
                            visibleCount={filterResult?.courses.length}
                            totalCount={umkd.courses.length}
                        />
                        {filterResult && filterResult.courses.length > 0 ? (
                            <UMKDTileGrid courses={filterResult.courses} />
                        ) : filterActive ? (
                            <UMKDFilteredEmpty onReset={resetFilters} />
                        ) : (
                            <UMKDEmptyState />
                        )}
                    </div>
                ) : (
                    <UMKDEmptyState />
                )}
            </main>
        </div>
    );
}

interface ExamQuestionsEmptyProps {
    title: string;
    desc: string;
    refreshLabel: string;
    onRefresh: () => void;
    refreshing: boolean;
}

function ExamQuestionsEmpty({ title, desc, refreshLabel, onRefresh, refreshing }: ExamQuestionsEmptyProps) {
    return (
        <div className="empty-state">
            <BookOpen className="empty-state-icon" strokeWidth={2} aria-hidden />
            <h3 className="empty-state-title">{title}</h3>
            <p className="empty-state-description">{desc}</p>
            <button
                type="button"
                onClick={onRefresh}
                disabled={refreshing}
                className="btn btn-primary mt-4"
            >
                {refreshLabel}
            </button>
        </div>
    );
}
