'use client';

import { useCallback } from 'react';
import { Share2 } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/language-context';

/**
 * Tiny "copy current URL" button intended for public SEO pages where
 * sharing is the main inbound action. Uses `navigator.clipboard.writeText`
 * with a graceful fallback through an off-screen textarea for older WebViews.
 */
export default function ShareLinkButton({ className }: { className?: string }) {
    const { messages } = useLanguage();
    const ui = messages.share;

    const onShare = useCallback(async () => {
        if (typeof window === 'undefined') return;
        const url = window.location.href;
        const writer = window.navigator?.clipboard?.writeText;
        try {
            if (writer) {
                await writer.call(window.navigator.clipboard, url);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = url;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
            }
            toast.success(ui.copied);
        } catch {
            toast.error(ui.copyFailed);
        }
    }, [ui.copied, ui.copyFailed]);

    return (
        <button
            type="button"
            onClick={onShare}
            aria-label={ui.copyLink}
            title={ui.copyLink}
            className={`btn btn-secondary inline-flex items-center justify-center ${className ?? ''}`}
            style={{ width: 36, height: 36, padding: 0 }}
        >
            <Share2 className="w-4 h-4" strokeWidth={2.5} aria-hidden />
        </button>
    );
}
