'use client';

import type { Dispatch, SetStateAction } from 'react';
import type { ActiveLeaderboardData, ActiveLeaderboardEntry } from '@/lib/api';
import { HeroStat, StudentPodiumCard } from '../components';
import { formatLeaderboardDuration, formatUpdatedAt } from '../formatters';
import {
    darkInputStyle,
    gradientButtonStyle,
    rankBubbleStyle,
    secondaryButtonStyle,
    surfaceBoxStyle,
    tinyCapsStyle,
} from '../styles';
import type { LeaderboardSettingsMessages, LeaderboardUiCopy } from '../types';

interface StudentsViewProps {
    studentLoading: boolean;
    studentError: string;
    studentData: ActiveLeaderboardData | null;
    ui: LeaderboardUiCopy;
    lang: string;
    messages: LeaderboardSettingsMessages;
    leaderboardName: string;
    draftLeaderboardName: string;
    setDraftLeaderboardName: (value: string) => void;
    savingLeaderboardName: boolean;
    leaderboardStatus: string | null;
    leaderboardStatusColor: string;
    handleSaveLeaderboardName: () => Promise<void>;
    visibleStudentEntries: ActiveLeaderboardEntry[];
    showAllStudents: boolean;
    setShowAllStudents: Dispatch<SetStateAction<boolean>>;
    podiumTitle: string;
}

export function StudentsView({
    studentLoading,
    studentError,
    studentData,
    ui,
    lang,
    messages,
    leaderboardName,
    draftLeaderboardName,
    setDraftLeaderboardName,
    savingLeaderboardName,
    leaderboardStatus,
    leaderboardStatusColor,
    handleSaveLeaderboardName,
    visibleStudentEntries,
    showAllStudents,
    setShowAllStudents,
    podiumTitle,
}: StudentsViewProps) {
    if (studentLoading) {
        return <p style={{ margin: '24px 0 6px', color: 'var(--muted)', fontSize: '14px' }}>{ui.loading}</p>;
    }
    if (studentError) {
        return <p style={{ margin: '24px 0 6px', color: '#fda4af', fontSize: '14px' }}>{studentError}</p>;
    }
    if (!studentData || studentData.leaderboard.length === 0) {
        return <p style={{ margin: '24px 0 6px', color: 'var(--muted)', fontSize: '14px' }}>{ui.empty}</p>;
    }

    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-5">
                <HeroStat label={ui.totalUsers} value={String(studentData.totalRankedUsers)} accent="linear-gradient(135deg, #60a5fa, #2563eb)" emoji="🌐" />
                <HeroStat label={ui.yourPlace} value={studentData.currentUser ? `#${studentData.currentUser.rank}` : '—'} accent="var(--leaderboard-warm-gradient)" emoji="🎯" />
                <HeroStat label={ui.yourTime} value={studentData.currentUser ? formatLeaderboardDuration(studentData.currentUser.totalSeconds, lang) : '—'} accent="linear-gradient(135deg, #f9a8d4, #ec4899)" emoji="⏳" />
            </div>
            <p style={{ margin: '10px 0 0', color: 'var(--muted)', fontSize: '12px' }}>{ui.whyNotAll}</p>

            <div className="mt-5" style={surfaceBoxStyle}>
                <div style={tinyCapsStyle}>✨ {messages.settings.leaderboard.nicknameTitle}</div>
                <div style={{ color: 'var(--text)', fontSize: '20px', fontWeight: 800, marginTop: '12px' }}>
                    {leaderboardName || messages.settings.leaderboard.nicknamePlaceholder}
                </div>
                <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', maxWidth: '620px', fontSize: '13px' }}>
                    {messages.settings.leaderboard.nicknameDesc}
                </p>

                <div className="mt-4 flex flex-col md:flex-row gap-3 items-stretch md:items-end">
                    <label className="flex-1">
                        <span className="text-xs mb-2 block text-muted-fg">
                            {messages.settings.leaderboard.nicknameLabel}
                        </span>
                        <input
                            value={draftLeaderboardName}
                            onChange={(event) => setDraftLeaderboardName(event.target.value)}
                            maxLength={40}
                            placeholder={messages.settings.leaderboard.nicknamePlaceholder}
                            className="w-full rounded-2xl px-4 py-3 outline-none transition"
                            style={darkInputStyle}
                        />
                    </label>
                    <button
                        type="button"
                        onClick={() => void handleSaveLeaderboardName()}
                        disabled={savingLeaderboardName || draftLeaderboardName.trim().replace(/\s+/g, ' ').slice(0, 40) === leaderboardName}
                        className="px-5 py-3 rounded-2xl text-sm font-semibold text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                        style={gradientButtonStyle}
                    >
                        {savingLeaderboardName ? messages.settings.leaderboard.nicknameSaving : messages.settings.leaderboard.nicknameSave}
                    </button>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
                    <p style={{ margin: 0, color: 'var(--muted)', fontSize: '12px' }}>
                        {messages.settings.leaderboard.nicknameHint}
                    </p>
                    <span style={{ color: leaderboardStatus ? leaderboardStatusColor : 'var(--muted)', fontSize: '12px' }}>
                        {leaderboardStatus || `${draftLeaderboardName.trim().length}/40`}
                    </span>
                </div>
            </div>

            <div className="mt-5" style={surfaceBoxStyle}>
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <div style={tinyCapsStyle}>{podiumTitle}</div>
                            <div style={{ color: 'var(--text)', fontSize: '20px', fontWeight: 800, marginTop: '4px' }}>Top 3</div>
                        </div>
                    <div style={{ color: 'var(--muted)', fontSize: '12px' }}>
                        {ui.updated}: {formatUpdatedAt(studentData.updatedAt, lang)}
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                    {studentData.leaderboard.slice(0, 3).map((entry, index) => (
                        <StudentPodiumCard key={`${entry.rank}-${entry.displayName}`} entry={entry} index={index} lang={lang} youLabel={ui.you} timeLabel={ui.timeOnSite} />
                    ))}
                </div>

                <div className="space-y-2 mt-4">
                    {visibleStudentEntries.map((entry) => (
                        <div key={`${entry.rank}-${entry.displayName}`} className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3" style={{ border: '1px solid var(--border)', background: entry.isCurrentUser ? 'rgba(var(--primary-rgb), 0.12)' : 'var(--bg-secondary)' }}>
                            <div className="flex items-center gap-3 min-w-0">
                                <div style={rankBubbleStyle}>#{entry.rank}</div>
                                <div className="min-w-0">
                                    <div className="truncate" style={{ color: 'var(--text)', fontWeight: 700 }}>{entry.displayName}</div>
                                    <div style={{ color: entry.isCurrentUser ? 'var(--leaderboard-warm-text)' : 'var(--muted)', fontSize: '11px', marginTop: '2px' }}>
                                        {entry.isCurrentUser ? ui.you : `Top ${entry.rank}`}
                                    </div>
                                </div>
                            </div>
                            <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '14px', flexShrink: 0 }}>
                                {formatLeaderboardDuration(entry.totalSeconds, lang)}
                            </div>
                        </div>
                    ))}
                </div>
                {studentData.leaderboard.length > 10 ? (
                    <div className="mt-4 flex justify-center">
                        <button type="button" onClick={() => setShowAllStudents((current) => !current)} className="transition" style={secondaryButtonStyle}>
                            {showAllStudents ? ui.collapse : `${ui.showAll} (${studentData.totalRankedUsers})`}
                        </button>
                    </div>
                ) : null}
            </div>
        </>
    );
}
