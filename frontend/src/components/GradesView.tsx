'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Calculator } from 'lucide-react';
import { saveToCache, getFromCache, getCacheAge, CacheKeys } from '@/lib/cache';
import { useLanguage } from '@/lib/language-context';
import {
    getCachedAcademicContext,
    getPreferredPlatonusSemester,
} from '@/lib/platonus-semesters';
import {
    getPlatonusStatus,
    getPlatonusGrades,
    platonusLogin,
    disconnectPlatonus,
    type PlatonusGradesData,
    type PlatonusSemester,
    type PlatonusSubjectGrade,
} from '@/lib/api';
import { markGradesAsSeen } from '@/lib/platonus-grade-notifications';
import { GradesSubjectListItem } from '@/app/grades/components/GradesSubjectListItem';
import { GradesSubjectDetail } from '@/app/grades/components/GradesSubjectDetail';
import { type GradesFilterKey } from '@/app/grades/components/GradesSearchBar';
import { GradesControlDeck } from '@/app/grades/components/GradesControlDeck';
import {
    getCachedPlatonusStatus,
    getDefaultSemesters,
    getInitialSemesterSelection,
    getSubjectStatusKey,
    getSuggestedPlatonusLoginFromCache,
    gradesCacheKey,
    normalizePlatonusLogin,
} from '@/app/grades/utils/grades-helpers';

const DESKTOP_BREAKPOINT_PX = 1024;

const DESKTOP_MEDIA_QUERY = `(min-width: ${DESKTOP_BREAKPOINT_PX}px)`;

function subscribeToDesktopMedia(onChange: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined;
    const media = window.matchMedia(DESKTOP_MEDIA_QUERY);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
}

function getDesktopMediaSnapshot(): boolean {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(DESKTOP_MEDIA_QUERY).matches;
}

function getDesktopMediaServerSnapshot(): boolean {
    // На сервере у нас нет окна — всегда mobile-first.
    return false;
}

function useIsDesktop(): boolean {
    return useSyncExternalStore(
        subscribeToDesktopMedia,
        getDesktopMediaSnapshot,
        getDesktopMediaServerSnapshot,
    );
}

function matchesQuery(subject: PlatonusSubjectGrade, query: string): boolean {
    if (!query) return true;
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    if (subject.name.toLowerCase().includes(normalized)) return true;
    if (subject.code && subject.code.toLowerCase().includes(normalized)) return true;
    if (subject.tutors?.some((name) => name.toLowerCase().includes(normalized))) return true;
    return false;
}

function matchesFilter(subject: PlatonusSubjectGrade, filter: GradesFilterKey): boolean {
    if (filter === 'all') return true;
    const status = getSubjectStatusKey(subject);
    if (filter === 'final') return status === 'final';
    if (filter === 'awaiting') return status === 'awaiting-exam' || status === 'awaiting-final';
    if (filter === 'risk') return status === 'blocked';
    return true;
}

export default function GradesView() {
    const { messages, language } = useLanguage();
    const defaultSemesters = useMemo(() => getDefaultSemesters(messages), [messages]);
    const initialData = useMemo(() => {
        const initialSemester = getInitialSemesterSelection(defaultSemesters);
        const cachedInitialStatus = getCachedPlatonusStatus();
        const cachedInitialGrades = getFromCache<PlatonusGradesData>(
            gradesCacheKey(initialSemester.year, initialSemester.semester)
        );
        const cachedInitialGpa = getFromCache<{ gpa: number; updatedAt: string }>(CacheKeys.PLATONUS_GPA);
        return {
            initialSemester,
            cachedInitialStatus,
            cachedInitialGrades,
            cachedInitialGpa,
        };
    }, [defaultSemesters]);
    const { initialSemester, cachedInitialStatus, cachedInitialGrades, cachedInitialGpa } = initialData;
    const latestGradesRequestIdRef = useRef(0);
    const didRunInitialStatusCheckRef = useRef(false);
    // Ключи семестров, для которых уже выполнялась разовая принудительная
    // перепроверка после пустого свежего ответа (см. fetchGrades) —
    // защита от бесконечного цикла перепроверок.
    const emptyResponseRecheckRef = useRef<Set<string>>(new Set());
    // «Latest ref» на fetchGrades — чтобы внутри самого fetchGrades можно было
    // запланировать повторный вызов, не ссылаясь на себя в useCallback.
    const fetchGradesRef = useRef<((options?: {
        forceRefresh?: boolean;
        skipLoadingIfData?: boolean;
        hasData?: boolean;
        year?: number;
        semester?: number;
    }) => Promise<void>) | null>(null);
    const [connected, setConnected] = useState(Boolean(cachedInitialStatus?.connected));
    const [platonusUser, setPlatonusUser] = useState<string | null>(cachedInitialStatus?.login || null);
    const [semesters, setSemesters] = useState<PlatonusSemester[]>(
        cachedInitialStatus?.availableSemesters?.length ? cachedInitialStatus.availableSemesters : defaultSemesters
    );
    const [checkingStatus, setCheckingStatus] = useState(() => !cachedInitialStatus && !cachedInitialGrades);

    const [showLogin, setShowLogin] = useState(() => Boolean(cachedInitialStatus && !cachedInitialStatus.connected));
    const [loginValue, setLoginValue] = useState(() => getSuggestedPlatonusLoginFromCache());
    const [passwordValue, setPasswordValue] = useState('');
    const [loginLoading, setLoginLoading] = useState(false);
    const [loginError, setLoginError] = useState<string | null>(null);
    const [showPassword, setShowPassword] = useState(false);

    const [selectedYear, setSelectedYear] = useState(initialSemester.year);
    const [selectedSemester, setSelectedSemester] = useState(initialSemester.semester);
    const [grades, setGrades] = useState<PlatonusGradesData | null>(cachedInitialGrades);
    const [gradesLoading, setGradesLoading] = useState(false);
    const [gradesError, setGradesError] = useState<string | null>(null);
    const [gradesIsStale, setGradesIsStale] = useState(() => Boolean(cachedInitialGrades));
    const [gradesCacheAge, setGradesCacheAge] = useState<number | null>(() =>
        getCacheAge(gradesCacheKey(initialSemester.year, initialSemester.semester))
    );
    const [summaryGpa, setSummaryGpa] = useState<number | null>(cachedInitialGpa?.gpa ?? null);
    const gradesRef = useRef<PlatonusGradesData | null>(cachedInitialGrades);
    const connectedRef = useRef(Boolean(cachedInitialStatus?.connected));
    const statusRequestInFlightRef = useRef(false);

    // List-first state: filter + search + selected subject (by index inside the
    // current `grades.subjects` array — most stable across renders).
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<GradesFilterKey>('all');
    const [selectedSubjectIndex, setSelectedSubjectIndex] = useState<number | null>(null);
    const isDesktop = useIsDesktop();

    const checkStatus = useCallback(async (foreground = false) => {
        if (statusRequestInFlightRef.current) {
            return;
        }
        statusRequestInFlightRef.current = true;
        if (foreground) {
            setCheckingStatus(true);
        }
        try {
            const result = await getPlatonusStatus();

            if (result.success && result.data) {
                setConnected(result.data.connected);
                setPlatonusUser(result.data.login || null);
                saveToCache(CacheKeys.PLATONUS_STATUS, {
                    connected: result.data.connected,
                    login: result.data.login || null,
                    availableSemesters: result.data.availableSemesters || [],
                    updatedAt: new Date().toISOString(),
                });
                if (result.data.availableSemesters?.length) {
                    setSemesters(result.data.availableSemesters);
                    const latest = getPreferredPlatonusSemester(
                        result.data.availableSemesters,
                        getCachedAcademicContext()
                    );
                    if (!gradesRef.current && latest) {
                        setSelectedYear(latest.year);
                        setSelectedSemester(latest.semester);
                        const cached = getFromCache<PlatonusGradesData>(gradesCacheKey(latest.year, latest.semester));
                        if (cached) {
                            setGrades(cached);
                            setGradesIsStale(true);
                            setGradesCacheAge(getCacheAge(gradesCacheKey(latest.year, latest.semester)));
                        }
                    }
                }
                if (!result.data.connected) {
                    setShowLogin(true);
                } else {
                    setShowLogin(false);
                }
            } else {
                const authLost = result.errorCode === 'PLATONUS_NOT_CONNECTED'
                    || result.statusCode === 401
                    || result.statusCode === 403;

                if (authLost && !gradesRef.current) {
                    setConnected(false);
                    setPlatonusUser(null);
                    setShowLogin(true);
                } else if (!connectedRef.current && !gradesRef.current) {
                    setShowLogin(true);
                }
            }
        } finally {
            statusRequestInFlightRef.current = false;
            setCheckingStatus(false);
        }
    }, []);

    const fetchGrades = useCallback(async (options?: {
        forceRefresh?: boolean;
        skipLoadingIfData?: boolean;
        hasData?: boolean;
        year?: number;
        semester?: number;
    }) => {
        const forceRefresh = options?.forceRefresh ?? false;
        const skipLoadingIfData = options?.skipLoadingIfData ?? false;
        const hasData = options?.hasData ?? Boolean(gradesRef.current);
        const year = options?.year ?? selectedYear;
        const semester = options?.semester ?? selectedSemester;
        const requestId = ++latestGradesRequestIdRef.current;

        if (!(skipLoadingIfData && hasData)) {
            setGradesLoading(true);
        }
        setGradesError(null);

        const result = await getPlatonusGrades(year, semester, forceRefresh);

        if (requestId !== latestGradesRequestIdRef.current) {
            return;
        }

        if (result.success && result.data) {
            const hasSubjects = result.data.subjects.length > 0;
            if (!hasSubjects && !forceRefresh) {
                const localKey = gradesCacheKey(year, semester);
                const cached = getFromCache<PlatonusGradesData>(localKey);
                if (cached && cached.subjects.length > 0) {
                    // Свежий ответ пуст, а локальный кеш — нет. Это либо сбой на
                    // стороне Platonus (тогда кеш честнее), либо семестр
                    // действительно опустел. Показываем кеш как stale и один раз
                    // перепроверяем принудительно: forceRefresh идёт мимо этой
                    // ветки, поэтому повторный пустой ответ честно отобразится
                    // как «нет данных», а неудачная загрузка — как ошибка,
                    // вместо вечного показа старого кеша под видом актуального.
                    setGrades(cached);
                    setGradesIsStale(true);
                    setGradesCacheAge(getCacheAge(localKey));
                    setGradesLoading(false);
                    if (!emptyResponseRecheckRef.current.has(localKey)) {
                        emptyResponseRecheckRef.current.add(localKey);
                        void fetchGradesRef.current?.({
                            forceRefresh: true,
                            skipLoadingIfData: true,
                            hasData: true,
                            year,
                            semester,
                        });
                    }
                    return;
                }
            }

            setGrades(result.data);
            setGradesIsStale(Boolean(result.stale));
            // Бэкенд отдаёт cacheAge в СЕКУНДАХ; в состоянии храним минуты —
            // в тех же единицах, что и getCacheAge() из lib/cache, которым
            // это же состояние инициализируется и обновляется в других местах.
            setGradesCacheAge(typeof result.cacheAge === 'number' ? Math.floor(result.cacheAge / 60) : null);
            saveToCache(gradesCacheKey(year, semester), result.data);
            if (result.data.meta) {
                const gpa = result.data.meta.overallGpa || result.data.meta.gpa;
                if (gpa && gpa > 0) {
                    setSummaryGpa(gpa);
                    saveToCache(CacheKeys.PLATONUS_GPA, {
                        gpa,
                        updatedAt: new Date().toISOString(),
                    });
                }
                if (result.data.meta.groupName && result.data.meta.groupName.trim().length > 0) {
                    saveToCache(CacheKeys.PLATONUS_GROUP, {
                        groupName: result.data.meta.groupName.trim(),
                        updatedAt: new Date().toISOString(),
                    });
                }
            }
        } else {
            if (result.errorCode === 'PLATONUS_NOT_CONNECTED' || result.statusCode === 401 || result.statusCode === 403) {
                setConnected(false);
                setPlatonusUser(null);
                setGrades(null);
                setGradesIsStale(false);
                setGradesCacheAge(null);
                setShowLogin(true);
                setLoginError(result.error || messages.grades.authError);
                setGradesLoading(false);
                return;
            }
            setGradesError(result.error || messages.grades.loadError);
        }

        setGradesLoading(false);
    }, [messages.grades.authError, messages.grades.loadError, selectedSemester, selectedYear]);

    useEffect(() => {
        fetchGradesRef.current = fetchGrades;
    }, [fetchGrades]);

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();
        const normalizedLogin = normalizePlatonusLogin(loginValue);
        if (!normalizedLogin || !passwordValue) return;

        setLoginLoading(true);
        setLoginError(null);
        if (normalizedLogin !== loginValue) {
            setLoginValue(normalizedLogin);
        }

        const result = await platonusLogin(normalizedLogin, passwordValue);

        if (result.success) {
            setConnected(true);
            setPlatonusUser(normalizedLogin);
            setShowLogin(false);
            setGradesError(null);
            setLoginError(null);
            setLoginValue('');
            setPasswordValue('');
            void fetchGrades({
                forceRefresh: true,
                year: selectedYear,
                semester: selectedSemester,
            });
        } else {
            setLoginError(result.error || messages.grades.authError);
        }

        setLoginLoading(false);
    }

    async function handleDisconnect() {
        await disconnectPlatonus();
        setConnected(false);
        setPlatonusUser(null);
        setGrades(null);
        setGradesIsStale(false);
        setGradesCacheAge(null);
        setSummaryGpa(null);
        setShowLogin(true);
        setSelectedSubjectIndex(null);
    }

    function handleSemesterChange(value: string) {
        const [year, semester] = value.split('/').map(Number);
        const localKey = gradesCacheKey(year, semester);
        const cached = getFromCache<PlatonusGradesData>(localKey);

        setGrades(cached);
        setGradesIsStale(Boolean(cached));
        setGradesCacheAge(cached ? getCacheAge(localKey) : null);
        setGradesError(null);
        setSelectedYear(year);
        setSelectedSemester(semester);
        // Сброс выбранного предмета — индексы по новому семестру другие.
        setSelectedSubjectIndex(null);
    }

    useEffect(() => {
        gradesRef.current = grades;
    }, [grades]);

    useEffect(() => {
        connectedRef.current = connected;
    }, [connected]);

    useEffect(() => {
        if (didRunInitialStatusCheckRef.current) {
            return;
        }
        didRunInitialStatusCheckRef.current = true;
        const shouldCheckStatus =
            !cachedInitialStatus
            || cachedInitialStatus.availableSemesters.length === 0;
        const timer = window.setTimeout(() => {
            if (shouldCheckStatus) {
                void checkStatus(!cachedInitialGrades && !cachedInitialStatus);
            }
        }, 0);

        return () => window.clearTimeout(timer);
    }, [cachedInitialGrades, cachedInitialStatus, checkStatus]);

    useEffect(() => {
        if (!connected) return;

        const timer = window.setTimeout(() => {
            void fetchGrades({
                skipLoadingIfData: true,
                year: selectedYear,
                semester: selectedSemester,
            });
        }, 0);

        return () => window.clearTimeout(timer);
    }, [connected, fetchGrades, selectedSemester, selectedYear]);

    useEffect(() => {
        if (!connected || !grades) return;
        markGradesAsSeen(grades, selectedYear, selectedSemester, platonusUser);
    }, [connected, grades, platonusUser, selectedSemester, selectedYear]);

    // Когда меняется фильтр/поиск/семестр и выбранный предмет выпадает из видимого
    // списка — сбрасываем selection, чтобы пользователь не «смотрел в пустоту».
    const allSubjects = useMemo(() => grades?.subjects ?? [], [grades]);
    const filterCounts = useMemo<Record<GradesFilterKey, number>>(() => {
        const counts: Record<GradesFilterKey, number> = {
            all: allSubjects.length,
            final: 0,
            awaiting: 0,
            risk: 0,
        };
        for (const subject of allSubjects) {
            const status = getSubjectStatusKey(subject);
            if (status === 'final') counts.final += 1;
            if (status === 'awaiting-exam' || status === 'awaiting-final') counts.awaiting += 1;
            if (status === 'blocked') counts.risk += 1;
        }
        return counts;
    }, [allSubjects]);

    const visibleSubjects = useMemo(() => {
        return allSubjects
            .map((subject, originalIndex) => ({ subject, originalIndex }))
            .filter(({ subject }) => matchesFilter(subject, filter) && matchesQuery(subject, searchQuery));
    }, [allSubjects, filter, searchQuery]);

    useEffect(() => {
        if (selectedSubjectIndex === null) return;
        const stillVisible = visibleSubjects.some((entry) => entry.originalIndex === selectedSubjectIndex);
        if (!stillVisible) {
            setSelectedSubjectIndex(null);
        }
    }, [selectedSubjectIndex, visibleSubjects]);

    const selectedSubject = selectedSubjectIndex !== null ? allSubjects[selectedSubjectIndex] ?? null : null;

    const handlePlatonusDisconnected = useCallback(() => {
        setConnected(false);
        setShowLogin(true);
        setSelectedSubjectIndex(null);
    }, []);

    if (checkingStatus && !grades && !cachedInitialStatus) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="flex flex-col items-center gap-4 text-center px-6">
                    <div
                        className="w-14 h-14 rounded-full border-4 border-t-transparent animate-spin"
                        style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
                    />
                    <p className="text-fg">{messages.grades.checkingConnection}</p>
                </div>
            </div>
        );
    }

    const detailContent = selectedSubject ? (
        <GradesSubjectDetail
            subject={selectedSubject}
            year={selectedYear}
            semester={selectedSemester}
            detailsEnabled={connected}
            language={language}
            onClose={() => setSelectedSubjectIndex(null)}
            onPlatonusDisconnected={handlePlatonusDisconnected}
        />
    ) : null;

    const hasSubjects = Boolean(grades && grades.subjects.length > 0);
    const summaryGrades: PlatonusGradesData | null =
        grades ?? (summaryGpa !== null
            ? {
                meta: {
                    parsedAt: '',
                    year: selectedYear,
                    semester: selectedSemester,
                    totalSubjects: 0,
                    gpa: summaryGpa,
                },
                subjects: [],
            }
            : null);

    return (
        <div className="animate-fadeIn">
            <main className="grades-page-main" style={{ paddingBottom: '100px' }}>
                {connected ? (
                    <GradesControlDeck
                        semesters={semesters}
                        selectedYear={selectedYear}
                        selectedSemester={selectedSemester}
                        onSemesterChange={handleSemesterChange}
                        onRefresh={() => void fetchGrades({ forceRefresh: true })}
                        refreshing={gradesLoading}
                        platonusUser={platonusUser}
                        cacheAgeMin={gradesCacheAge}
                        isStale={gradesIsStale}
                        onDisconnect={handleDisconnect}
                        grades={summaryGrades}
                        searchQuery={searchQuery}
                        onSearchChange={setSearchQuery}
                        filter={filter}
                        onFilterChange={setFilter}
                        filterCounts={filterCounts}
                        showSearch={hasSubjects}
                    />
                ) : (
                    <header className="app-header">
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div>
                                <h1 className="app-header-title">{messages.grades.title}</h1>
                                <p className="app-header-subtitle">{messages.grades.subtitle}</p>
                            </div>
                        </div>
                    </header>
                )}

                <div className="grades-calculator-row">
                    <Link
                        href="/grades/calculator"
                        className="grades-calculator-link"
                    >
                        <Calculator size={16} strokeWidth={2.25} aria-hidden />
                        {messages.gradeCalculator.openButton}
                    </Link>
                </div>

                {checkingStatus && connected && !showLogin && !grades && (
                    <div className="grades-loading-block">
                        <div className="grades-spinner grades-spinner-sm" />
                        <p className="grades-loading-text">{messages.grades.checkingSession}</p>
                    </div>
                )}

                {showLogin && !connected && (
                    <section className="grades-login-card">
                        <div className="grades-login-header">
                            <div className="grades-login-icon">
                                <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c1.657 0 3-1.343 3-3S13.657 5 12 5 9 6.343 9 8s1.343 3 3 3z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 20a7 7 0 1114 0H5z" />
                                </svg>
                            </div>
                            <div>
                                <h3 className="grades-login-title">{messages.grades.loginTitle}</h3>
                                <p className="grades-login-subtitle">
                                    {messages.grades.loginSubtitle}
                                </p>
                            </div>
                        </div>

                        <div className="grades-login-note">
                            <p>{messages.grades.loginHint}</p>
                        </div>

                        <form onSubmit={handleLogin} className="grades-login-form">
                            <input
                                type="text"
                                className="grades-login-input"
                                placeholder={messages.grades.loginPlaceholder}
                                value={loginValue}
                                onChange={(e) => setLoginValue(e.target.value)}
                                onBlur={() => setLoginValue((current) => normalizePlatonusLogin(current))}
                                disabled={loginLoading}
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                            />

                            <div className="grades-login-password-row">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    className="grades-login-input"
                                    placeholder={messages.grades.passwordPlaceholder}
                                    value={passwordValue}
                                    onChange={(e) => setPasswordValue(e.target.value)}
                                    disabled={loginLoading}
                                />
                                <button
                                    type="button"
                                    className="grades-login-password-toggle"
                                    onClick={() => setShowPassword((prev) => !prev)}
                                    disabled={loginLoading}
                                >
                                    {showPassword ? messages.grades.hidePassword : messages.grades.showPassword}
                                </button>
                            </div>

                            {loginError && (
                                <p className="grades-login-error">
                                    {loginError}
                                </p>
                            )}

                            <button
                                type="submit"
                                disabled={loginLoading || !loginValue.trim() || !passwordValue}
                                className="btn btn-primary grades-login-submit"
                                style={{ opacity: loginLoading ? 0.8 : 1 }}
                            >
                                {loginLoading ? messages.grades.authorizing : messages.grades.connectAccount}
                            </button>
                        </form>
                    </section>
                )}

                {connected && gradesLoading && !grades && (
                    <div className="grades-loading-block">
                        <div className="grades-spinner grades-spinner-md" />
                        <p className="grades-loading-text">{messages.grades.loadingGrades}</p>
                    </div>
                )}

                {connected && gradesError && !grades && (
                    <div className="error-state" style={{ margin: '40px auto', maxWidth: '400px' }}>
                        <svg className="error-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <h3 className="error-state-title">{messages.grades.errorTitle}</h3>
                        <p className="error-state-description">{gradesError}</p>
                        <button type="button" onClick={() => void fetchGrades({ forceRefresh: true })} className="btn btn-primary">{messages.grades.retry}</button>
                    </div>
                )}

                {connected && grades && (
                    <>
                        {grades.subjects.length > 0 ? (
                            <div className={isDesktop && selectedSubject ? 'grades-split' : 'grades-split grades-split-single'}>
                                <div className="grades-list-pane">
                                    {visibleSubjects.length > 0 ? (
                                        <div className="grades-subject-list">
                                            {visibleSubjects.map(({ subject, originalIndex }) => (
                                                <GradesSubjectListItem
                                                    key={`${subject.name}-${originalIndex}`}
                                                    subject={subject}
                                                    isActive={isDesktop && originalIndex === selectedSubjectIndex}
                                                    onSelect={() => setSelectedSubjectIndex(originalIndex)}
                                                />
                                            ))}
                                        </div>
                                    ) : (
                                        <div className="grades-list-empty">
                                            <h3 className="grades-list-empty-title">{messages.grades.listEmptyTitle}</h3>
                                            <p className="grades-list-empty-desc">{messages.grades.listEmptyDesc}</p>
                                        </div>
                                    )}
                                </div>

                                {isDesktop ? (
                                    <aside className="grades-detail-pane">
                                        {detailContent ?? (
                                            <div className="grades-detail-placeholder">
                                                <h3 className="grades-detail-placeholder-title">
                                                    {messages.grades.detailEmptyTitle}
                                                </h3>
                                                <p className="grades-detail-placeholder-desc">
                                                    {messages.grades.detailEmptyDesc}
                                                </p>
                                            </div>
                                        )}
                                    </aside>
                                ) : null}
                            </div>
                        ) : (
                            <div className="empty-state">
                                <svg className="empty-state-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                </svg>
                                <h3 className="empty-state-title">{messages.grades.noDataTitle}</h3>
                                <p className="empty-state-description">{messages.grades.noDataDesc}</p>
                            </div>
                        )}
                    </>
                )}
            </main>

            {/* Мобильный drawer для деталей — поверх всего экрана.
                На desktop deatil рисуется inline в split-pane выше. */}
            {detailContent && !isDesktop && typeof document !== 'undefined'
                ? createPortal(
                    <>
                        <div
                            className="grades-detail-backdrop"
                            onClick={() => setSelectedSubjectIndex(null)}
                            aria-hidden
                        />
                        <div
                            className="grades-detail-drawer"
                            role="dialog"
                            aria-modal="true"
                            aria-label={selectedSubject?.name ?? messages.grades.detailEmptyTitle}
                        >
                            {detailContent}
                        </div>
                    </>,
                    document.body,
                )
                : null}
        </div>
    );
}
