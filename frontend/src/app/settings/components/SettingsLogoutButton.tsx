import { LogOut } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';

interface SettingsLogoutButtonProps {
    onLogout: () => void;
}

export function SettingsLogoutButton({ onLogout }: SettingsLogoutButtonProps) {
    const { messages } = useLanguage();

    return (
        <button
            onClick={onLogout}
            className="w-full py-4 rounded-xl font-semibold flex items-center justify-center gap-2 animate-fadeInUp"
            style={{
                background: 'rgba(var(--status-danger-rgb), 0.14)',
                border: '1px solid rgba(var(--status-danger-rgb), 0.3)',
                color: 'var(--danger)',
                animationDelay: '200ms',
            }}
        >
            <LogOut className="w-5 h-5" strokeWidth={2} aria-hidden />
            {messages.settings.main.logout}
        </button>
    );
}
