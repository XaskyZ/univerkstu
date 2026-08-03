import { AlertCircle } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface ScheduleLoadingStateProps {
    withHint?: boolean;
}

interface ScheduleErrorStateProps {
    error: string;
    onRetry: () => void;
}

export function ScheduleLoadingState({ withHint = false }: ScheduleLoadingStateProps) {
    const { messages } = useLanguage();

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="flex flex-col items-center gap-5 text-center px-6">
                <div className="spinner-v2" data-size="lg" aria-label={messages.common.loading} />
                <div>
                    <p className="text-fg">{messages.schedule.loading}</p>
                    {withHint && (
                        <p className="text-sm mt-2 text-muted-fg">
                            {messages.schedule.loadingHint}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}

export function ScheduleAuthLoadingState() {
    const { messages } = useLanguage();
    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="spinner-v2" aria-label={messages.common.loading} />
        </div>
    );
}

export function ScheduleErrorState({ error, onRetry }: ScheduleErrorStateProps) {
    const { messages } = useLanguage();

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="error-state max-w-md w-full">
                <AlertCircle className="error-state-icon" strokeWidth={2} aria-hidden />
                <h3 className="error-state-title">{messages.schedule.loadErrorTitle}</h3>
                <p className="error-state-description">{error}</p>
                <button type="button" onClick={onRetry} className="btn btn-primary">
                    {messages.schedule.retry}
                </button>
            </div>
        </div>
    );
}
