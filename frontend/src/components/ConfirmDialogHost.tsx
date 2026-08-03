'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLanguage } from '@/lib/language-context';
import {
    resetConfirmDialog,
    resolveConfirmDialog,
    subscribeConfirmDialog,
    type ConfirmDialogRequest,
} from '@/lib/confirm-dialog';

const subscribeNoop = () => () => {};
const getMountedSnapshot = () => true;
const getMountedServerSnapshot = () => false;

export default function ConfirmDialogHost() {
    const { language } = useLanguage();
    const [request, setRequest] = useState<ConfirmDialogRequest | null>(null);
    // Hydration-safe mount gate: server snapshot is false, client snapshot is true.
    // React keeps using the server snapshot during hydration, so SSR and the first
    // client render both return null and the trees match.
    const mounted = useSyncExternalStore(subscribeNoop, getMountedSnapshot, getMountedServerSnapshot);
    const dialogRef = useRef<HTMLDialogElement | null>(null);

    useEffect(() => {
        const unsubscribe = subscribeConfirmDialog(setRequest);
        return () => {
            unsubscribe();
            resetConfirmDialog();
        };
    }, []);

    // Open / close the native <dialog> imperatively in response to request.
    // showModal() gives us focus-trap + ::backdrop + native ESC handling for free.
    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (request && !dialog.open) {
            dialog.showModal();
        } else if (!request && dialog.open) {
            dialog.close();
        }
    }, [request]);

    // Native <dialog> already handles Escape; we add Enter as a keyboard accelerator.
    useEffect(() => {
        if (!request) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                resolveConfirmDialog(request.id, true);
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [request]);

    if (!mounted) return null;

    const danger = request?.options.danger !== false;
    const title = request?.options.title
        ?? (language === 'en' ? 'Are you sure?' : language === 'kz' ? 'Сенімдісіз бе?' : 'Подтвердите действие');
    const confirmLabel = request?.options.confirmLabel
        ?? (language === 'en' ? 'Confirm' : language === 'kz' ? 'Растау' : 'Подтвердить');
    const cancelLabel = request?.options.cancelLabel
        ?? (language === 'en' ? 'Cancel' : language === 'kz' ? 'Болдырмау' : 'Отмена');

    return (
        <dialog
            ref={dialogRef}
            className="confirm-dialog rounded-2xl p-6 max-w-sm w-full"
            style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                boxShadow: 'var(--shadow-modal-strong)',
                color: 'var(--text)',
            }}
            // Click on backdrop (outside content) closes dialog as cancel.
            onClick={(event) => {
                if (event.target === event.currentTarget && request) {
                    resolveConfirmDialog(request.id, false);
                }
            }}
            // ESC fires `cancel` event before close; intercept to resolve as false.
            onCancel={(event) => {
                event.preventDefault();
                if (request) resolveConfirmDialog(request.id, false);
            }}
        >
            {request ? (
                <>
                    <h2 className="text-lg font-semibold mb-2 text-fg">{title}</h2>
                    <p className="text-sm whitespace-pre-wrap mb-6 text-muted-fg">
                        {request.message}
                    </p>
                    <div className="flex gap-3 justify-end flex-wrap">
                        <button
                            type="button"
                            autoFocus
                            onClick={() => resolveConfirmDialog(request.id, false)}
                            className="btn btn-secondary px-4 py-2 text-sm"
                        >
                            {cancelLabel}
                        </button>
                        <button
                            type="button"
                            onClick={() => resolveConfirmDialog(request.id, true)}
                            className="px-4 py-2 rounded-xl text-sm font-semibold transition"
                            style={
                                danger
                                    ? {
                                        background: 'rgba(var(--danger-rgb), 0.18)',
                                        color: 'var(--danger)',
                                        border: '1px solid rgba(var(--danger-rgb), 0.32)',
                                    }
                                    : {
                                        background: 'var(--gradient-primary)',
                                        color: '#fff',
                                    }
                            }
                        >
                            {confirmLabel}
                        </button>
                    </div>
                </>
            ) : null}
        </dialog>
    );
}
