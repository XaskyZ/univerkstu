import { AlertCircle } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface ExamsErrorStateProps {
    error: string;
    onRetry: () => void;
}

export function ExamsAuthLoadingState() {
    return (
        <div className="min-h-screen flex items-center justify-center">
            <div
                className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
                style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
            />
        </div>
    );
}

export function ExamsLoadingState() {
    const { language } = useLanguage();
    const ui = {
        ru: {
            title: 'Загрузка экзаменов...',
            subtitle: 'Это может занять до минуты при первом запросе',
        },
        kz: {
            title: 'Емтихандар жүктелуде...',
            subtitle: 'Алғашқы сұрауда бұл бір минутқа дейін созылуы мүмкін',
        },
        en: {
            title: 'Loading exams...',
            subtitle: 'This may take up to a minute on the first request',
        },
    }[language];

    return (
        <div className="min-h-screen flex items-center justify-center">
            <div className="flex flex-col items-center gap-4 text-center px-6">
                <div
                    className="w-16 h-16 rounded-full border-4 border-t-transparent animate-spin"
                    style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
                />
                <div>
                    <p className="text-fg">{ui.title}</p>
                    <p className="text-sm mt-2 text-muted-fg">
                        {ui.subtitle}
                    </p>
                </div>
            </div>
        </div>
    );
}

export function ExamsErrorState({ error, onRetry }: ExamsErrorStateProps) {
    const { language } = useLanguage();
    const ui = {
        ru: {
            title: 'Ошибка загрузки',
            retry: 'Попробовать снова',
        },
        kz: {
            title: 'Жүктеу қатесі',
            retry: 'Қайталап көру',
        },
        en: {
            title: 'Loading error',
            retry: 'Try again',
        },
    }[language];

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            <div className="error-state max-w-md w-full">
                <AlertCircle className="error-state-icon" strokeWidth={2} aria-hidden />
                <h3 className="error-state-title">{ui.title}</h3>
                <p className="error-state-description">{error}</p>
                <button type="button" onClick={onRetry} className="btn btn-primary">
                    {ui.retry}
                </button>
            </div>
        </div>
    );
}
