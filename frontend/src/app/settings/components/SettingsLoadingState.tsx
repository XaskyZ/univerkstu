export function SettingsLoadingState() {
    return (
        <div className="min-h-screen flex items-center justify-center">
            <div
                className="w-12 h-12 rounded-full border-4 border-t-transparent animate-spin"
                style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }}
            />
        </div>
    );
}
