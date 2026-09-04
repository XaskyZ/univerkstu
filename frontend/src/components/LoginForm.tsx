'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, CalendarDays, Eye, EyeOff, Loader2, Mail } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { trackAnalyticsEvent } from '@/lib/analytics';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { clearPendingReferralCode, getPendingReferralCode, normalizeReferralCode, setPendingReferralCode } from '@/lib/referrals';

function normalizePlatonusLogin(value: string): string {
    return value.trim();
}

export default function LoginForm() {
    const { login } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();
    const searchParams = useSearchParams();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const pendingReferralCode = useMemo(() => {
        const fromUrl = normalizeReferralCode(searchParams.get('ref') || '');
        if (fromUrl) {
            return fromUrl;
        }
        return getPendingReferralCode();
    }, [searchParams]);

    useEffect(() => {
        const fromUrl = normalizeReferralCode(searchParams.get('ref') || '');
        if (fromUrl) {
            setPendingReferralCode(fromUrl);
        }
    }, [searchParams]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
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
            // Give the user feedback on their referral code instead of silently
            // dropping it. 'missing'/'error' stay quiet (no code entered / transient).
            if (result.referralStatus === 'applied') {
                toast.success(messages.login.referralApplied);
                clearPendingReferralCode();
            } else if (
                result.referralStatus === 'invalid'
                || result.referralStatus === 'self'
                || result.referralStatus === 'already_claimed'
                || result.referralStatus === 'claim_window_expired'
            ) {
                toast.info(messages.login.referralNotApplied);
                clearPendingReferralCode();
            }
            router.push('/schedule');
        } else {
            setError(result.error || messages.login.authError);
        }

        setLoading(false);
    };

    return (
        <div className="login-page min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-md animate-fadeInUp">
                {/* Logo Card */}
                <div className="login-card card p-8">
                    {/* Logo */}
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5"
                            style={{ background: 'var(--gradient-primary)' }}>
                            <CalendarDays className="w-10 h-10 text-white" strokeWidth={2} aria-hidden />
                        </div>
                        <h1 className="text-2xl font-bold text-fg">UniverSchedule</h1>
                        <p className="mt-2 text-muted-fg">{messages.login.subtitle}</p>
                    </div>

                    {/* Error */}
                    {error && (
                        <div className="mb-5 p-4 rounded-xl animate-scaleIn"
                            style={{
                                background: 'rgba(255, 107, 138, 0.15)',
                                border: '1px solid rgba(255, 107, 138, 0.3)'
                            }}>
                            <div className="flex items-center gap-3">
                                <AlertCircle className="w-5 h-5 flex-shrink-0 text-danger-fg" aria-hidden />
                                <span className="text-sm text-danger-fg">{error}</span>
                            </div>
                        </div>
                    )}

                    {pendingReferralCode ? (
                        <div className="mb-5 p-4 rounded-xl animate-scaleIn" style={{ background: 'var(--status-info-bg)', border: '1px solid var(--status-info-border)' }}>
                            <div className="flex items-start gap-3">
                                <div className="text-lg">🎁</div>
                                <div>
                                    <div className="text-sm font-semibold" style={{ color: 'var(--status-info-color)' }}>
                                        {language === 'ru' ? 'Реферальное приглашение сохранено' : language === 'kz' ? 'Рефералдық шақыру сақталды' : 'Referral invite saved'}
                                    </div>
                                    <div className="mt-1 text-xs text-muted-fg">
                                        {language === 'ru'
                                            ? `После входа система попробует привязать код ${pendingReferralCode}. Если что-то не сработает, его можно будет ввести вручную в разделе рефералов.`
                                            : language === 'kz'
                                                ? `Кіргеннен кейін жүйе ${pendingReferralCode} кодын автоматты түрде байланыстырып көреді. Егер өтпей қалса, оны реферал бөлімінде қолмен енгізуге болады.`
                                                : `After sign in, the app will try to attach code ${pendingReferralCode}. If anything fails, you can enter it manually later on the referrals page.`}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : null}

                    {/* Form */}
                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium mb-2 text-secondary-fg">
                                {messages.login.usernameLabel}
                            </label>
                            <input
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
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium mb-2 text-secondary-fg">
                                {messages.login.passwordLabel}
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="••••••••"
                                    className="input pr-12"
                                    required
                                    disabled={loading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors text-muted-fg"
                                    tabIndex={-1}
                                    aria-label={showPassword ? messages.login.hidePassword : messages.login.showPassword}
                                    title={showPassword ? messages.login.hidePassword : messages.login.showPassword}
                                >
                                    {showPassword
                                        ? <EyeOff className="w-5 h-5" aria-hidden />
                                        : <Eye className="w-5 h-5" aria-hidden />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={loading}
                            className="btn btn-primary w-full py-4 text-base"
                        >
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="animate-spin h-5 w-5" strokeWidth={2} aria-hidden />
                                    {messages.login.signingIn}
                                </span>
                            ) : messages.login.signIn}
                        </button>
                    </form>

                    <div className="mt-4 flex justify-center">
                        <Link
                            href="/curator-login"
                            className="login-secondary-link px-4 py-2 rounded-xl text-sm transition-colors"
                            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
                        >
                            {language === 'ru'
                                ? 'Отдельный вход для куратора'
                                : language === 'kz'
                                    ? 'Кураторға бөлек кіру'
                                    : 'Separate curator sign in'}
                        </Link>
                    </div>

                    {/* Footer */}
                    <p className="mt-6 text-center text-xs text-muted-fg">
                        {messages.login.credentialsHint} <span style={{ color: 'var(--accent)' }}>Platonus (platonus.kstu.kz)</span>
                    </p>
                    <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-muted-fg">
                        <a href="/privacy" className="hover:underline">{messages.login.privacyPolicy}</a>
                        <span>•</span>
                        <a href="/terms" className="hover:underline">{messages.login.terms}</a>
                        <span>•</span>
                        <a href="/about" className="hover:underline">{messages.publicPages.aboutTitle}</a>
                    </div>
                </div>

                {/* Version & Contacts */}
                <div className="mt-6 text-center space-y-2">
                    <p className="text-xs text-muted-fg">
                        {messages.login.projectTagline}
                    </p>
                    <p className="text-[11px] text-muted-fg">
                        {messages.login.telegramChannel}{' '}
                        <a href="https://t.me/univerkstu" target="_blank" rel="noopener noreferrer" className="theme-link">
                            @univerkstu
                        </a>
                    </p>
                    <div className="flex items-center justify-center gap-4 text-xs font-medium text-muted-fg">
                        <a href="mailto:xaskytwo@gmail.com" className="theme-link-muted transition-colors flex items-center gap-1.5 py-1">
                            <Mail className="w-3.5 h-3.5" aria-hidden />
                            xaskytwo@gmail.com
                        </a>
                        <a href="https://t.me/xaskyO" target="_blank" rel="noopener noreferrer" className="theme-link-muted transition-colors flex items-center gap-1.5 py-1">
                            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.892-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" /></svg>
                            @xaskyO
                        </a>
                    </div>
                    <p className="text-[11px] text-muted-fg px-4 leading-snug">
                        {messages.login.customRequestHint}
                    </p>
                </div>
            </div>
        </div>
    );
}
