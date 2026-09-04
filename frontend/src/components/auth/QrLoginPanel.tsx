'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { createLoginChallenge } from '@/lib/api';
import { useLanguage } from '@/lib/language-context';
import { ChallengeOutcome } from './ChallengeOutcome';
import { useLoginChallenge } from './useLoginChallenge';

interface QrLoginPanelProps {
    onApproved: (userId: string | null) => void | Promise<void>;
}

interface QrView {
    dataUrl: string;
    manualCode: string;
}

const QR_SIZE = 240;

async function renderQrDataUrl(qrUrl: string): Promise<string> {
    const QRCode = await import('qrcode');
    return QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'M', margin: 1, width: QR_SIZE });
}

/**
 * QR sign-in: creates a challenge on mount, renders the QR + manual code,
 * counts down and polls until the other device approves (or the code dies).
 */
export function QrLoginPanel({ onApproved }: QrLoginPanelProps) {
    const { messages } = useLanguage();
    const t = messages.login;
    const [qr, setQr] = useState<QrView | null>(null);
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState('');
    const challenge = useLoginChallenge({ kind: 'qr', onApproved });
    const { adopt, reset } = challenge;
    // Keep `create` stable across language switches so the mount effect does not re-issue a challenge.
    const fallbackErrorRef = useRef(t.challengeCreateError);
    fallbackErrorRef.current = t.challengeCreateError;

    const create = useCallback(async () => {
        setCreating(true);
        setCreateError('');
        reset();
        try {
            const result = await createLoginChallenge();
            if (!result.success || !result.data) {
                setQr(null);
                setCreateError(result.error || fallbackErrorRef.current);
                return;
            }
            const dataUrl = await renderQrDataUrl(result.data.qrUrl);
            setQr({ dataUrl, manualCode: result.data.manualCode });
            adopt({
                challengeId: result.data.challengeId,
                pollSecret: result.data.pollSecret,
                expiresAt: result.data.expiresAt,
            });
        } catch {
            setQr(null);
            setCreateError(fallbackErrorRef.current);
        } finally {
            setCreating(false);
        }
    }, [adopt, reset]);

    useEffect(() => {
        const timer = window.setTimeout(() => { void create(); }, 0);
        return () => window.clearTimeout(timer);
    }, [create]);

    const dimmed = challenge.phase === 'expired' || challenge.phase === 'denied' || challenge.phase === 'consumed' || challenge.phase === 'error';

    return (
        <div className="space-y-5">
            <p className="text-sm text-center text-muted-fg leading-snug">{t.qrInstruction}</p>

            <div className="flex flex-col items-center gap-4">
                <div
                    className="rounded-2xl p-3 flex items-center justify-center"
                    style={{
                        background: '#fff',
                        border: '1px solid var(--border)',
                        width: QR_SIZE + 24,
                        height: QR_SIZE + 24,
                        maxWidth: '100%',
                        opacity: dimmed ? 0.3 : 1,
                        transition: 'opacity 0.2s ease',
                    }}
                >
                    {qr ? (
                        // eslint-disable-next-line @next/next/no-img-element -- data: URL rendered client-side; next/image adds nothing here
                        <img src={qr.dataUrl} alt={t.qrAlt} width={QR_SIZE} height={QR_SIZE} style={{ maxWidth: '100%', height: 'auto' }} />
                    ) : (
                        <div className="flex flex-col items-center gap-2 text-xs" style={{ color: '#64748b' }}>
                            <Loader2 className="w-6 h-6 animate-spin" strokeWidth={2} aria-hidden />
                            {creating ? <span>{t.qrLoading}</span> : null}
                        </div>
                    )}
                </div>

                {qr ? (
                    <div className="text-center">
                        <div className="text-[11px] uppercase tracking-[0.14em] text-muted-fg">{t.qrManualCodeLabel}</div>
                        <div
                            className="mt-1 text-2xl font-bold tabular-nums select-all"
                            style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', letterSpacing: '0.12em', color: 'var(--text)' }}
                            aria-label={t.qrManualCodeLabel}
                        >
                            {qr.manualCode}
                        </div>
                    </div>
                ) : null}
            </div>

            {createError ? (
                <ChallengeOutcome
                    phase="error"
                    secondsLeft={0}
                    error={createError}
                    retryLabel={t.qrRefresh}
                    onRetry={() => { void create(); }}
                    retryDisabled={creating}
                />
            ) : (
                <ChallengeOutcome
                    phase={challenge.phase}
                    secondsLeft={challenge.secondsLeft}
                    error={challenge.error}
                    retryLabel={t.qrRefresh}
                    onRetry={() => { void create(); }}
                    retryDisabled={creating}
                />
            )}
        </div>
    );
}
