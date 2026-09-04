'use client';

import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AlertCircle, CalendarDays, Eye, EyeOff, Mail } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { toast } from '@/lib/toast';
import { clearPendingReferralCode, getPendingReferralCode, normalizeReferralCode, setPendingReferralCode } from '@/lib/referrals';

/**
 * Shared chrome + small building blocks for the public auth screens
 * (/login, /register, /login/approve). Extracted from LoginForm so the
 * register form and the QR/push panels do not duplicate the card, the
 * referral banner or the password field.
 */

export function normalizePlatonusLogin(value: string): string {
    return value.trim();
}

interface AuthShellProps {
    title?: string;
    subtitle: string;
    children: ReactNode;
    /** Rendered inside the card, under the main content (links, hints). */
    cardFooter?: ReactNode;
    /** Hide the project/contacts block under the card (used on compact screens). */
    hideContacts?: boolean;
}

export function AuthShell({ title = 'UniverSchedule', subtitle, children, cardFooter, hideContacts = false }: AuthShellProps) {
    const { messages } = useLanguage();
    return (
        <div className="login-page min-h-screen flex items-center justify-center p-4">
            <div className="w-full max-w-md animate-fadeInUp">
                <div className="login-card card p-8">
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl mb-5"
                            style={{ background: 'var(--gradient-primary)' }}>
                            <CalendarDays className="w-10 h-10 text-white" strokeWidth={2} aria-hidden />
                        </div>
                        <h1 className="text-2xl font-bold text-fg">{title}</h1>
                        <p className="mt-2 text-muted-fg">{subtitle}</p>
                    </div>

                    {children}

                    {cardFooter}

                    <div className="mt-3 flex items-center justify-center gap-3 text-[11px] text-muted-fg">
                        <a href="/privacy" className="hover:underline">{messages.login.privacyPolicy}</a>
                        <span>•</span>
                        <a href="/terms" className="hover:underline">{messages.login.terms}</a>
                        <span>•</span>
                        <a href="/about" className="hover:underline">{messages.publicPages.aboutTitle}</a>
                    </div>
                </div>

                {!hideContacts && (
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
                )}
            </div>
        </div>
    );
}

export function AuthErrorBanner({ children }: { children: ReactNode }) {
    return (
        <div className="mb-5 p-4 rounded-xl animate-scaleIn" role="alert"
            style={{
                background: 'rgba(255, 107, 138, 0.15)',
                border: '1px solid rgba(255, 107, 138, 0.3)'
            }}>
            <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 flex-shrink-0 text-danger-fg" aria-hidden />
                <div className="text-sm text-danger-fg min-w-0">{children}</div>
            </div>
        </div>
    );
}

export function AuthInfoBanner({ icon, title, children }: { icon?: ReactNode; title?: ReactNode; children?: ReactNode }) {
    return (
        <div className="mb-5 p-4 rounded-xl animate-scaleIn" style={{ background: 'var(--status-info-bg)', border: '1px solid var(--status-info-border)' }}>
            <div className="flex items-start gap-3">
                {icon ? <div className="text-lg" aria-hidden>{icon}</div> : null}
                <div className="min-w-0">
                    {title ? (
                        <div className="text-sm font-semibold" style={{ color: 'var(--status-info-color)' }}>{title}</div>
                    ) : null}
                    {children ? <div className="mt-1 text-xs text-muted-fg">{children}</div> : null}
                </div>
            </div>
        </div>
    );
}

interface PasswordInputProps {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    autoComplete?: string;
}

export function PasswordInput({ value, onChange, disabled, autoComplete = 'current-password' }: PasswordInputProps) {
    const { messages } = useLanguage();
    const [show, setShow] = useState(false);
    return (
        <div className="relative">
            <input
                type={show ? 'text' : 'password'}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="••••••••"
                className="input pr-12"
                required
                disabled={disabled}
                autoComplete={autoComplete}
            />
            <button
                type="button"
                onClick={() => setShow((current) => !current)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg transition-colors text-muted-fg"
                tabIndex={-1}
                aria-label={show ? messages.login.hidePassword : messages.login.showPassword}
                title={show ? messages.login.hidePassword : messages.login.showPassword}
            >
                {show ? <EyeOff className="w-5 h-5" aria-hidden /> : <Eye className="w-5 h-5" aria-hidden />}
            </button>
        </div>
    );
}

/**
 * Referral code from `?ref=` (persisted for later) or the previously stored
 * pending code. Shared by the login and register forms.
 */
export function usePendingReferralCode(): string {
    const searchParams = useSearchParams();

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

    return pendingReferralCode;
}

export function ReferralNotice({ code }: { code: string }) {
    const { messages } = useLanguage();
    if (!code) return null;
    return (
        <AuthInfoBanner icon="🎁" title={messages.login.referralSavedTitle}>
            {messages.login.referralSavedBody.replace('{code}', code)}
        </AuthInfoBanner>
    );
}

/**
 * Give the user feedback on their referral code instead of silently dropping
 * it. 'missing'/'error' stay quiet (no code entered / transient).
 */
export function reportReferralOutcome(status: string | undefined, messages: ReturnType<typeof useLanguage>['messages']): void {
    if (status === 'applied') {
        toast.success(messages.login.referralApplied);
        clearPendingReferralCode();
    } else if (
        status === 'invalid'
        || status === 'self'
        || status === 'already_claimed'
        || status === 'claim_window_expired'
    ) {
        toast.info(messages.login.referralNotApplied);
        clearPendingReferralCode();
    }
}
