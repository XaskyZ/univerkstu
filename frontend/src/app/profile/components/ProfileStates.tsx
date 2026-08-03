import { AlertCircle } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface ProfileErrorStateProps {
    error: string;
    onRetry: () => void;
}

export function ProfileFetchingState() {
    const { messages } = useLanguage();

    return (
        <div className="flex flex-col items-center justify-center py-20">
            <div
                className="w-16 h-16 rounded-full border-4 border-t-transparent animate-spin mb-4"
                style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
            />
            <p className="text-fg">{messages.profile.loading}</p>
        </div>
    );
}

export function ProfileErrorState({ error, onRetry }: ProfileErrorStateProps) {
    const { messages } = useLanguage();

    return (
        <div className="error-state">
            <AlertCircle className="error-state-icon" strokeWidth={2} aria-hidden />
            <h3 className="error-state-title">{messages.profile.loadErrorTitle}</h3>
            <p className="error-state-description">{error}</p>
            <button type="button" onClick={onRetry} className="btn btn-primary mt-4">
                {messages.profile.retry}
            </button>
        </div>
    );
}
