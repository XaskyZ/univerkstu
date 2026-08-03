interface UMKDProgressBarProps {
    progress: {
        status: string;
        percent: number;
    };
}

export function UMKDProgressBar({ progress }: UMKDProgressBarProps) {
    return (
        <div className="px-4 py-2 animate-fadeIn">
            <div className="rounded-full h-4 overflow-hidden relative surface-overlay-3">
                <div
                    className="h-full transition-all duration-300 ease-out flex items-center justify-center text-[10px] text-white font-bold"
                    style={{ width: `${progress.percent}%`, backgroundColor: 'var(--primary)' }}
                >
                    {progress.percent > 10 && `${progress.percent}%`}
                </div>
            </div>
            <p className="text-xs text-center mt-1 text-muted-fg">
                {progress.status}
            </p>
        </div>
    );
}
