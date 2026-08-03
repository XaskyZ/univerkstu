'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { dismissToast, subscribeToasts, type Toast } from '@/lib/toast';
import { useLanguage } from '@/lib/language-context';

const TONE_STYLES: Record<Toast['tone'], { bg: string; color: string; border: string; icon: string }> = {
    success: {
        bg: 'rgba(var(--good-rgb), 0.16)',
        color: 'var(--good)',
        border: '1px solid rgba(var(--good-rgb), 0.36)',
        icon: '✓',
    },
    error: {
        bg: 'rgba(var(--danger-rgb), 0.16)',
        color: 'var(--danger)',
        border: '1px solid rgba(var(--danger-rgb), 0.36)',
        icon: '⚠',
    },
    info: {
        bg: 'rgba(var(--primary-rgb), 0.14)',
        color: 'var(--primary)',
        border: '1px solid rgba(var(--primary-rgb), 0.32)',
        icon: 'ℹ',
    },
};

function ToastItem({ toast, dismissLabel }: { toast: Toast; dismissLabel: string }) {
    useEffect(() => {
        if (toast.durationMs <= 0) return;
        const timer = window.setTimeout(() => dismissToast(toast.id), toast.durationMs);
        return () => window.clearTimeout(timer);
    }, [toast.durationMs, toast.id]);

    const style = TONE_STYLES[toast.tone];

    return (
        <div
            role={toast.tone === 'error' ? 'alert' : 'status'}
            aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}
            className="rounded-2xl px-4 py-3 flex items-start gap-3 shadow-lg pointer-events-auto"
            style={{
                background: style.bg,
                color: style.color,
                border: style.border,
                backdropFilter: 'blur(8px)',
                minWidth: '260px',
                maxWidth: '420px',
            }}
        >
            <span className="text-lg leading-none mt-0.5" aria-hidden>{style.icon}</span>
            <div className="flex-1 text-sm whitespace-pre-wrap text-fg">
                {toast.message}
            </div>
            <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="opacity-70 hover:opacity-100 transition-opacity text-fg"
                aria-label={dismissLabel}
            >
                <X className="w-4 h-4" strokeWidth={2.5} aria-hidden />
            </button>
        </div>
    );
}

export default function ToastHost() {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const { messages } = useLanguage();

    useEffect(() => subscribeToasts(setToasts), []);

    if (toasts.length === 0 || typeof document === 'undefined') return null;

    return createPortal(
        <div
            role="status"
            aria-live="polite"
            aria-atomic="false"
            className="fixed z-[210] flex flex-col gap-2 pointer-events-none"
            style={{
                bottom: 'max(1rem, env(safe-area-inset-bottom))',
                right: '1rem',
                left: '1rem',
                alignItems: 'flex-end',
            }}
        >
            {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} dismissLabel={messages.common.dismiss} />
            ))}
        </div>,
        document.body,
    );
}
