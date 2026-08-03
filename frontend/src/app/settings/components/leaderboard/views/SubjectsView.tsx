'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AtSign, MessageCircle, Search, Send, Trophy, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { updateGradesLeaderboardOptOut, getStatus, updateLeaderboardContacts, updateLeaderboardDisplayName } from '@/lib/api';
import {
    getSubjectLeaderboard,
    listLeaderboardSubjects,
    type LeaderboardSubject,
    type SubjectLeaderboard,
} from '@/lib/api/leaderboard';
import { useAuth } from '@/lib/auth-context';
import { toast } from '@/lib/toast';
import { buildDirectRoomId } from '@/app/chat/utils/helpers';
import { darkInputStyle, rankBubbleStyle, secondaryButtonStyle, surfaceBoxStyle } from '../styles';
import type { LeaderboardUiCopy } from '../types';

type LoadState = 'idle' | 'loading' | 'error' | 'ready';

interface SubjectsViewProps {
    ui: LeaderboardUiCopy;
    refreshSignal: number;
}

function studentInitials(name: string): string {
    const normalized = (name || '').trim();
    if (!normalized) return '?';
    const parts = normalized.split(/[\s-]+/).filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export function SubjectsView({ ui, refreshSignal }: SubjectsViewProps) {
    const router = useRouter();
    const { userId } = useAuth();
    const [subjects, setSubjects] = useState<LeaderboardSubject[]>([]);
    const [subjectsState, setSubjectsState] = useState<LoadState>('idle');
    const [search, setSearch] = useState('');
    const [selectedKey, setSelectedKey] = useState<string | null>(null);
    const [board, setBoard] = useState<SubjectLeaderboard | null>(null);
    const [boardState, setBoardState] = useState<LoadState>('idle');
    const [optOut, setOptOut] = useState(false);
    const [savingOptOut, setSavingOptOut] = useState(false);
    const [leaderboardName, setLeaderboardName] = useState('');
    const [draftLeaderboardName, setDraftLeaderboardName] = useState('');
    const [contacts, setContacts] = useState({ telegram: '', instagram: '' });
    const [savingProfile, setSavingProfile] = useState(false);
    const [profileStatus, setProfileStatus] = useState<string | null>(null);

    const loadSubjects = useCallback(async () => {
        setSubjectsState('loading');
        const result = await listLeaderboardSubjects();
        if (!result.success || !result.data) {
            setSubjectsState('error');
            return;
        }
        const list = result.data.subjects;
        setSubjects(list);
        setSubjectsState('ready');
        setSelectedKey((prev) => prev ?? (list[0]?.key ?? null));
    }, []);

    const loadOptOut = useCallback(async () => {
        const result = await getStatus();
        if (result.success && result.data) {
            const settings = result.data.user?.settings;
            setOptOut(settings?.gradesLeaderboardOptOut === true);
            const name = settings?.leaderboardDisplayName ?? '';
            setLeaderboardName(name);
            setDraftLeaderboardName(name);
            setContacts({
                telegram: settings?.leaderboardContacts?.telegram ?? '',
                instagram: settings?.leaderboardContacts?.instagram ?? '',
            });
        }
    }, []);

    const loadBoard = useCallback(async (key: string) => {
        setBoardState('loading');
        const result = await getSubjectLeaderboard(key);
        if (!result.success || !result.data) {
            setBoardState('error');
            return;
        }
        setBoard(result.data);
        setBoardState('ready');
    }, []);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            void loadSubjects();
            void loadOptOut();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadOptOut, loadSubjects]);

    useEffect(() => {
        if (!selectedKey) return;
        const timer = window.setTimeout(() => { void loadBoard(selectedKey); }, 0);
        return () => window.clearTimeout(timer);
    }, [loadBoard, refreshSignal, selectedKey]);

    useEffect(() => {
        if (refreshSignal === 0) return;
        const timer = window.setTimeout(() => {
            void loadSubjects();
            void loadOptOut();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [loadOptOut, loadSubjects, refreshSignal]);

    const visibleSubjects = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return subjects;
        return subjects.filter((subject) => subject.label.toLowerCase().includes(q));
    }, [subjects, search]);

    const handleToggleOptOut = useCallback(async () => {
        if (savingOptOut) return;
        const next = !optOut;
        setOptOut(next);
        setSavingOptOut(true);
        const result = await updateGradesLeaderboardOptOut(next);
        setSavingOptOut(false);
        if (!result.success) {
            setOptOut(!next);
            toast.error(result.error || ui.error);
            return;
        }
        if (selectedKey) void loadBoard(selectedKey);
    }, [loadBoard, optOut, savingOptOut, selectedKey, ui.error]);

    const handleSaveProfile = useCallback(async () => {
        if (savingProfile) return;
        setSavingProfile(true);
        setProfileStatus(null);
        const normalizedName = draftLeaderboardName.trim().replace(/\s+/g, ' ').slice(0, 40);
        const normalizedContacts = {
            telegram: contacts.telegram.trim(),
            instagram: contacts.instagram.trim(),
        };
        const [nameResult, contactsResult] = await Promise.all([
            updateLeaderboardDisplayName(normalizedName),
            updateLeaderboardContacts(normalizedContacts),
        ]);
        if (nameResult.success && contactsResult.success) {
            setLeaderboardName(normalizedName);
            setDraftLeaderboardName(normalizedName);
            setContacts({
                telegram: contactsResult.data?.leaderboardContacts?.telegram ?? normalizedContacts.telegram,
                instagram: contactsResult.data?.leaderboardContacts?.instagram ?? normalizedContacts.instagram,
            });
            setProfileStatus(ui.subjectProfileSaved);
            if (selectedKey) void loadBoard(selectedKey);
        } else {
            setProfileStatus(nameResult.error || contactsResult.error || ui.subjectProfileFailed);
        }
        setSavingProfile(false);
    }, [contacts.instagram, contacts.telegram, draftLeaderboardName, loadBoard, savingProfile, selectedKey, ui.subjectProfileFailed, ui.subjectProfileSaved]);

    const handleMessage = useCallback((targetUserId: string) => {
        if (!userId || !targetUserId || targetUserId === userId) return;
        router.push(`/chat?roomId=${encodeURIComponent(buildDirectRoomId(userId, targetUserId))}`);
    }, [router, userId]);

    return (
        <div className="mt-5 space-y-4">
            <div style={surfaceBoxStyle}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h3 style={{ color: 'var(--text)', fontSize: 20, fontWeight: 800, margin: 0 }}>
                            {ui.subjectsTitle}
                        </h3>
                        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '6px 0 0', maxWidth: 620 }}>
                            {ui.subjectsSubtitle}
                        </p>
                    </div>
                    <ToggleRow
                        checked={!optOut}
                        disabled={savingOptOut}
                        title={ui.subjectOptOutShow}
                        hint={ui.subjectOptOutHint}
                        onToggle={() => void handleToggleOptOut()}
                    />
                </div>

                {subjects.length > 0 ? (
                    <div className="relative mt-4">
                        <Search size={18} strokeWidth={2} aria-hidden style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
                        <input
                            type="search"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={ui.subjectSearchPlaceholder}
                            className="w-full rounded-2xl px-10 py-3 outline-none transition"
                            style={darkInputStyle}
                            autoCorrect="off"
                            autoCapitalize="none"
                            spellCheck={false}
                        />
                        {search.length > 0 ? (
                            <button
                                type="button"
                                onClick={() => setSearch('')}
                                aria-label={ui.subjectSearchClear}
                                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, borderRadius: 10, color: 'var(--muted)' }}
                            >
                                <X size={16} strokeWidth={2} aria-hidden />
                            </button>
                        ) : null}
                    </div>
                ) : null}

                {visibleSubjects.length > 0 ? (
                    <div
                        className="mt-4"
                        role="tablist"
                        aria-label={ui.subjectsTitle}
                        style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                            gap: 8,
                            maxHeight: 260,
                            overflowY: 'auto',
                            paddingRight: 4,
                        }}
                    >
                        {visibleSubjects.map((subject) => {
                            const active = selectedKey === subject.key;
                            return (
                                <button
                                    key={subject.key}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    onClick={() => setSelectedKey(subject.key)}
                                    className="transition"
                                    style={{
                                        width: '100%',
                                        minHeight: 44,
                                        textAlign: 'left',
                                        borderRadius: 14,
                                        border: active ? '1px solid rgba(var(--primary-rgb), 0.45)' : '1px solid var(--border)',
                                        background: active ? 'rgba(var(--primary-rgb), 0.16)' : 'var(--card)',
                                        color: active ? 'var(--primary)' : 'var(--text)',
                                        padding: '9px 11px',
                                        fontSize: 13,
                                        fontWeight: 700,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 8,
                                    }}
                                >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subject.label}</span>
                                    <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>{subject.learners}</span>
                                </button>
                            );
                        })}
                    </div>
                ) : null}
            </div>

            <div style={surfaceBoxStyle}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                        <h3 style={{ color: 'var(--text)', fontSize: 18, fontWeight: 800, margin: 0 }}>
                            {ui.subjectProfileTitle}
                        </h3>
                        <p style={{ color: 'var(--muted)', fontSize: 12, margin: '5px 0 0' }}>
                            {ui.subjectContactsHint}
                        </p>
                    </div>
                    <button
                        type="button"
                        className="btn btn-primary"
                        disabled={savingProfile}
                        onClick={() => void handleSaveProfile()}
                    >
                        {savingProfile ? ui.subjectSavingProfile : ui.subjectSaveProfile}
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                    <label>
                        <span className="text-xs mb-2 block text-muted-fg">{ui.subjectNicknameLabel}</span>
                        <input
                            value={draftLeaderboardName}
                            onChange={(event) => setDraftLeaderboardName(event.target.value)}
                            maxLength={40}
                            placeholder={leaderboardName || ui.subjectNicknameLabel}
                            className="w-full rounded-2xl px-4 py-3 outline-none transition"
                            style={darkInputStyle}
                        />
                    </label>
                    <label>
                        <span className="text-xs mb-2 block text-muted-fg">{ui.subjectTelegramLabel}</span>
                        <input
                            value={contacts.telegram}
                            onChange={(event) => setContacts((current) => ({ ...current, telegram: event.target.value }))}
                            maxLength={80}
                            placeholder="@username"
                            className="w-full rounded-2xl px-4 py-3 outline-none transition"
                            style={darkInputStyle}
                        />
                    </label>
                    <label>
                        <span className="text-xs mb-2 block text-muted-fg">{ui.subjectInstagramLabel}</span>
                        <input
                            value={contacts.instagram}
                            onChange={(event) => setContacts((current) => ({ ...current, instagram: event.target.value }))}
                            maxLength={80}
                            placeholder="@username"
                            className="w-full rounded-2xl px-4 py-3 outline-none transition"
                            style={darkInputStyle}
                        />
                    </label>
                </div>
                {profileStatus ? (
                    <p style={{ color: profileStatus === ui.subjectProfileSaved ? 'var(--good)' : 'var(--danger)', fontSize: 12, margin: '10px 0 0' }}>
                        {profileStatus}
                    </p>
                ) : null}
            </div>

            {subjectsState === 'loading' ? (
                <StateCard title={ui.loading} />
            ) : subjectsState === 'error' ? (
                <StateCard title={ui.subjectErrorTitle} actionLabel={ui.subjectRetry} onAction={loadSubjects} />
            ) : subjects.length === 0 ? (
                <StateCard title={ui.subjectNoSubjects} text={ui.subjectNoSubjectsHint} />
            ) : !selectedKey ? (
                <StateCard title={ui.subjectPickTitle} text={ui.subjectPickHint} />
            ) : boardState === 'loading' ? (
                <StateCard title={ui.loading} />
            ) : boardState === 'error' ? (
                <StateCard title={ui.subjectErrorTitle} actionLabel={ui.subjectRetry} onAction={() => selectedKey ? loadBoard(selectedKey) : undefined} />
            ) : board && board.entries.length === 0 ? (
                <StateCard title={ui.subjectEmptyTitle} text={ui.subjectEmptyHint} />
            ) : board ? (
                <>
                    <div style={surfaceBoxStyle}>
                        <div className="flex items-center gap-3">
                            <div style={rankBubbleStyle}>
                                <Trophy size={17} strokeWidth={2.25} aria-hidden />
                            </div>
                            <div style={{ color: 'var(--text)', fontSize: 14 }}>
                                {ui.subjectYourRank}: <b style={{ color: 'var(--primary)' }}>{board.viewerRank !== null ? `#${board.viewerRank}` : ui.subjectNotRanked}</b>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-2">
                        {board.entries.map((entry) => (
                            <div
                                key={`${entry.rank}-${entry.userId}`}
                                className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3"
                                style={{
                                    border: entry.isCurrentUser ? '1px solid rgba(var(--primary-rgb), 0.36)' : '1px solid var(--border)',
                                    background: entry.isCurrentUser ? 'rgba(var(--primary-rgb), 0.1)' : 'var(--card)',
                                }}
                            >
                                <div className="flex items-center gap-3 min-w-0">
                                    <div style={rankBubbleStyle}>#{entry.rank}</div>
                                    <div
                                        className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
                                        style={{
                                            background: 'rgba(var(--primary-rgb), 0.14)',
                                            color: 'var(--primary)',
                                            fontWeight: 900,
                                            fontSize: 13,
                                            border: '1px solid rgba(var(--primary-rgb), 0.2)',
                                        }}
                                        aria-hidden
                                    >
                                        {studentInitials(entry.displayName)}
                                    </div>
                                    <div className="min-w-0">
                                        <div className="truncate" style={{ color: 'var(--text)', fontWeight: 700 }}>{entry.isCurrentUser ? ui.subjectYou : entry.displayName}</div>
                                        <div style={{ color: entry.isCurrentUser ? 'var(--leaderboard-warm-text)' : 'var(--muted)', fontSize: 11, marginTop: 2 }}>
                                            {entry.isCurrentUser ? ui.you : `${entry.year}-${entry.semester}${entry.letter ? ` · ${entry.letter}` : ''}`}
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: 'var(--primary)', fontSize: 18, fontWeight: 900, lineHeight: 1 }}>{entry.score}</div>
                                        {entry.gpa !== null ? <div style={{ color: 'var(--muted)', fontSize: 11, marginTop: 2 }}>GPA {entry.gpa}</div> : null}
                                    </div>
                                    {!entry.isCurrentUser ? (
                                        <div className="flex items-center gap-2">
                                            <ContactLinks contacts={entry.contacts} />
                                            <button type="button" className="btn btn-secondary" onClick={() => handleMessage(entry.userId)}>
                                                <MessageCircle size={14} strokeWidth={2.2} aria-hidden />
                                                <span className="hidden sm:inline">{ui.subjectMessage}</span>
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        ))}
                    </div>
                </>
            ) : null}
        </div>
    );
}

function ToggleRow({
    checked,
    disabled,
    title,
    hint,
    onToggle,
}: {
    checked: boolean;
    disabled: boolean;
    title: string;
    hint: string;
    onToggle: () => void;
}) {
    return (
        <div
            className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3"
            style={{
                border: '1px solid var(--leaderboard-surface-border)',
                background: 'var(--leaderboard-row-bg)',
                minWidth: 280,
                maxWidth: 390,
            }}
        >
            <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--leaderboard-text)', fontSize: 13, fontWeight: 850, lineHeight: 1.15 }}>{title}</div>
                <div style={{ color: 'var(--leaderboard-muted)', fontSize: 11.5, marginTop: 4, lineHeight: 1.25 }}>{hint}</div>
            </div>
            <button
                type="button"
                role="switch"
                aria-checked={checked}
                aria-label={title}
                disabled={disabled}
                onClick={onToggle}
                className="relative shrink-0 transition disabled:opacity-60"
                style={{
                    width: 46,
                    height: 26,
                    borderRadius: 999,
                    padding: 2,
                    background: checked ? 'rgba(var(--primary-rgb), 0.82)' : 'var(--leaderboard-chip-bg)',
                    border: checked ? '1px solid rgba(var(--primary-rgb), 0.48)' : '1px solid var(--border)',
                    boxShadow: checked ? '0 8px 18px rgba(var(--primary-rgb), 0.18)' : 'none',
                    cursor: disabled ? 'default' : 'pointer',
                }}
            >
                <span
                    aria-hidden
                    className="block rounded-full transition-transform"
                    style={{
                        width: 20,
                        height: 20,
                        background: '#fff',
                        boxShadow: '0 2px 8px rgba(15, 23, 42, 0.24)',
                        transform: checked ? 'translateX(20px)' : 'translateX(0)',
                    }}
                />
            </button>
        </div>
    );
}

function ContactLinks({ contacts }: { contacts: { telegram?: string; instagram?: string } | null }) {
    if (!contacts?.telegram && !contacts?.instagram) return null;
    return (
        <div className="flex items-center gap-1">
            {contacts.telegram ? (
                <a className="btn btn-secondary" href={`https://t.me/${encodeURIComponent(contacts.telegram)}`} target="_blank" rel="noreferrer" aria-label="Telegram">
                    <Send size={14} strokeWidth={2.2} aria-hidden />
                </a>
            ) : null}
            {contacts.instagram ? (
                <a className="btn btn-secondary" href={`https://instagram.com/${encodeURIComponent(contacts.instagram)}`} target="_blank" rel="noreferrer" aria-label="Instagram">
                    <AtSign size={14} strokeWidth={2.2} aria-hidden />
                </a>
            ) : null}
        </div>
    );
}

function StateCard({
    title,
    text,
    actionLabel,
    onAction,
}: {
    title: string;
    text?: string;
    actionLabel?: string;
    onAction?: () => void;
}) {
    return (
        <div className="text-center" style={{ ...surfaceBoxStyle, padding: 28 }}>
            <div style={{ color: 'var(--text)', fontSize: 16, fontWeight: 800 }}>{title}</div>
            {text ? <div style={{ color: 'var(--muted)', fontSize: 13, marginTop: 6 }}>{text}</div> : null}
            {actionLabel && onAction ? (
                <button type="button" className="mt-4 transition" style={secondaryButtonStyle} onClick={() => onAction()}>
                    {actionLabel}
                </button>
            ) : null}
        </div>
    );
}
