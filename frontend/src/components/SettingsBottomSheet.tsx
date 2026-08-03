'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface SettingsBottomSheetProps {
    open: boolean;
    onClose: () => void;
    title?: string;
    subtitle?: string;
    children: ReactNode;
    /**
     * When false, the close button (top-right X) is hidden. Useful when the
     * caller wants to provide its own header.
     */
    showCloseButton?: boolean;
    closeAriaLabel?: string;
}

/**
 * Generic slide-up modal with backdrop + drag handle + swipe-to-dismiss +
 * body-scroll-lock + escape handler + portal. On desktop (≥ 640px) renders as
 * a centered modal instead of a bottom sheet.
 *
 * Generalized from the inline implementation that used to live inside
 * SettingsDevicesCard, so any settings sub-screen can reuse the same chrome.
 */
export function SettingsBottomSheet({
    open,
    onClose,
    title,
    subtitle,
    children,
    showCloseButton = true,
    closeAriaLabel = 'Close',
}: SettingsBottomSheetProps) {
    const mounted = typeof window !== 'undefined';
    const [visible, setVisible] = useState(false);
    const sheetRef = useRef<HTMLDivElement>(null);
    const modalRef = useRef<HTMLDivElement>(null);
    const dragStartY = useRef(0);
    const dragCurrentY = useRef(0);
    const isDragging = useRef(false);

    useEffect(() => {
        if (!open) return;
        // Trigger entrance animation on next frame so transition runs.
        const raf = requestAnimationFrame(() => {
            requestAnimationFrame(() => setVisible(true));
        });
        return () => {
            cancelAnimationFrame(raf);
            setVisible(false);
        };
    }, [open]);

    const handleClose = useCallback(() => {
        setVisible(false);
        // Wait for exit animation to finish before unmounting.
        window.setTimeout(() => onClose(), 280);
    }, [onClose]);

    // Escape to close.
    useEffect(() => {
        if (!open) return;
        const handler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [open, handleClose]);

    // Lock body scroll while sheet is open.
    useEffect(() => {
        if (!open) return;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = '';
        };
    }, [open]);

    const handleOverlayClick = (event: React.MouseEvent) => {
        const target = event.target as Node;
        const insideModal = modalRef.current?.contains(target);
        const insideSheet = sheetRef.current?.contains(target);
        if (!insideModal && !insideSheet) {
            handleClose();
        }
    };

    const handleTouchStart = useCallback((event: React.TouchEvent) => {
        dragStartY.current = event.touches[0].clientY;
        isDragging.current = true;
    }, []);

    const handleTouchMove = useCallback((event: React.TouchEvent) => {
        if (!isDragging.current || !sheetRef.current) return;
        const delta = event.touches[0].clientY - dragStartY.current;
        dragCurrentY.current = Math.max(0, delta);
        sheetRef.current.style.transform = `translateY(${dragCurrentY.current}px)`;
        sheetRef.current.style.transition = 'none';
    }, []);

    const handleTouchEnd = useCallback(() => {
        if (!isDragging.current || !sheetRef.current) return;
        isDragging.current = false;
        const sheet = sheetRef.current;
        sheet.style.transition = '';
        if (dragCurrentY.current > 120) {
            handleClose();
        } else {
            sheet.style.transform = '';
        }
        dragCurrentY.current = 0;
    }, [handleClose]);

    if (!mounted || !open) return null;

    const innerContent = (
        <>
            {(title || showCloseButton) ? (
                <div className="flex items-center justify-between px-5 pt-4 pb-3 flex-shrink-0">
                    {title ? (
                        <div className="min-w-0">
                            <h2 className="text-[17px] font-semibold text-fg">{title}</h2>
                            {subtitle ? <p className="text-[13px] mt-0.5 text-muted-fg">{subtitle}</p> : null}
                        </div>
                    ) : <div />}
                    {showCloseButton ? (
                        <button
                            type="button"
                            onClick={handleClose}
                            aria-label={closeAriaLabel}
                            className="w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70 surface-overlay-3"
                            style={{ color: 'var(--muted)' }}
                        >
                            <X className="w-4 h-4" strokeWidth={2.5} aria-hidden />
                        </button>
                    ) : null}
                </div>
            ) : null}

            {title ? (
                <div className="mx-4 h-px flex-shrink-0" style={{ background: 'var(--border)', opacity: 0.5 }} />
            ) : null}

            <div
                className="overflow-y-auto flex-1"
                style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 16px), 24px)' }}
            >
                {children}
            </div>
        </>
    );

    const overlay = (
        <div
            className="fixed inset-0 z-[9999] flex items-end sm:items-center sm:justify-center"
            style={{
                background: visible ? 'var(--overlay-modal-backdrop)' : 'transparent',
                transition: 'background 0.28s ease',
            }}
            onClick={handleOverlayClick}
        >
            <div
                ref={modalRef}
                className="hidden sm:flex flex-col w-full"
                style={{
                    maxWidth: 480,
                    maxHeight: '80vh',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 20,
                    boxShadow: 'var(--shadow-modal-strong)',
                    willChange: 'transform, opacity',
                    opacity: visible ? 1 : 0,
                    transform: visible ? 'scale(1) translateY(0)' : 'scale(0.96) translateY(8px)',
                    transition: 'opacity 0.22s ease, transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
                onClick={(event) => event.stopPropagation()}
            >
                {innerContent}
            </div>

            <div
                ref={sheetRef}
                className="flex sm:hidden flex-col w-full"
                style={{
                    background: 'var(--card)',
                    borderTop: '1px solid var(--border)',
                    borderRadius: '20px 20px 0 0',
                    maxHeight: '82dvh',
                    boxShadow: '0 -8px 40px rgba(0,0,0,0.3)',
                    willChange: 'transform',
                    transform: visible ? 'translateY(0)' : 'translateY(100%)',
                    transition: 'transform 0.32s cubic-bezier(0.32, 0.72, 0, 1)',
                }}
                onClick={(event) => event.stopPropagation()}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
            >
                <div className="flex justify-center pt-3 pb-1 flex-shrink-0 cursor-grab active:cursor-grabbing">
                    <div className="w-9 h-1 rounded-full" style={{ background: 'var(--muted)', opacity: 0.3 }} />
                </div>
                {innerContent}
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}
