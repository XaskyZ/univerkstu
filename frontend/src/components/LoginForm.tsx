'use client';

import Link from 'next/link';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BellRing, KeyRound, QrCode } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useLanguage } from '@/lib/language-context';
import { readStoredLoginMode, resolvePostLoginPath, sanitizeNextPath, storeLoginMode, type LoginMode } from '@/lib/login-challenge';
import { SegmentedControl } from '@/components/SegmentedControl';
import { AuthShell } from '@/components/auth/AuthShell';
import { PasswordLoginForm } from '@/components/auth/PasswordLoginForm';
import { QrLoginPanel } from '@/components/auth/QrLoginPanel';
import { PushLoginPanel } from '@/components/auth/PushLoginPanel';

const subscribeNoop = () => () => {};
const readStoredMode = () => readStoredLoginMode(typeof window === 'undefined' ? null : window.localStorage);
const readServerMode = () => null;

/**
 * Public sign-in screen: Password | QR | Push mode switch (last mode is
 * remembered per browser), plus links to registration and the curator login.
 */
export default function LoginForm() {
    const { completeExternalLogin } = useAuth();
    const { messages } = useLanguage();
    const t = messages.login;
    const router = useRouter();
    const searchParams = useSearchParams();

    // Stored mode is read through useSyncExternalStore so the server render
    // (no storage) and the first client render agree without a setState-in-effect.
    const storedMode = useSyncExternalStore(subscribeNoop, readStoredMode, readServerMode);
    const [chosenMode, setChosenMode] = useState<LoginMode | null>(null);
    const mode: LoginMode = chosenMode ?? storedMode ?? 'password';

    const nextParam = searchParams.get('next');
    const redirectTo = resolvePostLoginPath(nextParam);
    const hasNext = sanitizeNextPath(nextParam) !== null;

    const changeMode = (value: LoginMode) => {
        setChosenMode(value);
        storeLoginMode(typeof window === 'undefined' ? null : window.localStorage, value);
        trackAnalyticsEvent('login_mode_switch', {
            feature: 'auth',
            label: value,
            path: '/login',
        });
    };

    const handleChallengeApproved = useCallback(async (userId: string | null) => {
        if (userId) {
            await completeExternalLogin(userId);
        }
        router.push(redirectTo);
    }, [completeExternalLogin, redirectTo, router]);

    const registerHref = (() => {
        const ref = searchParams.get('ref');
        return ref ? `/register?ref=${encodeURIComponent(ref)}` : '/register';
    })();

    return (
        <AuthShell
            subtitle={t.subtitle}
            cardFooter={(
                <>
                    <div className="mt-6 flex flex-col items-center gap-3">
                        <p className="text-sm text-muted-fg">
                            {t.noAccount}{' '}
                            <Link href={registerHref} className="theme-link font-semibold">
                                {t.registerLink}
                            </Link>
                        </p>
                        <Link
                            href="/curator-login"
                            className="login-secondary-link px-4 py-2 rounded-xl text-sm transition-colors"
                            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
                        >
                            {t.curatorLink}
                        </Link>
                    </div>

                    <p className="mt-6 text-center text-xs text-muted-fg">
                        {t.credentialsHint} <span style={{ color: 'var(--accent)' }}>Platonus (platonus.kstu.kz)</span>
                    </p>
                </>
            )}
        >
            {hasNext ? (
                <p className="mb-4 text-center text-xs text-muted-fg">{t.nextHint}</p>
            ) : null}

            <div className="mb-6 flex justify-center">
                <SegmentedControl<LoginMode>
                    ariaLabel={t.modeSwitchAria}
                    value={mode}
                    onChange={changeMode}
                    options={[
                        {
                            value: 'password',
                            ariaLabel: t.modePassword,
                            label: (
                                <span className="inline-flex items-center gap-1.5 px-1">
                                    <KeyRound className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                                    {t.modePassword}
                                </span>
                            ),
                        },
                        {
                            value: 'qr',
                            ariaLabel: t.modeQr,
                            label: (
                                <span className="inline-flex items-center gap-1.5 px-1">
                                    <QrCode className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                                    {t.modeQr}
                                </span>
                            ),
                        },
                        {
                            value: 'push',
                            ariaLabel: t.modePush,
                            label: (
                                <span className="inline-flex items-center gap-1.5 px-1">
                                    <BellRing className="w-3.5 h-3.5" strokeWidth={2} aria-hidden />
                                    {t.modePush}
                                </span>
                            ),
                        },
                    ]}
                />
            </div>

            {mode === 'password' && <PasswordLoginForm redirectTo={redirectTo} />}
            {mode === 'qr' && <QrLoginPanel onApproved={handleChallengeApproved} />}
            {mode === 'push' && <PushLoginPanel onApproved={handleChallengeApproved} onSwitchMode={changeMode} />}
        </AuthShell>
    );
}
