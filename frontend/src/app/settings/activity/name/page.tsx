'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { getStatus, updateLeaderboardDisplayName } from '@/lib/api';
import { PageMain, PageShell } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';

const MAX_LEN = 40;

/**
 * Leaderboard nickname editor. Replaces the inline nickname form that used to
 * live inside ActiveLeaderboardPanel/StudentsView. Loads the current value
 * from /api/v3/status, then PATCHes /api/v3/status/settings via
 * updateLeaderboardDisplayName. Empty string = masked display name.
 */
export default function LeaderboardNamePage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const ui = messages.settings.leaderboard;

    const [initialLoading, setInitialLoading] = useState(true);
    const [savedNickname, setSavedNickname] = useState('');
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [status, setStatus] = useState<{ message: string; ok: boolean } | null>(null);
    const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    useEffect(() => {
        if (!isAuth) return;
        let cancelled = false;
        (async () => {
            const result = await getStatus();
            if (cancelled) return;
            if (result.success && result.data) {
                const current = result.data.user.settings?.leaderboardDisplayName ?? '';
                setSavedNickname(current);
                setDraft(current);
            }
            setInitialLoading(false);
        })();
        return () => { cancelled = true; };
    }, [isAuth]);

    useEffect(() => {
        return () => {
            if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        };
    }, []);

    if (loading || !isAuth) return null;

    const normalized = draft.trim().replace(/\s+/g, ' ').slice(0, MAX_LEN);
    const unchanged = normalized === savedNickname;
    const tooLong = draft.length > MAX_LEN;

    const handleSave = async () => {
        if (saving || unchanged) return;
        setSaving(true);
        setStatus(null);
        const result = await updateLeaderboardDisplayName(normalized);
        if (result.success) {
            setSavedNickname(normalized);
            setDraft(normalized);
            setStatus({ message: ui.nicknameSaved, ok: true });
        } else {
            setStatus({ message: result.error || ui.nicknameFailed, ok: false });
        }
        setSaving(false);
        if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
        statusTimerRef.current = setTimeout(() => setStatus(null), 2400);
    };

    return (
        <PageShell>
            <SubScreenHeader
                title={ui.nameScreenTitle}
                subtitle={ui.nameScreenSubtitle}
            />
            <PageMain className="space-y-4" spacing="lg">
                <section className="card p-5 sm:p-6">
                    {initialLoading ? (
                        <p style={{ color: 'var(--muted)', fontSize: '14px', margin: 0 }}>
                            {ui.nameLoading}
                        </p>
                    ) : (
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                void handleSave();
                            }}
                            className="space-y-4"
                        >
                            <p
                                style={{
                                    margin: 0,
                                    color: 'var(--text-secondary)',
                                    fontSize: '14px',
                                    lineHeight: 1.5,
                                }}
                            >
                                {ui.nicknameDesc}
                            </p>

                            <label className="block">
                                <span
                                    className="block mb-2 text-xs font-medium"
                                    style={{ color: 'var(--muted)' }}
                                >
                                    {ui.nicknameLabel}
                                </span>
                                <input
                                    type="text"
                                    className="input"
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    placeholder={ui.nicknamePlaceholder}
                                    maxLength={MAX_LEN}
                                    aria-invalid={tooLong || undefined}
                                    autoComplete="off"
                                    spellCheck={false}
                                />
                            </label>

                            <div className="flex items-center justify-between gap-3 flex-wrap">
                                <span
                                    style={{
                                        color: 'var(--muted)',
                                        fontSize: '12px',
                                        margin: 0,
                                    }}
                                >
                                    {ui.nicknameHint}
                                </span>
                                <span
                                    style={{
                                        color: 'var(--muted)',
                                        fontSize: '12px',
                                        fontVariantNumeric: 'tabular-nums',
                                    }}
                                >
                                    {normalized.length}/{MAX_LEN}
                                </span>
                            </div>

                            <button
                                type="submit"
                                className="btn btn-primary w-full"
                                disabled={saving || unchanged}
                            >
                                {saving ? ui.nicknameSaving : ui.nicknameSave}
                            </button>

                            {status ? (
                                <p
                                    role="status"
                                    aria-live="polite"
                                    style={{
                                        margin: 0,
                                        textAlign: 'center',
                                        fontSize: '13px',
                                        color: status.ok ? 'var(--good)' : 'var(--danger)',
                                    }}
                                >
                                    {status.message}
                                </p>
                            ) : null}
                        </form>
                    )}
                </section>
            </PageMain>
        </PageShell>
    );
}
