'use client';

import { RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface SettingsHeaderProps {
    refreshing?: boolean;
    onRefresh?: () => void;
}

/**
 * Simplified main-screen header for /settings. Drops the legacy subtitle in
 * favor of a single title + refresh button, matching the iOS-style minimal
 * top chrome the rest of v4 has adopted.
 */
export function SettingsHeader({ refreshing = false, onRefresh }: SettingsHeaderProps) {
    const { messages } = useLanguage();
    const ui = messages.settings.main;

    return (
        <header className="app-header">
            <div className="flex items-center justify-between">
                <h1 className="app-header-title">{ui.title}</h1>
                {onRefresh ? (
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={refreshing}
                        className="refresh-btn"
                        aria-label={ui.refresh}
                    >
                        <RefreshCw
                            className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
                            strokeWidth={2}
                            aria-hidden
                        />
                        {refreshing ? '' : ui.refresh}
                    </button>
                ) : null}
            </div>
        </header>
    );
}
