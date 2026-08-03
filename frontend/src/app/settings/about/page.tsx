'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
    ChevronRight,
    ExternalLink,
    FileText,
    Mail,
    MessageCircle,
    ShieldCheck,
    User,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/lib/language-context';
import { useFeatureFlag, writeFeatureFlag } from '@/lib/feature-flags';
import { PageMain, PageShell } from '@/components/PageShell';
import { SubScreenHeader } from '@/components/SubScreenHeader';

const APP_NAME = 'UniverSchedule';
const APP_VERSION = 'v4.1.33';
const TELEGRAM_CHANNEL = 'https://t.me/univerkstu';
const TELEGRAM_CHANNEL_HANDLE = '@univerkstu';
const DEVELOPER_TELEGRAM = 'https://t.me/xaskyO';
const DEVELOPER_TELEGRAM_HANDLE = '@xaskyO';
const DEVELOPER_EMAIL = 'xaskytwo@gmail.com';
const DEVELOPER_EMAIL_HREF = `mailto:${DEVELOPER_EMAIL}`;

/**
 * About sub-screen.
 *
 * iOS Settings about-page layout: app identity at top, two grouped
 * link cards (project/contact, legal), supportive footer, version chip.
 */
export default function SettingsAboutPage() {
    const { isAuth, loading } = useAuth();
    const { messages, language } = useLanguage();
    const router = useRouter();
    const text = messages.settings.about;
    const socialFeedBeta = useFeatureFlag('socialFeedBeta');

    // Localized copy is kept inline here because this row is experimental and
    // expected to be removed once the social-store cutover (Phase 1e) lands.
    // Adding entries to the three locale files for a temporary toggle would
    // create churn in `parity.test.ts` that we'd then need to revert.
    const betaCopy = language === 'en'
        ? {
            label: 'Beta: new group feed',
            hint: 'Read group posts through the new /api/v3/social endpoint. Experimental — toggle off if you see issues.',
        }
        : language === 'kz'
            ? {
                label: 'Бета: топ лентасының жаңа нұсқасы',
                hint: 'Топ хабарламалары жаңа /api/v3/social арқылы оқылады. Эксперимент — қажет болса, өшіруге болады.',
            }
            : {
                label: 'Бета: новая лента группы',
                hint: 'Чтение постов через новый /api/v3/social. Эксперимент — можно выключить, если что-то сломалось.',
            };

    useEffect(() => {
        if (!loading && !isAuth) router.push('/');
    }, [isAuth, loading, router]);

    if (loading || !isAuth) return null;

    const externalRow = (
        href: string,
        Icon: typeof MessageCircle,
        label: string,
        value: string,
    ) => (
        <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="about-row"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
                color: 'var(--text)',
                textDecoration: 'none',
            }}
        >
            <span
                aria-hidden
                style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '10px',
                    background: 'var(--surface-overlay-1, var(--card))',
                    border: '1px solid var(--border)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--muted)',
                    flexShrink: 0,
                }}
            >
                <Icon className="w-4 h-4" aria-hidden />
            </span>
            <span style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>{label}</span>
            <span
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    color: 'var(--muted)',
                    fontSize: '13px',
                    fontWeight: 500,
                }}
            >
                {value}
                <ExternalLink className="w-3.5 h-3.5" aria-hidden />
            </span>
        </a>
    );

    const internalRow = (
        href: string,
        Icon: typeof ShieldCheck,
        label: string,
    ) => (
        <Link
            href={href}
            className="about-row"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
                color: 'var(--text)',
                textDecoration: 'none',
            }}
        >
            <span
                aria-hidden
                style={{
                    width: '32px',
                    height: '32px',
                    borderRadius: '10px',
                    background: 'var(--surface-overlay-1, var(--card))',
                    border: '1px solid var(--border)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--muted)',
                    flexShrink: 0,
                }}
            >
                <Icon className="w-4 h-4" aria-hidden />
            </span>
            <span style={{ flex: 1, fontSize: '14px', fontWeight: 500 }}>{label}</span>
            <ChevronRight className="w-4 h-4" style={{ color: 'var(--muted)' }} aria-hidden />
        </Link>
    );

    const divider = (
        <div
            aria-hidden
            style={{
                height: '1px',
                background: 'var(--border)',
                marginLeft: '60px',
            }}
        />
    );

    return (
        <PageShell>
            <SubScreenHeader
                title={text.screenTitle}
                subtitle={text.screenSubtitle}
            />
            <PageMain className="space-y-4" spacing="lg">
                <section
                    className="card p-6 text-center"
                    style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}
                >
                    <h2
                        style={{
                            fontSize: '20px',
                            fontWeight: 700,
                            color: 'var(--text)',
                            margin: 0,
                        }}
                    >
                        {APP_NAME}
                    </h2>
                    <p style={{ color: 'var(--muted)', fontSize: '13px', margin: 0 }}>
                        {APP_VERSION}
                    </p>
                </section>

                <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {externalRow(TELEGRAM_CHANNEL, MessageCircle, text.channel, TELEGRAM_CHANNEL_HANDLE)}
                    {divider}
                    {externalRow(DEVELOPER_TELEGRAM, User, text.developer, DEVELOPER_TELEGRAM_HANDLE)}
                    {divider}
                    {externalRow(DEVELOPER_EMAIL_HREF, Mail, text.writeEmail, DEVELOPER_EMAIL)}
                </section>

                <section className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    {internalRow('/privacy', ShieldCheck, text.privacyPolicy)}
                    {divider}
                    {internalRow('/terms', FileText, text.terms)}
                </section>

                <section
                    className="card"
                    style={{
                        padding: '14px 16px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '12px',
                    }}
                >
                    <div style={{ flex: 1 }}>
                        <p
                            style={{
                                margin: 0,
                                fontSize: '14px',
                                fontWeight: 500,
                                color: 'var(--text)',
                            }}
                        >
                            {betaCopy.label}
                        </p>
                        <p
                            style={{
                                margin: '4px 0 0',
                                fontSize: '12px',
                                color: 'var(--muted)',
                                lineHeight: 1.4,
                            }}
                        >
                            {betaCopy.hint}
                        </p>
                    </div>
                    <label
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            cursor: 'pointer',
                            flexShrink: 0,
                        }}
                    >
                        <input
                            type="checkbox"
                            checked={socialFeedBeta}
                            onChange={(event) => writeFeatureFlag('socialFeedBeta', event.target.checked)}
                            aria-label={betaCopy.label}
                        />
                    </label>
                </section>

                <p
                    className="text-xs text-center px-2"
                    style={{ color: 'var(--muted)', lineHeight: 1.5 }}
                >
                    {text.support}
                </p>

                <p
                    className="text-xs text-center px-2"
                    style={{ color: 'var(--muted)', lineHeight: 1.5, opacity: 0.85 }}
                >
                    {messages.shortcuts.openHelpHint}
                </p>

                <div className="flex justify-center pt-2">
                    <span
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            padding: '6px 12px',
                            borderRadius: '999px',
                            border: '1px solid var(--border)',
                            background: 'var(--surface-overlay-1, var(--card))',
                            color: 'var(--muted)',
                            fontSize: '12px',
                            fontWeight: 600,
                            letterSpacing: '0.02em',
                        }}
                        aria-label={`${text.version} ${APP_VERSION}`}
                    >
                        {APP_VERSION}
                    </span>
                </div>
            </PageMain>
        </PageShell>
    );
}
