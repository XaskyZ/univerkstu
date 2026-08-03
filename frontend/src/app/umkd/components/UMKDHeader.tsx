import { RefreshCw } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface UMKDHeaderProps {
    refreshing: boolean;
    fetching: boolean;
    onRefresh: () => void;
}

export function UMKDHeader({ refreshing, fetching, onRefresh }: UMKDHeaderProps) {
    const { messages } = useLanguage();

    return (
        <header className="app-header">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="app-header-title">{messages.umkd.title}</h1>
                    <p className="app-header-subtitle">
                        {messages.umkd.subtitle}
                    </p>
                </div>
                <button
                    onClick={onRefresh}
                    disabled={refreshing || fetching}
                    className="refresh-btn"
                >
                    <RefreshCw
                        className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`}
                        strokeWidth={2}
                        aria-hidden
                    />
                    {refreshing ? '' : messages.umkd.refresh}
                </button>
            </div>
        </header>
    );
}
