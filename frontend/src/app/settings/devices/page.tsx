'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import {
    getDeviceSessions,
    revokeAllOtherDeviceSessions,
    revokeDeviceSession,
    type DeviceSession,
} from '@/lib/api';
import { PageMain, PageShell, PageStateCard } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';
import { confirmDialog } from '@/lib/confirm-dialog';

function formatRelativeTime(iso: string, copy: ReturnType<typeof useLanguage>['messages']['settings']['devices']): string {
    const diff = Date.now() - new Date(iso).getTime();
    const minutes = Math.floor(diff / 60_000);
    if (minutes < 1) return copy.relativeJustNow;
    if (minutes < 60) return copy.relativeMinutes.replace('{value}', String(minutes));
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return copy.relativeHours.replace('{value}', String(hours));
    const days = Math.floor(hours / 24);
    if (days < 30) return copy.relativeDays.replace('{value}', String(days));
    return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function getPlatformIcon(platform: string | null, browser: string | null): string {
    const p = (platform || '').toLowerCase();
    const b = (browser || '').toLowerCase();
    if (p.includes('iphone') || p.includes('ipad')) return '🍎';
    if (p.includes('android')) return '🤖';
    if (p.includes('windows')) return '🖥️';
    if (p.includes('macos')) return '💻';
    if (p.includes('linux')) return '🐧';
    if (b.includes('safari')) return '🧭';
    if (b.includes('chrome')) return '🌐';
    if (b.includes('firefox')) return '🦊';
    return '📱';
}

function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
    return (
        <svg className={`${className} animate-spin`} fill="none" viewBox="0 0 24 24" aria-hidden>
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
    );
}

export default function SettingsDevicesPage() {
    const { isAuth, loading } = useAuth();
    const { messages } = useLanguage();
    const router = useRouter();
    const copy = messages.settings.devices;

    const [sessions, setSessions] = useState<DeviceSession[]>([]);
    const [loaded, setLoaded] = useState(false);
    const [loadingList, setLoadingList] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revoking, setRevoking] = useState<string | null>(null);
    const [revokeAllDone, setRevokeAllDone] = useState(false);

    const loadSessions = useCallback(async () => {
        setLoadingList(true);
        setError(null);
        try {
            const res = await getDeviceSessions();
            if (res.success && res.data) {
                setSessions(res.data.sessions);
                setLoaded(true);
            } else {
                setError(res.error || copy.loadErrorTitle);
            }
        } catch {
            setError(copy.connectionError);
        }
        setLoadingList(false);
    }, [copy.connectionError, copy.loadErrorTitle]);

    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    useEffect(() => {
        if (!isAuth) return;
        const timer = window.setTimeout(() => {
            void loadSessions();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [isAuth, loadSessions]);

    if (loading || !isAuth) return null;

    const handleRefresh = () => {
        if (loadingList) return;
        void loadSessions();
    };

    const handleRevoke = async (sessionId: string) => {
        const ok = await confirmDialog(copy.revokeConfirm, {
            confirmLabel: copy.revokeSession,
            cancelLabel: messages.common.cancel,
            danger: true,
        });
        if (!ok) return;
        setRevoking(sessionId);
        const res = await revokeDeviceSession(sessionId);
        if (res.success) {
            await loadSessions();
        }
        setRevoking(null);
    };

    const handleRevokeAll = async () => {
        const ok = await confirmDialog(copy.revokeAllConfirm, {
            confirmLabel: copy.revokeAllOther,
            cancelLabel: messages.common.cancel,
            danger: true,
        });
        if (!ok) return;
        setRevoking('all');
        const res = await revokeAllOtherDeviceSessions();
        if (res.success) {
            setRevokeAllDone(true);
            setTimeout(() => setRevokeAllDone(false), 3000);
            await loadSessions();
        }
        setRevoking(null);
    };

    const currentSession = sessions.find((s) => s.isCurrent) || null;
    const otherSessions = sessions.filter((s) => !s.isCurrent);
    const otherCount = otherSessions.length;
    const isEmpty = loaded && !loadingList && !error && sessions.length === 0;

    return (
        <PageShell>
            <SubScreenHeader title={copy.screenTitle} subtitle={copy.screenSubtitle} />
            <PageMain className="space-y-4" spacing="lg">
                <div className="flex items-center justify-end">
                    <button
                        type="button"
                        onClick={handleRefresh}
                        disabled={loadingList}
                        aria-label={copy.refresh}
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
                        {loadingList ? (
                            <Spinner />
                        ) : (
                            <RefreshCw className="w-4 h-4" strokeWidth={2} aria-hidden />
                        )}
                        <span>{copy.refresh}</span>
                    </button>
                </div>

                {loadingList && !loaded && (
                    <section className="card p-6">
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                color: 'var(--muted)',
                                fontSize: '14px',
                            }}
                        >
                            <Spinner />
                            <span>{copy.loading}</span>
                        </div>
                    </section>
                )}

                {error && (
                    <section
                        className="card p-4"
                        style={{
                            background: 'rgba(var(--status-danger-rgb), 0.08)',
                            borderColor: 'rgba(var(--status-danger-rgb), 0.25)',
                        }}
                    >
                        <p style={{ color: 'var(--danger)', fontWeight: 600, fontSize: '14px', marginBottom: '4px' }}>
                            {copy.loadErrorTitle}
                        </p>
                        <p style={{ color: 'var(--danger)', opacity: 0.8, fontSize: '13px' }}>{error}</p>
                        <button
                            type="button"
                            onClick={handleRefresh}
                            className="btn"
                            style={{
                                marginTop: '12px',
                                background: 'rgba(var(--status-danger-rgb), 0.12)',
                                color: 'var(--danger)',
                                padding: '8px 14px',
                                borderRadius: '12px',
                                fontSize: '13px',
                                fontWeight: 600,
                            }}
                        >
                            {copy.retry}
                        </button>
                    </section>
                )}

                {isEmpty && <PageStateCard message={copy.noSessions} />}

                {currentSession && (
                    <section className="space-y-2">
                        <h2
                            style={{
                                fontSize: '13px',
                                fontWeight: 700,
                                color: 'var(--muted)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                padding: '0 4px',
                            }}
                        >
                            {copy.currentSection}
                        </h2>
                        <DeviceCard
                            session={currentSession}
                            isCurrent
                            currentLabel={copy.currentSessionLabel}
                            unknownLabel={copy.unknownDevice}
                            relative={formatRelativeTime(currentSession.lastActiveAt, copy)}
                        />
                    </section>
                )}

                {otherCount > 0 && (
                    <section className="space-y-2">
                        <h2
                            style={{
                                fontSize: '13px',
                                fontWeight: 700,
                                color: 'var(--muted)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.04em',
                                padding: '0 4px',
                            }}
                        >
                            {copy.otherDevicesSection.replace('{count}', String(otherCount))}
                        </h2>
                        {otherSessions.map((session) => (
                            <DeviceCard
                                key={session.sessionId}
                                session={session}
                                isCurrent={false}
                                unknownLabel={copy.unknownDevice}
                                relative={formatRelativeTime(session.lastActiveAt, copy)}
                                onRevoke={() => void handleRevoke(session.sessionId)}
                                revoking={revoking === session.sessionId}
                                revokeDisabled={revoking !== null}
                                revokeAriaLabel={copy.revokeSession}
                            />
                        ))}
                    </section>
                )}

                {otherCount > 0 && (
                    <button
                        type="button"
                        onClick={() => void handleRevokeAll()}
                        disabled={revoking !== null}
                        className="btn"
                        style={{
                            width: '100%',
                            background: 'rgba(var(--status-danger-rgb), 0.08)',
                            border: '1px solid rgba(var(--status-danger-rgb), 0.18)',
                            color: 'var(--danger)',
                            padding: '14px 16px',
                            borderRadius: '16px',
                            fontSize: '14px',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                        }}
                    >
                        {revoking === 'all' ? (
                            <>
                                <Spinner />
                                <span>{copy.revokingAll}</span>
                            </>
                        ) : revokeAllDone ? (
                            <span>{copy.allRevoked}</span>
                        ) : (
                            <>
                                <LogOut className="w-4 h-4" strokeWidth={2} aria-hidden />
                                <span>{copy.revokeAllOther}</span>
                            </>
                        )}
                    </button>
                )}
            </PageMain>
        </PageShell>
    );
}

interface DeviceCardProps {
    session: DeviceSession;
    isCurrent: boolean;
    currentLabel?: string;
    unknownLabel: string;
    relative: string;
    onRevoke?: () => void;
    revoking?: boolean;
    revokeDisabled?: boolean;
    revokeAriaLabel?: string;
}

function DeviceCard({
    session,
    isCurrent,
    currentLabel,
    unknownLabel,
    relative,
    onRevoke,
    revoking,
    revokeDisabled,
    revokeAriaLabel,
}: DeviceCardProps) {
    return (
        <div
            className="card"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px',
                background: isCurrent ? 'rgba(var(--accent-rgb,99,102,241),0.06)' : 'var(--card)',
                borderColor: isCurrent ? 'rgba(var(--accent-rgb,99,102,241),0.25)' : 'var(--border)',
            }}
        >
            <div
                aria-hidden
                style={{
                    width: 40,
                    height: 40,
                    borderRadius: 14,
                    background: isCurrent
                        ? 'rgba(var(--accent-rgb,99,102,241),0.14)'
                        : 'var(--surface-overlay-2)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 20,
                    flexShrink: 0,
                    userSelect: 'none',
                }}
            >
                {getPlatformIcon(session.platform, session.browser)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                        {session.deviceName || unknownLabel}
                    </span>
                    {session.browser && (
                        <span style={{ fontSize: '12px', color: 'var(--muted)' }}>
                            · {session.browser}
                        </span>
                    )}
                </div>
                <div
                    style={{
                        marginTop: '4px',
                        fontSize: '12px',
                        color: 'var(--muted)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        flexWrap: 'wrap',
                    }}
                >
                    {isCurrent && currentLabel && (
                        <>
                            <span className="chip" data-tone="success" data-size="sm">
                                {currentLabel}
                            </span>
                            <span aria-hidden>·</span>
                        </>
                    )}
                    <span>{relative}</span>
                    {session.ip && (
                        <>
                            <span aria-hidden>·</span>
                            <span style={{ fontFamily: 'monospace', opacity: 0.8 }}>{session.ip}</span>
                        </>
                    )}
                </div>
            </div>
            {!isCurrent && onRevoke && (
                <button
                    type="button"
                    onClick={onRevoke}
                    disabled={revokeDisabled}
                    aria-label={revokeAriaLabel}
                    style={{
                        flexShrink: 0,
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        background: 'rgba(var(--status-danger-rgb), 0.1)',
                        color: 'var(--danger)',
                        border: '1px solid rgba(var(--status-danger-rgb), 0.18)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: revokeDisabled ? 'not-allowed' : 'pointer',
                        opacity: revokeDisabled ? 0.5 : 1,
                    }}
                >
                    {revoking ? <Spinner className="w-3.5 h-3.5" /> : <X className="w-4 h-4" strokeWidth={2.5} aria-hidden />}
                </button>
            )}
        </div>
    );
}
