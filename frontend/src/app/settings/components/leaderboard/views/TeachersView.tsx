'use client';

import type { Dispatch, SetStateAction } from 'react';
import { BadgeCheck } from 'lucide-react';
import type {
    TeacherDirectoryEntry,
    TeacherLeaderboardData,
    TeacherLeaderboardEntry,
    TeacherTier,
} from '@/lib/api';
import { HeroStat, TeacherPodiumCard, TeacherTierBadge } from '../components';
import { formatUpdatedAt } from '../formatters';
import {
    darkInputStyle,
    dropdownButtonStyle,
    dropdownItemMutedStyle,
    dropdownStyle,
    gradientButtonStyle,
    hintChipStyle,
    miniMutedStyle,
    rankBubbleStyle,
    secondaryButtonStyle,
    surfaceBoxStyle,
    tagChipStyle,
    teacherRowButtonStyle,
    tierButtonStyle,
    tinyCapsStyle,
} from '../styles';
import { TEACHER_TAGS, TIER_ORDER, type LeaderboardUiCopy } from '../types';

interface TeachersViewProps {
    teacherLoading: boolean;
    teacherError: string;
    teacherData: TeacherLeaderboardData | null;
    ui: LeaderboardUiCopy;
    lang: string;
    teacherSearch: string;
    setTeacherSearch: (value: string) => void;
    teacherSearchLoading: boolean;
    teacherSearchResults: TeacherDirectoryEntry[];
    selectedTeacher: TeacherDirectoryEntry | null;
    selectedTier: TeacherTier | null;
    setSelectedTier: (value: TeacherTier) => void;
    selectedTags: string[];
    toggleTeacherTag: (tag: string) => void;
    teacherStatus: string | null;
    teacherStatusTone: 'ok' | 'error';
    savingTeacherRating: boolean;
    creatingTeacher: boolean;
    handleCreateTeacher: () => Promise<void>;
    handleSaveTeacherRating: () => Promise<void>;
    syncTeacherSelection: (teacher: TeacherDirectoryEntry | TeacherLeaderboardEntry) => void;
    visibleTeacherEntries: TeacherLeaderboardEntry[];
    showAllTeachers: boolean;
    setShowAllTeachers: Dispatch<SetStateAction<boolean>>;
    teacherPodiumTitle: string;
    canAddTeacher: boolean;
    // Phase 2 fuzzy cross-check modal state.
    teacherConfirmKind: 'not-in-schedule' | 'canonical' | null;
    teacherCanonicalSuggestion: string | null;
    onConfirmNotInSchedule: () => void | Promise<void>;
    onCancelNotInSchedule: () => void;
    onUseCanonicalSuggestion: () => void | Promise<void>;
    onKeepCanonicalSuggestion: () => void;
}

export function TeachersView({
    teacherLoading,
    teacherError,
    teacherData,
    ui,
    lang,
    teacherSearch,
    setTeacherSearch,
    teacherSearchLoading,
    teacherSearchResults,
    selectedTeacher,
    selectedTier,
    setSelectedTier,
    selectedTags,
    toggleTeacherTag,
    teacherStatus,
    teacherStatusTone,
    savingTeacherRating,
    creatingTeacher,
    handleCreateTeacher,
    handleSaveTeacherRating,
    syncTeacherSelection,
    visibleTeacherEntries,
    showAllTeachers,
    setShowAllTeachers,
    teacherPodiumTitle,
    canAddTeacher,
    teacherConfirmKind,
    teacherCanonicalSuggestion,
    onConfirmNotInSchedule,
    onCancelNotInSchedule,
    onUseCanonicalSuggestion,
    onKeepCanonicalSuggestion,
}: TeachersViewProps) {
    if (teacherLoading) {
        return <p style={{ margin: '24px 0 6px', color: 'var(--muted)', fontSize: '14px' }}>{ui.loading}</p>;
    }
    if (teacherError) {
        return <p style={{ margin: '24px 0 6px', color: 'var(--leaderboard-error-text)', fontSize: '14px' }}>{teacherError}</p>;
    }
    if (!teacherData) {
        return <p style={{ margin: '24px 0 6px', color: 'var(--muted)', fontSize: '14px' }}>{ui.teachersEmpty}</p>;
    }

    // Phase 2: confirmation modal copy depends on which kind is active.
    const confirmModal = teacherConfirmKind === 'not-in-schedule' ? {
        title: ui.teacherNotInScheduleTitle,
        body: ui.teacherNotInScheduleBody,
        confirmLabel: ui.teacherNotInScheduleAddAnyway,
        cancelLabel: ui.teacherNotInScheduleCancel,
        onConfirm: onConfirmNotInSchedule,
        onCancel: onCancelNotInSchedule,
        highlight: null as string | null,
    } : teacherConfirmKind === 'canonical' && teacherCanonicalSuggestion ? {
        title: ui.teacherCanonicalSuggestionTitle,
        body: '',
        confirmLabel: ui.teacherCanonicalSuggestionUse,
        cancelLabel: ui.teacherCanonicalSuggestionKeep,
        onConfirm: onUseCanonicalSuggestion,
        onCancel: onKeepCanonicalSuggestion,
        highlight: teacherCanonicalSuggestion,
    } : null;

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
                <HeroStat label={ui.totalTeachers} value={String(teacherData.totalTeachers)} accent="var(--leaderboard-accent-emerald-gradient)" emoji="🎓" />
                <HeroStat label={ui.totalVotes} value={String(teacherData.totalVotes)} accent="var(--leaderboard-warm-gradient)" emoji="🗳️" />
                <HeroStat label={ui.yourTeacherVotes} value={String(teacherData.myRatings.length)} accent="var(--leaderboard-accent-purple-gradient)" emoji="🧠" />
            </div>
            <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: '12px' }}>{ui.teacherRankHint}</p>

            <div className="grid grid-cols-1 xl:grid-cols-[1.08fr_0.92fr] gap-4 mt-5">
                <div style={surfaceBoxStyle}>
                    <div style={tinyCapsStyle}>🎯 {ui.myRatingCard}</div>
                    <div style={{ color: 'var(--text)', fontSize: '20px', fontWeight: 800, marginTop: '10px' }}>{ui.selectedTeacher}</div>
                    <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: '13px', maxWidth: '640px' }}>{ui.seedHint}</p>

                    <div className="mt-4" style={{ position: 'relative' }}>
                        <input value={teacherSearch} onChange={(event) => setTeacherSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape' && teacherSearch) { event.preventDefault(); setTeacherSearch(''); } }} placeholder={ui.teacherSearchPlaceholder} className="w-full rounded-2xl px-4 py-3 outline-none transition" style={darkInputStyle} />
                        {(teacherSearchLoading || teacherSearchResults.length > 0 || teacherSearch.trim().length >= 2) ? (
                            <div style={{ ...dropdownStyle, marginTop: '10px' }}>
                                {teacherSearchLoading ? (
                                    <div style={dropdownItemMutedStyle}>{ui.teacherSearchLoading}</div>
                                ) : teacherSearchResults.length > 0 ? (
                                    teacherSearchResults.map((teacher) => (
                                        <button
                                            key={teacher.teacherId}
                                            type="button"
                                            onClick={() => syncTeacherSelection(teacher)}
                                            style={{ ...dropdownButtonStyle, opacity: teacher.isVerified ? 1 : 0.78 }}
                                        >
                                            <div>
                                                <div style={{ color: 'var(--text)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                    <span>{teacher.name}</span>
                                                    {teacher.isVerified ? (
                                                        <BadgeCheck size={14} aria-label={ui.sourceProfile} style={{ color: 'var(--primary)' }} />
                                                    ) : null}
                                                </div>
                                                <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '4px' }}>
                                                    {teacher.isVerified
                                                        ? (teacher.myRating ? `${ui.teacherYourVote}: ${teacher.myRating.tier}` : ui.teacherSearchHint)
                                                        : ui.teacherUnverifiedLabel}
                                                </div>
                                            </div>
                                            {teacher.sourceUrl ? <span style={hintChipStyle}>{ui.sourceProfile}</span> : null}
                                        </button>
                                    ))
                                ) : (
                                    <div style={dropdownItemMutedStyle}>{ui.teacherSearchEmpty}</div>
                                )}
                            </div>
                        ) : null}
                    </div>

                    <div className="mt-3 flex items-center gap-3 flex-wrap">
                        <button type="button" onClick={() => void handleCreateTeacher()} disabled={!canAddTeacher || creatingTeacher} style={secondaryButtonStyle}>
                            {creatingTeacher ? ui.addingTeacher : ui.addTeacher}
                        </button>
                        <span style={{ color: 'var(--muted)', fontSize: '12px' }}>
                            {teacherSearch.trim().length > 0 && !canAddTeacher ? ui.teacherNameInvalidHint : ui.teacherSearchHint}
                        </span>
                    </div>

                    <div className="mt-5 rounded-3xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-secondary)' }}>
                        {selectedTeacher ? (
                            <>
                                <div className="flex items-start justify-between gap-3 flex-wrap">
                                    <div>
                                        <div style={{ color: 'var(--text)', fontSize: '22px', fontWeight: 800, opacity: selectedTeacher.isVerified ? 1 : 0.78, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                            <span>{selectedTeacher.name}</span>
                                            {selectedTeacher.isVerified ? (
                                                <BadgeCheck size={18} aria-label={ui.sourceProfile} style={{ color: 'var(--primary)' }} />
                                            ) : null}
                                        </div>
                                        {!selectedTeacher.isVerified ? (
                                            <div style={{ color: 'var(--muted)', fontSize: '12px', marginTop: '4px' }}>{ui.teacherUnverifiedLabel}</div>
                                        ) : null}
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            {selectedTeacher.sourceUrl ? <span style={hintChipStyle}>{ui.sourceProfile}</span> : null}
                                            {selectedTier ? <TeacherTierBadge tier={selectedTier} compact /> : null}
                                        </div>
                                    </div>
                                    {teacherStatus ? <span style={{ color: teacherStatusTone === 'ok' ? 'var(--leaderboard-status-ok-text)' : 'var(--leaderboard-status-error-text)', fontSize: '12px', fontWeight: 700 }}>{teacherStatus}</span> : null}
                                </div>

                                <div className="mt-5">
                                    <div style={{ ...tinyCapsStyle, marginBottom: '10px' }}>{ui.chooseTier}</div>
                                    <div className="flex flex-wrap gap-2">
                                        {TIER_ORDER.map((tier) => (
                                            <button key={tier} type="button" onClick={() => setSelectedTier(tier)} style={tierButtonStyle(tier, selectedTier === tier)}>
                                                {tier}-tier
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-5">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <div style={tinyCapsStyle}>{ui.chooseTags}</div>
                                        <div style={{ color: 'var(--muted)', fontSize: '12px' }}>{selectedTags.length}/5</div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 mt-3">
                                        {TEACHER_TAGS.map((tag) => (
                                            <button key={tag} type="button" onClick={() => toggleTeacherTag(tag)} style={tagChipStyle(selectedTags.includes(tag))}>
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                    <p style={{ margin: '12px 0 0', color: 'var(--muted)', fontSize: '12px' }}>{ui.tagsHint}</p>
                                </div>

                                <div className="mt-5">
                                    <button type="button" onClick={() => void handleSaveTeacherRating()} disabled={!selectedTier || savingTeacherRating} className="px-5 py-3 rounded-2xl text-sm font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed" style={gradientButtonStyle}>
                                        {savingTeacherRating ? ui.savingTeacherRating : ui.saveTeacherRating}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>{ui.noTeacherSelected}</div>
                        )}
                    </div>
                </div>

                <div style={surfaceBoxStyle}>
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <div style={tinyCapsStyle}>{teacherPodiumTitle}</div>
                            <div style={{ color: 'var(--text)', fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>Top 3</div>
                        </div>
                        <div style={{ color: 'var(--muted)', fontSize: '12px' }}>{ui.updated}: {formatUpdatedAt(teacherData.updatedAt, lang)}</div>
                    </div>

                    {teacherData.leaderboard.length === 0 ? (
                        <p style={{ margin: '20px 0 0', color: 'var(--muted)', fontSize: '14px' }}>{ui.teachersEmpty}</p>
                    ) : (
                        <>
                            <div className="grid grid-cols-1 gap-3 mt-4">
                                {teacherData.leaderboard.slice(0, 3).map((teacher) => (
                                    <TeacherPodiumCard key={teacher.teacherId} entry={teacher} onSelect={() => syncTeacherSelection(teacher)} voteLabel={ui.teacherVotes} />
                                ))}
                            </div>

                            <div className="space-y-2 mt-4">
                                {visibleTeacherEntries.map((teacher) => (
                                    <button key={teacher.teacherId} type="button" onClick={() => syncTeacherSelection(teacher)} style={{ ...teacherRowButtonStyle(teacher.teacherId === selectedTeacher?.teacherId), opacity: teacher.isVerified ? 1 : 0.78 }}>
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div style={rankBubbleStyle}>#{teacher.rank}</div>
                                            <div className="min-w-0 text-left">
                                                <div className="truncate" style={{ color: 'var(--text)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                                    <span>{teacher.name}</span>
                                                    {teacher.isVerified ? (
                                                        <BadgeCheck size={14} aria-label={ui.sourceProfile} style={{ color: 'var(--primary)' }} />
                                                    ) : null}
                                                </div>
                                                {!teacher.isVerified ? (
                                                    <div style={{ color: 'var(--muted)', fontSize: '11px', marginTop: '2px' }}>{ui.teacherUnverifiedLabel}</div>
                                                ) : null}
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    <TeacherTierBadge tier={teacher.averageTier} compact />
                                                    <span style={miniMutedStyle}>{teacher.voteCount} {ui.teacherVotes}</span>
                                                    {teacher.myRating ? <span style={{ ...hintChipStyle, color: 'var(--leaderboard-my-rating-color)' }}>{ui.teacherYourVote}: {teacher.myRating.tier}</span> : null}
                                                </div>
                                                <div className="flex flex-wrap gap-2 mt-2">
                                                    {teacher.topTags.length > 0 ? teacher.topTags.map((tag) => (
                                                        <span key={tag} style={hintChipStyle}>{tag}</span>
                                                    )) : (
                                                        <span style={miniMutedStyle}>{ui.noTopTags}</span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            {teacherData.leaderboard.length > 10 ? (
                                <div className="mt-4 flex justify-center">
                                    <button type="button" onClick={() => setShowAllTeachers((current) => !current)} className="transition" style={secondaryButtonStyle}>
                                        {showAllTeachers ? ui.collapse : `${ui.showAll} (${teacherData.totalTeachers})`}
                                    </button>
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </div>

            {confirmModal ? (
                <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="teacher-confirm-title"
                    onClick={(event) => { if (event.target === event.currentTarget) confirmModal.onCancel(); }}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 60,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '20px',
                        background: 'var(--overlay-scrim, rgba(0, 0, 0, 0.55))',
                        backdropFilter: 'blur(2px)',
                    }}
                >
                    <div
                        style={{
                            width: '100%',
                            maxWidth: '420px',
                            borderRadius: '20px',
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            padding: '20px',
                            boxShadow: 'var(--shadow-elevated, 0 20px 60px rgba(0, 0, 0, 0.4))',
                        }}
                    >
                        <div id="teacher-confirm-title" style={{ color: 'var(--text)', fontSize: '17px', fontWeight: 800 }}>
                            {confirmModal.title}
                        </div>
                        {confirmModal.highlight ? (
                            <div style={{ marginTop: '12px', padding: '10px 14px', borderRadius: '14px', background: 'var(--bg-secondary)', color: 'var(--text)', fontWeight: 700, fontSize: '15px' }}>
                                {confirmModal.highlight}
                            </div>
                        ) : null}
                        {confirmModal.body ? (
                            <p style={{ marginTop: '12px', color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.45 }}>
                                {confirmModal.body}
                            </p>
                        ) : null}
                        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => confirmModal.onCancel()}
                                style={secondaryButtonStyle}
                            >
                                {confirmModal.cancelLabel}
                            </button>
                            <button
                                type="button"
                                onClick={() => { void confirmModal.onConfirm(); }}
                                className="transition disabled:opacity-50 disabled:cursor-not-allowed"
                                style={gradientButtonStyle}
                            >
                                {confirmModal.confirmLabel}
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </>
    );
}
