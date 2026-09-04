'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AUTH_ERROR_CODES } from '@/lib/api';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useLanguage } from '@/lib/language-context';
import { DEFAULT_POST_LOGIN_PATH } from '@/lib/login-challenge';
import {
    AuthErrorBanner,
    AuthShell,
    PasswordInput,
    ReferralNotice,
    normalizePlatonusLogin,
    reportReferralOutcome,
    usePendingReferralCode,
} from '@/components/auth/AuthShell';

/**
 * First-time registration: verifies the Platonus login/password and creates
 * the UniverKstu account. Shares the referral handling with the login form.
 */
export default function RegisterForm() {
    const { register } = useAuth();
    const { messages } = useLanguage();
    const t = messages.login;
    const router = useRouter();
    const [login, setLogin] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [alreadyRegistered, setAlreadyRegistered] = useState(false);
    const [loading, setLoading] = useState(false);
    const pendingReferralCode = usePendingReferralCode();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setAlreadyRegistered(false);
        setLoading(true);
        trackAnalyticsEvent('cta_click', {
            feature: 'auth',
            label: 'register_submit_button',
            path: '/register',
        });

        const normalizedLogin = normalizePlatonusLogin(login);
        if (normalizedLogin !== login) {
            setLogin(normalizedLogin);
        }

        const result = await register(normalizedLogin, password, pendingReferralCode || undefined);

        if (result.success) {
            reportReferralOutcome(result.referralStatus, messages);
            router.push(DEFAULT_POST_LOGIN_PATH);
        } else if (result.errorCode === AUTH_ERROR_CODES.alreadyRegistered) {
            setAlreadyRegistered(true);
        } else {
            setError(result.error || t.registerError);
        }

        setLoading(false);
    };

    return (
        <AuthShell
            subtitle={t.registerSubtitle}
            cardFooter={(
                <>
                    <div className="mt-6 flex justify-center">
                        <p className="text-sm text-muted-fg">
                            {t.haveAccount}{' '}
                            <Link href="/login" className="theme-link font-semibold">
                                {t.signInLink}
                            </Link>
                        </p>
                    </div>
                    <p className="mt-6 text-center text-xs text-muted-fg">
                        {t.credentialsHint} <span style={{ color: 'var(--accent)' }}>Platonus (platonus.kstu.kz)</span>
                    </p>
                </>
            )}
        >
            <h2 className="sr-only">{t.registerTitle}</h2>

            {error && <AuthErrorBanner>{error}</AuthErrorBanner>}

            {alreadyRegistered && (
                <AuthErrorBanner>
                    <div className="font-semibold">{t.alreadyRegistered}</div>
                    <div className="mt-1 text-xs opacity-90">{t.alreadyRegisteredHint}</div>
                    <Link href="/login" className="inline-block mt-2 text-sm font-semibold underline underline-offset-2">
                        {t.signInLink}
                    </Link>
                </AuthErrorBanner>
            )}

            <ReferralNotice code={pendingReferralCode} />

            <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <label className="block text-sm font-medium mb-2 text-secondary-fg" htmlFor="register-login">
                        {t.usernameLabel}
                    </label>
                    <input
                        id="register-login"
                        type="text"
                        value={login}
                        onChange={(e) => setLogin(e.target.value)}
                        onBlur={() => setLogin((current) => normalizePlatonusLogin(current))}
                        placeholder="ivanov.ivan"
                        className="input"
                        required
                        disabled={loading}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        autoComplete="username"
                    />
                </div>

                <div>
                    <label className="block text-sm font-medium mb-2 text-secondary-fg">
                        {t.passwordLabel}
                    </label>
                    <PasswordInput value={password} onChange={setPassword} disabled={loading} />
                </div>

                <p className="text-xs text-muted-fg leading-snug">{t.registerHint}</p>

                <button
                    type="submit"
                    disabled={loading}
                    className="btn btn-primary w-full py-4 text-base"
                >
                    {loading ? (
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="animate-spin h-5 w-5" strokeWidth={2} aria-hidden />
                            {t.registering}
                        </span>
                    ) : t.registerButton}
                </button>
            </form>
        </AuthShell>
    );
}
