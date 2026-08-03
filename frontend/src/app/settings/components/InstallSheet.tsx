'use client';

import { useState } from 'react';
import { Apple, Smartphone, CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { useInstallPrompt } from '@/lib/use-install-prompt';

/**
 * Body of the install bottom-sheet. Lives inside the generic
 * SettingsBottomSheet shell rendered by /settings/page.tsx. Combines
 * iOS-Safari instructions, Android/Chrome instructions, and a native install
 * button driven by the useInstallPrompt hook.
 */
export function InstallSheet() {
    const { messages } = useLanguage();
    const ui = messages.settings.install;
    const { status, available, isIos, isStandalone, prompt } = useInstallPrompt();
    const [busy, setBusy] = useState(false);

    const handleInstall = async () => {
        if (busy || !available) return;
        setBusy(true);
        try {
            await prompt();
        } finally {
            setBusy(false);
        }
    };

    const installed = isStandalone || status === 'installed';

    return (
        <div className="px-5 pb-6 pt-1 space-y-5">
            {/* iOS Safari steps */}
            <section
                className="rounded-2xl p-4"
                style={{
                    background: 'var(--surface-overlay-2)',
                    border: '1px solid var(--border)',
                }}
            >
                <div className="flex items-center gap-2 mb-3">
                    <span
                        aria-hidden
                        className="inline-flex items-center justify-center rounded-lg"
                        style={{
                            width: 28,
                            height: 28,
                            background: 'rgba(var(--primary-rgb), 0.16)',
                            color: 'var(--primary)',
                        }}
                    >
                        <Apple className="w-4 h-4" strokeWidth={2.2} />
                    </span>
                    <h3
                        className="text-sm font-semibold"
                        style={{ color: 'var(--text)' }}
                    >
                        {ui.howIos}
                    </h3>
                </div>
                <ol
                    className="space-y-2 list-none m-0 p-0"
                    style={{ color: 'var(--text-secondary)', fontSize: '13px' }}
                >
                    <StepItem index={1}>{ui.iosStep1}</StepItem>
                    <StepItem index={2}>{ui.iosStep2}</StepItem>
                    <StepItem index={3}>{ui.iosStep3}</StepItem>
                </ol>
                {isIos ? (
                    <p
                        className="mt-3 text-xs"
                        style={{ color: 'var(--muted)', margin: '12px 0 0' }}
                    >
                        {ui.notificationHint}
                    </p>
                ) : null}
            </section>

            {/* Android/Chrome */}
            <section
                className="rounded-2xl p-4"
                style={{
                    background: 'var(--surface-overlay-2)',
                    border: '1px solid var(--border)',
                }}
            >
                <div className="flex items-center gap-2 mb-2">
                    <span
                        aria-hidden
                        className="inline-flex items-center justify-center rounded-lg"
                        style={{
                            width: 28,
                            height: 28,
                            background: 'rgba(var(--good-rgb), 0.16)',
                            color: 'var(--good)',
                        }}
                    >
                        <Smartphone className="w-4 h-4" strokeWidth={2.2} />
                    </span>
                    <h3
                        className="text-sm font-semibold"
                        style={{ color: 'var(--text)' }}
                    >
                        {ui.androidTitle}
                    </h3>
                </div>
                <p
                    className="text-sm"
                    style={{ color: 'var(--text-secondary)', margin: '0 0 8px' }}
                >
                    {ui.androidDesc}
                </p>
                <p
                    className="text-xs"
                    style={{ color: 'var(--muted)', margin: 0 }}
                >
                    {ui.browserHint}
                </p>
            </section>

            {/* CTA */}
            {installed ? (
                <div
                    role="status"
                    className="flex items-center justify-center gap-2 rounded-2xl px-4 py-3"
                    style={{
                        background: 'var(--status-success-bg)',
                        color: 'var(--status-success-color)',
                        border: '1px solid var(--status-success-border)',
                    }}
                >
                    <CheckCircle2 className="w-4 h-4" strokeWidth={2.4} aria-hidden />
                    <span className="text-sm font-medium">{ui.already}</span>
                </div>
            ) : available ? (
                <button
                    type="button"
                    onClick={() => void handleInstall()}
                    disabled={busy}
                    className="btn btn-primary w-full"
                >
                    {busy ? ui.checking : ui.installNow}
                </button>
            ) : (
                <p
                    className="text-center text-xs"
                    style={{ color: 'var(--muted)', margin: 0 }}
                >
                    {isIos ? ui.ios : ui.unavailable}
                </p>
            )}
        </div>
    );
}

interface StepItemProps {
    index: number;
    children: React.ReactNode;
}

function StepItem({ index, children }: StepItemProps) {
    return (
        <li className="flex items-start gap-3">
            <span
                aria-hidden
                className="inline-flex items-center justify-center rounded-full flex-shrink-0 text-xs font-bold"
                style={{
                    width: 22,
                    height: 22,
                    background: 'rgba(var(--primary-rgb), 0.18)',
                    color: 'var(--primary)',
                    marginTop: 1,
                }}
            >
                {index}
            </span>
            <span style={{ lineHeight: 1.5 }}>{children}</span>
        </li>
    );
}
