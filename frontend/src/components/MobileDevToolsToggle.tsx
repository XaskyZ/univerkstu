'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

const ERUDA_ENABLED_KEY = 'mobile-devtools-enabled';
const ERUDA_SCRIPT_ID = 'eruda-script';
const ADMIN_DEVTOOLS_VISIBLE_KEY = 'admin-devtools-visible';

declare global {
    interface Window {
        eruda?: {
            init: () => void;
            destroy?: () => void;
        };
    }
}

function shouldShowButton(pathname: string | null, enabled: boolean, adminVisible: boolean): boolean {
    if (enabled && (!pathname?.startsWith('/admin') || adminVisible)) return true;
    if (!pathname) return false;
    return pathname.startsWith('/admin') && adminVisible;
}

async function ensureErudaLoaded(): Promise<void> {
    if (typeof window === 'undefined') return;
    if (window.eruda) return;

    const existing = document.getElementById(ERUDA_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
        await new Promise<void>((resolve, reject) => {
            if (window.eruda) {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error('Failed to load eruda')), { once: true });
        });
        return;
    }

    await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        script.id = ERUDA_SCRIPT_ID;
        script.src = 'https://cdn.jsdelivr.net/npm/eruda';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load eruda'));
        document.body.appendChild(script);
    });
}

export default function MobileDevToolsToggle() {
    const pathname = usePathname();
    const [enabled, setEnabled] = useState(false);
    const [adminVisible, setAdminVisible] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const nextEnabled = localStorage.getItem(ERUDA_ENABLED_KEY) === 'true';
        setEnabled(nextEnabled);
        const nextAdminVisible = sessionStorage.getItem(ADMIN_DEVTOOLS_VISIBLE_KEY) === 'true';
        setAdminVisible(nextAdminVisible);

        const syncVisibility = () => {
            setAdminVisible(sessionStorage.getItem(ADMIN_DEVTOOLS_VISIBLE_KEY) === 'true');
        };

        window.addEventListener('focus', syncVisibility);
        window.addEventListener('storage', syncVisibility);
        return () => {
            window.removeEventListener('focus', syncVisibility);
            window.removeEventListener('storage', syncVisibility);
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined' || !enabled) return;

        void (async () => {
            try {
                await ensureErudaLoaded();
                window.eruda?.init();
            } catch {
                // Ignore UI-side loading failures here.
            }
        })();
    }, [enabled]);

    const toggle = async () => {
        if (typeof window === 'undefined') return;
        setBusy(true);
        try {
            if (!enabled) {
                await ensureErudaLoaded();
                window.eruda?.init();
                localStorage.setItem(ERUDA_ENABLED_KEY, 'true');
                setEnabled(true);
                return;
            }

            window.eruda?.destroy?.();
            localStorage.setItem(ERUDA_ENABLED_KEY, 'false');
            setEnabled(false);
        } finally {
            setBusy(false);
        }
    };

    if (!shouldShowButton(pathname, enabled, adminVisible)) return null;

    return (
        <button
            type="button"
            onClick={() => void toggle()}
            disabled={busy}
            aria-label={enabled ? 'Disable mobile devtools' : 'Enable mobile devtools'}
            className="fixed left-3 z-[1200] rounded-full px-3 py-2 text-xs font-semibold shadow-lg disabled:opacity-60"
            style={{
                bottom: 'max(5.5rem, env(safe-area-inset-bottom, 0px) + 4.5rem)',
                background: enabled ? 'rgba(var(--good-rgb), 0.92)' : 'var(--card)',
                color: enabled ? '#04120b' : 'var(--text)',
                border: '1px solid var(--border)',
                backdropFilter: 'blur(12px)',
            }}
        >
            {busy ? '...' : enabled ? 'Dev ON' : 'Dev'}
        </button>
    );
}
