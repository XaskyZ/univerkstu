'use client';

import { useState } from 'react';
import { BellRing, Loader2 } from 'lucide-react';
import { createPushLoginChallenge } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { ChallengeOutcome } from './ChallengeOutcome';
import { normalizePlatonusLogin } from './AuthShell';
import { useLoginChallenge } from './useLoginChallenge';
import { formatCountdown, type LoginMode } from '@/lib/login-challenge';

interface PushLoginPanelProps {
    onApproved: (userId: string | null) => void | Promise<void>;
    onSwitchMode: (mode: LoginMode) => void;
}

type DeliveryState = 'idle' | 'sending' | 'sent' | 'not_delivered';

/**
 * Push sign-in: asks for the Platonus login, sends a push to the user's
 * subscribed devices and waits for one of them to approve.
 */
export function PushLoginPanel({ onApproved, onSwitchMode }: PushLoginPanelProps) {
    const { messages } = useLanguage();
    const t = messages.login;
    const [username, setUsername] = useState('');
    const [delivery, setDelivery] = useState<DeliveryState>('idle');
    const [sendError, setSendError] = useState('');
    const challenge = useLoginChallenge({ kind: 'push', onApproved });
    const { adopt, reset } = challenge;

    const send = async () => {
        const login = normalizePlatonusLogin(username);
        if (!login) return;
        setUsername(login);
        setSendError('');
        setDelivery('sending');
        reset();

        const result = await createPushLoginChallenge(login);
        if (!result.success || !result.data) {
            setDelivery('idle');
            setSendError(result.error || t.challengeCreateError);
            return;
        }
        const { delivered, challengeId, pollSecret, expiresAt } = result.data;
        if (!delivered || !challengeId || !pollSecret || !expiresAt) {
            setDelivery('not_delivered');
            return;
        }
        setDelivery('sent');
        adopt({ challengeId, pollSecret, expiresAt });
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        void send();
    };

    const busy = delivery === 'sending' || challenge.phase === 'approved';
    const showForm = delivery === 'idle' || delivery === 'sending';

    return (
        <div className="space-y-5">
            {showForm ? (
                <form onSubmit={handleSubmit} className="space-y-5">
                    <p className="text-sm text-center text-muted-fg leading-snug">{t.pushInstruction}</p>
                    {sendError ? (
                        <p className="text-sm text-center" style={{ color: 'var(--danger)' }} role="alert">{sendError}</p>
                    ) : null}
                    <div>
                        <label className="block text-sm font-medium mb-2 text-secondary-fg" htmlFor="push-login-username">
                            {t.pushLoginLabel}
                        </label>
                        <input
                            id="push-login-username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            onBlur={() => setUsername((current) => normalizePlatonusLogin(current))}
                            placeholder="ivanov.ivan"
                            className="input"
                            required
                            disabled={busy}
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            autoComplete="username"
                        />
                    </div>
                    <button type="submit" disabled={busy || !username.trim()} className="btn btn-primary w-full py-4 text-base">
                        {delivery === 'sending' ? (
                            <span className="flex items-center justify-center gap-2">
                                <Loader2 className="animate-spin h-5 w-5" strokeWidth={2} aria-hidden />
                                {t.pushSending}
                            </span>
                        ) : (
                            <span className="flex items-center justify-center gap-2">
                                <BellRing className="h-5 w-5" strokeWidth={2} aria-hidden />
                                {t.pushSend}
                            </span>
                        )}
                    </button>
                </form>
            ) : null}

            {delivery === 'not_delivered' ? (
                <div className="space-y-4 text-center">
                    <div className="p-4 rounded-xl" style={{ background: 'var(--status-info-bg)', border: '1px solid var(--status-info-border)' }}>
                        <div className="text-sm font-semibold" style={{ color: 'var(--status-info-color)' }}>{t.pushNotDelivered}</div>
                        <div className="mt-1 text-xs text-muted-fg">{t.pushNotDeliveredHint}</div>
                    </div>
                    <div className="flex flex-wrap justify-center gap-2">
                        <button type="button" onClick={() => onSwitchMode('qr')} className="btn btn-primary px-4 py-2 rounded-xl text-sm font-semibold">
                            {t.pushUseQr}
                        </button>
                        <button type="button" onClick={() => onSwitchMode('password')} className="btn btn-secondary px-4 py-2 rounded-xl text-sm font-semibold">
                            {t.pushUsePassword}
                        </button>
                        <button type="button" onClick={() => setDelivery('idle')} className="btn btn-ghost px-4 py-2 rounded-xl text-sm font-semibold">
                            {t.pushRetry}
                        </button>
                    </div>
                </div>
            ) : null}

            {delivery === 'sent' ? (
                <div className="space-y-4">
                    <div className="text-center">
                        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-3"
                            style={{ background: 'rgba(var(--primary-rgb), 0.12)', color: 'var(--primary)' }}>
                            <BellRing className="w-7 h-7" strokeWidth={2} aria-hidden />
                        </div>
                        <div className="text-base font-semibold text-fg">{t.pushSent}</div>
                        <div className="mt-1 text-xs text-muted-fg">{t.pushSentHint}</div>
                    </div>
                    <ChallengeOutcome
                        phase={challenge.phase}
                        secondsLeft={challenge.secondsLeft}
                        error={challenge.error}
                        retryLabel={t.pushRetry}
                        onRetry={() => { void send(); }}
                        pendingLabel={`${t.challengeWaiting} · ${formatCountdown(challenge.secondsLeft)}`}
                    />
                </div>
            ) : null}
        </div>
    );
}
