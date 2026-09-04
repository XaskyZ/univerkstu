'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getUserId, pollLoginChallenge, type LoginChallengeKind } from '@/lib/api';
import {
    LOGIN_CHALLENGE_POLL_INTERVAL_MS,
    isTerminalChallengeStatus,
    secondsUntil,
    type LoginChallengeStatus,
} from '@/lib/login-challenge';

export interface ActiveLoginChallenge {
    challengeId: string;
    pollSecret: string;
    expiresAt: string;
}

/** `idle` = nothing started; `error` = poll failed for good (e.g. challenge vanished). */
export type LoginChallengePhase = 'idle' | LoginChallengeStatus | 'error';

interface UseLoginChallengeOptions {
    kind: LoginChallengeKind;
    /** Called once, when the server hands us the token for an approved challenge. */
    onApproved: (userId: string | null) => void | Promise<void>;
}

/**
 * Drives one QR/push login challenge on the requesting device: countdown to
 * `expiresAt`, 2s status polling while pending, and terminal-state handling
 * (approved / denied / expired / consumed). Polling stops on any terminal
 * state and on unmount.
 */
export function useLoginChallenge({ kind, onApproved }: UseLoginChallengeOptions) {
    const [active, setActive] = useState<ActiveLoginChallenge | null>(null);
    const [phase, setPhase] = useState<LoginChallengePhase>('idle');
    const [error, setError] = useState('');
    const [secondsLeft, setSecondsLeft] = useState(0);
    const onApprovedRef = useRef(onApproved);
    onApprovedRef.current = onApproved;

    const adopt = useCallback((challenge: ActiveLoginChallenge) => {
        setActive(challenge);
        setError('');
        setSecondsLeft(secondsUntil(challenge.expiresAt));
        setPhase('pending');
    }, []);

    const reset = useCallback(() => {
        setActive(null);
        setError('');
        setSecondsLeft(0);
        setPhase('idle');
    }, []);

    // Countdown — marks the challenge expired locally when the clock runs out
    // so the UI does not wait for the next poll.
    useEffect(() => {
        if (phase !== 'pending' || !active) return;
        const id = window.setInterval(() => {
            const left = secondsUntil(active.expiresAt);
            setSecondsLeft(left);
            if (left <= 0) {
                setPhase('expired');
            }
        }, 1000);
        return () => window.clearInterval(id);
    }, [phase, active]);

    // Status polling.
    useEffect(() => {
        if (phase !== 'pending' || !active) return;
        let cancelled = false;
        let inFlight = false;

        const tick = async () => {
            if (inFlight || cancelled) return;
            inFlight = true;
            try {
                const result = await pollLoginChallenge(active.challengeId, active.pollSecret, kind);
                if (cancelled) return;

                if (!result.success) {
                    // Transient network failures keep polling; a 404 means the
                    // challenge is gone (cleaned up / bad pair) — stop for good.
                    if (result.statusCode && result.statusCode >= 400) {
                        setError(result.error || '');
                        setPhase('error');
                    }
                    return;
                }

                const status = result.status;
                if (status === 'approved') {
                    setPhase('approved');
                    await onApprovedRef.current(result.user?.userId ?? getUserId());
                    return;
                }
                if (isTerminalChallengeStatus(status)) {
                    setPhase(status as LoginChallengeStatus);
                }
            } finally {
                inFlight = false;
            }
        };

        const id = window.setInterval(() => { void tick(); }, LOGIN_CHALLENGE_POLL_INTERVAL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(id);
        };
    }, [phase, active, kind]);

    return { phase, error, secondsLeft, active, adopt, reset };
}
