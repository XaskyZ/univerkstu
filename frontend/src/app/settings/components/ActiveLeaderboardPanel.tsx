'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    createTeacherDirectoryEntry,
    getActiveLeaderboard,
    getReferralOverview,
    getStatus,
    getTeacherLeaderboard,
    saveMyTeacherRating,
    searchTeacherDirectory,
    updateLeaderboardDisplayName,
    type ActiveLeaderboardData,
    type ReferralOverview,
    type TeacherDirectoryEntry,
    type TeacherLeaderboardData,
    type TeacherLeaderboardEntry,
    type TeacherLeaderboardPeriod,
    type TeacherTier,
} from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { ModePill } from './leaderboard/components';
import { getLeaderboardUi } from './leaderboard/strings';
import { ReferralsView } from './leaderboard/views/ReferralsView';
import { StudentsView } from './leaderboard/views/StudentsView';
import { SubjectsView } from './leaderboard/views/SubjectsView';
import { TeachersView } from './leaderboard/views/TeachersView';
import {
    type LeaderboardPeriod,
    type LeaderboardViewMode,
} from './leaderboard/types';
import { isTeacherNameLikelyValid } from './leaderboard/teacherNameClientValidator';

export function ActiveLeaderboardPanel() {
    const { messages } = useLanguage();
    const [viewMode, setViewMode] = useState<LeaderboardViewMode>('students');
    const [period, setPeriod] = useState<LeaderboardPeriod>('day');
    const [subjectRefreshSignal, setSubjectRefreshSignal] = useState(0);

    const [studentData, setStudentData] = useState<ActiveLeaderboardData | null>(null);
    const [studentLoading, setStudentLoading] = useState(true);
    const [studentError, setStudentError] = useState('');
    const [showAllStudents, setShowAllStudents] = useState(false);
    const [leaderboardName, setLeaderboardName] = useState('');
    const [draftLeaderboardName, setDraftLeaderboardName] = useState('');
    const [savingLeaderboardName, setSavingLeaderboardName] = useState(false);
    const [leaderboardStatus, setLeaderboardStatus] = useState<string | null>(null);

    const [teacherData, setTeacherData] = useState<TeacherLeaderboardData | null>(null);
    const [teacherLoading, setTeacherLoading] = useState(false);
    const [teacherError, setTeacherError] = useState('');
    const [teacherSearch, setTeacherSearch] = useState('');
    const [teacherSearchResults, setTeacherSearchResults] = useState<TeacherDirectoryEntry[]>([]);
    const [teacherSearchLoading, setTeacherSearchLoading] = useState(false);
    const [selectedTeacher, setSelectedTeacher] = useState<TeacherDirectoryEntry | null>(null);
    const [selectedTier, setSelectedTier] = useState<TeacherTier | null>(null);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const [teacherStatus, setTeacherStatus] = useState<string | null>(null);
    const [teacherStatusTone, setTeacherStatusTone] = useState<'ok' | 'error'>('ok');
    const [savingTeacherRating, setSavingTeacherRating] = useState(false);
    const [creatingTeacher, setCreatingTeacher] = useState(false);
    const [showAllTeachers, setShowAllTeachers] = useState(false);
    // Phase 2 fuzzy cross-check: when backend flags the input as missing from
    // the user's own schedule (notInSchedule) we show a confirm modal before
    // the user can submit again with force=true. When the backend offers a
    // canonical schedule version (canonicalSuggestion) we offer to swap.
    const [teacherConfirmKind, setTeacherConfirmKind] = useState<'not-in-schedule' | 'canonical' | null>(null);
    const [teacherCanonicalSuggestion, setTeacherCanonicalSuggestion] = useState<string | null>(null);

    const [referralData, setReferralData] = useState<ReferralOverview | null>(null);
    const [referralLoading, setReferralLoading] = useState(false);
    const [referralError, setReferralError] = useState('');
    const [showAllReferrals, setShowAllReferrals] = useState(false);

    const lang = typeof document !== 'undefined' ? document.documentElement.lang : 'ru';

    const ui = useMemo(() => getLeaderboardUi(lang), [lang]);

    const periodOptions: Array<{ value: LeaderboardPeriod; label: string }> = useMemo(() => ([
        { value: 'day', label: ui.periodDay },
        { value: 'week', label: ui.periodWeek },
        { value: 'all', label: ui.periodAll },
    ]), [ui.periodAll, ui.periodDay, ui.periodWeek]);

    const loadStudentLeaderboard = useCallback(async () => {
        setStudentLoading(true);
        setStudentError('');
        try {
            const result = await getActiveLeaderboard(period);
            if (!result.success || !result.data) {
                throw new Error(result.error || ui.error);
            }
            setStudentData(result.data);
            setShowAllStudents(false);
        } catch (loadError) {
            setStudentError(loadError instanceof Error ? loadError.message : ui.error);
        } finally {
            setStudentLoading(false);
        }
    }, [period, ui.error]);

    const loadTeacherLeaderboardData = useCallback(async () => {
        setTeacherLoading(true);
        setTeacherError('');
        try {
            const result = await getTeacherLeaderboard(period as TeacherLeaderboardPeriod);
            if (!result.success || !result.data) {
                throw new Error(result.error || ui.teachersError);
            }
            setTeacherData(result.data);
            setShowAllTeachers(false);
        } catch (loadError) {
            setTeacherError(loadError instanceof Error ? loadError.message : ui.teachersError);
        } finally {
            setTeacherLoading(false);
        }
    }, [period, ui.teachersError]);

    const loadReferralLeaderboardData = useCallback(async () => {
        setReferralLoading(true);
        setReferralError('');
        try {
            const result = await getReferralOverview();
            if (!result.success || !result.data) {
                throw new Error(result.error || ui.referralsError);
            }
            setReferralData(result.data);
            setShowAllReferrals(false);
        } catch (loadError) {
            setReferralError(loadError instanceof Error ? loadError.message : ui.referralsError);
        } finally {
            setReferralLoading(false);
        }
    }, [ui.referralsError]);

    const loadLeaderboardSettings = useCallback(async () => {
        const result = await getStatus();
        if (!result.success) return;
        const directUser = (result as { user?: { settings?: { leaderboardDisplayName?: string } } }).user;
        const nextValue = typeof directUser?.settings?.leaderboardDisplayName === 'string'
            ? directUser.settings.leaderboardDisplayName
            : '';
        setLeaderboardName(nextValue);
        setDraftLeaderboardName(nextValue);
    }, []);

    useEffect(() => {
        void loadLeaderboardSettings();
    }, [loadLeaderboardSettings]);

    useEffect(() => {
        if (viewMode === 'students') {
            void loadStudentLeaderboard();
            return;
        }
        if (viewMode === 'subjects') {
            return;
        }
        if (viewMode === 'teachers') {
            void loadTeacherLeaderboardData();
            return;
        }
        void loadReferralLeaderboardData();
    }, [viewMode, period, loadStudentLeaderboard, loadTeacherLeaderboardData, loadReferralLeaderboardData]);

    useEffect(() => {
        if (viewMode !== 'teachers') return;
        const query = teacherSearch.trim();
        if (query.length < 2) {
            setTeacherSearchResults([]);
            setTeacherSearchLoading(false);
            return;
        }

        const timeout = window.setTimeout(async () => {
            setTeacherSearchLoading(true);
            const result = await searchTeacherDirectory(query);
            if (result.success && result.data) {
                setTeacherSearchResults(result.data.results);
            } else {
                setTeacherSearchResults([]);
            }
            setTeacherSearchLoading(false);
        }, 280);

        return () => window.clearTimeout(timeout);
    }, [teacherSearch, viewMode]);

    const handleSaveLeaderboardName = useCallback(async () => {
        setSavingLeaderboardName(true);
        setLeaderboardStatus(null);
        const normalized = draftLeaderboardName.trim().replace(/\s+/g, ' ').slice(0, 40);
        const result = await updateLeaderboardDisplayName(normalized);
        if (result.success) {
            setLeaderboardName(normalized);
            setDraftLeaderboardName(normalized);
            setLeaderboardStatus(messages.settings.leaderboard.nicknameSaved);
            await Promise.all([loadStudentLeaderboard(), loadLeaderboardSettings()]);
        } else {
            setLeaderboardStatus(result.error || messages.settings.leaderboard.nicknameFailed);
        }
        setSavingLeaderboardName(false);
    }, [
        draftLeaderboardName,
        loadLeaderboardSettings,
        loadStudentLeaderboard,
        messages.settings.leaderboard.nicknameFailed,
        messages.settings.leaderboard.nicknameSaved,
    ]);

    const syncTeacherSelection = useCallback((teacher: TeacherDirectoryEntry | TeacherLeaderboardEntry) => {
        const selected: TeacherDirectoryEntry = {
            teacherId: teacher.teacherId,
            name: teacher.name,
            sourceUrl: 'sourceUrl' in teacher ? teacher.sourceUrl : null,
            isVerified: Boolean(teacher.isVerified),
            createdAt: 'createdAt' in teacher ? teacher.createdAt : new Date().toISOString(),
            updatedAt: 'updatedAt' in teacher ? teacher.updatedAt : new Date().toISOString(),
            myRating: teacher.myRating,
        };
        setSelectedTeacher(selected);
        setSelectedTier(teacher.myRating?.tier || null);
        setSelectedTags(teacher.myRating?.tags || []);
        setTeacherStatus(null);
    }, []);

    // Phase 2 fuzzy cross-check: shared submission helper. Accepts an optional
    // override name (used by the "use canonical suggestion" modal) and a force
    // flag (used by the "add anyway" modal to skip the not-in-schedule block).
    const submitCreateTeacher = useCallback(async (overrideName?: string, force?: boolean) => {
        const name = (overrideName ?? teacherSearch).trim().replace(/\s+/g, ' ');
        if (name.length < 3) return;
        setCreatingTeacher(true);
        setTeacherStatus(null);
        const result = await createTeacherDirectoryEntry(name, force ? { force: true } : undefined);

        // Backend returned 409 with notInSchedule: true — show confirm modal,
        // don't surface as an error toast. User decides whether to re-submit.
        if (!result.success && result.notInSchedule) {
            setTeacherConfirmKind('not-in-schedule');
            setTeacherCanonicalSuggestion(null);
            setCreatingTeacher(false);
            return;
        }

        if (result.success && result.data?.teacher) {
            const teacher = result.data.teacher;
            syncTeacherSelection(teacher);
            setTeacherSearch(teacher.name);
            setTeacherSearchResults([teacher]);
            setTeacherStatus(ui.teacherSaved);
            setTeacherStatusTone('ok');
            await loadTeacherLeaderboardData();

            // Backend fuzzy-matched and returned a canonical suggestion. Offer to
            // swap the user's typed name for the schedule's version. Skipped when
            // the names are already identical (no improvement to suggest).
            const suggestion = result.canonicalSuggestion ?? null;
            if (suggestion && suggestion.trim() && suggestion.trim() !== teacher.name.trim()) {
                setTeacherCanonicalSuggestion(suggestion);
                setTeacherConfirmKind('canonical');
            }
        } else {
            setTeacherStatus(result.error || ui.teacherFailed);
            setTeacherStatusTone('error');
        }
        setCreatingTeacher(false);
    }, [loadTeacherLeaderboardData, syncTeacherSelection, teacherSearch, ui.teacherFailed, ui.teacherSaved]);

    const handleCreateTeacher = useCallback(async () => {
        await submitCreateTeacher();
    }, [submitCreateTeacher]);

    const handleConfirmNotInSchedule = useCallback(async () => {
        setTeacherConfirmKind(null);
        await submitCreateTeacher(undefined, true);
    }, [submitCreateTeacher]);

    const handleCancelNotInSchedule = useCallback(() => {
        setTeacherConfirmKind(null);
    }, []);

    const handleUseCanonicalSuggestion = useCallback(async () => {
        const suggestion = teacherCanonicalSuggestion;
        setTeacherConfirmKind(null);
        setTeacherCanonicalSuggestion(null);
        if (suggestion) {
            await submitCreateTeacher(suggestion);
        }
    }, [submitCreateTeacher, teacherCanonicalSuggestion]);

    const handleKeepCanonicalSuggestion = useCallback(() => {
        setTeacherConfirmKind(null);
        setTeacherCanonicalSuggestion(null);
    }, []);

    const handleSaveTeacherRating = useCallback(async () => {
        if (!selectedTeacher || !selectedTier) return;
        setSavingTeacherRating(true);
        setTeacherStatus(null);
        const result = await saveMyTeacherRating(selectedTeacher.teacherId, selectedTier, selectedTags);
        if (result.success) {
            setTeacherStatus(ui.teacherSaved);
            setTeacherStatusTone('ok');
            await loadTeacherLeaderboardData();
            setSelectedTeacher((current) => current ? {
                ...current,
                myRating: {
                    teacherId: current.teacherId,
                    tier: selectedTier,
                    tags: selectedTags,
                    updatedAt: new Date().toISOString(),
                },
            } : current);
        } else {
            setTeacherStatus(result.error || ui.teacherFailed);
            setTeacherStatusTone('error');
        }
        setSavingTeacherRating(false);
    }, [loadTeacherLeaderboardData, selectedTags, selectedTeacher, selectedTier, ui.teacherFailed, ui.teacherSaved]);

    const toggleTeacherTag = useCallback((tag: string) => {
        setSelectedTags((current) => {
            if (current.includes(tag)) {
                return current.filter((entry) => entry !== tag);
            }
            if (current.length >= 5) {
                setTeacherStatus(ui.tagLimitReached);
                setTeacherStatusTone('error');
                return current;
            }
            return [...current, tag];
        });
    }, [ui.tagLimitReached]);

    const leaderboardStatusColor = leaderboardStatus === messages.settings.leaderboard.nicknameSaved
        ? '#22c55e'
        : '#fda4af';
    const visibleStudentEntries = showAllStudents ? studentData?.leaderboard.slice(3) ?? [] : studentData?.leaderboard.slice(3, 10) ?? [];
    const visibleTeacherEntries = showAllTeachers ? teacherData?.leaderboard.slice(3) ?? [] : teacherData?.leaderboard.slice(3, 10) ?? [];
    const visibleReferralEntries = showAllReferrals ? referralData?.leaderboard.slice(3) ?? [] : referralData?.leaderboard.slice(3, 10) ?? [];
    const podiumTitle = period === 'day' ? ui.podiumDay : period === 'week' ? ui.podiumWeek : ui.podiumAll;
    const teacherPodiumTitle = period === 'day' ? ui.topTeachersDay : period === 'week' ? ui.topTeachersWeek : ui.topTeachersAll;
    const referralPodiumTitle = ui.topReferrersAll;
    const canAddTeacher = isTeacherNameLikelyValid(teacherSearch);

    return (
        <div
            className="animate-fadeInUp"
            style={{
                borderRadius: '28px',
                border: '1px solid var(--leaderboard-panel-border)',
                background: 'var(--leaderboard-panel-bg)',
                boxShadow: 'var(--leaderboard-panel-shadow)',
                overflow: 'hidden',
                position: 'relative',
            }}
        >
            <div
                aria-hidden
                style={{
                    position: 'absolute',
                    inset: 0,
                    background: `
                        radial-gradient(circle at 14% 16%, rgba(251,191,36,0.22), transparent 24%),
                        radial-gradient(circle at 84% 12%, rgba(96,165,250,0.18), transparent 26%),
                        radial-gradient(circle at 72% 86%, rgba(244,114,182,0.16), transparent 24%)
                    `,
                    pointerEvents: 'none',
                }}
            />

            <div className="p-5 md:p-6" style={{ position: 'relative', zIndex: 1 }}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '7px 12px', borderRadius: '999px', background: 'var(--leaderboard-panel-eyebrow-bg)', color: 'var(--leaderboard-eyebrow-color)', fontSize: '11px', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                            <span>🏆</span>
                            <span>{ui.topLabel}</span>
                        </div>
                        <h2 style={{ margin: '14px 0 6px', color: 'var(--leaderboard-panel-title)', fontSize: '30px', lineHeight: 1.05, fontWeight: 800 }}>
                            {viewMode === 'students' ? ui.title : viewMode === 'subjects' ? ui.subjectsTitle : viewMode === 'teachers' ? ui.teachersTitle : ui.referralsTitle}
                        </h2>
                        <p style={{ margin: 0, color: 'var(--leaderboard-panel-copy)', maxWidth: '640px', fontSize: '14px' }}>
                            {viewMode === 'students' ? ui.subtitle : viewMode === 'subjects' ? ui.subjectsSubtitle : viewMode === 'teachers' ? ui.teachersSubtitle : ui.referralsSubtitle}
                        </p>
                    </div>

                    <button
                        type="button"
                        onClick={() => void (viewMode === 'students' ? loadStudentLeaderboard() : viewMode === 'subjects' ? setSubjectRefreshSignal((current) => current + 1) : viewMode === 'teachers' ? loadTeacherLeaderboardData() : loadReferralLeaderboardData())}
                        className="transition"
                        style={{ borderRadius: '16px', border: '1px solid var(--leaderboard-panel-refresh-border)', background: 'var(--leaderboard-panel-refresh-bg)', color: 'var(--leaderboard-panel-refresh-color)', padding: '12px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer', backdropFilter: 'blur(10px)' }}
                    >
                        {ui.refresh}
                    </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
                    <ModePill active={viewMode === 'students'} label={ui.studentsTab} onClick={() => setViewMode('students')} />
                    <ModePill active={viewMode === 'subjects'} label={ui.subjectsTab} onClick={() => setViewMode('subjects')} />
                    <ModePill active={viewMode === 'teachers'} label={ui.teachersTab} onClick={() => setViewMode('teachers')} />
                    <ModePill active={viewMode === 'referrals'} label={ui.referralsTab} onClick={() => setViewMode('referrals')} />
                </div>

                {viewMode !== 'referrals' && viewMode !== 'subjects' ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                        {periodOptions.map((option) => {
                            const active = option.value === period;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => {
                                        setShowAllStudents(false);
                                        setShowAllTeachers(false);
                                        setShowAllReferrals(false);
                                        setPeriod(option.value);
                                    }}
                                    className="transition"
                                    style={{
                                        borderRadius: '999px',
                                        border: active ? '1px solid rgba(96,165,250,0.45)' : '1px solid rgba(148,163,184,0.18)',
                                        background: active ? 'linear-gradient(135deg, rgba(96,165,250,0.22), rgba(139,92,246,0.24))' : 'var(--leaderboard-pill-bg)',
                                        color: active ? '#fff' : 'var(--leaderboard-pill-color)',
                                        padding: '10px 16px',
                                        fontSize: '13px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                    }}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                ) : null}

                {viewMode === 'students' ? (
                    <StudentsView
                        studentLoading={studentLoading}
                        studentError={studentError}
                        studentData={studentData}
                        ui={ui}
                        lang={lang}
                        messages={messages}
                        leaderboardName={leaderboardName}
                        draftLeaderboardName={draftLeaderboardName}
                        setDraftLeaderboardName={setDraftLeaderboardName}
                        savingLeaderboardName={savingLeaderboardName}
                        leaderboardStatus={leaderboardStatus}
                        leaderboardStatusColor={leaderboardStatusColor}
                        handleSaveLeaderboardName={handleSaveLeaderboardName}
                        visibleStudentEntries={visibleStudentEntries}
                        showAllStudents={showAllStudents}
                        setShowAllStudents={setShowAllStudents}
                        podiumTitle={podiumTitle}
                    />
                ) : viewMode === 'subjects' ? (
                    <SubjectsView ui={ui} refreshSignal={subjectRefreshSignal} />
                ) : viewMode === 'teachers' ? (
                    <TeachersView
                        teacherLoading={teacherLoading}
                        teacherError={teacherError}
                        teacherData={teacherData}
                        ui={ui}
                        lang={lang}
                        teacherSearch={teacherSearch}
                        setTeacherSearch={setTeacherSearch}
                        teacherSearchLoading={teacherSearchLoading}
                        teacherSearchResults={teacherSearchResults}
                        selectedTeacher={selectedTeacher}
                        selectedTier={selectedTier}
                        setSelectedTier={setSelectedTier}
                        selectedTags={selectedTags}
                        toggleTeacherTag={toggleTeacherTag}
                        teacherStatus={teacherStatus}
                        teacherStatusTone={teacherStatusTone}
                        savingTeacherRating={savingTeacherRating}
                        creatingTeacher={creatingTeacher}
                        handleCreateTeacher={handleCreateTeacher}
                        handleSaveTeacherRating={handleSaveTeacherRating}
                        syncTeacherSelection={syncTeacherSelection}
                        visibleTeacherEntries={visibleTeacherEntries}
                        showAllTeachers={showAllTeachers}
                        setShowAllTeachers={setShowAllTeachers}
                        teacherPodiumTitle={teacherPodiumTitle}
                        canAddTeacher={canAddTeacher}
                        teacherConfirmKind={teacherConfirmKind}
                        teacherCanonicalSuggestion={teacherCanonicalSuggestion}
                        onConfirmNotInSchedule={handleConfirmNotInSchedule}
                        onCancelNotInSchedule={handleCancelNotInSchedule}
                        onUseCanonicalSuggestion={handleUseCanonicalSuggestion}
                        onKeepCanonicalSuggestion={handleKeepCanonicalSuggestion}
                    />
                ) : (
                    <ReferralsView
                        referralLoading={referralLoading}
                        referralError={referralError}
                        referralData={referralData}
                        ui={ui}
                        lang={lang}
                        visibleReferralEntries={visibleReferralEntries}
                        showAllReferrals={showAllReferrals}
                        setShowAllReferrals={setShowAllReferrals}
                        referralPodiumTitle={referralPodiumTitle}
                    />
                )}
            </div>
        </div>
    );
}
