import Link from 'next/link';
import { BookOpen, ChevronRight } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import { getHistoryUi, type HistoryLang } from '@/app/profile/history/history-i18n';

/**
 * Entry tile that links to the dedicated `/profile/history` screen
 * (zachyotka + akademicheskaya vypiska). Sits in the profile card stack so
 * students can find their full academic history without scrolling through
 * the questionnaire accordion.
 *
 * Localized via the same `getHistoryUi()` factory the destination page uses,
 * so the label here always matches the screen header.
 */
export function ProfileHistoryLinkCard() {
    const { language } = useLanguage();
    const ui = getHistoryUi(language as HistoryLang);

    return (
        <Link
            href="/profile/history"
            className="card animate-fadeInUp profile-card-fade-in"
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '14px 16px',
                animationDelay: '170ms',
                textDecoration: 'none',
                color: 'var(--text)',
            }}
        >
            <div
                aria-hidden
                style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    background: 'var(--status-info-bg)',
                    color: 'var(--status-info-color)',
                    border: '1px solid var(--status-info-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                }}
            >
                <BookOpen className="w-4 h-4" strokeWidth={2} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                    {ui.historyLinkLabel}
                </div>
                <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>
                    {ui.historyLinkHint}
                </div>
            </div>
            <ChevronRight
                className="w-4 h-4"
                aria-hidden
                style={{ color: 'var(--muted)', flexShrink: 0 }}
            />
        </Link>
    );
}
