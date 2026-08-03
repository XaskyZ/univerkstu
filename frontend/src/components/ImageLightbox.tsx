'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useLanguage } from '@/lib/language-context';
import type { LightboxItem } from './lightbox-helpers';
import { getAttachmentsUi } from './attachments-list-i18n';

/**
 * Localized labels for the lightbox chrome. We keep these inline (instead
 * of extending `attachments-list-i18n.ts`) so future changes to lightbox
 * copy don't churn the attachments-list parity tests.
 */
function getLightboxUi(language: 'ru' | 'kz' | 'en') {
    const isRu = language === 'ru';
    const isKz = language === 'kz';
    return {
        dialogLabel: isRu ? 'Просмотр изображения' : isKz ? 'Суретті қарау' : 'Image preview',
        closeLabel: isRu ? 'Закрыть' : isKz ? 'Жабу' : 'Close',
        previousLabel: isRu ? 'Предыдущее' : isKz ? 'Алдыңғы' : 'Previous',
        nextLabel: isRu ? 'Следующее' : isKz ? 'Келесі' : 'Next',
        downloadLabel: isRu ? 'Скачать' : isKz ? 'Жүктеп алу' : 'Download',
        counter: (current: number, total: number) => `${current} / ${total}`,
    };
}

export interface ImageLightboxProps {
    items: LightboxItem[];
    initialIndex: number;
    onClose: () => void;
}

const BACKDROP = 'rgba(0, 0, 0, 0.9)';
const SWIPE_THRESHOLD_PX = 50;

/**
 * Fullscreen image lightbox with keyboard + touch navigation.
 *
 * Renders into `document.body` via `createPortal` so the modal escapes any
 * `overflow:hidden` ancestor (e.g. `PostCard`). The component is purely
 * client-side — the parent (`AttachmentsList`) decides when to mount and
 * unmount it.
 *
 * Controls:
 *   - Keyboard: Escape closes, ArrowLeft / ArrowRight navigate (with
 *     wrap-around), Home / End jump to first / last image.
 *   - Touch: horizontal swipe of at least 50px advances or rewinds by one.
 *   - Click on the backdrop closes the modal; clicks on the image itself
 *     are absorbed.
 *
 * Preloading: the adjacent images are pre-fetched via hidden `<img>` tags
 * so navigating the gallery feels instant even on cold caches.
 */
export default function ImageLightbox({ items, initialIndex, onClose }: ImageLightboxProps) {
    const { language } = useLanguage();
    const ui = useMemo(() => getLightboxUi(language), [language]);
    const attachmentsUi = useMemo(() => getAttachmentsUi(language), [language]);

    const total = items.length;
    const clampInitial = total > 0
        ? Math.min(Math.max(initialIndex, 0), total - 1)
        : 0;
    // Pair `index` with the `initialIndex` snapshot it was derived from.
    // When the caller passes a different `initialIndex` (e.g. user clicked
    // a new thumbnail to reopen the modal at another image) we detect the
    // mismatch during render and reset — the React-recommended pattern for
    // "adjusting some state when a prop changes" without an effect.
    const [indexState, setIndexState] = useState<{ index: number; from: number }>(
        () => ({ index: clampInitial, from: initialIndex }),
    );
    let index = indexState.index;
    if (indexState.from !== initialIndex) {
        index = clampInitial;
        setIndexState({ index: clampInitial, from: initialIndex });
    }
    const setIndex = useCallback((next: number | ((prev: number) => number)) => {
        setIndexState((prev) => ({
            index: typeof next === 'function' ? next(prev.index) : next,
            from: prev.from,
        }));
    }, []);

    const dialogRef = useRef<HTMLDivElement | null>(null);
    const previouslyFocused = useRef<Element | null>(null);
    const touchStartX = useRef<number | null>(null);
    const mounted = typeof window !== 'undefined';

    const goPrev = useCallback(() => {
        if (total <= 1) return;
        setIndex((i) => (i - 1 + total) % total);
    }, [total, setIndex]);

    const goNext = useCallback(() => {
        if (total <= 1) return;
        setIndex((i) => (i + 1) % total);
    }, [total, setIndex]);

    const goFirst = useCallback(() => {
        if (total <= 0) return;
        setIndex(0);
    }, [total, setIndex]);

    const goLast = useCallback(() => {
        if (total <= 0) return;
        setIndex(total - 1);
    }, [total, setIndex]);

    // Keyboard navigation. Capture phase so we win over any page-level
    // shortcut listeners while the modal is open.
    useEffect(() => {
        const handler = (event: KeyboardEvent) => {
            switch (event.key) {
                case 'Escape':
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                    break;
                case 'ArrowLeft':
                    event.preventDefault();
                    goPrev();
                    break;
                case 'ArrowRight':
                    event.preventDefault();
                    goNext();
                    break;
                case 'Home':
                    event.preventDefault();
                    goFirst();
                    break;
                case 'End':
                    event.preventDefault();
                    goLast();
                    break;
                default:
                    break;
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [onClose, goPrev, goNext, goFirst, goLast]);

    // Lock body scroll while the modal is open and restore focus on close.
    useEffect(() => {
        previouslyFocused.current = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const focusId = window.setTimeout(() => {
            dialogRef.current?.focus();
        }, 0);
        return () => {
            window.clearTimeout(focusId);
            document.body.style.overflow = previousOverflow;
            if (previouslyFocused.current instanceof HTMLElement) {
                previouslyFocused.current.focus();
            }
        };
    }, []);

    const handleTouchStart = useCallback((event: React.TouchEvent) => {
        if (event.touches.length !== 1) {
            touchStartX.current = null;
            return;
        }
        touchStartX.current = event.touches[0].clientX;
    }, []);

    const handleTouchEnd = useCallback(
        (event: React.TouchEvent) => {
            const start = touchStartX.current;
            touchStartX.current = null;
            if (start === null) return;
            const endX = event.changedTouches[0]?.clientX;
            if (typeof endX !== 'number') return;
            const delta = endX - start;
            if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
            if (delta > 0) {
                goPrev();
            } else {
                goNext();
            }
        },
        [goPrev, goNext],
    );

    if (!mounted || total === 0) return null;

    const current = items[index];
    const prevIndex = (index - 1 + total) % total;
    const nextIndex = (index + 1) % total;
    const preloadCandidates: LightboxItem[] = [];
    if (total > 1) {
        preloadCandidates.push(items[prevIndex]);
        if (nextIndex !== prevIndex) preloadCandidates.push(items[nextIndex]);
    }

    const overlay = (
        <div
            className="fixed inset-0 z-[10000] flex items-center justify-center"
            style={{ background: BACKDROP }}
            onClick={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            role="presentation"
        >
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-label={ui.dialogLabel}
                tabIndex={-1}
                style={{
                    position: 'relative',
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    outline: 'none',
                }}
                onClick={(event) => {
                    if (event.target === event.currentTarget) onClose();
                }}
            >
                {/* Counter (top-left) */}
                {total > 1 ? (
                    <div
                        style={{
                            position: 'absolute',
                            top: 16,
                            left: 16,
                            padding: '6px 12px',
                            borderRadius: 999,
                            background: 'rgba(0, 0, 0, 0.5)',
                            color: '#fff',
                            fontSize: 13,
                            fontVariantNumeric: 'tabular-nums',
                            pointerEvents: 'none',
                        }}
                        aria-live="polite"
                    >
                        {ui.counter(index + 1, total)}
                    </div>
                ) : null}

                {/* Close button (top-right) */}
                <button
                    type="button"
                    onClick={onClose}
                    aria-label={ui.closeLabel}
                    style={{
                        position: 'absolute',
                        top: 12,
                        right: 12,
                        width: 40,
                        height: 40,
                        borderRadius: 999,
                        border: 'none',
                        background: 'rgba(0, 0, 0, 0.5)',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <X className="w-5 h-5" aria-hidden />
                </button>

                {/* Prev arrow (desktop / large screens) */}
                {total > 1 ? (
                    <button
                        type="button"
                        onClick={goPrev}
                        aria-label={ui.previousLabel}
                        style={{
                            position: 'absolute',
                            left: 12,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 44,
                            height: 44,
                            borderRadius: 999,
                            border: 'none',
                            background: 'rgba(0, 0, 0, 0.5)',
                            color: '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <ChevronLeft className="w-6 h-6" aria-hidden />
                    </button>
                ) : null}

                {/* Image. We render a raw <img> rather than next/image
                    because attachment URLs are signed/authed and the
                    backend host isn't pinned in next.config's image
                    allowlist. The lightbox is also short-lived UI so the
                    LCP impact of next/image is not the right trade-off. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                    src={current.downloadUrl}
                    alt={current.filename ?? ''}
                    onClick={(event) => event.stopPropagation()}
                    style={{
                        maxWidth: '90vw',
                        maxHeight: '90vh',
                        objectFit: 'contain',
                        cursor: 'zoom-in',
                        userSelect: 'none',
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)',
                    }}
                />

                {/* Next arrow */}
                {total > 1 ? (
                    <button
                        type="button"
                        onClick={goNext}
                        aria-label={ui.nextLabel}
                        style={{
                            position: 'absolute',
                            right: 12,
                            top: '50%',
                            transform: 'translateY(-50%)',
                            width: 44,
                            height: 44,
                            borderRadius: 999,
                            border: 'none',
                            background: 'rgba(0, 0, 0, 0.5)',
                            color: '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <ChevronRight className="w-6 h-6" aria-hidden />
                    </button>
                ) : null}

                {/* Bottom bar: filename + size + download */}
                <div
                    onClick={(event) => event.stopPropagation()}
                    style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        padding: '12px 16px',
                        background: 'rgba(0, 0, 0, 0.55)',
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        flexWrap: 'wrap',
                    }}
                >
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                            style={{
                                fontSize: 14,
                                fontWeight: 500,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                            title={current.filename ?? current.fileId}
                        >
                            {current.filename ?? current.fileId}
                        </div>
                        {typeof current.sizeBytes === 'number' ? (
                            <div
                                style={{
                                    fontSize: 12,
                                    opacity: 0.75,
                                    fontVariantNumeric: 'tabular-nums',
                                }}
                            >
                                {attachmentsUi.formatSize(current.sizeBytes)}
                            </div>
                        ) : null}
                    </div>
                    <a
                        href={current.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={current.filename ?? undefined}
                        aria-label={ui.downloadLabel}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '8px 14px',
                            borderRadius: 10,
                            background: 'rgba(255, 255, 255, 0.15)',
                            color: '#fff',
                            textDecoration: 'none',
                            fontSize: 13,
                        }}
                    >
                        <Download className="w-4 h-4" aria-hidden />
                        <span>{ui.downloadLabel}</span>
                    </a>
                </div>

                {/* Hidden preloaders for adjacent images. */}
                <div aria-hidden style={{ display: 'none' }}>
                    {preloadCandidates.map((item) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={item.attachmentId} src={item.downloadUrl} alt="" />
                    ))}
                </div>
            </div>
        </div>
    );

    return createPortal(overlay, document.body);
}
