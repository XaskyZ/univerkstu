'use client';

import type { ReactNode } from 'react';
import { CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { formatCountdown } from '@/lib/login-challenge';
import type { LoginChallengePhase } from './useLoginChallenge';

interface ChallengeOutcomeProps {
    phase: LoginChallengePhase;
    secondsLeft: number;
    error?: string;
    /** Label + handler for the "start over" button shown on terminal states. */
    retryLabel: string;
    onRetry: () => void;
    retryDisabled?: boolean;
    /** Text shown while pending (defaults to the countdown line). */
    pendingLabel?: ReactNode;
}

/**
 * Status line under a QR code / push request: countdown while pending, then
 * the outcome (approved / denied / expired / consumed / error) with a retry.
 */
export function ChallengeOutcome({ phase, secondsLeft, error, retryLabel, onRetry, retryDisabled, pendingLabel }: ChallengeOutcomeProps) {
    const { messages } = useLanguage();
    const t = messages.login;

    if (phase === 'idle') return null;

    if (phase === 'pending') {
        return (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-fg" aria-live="polite">
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden />
                <span>{pendingLabel ?? t.qrExpiresIn.replace('{time}', formatCountdown(secondsLeft))}</span>
            </div>
        );
    }

    if (phase === 'approved') {
        return (
            <div className="flex items-center justify-center gap-2 text-sm font-medium" style={{ color: 'var(--status-success-color, var(--good, #22c55e))' }} aria-live="polite">
                <CheckCircle2 className="w-4 h-4" strokeWidth={2} aria-hidden />
                <span>{t.challengeApproved}</span>
            </div>
        );
    }

    const message = phase === 'denied'
        ? t.challengeDenied
        : phase === 'expired'
            ? t.qrExpired
            : phase === 'consumed'
                ? t.challengeConsumed
                : (error || t.challengeCreateError);

    return (
        <div className="space-y-3 text-center" aria-live="polite">
            <p className="text-sm" style={{ color: phase === 'expired' ? 'var(--muted)' : 'var(--danger)' }}>{message}</p>
            <button
                type="button"
                onClick={onRetry}
                disabled={retryDisabled}
                className="btn btn-secondary inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
            >
                <RefreshCw className="w-4 h-4" strokeWidth={2} aria-hidden />
                {retryLabel}
            </button>
        </div>
    );
}
