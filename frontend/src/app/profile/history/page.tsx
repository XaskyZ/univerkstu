'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { PageMain, PageShell, PageStateCard } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';
import { CacheKeys, getFromCache, saveToCache } from '@/lib/cache';
import { toUserErrorMessage } from '@/lib/error-utils';
import { getProfileWithHistory } from '@/lib/api/profile';
import type { ProfileData } from '@/app/profile/components/types';
import { getHistoryUi, type HistoryLang } from './history-i18n';
import { RecbookSection } from './components/RecbookSection';
import { TranscriptSection } from './components/TranscriptSection';

/**
 * Student-facing academic history page.
 *
 * The `/api/v3/profile` endpoint already returns the `transcript` and
 * `recbook` payloads parsed from KSTU. Until this screen existed they were
 * only visible inside the admin user-detail modal. This page surfaces them
 * to the student themselves with a cleaner, vertical layout.
 *
 * Follows the project's existing pattern for nested screens:
 *   - auth guard → redirect
 *   - hydrate from local cache for an immediate render
 *   - re-fetch in the background, refresh button is explicit
 *   - `PageShell` + `SubScreenHeader` + `PageMain` shell
 *   - locale via the local `getHistoryUi()` factory (kept out of the global
 *     locale bundle to avoid merge conflicts with in-flight branches)
 */
export default function ProfileHistoryPage() {
    const { isAuth, loading, logout } = useAuth();
    const { language } = useLanguage();
    const router = useRouter();
    const ui = getHistoryUi(language as HistoryLang);

    const [data, setData] = useState<ProfileData | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fetching, setFetching] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        if (!loading && !isAuth) {
            router.push('/');
        }
    }, [isAuth, loading, router]);

    const fetchHistory = useCallback(
        async (refresh: boolean, hasCachedData: boolean) => {
            if (refresh) {
                setRefreshing(true);
            } else {
                setFetching(true);
            }
            setError(null);

            const result = await getProfileWithHistory(refresh);

            if (result.success && result.data) {
                setData(result.data);
                saveToCache(CacheKeys.PROFILE, result.data);
            } else if (result.errorCode === 'AUTH_RELOGIN_REQUIRED' || result.statusCode === 401) {
                if (!hasCachedData) {
                    await logout('expired');
                    router.push('/');
                    return;
                }
                setError(ui.needsRelogin);
            } else if (!hasCachedData) {
                setError(
                    toUserErrorMessage({
                        error: result.error,
                        statusCode: result.statusCode,
                        errorCode: result.errorCode,
                        fallback: ui.loadError,
                        language,
                    }),
                );
            }

            setFetching(false);
            setRefreshing(false);
        },
        [language, logout, router, ui.loadError, ui.needsRelogin],
    );

    // Cache hydration on the client (avoids hydration mismatch).
    useEffect(() => {
        if (!isAuth) return;
        const timer = window.setTimeout(() => {
            const cached = getFromCache<ProfileData>(CacheKeys.PROFILE);
            if (cached) {
                setData(cached);
                setFetching(false);
            }
            setHydrated(true);
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isAuth]);

    useEffect(() => {
        if (!isAuth || !hydrated) return;
        const hasCachedData = Boolean(data);
        void fetchHistory(!hasCachedData, hasCachedData);
        // We intentionally re-run only when auth/hydration flip; `data` is
        // checked once at fetch time to gate cache-vs-fresh behaviour.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuth, hydrated]);

    if (loading || !isAuth) return null;

    const hasAnyHistory = Boolean(data?.transcript) || Boolean(data?.recbook);
    const showLoadingState = fetching && !data;
    const showErrorState = !!error && !data;
    const showEmptyState = !showLoadingState && !showErrorState && !hasAnyHistory && !!data;

    return (
        <PageShell>
            <SubScreenHeader
                title={ui.screenTitle}
                subtitle={ui.screenSubtitle}
                backHref="/profile"
            />
            <PageMain className="space-y-4" spacing="lg">
                <div className="flex items-center justify-between gap-3">
                    <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                        {refreshing ? ui.refreshing : null}
                    </span>
                    <button
                        type="button"
                        onClick={() => void fetchHistory(true, Boolean(data))}
                        disabled={refreshing || fetching}
                        aria-label={ui.refresh}
                        className="btn btn-secondary"
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '8px 14px',
                            borderRadius: '12px',
                            fontSize: '13px',
                            fontWeight: 600,
                        }}
                    >
                        <RefreshCw
                            className="w-4 h-4"
                            strokeWidth={2}
                            aria-hidden
                            style={{
                                animation: refreshing ? 'spin 1s linear infinite' : undefined,
                            }}
                        />
                        <span>{refreshing ? ui.refreshing : ui.refresh}</span>
                    </button>
                </div>

                {error && data ? (
                    <section
                        className="card"
                        style={{
                            padding: '12px 14px',
                            background: 'var(--status-danger-bg)',
                            border: '1px solid var(--status-danger-border)',
                            color: 'var(--status-danger-color)',
                            fontSize: '13px',
                        }}
                    >
                        {error}
                    </section>
                ) : null}

                {showLoadingState ? (
                    <PageStateCard message={ui.loading} />
                ) : showErrorState ? (
                    <section className="card p-6 space-y-3">
                        <p style={{ fontSize: '14px', color: 'var(--danger)', fontWeight: 600 }}>
                            {error}
                        </p>
                        <button
                            type="button"
                            onClick={() => void fetchHistory(true, false)}
                            className="btn btn-secondary"
                            style={{
                                padding: '8px 14px',
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: 600,
                            }}
                        >
                            {ui.retry}
                        </button>
                    </section>
                ) : showEmptyState ? (
                    <PageStateCard message={ui.emptyTitle} />
                ) : data ? (
                    <>
                        <RecbookSection recbook={data.recbook} ui={ui} />
                        <TranscriptSection transcript={data.transcript} ui={ui} />
                    </>
                ) : null}

            </PageMain>
        </PageShell>
    );
}
