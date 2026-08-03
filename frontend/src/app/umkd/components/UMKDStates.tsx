import { AlertCircle, BookOpen } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface UMKDErrorStateProps {
    error: string;
    onRetry: () => void;
}

export function UMKDLoadingState() {
    const { messages } = useLanguage();

    return (
        <div className="flex flex-col items-center justify-center py-20">
            <div
                className="w-16 h-16 rounded-full border-4 border-t-transparent animate-spin mb-4"
                style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
            />
            <p className="text-fg">{messages.umkd.loading}</p>
            <p className="text-sm mt-2 text-muted-fg">
                {messages.umkd.loadingHint}
            </p>
        </div>
    );
}

export function UMKDErrorState({ error, onRetry }: UMKDErrorStateProps) {
    const { messages } = useLanguage();

    return (
        <div className="error-state">
            <AlertCircle className="error-state-icon" strokeWidth={2} aria-hidden />
            <h3 className="error-state-title">{messages.umkd.loadErrorTitle}</h3>
            <p className="error-state-description">{error}</p>
            <button type="button" onClick={onRetry} className="btn btn-primary mt-4">
                {messages.umkd.retry}
            </button>
        </div>
    );
}

export function UMKDEmptyState() {
    const { messages } = useLanguage();

    return (
        <div className="empty-state">
            <BookOpen className="empty-state-icon" strokeWidth={2} aria-hidden />
            <h3 className="empty-state-title">{messages.umkd.emptyTitle}</h3>
            <p className="empty-state-description">
                {messages.umkd.emptyDesc}
            </p>
        </div>
    );
}
