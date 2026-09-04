'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Eye, EyeOff, GraduationCap, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { trackAnalyticsEvent } from '@/lib/analytics';

function normalizeCuratorLogin(value: string): string {
    return value.trim();
}

export default function CuratorLoginForm() {
    const { loginCurator } = useAuth();
    const { language } = useLanguage();
    const router = useRouter();
    const [userId, setUserId] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const ui = {
        ru: {
            title: 'Вход для куратора',
            subtitle: 'Отдельная локальная учётка куратора без авторизации через Platonus.',
            loginLabel: 'Логин куратора',
            passwordLabel: 'Пароль',
            submit: 'Войти как куратор',
            loading: 'Входим...',
            hint: 'Этот вход работает только для аккаунтов, которым супер-админ выдал роль куратора и локальный пароль.',
            back: 'Обычный вход студента',
            authError: 'Не удалось войти',
            showPassword: 'Показать пароль',
            hidePassword: 'Скрыть пароль',
        },
        kz: {
            title: 'Куратор кіруі',
            subtitle: 'Platonus арқылы емес, кураторға арналған бөлек жергілікті тіркелгі.',
            loginLabel: 'Куратор логині',
            passwordLabel: 'Құпиясөз',
            submit: 'Куратор ретінде кіру',
            loading: 'Кіру орындалуда...',
            hint: 'Бұл кіру тек супер-админ куратор рөлін және жергілікті құпиясөзді берген аккаунттарға арналған.',
            back: 'Студенттің қалыпты кіруі',
            authError: 'Кіру мүмкін болмады',
            showPassword: 'Құпиясөзді көрсету',
            hidePassword: 'Құпиясөзді жасыру',
        },
        en: {
            title: 'Curator sign in',
            subtitle: 'Separate local curator account without Platonus authentication.',
            loginLabel: 'Curator login',
            passwordLabel: 'Password',
            submit: 'Sign in as curator',
            loading: 'Signing in...',
            hint: 'This login only works for accounts that were granted the curator role and a local password by a super admin.',
            back: 'Regular student sign in',
            authError: 'Could not sign in',
            showPassword: 'Show password',
            hidePassword: 'Hide password',
        },
    }[language];

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        trackAnalyticsEvent('cta_click', {
            feature: 'auth',
            label: 'curator_login_submit_button',
            path: '/curator-login',
        });

        const normalizedUserId = normalizeCuratorLogin(userId);
        if (normalizedUserId !== userId) {
            setUserId(normalizedUserId);
        }

        const result = await loginCurator(normalizedUserId, password);
        if (result.success) {
            router.push('/group/curator');
        } else {
            setError(result.error || ui.authError);
        }

        setLoading(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-md animate-fadeInUp">
                <div className="card p-8">
                    <div className="text-center mb-8">
                        <div
                            className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5 relative overflow-hidden"
                            style={{ background: 'var(--gradient-primary)' }}
                        >
                            <div
                                className="absolute inset-0 opacity-30"
                                style={{ background: 'radial-gradient(circle at 30% 30%, rgba(255,255,255,0.38), transparent)' }}
                            />
                            <GraduationCap className="w-10 h-10 text-white relative z-10" strokeWidth={2} aria-hidden />
                        </div>
                        <h1 className="text-2xl font-bold text-fg">{ui.title}</h1>
                        <p className="mt-2 text-muted-fg">{ui.subtitle}</p>
                    </div>

                    {error && (
                        <div
                            className="mb-5 p-4 rounded-xl animate-scaleIn"
                            style={{
                                background: 'rgba(var(--status-danger-rgb), 0.14)',
                                border: '1px solid rgba(var(--status-danger-rgb), 0.3)',
                            }}
                        >
                            <div className="flex items-center gap-3">
                                <AlertCircle className="w-5 h-5 flex-shrink-0 text-danger-fg" strokeWidth={2} aria-hidden />
                                <span className="text-sm text-danger-fg">{error}</span>
                            </div>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium mb-2 text-secondary-fg">
                                {ui.loginLabel}
                            </label>
                            <input
                                type="text"
                                value={userId}
                                onChange={(e) => setUserId(e.target.value)}
                                onBlur={() => setUserId((current) => normalizeCuratorLogin(current))}
                                placeholder="curator.login"
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
                                {ui.passwordLabel}
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
                                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors"
                                    style={{ color: 'var(--muted)' }}
                                    tabIndex={-1}
                                    aria-label={showPassword ? ui.hidePassword : ui.showPassword}
                                    title={showPassword ? ui.hidePassword : ui.showPassword}
                                >
                                    {showPassword
                                        ? <EyeOff className="w-5 h-5" strokeWidth={2} aria-hidden />
                                        : <Eye className="w-5 h-5" strokeWidth={2} aria-hidden />}
                                </button>
                            </div>
                        </div>

                        <button type="submit" disabled={loading} className="btn btn-primary w-full py-4 text-base">
                            {loading ? (
                                <span className="flex items-center justify-center gap-2">
                                    <Loader2 className="animate-spin h-5 w-5" strokeWidth={2} aria-hidden />
                                    {ui.loading}
                                </span>
                            ) : ui.submit}
                        </button>
                    </form>

                    <p className="mt-6 text-center text-xs text-muted-fg">
                        {ui.hint}
                    </p>
                    <div className="mt-4 flex justify-center">
                        <Link
                            href="/"
                            className="px-4 py-2 rounded-xl text-sm transition-colors hover:bg-white/5"
                            style={{ border: '1px solid var(--border)', color: 'var(--text)' }}
                        >
                            {ui.back}
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    );
}
