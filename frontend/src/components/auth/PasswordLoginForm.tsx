'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AUTH_ERROR_CODES } from '@/lib/api';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useLanguage } from '@/lib/language-context';
import { AuthErrorBanner, PasswordInput, ReferralNotice, normalizePlatonusLogin, reportReferralOutcome, usePendingReferralCode } from './AuthShell';

interface PasswordLoginFormProps {
    /** Where to go after a successful sign in (already validated by the caller). */
    redirectTo: string;
}

/** Classic Platonus login + password form (the "Пароль" mode on /login). */
export function PasswordLoginForm({ redirectTo }: PasswordLoginFormProps) {
    const { login } = useAuth();
    const { messages } = useLanguage();
    const t = messages.login;
    const router = useRouter();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [notRegistered, setNotRegistered] = useState(false);
    const [loading, setLoading] = useState(false);
    const pendingReferralCode = usePendingReferralCode();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setNotRegistered(false);
        setLoading(true);
        trackAnalyticsEvent('cta_click', {
            feature: 'auth',
            label: 'login_submit_button',
            path: '/login',
        });

        const normalizedUsername = normalizePlatonusLogin(username);
        if (normalizedUsername !== username) {
            setUsername(normalizedUsername);
        }

        const result = await login(normalizedUsername, password, pendingReferralCode || undefined);

        if (result.success) {
            reportReferralOutcome(result.referralStatus, messages);
            router.push(redirectTo);
        } else if (result.errorCode === AUTH_ERROR_CODES.notRegistered) {
            setNotRegistered(true);
        } else {
            setError(result.error || t.authError);
        }

        setLoading(false);
    };

    const registerHref = pendingReferralCode ? `/register?ref=${encodeURIComponent(pendingReferralCode)}` : '/register';

    return (
        <>
            {error && <AuthErrorBanner>{error}</AuthErrorBanner>}

            {notRegistered && (
                <AuthErrorBanner>
                    <div className="font-semibold">{t.accountNotFound}</div>
                    <div className="mt-1 text-xs opacity-90">{t.accountNotFoundHint}</div>
                    <Link href={registerHref} className="inline-block mt-2 text-sm font-semibold underline underline-offset-2">
                        {t.registerLink}
                    </Link>
                </AuthErrorBanner>
            )}

            <ReferralNotice code={pendingReferralCode} />

            <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                    <label className="block text-sm font-medium mb-2 text-secondary-fg" htmlFor="login-username">
                        {t.usernameLabel}
                    </label>
                    <input
                        id="login-username"
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onBlur={() => setUsername((current) => normalizePlatonusLogin(current))}
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

                <button
                    type="submit"
                    disabled={loading}
                    className="btn btn-primary w-full py-4 text-base"
                >
                    {loading ? (
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="animate-spin h-5 w-5" strokeWidth={2} aria-hidden />
                            {t.signingIn}
                        </span>
                    ) : t.signIn}
                </button>
            </form>
        </>
    );
}
