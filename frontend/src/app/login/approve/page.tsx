'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, Loader2, ShieldCheck, ShieldX } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import {
    AUTH_ERROR_CODES,
    approveLoginChallenge,
    denyLoginChallenge,
    inspectLoginChallenge,
    type LoginChallengeInfo,
} from '@/lib/api';
import type { ApiResponse } from '@/lib/api/core';
import {
    DEFAULT_POST_LOGIN_PATH,
    buildLoginRedirect,
    formatManualCode,
    isCompleteManualCode,
    normalizeManualCode,
    parseApproveParams,
    type LoginChallengeStatus,
} from '@/lib/login-challenge';
import { AuthErrorBanner, AuthShell } from '@/components/auth/AuthShell';
import { LoginSkeleton } from '@/components/ThemeSkeleton';

type Phase = 'input' | 'inspecting' | 'review' | 'approving' | 'denying' | 'approved' | 'denied';

interface ChallengeRef {
    challengeId: string;
    approveSecret: string;
}

/**
 * The manual field accepts the plain 12-char code and, as a convenience, a
 * pasted approve URL (`…/login/approve?c=…&s=…`).
 */
function parseManualInput(raw: string): ChallengeRef | null {
    const trimmed = raw.trim();
    if (/[?&]c=/.test(trimmed) && /[?&]s=/.test(trimmed)) {
        try {
            const url = new URL(trimmed, 'https://univerkstu.app');
            const parsed = parseApproveParams(url.searchParams);
            if (parsed) return parsed;
        } catch {
            // fall through to plain-code handling
        }
    }
    const approveSecret = normalizeManualCode(trimmed);
    if (!isCompleteManualCode(approveSecret)) return null;
    return { challengeId: '', approveSecret };
}

function formatDateTime(iso: string, language: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    const locale = language === 'en' ? 'en-GB' : language === 'kz' ? 'kk-KZ' : 'ru-RU';
    return date.toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function LoginApprovePage() {
    const { isAuth, loading } = useAuth();
    const { messages, language } = useLanguage();
    const t = messages.login;
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const [target, setTarget] = useState<ChallengeRef | null>(() => parseApproveParams(searchParams));
    const [phase, setPhase] = useState<Phase>(() => (parseApproveParams(searchParams) ? 'inspecting' : 'input'));
    const [manualInput, setManualInput] = useState('');
    const [info, setInfo] = useState<LoginChallengeInfo | null>(null);
    const [error, setError] = useState('');

    // Not signed in → bounce through /login and come back here afterwards.
    useEffect(() => {
        if (loading || isAuth) return;
        const query = searchParams.toString();
        router.replace(buildLoginRedirect(`${pathname}${query ? `?${query}` : ''}`));
    }, [isAuth, loading, pathname, router, searchParams]);

    const statusLabel = (status: string | undefined): string => {
        switch (status as LoginChallengeStatus | undefined) {
            case 'pending': return t.statusPending;
            case 'approved': return t.statusApproved;
            case 'consumed': return t.statusConsumed;
            case 'denied': return t.statusDenied;
            case 'expired': return t.statusExpired;
            default: return status || '';
        }
    };

    const describeFailure = (result: ApiResponse<{ status?: string }>): string => {
        switch (result.errorCode) {
            case AUTH_ERROR_CODES.challengeNotFound: return t.approveNotFound;
            case AUTH_ERROR_CODES.challengeForbidden: return t.approveForbidden;
            case AUTH_ERROR_CODES.challengeNotPending:
                return t.approveNotPending.replace('{status}', statusLabel(result.data?.status));
            default: return result.error || t.approveError;
        }
    };

    // Auto-inspect when the page was opened from a QR / push link.
    useEffect(() => {
        if (!isAuth || phase !== 'inspecting' || !target) return;
        let cancelled = false;
        (async () => {
            const result = await inspectLoginChallenge(target.challengeId, target.approveSecret);
            if (cancelled) return;
            if (result.success && result.data) {
                if (result.data.status !== 'pending') {
                    setError(t.approveNotPending.replace('{status}', statusLabel(result.data.status)));
                    setPhase('input');
                    return;
                }
                setInfo(result.data);
                setPhase('review');
            } else {
                setError(describeFailure(result));
                setPhase('input');
            }
        })();
        return () => { cancelled = true; };
        // statusLabel/describeFailure only close over locale strings — re-running on language change is unnecessary.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuth, phase, target]);

    const handleManualSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const parsed = parseManualInput(manualInput);
        if (!parsed) {
            setError(t.approveNotFound);
            return;
        }
        setError('');
        setTarget(parsed);
        setPhase('inspecting');
    };

    const decide = async (decision: 'approve' | 'deny') => {
        if (!target) return;
        setError('');
        setPhase(decision === 'approve' ? 'approving' : 'denying');
        const result = decision === 'approve'
            ? await approveLoginChallenge(target.challengeId, target.approveSecret)
            : await denyLoginChallenge(target.challengeId, target.approveSecret);
        if (result.success) {
            setPhase(decision === 'approve' ? 'approved' : 'denied');
        } else {
            setError(describeFailure(result));
            setPhase(result.errorCode === AUTH_ERROR_CODES.challengeNotPending ? 'input' : 'review');
        }
    };

    const startOver = () => {
        setTarget(null);
        setInfo(null);
        setManualInput('');
        setError('');
        setPhase('input');
    };

    if (loading || !isAuth) {
        return <LoginSkeleton />;
    }

    const busy = phase === 'inspecting' || phase === 'approving' || phase === 'denying';

    return (
        <AuthShell title={t.approveTitle} subtitle={t.approveSubtitle} hideContacts>
            {error && <AuthErrorBanner>{error}</AuthErrorBanner>}

            {phase === 'input' && (
                <form onSubmit={handleManualSubmit} className="space-y-5">
                    <div>
                        <label className="block text-sm font-medium mb-2 text-secondary-fg" htmlFor="approve-code">
                            {t.approveCodeLabel}
                        </label>
                        <input
                            id="approve-code"
                            type="text"
                            value={manualInput}
                            onChange={(e) => {
                                const raw = e.target.value;
                                // Keep pasted URLs intact; format plain codes as XXXX-XXXX-XXXX while typing.
                                setManualInput(/[?&]c=/.test(raw) ? raw : formatManualCode(raw));
                            }}
                            placeholder="XXXX-XXXX-XXXX"
                            className="input text-center text-lg tracking-[0.12em]"
                            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}
                            required
                            autoCapitalize="characters"
                            autoCorrect="off"
                            spellCheck={false}
                            autoComplete="one-time-code"
                            inputMode="text"
                        />
                        <p className="mt-2 text-xs text-muted-fg">{t.approveCodeHint}</p>
                    </div>
                    <button type="submit" className="btn btn-primary w-full py-4 text-base" disabled={!manualInput.trim()}>
                        {t.approveCodeCheck}
                    </button>
                </form>
            )}

            {phase === 'inspecting' && (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-fg" aria-live="polite">
                    <Loader2 className="w-5 h-5 animate-spin" strokeWidth={2} aria-hidden />
                    <span>{t.approveChecking}</span>
                </div>
            )}

            {(phase === 'review' || phase === 'approving' || phase === 'denying') && info && (
                <div className="space-y-5">
                    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--surface-overlay-2)', border: '1px solid var(--border)' }}>
                        <div className="flex items-center gap-2 text-sm font-semibold text-fg">
                            <ShieldCheck className="w-4 h-4" strokeWidth={2} aria-hidden style={{ color: 'var(--primary)' }} />
                            {info.kind === 'push' ? t.approveKindPush : t.approveKindQr}
                        </div>
                        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                            <dt className="text-muted-fg">{t.approveDevice}</dt>
                            <dd className="text-fg font-medium break-words">{info.requesterDeviceName || t.approveUnknownDevice}</dd>
                            <dt className="text-muted-fg">{t.approveIp}</dt>
                            <dd className="text-fg" style={{ fontFamily: 'monospace' }}>{info.requesterIp || '—'}</dd>
                            <dt className="text-muted-fg">{t.approveRequestedAt}</dt>
                            <dd className="text-fg">{formatDateTime(info.createdAt, language)}</dd>
                            <dt className="text-muted-fg">{t.approveExpiresAt}</dt>
                            <dd className="text-fg">{formatDateTime(info.expiresAt, language)}</dd>
                        </dl>
                    </div>

                    <p className="text-xs text-center leading-snug" style={{ color: 'rgb(var(--status-warning-rgb))' }}>
                        {t.approveWarning}
                    </p>

                    <div className="space-y-3">
                        <button
                            type="button"
                            onClick={() => { void decide('approve'); }}
                            disabled={busy}
                            className="btn btn-primary w-full py-4 text-base"
                        >
                            {phase === 'approving' ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="animate-spin h-5 w-5" strokeWidth={2} aria-hidden />
                                    {t.approveConfirming}
                                </span>
                            ) : t.approveConfirm}
                        </button>
                        <button
                            type="button"
                            onClick={() => { void decide('deny'); }}
                            disabled={busy}
                            className="btn w-full py-3.5 text-base font-semibold rounded-2xl"
                            style={{
                                background: 'rgba(var(--status-danger-rgb), 0.08)',
                                border: '1px solid rgba(var(--status-danger-rgb), 0.18)',
                                color: 'var(--danger)',
                            }}
                        >
                            {phase === 'denying' ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="animate-spin h-5 w-5" strokeWidth={2} aria-hidden />
                                    {t.approveDenying}
                                </span>
                            ) : t.approveDeny}
                        </button>
                    </div>
                </div>
            )}

            {(phase === 'approved' || phase === 'denied') && (
                <div className="text-center space-y-5 animate-scaleIn" aria-live="polite">
                    <div
                        className="inline-flex items-center justify-center w-16 h-16 rounded-2xl"
                        style={phase === 'approved'
                            ? { background: 'rgba(var(--status-success-rgb), 0.14)', color: 'rgb(var(--status-success-rgb))' }
                            : { background: 'rgba(var(--status-danger-rgb), 0.12)', color: 'var(--danger)' }}
                    >
                        {phase === 'approved'
                            ? <CheckCircle2 className="w-8 h-8" strokeWidth={2} aria-hidden />
                            : <ShieldX className="w-8 h-8" strokeWidth={2} aria-hidden />}
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-fg">{phase === 'approved' ? t.approveDoneTitle : t.approveDeniedTitle}</h2>
                        <p className="mt-1 text-sm text-muted-fg">{phase === 'approved' ? t.approveDoneBody : t.approveDeniedBody}</p>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                        <button type="button" onClick={startOver} className="btn btn-secondary px-4 py-2 rounded-xl text-sm font-semibold">
                            {t.approveAnother}
                        </button>
                        <Link href={DEFAULT_POST_LOGIN_PATH} className="btn btn-primary px-4 py-2 rounded-xl text-sm font-semibold">
                            {t.approveBackToApp}
                        </Link>
                    </div>
                </div>
            )}
        </AuthShell>
    );
}
